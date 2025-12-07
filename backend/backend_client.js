import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { pool } from './db.js';
import fetch from 'node-fetch';
import { authenticateToken } from './auth_middleware.js';

import { 
    calculateDistance, 
    calculateFare, 
    calculateETA, 
    isValidCoordinate 
} from './utils/location.js';


const app = express();
const PORT = 8000;
const NOTIFY_SERVER_URL = 'http://localhost:9000/send-notification';

app.use(cors());
app.use(bodyParser.json());

app.post('/estimate-fare', authenticateToken, async (req, res) => {
    const { 
        source_lat, 
        source_lng, 
        dest_lat, 
        dest_lng, 
        ride_type = 'standard' 
    } = req.body;

    // Validate coordinates
    if (!isValidCoordinate(source_lat, source_lng) || 
        !isValidCoordinate(dest_lat, dest_lng)) {
        return res.status(400).json({ 
            error: "Invalid coordinates provided." 
        });
    }

    try {
        // Calculate distance using Haversine
        const distance = calculateDistance(
            source_lat, source_lng, 
            dest_lat, dest_lng
        );

        // Calculate fares for all ride types
        const standardFare = calculateFare(distance, 'standard');
        const premiumFare = calculateFare(distance, 'premium');
        const sharedFare = calculateFare(distance, 'shared');

        // Calculate ETA
        const eta = calculateETA(distance);

        res.json({
            success: true,
            distance: `${distance} km`,
            estimated_time: eta.formattedTime,
            fare_options: {
                standard: standardFare,
                premium: premiumFare,
                shared: sharedFare
            }
        });

    } catch (e) {
        console.error("Error estimating fare:", e);
        res.status(500).json({ error: "Failed to estimate fare." });
    }
});

// ===========================================
// == UPDATED: BOOK RIDE WITH COORDINATES ==
// ===========================================
app.post('/book-ride', authenticateToken, async (req, res) => {
    const userId = req.user.user_id;
    const { 
        source_lat, 
        source_lng, 
        source_address,
        dest_lat, 
        dest_lng, 
        dest_address,
        ride_type = 'standard'
    } = req.body;

    // Validate required fields
    if (!source_lat || !source_lng || !dest_lat || !dest_lng) {
        return res.status(400).json({ 
            error: "Missing required location coordinates." 
        });
    }

    // Validate coordinates
    if (!isValidCoordinate(source_lat, source_lng) || 
        !isValidCoordinate(dest_lat, dest_lng)) {
        return res.status(400).json({ 
            error: "Invalid coordinates provided." 
        });
    }

    try {
        // Get user name
        const userRes = await pool.query(
            "SELECT name FROM users WHERE user_id = $1", 
            [userId]
        );
        const user_name = userRes.rows[0]?.name || 'User';

        // ✅ Calculate distance using Haversine
        const distance = calculateDistance(
            source_lat, source_lng, 
            dest_lat, dest_lng
        );

        // ✅ Calculate fare breakdown
        const fareDetails = calculateFare(distance, ride_type);

        // ✅ Calculate ETA
        const eta = calculateETA(distance);

        console.log(`📊 Ride Details:`);
        console.log(`   Distance: ${distance} km`);
        console.log(`   Fare: ₹${fareDetails.total}`);
        console.log(`   ETA: ${eta.formattedTime}`);

        // Insert ride request with calculated data
        const result = await pool.query(`
            INSERT INTO ride_requests (
                user_id, 
                user_name, 
                source_lat, 
                source_lng, 
                source_address,
                dest_lat, 
                dest_lng, 
                dest_address,
                distance_km,
                estimated_fare,
                ride_type,
                status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending') 
            RETURNING id`,
            [
                userId, 
                user_name, 
                source_lat, 
                source_lng, 
                source_address || 'N/A',
                dest_lat, 
                dest_lng, 
                dest_address || 'N/A',
                distance,
                fareDetails.total,
                ride_type
            ]
        );

        const rideId = result.rows[0].id;

        console.log(`✅ Ride ${rideId} booked successfully`);

        res.status(202).json({ 
            success: true, 
            message: "Request received, finding a driver.", 
            ride_id: rideId,
            ride_details: {
                distance: `${distance} km`,
                estimated_time: eta.formattedTime,
                fare: fareDetails,
                ride_type: ride_type
            }
        });

    } catch (e) {
        console.error("Error booking ride:", e);
        res.status(500).json({ error: "Database error.", details: e.message });
    }
});

// ===========================================
// == "BOOK WITH FRIENDS" ENDPOINTS ==
// ===========================================

// ---  CREATE MEETUP (WITH ORGANIZER RIDE BOOKING) ---
app.post('/meetups/create', authenticateToken, async (req, res) => {
    const organizer_id = req.user.user_id;
    const { 
        meetup_lat,
        meetup_lng,
        meetup_address,
        invitee_usernames, 
        organizer_source_lat,
        organizer_source_lng,
        organizer_source_address
    } = req.body;

    // Validate
    if (!meetup_lat || !meetup_lng || !invitee_usernames || 
        !organizer_source_lat || !organizer_source_lng) {
        return res.status(400).json({ 
            error: "Missing required fields." 
        });
    }

    // Validate coordinates
    if (!isValidCoordinate(meetup_lat, meetup_lng) ||
        !isValidCoordinate(organizer_source_lat, organizer_source_lng)) {
        return res.status(400).json({ 
            error: "Invalid coordinates." 
        });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Get organizer name
        const orgRes = await client.query(
            "SELECT name FROM users WHERE user_id = $1", 
            [organizer_id]
        );
        const organizer_name = orgRes.rows[0].name;

        // Calculate organizer's trip distance and fare
        const organizerDistance = calculateDistance(
            organizer_source_lat, organizer_source_lng,
            meetup_lat, meetup_lng
        );
        const organizerFare = calculateFare(organizerDistance, 'standard');

        // Create meetup
        const meetupRes = await client.query(`
            INSERT INTO meetups (
                organizer_id, 
                meetup_lat, 
                meetup_lng, 
                meetup_address, 
                status
            ) VALUES ($1, $2, $3, $4, 'pending') 
            RETURNING id`,
            [organizer_id, meetup_lat, meetup_lng, meetup_address]
        );
        const meetup_id = meetupRes.rows[0].id;

        // Book organizer's ride
        const organizerRideResult = await client.query(`
            INSERT INTO ride_requests (
                user_id, user_name, 
                source_lat, source_lng, source_address,
                dest_lat, dest_lng, dest_address,
                distance_km, estimated_fare, ride_type, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'standard', 'pending') 
            RETURNING id`,
            [
                organizer_id, organizer_name,
                organizer_source_lat, organizer_source_lng, organizer_source_address,
                meetup_lat, meetup_lng, meetup_address,
                organizerDistance, organizerFare.total
            ]
        );
        const organizerRideId = organizerRideResult.rows[0].id;

        console.log(`✅ Organizer's ride booked: ${organizerDistance}km, ₹${organizerFare.total}`);

        // Create invites (same as before)
        const userRes = await client.query(
            "SELECT user_id, email, name FROM users WHERE email = ANY($1::varchar[])",
            [invitee_usernames]
        );
        const invitees = userRes.rows;

        const createdInvites = [];
        for (const inv of invitees) {
            const insertRes = await client.query(
                "INSERT INTO meetup_invites (meetup_id, invitee_id, status) VALUES ($1, $2, 'pending') RETURNING id",
                [meetup_id, inv.user_id]
            );
            createdInvites.push({ 
                inviteId: insertRes.rows[0].id, 
                user_id: inv.user_id, 
                email: inv.email 
            });
        }

        await client.query('COMMIT');

        // Send notifications
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
                        meetup_address
                    }
                })
            });
        });

        await Promise.all(notifyPromises);

        res.status(201).json({
            success: true,
            message: "Meetup created successfully!",
            meetup_id,
            organizer_ride_id: organizerRideId,
            organizer_ride_details: {
                distance: `${organizerDistance} km`,
                fare: `₹${organizerFare.total}`
            },
            invites: createdInvites
        });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Error creating meetup:", e);
        res.status(500).json({ error: "Database error.", details: e.message });
    } finally {
        client.release();
    }
});

