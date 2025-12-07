// utils/location.js
// Location and fare calculation utilities for UberFriends

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param {number} lat1 - Latitude of point 1
 * @param {number} lng1 - Longitude of point 1
 * @param {number} lat2 - Latitude of point 2
 * @param {number} lng2 - Longitude of point 2
 * @returns {number} Distance in kilometers (rounded to 2 decimals)
 */
export function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth's radius in kilometers
    
    // Convert degrees to radians
    const dLat = toRadians(lat2 - lat1);
    const dLng = toRadians(lng2 - lng1);
    
    // Haversine formula
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    
    return parseFloat(distance.toFixed(2));
}

/**
 * Convert degrees to radians
 */
function toRadians(degrees) {
    return degrees * (Math.PI / 180);
}

/**
 * Calculate fare based on distance and ride type
 * @param {number} distanceKm - Distance in kilometers
 * @param {string} rideType - Type: 'standard', 'premium', or 'shared'
 * @returns {object} Fare breakdown with all details
 */
export function calculateFare(distanceKm, rideType = 'standard') {
    // Pricing configuration for different ride types
    const pricing = {
        standard: {
            baseFare: 50,        // ₹50 base fare
            perKm: 15,           // ₹15 per km
            minFare: 80,         // Minimum ₹80
            serviceFee: 10       // ₹10 platform fee
        },
        premium: {
            baseFare: 100,       // ₹100 base fare
            perKm: 25,           // ₹25 per km
            minFare: 150,        // Minimum ₹150
            serviceFee: 15       // ₹15 platform fee
        },
        shared: {
            baseFare: 30,        // ₹30 base fare
            perKm: 10,           // ₹10 per km
            minFare: 50,         // Minimum ₹50
            serviceFee: 5        // ₹5 platform fee
        }
    };
    
    // Get pricing for selected ride type (default to standard)
    const rates = pricing[rideType] || pricing.standard;
    
    // Calculate trip fare: base + (distance × per km rate)
    let tripFare = rates.baseFare + (distanceKm * rates.perKm);
    
    // Apply minimum fare if calculated fare is less
    if (tripFare < rates.minFare) {
        tripFare = rates.minFare;
    }
    
    // Add service fee
    const serviceFee = rates.serviceFee;
    const subtotal = tripFare + serviceFee;
    
    // Calculate GST (18% as per Indian tax)
    const gst = subtotal * 0.18;
    
    // Calculate total
    const total = subtotal + gst;
    
    // Return detailed breakdown
    return {
        distance: distanceKm,
        baseFare: rates.baseFare,
        distanceFare: parseFloat((distanceKm * rates.perKm).toFixed(2)),
        tripFare: parseFloat(tripFare.toFixed(2)),
        serviceFee: serviceFee,
        subtotal: parseFloat(subtotal.toFixed(2)),
        gst: parseFloat(gst.toFixed(2)),
        total: parseFloat(total.toFixed(2)),
        rideType: rideType
    };
}

/**
 * Calculate estimated time of arrival
 * @param {number} distanceKm - Distance in kilometers
 * @param {number} avgSpeed - Average speed in km/h (default 30 for city)
 * @returns {object} ETA with minutes and formatted string
 */
export function calculateETA(distanceKm, avgSpeed = 30) {
    const hours = distanceKm / avgSpeed;
    const minutes = Math.ceil(hours * 60);
    
    // Format: "15 min" or "1h 25m"
    const formattedTime = minutes < 60 
        ? `${minutes} min` 
        : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    
    return {
        minutes: minutes,
        formattedTime: formattedTime
    };
}

/**
 * Find nearby drivers within a radius, sorted by distance
 * @param {number} userLat - User's latitude
 * @param {number} userLng - User's longitude
 * @param {Array} drivers - Array of driver objects with current_lat, current_lng
 * @param {number} radiusKm - Search radius in km (default 5km)
 * @returns {Array} Drivers within radius, sorted by distance (closest first)
 */
export function findNearbyDrivers(userLat, userLng, drivers, radiusKm = 5) {
    // Calculate distance for each driver
    const driversWithDistance = drivers.map(driver => {
        const distance = calculateDistance(
            userLat, 
            userLng, 
            driver.current_lat, 
            driver.current_lng
        );
        
        return {
            ...driver,
            distanceFromUser: distance
        };
    });
    
    // Filter: only drivers within radius
    // Sort: closest drivers first
    return driversWithDistance
        .filter(driver => driver.distanceFromUser <= radiusKm)
        .sort((a, b) => a.distanceFromUser - b.distanceFromUser);
}

/**
 * Validate if coordinates are valid
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {boolean} True if valid
 */
export function isValidCoordinate(lat, lng) {
    return (
        typeof lat === 'number' && 
        typeof lng === 'number' &&
        lat >= -90 && 
        lat <= 90 && 
        lng >= -180 && 
        lng <= 180 &&
        !isNaN(lat) &&
        !isNaN(lng)
    );
}

/**
 * Format distance for display
 * @param {number} km - Distance in kilometers
 * @returns {string} Formatted string like "2.5 km" or "850 m"
 */
export function formatDistance(km) {
    if (km < 1) {
        return `${Math.round(km * 1000)} m`;
    }
    return `${km.toFixed(2)} km`;
}

/**
 * Calculate driver ETA to pickup location
 * @param {number} driverLat - Driver's latitude
 * @param {number} driverLng - Driver's longitude
 * @param {number} pickupLat - Pickup latitude
 * @param {number} pickupLng - Pickup longitude
 * @returns {object} Distance and ETA for driver to reach pickup
 */
export function calculateDriverETA(driverLat, driverLng, pickupLat, pickupLng) {
    const distance = calculateDistance(driverLat, driverLng, pickupLat, pickupLng);
    const eta = calculateETA(distance, 30); // Assume 30 km/h average in city
    
    return {
        distanceKm: distance,
        etaMinutes: eta.minutes,
        etaFormatted: eta.formattedTime
    };
}