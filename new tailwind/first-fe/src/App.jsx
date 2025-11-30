import React, { useState, useRef } from 'react';
import { 
  LogOut, User, Briefcase, Car 
} from 'lucide-react';

// 1. Import your separated components
import PassengerDashboard from './assets/PassengerDashboard';
import DriverDashboard from './assets/DriverDashboard';

// --- CONFIGURATION ---
const AUTH_SERVER = 'http://localhost:7001';
const DRIVER_SERVER = 'http://localhost:8080'; // Kept for reference, but not used for signup anymore
const NOTIFY_SERVER = 'ws://localhost:9000';

const customStyles = `
  @keyframes slide-in { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  .animate-slide-in { animation: slide-in 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
  .fade-in { animation: fadeIn 0.5s; }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
`;

const UberFriendsApp = () => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const ws = useRef(null);

  // Authentication State
  const [activeTab, setActiveTab] = useState('user'); // 'user' or 'driver'
  const [mode, setMode] = useState('login'); // 'login' or 'signup'
  
  // Form Inputs
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [location, setLocation] = useState('');

  // --- WebSocket Connection ---
  const connectWebSocket = (userId) => {
    if (ws.current) ws.current.close();
    ws.current = new WebSocket(NOTIFY_SERVER);
    
    ws.current.onopen = () => {
        console.log('Connected to Notification Server');
        ws.current.send(JSON.stringify({ type: 'register', id: `client_${userId}` }));
    };

    ws.current.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      setNotifications(prev => [msg, ...prev]);
      // Auto-remove notification after 5 seconds to keep UI clean
      setTimeout(() => setNotifications(prev => prev.filter(n => n !== msg)), 5000);
    };
  };

  // --- Login Handler ---
  const handleLogin = async () => {
    if (!email || !password) return alert("Please fill all fields");

    try {
      const res = await fetch(`${AUTH_SERVER}/api/login`, {
        method: 'POST', 
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({email, password})
      });
      const data = await res.json();
      if(!res.ok) throw new Error(data.error);
      
      const loggedInRole = data.user.role; 

      // Role Mismatch Guard
      if (activeTab === 'driver' && loggedInRole !== 'driver') {
          return alert("🛑 Access Denied: This is a Passenger account. Please switch tabs.");
      }
      if (activeTab === 'user' && loggedInRole === 'driver') {
          return alert("🛑 Access Denied: This is a Driver account. Please switch tabs.");
      }

      setUser(data.user); 
      setToken(data.token);
      connectWebSocket(data.user.user_id);
    } catch(e) { alert(e.message); }
  };

  // --- Signup Handler (UPDATED) ---
  const handleSignup = async () => {
    // 1. Validate Basic Fields
    if (!email || !password || !name) return alert("Please fill required fields");
    
    // 2. Validate Driver Specific Fields
    if (activeTab === 'driver') {
        if (!vehicleId || !location || !contactNumber) return alert("Drivers need Vehicle ID, Location and Contact Number.");
    }

    const roleToAssign = activeTab === 'driver' ? 'driver' : 'user';

    // 3. Construct Payload matching Backend keys exactly (snake_case)
    const payload = { 
        name, 
        email, 
        password, 
        role: roleToAssign,
        // Backend expects these specific keys for drivers:
        vehicle_id: vehicleId,
        contact_number: contactNumber,
        location: location
    };

    try {
      // 4. Single Request to Auth Server
      // The backend now handles creating the User AND the Driver Profile in one go.
      const res = await fetch(`${AUTH_SERVER}/api/signup`, {
        method: 'POST', 
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
      
      const data = await res.json();
      if(!res.ok) throw new Error(data.error || "Signup failed");

      alert(activeTab === 'driver' 
        ? "Driver Account Created Successfully! Please log in." 
        : "Passenger Account Created Successfully! Please log in."
      );
      
      setMode('login');
      
      // Clear sensitive fields
      setPassword('');
      
    } catch(e) { 
        alert(e.message); 
    }
  };

  const handleLogout = () => {
    setUser(null); setToken(null);
    if(ws.current) ws.current.close();
  };

  // ==========================================
  // VIEW: LOGIN / SIGNUP SCREEN
  // ==========================================
  if (!user) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <style>{customStyles}</style>
        <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden fade-in">
          
          <div className="bg-gray-50 border-b border-gray-100 flex">
              <button 
                onClick={() => { setActiveTab('user'); setMode('login'); }}
                className={`flex-1 py-4 text-sm font-bold flex items-center justify-center gap-2 transition ${activeTab === 'user' ? 'bg-white text-black border-b-2 border-black' : 'text-gray-400 hover:text-gray-600'}`}
              >
                  <User size={18}/> Passenger
              </button>
              <button 
                onClick={() => { setActiveTab('driver'); setMode('login'); }}
                className={`flex-1 py-4 text-sm font-bold flex items-center justify-center gap-2 transition ${activeTab === 'driver' ? 'bg-white text-black border-b-2 border-black' : 'text-gray-400 hover:text-gray-600'}`}
              >
                  <Briefcase size={18}/> Driver
              </button>
          </div>

          <div className="p-8">
            <h1 className="text-3xl font-extrabold text-center mb-2">Uber-Friends</h1>
            <p className="text-center text-gray-500 mb-8 text-sm">
                {activeTab === 'driver' ? 'Partner with us and earn.' : 'Get a ride in minutes.'}
            </p>

            <div className="space-y-4">
                {mode === 'signup' && (
                    <div className="animate-slide-in space-y-4">
                        <input className="w-full bg-gray-100 p-3 rounded-lg outline-none focus:ring-2 focus:ring-black transition" placeholder="Full Name" value={name} onChange={e=>setName(e.target.value)} />
                        {activeTab === 'driver' && (
                            <>
                                <input className="w-full bg-gray-100 p-3 rounded-lg outline-none focus:ring-2 focus:ring-black transition" placeholder="Vehicle ID (e.g. KA-01-AB-1234)" value={vehicleId} onChange={e=>setVehicleId(e.target.value)} />
                                <input className="w-full bg-gray-100 p-3 rounded-lg outline-none focus:ring-2 focus:ring-black transition" placeholder="Contact Number" value={contactNumber} onChange={e=>setContactNumber(e.target.value)} />
                                <input className="w-full bg-gray-100 p-3 rounded-lg outline-none focus:ring-2 focus:ring-black transition" placeholder="Location (City/Area)" value={location} onChange={e=>setLocation(e.target.value)} />
                            </>
                        )}
                    </div>
                )}
                
                <input className="w-full bg-gray-100 p-3 rounded-lg outline-none focus:ring-2 focus:ring-black transition" placeholder="Email Address" value={email} onChange={e=>setEmail(e.target.value)} />
                <input className="w-full bg-gray-100 p-3 rounded-lg outline-none focus:ring-2 focus:ring-black transition" type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} />
                
                {mode === 'login' ? (
                    <button onClick={handleLogin} className="w-full bg-black text-white py-3 rounded-lg font-bold text-lg hover:bg-gray-800 transition transform active:scale-95">
                        Log in as {activeTab === 'driver' ? 'Driver' : 'Passenger'}
                    </button>
                ) : (
                    <button onClick={handleSignup} className="w-full bg-green-600 text-white py-3 rounded-lg font-bold text-lg hover:bg-green-700 transition transform active:scale-95">
                        Sign Up to {activeTab === 'driver' ? 'Drive' : 'Ride'}
                    </button>
                )}

                <div className="text-center mt-4">
                    <button onClick={() => setMode(mode === 'login' ? 'signup' : 'login')} className="text-sm font-bold text-gray-600 hover:text-black transition">
                        {mode === 'login' ? "Don't have an account? Sign Up" : "Already have an account? Log In"}
                    </button>
                </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW: LOGGED IN (MAIN APP)
  // ==========================================
  return (
    <div className="min-h-screen bg-gray-100">
      <style>{customStyles}</style>

      {/* Header */}
      <div className="bg-black text-white p-4 sticky top-0 bottom-0 z-50 shadow-md">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
              <div className="bg-white text-black p-1.5 rounded font-bold text-xs tracking-tighter">UF</div>
              <h1 className="text-lg font-bold tracking-tight">Uber-Friends <span className="font-normal text-gray-400 text-xs ml-2 border-l border-gray-600 pl-2 uppercase tracking-widest">{user.role} Portal</span></h1>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right hidden sm:block">
              <span className="block text-sm font-bold">{user.name}</span>
              <span className="block text-xs text-gray-400 uppercase">{user.role}</span>
            </div>
            <button onClick={handleLogout} className="bg-gray-800 p-2 rounded-full hover:bg-red-600 transition flex items-center gap-2 px-4">
              <LogOut size={16}/> <span className="text-xs font-bold">LOGOUT</span>
            </button>
          </div>
        </div>
      </div>

      {/* Notifications */}
      <div className="fixed top-24 right-4 z-50 space-y-2 w-80 pointer-events-none">
        {notifications.map((n, i) => (
           <div key={i} className="bg-blue-600 text-white p-4 rounded-lg shadow-xl animate-slide-in pointer-events-auto flex items-start gap-3">
             <div className="mt-1"><Car size={16}/></div>
             <div>
                 <p className="font-bold text-xs uppercase mb-1 opacity-80">{n.type}</p>
                 <p className="text-sm font-medium">{n.message}</p>
             </div>
           </div>
        ))}
      </div>

      {/* Dashboard Switcher */}
      <div className="max-w-7xl mx-auto p-4 md:p-2">
        {user.role === 'driver' ? (
          <DriverDashboard 
            user={user} 
            token={token} 
            logout={handleLogout} 
            lastNotification={notifications[0]} 
          />
        ) : (
          <PassengerDashboard 
            user={user} 
            token={token} 
            logout={handleLogout}
            lastNotification={notifications[0]} 
          />
        )}
      </div>
    </div>
  );
};

export default UberFriendsApp;