// --- RESPOND TO MEETUP INVITE ---
// UPDATED backend_client.js - Replace your /meetups/invites/:id/respond endpoint

app.post('/meetups/invites/:id/respond', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const userId = req.user.user_id;
    const email = req.user.email;
    const { 
        response, 
        source_lat,      // NEW: Coordinates
        source_lng,      // NEW: Coordinates
        source_address,  // NEW: Address
        source_location  // OLD: Keep for backward compatibility
    } = req.body;

    console.log(`🧾 Responding user: ${userId} (${email})`);
    console.log(`📩 Invite ID: ${id}`);
    console.log(`📍 Location data:`, { source_lat, source_lng, source_address });

    if (response === 'accepted') {
        // Check if we have coordinates (new way) or text location (old way)
        if (!source_lat && !source_lng && !source_location) {
            return res.status(400).json({ error: "Source location is required to accept." });
        }
    }

    try {
        // Check that this invite belongs to the logged-in user
        const inviteCheck = await pool.query(
            "SELECT * FROM meetup_invites WHERE id = $1 AND invitee_id = $2",
            [id, userId]
        );

        if (inviteCheck.rows.length === 0) {
            return res.status(403).json({ 
                error: "You are not authorized to respond to this invite." 
            });
        }

        const { meetup_id } = inviteCheck.rows[0];

        // Get meetup details
        const meetupRes = await pool.query(
            "SELECT organizer_id, meetup_lat, meetup_lng, meetup_address FROM meetups WHERE id = $1", 
            [meetup_id]
        );
        
        if (meetupRes.rows.length === 0) {
            return res.status(404).json({ error: "Meetup not found." });
        }

        const meetup = meetupRes.rows[0];
        const organizer_id = meetup.organizer_id;

        if (response === 'rejected') {
            await pool.query(
                "UPDATE meetup_invites SET status = 'rejected' WHERE id = $1", 
                [id]
            );

            // Notify organizer about rejection
            await fetch(NOTIFY_SERVER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targetId: `client_${organizer_id}`,
                    payload: {
                        type: 'meetup_invite_rejected',
                        message: `${email} rejected your meetup invite.`,
                        meetup_id
                    }
                })
            });

            return res.status(200).json({ success: true, message: "Invite rejected." });
        }

        // Accept flow
        // Update invite with coordinates
        await pool.query(
            `UPDATE meetup_invites 
             SET status = 'accepted', 
                 invitee_source_lat = $1,
                 invitee_source_lng = $2,
                 invitee_source_address = $3,
                 invitee_source_location = $4
             WHERE id = $5`,
            [
                source_lat || null, 
                source_lng || null,
                source_address || source_location || null,
                source_location || source_address || null, // Keep old column for compatibility
                id
            ]
        );

        // Get user name
        const userRes = await pool.query("SELECT name FROM users WHERE user_id = $1", [userId]);
        const user_name = userRes.rows[0]?.name || 'User';

        // Calculate distance and fare if we have coordinates
        let distance = null;
        let fareDetails = null;

        if (source_lat && source_lng && meetup.meetup_lat && meetup.meetup_lng) {
            const { calculateDistance, calculateFare } = await import('./utils/location.js');
            
            distance = calculateDistance(
                source_lat, source_lng,
                meetup.meetup_lat, meetup.meetup_lng
            );
            
            fareDetails = calculateFare(distance, 'standard');
            console.log(`📊 Calculated: ${distance}km, ₹${fareDetails.total}`);
        }

        // Create a ride request
        const rideResult = await pool.query(
            `INSERT INTO ride_requests (
                user_id, user_name, 
                source_lat, source_lng, source_address, source_location,
                dest_lat, dest_lng, dest_address, dest_location,
                distance_km, estimated_fare, ride_type, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'standard', 'pending') 
            RETURNING id`,
            [
                userId, 
                user_name,
                source_lat || null,
                source_lng || null,
                source_address || source_location,
                source_location || source_address, // Keep old column
                meetup.meetup_lat || null,
                meetup.meetup_lng || null,
                meetup.meetup_address,
                meetup.meetup_address, // Keep old column
                distance,
                fareDetails?.total || 100.00, // Default fare if no coordinates
                
            ]
        );

        const rideId = rideResult.rows[0].id;
        console.log(`🚗 Ride ${rideId} created for invitee ${userId}`);

        // Notify organizer about acceptance
        await fetch(NOTIFY_SERVER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targetId: `client_${organizer_id}`,
                payload: {
                    type: 'meetup_invite_accepted',
                    message: `${user_name} (${email}) accepted your meetup invite!`,
                    meetup_id
                }
            })
        });

        res.status(202).json({
            success: true,
            message: "Invite accepted! Your ride to the meetup is being booked.",
            ride_id: rideId,
            ride_details: distance && fareDetails ? {
                distance: `${distance} km`,
                fare: `₹${fareDetails.total}`
            } : null
        });

    } catch (e) {
        console.error("❌ Error responding to invite:", e);
        res.status(500).json({ error: "Database error.", details: e.message });
    }
});

// ===========================================
// == VIEW CURRENT RIDE STATUS ==
// ===========================================

