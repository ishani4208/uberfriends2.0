import React, { useState, useEffect } from 'react';
import { 
  MapPin, CheckCircle, History, Car, Navigation 
} from 'lucide-react';

// ✅ CRITICAL FIX: Define these constants inside this file
const DRIVER_SERVER = 'http://localhost:8080';

// ✅ FIX: Add styles here so animations work
const customStyles = `
  @keyframes slide-in { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  .animate-slide-up { animation: slide-in 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
  .custom-scrollbar::-webkit-scrollbar { width: 6px; }
  .custom-scrollbar::-webkit-scrollbar-thumb { background: #ccc; border-radius: 10px; }
  .fade-in { animation: fadeIn 0.5s; }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  .pulse-ring { animation: pulse-ring 2s infinite; }
  @keyframes pulse-ring { 0% { box-shadow: 0 0 0 0 rgba(0, 0, 0, 0.7); } 70% { box-shadow: 0 0 0 20px rgba(0, 0, 0, 0); } 100% { box-shadow: 0 0 0 0 rgba(0, 0, 0, 0); } }
`;

const DriverDashboard = ({ user, token, logout, lastNotification }) => {
  const [status, setStatus] = useState('offline');
  const [stats, setStats] = useState({ total: 0, completed: 0, cancelled: 0 });
  const [activeJob, setActiveJob] = useState(null);
  const [rides, setRides] = useState([]);
  const [showAcceptModal, setShowAcceptModal] = useState(false);
  
  // 1. Fetch Current Ride & History
  const fetchDriverData = async () => {
    try {
      console.log("Fetching driver data..."); // Debug log
      const statusRes = await fetch(`${DRIVER_SERVER}/driver/stats`, {
          headers: { 'Authorization': `Bearer ${token}` }
      });
      const statusData = await statusRes.json();
      if (statusData.stats?.current_status) {
          setStatus(statusData.stats.current_status);
      }
      const rideRes = await fetch(`${DRIVER_SERVER}/driver/current-ride`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const rideData = await rideRes.json();
      setActiveJob(rideData.hasActiveRide ? rideData.ride : null);

      const histRes = await fetch(`${DRIVER_SERVER}/driver/rides`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const histData = await histRes.json();
      
      if (histData.rides) {
        setRides(histData.rides);
        const newStats = histData.rides.reduce((acc, r) => {
          acc.total++;
          if (r.status === 'completed') acc.completed++;
          if (r.status === 'cancelled') acc.cancelled++;
          return acc;
        }, { total: 0, completed: 0, cancelled: 0 });
        setStats(newStats);
      }
    } catch (e) { console.error("Driver fetch error:", e); }
  };

  useEffect(() => {
    fetchDriverData();
}, []);

  // ✅ REAL-TIME INVITE LISTENER
  useEffect(() => { 
    if (lastNotification?.type === 'ride_assigned') {
        console.log("New Ride Assigned!", lastNotification);
        fetchDriverData().then(() => {
            setShowAcceptModal(true); 
        });
    } else {
        fetchDriverData(); 
    }
  }, [lastNotification]);

  // 2. Update Status
  const updateStatus = async (newStatus) => {
    try {
      await fetch(`${DRIVER_SERVER}/driver/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ status: newStatus })
      });
      setStatus(newStatus);
    } catch (e) { alert(e.message); }
  };

  // 3. Complete Ride
  const completeRide = async () => {
    if (!activeJob) return;
    try {
      const res = await fetch(`${DRIVER_SERVER}/driver/complete-ride/${activeJob.ride_id}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to complete");
      
      alert('Ride Completed');
      setActiveJob(null);
      setStatus('available'); 
      fetchDriverData();
    } catch (e) { alert("Error completing ride"); }
  };

  // 4. Reject / Cancel Ride
  const handleDecision = async (decision) => {
    if (!activeJob) return;

    if (decision === 'reject') {
        try {
            await fetch(`${DRIVER_SERVER}/driver/rides/${activeJob.ride_id}/cancel`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ reason: "Driver rejected invite" })
            });
            setActiveJob(null);
            setShowAcceptModal(false);
            setStatus('available');
            fetchDriverData();
        } catch (e) { alert("Error rejecting ride"); }
    } else {
        setShowAcceptModal(false);
    }
  };

  return (
    <div className="space-y-6 fade-in relative">
      <style>{customStyles}</style>
      
      {/* 🚨 DRIVER INVITE MODAL */}
      {showAcceptModal && activeJob && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end sm:justify-center items-center bg-black bg-opacity-90 backdrop-blur-sm p-4">
            <div className="bg-white w-full max-w-sm rounded-3xl overflow-hidden shadow-2xl animate-slide-up border-4 border-black">
                {/* Header */}
                <div className="bg-black p-6 text-center relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-green-500 to-transparent animate-pulse"></div>
                    <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mx-auto mb-4 pulse-ring relative z-10">
                        <Car size={40} className="text-black"/>
                    </div>
                    <h2 className="text-white font-black text-3xl tracking-tighter">NEW REQUEST</h2>
                    <p className="text-green-400 font-bold text-sm uppercase tracking-widest mt-1">4 MIN AWAY</p>
                </div>
                
                {/* Body */}
                <div className="p-6 space-y-6 bg-gray-50">
                    <div className="text-center">
                        <h3 className="text-2xl font-bold text-gray-900">{activeJob.passenger_name}</h3>
                        <div className="flex justify-center items-center gap-1 text-black mt-1 bg-yellow-400 w-fit mx-auto px-2 py-0.5 rounded-full text-xs font-bold shadow-sm">
                            <span>★ 5.0</span>
                        </div>
                    </div>

                    <div className="space-y-0 relative border-l-2 border-dashed border-gray-300 ml-4 pl-6 py-2">
                        <div className="absolute top-0 -left-1.5 w-3 h-3 bg-gray-400 rounded-full"></div>
                        <div className="absolute bottom-0 -left-1.5 w-3 h-3 bg-black rounded-full"></div>
                        
                        <div className="mb-6">
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">PICKUP</p>
                            <p className="font-bold text-gray-800 text-lg leading-tight">{activeJob.source_location}</p>
                        </div>
                        <div>
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">DROPOFF</p>
                            <p className="font-bold text-gray-800 text-lg leading-tight">{activeJob.dest_location}</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-2">
                        <button 
                            onClick={() => handleDecision('reject')}
                            className="py-4 rounded-xl font-bold text-lg bg-white border-2 border-gray-200 text-gray-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition"
                        >
                            DECLINE
                        </button>
                        <button 
                            onClick={() => handleDecision('accept')}
                            className="py-4 rounded-xl font-bold text-lg bg-black text-white hover:bg-gray-800 transition shadow-lg transform active:scale-95 flex items-center justify-center gap-2"
                        >
                            ACCEPT <CheckCircle size={20}/>
                        </button>
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* 1. Status Header */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <h3 className="text-gray-500 font-medium text-sm">STATUS</h3>
          <div className="flex items-center gap-2 mt-2">
            <div className={`w-3 h-3 rounded-full ${status === 'available' ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></div>
            <span className="text-2xl font-bold capitalize">{status}</span>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={() => updateStatus('available')} className={`flex-1 py-2 text-xs font-bold rounded ${status === 'available' ? 'bg-black text-white' : 'bg-gray-100'}`}>ONLINE</button>
            <button onClick={() => updateStatus('offline')} className={`flex-1 py-2 text-xs font-bold rounded ${status === 'offline' ? 'bg-black text-white' : 'bg-gray-100'}`}>OFFLINE</button>
          </div>
        </div>
        
        {/* Stats */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <h3 className="text-gray-500 font-medium text-sm">TOTAL RIDES</h3>
          <p className="text-3xl font-bold mt-2">{stats.total}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <h3 className="text-gray-500 font-medium text-sm">COMPLETED</h3>
          <p className="text-3xl font-bold mt-2 text-green-600">{stats.completed}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <h3 className="text-gray-500 font-medium text-sm">EARNINGS</h3>
          <p className="text-3xl font-bold mt-2 text-blue-600">${stats.completed * 20}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 2. Active Job Area */}
        <div className="lg:col-span-2">
          {activeJob && !showAcceptModal ? (
            <div className="bg-white rounded-xl shadow-lg border-2 border-black overflow-hidden">
              <div className="bg-black text-white p-4 flex justify-between items-center">
                <h2 className="font-bold flex items-center gap-2"><Navigation/> IN PROGRESS</h2>
                <span className="bg-green-500 text-black text-xs font-bold px-2 py-1 rounded uppercase">{activeJob.status}</span>
              </div>
              <div className="p-6">
                <div className="flex items-center gap-4 mb-6">
                    <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center font-bold text-lg">{activeJob.passenger_name[0]}</div>
                    <div>
                        <h3 className="text-xl font-bold">{activeJob.passenger_name}</h3>
                        <p className="text-gray-500 text-sm">Passenger</p>
                    </div>
                </div>
                
                <div className="space-y-4 mb-8">
                  <div className='flex gap-4'>
                    <div className='mt-1'><MapPin className='text-gray-400' size={18} /></div>
                    <div>
                        <p className="text-xs text-gray-400 font-bold">PICKUP</p>
                        <p className="text-lg font-medium">{activeJob.source_location}</p>
                    </div>
                  </div>
                  <div className='flex gap-4'>
                    <div className='mt-1'><MapPin className='text-black' size={18} /></div>
                    <div>
                        <p className="text-xs text-gray-400 font-bold">DROPOFF</p>
                        <p className="text-lg font-medium">{activeJob.dest_location}</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <button onClick={completeRide} className="bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-bold flex items-center justify-center gap-2"><CheckCircle/> COMPLETE</button>
                  <button onClick={() => {
                      if(window.confirm("Cancel this ride?")) handleDecision('reject');
                  }} className="bg-gray-100 hover:bg-red-50 text-red-600 border border-red-100 py-3 rounded-lg font-bold">CANCEL</button>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center h-full flex flex-col justify-center items-center">
              <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                  <Car size={40} className="text-gray-400"/>
              </div>
              <h2 className="text-xl font-bold text-gray-800">No Active Job</h2>
              <p className="text-gray-500 mt-2">
                  {status === 'available' ? 'Searching for nearby requests...' : 'Go Online to start receiving jobs.'}
              </p>
            </div>
          )}
        </div>

        {/* 3. History Sidebar */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 h-[500px] flex flex-col">
          <h3 className="font-bold mb-4 flex items-center gap-2"><History size={20}/> History</h3>
          <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar pr-2">
            {rides.map(r => (
              <div key={r.ride_id} className="p-3 bg-gray-50 rounded-lg border border-gray-100 text-sm hover:bg-gray-100 transition">
                <div className="flex justify-between font-bold mb-1">
                  <span>{r.passenger_name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded uppercase ${r.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{r.status}</span>
                </div>
                <div className="text-gray-500 text-xs">
                  {r.source_location} ➝ {r.dest_location}
                </div>
              </div>
            ))}
            {rides.length === 0 && <p className="text-gray-400 text-center text-sm mt-10">No ride history.</p>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DriverDashboard;