// queue_server.js
import { pool } from './db.js'; // Assuming db.js is in the same directory
import fetch from 'node-fetch';

const NOTIFY_SERVER_URL = 'http://localhost:9000/send-notification';
const CHECK_INTERVAL_MS = 5000; // Check for matches every 5 seconds

async function findAndAssignRides() {
    console.log('⏰ Queue server waking up to find matches...');
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Find one pending ride request
        const rideRes = await client.query(
            "SELECT * FROM ride_requests WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1 FOR UPDATE"
        );

        if (rideRes.rows.length === 0) {
            console.log('...no pending rides found. Going back to sleep. 😴');
            await client.query('COMMIT');
            return;
        }

        const ride = rideRes.rows[0];
        console.log(`- Found pending ride ID: ${ride.id} from ${ride.user_name}`);

        // Find one available driver
        const driverRes = await client.query(
            "SELECT * FROM drivers WHERE status = 'available' LIMIT 1 FOR UPDATE"
        );

        if (driverRes.rows.length === 0) {
            console.log('...no available drivers found. Ride remains pending.');
            await client.query('COMMIT');
            return;
        }

        const driver = driverRes.rows[0];
        console.log(`- Found available driver: ${driver.driver_name} (ID: ${driver.userid})`);

        // Match found! Update the database records
        await client.query(
            "UPDATE ride_requests SET status = 'assigned', assigned_driver_id = $1 WHERE id = $2",
            [driver.userid, ride.id]
        );
        await client.query(
            "UPDATE drivers SET status = 'not_available' WHERE userid = $1",
            [driver.userid]
        );

        await client.query('COMMIT');
        console.log(`✅ Match successful! Assigned driver ${driver.userid} to ride ${ride.id}.`);

        // --- Notify both client and driver ---
        // 1️⃣ Notify the client
        await fetch(NOTIFY_SERVER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targetId: `client_${ride.user_id}`,
                payload: { type: 'ride_assigned', ride, driver }
            })
        });

        // 2️⃣ Notify the driver
        await fetch(NOTIFY_SERVER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targetId: `driver_${driver.userid}`,
                payload: { type: 'new_ride_assigned', ride, client: { id: ride.user_id, name: ride.user_name } }
            })
        });

        // --- 🕒 Make the driver available again after 15 seconds ---
        setTimeout(async () => {
            try {
                const releaseClient = await pool.connect();
                await releaseClient.query(
                    "UPDATE drivers SET status = 'available' WHERE userid = $1",
                    [driver.userid]
                );
                releaseClient.release();
                console.log(`🟢 Driver ${driver.userid} is now available again.`);

                // Optional: notify driver that they are available again
                await fetch(NOTIFY_SERVER_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        targetId: `driver_${driver.userid}`,
                        payload: { type: 'driver_available', message: '✅ You are now available for new rides again!' }
                    })
                });
            } catch (err) {
                console.error(`❌ Failed to make driver ${driver.userid} available again:`, err);
            }
        }, 15000); // 15 seconds

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ Error during matching process, transaction rolled back:', e);
    } finally {
        client.release();
    }
}

console.log('🚀 Queue Server started. Will check for rides every 5 seconds.');
setInterval(findAndAssignRides, CHECK_INTERVAL_MS);