// 1️⃣ GET CURRENT ACTIVE RIDE FOR THE LOGGED-IN USER
app.get('/rides/current', authenticateToken, async (req, res) => {
    const userId = req.user.user_id;
    
    console.log(`🔍 Fetching current ride for user ${userId}`);
    
    try {
        // Get the most recent assigned or pending ride for this user
        const result = await pool.query(`
            SELECT 
                rr.id as ride_id,
                rr.user_id,
                rr.user_name,
                rr.source_location,
                rr.dest_location,
                rr.status,
                rr.assigned_driver_id,
                rr.created_at,
                d.driver_name,
                d.vehicle_id,
                d.contact_number,
                d.location as driver_location
            FROM ride_requests rr
            LEFT JOIN drivers d ON rr.assigned_driver_id = d.user_id
            WHERE rr.user_id = $1 
            AND rr.status IN ('pending', 'assigned')
            ORDER BY rr.created_at DESC
            LIMIT 1
        `, [userId]);
        
        if (result.rows.length === 0) {
            console.log(`ℹ️ No active ride found for user ${userId}`);
            return res.json({ 
                success: true,
                hasActiveRide: false,
                message: 'No active ride at the moment'
            });
        }
        
        const ride = result.rows[0];
        console.log(`✅ Found active ride ${ride.ride_id} with status: ${ride.status}`);
        
        res.json({ 
            success: true,
            hasActiveRide: true,
            ride: {
                ride_id: ride.ride_id,
                status: ride.status,
                source_location: ride.source_location,
                dest_location: ride.dest_location,
                created_at: ride.created_at,
                driver: ride.assigned_driver_id ? {
                    driver_id: ride.assigned_driver_id,
                    driver_name: ride.driver_name,
                    vehicle_id: ride.vehicle_id,
                    contact_number: ride.contact_number,
                    location: ride.driver_location
                } : null
            }
        });
    } catch (e) {
        console.error('❌ Error fetching current ride:', e);
        res.status(500).json({ error: 'Failed to fetch current ride', details: e.message });
    }
});

// 1️⃣ GET RIDE HISTORY FOR THE LOGGED-IN USER (All statuses)
app.get('/rides/history', authenticateToken, async (req, res) => {
    const userId = req.user.user_id;
    const { status, limit = 50, offset = 0 } = req.query;
    
    console.log(`📜 Fetching ride history for user ${userId}`);
    
    try {
        // Build the WHERE clause based on filters
        let whereClause = 'WHERE rr.user_id = $1';
        const params = [userId];
        
        // Optional status filter
        if (status) {
            const validStatuses = ['pending', 'assigned', 'completed', 'cancelled'];
            if (validStatuses.includes(status)) {
                whereClause += ` AND rr.status = $${params.length + 1}`;
                params.push(status);
            }
        }
        
        // Get total count for pagination
        const countResult = await pool.query(`
            SELECT COUNT(*) as total
            FROM ride_requests rr
            ${whereClause}
        `, params);
        
        const totalRides = parseInt(countResult.rows[0].total);
        
        // Get paginated ride history
        const result = await pool.query(`
            SELECT 
                rr.id as ride_id,
                rr.user_id,
                rr.user_name,
                rr.source_location,
                rr.dest_location,
                rr.status,
                rr.assigned_driver_id,
                rr.created_at,
                d.driver_name,
                d.vehicle_id,
                d.contact_number
            FROM ride_requests rr
            LEFT JOIN drivers d ON rr.assigned_driver_id = d.user_id
            ${whereClause}
            ORDER BY rr.created_at DESC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `, [...params, parseInt(limit), parseInt(offset)]);
        
        // Group rides by status for statistics
        const statsResult = await pool.query(`
            SELECT 
                status,
                COUNT(*) as count
            FROM ride_requests
            WHERE user_id = $1
            GROUP BY status
        `, [userId]);
        
        const stats = {
            total: totalRides,
            completed: 0,
            cancelled: 0,
            pending: 0,
            assigned: 0
        };
        
        statsResult.rows.forEach(row => {
            stats[row.status] = parseInt(row.count);
        });
        
        console.log(`✅ Found ${result.rows.length} ride(s) for user ${userId}`);
        
        res.json({
            success: true,
            stats: stats,
            pagination: {
                total: totalRides,
                limit: parseInt(limit),
                offset: parseInt(offset),
                returned: result.rows.length
            },
            rides: result.rows
        });
        
    } catch (e) {
        console.error('❌ Error fetching ride history:', e);
        res.status(500).json({ error: 'Failed to fetch ride history', details: e.message });
    }
});

// 2️⃣ GET COMPLETED RIDES ONLY
app.get('/rides/history/completed', authenticateToken, async (req, res) => {
    const userId = req.user.user_id;
    const { limit = 20 } = req.query;
    
    console.log(`✅ Fetching completed rides for user ${userId}`);
    
    try {
        const result = await pool.query(`
            SELECT 
                rr.id as ride_id,
                rr.source_location,
                rr.dest_location,
                rr.status,
                rr.created_at,
                d.driver_name,
                d.vehicle_id,
                d.contact_number
            FROM ride_requests rr
            LEFT JOIN drivers d ON rr.assigned_driver_id = d.user_id
            WHERE rr.user_id = $1 AND rr.status = 'completed'
            ORDER BY rr.created_at DESC
            LIMIT $2
        `, [userId, parseInt(limit)]);
        
        res.json({
            success: true,
            count: result.rows.length,
            rides: result.rows
        });
        
    } catch (e) {
        console.error('❌ Error fetching completed rides:', e);
        res.status(500).json({ error: 'Failed to fetch completed rides', details: e.message });
    }
});

// 4️⃣ GET RIDE STATISTICS/SUMMARY
app.get('/rides/stats', authenticateToken, async (req, res) => {
    const userId = req.user.user_id;
    
    console.log(`📊 Fetching ride statistics for user ${userId}`);
    
    try {
        // Get ride counts by status
        const statusStats = await pool.query(`
            SELECT 
                status,
                COUNT(*) as count
            FROM ride_requests
            WHERE user_id = $1
            GROUP BY status
        `, [userId]);
        
        // Get total rides
        const totalResult = await pool.query(`
            SELECT COUNT(*) as total
            FROM ride_requests
            WHERE user_id = $1
        `, [userId]);
        
        // Get most recent ride
        const recentRide = await pool.query(`
            SELECT 
                id as ride_id,
                source_location,
                dest_location,
                status,
                created_at
            FROM ride_requests
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT 1
        `, [userId]);
        
        // Get unique drivers count
        const driversCount = await pool.query(`
            SELECT COUNT(DISTINCT assigned_driver_id) as unique_drivers
            FROM ride_requests
            WHERE user_id = $1 AND assigned_driver_id IS NOT NULL
        `, [userId]);
        
        const stats = {
            total_rides: parseInt(totalResult.rows[0].total),
            completed: 0,
            cancelled: 0,
            pending: 0,
            assigned: 0
        };
        
        statusStats.rows.forEach(row => {
            stats[row.status] = parseInt(row.count);
        });
        
        res.json({
            success: true,
            summary: {
                ...stats,
                unique_drivers: parseInt(driversCount.rows[0].unique_drivers),
                most_recent_ride: recentRide.rows[0] || null
            }
        });
        
    } catch (e) {
        console.error('❌ Error fetching ride stats:', e);
        res.status(500).json({ error: 'Failed to fetch ride stats', details: e.message });
    }
});


