// queue_server.js
import { pool } from './db.js'; 
import fetch from 'node-fetch';

const NOTIFY_SERVER_URL = 'http://localhost:9000/send-notification';
const CHECK_INTERVAL_MS = 5000; 

async function findAndAssignRides() {
    // console.log('⏰ Queue server checking for matches...'); 
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Find one pending ride request
        const rideRes = await client.query(
            "SELECT * FROM ride_requests WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1 FOR UPDATE"
        );

        if (rideRes.rows.length === 0) {
            await client.query('COMMIT');
            return;
        }

        const ride = rideRes.rows[0];
        console.log(`\n🔍 Processing Request ID: ${ride.id} (${ride.user_name})`);

        // 2. Find one available driver
        const driverRes = await client.query(
            "SELECT * FROM drivers WHERE status = 'available' LIMIT 1 FOR UPDATE"
        );

        if (driverRes.rows.length === 0) {
            console.log('   ...No drivers available. Waiting.');
            await client.query('COMMIT');
            return;
        }

        const driver = driverRes.rows[0];
        console.log(`   ✅ Matched with Driver: ${driver.driver_name} (ID: ${driver.user_id})`);

        // 3. TENTATIVELY ASSIGN (Lock the driver and ride)
        // We mark it as 'assigned' so other queue iterations don't pick it up.
        // If the driver 'Rejects' in the UI, the API will revert this to 'pending'/'available'.
        await client.query(
            "UPDATE ride_requests SET status = 'assigned', assigned_driver_id = $1 WHERE id = $2",
            [driver.user_id, ride.id]
        );
        
        // Mark driver busy so they don't get double-booked while deciding
        await client.query(
            "UPDATE drivers SET status = 'not_available' WHERE user_id = $1",
            [driver.user_id]
        );

        await client.query('COMMIT');

        // 4. SEND NOTIFICATIONS (Trigger Accept/Reject Modal)

        // Notify Passenger (Keep them updated)
        await fetch(NOTIFY_SERVER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targetId: `client_${ride.user_id}`,
                payload: { 
                    type: 'ride_assigned', // Triggers "Driver Found" on User UI
                    message: `Driver ${driver.driver_name} found! Waiting for acceptance...`,
                    ride, 
                    driver 
                }
            })
        });

        // Notify Driver (Triggers the Accept/Reject Modal)
        // Note: Using 'client_' prefix because the React app registers everyone as 'client_'
        await fetch(NOTIFY_SERVER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targetId: `client_${driver.user_id}`, 
                payload: { 
                    type: 'ride_assigned', // Triggers the Modal in DriverDashboard
                    message: `New Ride Request: ${ride.source_location} ➝ ${ride.dest_location}`,
                    ride,
                    client: { id: ride.user_id, name: ride.user_name } 
                }
            })
        });

        console.log(`   🚀 Invites sent. Waiting for driver response...`);

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('   ❌ Error in matching:', e);
    } finally {
        client.release();
    }
}

console.log('🚀 Queue Server started. Polling for rides...');
setInterval(findAndAssignRides, CHECK_INTERVAL_MS);