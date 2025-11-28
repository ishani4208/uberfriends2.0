// driver.js
import WebSocket from 'ws';
import fetch from 'node-fetch';

const NOTIFY_SERVER = 'ws://localhost:9000';
const AUTH_SERVER = 'http://localhost:7001';
const API_SERVER = 'http://localhost:8080'; // driver backend

async function main() {
    const [email, password] = process.argv.slice(2);
    if (!email || !password) {
        console.error('Error: Please provide email and password.');
        console.log('Usage: node driver.js driver@example.com mypassword');
        return;
    }

    console.log(`▶️  Driver ${email} attempting to log in...`);

    try {
        const loginRes = await fetch(`${AUTH_SERVER}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const loginData = await loginRes.json();
        if (!loginRes.ok) throw new Error(loginData.error || 'Login failed');

        const { token, user } = loginData;
        const driverUserId = user.user_id;
        console.log(`✅ Login successful for ${user.name} (ID: ${driverUserId}).`);

        await goOnline(token);
        
        // ✅ NEW: Fetch current assigned ride on login
        await fetchCurrentRide(token);
        
        connectAndListen(driverUserId, token);

    } catch (e) {
        console.error(`❌ ${e.message}`);
    }
}

async function goOnline(token) {
    const response = await fetch(`${API_SERVER}/driver/status`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: 'available' })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to go online');

    console.log(`✅ Driver is now online and available.`);
}

// ✅ NEW FUNCTION: Fetch and display current assigned ride
async function fetchCurrentRide(token) {
    try {
        const response = await fetch(`${API_SERVER}/driver/current-ride`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();
        
        if (!response.ok) {
            console.error('Failed to fetch current ride:', data.error);
            return;
        }

        if (!data.hasActiveRide) {
            console.log('\n📭 No active ride assigned at the moment.\n');
            return;
        }

        const ride = data.ride;
        
        console.log('\n================================');
        console.log('🚗 YOUR CURRENT ASSIGNED RIDE');
        console.log('================================');
        console.log(`Ride ID: ${ride.ride_id}`);
        console.log(`Passenger: ${ride.passenger_name}`);
        console.log(`Pickup: ${ride.source_location}`);
        console.log(`Destination: ${ride.dest_location}`);
        console.log(`Status: ${ride.status.toUpperCase()}`);
        console.log(`Assigned at: ${new Date(ride.created_at).toLocaleString()}`);
        console.log('================================');
        console.log(`\n💡 To complete this ride, use: PUT /driver/complete-ride/${ride.ride_id}\n`);
    } catch (e) {
        console.error('Error fetching current ride:', e.message);
    }
}

function connectAndListen(driverUserId, token) {
    const ws = new WebSocket(NOTIFY_SERVER);

    ws.on('open', () => {
        console.log(`✅ Connected to notification server. Waiting for rides...`);
        ws.send(JSON.stringify({ type: 'register', id: `driver_${driverUserId}` }));
    });

    ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());

        switch(msg.type) {
            case 'new_ride_assigned':
                console.log('\n================================');
                console.log('💰 NEW RIDE ASSIGNED! 💰');
                console.log(`Pickup: ${msg.client.name} (ID: ${msg.client.id})`);
                console.log(`From: ${msg.ride.source_location}`);
                console.log(`To:   ${msg.ride.dest_location}`);
                console.log('================================');
                console.log(`\n💡 Complete this ride with: PUT /driver/complete-ride/${msg.ride.id}\n`);
                break;

            case 'ride_cancelled_by_client':
                console.log('\n================================');
                console.log('🚫 RIDE CANCELLED BY CLIENT');
                console.log(msg.message);
                console.log(`From: ${msg.source_location}`);
                console.log(`To: ${msg.dest_location}`);
                console.log('✅ You are now available for new rides.');
                console.log('================================\n');
                break;

            case 'driver_available':
                console.log('\n================================');
                console.log('🟢 YOU ARE NOW AVAILABLE');
                console.log(msg.message);
                console.log('================================\n');
                break;
            
            case 'ride_cancelled_by_meetup':
                console.log('\n================================');
                console.log('🚫 RIDE CANCELLED - MEETUP CANCELLED');
                console.log(msg.message);
                console.log(`Reason: ${msg.reason}`);
                console.log('✅ You are now available for new rides.');
                console.log('================================\n');
                break;

            case 'new_meetup_invite':
                console.log(`[MEETUP INVITE]: ${msg.message}`);
                break;

            default:
                console.log(`[Notification]: ${msg.message}`);
        }
    });

    ws.on('close', () => console.log('❌ Disconnected from notification service.'));
    ws.on('error', (err) => console.error('WebSocket error:', err.message));
}

main();