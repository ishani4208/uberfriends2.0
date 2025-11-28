import React, { useState, useEffect, useRef } from 'react';
import { MapPin, Phone, LogOut, Plus, Send, X, CheckCircle, Clock, XCircle, Users, Home, History } from 'lucide-react';

const API_SERVER = 'http://localhost:8000';
const AUTH_SERVER = 'http://localhost:7001';
const NOTIFY_SERVER = 'ws://localhost:9000';

const UberFriendsApp = () => {
  const [page, setPage] = useState('login');
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const ws = useRef(null);

  // Auth states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [isDriver, setIsDriver] = useState(false);
  const [vehicleId, setVehicleId] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [location, setLocation] = useState('');
  const [signupMode, setSignupMode] = useState(false);

  // Ride states
  const [currentRide, setCurrentRide] = useState(null);
  const [sourceLocation, setSourceLocation] = useState('');
  const [destLocation, setDestLocation] = useState('');
  const [rideHistory, setRideHistory] = useState([]);

  // Meetup states
  const [meetups, setMeetups] = useState([]);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [showMeetupModal, setShowMeetupModal] = useState(false);
  const [meetupLocation, setMeetupLocation] = useState('');
  const [inviteeEmails, setInviteeEmails] = useState('');
  const [organizerSource, setOrganizerSource] = useState('');

  // Notifications
  const [notifications, setNotifications] = useState([]);

  // Login handler
  const handleLogin = async () => {
    if (!email || !password) {
      alert('Please fill all fields');
      return;
    }

    try {
      const res = await fetch(`${AUTH_SERVER}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setUser(data.user);
      setToken(data.token);
      setPage('dashboard');
      connectWebSocket(data.user.user_id, data.token);
      fetchCurrentRide(data.token);
      fetchRideHistory(data.token);
      fetchPendingInvites(data.token);
    } catch (e) {
      alert(`Login failed: ${e.message}`);
    }
  };

  // Signup handler
  const handleSignup = async () => {
    if (!email || !password || !name) {
      alert('Please fill required fields');
      return;
    }

    const payload = { name, email, password, role: isDriver ? 'driver' : 'user' };
    if (isDriver) {
      if (!vehicleId || !contactNumber || !location) {
        alert('Driver fields required');
        return;
      }
      payload.vehicle_id = vehicleId;
      payload.contact_number = contactNumber;
      payload.location = location;
    }

    try {
      const res = await fetch(`${AUTH_SERVER}/api/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      alert('Signup successful! Please login.');
      setSignupMode(false);
      setEmail('');
      setPassword('');
      setName('');
    } catch (e) {
      alert(`Signup failed: ${e.message}`);
    }
  };

  // WebSocket connection
  const connectWebSocket = (userId, authToken) => {
    ws.current = new WebSocket(NOTIFY_SERVER);
    ws.current.onopen = () => {
      ws.current.send(JSON.stringify({ type: 'register', id: `client_${userId}` }));
    };
    ws.current.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      handleNotification(msg);
    };
  };

  const handleNotification = (msg) => {
    const notification = {
      id: Date.now(),
      type: msg.type,
      message: msg.message,
      timestamp: new Date()
    };
    setNotifications(prev => [notification, ...prev].slice(0, 5));

    if (msg.type === 'ride_assigned') {
      setCurrentRide({
        ride_id: msg.ride.id,
        status: 'assigned',
        source_location: msg.ride.source_location,
        dest_location: msg.ride.dest_location,
        driver: msg.driver
      });
    } else if (msg.type === 'new_meetup_invite') {
      setPendingInvites(prev => [...prev, msg]);
    }
  };

  // Fetch functions
  const fetchCurrentRide = async (authToken) => {
    try {
      const res = await fetch(`${API_SERVER}/rides/current`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await res.json();
      if (data.hasActiveRide) {
        setCurrentRide(data.ride);
      }
    } catch (e) {
      console.error('Error fetching current ride:', e);
    }
  };

  const fetchRideHistory = async (authToken) => {
    try {
      const res = await fetch(`${API_SERVER}/rides/history?limit=10`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await res.json();
      if (data.rides) setRideHistory(data.rides);
    } catch (e) {
      console.error('Error fetching ride history:', e);
    }
  };

  const fetchPendingInvites = async (authToken) => {
    try {
      const res = await fetch(`${API_SERVER}/meetups/invites/pending`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await res.json();
      if (data.invites) setPendingInvites(data.invites);
    } catch (e) {
      console.error('Error fetching pending invites:', e);
    }
  };

  // Book ride
  const handleBookRide = async () => {
    if (!sourceLocation || !destLocation) {
      alert('Please enter both locations');
      return;
    }

    try {
      const res = await fetch(`${API_SERVER}/book-ride`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ source_location: sourceLocation, dest_location: destLocation })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      alert('Ride booked! Waiting for driver...');
      setSourceLocation('');
      setDestLocation('');
      fetchCurrentRide(token);
    } catch (e) {
      alert(`Booking failed: ${e.message}`);
    }
  };

  // Create meetup
  const handleCreateMeetup = async () => {
    if (!meetupLocation || !inviteeEmails || !organizerSource) {
      alert('Please fill all fields');
      return;
    }

    try {
      const emails = inviteeEmails.split(',').map(e => e.trim());
      const res = await fetch(`${API_SERVER}/meetups/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          meetup_location: meetupLocation,
          invitee_usernames: emails,
          organizer_source_location: organizerSource
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      alert('Meetup created and invites sent!');
      setShowMeetupModal(false);
      setMeetupLocation('');
      setInviteeEmails('');
      setOrganizerSource('');
    } catch (e) {
      alert(`Meetup creation failed: ${e.message}`);
    }
  };

  // Respond to invite
  const handleRespondInvite = async (inviteId, response, source = null) => {
    try {
      const payload = { response };
      if (response === 'accepted' && source) {
        payload.source_location = source;
      }

      const res = await fetch(`${API_SERVER}/meetups/invites/${inviteId}/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      alert(`Invite ${response}!`);
      setPendingInvites(prev => prev.filter(inv => inv.invite_id !== inviteId));
      fetchPendingInvites(token);
    } catch (e) {
      alert(`Response failed: ${e.message}`);
    }
  };

  // Cancel ride
  const handleCancelRide = async (rideId) => {
    if (!window.confirm('Cancel this ride?')) return;

    try {
      const res = await fetch(`${API_SERVER}/rides/${rideId}/cancel`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      alert('Ride cancelled');
      setCurrentRide(null);
    } catch (e) {
      alert(`Cancellation failed: ${e.message}`);
    }
  };

  // Logout
  const handleLogout = () => {
    setUser(null);
    setToken(null);
    setPage('login');
    if (ws.current) ws.current.close();
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-black via-gray-900 to-black flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-gray-800 rounded-2xl p-8 border border-gray-700 shadow-2xl">
            <h1 className="text-4xl font-bold text-white mb-2 text-center">🚗 UberFriends</h1>
            <p className="text-gray-400 text-center mb-8">Ride together, save more</p>

            {!signupMode ? (
              <div className="space-y-4">
                <input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={handleLogin}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg transition"
                >
                  Login
                </button>
                <button
                  onClick={() => setSignupMode(true)}
                  className="w-full text-blue-400 hover:text-blue-300 py-2"
                >
                  Don't have an account? Sign up
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <input
                  type="text"
                  placeholder="Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                />
                <input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                />

                <label className="flex items-center text-white">
                  <input
                    type="checkbox"
                    checked={isDriver}
                    onChange={(e) => setIsDriver(e.target.checked)}
                    className="mr-2"
                  />
                  I'm a driver
                </label>

                {isDriver && (
                  <>
                    <input
                      type="text"
                      placeholder="Vehicle ID"
                      value={vehicleId}
                      onChange={(e) => setVehicleId(e.target.value)}
                      className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                    />
                    <input
                      type="text"
                      placeholder="Contact Number"
                      value={contactNumber}
                      onChange={(e) => setContactNumber(e.target.value)}
                      className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                    />
                    <input
                      type="text"
                      placeholder="Location"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                    />
                  </>
                )}

                <button
                  onClick={handleSignup}
                  className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-lg transition"
                >
                  Sign Up
                </button>
                <button
                  onClick={() => setSignupMode(false)}
                  className="w-full text-gray-400 hover:text-gray-300 py-2"
                >
                  Back to login
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-gray-900 to-black">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 p-4">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-white">🚗 UberFriends</h1>
            <p className="text-gray-400 text-sm">{user.name} ({user.role})</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition"
          >
            <LogOut size={18} /> Logout
          </button>
        </div>
      </div>

      {/* Notifications */}
      <div className="fixed top-20 right-4 z-50 space-y-2 max-w-sm">
        {notifications.map(notif => (
          <div
            key={notif.id}
            className="bg-blue-600 text-white p-4 rounded-lg shadow-lg animate-pulse"
          >
            {notif.message}
          </div>
        ))}
      </div>

      <div className="max-w-6xl mx-auto p-4">
        {/* Navigation Tabs */}
        <div className="flex gap-2 mb-6 flex-wrap">
          <button
            onClick={() => setPage('dashboard')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition ${
              page === 'dashboard'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            <Home size={18} /> Dashboard
          </button>
          <button
            onClick={() => setPage('book')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition ${
              page === 'book'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            <MapPin size={18} /> Book Ride
          </button>
          <button
            onClick={() => setPage('meetups')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition ${
              page === 'meetups'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            <Users size={18} /> Meetups
          </button>
          <button
            onClick={() => setPage('history')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition ${
              page === 'history'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            <History size={18} /> History
          </button>
        </div>

        {/* Dashboard */}
        {page === 'dashboard' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Current Ride */}
            <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700">
              <h2 className="text-xl font-bold text-white mb-4">Current Ride</h2>
              {currentRide ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-gray-300">
                    <Clock size={18} /> Status: <span className="text-blue-400 font-bold">{currentRide.status.toUpperCase()}</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-300">
                    <MapPin size={18} /> From: {currentRide.source_location}
                  </div>
                  <div className="flex items-center gap-2 text-gray-300">
                    <MapPin size={18} /> To: {currentRide.dest_location}
                  </div>
                  {currentRide.driver && (
                    <div className="mt-4 bg-gray-700 p-3 rounded-lg">
                      <h3 className="text-white font-bold mb-2">Driver Details</h3>
                      <p className="text-gray-300">{currentRide.driver.driver_name}</p>
                      <p className="text-gray-400 text-sm">{currentRide.driver.vehicle_id}</p>
                      <p className="text-gray-400 text-sm flex items-center gap-1">
                        <Phone size={14} /> {currentRide.driver.contact_number}
                      </p>
                    </div>
                  )}
                  <button
                    onClick={() => handleCancelRide(currentRide.ride_id)}
                    className="w-full mt-4 bg-red-600 hover:bg-red-700 text-white py-2 rounded-lg transition"
                  >
                    Cancel Ride
                  </button>
                </div>
              ) : (
                <p className="text-gray-400">No active ride. Book one now!</p>
              )}
            </div>

            {/* Pending Invites */}
            <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700">
              <h2 className="text-xl font-bold text-white mb-4">Pending Invites ({pendingInvites.length})</h2>
              <div className="space-y-3 max-h-80 overflow-y-auto">
                {pendingInvites.length > 0 ? (
                  pendingInvites.map(invite => (
                    <div key={invite.invite_id} className="bg-gray-700 p-3 rounded-lg">
                      <p className="text-white font-semibold">{invite.organizer_name}</p>
                      <p className="text-gray-400 text-sm">📍 {invite.meetup_location}</p>
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => {
                            const src = prompt('Enter your pickup location:');
                            if (src) handleRespondInvite(invite.invite_id, 'accepted', src);
                          }}
                          className="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm py-1 rounded transition"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => handleRespondInvite(invite.invite_id, 'rejected')}
                          className="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm py-1 rounded transition"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-gray-400">No pending invites</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Book Ride */}
        {page === 'book' && (
          <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700 max-w-2xl">
            <h2 className="text-2xl font-bold text-white mb-6">Book a Ride</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-gray-300 mb-2">Pickup Location</label>
                <input
                  type="text"
                  placeholder="Enter pickup location"
                  value={sourceLocation}
                  onChange={(e) => setSourceLocation(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-gray-300 mb-2">Destination</label>
                <input
                  type="text"
                  placeholder="Enter destination"
                  value={destLocation}
                  onChange={(e) => setDestLocation(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                />
              </div>
              <button
                onClick={handleBookRide}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg transition"
              >
                Book Ride
              </button>
            </div>
          </div>
        )}

        {/* Meetups */}
        {page === 'meetups' && (
          <div className="space-y-6">
            <button
              onClick={() => setShowMeetupModal(true)}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg font-bold transition"
            >
              <Plus size={20} /> Create Meetup
            </button>

            {showMeetupModal && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-40">
                <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700 max-w-md w-full">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold text-white">Create Meetup</h2>
                    <button onClick={() => setShowMeetupModal(false)} className="text-gray-400 hover:text-white">
                      <X size={24} />
                    </button>
                  </div>
                  <div className="space-y-4">
                    <input
                      type="text"
                      placeholder="Meetup Location"
                      value={meetupLocation}
                      onChange={(e) => setMeetupLocation(e.target.value)}
                      className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                    />
                    <input
                      type="text"
                      placeholder="Your Pickup Location"
                      value={organizerSource}
                      onChange={(e) => setOrganizerSource(e.target.value)}
                      className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                    />
                    <textarea
                      placeholder="Invite emails (comma-separated)"
                      value={inviteeEmails}
                      onChange={(e) => setInviteeEmails(e.target.value)}
                      className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 h-24"
                    />
                    <button
                      onClick={handleCreateMeetup}
                      className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-lg transition"
                    >
                      Create & Send Invites
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700">
              <h2 className="text-xl font-bold text-white">Your Meetups</h2>
              <p className="text-gray-400 mt-2">Meetup details will appear here</p>
            </div>
          </div>
        )}

        {/* History */}
        {page === 'history' && (
          <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700">
            <h2 className="text-2xl font-bold text-white mb-6">Ride History</h2>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {rideHistory.length > 0 ? (
                rideHistory.map(ride => (
                  <div key={ride.ride_id} className="bg-gray-700 p-4 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      {ride.status === 'completed' && <CheckCircle size={18} className="text-green-400" />}
                      {ride.status === 'cancelled' && <XCircle size={18} className="text-red-400" />}
                      {(ride.status === 'pending' || ride.status === 'assigned') && <Clock size={18} className="text-yellow-400" />}
                      <span className="font-semibold text-white">{ride.status.toUpperCase()}</span>
                    </div>
                    <p className="text-gray-300">📍 {ride.source_location} → {ride.dest_location}</p>
                    {ride.driver_name && (
                      <p className="text-gray-400 text-sm">🚗 Driver: {ride.driver_name}</p>
                    )}
                    <p className="text-gray-500 text-xs mt-1">{new Date(ride.created_at).toLocaleString()}</p>
                  </div>
                ))
              ) : (
                <p className="text-gray-400">No ride history</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default UberFriendsApp;