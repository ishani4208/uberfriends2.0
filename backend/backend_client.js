import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { pool } from './db.js';
import fetch from 'node-fetch';
import { authenticateToken } from './auth_middleware.js'; // Import the middleware

const app = express();
const PORT = 8000;
const NOTIFY_SERVER_URL = 'http://localhost:9000/send-notification';

app.use(cors());
app.use(bodyParser.json());

// ===========================================
// == REMOVED AUTHENTICATION ENDPOINTS ==
// ===========================================
//
// /users/register and /users/login have been removed.
// Your auth_server.js (port 7000) now handles this.
//
// ===========================================

// ===========================================
// == STANDARD RIDE BOOKING ENDPOINT ==
// ===========================================

// This route is now protected. Only logged-in users can book.
// /book-ride (protected)
app.post('/book-ride', authenticateToken, async (req, res) => {
    // Get logged-in user id from token (we standardise on 'userid')
    const userId = req.user.userid;
    const { source_location, dest_location } = req.body;

    if (!source_location || !dest_location) {
        return res.status(400).json({ error: "Missing required fields." });
    }

    try {
        // Fetch user's name from DB for a friendlier experience
        const userRes = await pool.query("SELECT name FROM users WHERE user_id = $1", [userId]);
        const user_name = userRes.rows[0]?.name || 'User';

        const result = await pool.query(
            "INSERT INTO ride_requests (user_id, user_name, source_location, dest_location, status) VALUES ($1, $2, $3, $4, 'pending') RETURNING id",
            [userId, user_name, source_location, dest_location]
        );
        const rideId = result.rows[0].id;

        console.log(`(Standard Ride) Request ${rideId} from user ${userId} queued.`);
        res.status(202).json({ success: true, message: "Request received, finding a driver.", ride_id: rideId });
    } catch (e) {
        console.error("Error booking standard ride:", e);
        res.status(500).json({ error: "Database error." });
    }
});

// ===========================================
// == "BOOK WITH FRIENDS" ENDPOINTS ==
// ===========================================

// ---  CREATE MEETUP (Organizer creates a meetup and invites friends) ---
app.post('/meetups/create', authenticateToken, async (req, res) => {
    const organizer_id = req.user.userid;
    const { meetup_location, invitee_usernames } = req.body;

    if (!meetup_location || !invitee_usernames || invitee_usernames.length === 0) {
        return res.status(400).json({ error: "Missing required fields: meetup_location or invitees." });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const orgRes = await client.query("SELECT name FROM users WHERE user_id = $1", [organizer_id]);
        if (orgRes.rows.length === 0) {
            throw new Error("Organizer not found in users table.");
        }
        const organizer_name = orgRes.rows[0].name;

        // Create meetup
        const meetupRes = await client.query(
            "INSERT INTO meetups (organizer_id, meetup_location, status) VALUES ($1, $2, 'pending') RETURNING id",
            [organizer_id, meetup_location]
        );
        const meetup_id = meetupRes.rows[0].id;

        // Find invitee user IDs (by email)
        const userRes = await client.query(
            "SELECT user_id, email, name FROM users WHERE email = ANY($1::varchar[])",
            [invitee_usernames]
        );
        const invitees = userRes.rows;

        if (invitees.length === 0) {
            throw new Error("No valid invitees found for given emails.");
        }

        // Create invites and collect the created invite IDs per user
        const createdInvites = [];
        for (const inv of invitees) {
            const insertRes = await client.query(
                "INSERT INTO meetup_invites (meetup_id, invitee_id, status) VALUES ($1, $2, 'pending') RETURNING id",
                [meetup_id, inv.user_id]
            );
            const inviteId = insertRes.rows[0].id;
            createdInvites.push({ inviteId, user_id: inv.user_id, email: inv.email, name: inv.name });
            console.log(`  ➕ Invite created: invite_id=${inviteId} -> user ${inv.email} (${inv.user_id})`);
        }

        await client.query('COMMIT');

        // Send notifications (one-per-invite) and include invite_id so the client can respond with the invite id
        const notifyPromises = createdInvites.map(inv => {
            return fetch(NOTIFY_SERVER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targetId: `client_${inv.user_id}`,
                    payload: {
                        type: 'new_meetup_invite',
                        message: `You have a new meetup invite from ${organizer_name}!`,
                        meetup_id,
                        invite_id: inv.inviteId,
                        organizer_name,
                        meetup_location
                    }
                })
            });
        });

        await Promise.all(notifyPromises);

        console.log(`🎉 Meetup ${meetup_id} created by user ${organizer_id}. Invites sent: ${createdInvites.length}`);
        res.status(201).json({
            success: true,
            message: "Meetup created and invites sent successfully!",
            meetup_id,
            invites: createdInvites.map(i => ({ invite_id: i.inviteId, user_id: i.user_id, email: i.email }))
        });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error("❌ Error creating meetup:", e);
        res.status(500).json({ error: "Database error.", details: e.message });
    } finally {
        client.release();
    }
});

