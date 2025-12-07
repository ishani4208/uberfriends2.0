import React, { useState, useEffect } from 'react';
import { 
  MapPin, CheckCircle, History, Car, Navigation, DollarSign, X, ChevronRight 
} from 'lucide-react';
import driverimage from "../assets/driverpic.jpg";

const DRIVER_SERVER = 'http://localhost:8080';

const customStyles = `
  @keyframes slide-in { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  .animate-slide-up { animation: slide-in 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
  
  @keyframes slide-in-right { from { transform: translateX(50px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  .animate-slide-in-right { animation: slide-in-right 0.4s ease-out; }

  .custom-scrollbar::-webkit-scrollbar { width: 6px; }
  .custom-scrollbar::-webkit-scrollbar-thumb { background: #ccc; border-radius: 10px; }
  .fade-in { animation: fadeIn 0.5s; }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  .pulse-ring { animation: pulse-ring 2s infinite; }
  @keyframes pulse-ring { 
    0% { box-shadow: 0 0 0 0 rgba(0, 0, 0, 0.7); } 
    70% { box-shadow: 0 0 0 20px rgba(0, 0, 0, 0); } 
    100% { box-shadow: 0 0 0 0 rgba(0, 0, 0, 0); } 
  }
  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
  .blink-dot {
    animation: blink 1.5s ease-in-out infinite;
  }
  .hero-circle {
    width: 220px;
    height: 220px;
    background: linear-gradient(135deg, #e0e0e0 0%, #f5f5f5 100%);
    border-radius: 50%;
    box-shadow: inset 0 8px 24px rgba(0,0,0,0.1);
    flex-shrink: 0;
  }
  .layout-transition {
    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  }
`;