// 2️⃣ GET SPECIFIC RIDE DETAILS BY RIDE ID
app.get('/rides/:ride_id', authenticateToken, async (req, res) => {
    const userId = req.user.user_id;
    const { ride_id } = req.params;
    
    console.log(`🔍 Fetching ride ${ride_id} for user ${userId}`);
    
    try {
        const result = await pool.query(`
            SELECT 
                rr.id as ride_id,
                rr.user_id,
                rr.user_name,
                rr.source_location,
                rr.dest_location,
                rr.status,
                rr.assigned_driver_id,
                rr.created_at,
                d.driver_name,
                d.vehicle_id,
                d.contact_number,
                d.location as driver_location
            FROM ride_requests rr
            LEFT JOIN drivers d ON rr.assigned_driver_id = d.user_id
            WHERE rr.id = $1 AND rr.user_id = $2
        `, [ride_id, userId]);
        
        if (result.rows.length === 0) {
            console.log(`❌ Ride ${ride_id} not found or unauthorized`);
            return res.status(404).json({ 
                error: 'Ride not found or you are not authorized to view it' 
            });
        }
        
        const ride = result.rows[0];
        console.log(`✅ Found ride ${ride_id}`);
        
        res.json({ 
            success: true,
            ride: {
                ride_id: ride.ride_id,
                status: ride.status,
                source_location: ride.source_location,
                dest_location: ride.dest_location,
                created_at: ride.created_at,
                driver: ride.assigned_driver_id ? {
                    driver_id: ride.assigned_driver_id,
                    driver_name: ride.driver_name,
                    vehicle_id: ride.vehicle_id,
                    contact_number: ride.contact_number,
                    location: ride.driver_location
                } : null
            }
        });
    } catch (e) {
        console.error('❌ Error fetching ride details:', e);
        res.status(500).json({ error: 'Failed to fetch ride details', details: e.message });
    }
});

// ===========================================
// == CANCEL RIDE FEATURE ==
//
app.delete('/rides/:ride_id/cancel', authenticateToken, async (req, res) => {
    const userId = req.user.user_id;
    const ride_id = parseInt(req.params.ride_id);

    console.log(`🚫 User ${userId} attempting to cancel ride ${ride_id}`);
    if (isNaN(ride_id)) {
        return res.status(400).json({ error: 'Invalid ride ID' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // 1️⃣ Verify the ride belongs to this user and is cancellable
        const rideCheck = await client.query(`
            SELECT 
                rr.id,
                rr.user_id,
                rr.user_name,
                rr.status,
                rr.assigned_driver_id,
                rr.source_location,
                rr.dest_location
            FROM ride_requests rr
            WHERE rr.id = $1 AND rr.user_id = $2
        `, [ride_id, userId]);
        
        if (rideCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            console.log(`❌ Ride ${ride_id} not found or unauthorized`);
            return res.status(404).json({ 
                error: 'Ride not found or you are not authorized to cancel it' 
            });
        }
        
        const ride = rideCheck.rows[0];
        
        // 2️⃣ Check if ride can be cancelled (only pending or assigned rides)
        if (!['pending', 'assigned'].includes(ride.status)) {
            await client.query('ROLLBACK');
            console.log(`❌ Ride ${ride_id} cannot be cancelled (status: ${ride.status})`);
            return res.status(400).json({ 
                error: `Cannot cancel ride with status: ${ride.status}` 
            });
        }
        
        // 3️⃣ If driver was assigned, make them available again
        if (ride.assigned_driver_id) {
            await client.query(
                "UPDATE drivers SET status = 'available' WHERE user_id = $1",
                [ride.assigned_driver_id]
            );
            console.log(`✅ Driver ${ride.assigned_driver_id} made available again`);
            
            // 4️⃣ Notify the driver about cancellation
            await fetch(NOTIFY_SERVER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targetId: `client_${ride.assigned_driver_id}`,
                    payload: {
                        type: 'ride_cancelled_by_client',
                        message: `Ride cancelled by ${ride.user_name}`,
                        ride_id: ride.id,
                        source_location: ride.source_location,
                        dest_location: ride.dest_location
                    }
                })
            });
        }
        
        // 5️⃣ Update ride status to cancelled
        await client.query(
            "UPDATE ride_requests SET status = 'cancelled' WHERE id = $1",
            [ride_id]
        );
        
        await client.query('COMMIT');
        console.log(`✅ Ride ${ride_id} cancelled successfully`);
        
        res.json({
            success: true,
            message: 'Ride cancelled successfully',
            ride_id: ride.id,
            refund_info: 'Your refund will be processed within 3-5 business days' // Optional
        });
        
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ Error cancelling ride:', e);
        res.status(500).json({ error: 'Failed to cancel ride', details: e.message });
    } finally {
        client.release();
    }
});

// ===========================================
// == VIEW PENDING INVITES ENDPOINTS ==
// ===========================================

// 1️⃣ GET ALL PENDING INVITES FOR THE LOGGED-IN USER
app.get('/meetups/invites/pending', authenticateToken, async (req, res) => {
    const userId = req.user.user_id;
    
    console.log(`📥 Fetching pending invites for user ${userId}`);
    
    try {
        const result = await pool.query(`
            SELECT 
                mi.id as invite_id,
                mi.status,
                mi.created_at as invite_created_at,
                m.id as meetup_id,
                m.meetup_location,
                m.status as meetup_status,
                m.created_at as meetup_created_at,
                u.user_id as organizer_id,
                u.name as organizer_name,
                u.email as organizer_email
            FROM meetup_invites mi
            JOIN meetups m ON mi.meetup_id = m.id
            JOIN users u ON m.organizer_id = u.user_id
            WHERE mi.invitee_id = $1 AND mi.status = 'pending'
            ORDER BY mi.created_at DESC
        `, [userId]);
        
        console.log(`✅ Found ${result.rows.length} pending invite(s) for user ${userId}`);
        
        res.json({ 
            success: true,
            count: result.rows.length,
            invites: result.rows 
        });
    } catch (e) {
        console.error('❌ Error fetching pending invites:', e);
        res.status(500).json({ error: 'Failed to fetch pending invites', details: e.message });
    }
});

