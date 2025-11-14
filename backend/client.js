// client.js
import WebSocket from 'ws';
import fetch from 'node-fetch';

const NOTIFY_SERVER = 'ws://localhost:9000';
const AUTH_SERVER = 'http://localhost:7000';
const API_SERVER = 'http://localhost:8000'; // client backend

async function main() {
    const [email, password] = process.argv.slice(2);
    if (!email || !password) {
        console.error('Error: Please provide email and password.');
        console.log('Usage: node client.js user@example.com mypassword');
        return;
    }

    console.log(`▶️  Client ${email} attempting to log in...`);

    try {
        const loginRes = await fetch(`${AUTH_SERVER}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const loginData = await loginRes.json();
        if (!loginRes.ok) throw new Error(loginData.error || 'Login failed');

        const { token, user } = loginData;

        // ✅ Use the correct field from token: `user.userid`
        const clientUserId = user.userid;
        console.log(`✅ Login successful for ${user.name} (ID: ${clientUserId}).`);

        connectAndListen(clientUserId);
    } catch (e) {
        console.error(`❌ ${e.message}`);
    }
}

function connectAndListen(clientUserId) {
    const ws = new WebSocket(NOTIFY_SERVER);

    ws.on('open', () => {
        console.log(`✅ Connected to notification server. Waiting for notifications...`);
        ws.send(JSON.stringify({ type: 'register', id: `client_${clientUserId}` }));
    });

    ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());

        switch(msg.type) {
            case 'ride_assigned':
                console.log('\n================================');
                console.log('🎉 RIDE ASSIGNED! 🎉');
                console.log(`Driver: ${msg.driver.driver_name}`);
                console.log(`Vehicle: ${msg.driver.vehicle_id}`);
                console.log('================================\n');
                break;

            case 'new_meetup_invite':
                console.log('\n================================');
                console.log('📬 NEW MEETUP INVITE! 📬');
                console.log(msg.message);
                console.log(`Meetup Location: ${msg.meetup_location}`);
                console.log(`Invite ID (use this to respond): ${msg.invite_id}`);
                console.log(`➡️ To accept: POST to /meetups/invites/${msg.invite_id}/respond with { response: "accepted", source_location: <your location> }`);
                console.log(`➡️ To reject: POST to /meetups/invites/${msg.invite_id}/respond with { response: "rejected" }`);
                console.log('================================\n');
                break;

            default:
                console.log(`[Notification]: ${msg.message}`);
        }
    });

    ws.on('close', () => console.log('❌ Disconnected from notification service.'));
    ws.on('error', (err) => console.error('WebSocket error:', err.message));
}

main();