const DriverDashboard = ({ user, token, lastNotification }) => {
  const [status, setStatus] = useState('offline');
  const [stats, setStats] = useState({ 
    total: 0, 
    completed: 0, 
    cancelled: 0,
    earnings: 0 
  });
  const [activeJob, setActiveJob] = useState(null);
  const [rides, setRides] = useState([]);
  const [showAcceptModal, setShowAcceptModal] = useState(false);
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const fetchDriverData = async () => {
    try {
      console.log("Fetching driver data...");
      
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
        }, { total: 0, completed: 0, cancelled: 0, earnings: 0 });
        
        // Fetch real earnings
        const statsRes = await fetch(`${DRIVER_SERVER}/driver/stats`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const statsData = await statsRes.json();
        
        if (statsData.success) {
          newStats.earnings = statsData.stats.total_earnings;
        }
        
        setStats(newStats);
      }
    } catch (e) { console.error("Driver fetch error:", e); }
  };

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
      setShowProgressModal(false);
      fetchDriverData();
    } catch (e) { alert("Error completing ride"); }
  };

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
            setShowProgressModal(false);
            setStatus('available');
            fetchDriverData();
        } catch (e) { alert("Error rejecting ride"); }
    } else {
        setShowAcceptModal(false);
    }
  };

  const getStatusDisplay = () => {
    if (activeJob) {
      return { 
        bg: 'bg-green-500', 
        text: 'Ride In Progress',
        color: 'text-white',
        showBlink: true
      };
    }
    if (status === 'available') {
      return { 
        bg: 'bg-yellow-400', 
        text: 'Online',
        color: 'text-black',
        showBlink: false
      };
    }
    return { 
      bg: 'bg-red-500', 
      text: 'Offline',
      color: 'text-white',
      showBlink: false
    };
  };

  const statusDisplay = getStatusDisplay();

  return (
    <div>
      <style>{customStyles}</style>
      
      {showAcceptModal && activeJob && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end sm:justify-center items-center bg-black bg-opacity-90 backdrop-blur-sm p-4">
            <div className="bg-white w-full max-w-sm rounded-3xl overflow-hidden shadow-2xl animate-slide-up border-4 border-black">
                <div className="bg-black p-6 text-center relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-green-500 to-transparent animate-pulse"></div>
                    <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mx-auto mb-4 pulse-ring relative z-10">
                        <Car size={40} className="text-black"/>
                    </div>
                    <h2 className="text-white font-black text-3xl tracking-tighter">NEW REQUEST</h2>
                    <p className="text-green-400 font-bold text-sm uppercase tracking-widest mt-1">4 MIN AWAY</p>
                </div>
                
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

      {showProgressModal && activeJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden border-4 border-black animate-slide-up">
            <div className="bg-gray-900 text-white p-4 flex justify-between items-center">
              <h2 className="font-bold flex items-center gap-2 text-lg">
                <Navigation/> IN PROGRESS
              </h2>
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => setShowProgressModal(false)}
                  className="text-white hover:text-gray-300 text-2xl leading-none"
                >
                  ×
                </button>
              </div>
            </div>
            
            <div className="p-8">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center font-bold text-2xl">
                  {activeJob.passenger_name[0]}
                </div>
                <div>
                  <h3 className="text-2xl font-bold">{activeJob.passenger_name}</h3>
                  <p className="text-gray-500">Passenger</p>
                </div>
              </div>
              
              <div className="space-y-6 mb-8">
                <div className='flex gap-4'>
                  <div className='mt-1'><MapPin className='text-gray-400' size={20} /></div>
                  <div>
                    <p className="text-xs text-gray-400 font-bold mb-1">PICKUP</p>
                    <p className="text-xl font-medium">{activeJob.source_location}</p>
                  </div>
                </div>
                <div className='flex gap-4'>
                  <div className='mt-1'><MapPin className='text-black' size={20} /></div>
                  <div>
                    <p className="text-xs text-gray-400 font-bold mb-1">DROPOFF</p>
                    <p className="text-xl font-medium">{activeJob.dest_location}</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <button 
                  onClick={completeRide} 
                  className="bg-green-600 hover:bg-green-700 text-white py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition"
                >
                  <CheckCircle/> COMPLETE
                </button>
                <button 
                  onClick={() => {
                    if(window.confirm("Cancel this ride?")) handleDecision('reject');
                  }} 
                  className="bg-gray-100 hover:bg-red-50 text-red-600 border-2 border-red-100 py-4 rounded-xl font-bold text-lg transition"
                >
                  CANCEL
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-11xl mx-auto px-3 py-3">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-40 transition-all duration-500">
          
          <div className={`${showHistory ? 'lg:col-span-2' : 'lg:col-span-3'} space-y-2 layout-transition`}>
            
            <div className="relative overflow-hidden flex items-center justify-between" style={{minHeight: '380px'}}>
              <div className="relative z-10 max-w-2xl px-10">
                <h1 className="text-5xl font-black mb-4 leading-tight text-gray-900">
                  Good Morning 
                  <span className="text-gray-400 px-3">{user?.name}.</span>
                </h1>
                <p className="text-green-600 font-bold text-lg px-3 py-3">
                  Get The Fastest Bookings Near You
                </p>
              </div>
              
              <div className="hero-circle flex items-center justify-center mr-10 overflow-hidden relative shadow-inner">
                <img
                  src={driverimage} 
                  alt="Ride Illustration"
                  className="w-full h-full object-cover opacity-90" 
                />
              </div>

              <div className="absolute top-1 right-6 z-20 flex items-center gap-3">
                <button 
                    onClick={() => setShowHistory(!showHistory)}
                    className={`px-4 py-2.5 rounded-full font-bold text-sm flex items-center gap-2 shadow-md transition-all border border-gray-200
                        ${showHistory ? 'bg-black text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                >
                    <History size={16}/> {showHistory ? 'Hide History' : 'History'}
                </button>

                <button
                    onClick={() => {
                    if (!activeJob) {
                        updateStatus(status === 'offline' ? 'available' : 'offline');
                    } else {
                        setShowProgressModal(true);
                    }
                    }}
                    className={`${statusDisplay.bg} ${statusDisplay.color} px-5 py-2.5 rounded-full font-bold text-sm flex items-center gap-2 shadow-lg hover:scale-105 transition-transform cursor-pointer`}
                >
                    <div className={`w-2.5 h-2.5 rounded-full bg-white ${statusDisplay.showBlink ? 'blink-dot' : ''}`}></div>
                    {statusDisplay.text}
                </button>
              </div>
            </div>

            <h2 className="text-4xl font-black text-gray-900"></h2>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="group bg-white rounded-3xl p-8 border border-gray-100 shadow-sm flex flex-col items-center justify-center gap-3 transition-all duration-500 hover:bg-black hover:border-black hover:shadow-2xl hover:-translate-y-1 cursor-default relative overflow-hidden">
                    <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-2 group-hover:bg-gray-800 transition-colors">
                        <Car size={32} className="text-gray-400 group-hover:text-white" />
                    </div>
                    <h3 className="text-gray-400 font-bold text-sm tracking-wide group-hover:text-gray-400">TOTAL RIDES</h3>
                    <p className="text-5xl font-black text-gray-900 group-hover:text-white transition-colors tracking-tight">{stats.total}</p>
                </div>

                <div className="group bg-white rounded-3xl p-8 border border-gray-100 shadow-sm flex flex-col items-center justify-center gap-3 transition-all duration-500 hover:bg-black hover:border-black hover:shadow-2xl hover:-translate-y-1 cursor-default relative overflow-hidden">
                    <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-2 group-hover:bg-gray-800 transition-colors">
                        <CheckCircle size={32} className="text-gray-400 group-hover:text-white" />
                    </div>
                    <h3 className="text-gray-400 font-bold text-sm tracking-wide group-hover:text-gray-400">COMPLETED</h3>
                    <p className="text-5xl font-black text-gray-900 group-hover:text-white transition-colors tracking-tight">{stats.completed}</p>
                </div>

                <div className="group bg-white rounded-3xl p-8 border border-gray-100 shadow-sm flex flex-col items-center justify-center gap-3 transition-all duration-500 hover:bg-black hover:border-black hover:shadow-2xl hover:-translate-y-1 cursor-default relative overflow-hidden">
                    <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-2 group-hover:bg-gray-800 transition-colors">
                        <DollarSign size={32} className="text-gray-400 group-hover:text-white" />
                    </div>
                    <h3 className="text-gray-400 font-bold text-sm tracking-wide group-hover:text-gray-400">EARNINGS</h3>
                    <p className="text-5xl font-black text-gray-900 group-hover:text-white transition-colors tracking-tight">
                        ₹{stats.earnings.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                </div>
            </div>
        </div>

        {showHistory && (
            <div className="lg:col-span-1 animate-slide-in-right">
                <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-6 flex flex-col h-[600px] relative overflow-hidden">
                    
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-gray-200 via-gray-400 to-gray-200 opacity-50"></div>
                    
                    <div className="flex justify-between items-center mb-6 shrink-0">
                        <div>
                            <h3 className="font-black text-xl text-gray-900">Ride History</h3>
                            <p className="text-gray-400 text-xs font-bold mt-1">LAST 30 DAYS</p>
                        </div>
                        <button onClick={() => setShowHistory(false)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors">
                            <X size={18} className="text-gray-500" />
                        </button>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-4">
                        {rides.map(r => (
                            <div key={r.ride_id} className="group p-4 rounded-2xl border border-gray-100 hover:border-gray-300 hover:shadow-lg bg-white transition-all cursor-default">
                                <div className="flex justify-between items-start mb-3">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center font-bold text-gray-600 group-hover:bg-black group-hover:text-white transition-colors">
                                            {r.passenger_name[0]}
                                        </div>
                                        <div>
                                            <p className="font-bold text-sm text-gray-900">{r.passenger_name}</p>
                                            <p className="text-xs text-gray-400 font-medium">
                                                {new Date(r.created_at).toLocaleDateString('en-IN')}
                                            </p>
                                        </div>
                                    </div>
                                    <span className="font-bold text-sm text-gray-900">
                                        ₹{r.estimated_fare ? r.estimated_fare.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                                    </span>
                                </div>
                                
                                <div className="space-y-2 pl-3 border-l-2 border-gray-100 ml-5 relative">
                                    <div className="flex items-center gap-2 text-xs text-gray-500">
                                        <div className="w-2 h-2 bg-gray-300 rounded-full absolute -left-[5px] top-1"></div>
                                        <span className="truncate">{r.source_location}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-gray-500">
                                        <div className="w-2 h-2 bg-black rounded-full absolute -left-[5px] bottom-1"></div>
                                        <span className="truncate">{r.dest_location}</span>
                                    </div>
                                </div>

                                <div className="mt-4 pt-3 border-t border-gray-50 flex justify-between items-center">
                                    <span className={`text-[10px] px-2 py-1 rounded-full font-bold uppercase ${
                                        r.status === 'completed' ? 'bg-green-100 text-green-700' : 
                                        r.status === 'assigned' ? 'bg-yellow-100 text-yellow-700' :
                                        'bg-red-100 text-red-700'
                                    }`}>
                                        {r.status}
                                    </span>
                                    {r.distance_km && (
                                        <span className="text-xs text-gray-400 font-medium">
                                            {r.distance_km} km
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                    
                </div>
            </div>
        )}
        </div>
      </div>
    </div>
  );
};

export default DriverDashboard;