// Add this new component to your PassengerDashboard.jsx file
// Or create a separate file: AcceptInviteModal.jsx

import React, { useState } from 'react';
import { X, MapPin, CheckCircle } from 'lucide-react';
import LocationAutocomplete from './LocationAutocomplete';

const AcceptInviteModal = ({ invite, onAccept, onCancel }) => {
  const [pickupLocation, setPickupLocation] = useState(null);

  const handleAccept = () => {
    if (!pickupLocation) {
      alert("Please select your pickup location");
      return;
    }

    onAccept(invite.invite_id, pickupLocation);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl animate-slide-up">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 to-blue-600 p-6 rounded-t-2xl relative">
          <button 
            onClick={onCancel}
            className="absolute top-4 right-4 text-white hover:bg-white/20 rounded-full p-1 transition"
          >
            <X size={20}/>
          </button>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
              <MapPin className="text-white" size={24}/>
            </div>
            <div>
              <h3 className="text-white font-bold text-xl">Accept Meetup Invite</h3>
              <p className="text-white/80 text-sm">From {invite.organizer_name}</p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          {/* Meetup Details */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
            <p className="text-xs font-bold text-yellow-700 uppercase mb-2">Meetup Location</p>
            <p className="font-bold text-gray-900 text-lg flex items-center gap-2">
              <MapPin size={18} className="text-yellow-600"/>
              {invite.meetup_address || invite.meetup_location}
            </p>
          </div>

          {/* Pickup Location Input */}
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">
              Where should we pick you up?
            </label>
            <LocationAutocomplete
              placeholder="Enter your pickup location..."
              onLocationSelect={setPickupLocation}
              type="pickup"
            />
            {pickupLocation && (
              <div className="mt-2 text-xs text-green-600 flex items-center gap-1">
                <CheckCircle size={14}/>
                <span>Location selected: {pickupLocation.address}</span>
              </div>
            )}
          </div>

          {/* Info Box */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
            <p className="font-semibold mb-1">What happens next?</p>
            <ul className="text-xs space-y-1 text-blue-700">
              <li>• We'll book a ride from your location to the meetup</li>
              <li>• You'll receive driver details shortly</li>
              <li>• The organizer will be notified of your acceptance</li>
            </ul>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 py-3 rounded-lg font-bold border-2 border-gray-200 text-gray-600 hover:bg-gray-50 transition"
            >
              Cancel
            </button>
            <button
              onClick={handleAccept}
              disabled={!pickupLocation}
              className={`flex-1 py-3 rounded-lg font-bold text-white transition ${
                pickupLocation
                  ? 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700'
                  : 'bg-gray-300 cursor-not-allowed'
              }`}
            >
              Accept & Book Ride
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AcceptInviteModal;