// 2️⃣ GET ALL INVITES (PENDING, ACCEPTED, REJECTED) FOR THE LOGGED-IN USER
app.get('/meetups/invites/all', authenticateToken, async (req, res) => {
    const userId = req.user.user_id;
    
    console.log(`📥 Fetching all invites for user ${userId}`);
    
    try {
        const result = await pool.query(`
            SELECT 
                mi.id as invite_id,
                mi.status,
                mi.invitee_source_location,
                mi.created_at as invite_created_at,
                m.id as meetup_id,
                m.meetup_location,
                m.status as meetup_status,
                m.created_at as meetup_created_at,
                u.user_id as organizer_id,
                u.name as organizer_name,
                u.email as organizer_email
            FROM meetup_invites mi
            JOIN meetups m ON mi.meetup_id = m.id
            JOIN users u ON m.organizer_id = u.user_id
            WHERE mi.invitee_id = $1
            ORDER BY mi.created_at DESC
        `, [userId]);
        
        console.log(`✅ Found ${result.rows.length} total invite(s) for user ${userId}`);
        
        // Organize by status
        const invitesByStatus = {
            pending: result.rows.filter(inv => inv.status === 'pending'),
            accepted: result.rows.filter(inv => inv.status === 'accepted'),
            rejected: result.rows.filter(inv => inv.status === 'rejected')
        };
        
        res.json({ 
            success: true,
            total: result.rows.length,
            counts: {
                pending: invitesByStatus.pending.length,
                accepted: invitesByStatus.accepted.length,
                rejected: invitesByStatus.rejected.length
            },
            invites: result.rows,
            invitesByStatus 
        });
    } catch (e) {
        console.error('❌ Error fetching all invites:', e);
        res.status(500).json({ error: 'Failed to fetch invites', details: e.message });
    }
});

// 3️⃣ GET SPECIFIC INVITE DETAILS BY INVITE ID
app.get('/meetups/invites/:invite_id', authenticateToken, async (req, res) => {
    const userId = req.user.user_id;
    const { invite_id } = req.params;
    
    console.log(`📥 Fetching invite ${invite_id} for user ${userId}`);
    
    try {
        const result = await pool.query(`
            SELECT 
                mi.id as invite_id,
                mi.status,
                mi.invitee_source_location,
                mi.created_at as invite_created_at,
                m.id as meetup_id,
                m.meetup_location,
                m.status as meetup_status,
                m.created_at as meetup_created_at,
                u.user_id as organizer_id,
                u.name as organizer_name,
                u.email as organizer_email
            FROM meetup_invites mi
            JOIN meetups m ON mi.meetup_id = m.id
            JOIN users u ON m.organizer_id = u.user_id
            WHERE mi.id = $1 AND mi.invitee_id = $2
        `, [invite_id, userId]);
        
        if (result.rows.length === 0) {
            console.log(`❌ Invite ${invite_id} not found or unauthorized`);
            return res.status(404).json({ error: 'Invite not found or you are not authorized to view it' });
        }
        
        console.log(`✅ Found invite ${invite_id}`);
        
        res.json({ 
            success: true,
            invite: result.rows[0] 
        });
    } catch (e) {
        console.error('❌ Error fetching invite details:', e);
        res.status(500).json({ error: 'Failed to fetch invite details', details: e.message });
    }
});

// 4️⃣ GET MEETUPS ORGANIZED BY THE LOGGED-IN USER (with invite statistics)
app.get('/meetups/my-meetups', authenticateToken, async (req, res) => {
    const userId = req.user.user_id;
    
    console.log(`📥 Fetching meetups organized by user ${userId}`);
    
    try {
        // Get all meetups created by this user
        const meetupsResult = await pool.query(`
            SELECT 
                id as meetup_id,
                meetup_location,
                status,
                created_at
            FROM meetups
            WHERE organizer_id = $1
            ORDER BY created_at DESC
        `, [userId]);
        
        const meetups = meetupsResult.rows;
        
        // For each meetup, get invite statistics
        const meetupsWithStats = await Promise.all(meetups.map(async (meetup) => {
            const statsResult = await pool.query(`
                SELECT 
                    COUNT(*) as total_invites,
                    COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
                    COUNT(CASE WHEN status = 'accepted' THEN 1 END) as accepted,
                    COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected
                FROM meetup_invites
                WHERE meetup_id = $1
            `, [meetup.meetup_id]);
            
            // Get list of invitees
            const inviteesResult = await pool.query(`
                SELECT 
                    mi.id as invite_id,
                    mi.status,
                    u.user_id,
                    u.name,
                    u.email
                FROM meetup_invites mi
                JOIN users u ON mi.invitee_id = u.user_id
                WHERE mi.meetup_id = $1
                ORDER BY mi.created_at ASC
            `, [meetup.meetup_id]);
            
            return {
                ...meetup,
                stats: statsResult.rows[0],
                invitees: inviteesResult.rows
            };
        }));
        
        console.log(`✅ Found ${meetups.length} meetup(s) organized by user ${userId}`);
        
        res.json({ 
            success: true,
            count: meetups.length,
            meetups: meetupsWithStats 
        });
    } catch (e) {
        console.error('❌ Error fetching organized meetups:', e);
        res.status(500).json({ error: 'Failed to fetch your meetups', details: e.message });
    }
});

// 1️⃣ GET DETAILED MEETUP STATUS (for organizer and participants)
// FIXED VERSION of /meetups/:meetup_id/status endpoint
// Replace your /meetups/:meetup_id/status endpoint with this DEBUG version
// This will show you EXACTLY which query is failing

