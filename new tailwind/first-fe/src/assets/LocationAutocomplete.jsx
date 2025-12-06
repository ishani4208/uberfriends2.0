import React, { useEffect, useRef, useState } from 'react';
import { MapPin, Navigation } from 'lucide-react';

const LocationAutocomplete = ({ 
  onLocationSelect, 
  placeholder = "Enter location",
  initialValue = "",
  type = "pickup" // "pickup" or "destination"
}) => {
  const inputRef = useRef(null);
  const autocompleteRef = useRef(null);
  const [address, setAddress] = useState(initialValue);
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);

  useEffect(() => {
    // Check if Google Maps script is already loaded
    if (window.google && window.google.maps && window.google.maps.places) {
      setIsScriptLoaded(true);
      initAutocomplete();
      return;
    }

    // Load Google Maps script if not already loaded
    const existingScript = document.querySelector('script[src*="maps.googleapis.com"]');
    
    if (!existingScript) {
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=AIzaSyA4fhViM3zhH0B8AFOfrfF-Q2tp-w62mHk&libraries=places`;
      script.async = true;
      script.defer = true;
      
      script.onload = () => {
        setIsScriptLoaded(true);
        initAutocomplete();
      };
      
      script.onerror = () => {
        console.error("Failed to load Google Maps script");
      };
      
      document.head.appendChild(script);
    } else {
      // Script exists but might still be loading
      existingScript.onload = () => {
        setIsScriptLoaded(true);
        initAutocomplete();
      };
    }
  }, []);

  const initAutocomplete = () => {
    if (!inputRef.current || !window.google) return;

    try {
      // Initialize autocomplete with India bias
      autocompleteRef.current = new window.google.maps.places.Autocomplete(
        inputRef.current,
        {
          types: ['geocode', 'establishment'], // Addresses and places
          componentRestrictions: { country: 'in' }, // Restrict to India
          fields: ['formatted_address', 'geometry', 'name', 'place_id'] // Only request needed fields
        }
      );

      // Listen for place selection
      autocompleteRef.current.addListener('place_changed', handlePlaceSelect);
    } catch (error) {
      console.error("Error initializing autocomplete:", error);
    }
  };

  const handlePlaceSelect = () => {
    const place = autocompleteRef.current.getPlace();
    
    if (!place.geometry || !place.geometry.location) {
      console.error("No geometry data for this place");
      return;
    }

    const location = {
      address: place.formatted_address || place.name,
      lat: place.geometry.location.lat(),
      lng: place.geometry.location.lng(),
      place_id: place.place_id,
      name: place.name
    };

    setAddress(location.address);
    
    // Pass location data to parent component
    if (onLocationSelect) {
      onLocationSelect(location);
    }

    console.log('✅ Selected location:', location);
  };

  const handleInputChange = (e) => {
    setAddress(e.target.value);
    // If user clears the input, notify parent
    if (e.target.value === '' && onLocationSelect) {
      onLocationSelect(null);
    }
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={address}
        onChange={handleInputChange}
        placeholder={placeholder}
        className="w-full bg-gray-100 p-3.5 pl-10 rounded-lg outline-none font-medium placeholder-gray-500 focus:ring-2 focus:ring-black transition"
        disabled={!isScriptLoaded}
      />
      {type === "pickup" && (
        <Navigation 
          size={16} 
          className="absolute right-4 top-4 text-gray-400 cursor-pointer hover:text-black" 
        />
      )}
      {type === "destination" && (
        <MapPin 
          size={16} 
          className="absolute right-4 top-4 text-gray-400" 
        />
      )}
      {!isScriptLoaded && (
        <div className="absolute inset-0 bg-gray-100 bg-opacity-50 rounded-lg flex items-center justify-center">
          <span className="text-xs text-gray-500">Loading maps...</span>
        </div>
      )}
    </div>
  );
};

export default LocationAutocomplete;