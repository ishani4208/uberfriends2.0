// test_location.js
// Run this to test your location utilities

import { 
    calculateDistance, 
    calculateFare, 
    calculateETA,
    findNearbyDrivers,
    isValidCoordinate,
    formatDistance,
    calculateDriverETA
} from './location.js';

console.log('=================================');
console.log('🧪 TESTING LOCATION UTILITIES');
console.log('=================================\n');

// Test 1: Calculate Distance
console.log('📏 TEST 1: Distance Calculation');
console.log('From: MG Road (12.9716, 77.5946)');
console.log('To: Indiranagar (12.9719, 77.6412)');

const distance = calculateDistance(12.9716, 77.5946, 12.9719, 77.6412);
console.log(`✅ Distance: ${distance} km`);
console.log(`   Formatted: ${formatDistance(distance)}\n`);

// Test 2: Calculate Fare for All Ride Types
console.log('💰 TEST 2: Fare Calculation');
console.log(`For ${distance} km trip:\n`);

const standardFare = calculateFare(distance, 'standard');
console.log('Standard Ride:');
console.log(`  Base Fare: ₹${standardFare.baseFare}`);
console.log(`  Distance Fare: ₹${standardFare.distanceFare}`);
console.log(`  Service Fee: ₹${standardFare.serviceFee}`);
console.log(`  GST (18%): ₹${standardFare.gst}`);
console.log(`  💵 TOTAL: ₹${standardFare.total}\n`);

const premiumFare = calculateFare(distance, 'premium');
console.log(`Premium Ride: ₹${premiumFare.total}`);

const sharedFare = calculateFare(distance, 'shared');
console.log(`Shared Ride: ₹${sharedFare.total}\n`);

// Test 3: Calculate ETA
console.log('⏱️  TEST 3: ETA Calculation');
const eta = calculateETA(distance);
console.log(`✅ Estimated Time: ${eta.formattedTime} (${eta.minutes} minutes)\n`);

// Test 4: Test Short Distance (< 1 km)
console.log('📏 TEST 4: Short Distance');
const shortDistance = calculateDistance(12.9716, 77.5946, 12.9720, 77.5950);
console.log(`Distance: ${formatDistance(shortDistance)}`);
const shortFare = calculateFare(shortDistance, 'standard');
console.log(`Fare: ₹${shortFare.total} (minimum fare applied: ₹${shortFare.minFare})\n`);

// Test 5: Find Nearby Drivers
console.log('🚗 TEST 5: Find Nearby Drivers');
const userLocation = { lat: 12.9716, lng: 77.5946 }; // MG Road

const mockDrivers = [
    { 
        user_id: 1, 
        driver_name: 'Ravi Kumar', 
        vehicle_id: 'KA-01-AB-1234',
        current_lat: 12.9720, 
        current_lng: 77.5950  // Very close
    },
    { 
        user_id: 2, 
        driver_name: 'Amit Singh', 
        vehicle_id: 'KA-02-CD-5678',
        current_lat: 12.9800, 
        current_lng: 77.6000  // ~5km away
    },
    { 
        user_id: 3, 
        driver_name: 'Priya Sharma', 
        vehicle_id: 'KA-03-EF-9012',
        current_lat: 12.9352, 
        current_lng: 77.6245  // Koramangala, ~8km
    },
    { 
        user_id: 4, 
        driver_name: 'Suresh Reddy', 
        vehicle_id: 'KA-04-GH-3456',
        current_lat: 13.0358, 
        current_lng: 77.5970  // Hebbal, ~10km
    }
];

console.log(`User at: MG Road`);
console.log(`Searching within 5km radius...\n`);

const nearbyDrivers = findNearbyDrivers(
    userLocation.lat, 
    userLocation.lng, 
    mockDrivers, 
    5 // 5km radius
);

if (nearbyDrivers.length > 0) {
    console.log(`✅ Found ${nearbyDrivers.length} driver(s):`);
    nearbyDrivers.forEach((driver, index) => {
        const driverETA = calculateDriverETA(
            driver.current_lat,
            driver.current_lng,
            userLocation.lat,
            userLocation.lng
        );
        
        console.log(`  ${index + 1}. ${driver.driver_name} (${driver.vehicle_id})`);
        console.log(`     Distance: ${formatDistance(driver.distanceFromUser)}`);
        console.log(`     ETA to pickup: ${driverETA.etaFormatted}`);
    });
} else {
    console.log('❌ No drivers found within radius');
}
console.log();

// Test 6: Coordinate Validation
console.log('✅ TEST 6: Coordinate Validation');
console.log(`Valid (12.9716, 77.5946): ${isValidCoordinate(12.9716, 77.5946)}`);
console.log(`Invalid (200, 77.5946): ${isValidCoordinate(200, 77.5946)}`);
console.log(`Invalid ("text", 77.5946): ${isValidCoordinate("text", 77.5946)}`);
console.log();

// Test 7: Driver Assignment Logic
console.log('🎯 TEST 7: Driver Assignment Logic');
if (nearbyDrivers.length > 0) {
    const closestDriver = nearbyDrivers[0];
    console.log(`Best match: ${closestDriver.driver_name}`);
    console.log(`  Vehicle: ${closestDriver.vehicle_id}`);
    console.log(`  Distance from pickup: ${formatDistance(closestDriver.distanceFromUser)}`);
    
    const driverETA = calculateDriverETA(
        closestDriver.current_lat,
        closestDriver.current_lng,
        userLocation.lat,
        userLocation.lng
    );
    console.log(`  Time to reach you: ${driverETA.etaFormatted}`);
}
console.log();

console.log('=================================');
console.log('✅ ALL TESTS COMPLETED!');
console.log('=================================');