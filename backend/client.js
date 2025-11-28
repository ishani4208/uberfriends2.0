// client.js
import WebSocket from 'ws';
import fetch from 'node-fetch';

const NOTIFY_SERVER = 'ws://localhost:9000';
const AUTH_SERVER = 'http://localhost:7001';
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
        const clientUserId = user.user_id;
        console.log(`✅ Login successful for ${user.name} (ID: ${clientUserId}).`);

        // Fetch pending invites on login
        await fetchPendingInvites(token);
        await fetchCurrentRide(token);  
        await displayRideHistory(token);

        connectAndListen(clientUserId, token);
    } catch (e) {
        console.error(`❌ ${e.message}`);
    }
}

// Fetch and display pending invites
async function fetchPendingInvites(token) {
    try {
        const response = await fetch(`${API_SERVER}/meetups/invites/pending`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();
        
        if (!response.ok) {
            console.error('Failed to fetch pending invites:', data.error);
            return;
        }

        if (data.count === 0) {
            console.log('\n📭 No pending invites at the moment.\n');
            return;
        }

        console.log('\n================================');
        console.log(`📬 YOU HAVE ${data.count} PENDING INVITE(S)!`);
        console.log('================================');
        
        data.invites.forEach((invite, index) => {
            console.log(`\n[${index + 1}] Invite ID: ${invite.invite_id}`);
            console.log(`   From: ${invite.organizer_name} (${invite.organizer_email})`);
            console.log(`   Location: ${invite.meetup_location}`);
            console.log(`   Created: ${new Date(invite.invite_created_at).toLocaleString()}`);
            console.log(`   ➡️  To respond: POST to /meetups/invites/${invite.invite_id}/respond`);
            console.log(`      Accept: { "response": "accepted", "source_location": "<your location>" }`);
            console.log(`      Reject: { "response": "rejected" }`);
        });
        
        console.log('\n================================\n');
    } catch (e) {
        console.error('Error fetching pending invites:', e.message);
    }
}

// Fetch and display current ride
async function fetchCurrentRide(token) {
    try {
        const response = await fetch(`${API_SERVER}/rides/current`, {
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
            console.log('\n🚗 No active ride at the moment.\n');
            return;
        }

        const ride = data.ride;
        console.log('\n================================');
        console.log('🚕 YOUR CURRENT RIDE');
        console.log('================================');
        console.log(`Ride ID: ${ride.ride_id}`);
        console.log(`Status: ${ride.status.toUpperCase()}`);
        console.log(`From: ${ride.source_location}`);
        console.log(`To: ${ride.dest_location}`);
        console.log(`Booked: ${new Date(ride.created_at).toLocaleString()}`);
        
        if (ride.driver) {
            console.log('\n--- Driver Details ---');
            console.log(`Driver: ${ride.driver.driver_name}`);
            console.log(`Vehicle: ${ride.driver.vehicle_id}`);
            console.log(`Contact: ${ride.driver.contact_number || 'N/A'}`);
        } else {
            console.log('\n⏳ Waiting for driver assignment...');
        }
        
        console.log('================================\n');
    } catch (e) {
        console.error('Error fetching current ride:', e.message);
    }
}

// Add this after fetchCurrentRide() function
async function displayRideHistory(token) {
    try {
        const response = await fetch(`${API_SERVER}/rides/history?limit=10`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();
        
        if (!response.ok) {
            console.error('Failed to fetch ride history:', data.error);
            return;
        }

        console.log('\n================================');
        console.log('📜 YOUR RIDE HISTORY');
        console.log('================================');
        console.log(`Total Rides: ${data.stats.total}`);
        console.log(`✅ Completed: ${data.stats.completed}`);
        console.log(`🚫 Cancelled: ${data.stats.cancelled}`);
        console.log(`⏳ Pending: ${data.stats.pending}`);
        console.log(`🚗 Assigned: ${data.stats.assigned}`);
        console.log('================================');
        
        if (data.rides.length === 0) {
            console.log('\nNo rides found.\n');
            return;
        }
        
        console.log('\n📋 Recent Rides:');
        data.rides.slice(0, 5).forEach((ride, index) => {
            console.log(`\n[${index + 1}] Ride #${ride.ride_id}`);
            console.log(`   From: ${ride.source_location}`);
            console.log(`   To: ${ride.dest_location}`);
            console.log(`   Status: ${ride.status.toUpperCase()}`);
            if (ride.driver_name) {
                console.log(`   Driver: ${ride.driver_name} (${ride.vehicle_id})`);
            }
            console.log(`   Date: ${new Date(ride.created_at).toLocaleString()}`);
        });
        
        console.log('\n================================\n');
    } catch (e) {
        console.error('Error fetching ride history:', e.message);
    }
}

function connectAndListen(clientUserId, token) {
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
                console.log('💡 Tip: You can view all your pending invites by calling GET /meetups/invites/pending\n');
                break;

            case 'meetup_invite_accepted':
                console.log('\n================================');
                console.log('✅ INVITE ACCEPTED');
                console.log(msg.message);
                console.log('================================\n');
                break;

            case 'meetup_invite_rejected':
                console.log('\n================================');
                console.log('❌ INVITE REJECTED');
                console.log(msg.message);
                console.log('================================\n');
                break;

            case 'ride_cancelled_by_driver':
                console.log('\n================================');
                console.log('⚠️  RIDE CANCELLED BY DRIVER');
                console.log(msg.message);
                console.log('🔄 We are finding another driver for you...');
                console.log('================================\n');
                break;

            // ✅ NEW: Handle ride completion notification
            case 'ride_completed':
                console.log('\n================================');
                console.log('✅ RIDE COMPLETED! ✅');
                console.log(msg.message);
                console.log('================================');
                console.log('💳 Payment will be processed automatically.');
                console.log('⭐ Don\'t forget to rate your driver!');
                console.log('================================\n');
                break;

            // ✅ ADD THIS NEW CASE HERE:
            case 'meetup_all_arrived':
                console.log('\n================================');
                console.log('🎉 MEETUP COMPLETE! 🎉');
                console.log(msg.message);
                console.log(`Total Participants: ${msg.total_participants}`);
                console.log('Everyone has arrived at the meetup location!');
                console.log('================================\n');
                break;
            case 'meetup_cancelled':
                console.log('\n================================');
                console.log('🚫 MEETUP CANCELLED');
                console.log(msg.message);
                console.log(`Location: ${msg.meetup_location}`);
                if (msg.reason) {
                    console.log(`Reason: ${msg.reason}`);
                }
                console.log('Your ride (if booked) has been cancelled.');
                console.log('================================\n');
                break;

            case 'ride_cancelled_by_meetup':
                console.log('\n================================');
                console.log('🚫 RIDE CANCELLED');
                console.log(msg.message);
                console.log(`Reason: ${msg.reason}`);
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