app.get('/meetups/:meetup_id/status', authenticateToken, async (req, res) => {
    const userId = req.user.user_id;
    const meetup_id = parseInt(req.params.meetup_id);
    if (isNaN(meetup_id)) {
        return res.status(400).json({ error: 'Invalid meetup ID' });
    }
    console.log(`📊 Fetching status for meetup ${meetup_id} by user ${userId}`);
    console.log(`📊 meetup_id type: ${typeof meetup_id}, value: ${meetup_id}`);
    
    try {
        // QUERY 1
        console.log('🔍 Running QUERY 1: Fetch meetup details...');
        const meetupResult = await pool.query(`
            SELECT 
                m.id as meetup_id,
                m.organizer_id,
                m.meetup_location,
                m.status,
                m.created_at,
                u.name as organizer_name,
                u.email as organizer_email
            FROM meetups m
            JOIN users u ON m.organizer_id = u.user_id
            WHERE m.id = $1
        `, [meetup_id]);
        console.log('✅ QUERY 1 succeeded');
        
        if (meetupResult.rows.length === 0) {
            return res.status(404).json({ error: 'Meetup not found' });
        }
        
        const meetup = meetupResult.rows[0];
        console.log(`📍 meetup_location: "${meetup.meetup_location}", type: ${typeof meetup.meetup_location}`);
        
        // QUERY 2
        console.log('🔍 Running QUERY 2: Auth check...');
        console.log(`   Parameters: meetup_id=${meetup_id} (${typeof meetup_id}), userId=${userId} (${typeof userId})`);
        const authCheck = await pool.query(`
            SELECT COUNT(*) as count 
            FROM meetup_invites 
            WHERE meetup_id = $1 AND invitee_id = $2
        `, [meetup_id, userId]);
        console.log('✅ QUERY 2 succeeded');
        
        const isOrganizer = meetup.organizer_id === userId;
        const isInvitee = parseInt(authCheck.rows[0].count) > 0;
        
        if (!isOrganizer && !isInvitee) {
            return res.status(403).json({ 
                error: 'You are not authorized to view this meetup status' 
            });
        }
        
        // QUERY 3
        console.log('🔍 Running QUERY 3: Fetch invites...');
        console.log(`   Parameters: meetup_location="${meetup.meetup_location}" (${typeof meetup.meetup_location}), meetup_id=${meetup_id} (${typeof meetup_id})`);
        const invitesResult = await pool.query(`
            SELECT 
                mi.id as invite_id,
                mi.status as invite_status,
                mi.invitee_source_location,
                u.user_id,
                u.name,
                u.email,
                rr.id as ride_id,
                rr.status as ride_status,
                rr.assigned_driver_id,
                d.driver_name,
                d.vehicle_id
            FROM meetup_invites mi
            JOIN users u ON mi.invitee_id = u.user_id
            LEFT JOIN ride_requests rr ON (
                rr.user_id = mi.invitee_id 
                AND rr.dest_location = $1
                AND rr.status IN ('pending', 'assigned', 'completed')
            )
            LEFT JOIN drivers d ON rr.assigned_driver_id = d.user_id
            WHERE mi.meetup_id = $2
            ORDER BY mi.created_at ASC
        `, [meetup.meetup_location, meetup_id]);
        console.log('✅ QUERY 3 succeeded');
        
        // QUERY 4
        console.log('🔍 Running QUERY 4: Fetch organizer ride...');
        console.log(`   Parameters: organizer_id=${meetup.organizer_id} (${typeof meetup.organizer_id}), meetup_location="${meetup.meetup_location}" (${typeof meetup.meetup_location})`);
        const organizerRideResult = await pool.query(`
            SELECT 
                rr.id as ride_id,
                rr.status as ride_status,
                rr.source_location,
                rr.assigned_driver_id,
                d.driver_name,
                d.vehicle_id
            FROM ride_requests rr
            LEFT JOIN drivers d ON rr.assigned_driver_id = d.user_id
            WHERE rr.user_id = $1 
            AND rr.dest_location = $2
            AND rr.status IN ('pending', 'assigned', 'completed')
            ORDER BY rr.created_at DESC
            LIMIT 1
        `, [meetup.organizer_id, meetup.meetup_location]);
        console.log('✅ QUERY 4 succeeded');
        
        const organizerRide = organizerRideResult.rows[0] || null;
        
        // Rest of your code...
        const inviteStats = {
            total: invitesResult.rows.length,
            pending: invitesResult.rows.filter(i => i.invite_status === 'pending').length,
            accepted: invitesResult.rows.filter(i => i.invite_status === 'accepted').length,
            rejected: invitesResult.rows.filter(i => i.invite_status === 'rejected').length
        };
        
        const acceptedInvites = invitesResult.rows.filter(i => i.invite_status === 'accepted');
        const rideStats = {
            total_participants: acceptedInvites.length + 1,
            rides_completed: acceptedInvites.filter(i => i.ride_status === 'completed').length + 
                           (organizerRide?.ride_status === 'completed' ? 1 : 0),
            rides_in_progress: acceptedInvites.filter(i => i.ride_status === 'assigned').length + 
                             (organizerRide?.ride_status === 'assigned' ? 1 : 0),
            rides_pending: acceptedInvites.filter(i => i.ride_status === 'pending').length + 
                         (organizerRide?.ride_status === 'pending' ? 1 : 0)
        };
        
        let calculatedStatus = meetup.status;
        if (rideStats.rides_completed === rideStats.total_participants && rideStats.total_participants > 0) {
            calculatedStatus = 'all_arrived';
            console.log('🔍 Running QUERY 5: Update meetup status to all_arrived...');
            if (meetup.status !== 'all_arrived') {
                await pool.query(
                    "UPDATE meetups SET status = 'all_arrived' WHERE id = $1",
                    [meetup_id]
                );
            }
            console.log('✅ QUERY 5 succeeded');
        } else if (rideStats.rides_in_progress > 0 || rideStats.rides_completed > 0) {
            calculatedStatus = 'in_progress';
            console.log('🔍 Running QUERY 6: Update meetup status to in_progress...');
            if (meetup.status === 'pending') {
                await pool.query(
                    "UPDATE meetups SET status = 'in_progress' WHERE id = $1",
                    [meetup_id]
                );
            }
            console.log('✅ QUERY 6 succeeded');
        }
        
        const participants = [
            {
                user_id: meetup.organizer_id,
                name: meetup.organizer_name,
                email: meetup.organizer_email,
                role: 'organizer',
                invite_status: 'accepted',
                ride: organizerRide ? {
                    ride_id: organizerRide.ride_id,
                    status: organizerRide.ride_status,
                    source_location: organizerRide.source_location,
                    driver: organizerRide.assigned_driver_id ? {
                        driver_name: organizerRide.driver_name,
                        vehicle_id: organizerRide.vehicle_id
                    } : null
                } : null,
                has_arrived: organizerRide?.ride_status === 'completed',
                eta: organizerRide?.ride_status === 'assigned' ? 'En route' : 
                     organizerRide?.ride_status === 'pending' ? 'Finding driver...' :
                     organizerRide?.ride_status === 'completed' ? 'Arrived' : 'Not booked'
            },
            ...invitesResult.rows.map(inv => ({
                user_id: inv.user_id,
                name: inv.name,
                email: inv.email,
                role: 'invitee',
                invite_id: inv.invite_id,
                invite_status: inv.invite_status,
                ride: inv.ride_id ? {
                    ride_id: inv.ride_id,
                    status: inv.ride_status,
                    source_location: inv.invitee_source_location,
                    driver: inv.assigned_driver_id ? {
                        driver_name: inv.driver_name,
                        vehicle_id: inv.vehicle_id
                    } : null
                } : null,
                has_arrived: inv.ride_status === 'completed',
                eta: inv.ride_status === 'assigned' ? 'En route' : 
                     inv.ride_status === 'pending' ? 'Finding driver...' :
                     inv.ride_status === 'completed' ? 'Arrived' : 
                     inv.invite_status === 'pending' ? 'Awaiting response' :
                     inv.invite_status === 'rejected' ? 'Declined' : 'Not booked'
            }))
        ];
        
        console.log(`✅ Meetup ${meetup_id} status: ${calculatedStatus}`);
        
        res.json({
            success: true,
            meetup: {
                meetup_id: meetup.meetup_id,
                organizer: {
                    user_id: meetup.organizer_id,
                    name: meetup.organizer_name,
                    email: meetup.organizer_email
                },
                location: meetup.meetup_location,
                status: calculatedStatus,
                created_at: meetup.created_at
            },
            invite_stats: inviteStats,
            ride_stats: rideStats,
            participants: participants,
            your_role: isOrganizer ? 'organizer' : 'invitee'
        });
        
    } catch (e) {
        console.error('❌ Error fetching meetup status:', e);
        console.error('❌ Error details:', e.message);
        console.error('❌ Error stack:', e.stack);
        res.status(500).json({ error: 'Failed to fetch meetup status', details: e.message });
    }
});

