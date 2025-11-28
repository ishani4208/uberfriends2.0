import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { pool } from './db.js';
import { authenticateToken } from './auth_middleware.js';
import fetch from 'node-fetch';
const NOTIFY_SERVER_URL = 'http://localhost:9000/send-notification';
const app = express();
const PORT = 8080;

app.use(cors());
app.use(bodyParser.json());

async function checkAndNotifyMeetupCompletion(rideId) {
    try {
        // Get the completed ride details
        const rideResult = await pool.query(`
            SELECT user_id, dest_location 
            FROM ride_requests 
            WHERE id = $1 AND status = 'completed'
        `, [rideId]);
        
        if (rideResult.rows.length === 0) return;
        
        const ride = rideResult.rows[0];
        
        // Find if this ride is part of a meetup
const meetupResult = await pool.query(`
    SELECT DISTINCT m.id as meetup_id, m.organizer_id, m.created_at
    FROM meetups m
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
    AND m.status != 'cancelled'
    ORDER BY m.created_at DESC
    LIMIT 1
`, [ride.dest_location, ride.user_id]);

        if (meetupResult.rows.length === 0) {
            console.log('  ℹ️ Not a meetup ride, skipping completion check.');
            return; // Not a meetup ride
        }
        
        const meetup = meetupResult.rows[0];
        console.log(`  🔍 Checking completion for meetup ${meetup.meetup_id}...`);
        
        // Check if all participants have arrived
        const statsResult = await pool.query(`
            SELECT 
                COUNT(*) as total_accepted
            FROM meetup_invites mi
            WHERE mi.meetup_id = $1
            AND mi.status = 'accepted'
        `, [meetup.meetup_id]);
        
        // Count completed rides for accepted invitees
        const completedInviteeRides = await pool.query(`
            SELECT COUNT(DISTINCT rr.user_id) as completed_count
            FROM meetup_invites mi
            JOIN ride_requests rr ON (
                rr.user_id = mi.invitee_id 
                AND rr.dest_location = $1
                AND rr.status = 'completed'
            )
            WHERE mi.meetup_id = $2 
            AND mi.status = 'accepted'
        `, [ride.dest_location, meetup.meetup_id]);
        
        // Check organizer ride
        const organizerRideResult = await pool.query(`
            SELECT COUNT(*) as count
            FROM ride_requests 
            WHERE user_id = $1 
            AND dest_location = $2
            AND status = 'completed'
        `, [meetup.organizer_id, ride.dest_location]);
        
        const totalAccepted = parseInt(statsResult.rows[0].total_accepted);
        const completedInvitees = parseInt(completedInviteeRides.rows[0].completed_count);
        const organizerCompleted = parseInt(organizerRideResult.rows[0].count) > 0 ? 1 : 0;
        
        const totalExpected = totalAccepted + 1; // +1 for organizer
        const totalArrived = completedInvitees + organizerCompleted;
        
        console.log(`  📊 Arrival status: ${totalArrived}/${totalExpected} participants`);
        
        // If everyone has arrived, update meetup and notify organizer
        if (totalArrived === totalExpected && totalExpected > 0) {
            await pool.query(
                "UPDATE meetups SET status = 'all_arrived' WHERE id = $1",
                [meetup.meetup_id]
            );
            
            // Notify organizer
            await fetch(NOTIFY_SERVER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targetId: `client_${meetup.organizer_id}`,
                    payload: {
                        type: 'meetup_all_arrived',
                        message: `🎉 All participants have arrived at the meetup!`,
                        meetup_id: meetup.meetup_id,
                        total_participants: totalExpected
                    }
                })
            });
            
            console.log(`  🎉 Meetup ${meetup.meetup_id} - All ${totalExpected} participants arrived!`);
        }
        
    } catch (e) {
        console.error('  ❌ Error checking meetup completion:', e);
    }
}