app.post('/meetups/invites/:id/respond', authenticateToken, async (req, res) => {
    const { id } = req.params; // this is the invite's id (from URL)
    const userId = req.user.userid;
    const email = req.user.email;
    const { response, source_location } = req.body;

    console.log(`🧾 Responding user: ${userId} (${email})`);
    console.log(`📩 Invite ID (param): ${id}`);

    if (response === 'accepted' && !source_location) {
        return res.status(400).json({ error: "Source location is required to accept." });
    }

    try {
        // Check that this invite belongs to the logged-in user
        const inviteCheck = await pool.query(
            "SELECT * FROM meetup_invites WHERE id = $1 AND invitee_id = $2",
            [id, userId]
        );

        console.log("📊 Invite check result:", inviteCheck.rows);

        if (inviteCheck.rows.length === 0) {
            return res.status(403).json({ error: "You are not authorized to respond to this invite." });
        }

        const { meetup_id } = inviteCheck.rows[0];

        // Get meetup organizer so we can notify them later
        const meetupRes = await pool.query("SELECT organizer_id FROM meetups WHERE id = $1", [meetup_id]);
        if (meetupRes.rows.length === 0) {
            return res.status(404).json({ error: "Meetup not found." });
        }
        const organizer_id = meetupRes.rows[0].organizer_id;

        if (response === 'rejected') {
            await pool.query("UPDATE meetup_invites SET status = 'rejected' WHERE id = $1", [id]);

            // Notify organizer about rejection
            await fetch(NOTIFY_SERVER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targetId: `client_${organizer_id}`,
                    payload: {
                        type: 'invite_response',
                        action: 'rejected',
                        invite_id: id,
                        invitee_id: userId,
                        message: `Invite ${id} was rejected by ${email}`
                    }
                })
            });

            return res.status(200).json({ success: true, message: "Invite rejected." });
        }

        // Accept flow
        await pool.query(
            "UPDATE meetup_invites SET status = 'accepted', invitee_source_location = $1 WHERE id = $2",
            [source_location, id]
        );

        // Get meetup destination and user name
        const meetupDestRes = await pool.query("SELECT meetup_location FROM meetups WHERE id = $1", [meetup_id]);
        const dest_location = meetupDestRes.rows[0].meetup_location;

        const userRes = await pool.query("SELECT name FROM users WHERE user_id = $1", [userId]);
        const user_name = userRes.rows[0]?.name || 'User';

        // Create a ride request
        const rideResult = await pool.query(
            "INSERT INTO ride_requests (user_id, user_name, source_location, dest_location, status) VALUES ($1, $2, $3, $4, 'pending') RETURNING id",
            [userId, user_name, source_location, dest_location]
        );

        const rideId = rideResult.rows[0].id;
        console.log(`🚗 (Meetup Ride) Request ${rideId} from user ${userId} queued.`);

        // Notify organizer about acceptance
        await fetch(NOTIFY_SERVER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targetId: `client_${organizer_id}`,
                payload: {
                    type: 'invite_response',
                    action: 'accepted',
                    invite_id: id,
                    invitee_id: userId,
                    invitee_name: user_name,
                    ride_id: rideId,
                    message: `${user_name} accepted the invite and a ride has been requested.`
                }
            })
        });

        res.status(202).json({
            success: true,
            message: "Invite accepted! Your ride to the meetup is being booked.",
            ride_id: rideId
        });

    } catch (e) {
        console.error("❌ Error responding to invite:", e);
        res.status(500).json({ error: "Database error.", details: e.message });
    }
});



// ===========================================
// == START SERVER ==
// ===========================================

app.listen(PORT, () => console.log(`🚕 Client Backend listening on port ${PORT}`));