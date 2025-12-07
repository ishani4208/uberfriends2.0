// queuing.js - Updated with Smart Location-Based Matching
import { pool } from './db.js';
import fetch from 'node-fetch';

// ✅ IMPORT LOCATION UTILITIES
import { findNearbyDrivers, calculateDriverETA } from './utils/location.js';

const NOTIFY_SERVER_URL = 'http://localhost:9000/send-notification';
const CHECK_INTERVAL_MS = 5000;
const MAX_SEARCH_RADIUS_KM = 10; // Search within 10km radius

async function findAndAssignRides() {
    console.log('⏰ Smart queue checking for matches...');
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Find one pending ride request
        const rideRes = await client.query(`
            SELECT * FROM ride_requests 
            WHERE status = 'pending' 
            ORDER BY created_at ASC 
            LIMIT 1 
            FOR UPDATE
        `);

        if (rideRes.rows.length === 0) {
            console.log('...no pending rides found. 😴');
            await client.query('COMMIT');
            return;
        }

        const ride = rideRes.rows[0];
        console.log(`\n📍 Found Ride #${ride.id} from ${ride.user_name}`);
        console.log(`   Pickup: ${ride.source_address || `(${ride.source_lat}, ${ride.source_lng})`}`);
        console.log(`   Destination: ${ride.dest_address || `(${ride.dest_lat}, ${ride.dest_lng})`}`);
        console.log(`   Distance: ${ride.distance_km} km | Fare: ₹${ride.estimated_fare}`);
        
        // 🆕 Check if ride has coordinates
        if (!ride.source_lat || !ride.source_lng) {
            console.log(`   ⚠️  WARNING: Ride has no coordinates! Using fallback matching...`);
        }

        // Find ALL available drivers with locations
        const driverRes = await client.query(`
            SELECT 
                user_id,
                driver_name,
                vehicle_id,
                current_lat,
                current_lng,
                contact_number
            FROM drivers 
            WHERE status = 'available'
            AND current_lat IS NOT NULL 
            AND current_lng IS NOT NULL
        `);

        if (driverRes.rows.length === 0) {
            console.log('...no available drivers found. Ride remains pending. ⏳');
            await client.query('COMMIT');
            return;
        }

        console.log(`\n🔍 Found ${driverRes.rows.length} available driver(s)`);

        // 🆕 Check if ride has coordinates
        if (!ride.source_lat || !ride.source_lng) {
            console.log(`   ⚠️  Ride has no coordinates - Using simple FIFO matching`);
            
            // Simple FIFO - just pick first available driver
            const firstDriver = driverRes.rows[0];
            
            await client.query(`
                UPDATE ride_requests 
                SET status = 'assigned', assigned_driver_id = $1
                WHERE id = $2
            `, [firstDriver.user_id, ride.id]);

            await client.query(`
                UPDATE drivers SET status = 'not_available' WHERE user_id = $1
            `, [firstDriver.user_id]);

            await client.query('COMMIT');
            
            console.log(`✅ Assigned driver ${firstDriver.driver_name} (FIFO mode)\n`);
            
            // Send notifications (simplified)
            await fetch(NOTIFY_SERVER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targetId: `client_${ride.user_id}`,
                    payload: {
                        type: 'ride_assigned',
                        message: `${firstDriver.driver_name} is on the way!`,
                        ride: { id: ride.id },
                        driver: {
                            driver_name: firstDriver.driver_name,
                            vehicle_id: firstDriver.vehicle_id,
                            contact_number: firstDriver.contact_number
                        }
                    }
                })
            });

            await fetch(NOTIFY_SERVER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targetId: `driver_${firstDriver.user_id}`,
                    payload: {
                        type: 'new_ride_assigned',
                        message: `New ride assigned!`,
                        ride: {
                            id: ride.id,
                            source_address: ride.source_address || ride.source_location,
                            dest_address: ride.dest_address || ride.dest_location
                        },
                        client: { id: ride.user_id, name: ride.user_name }
                    }
                })
            });
            
            return; // Exit early
        }

        // Continue with location-based matching...

        // ✅ Find nearest drivers using location utility
        let nearbyDrivers = findNearbyDrivers(
            ride.source_lat,    // User's pickup latitude
            ride.source_lng,    // User's pickup longitude
            driverRes.rows,     // All available drivers
            MAX_SEARCH_RADIUS_KM // Search within 10km
        );

        // 🆕 FALLBACK: If no drivers within radius, assign ANY available driver
        if (nearbyDrivers.length === 0) {
            console.log(`   ⚠️  No drivers within ${MAX_SEARCH_RADIUS_KM}km radius`);
            console.log(`   🔄 FALLBACK: Assigning the nearest available driver (no radius limit)`);
            
            // Find ALL drivers sorted by distance (no radius limit)
            nearbyDrivers = findNearbyDrivers(
                ride.source_lat,
                ride.source_lng,
                driverRes.rows,
                999999 // Effectively unlimited radius
            );
            
            if (nearbyDrivers.length === 0) {
                console.log(`   ❌ Still no drivers found (shouldn't happen)`);
                await client.query('COMMIT');
                return;
            }
        }

        console.log(`   ✅ Found ${nearbyDrivers.length} driver(s) available:\n`);
        
        // Show top 3 nearest drivers
        nearbyDrivers.slice(0, 3).forEach((driver, index) => {
            const eta = calculateDriverETA(
                driver.current_lat, driver.current_lng,
                ride.source_lat, ride.source_lng
            );
            console.log(`   ${index + 1}. ${driver.driver_name} (${driver.vehicle_id})`);
            console.log(`      Distance: ${driver.distanceFromUser.toFixed(2)} km`);
            console.log(`      ETA to pickup: ${eta.etaFormatted}`);
        });

        // Pick the closest driver
        const closestDriver = nearbyDrivers[0];
        console.log(`\n🎯 Assigning closest driver: ${closestDriver.driver_name}`);
        
        if (closestDriver.distanceFromUser > MAX_SEARCH_RADIUS_KM) {
            console.log(`   ⚠️  Driver is ${closestDriver.distanceFromUser.toFixed(2)}km away (outside preferred radius)`);
        }
        console.log(`\n🎯 Assigning closest driver: ${closestDriver.driver_name}`);

        // Calculate driver ETA to pickup
        const driverETA = calculateDriverETA(
            closestDriver.current_lat, 
            closestDriver.current_lng,
            ride.source_lat, 
            ride.source_lng
        );

        // Assign the ride
        await client.query(`
            UPDATE ride_requests 
            SET 
                status = 'assigned', 
                assigned_driver_id = $1,
                driver_distance_km = $2,
                driver_eta_minutes = $3
            WHERE id = $4
        `, [
            closestDriver.user_id, 
            closestDriver.distanceFromUser,
            driverETA.etaMinutes,
            ride.id
        ]);

        // Make driver unavailable
        await client.query(`
            UPDATE drivers 
            SET status = 'not_available' 
            WHERE user_id = $1
        `, [closestDriver.user_id]);

        await client.query('COMMIT');
        
        console.log(`✅ MATCH SUCCESSFUL!`);
        console.log(`   Driver ${closestDriver.user_id} → Ride ${ride.id}\n`);

        // ✅ Notify client with detailed info
        await fetch(NOTIFY_SERVER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targetId: `client_${ride.user_id}`,
                payload: {
                    type: 'ride_assigned',
                    message: `${closestDriver.driver_name} is on the way!`,
                    ride: {
                        id: ride.id,
                        source_address: ride.source_address,
                        dest_address: ride.dest_address,
                        distance_km: ride.distance_km,
                        estimated_fare: ride.estimated_fare,
                        ride_type: ride.ride_type
                    },
                    driver: {
                        driver_name: closestDriver.driver_name,
                        vehicle_id: closestDriver.vehicle_id,
                        contact_number: closestDriver.contact_number,
                        distance_from_you: `${closestDriver.distanceFromUser.toFixed(2)} km`,
                        eta: driverETA.etaFormatted
                    }
                }
            })
        });

        // ✅ Notify driver with ride details
        await fetch(NOTIFY_SERVER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targetId: `driver_${closestDriver.user_id}`,
                payload: {
                    type: 'new_ride_assigned',
                    message: `New ride assigned! ${ride.distance_km}km trip - ₹${ride.estimated_fare}`,
                    ride: {
                        id: ride.id,
                        source_lat: ride.source_lat,
                        source_lng: ride.source_lng,
                        source_address: ride.source_address,
                        dest_lat: ride.dest_lat,
                        dest_lng: ride.dest_lng,
                        dest_address: ride.dest_address,
                        distance_km: ride.distance_km,
                        estimated_fare: ride.estimated_fare,
                        ride_type: ride.ride_type
                    },
                    client: {
                        id: ride.user_id,
                        name: ride.user_name
                    },
                    pickup_distance: `${closestDriver.distanceFromUser.toFixed(2)} km`,
                    pickup_eta: driverETA.etaFormatted
                }
            })
        });

        console.log(`📧 Notifications sent to both parties\n`);

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ Error during matching:', e);
    } finally {
        client.release();
    }
}

console.log('🚀 Smart Queue Server started with location-based matching');
console.log(`   📍 Max search radius: ${MAX_SEARCH_RADIUS_KM}km`);
console.log(`   ⏱️  Check interval: ${CHECK_INTERVAL_MS / 1000}s`);
console.log(`   🎯 Matching strategy: Closest driver first\n`);

setInterval(findAndAssignRides, CHECK_INTERVAL_MS);