// 1️⃣ Update driver status
app.put('/driver/status', authenticateToken, async (req, res) => {
    // Correctly pull the ID from the token payload
    const userId = req.user.user_id; 
    const { status } = req.body;
    const validStatuses = ['available', 'not_available', 'offline'];

    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: "Invalid status provided." });
    }

    try {
        // FIX 1: Use the consistent 'user_id' in the SQL check
        const check = await pool.query('SELECT * FROM drivers WHERE user_id = $1', [userId]);
        
        // --- Logic to auto-create profile if missing (Good Feature) ---
        if (check.rows.length === 0) {
            const autoName = `AutoDriver_${userId}`;
            const insert = await pool.query(
                // FIX 2: Ensure all profile inserts use 'user_id'
                'INSERT INTO drivers (driver_name, vehicle_id, status, user_id) VALUES ($1, $2, $3, $4) RETURNING *',
                [autoName, null, status, userId]
            );
            return res.status(201).json({
                success: true,
                message: `Driver profile created and set to ${status}.`,
                driver: insert.rows[0]
            });
        }
        // -----------------------------------------------------------

        // FIX 3: Use the consistent 'user_id' in the UPDATE query
        await pool.query('UPDATE drivers SET status = $1 WHERE user_id = $2', [status, userId]);
        console.log(`✅ Driver ${userId} updated to ${status}`);
        res.json({ success: true, message: `Status set to ${status}` });
    } catch (e) {
        console.error('❌ Status update error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// 2️⃣ Register driver profile manually
app.post('/drivers/register', authenticateToken, async (req, res) => {
    // Correctly pull the ID from the token payload
    const userId = req.user.user_id; 
    const { driver_name, vehicle_id } = req.body;

    if (!driver_name || !vehicle_id) {
        return res.status(400).json({ error: 'Missing driver_name or vehicle_id' });
    }

    try {
        // FIX 4: Use the consistent 'user_id' in the check for existing profile
        const existing = await pool.query('SELECT * FROM drivers WHERE user_id = $1', [userId]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Driver profile already exists' });
        }

        // FIX 5: Use the consistent 'user_id' in the final INSERT query
        const result = await pool.query(
            'INSERT INTO drivers (driver_name, vehicle_id, status, user_id) VALUES ($1, $2, $3, $4) RETURNING *',
            [driver_name, vehicle_id, 'offline', userId]
        );

        res.status(201).json({
            success: true,
            message: 'Driver profile created successfully',
            driver: result.rows[0]
        });
    } catch (e) {
        console.error('❌ Driver register error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ===========================================
// == COMPLETE RIDE FEATURE ==
// ===========================================

// ✅ DRIVER COMPLETES A RIDE
app.put('/driver/complete-ride/:ride_id', authenticateToken, async (req, res) => {
    const driverId = req.user.user_id;
    const { ride_id } = req.params;
    
    console.log(`✅ Driver ${driverId} attempting to complete ride ${ride_id}`);
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // 1️⃣ Verify the ride is assigned to this driver
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
            WHERE rr.id = $1 AND rr.assigned_driver_id = $2
        `, [ride_id, driverId]);
        
        if (rideCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            console.log(`❌ Ride ${ride_id} not found or not assigned to driver ${driverId}`);
            return res.status(404).json({ 
                error: 'Ride not found or not assigned to you' 
            });
        }
        
        const ride = rideCheck.rows[0];
        
        // 2️⃣ Check if ride is in a completable state
        if (ride.status !== 'assigned') {
            await client.query('ROLLBACK');
            console.log(`❌ Ride ${ride_id} cannot be completed (status: ${ride.status})`);
            return res.status(400).json({ 
                error: `Cannot complete ride with status: ${ride.status}. Only assigned rides can be completed.` 
            });
        }
        
        // 3️⃣ Mark ride as completed
        await client.query(
            "UPDATE ride_requests SET status = 'completed' WHERE id = $1",
            [ride_id]
        );
        console.log(`✅ Ride ${ride_id} marked as completed`);
        
        // 4️⃣ Make driver available again
        await client.query(
            "UPDATE drivers SET status = 'available' WHERE user_id = $1",
            [driverId]
        );
        console.log(`✅ Driver ${driverId} is now available for new rides`);
        
        await client.query('COMMIT');
        
        // 5️⃣ Notify the passenger about ride completion
        await fetch(NOTIFY_SERVER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targetId: `client_${ride.user_id}`,
                payload: {
                    type: 'ride_completed',
                    message: `Your ride has been completed! Thank you for riding with us.`,
                    ride_id: ride.id,
                    driver_name: ride.user_name // You can fetch driver name if needed
                }
            })
        });
        console.log(`📧 Completion notification sent to passenger ${ride.user_id}`);
        await checkAndNotifyMeetupCompletion(ride_id);
        res.json({
            success: true,
            message: 'Ride completed successfully! You are now available for new rides.',
            ride: {
                ride_id: ride.id,
                passenger_name: ride.user_name,
                source_location: ride.source_location,
                dest_location: ride.dest_location,
                status: 'completed'
            }
        });
        
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ Error completing ride:', e);
        res.status(500).json({ error: 'Failed to complete ride', details: e.message });
    } finally {
        client.release();
    }
});


// ===========================================
// == VIEW DRIVER'S CURRENT RIDE ==
// ===========================================

// 1️⃣ GET CURRENT ASSIGNED RIDE FOR THE DRIVER
app.get('/driver/current-ride', authenticateToken, async (req, res) => {
    const userId = req.user.user_id;
    
    console.log(`🔍 Fetching current ride for driver ${userId}`);
    
    try {
        const result = await pool.query(`
            SELECT 
                rr.id as ride_id,
                rr.user_id as passenger_id,
                rr.user_name as passenger_name,
                rr.source_location,
                rr.dest_location,
                rr.status,
                rr.created_at
            FROM ride_requests rr
            WHERE rr.assigned_driver_id = $1 
            AND rr.status = 'assigned'
            ORDER BY rr.created_at DESC
            LIMIT 1
        `, [userId]);
        
        if (result.rows.length === 0) {
            console.log(`ℹ️ No active ride found for driver ${userId}`);
            return res.json({ 
                success: true,
                hasActiveRide: false,
                message: 'No active ride at the moment'
            });
        }
        
        const ride = result.rows[0];
        console.log(`✅ Found active ride ${ride.ride_id} for driver`);
        
        res.json({ 
            success: true,
            hasActiveRide: true,
            ride: ride
        });
    } catch (e) {
        console.error('❌ Error fetching current ride for driver:', e);
        res.status(500).json({ error: 'Failed to fetch current ride', details: e.message });
    }
});

// 2️⃣ GET ALL RIDES ASSIGNED TO THE DRIVER (CURRENT + HISTORY)
app.get('/driver/rides', authenticateToken, async (req, res) => {
    const userId = req.user.user_id;
    
    console.log(`🔍 Fetching all rides for driver ${userId}`);
    
    try {
        const result = await pool.query(`
            SELECT 
                rr.id as ride_id,
                rr.user_id as passenger_id,
                rr.user_name as passenger_name,
                rr.source_location,
                rr.dest_location,
                rr.status,
                rr.created_at
            FROM ride_requests rr
            WHERE rr.assigned_driver_id = $1
            ORDER BY rr.created_at DESC
        `, [userId]);
        
        console.log(`✅ Found ${result.rows.length} ride(s) for driver ${userId}`);
        
        res.json({ 
            success: true,
            count: result.rows.length,
            rides: result.rows
        });
    } catch (e) {
        console.error('❌ Error fetching rides for driver:', e);
        res.status(500).json({ error: 'Failed to fetch rides', details: e.message });
    }
});

// 🚫 DRIVER CANCEL RIDE (if needed - optional)
app.delete('/driver/rides/:ride_id/cancel', authenticateToken, async (req, res) => {
    const driverId = req.user.user_id;
    const { ride_id } = req.params;
    const { reason } = req.body; // Optional cancellation reason
    
    console.log(`🚫 Driver ${driverId} attempting to cancel ride ${ride_id}`);
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // 1️⃣ Verify the ride is assigned to this driver
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
            WHERE rr.id = $1 AND rr.assigned_driver_id = $2
        `, [ride_id, driverId]);
        
        if (rideCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            console.log(`❌ Ride ${ride_id} not found or not assigned to driver ${driverId}`);
            return res.status(404).json({ 
                error: 'Ride not found or not assigned to you' 
            });
        }
        
        const ride = rideCheck.rows[0];
        
        // 2️⃣ Check if ride can be cancelled
        if (ride.status !== 'assigned') {
            await client.query('ROLLBACK');
            console.log(`❌ Ride ${ride_id} cannot be cancelled (status: ${ride.status})`);
            return res.status(400).json({ 
                error: `Cannot cancel ride with status: ${ride.status}` 
            });
        }
        
        // 3️⃣ Reset ride to pending and unassign driver
        await client.query(
            "UPDATE ride_requests SET status = 'pending', assigned_driver_id = NULL WHERE id = $1",
            [ride_id]
        );
        
        // 4️⃣ Make driver available again
        await client.query(
            "UPDATE drivers SET status = 'available' WHERE user_id = $1",
            [driverId]
        );
        
        await client.query('COMMIT');
        console.log(`✅ Ride ${ride_id} unassigned, driver ${driverId} available again`);
        
        // 5️⃣ Notify the client about driver cancellation
        await fetch(NOTIFY_SERVER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targetId: `client_${ride.user_id}`,
                payload: {
                    type: 'ride_cancelled_by_driver',
                    message: `Your driver cancelled the ride${reason ? `: ${reason}` : ''}. Finding another driver...`,
                    ride_id: ride.id
                }
            })
        });
        
        res.json({
            success: true,
            message: 'Ride cancelled and reassigned to pending queue',
            ride_id: ride.id
        });
        
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ Error cancelling ride:', e);
        res.status(500).json({ error: 'Failed to cancel ride', details: e.message });
    } finally {
        client.release();
    }
});


app.listen(PORT, () => console.log(`🚘 Driver backend listening on port ${PORT}`));