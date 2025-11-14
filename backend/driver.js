// driver.js
import WebSocket from 'ws';
import fetch from 'node-fetch';

const NOTIFY_SERVER = 'ws://localhost:9000';
const AUTH_SERVER = 'http://localhost:7000';
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

        // ✅ Correct ID field:
        const driverUserId = user.userid;
        console.log(`✅ Login successful for ${user.name} (ID: ${driverUserId}).`);

        await goOnline(token);
        connectAndListen(driverUserId);

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

function connectAndListen(driverUserId) {
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
