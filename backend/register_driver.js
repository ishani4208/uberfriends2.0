// register_driver.js
import fetch from 'node-fetch';

const AUTH_SERVER = 'http://localhost:7001'; // Port from our previous fix
const API_SERVER = 'http://localhost:8001';

// --- Helper function to handle fetch errors ---
async function handleResponse(response) {
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || `HTTP error! status: ${response.status}`);
    }
    return data;
}

// --- Main execution ---
async function main() {
    const [name, email, password, vehicle, location] = process.argv.slice(2);
    if (!name || !email || !password || !vehicle || !location) {
        console.error('Error: Missing arguments.');
        console.log('Usage: node register_driver.js "Driver Name" email@example.com pass123 "KA-01-9999" 5');
        return;
    }

    try {
        // Step 1: Sign up for a user account
        console.log(`[Step 1/3] Creating user account for ${name}...`);
        await fetch(`${AUTH_SERVER}/api/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password })
        }).then(handleResponse);
        console.log('✅ User account created.');

        // Step 2: Log in to get the authentication token
        console.log('[Step 2/3] Logging in to get token...');
        const loginData = await fetch(`${AUTH_SERVER}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        }).then(handleResponse);
        const token = loginData.token;
        console.log('✅ Logged in, token received.');

        // Step 3: Register as a driver (linking user account to driver profile)
        console.log('[Step 3/3] Creating driver profile...');
        const driverData = await fetch(`${API_SERVER}/driver/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` // Use the token!
            },
            body: JSON.stringify({
                vehicle_id: vehicle,
                contact_number: "1234567890", // You can add this as an argument too
                location: parseInt(location)
            })
        }).then(handleResponse);
        
        console.log('\n=======================================');
        console.log('🎉 DRIVER REGISTRATION SUCCESSFUL! 🎉');
        console.log(`Driver: ${driverData.driver.driver_name}`);
        console.log(`Vehicle: ${driverData.driver.vehicle_id}`);
        console.log('=======================================');
        console.log('You can now log in as this driver using the normal driver.js script:');
        console.log(`node driver.js ${email} ${password}`);

    } catch (e) {
        console.error(`\n❌ Registration Failed: ${e.message}`);
    }
}

main();