// 2️⃣ GET SIMPLIFIED MEETUP PROGRESS (quick overview)
app.get('/meetups/:meetup_id/progress', authenticateToken, async (req, res) => {
    const userId = req.user.user_id;
    const meetup_id = parseInt(req.params.meetup_id);
    if (isNaN(meetup_id)) {
        return res.status(400).json({ error: 'Invalid meetup ID' });
    }
    console.log(`🔍 Fetching progress for meetup ${meetup_id}`);
    
    try {
        // Get meetup info
        const meetupResult = await pool.query(`
            SELECT organizer_id, meetup_location, status 
            FROM meetups 
            WHERE id = $1
        `, [meetup_id]);
        
        if (meetupResult.rows.length === 0) {
            return res.status(404).json({ error: 'Meetup not found' });
        }
        
        const meetup = meetupResult.rows[0];
        
        // Check authorization
        const authCheck = await pool.query(`
            SELECT COUNT(*) as count 
            FROM meetup_invites 
            WHERE meetup_id = $1 AND invitee_id = $2
        `, [meetup_id, userId]);
        
        const isAuthorized = meetup.organizer_id === userId || parseInt(authCheck.rows[0].count) > 0;
        
        if (!isAuthorized) {
            return res.status(403).json({ error: 'Not authorized' });
        }
        
        // Get invite counts
        const inviteStats = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN status = 'accepted' THEN 1 END) as accepted,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
                COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected
            FROM meetup_invites
            WHERE meetup_id = $1
        `, [meetup_id]);
        
        // Count completed rides (including organizer)
        const rideStats = await pool.query(`
            SELECT COUNT(*) as completed_rides
            FROM ride_requests rr
            WHERE rr.dest_location = $1
            AND rr.status = 'completed'
            AND (
                rr.user_id = $2
                OR rr.user_id IN (
                    SELECT invitee_id FROM meetup_invites 
                    WHERE meetup_id = $3 AND status = 'accepted'
                )
            )
        `, [meetup.meetup_location, meetup.organizer_id, meetup_id]);
        
        const stats = inviteStats.rows[0];
        const totalExpected = parseInt(stats.accepted) + 1; // +1 for organizer
        const arrived = parseInt(rideStats.rows[0].completed_rides);
        
        res.json({
            success: true,
            meetup_id: parseInt(meetup_id),
            status: meetup.status,
            invites: {
                total: parseInt(stats.total),
                accepted: parseInt(stats.accepted),
                pending: parseInt(stats.pending),
                rejected: parseInt(stats.rejected)
            },
            arrivals: {
                expected: totalExpected,
                arrived: arrived,
                waiting: totalExpected - arrived,
                progress_percentage: totalExpected > 0 ? Math.round((arrived / totalExpected) * 100) : 0
            }
        });
        
    } catch (e) {
        console.error('❌ Error fetching meetup progress:', e);
        res.status(500).json({ error: 'Failed to fetch progress', details: e.message });
    }
});




// 3️⃣ GET SPECIFIC RIDE DETAILS WITH FULL HISTORY INFO
app.get('/rides/:ride_id/details', authenticateToken, async (req, res) => {
    const userId = req.user.user_id;
    const { ride_id } = req.params;
    
    console.log(`🔍 Fetching details for ride ${ride_id}`);
    
    try {
        const result = await pool.query(`
            SELECT 
                rr.id as ride_id,
                rr.user_id,
                rr.user_name,
                rr.source_location,
                rr.dest_location,
                rr.status,
                rr.assigned_driver_id,
                rr.created_at,
                d.driver_name,
                d.vehicle_id,
                d.contact_number,
                d.location as driver_location,
                u.email as user_email
            FROM ride_requests rr
            LEFT JOIN drivers d ON rr.assigned_driver_id = d.user_id
            LEFT JOIN users u ON rr.user_id = u.user_id
            WHERE rr.id = $1 AND rr.user_id = $2
        `, [ride_id, userId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                error: 'Ride not found or you are not authorized to view it' 
            });
        }
        
        const ride = result.rows[0];
        
        // Check if this ride is part of a meetup
        const meetupCheck = await pool.query(`
            SELECT 
                m.id as meetup_id,
                m.meetup_location,
                m.organizer_id,
                u.name as organizer_name
            FROM meetups m
            JOIN users u ON m.organizer_id = u.user_id
            WHERE m.meetup_location = $1
            AND (
                m.organizer_id = $2
                OR EXISTS (
                    SELECT 1 FROM meetup_invites mi
                    WHERE mi.meetup_id = m.id 
                    AND mi.invitee_id = $2
                    AND mi.status = 'accepted'
                )
            )
            ORDER BY m.created_at DESC
            LIMIT 1
        `, [ride.dest_location, userId]);
        
        const meetupInfo = meetupCheck.rows.length > 0 ? meetupCheck.rows[0] : null;
        
        res.json({
            success: true,
            ride: {
                ride_id: ride.ride_id,
                passenger: {
                    user_id: ride.user_id,
                    name: ride.user_name,
                    email: ride.user_email
                },
                route: {
                    from: ride.source_location,
                    to: ride.dest_location
                },
                status: ride.status,
                driver: ride.assigned_driver_id ? {
                    driver_id: ride.assigned_driver_id,
                    name: ride.driver_name,
                    vehicle: ride.vehicle_id,
                    contact: ride.contact_number,
                    location: ride.driver_location
                } : null,
                created_at: ride.created_at,
                meetup: meetupInfo ? {
                    meetup_id: meetupInfo.meetup_id,
                    location: meetupInfo.meetup_location,
                    organizer_name: meetupInfo.organizer_name,
                    is_meetup_ride: true
                } : null
            }
        });
        
    } catch (e) {
        console.error('❌ Error fetching ride details:', e);
        res.status(500).json({ error: 'Failed to fetch ride details', details: e.message });
    }
});



app.delete('/meetups/:meetup_id/cancel', authenticateToken, async (req, res) => {
    const userId = req.user.user_id;
    const meetup_id = parseInt(req.params.meetup_id);
    const { reason } = req.body; // Optional cancellation reason
    if (isNaN(meetup_id)) {
        return res.status(400).json({ error: 'Invalid meetup ID' });
    }
    console.log(`🚫 User ${userId} attempting to cancel meetup ${meetup_id}`);
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // 1️⃣ Verify the meetup exists and user is the organizer
        const meetupCheck = await client.query(`
            SELECT 
                m.id,
                m.organizer_id,
                m.meetup_location,
                m.status,
                u.name as organizer_name
            FROM meetups m
            JOIN users u ON m.organizer_id = u.user_id
            WHERE m.id = $1
        `, [meetup_id]);
        
        if (meetupCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            console.log(`❌ Meetup ${meetup_id} not found`);
            return res.status(404).json({ 
                error: 'Meetup not found' 
            });
        }
        
        const meetup = meetupCheck.rows[0];
        
        // 2️⃣ Check if user is the organizer
        if (meetup.organizer_id !== userId) {
            await client.query('ROLLBACK');
            console.log(`❌ User ${userId} is not the organizer of meetup ${meetup_id}`);
            return res.status(403).json({ 
                error: 'Only the organizer can cancel this meetup' 
            });
        }
        
        // 3️⃣ Check if meetup is already cancelled
        if (meetup.status === 'cancelled') {
            await client.query('ROLLBACK');
            console.log(`❌ Meetup ${meetup_id} is already cancelled`);
            return res.status(400).json({ 
                error: 'Meetup is already cancelled' 
            });
        }
        
        // 4️⃣ Get all accepted invitees for notification
        const inviteesResult = await client.query(`
            SELECT 
                mi.invitee_id,
                u.name,
                u.email
            FROM meetup_invites mi
            JOIN users u ON mi.invitee_id = u.user_id
            WHERE mi.meetup_id = $1 AND mi.status = 'accepted'
        `, [meetup_id]);
        
        const acceptedInvitees = inviteesResult.rows;
        
        // 5️⃣ Find all rides associated with this meetup (organizer + invitees)
        const ridesResult = await client.query(`
            SELECT 
                rr.id as ride_id,
                rr.user_id,
                rr.status,
                rr.assigned_driver_id
            FROM ride_requests rr
            WHERE rr.dest_location = $1
            AND rr.user_id = ANY($2::int[])
            AND rr.status IN ('pending', 'assigned')
        `, [
            meetup.meetup_location, 
            [meetup.organizer_id, ...acceptedInvitees.map(inv => inv.invitee_id)]
        ]);
        
        const ridesToCancel = ridesResult.rows;
        console.log(`  📋 Found ${ridesToCancel.length} ride(s) to cancel`);
        
        // 6️⃣ Cancel all associated rides
        for (const ride of ridesToCancel) {
            // Cancel the ride
            await client.query(
                "UPDATE ride_requests SET status = 'cancelled' WHERE id = $1",
                [ride.ride_id]
            );
            
            // If ride had an assigned driver, make them available again
            if (ride.assigned_driver_id) {
                await client.query(
                    "UPDATE drivers SET status = 'available' WHERE user_id = $1",
                    [ride.assigned_driver_id]
                );
                console.log(`  ✅ Driver ${ride.assigned_driver_id} made available again`);
                
                // Notify the driver about ride cancellation
                await fetch(NOTIFY_SERVER_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        targetId: `driver_${ride.assigned_driver_id}`,
                        payload: {
                            type: 'ride_cancelled_by_meetup',
                            message: `Ride cancelled - Meetup was cancelled by organizer`,
                            ride_id: ride.ride_id,
                            meetup_id: meetup.id,
                            reason: reason || 'Meetup cancelled'
                        }
                    })
                });
            }
            
            // Notify the passenger about ride cancellation
            await fetch(NOTIFY_SERVER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targetId: `client_${ride.user_id}`,
                    payload: {
                        type: 'ride_cancelled_by_meetup',
                        message: `Your ride was cancelled because the meetup was cancelled`,
                        ride_id: ride.ride_id,
                        meetup_id: meetup.id,
                        reason: reason || 'Meetup cancelled by organizer'
                    }
                })
            });
        }
        
        // 7️⃣ Update all invites to cancelled status
        await client.query(
            "UPDATE meetup_invites SET status = 'cancelled' WHERE meetup_id = $1 AND status != 'rejected'",
            [meetup_id]
        );
        
        // 8️⃣ Update meetup status to cancelled
        await client.query(
            "UPDATE meetups SET status = 'cancelled' WHERE id = $1",
            [meetup_id]
        );
        
        await client.query('COMMIT');
        console.log(`✅ Meetup ${meetup_id} cancelled successfully`);
        
        // 9️⃣ Notify all accepted invitees about meetup cancellation
        const notificationPromises = acceptedInvitees.map(invitee => {
            return fetch(NOTIFY_SERVER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targetId: `client_${invitee.invitee_id}`,
                    payload: {
                        type: 'meetup_cancelled',
                        message: `Meetup cancelled by ${meetup.organizer_name}${reason ? `: ${reason}` : ''}`,
                        meetup_id: meetup.id,
                        meetup_location: meetup.meetup_location,
                        organizer_name: meetup.organizer_name,
                        reason: reason || null
                    }
                })
            });
        });
        
        await Promise.all(notificationPromises);
        console.log(`📧 Sent cancellation notifications to ${acceptedInvitees.length} invitee(s)`);
        
        res.json({
            success: true,
            message: 'Meetup cancelled successfully',
            meetup_id: meetup.id,
            cancelled_rides: ridesToCancel.length,
            notified_users: acceptedInvitees.length,
            details: {
                meetup_location: meetup.meetup_location,
                cancelled_at: new Date(),
                reason: reason || 'No reason provided'
            }
        });
        
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ Error cancelling meetup:', e);
        res.status(500).json({ error: 'Failed to cancel meetup', details: e.message });
    } finally {
        client.release();
    }
});

// ===========================================
// == START SERVER ==
// ===========================================

app.listen(PORT, () => console.log(`🚕 Client Backend listening on port ${PORT}`));