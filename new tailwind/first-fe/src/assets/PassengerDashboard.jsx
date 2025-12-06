import React, { useState, useEffect } from 'react';
import { 
  MapPin, Home, Users, History, Car, Plus, X, 
  Calendar, Clock, User, Navigation, RefreshCw,
  Filter, ChevronLeft, ChevronRight, CheckCircle, XCircle, AlertCircle
} from 'lucide-react';

// ✅ CHANGE 1: Correctly import the image
// Adjust the path ('../assets/' vs './assets/') based on your folder structure
import RideHeroImg from '../assets/Frame 16 (1).png'; 

const API_SERVER = 'http://localhost:8000'; 

const PassengerDashboard = ({ user, token, logout, lastNotification }) => {
  const [view, setView] = useState('book'); 
  const [source, setSource] = useState('');
  const [dest, setDest] = useState('');
  
  // Data States
  const [currentRide, setCurrentRide] = useState(null);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // HISTORY SPECIFIC STATES
  const [history, setHistory] = useState([]);
  const [historyStats, setHistoryStats] = useState(null);
  const [historyFilter, setHistoryFilter] = useState('all'); 
  const [historyPage, setHistoryPage] = useState(0);
  const [pagination, setPagination] = useState({ total: 0, limit: 10 });
  const [historyLoading, setHistoryLoading] = useState(false);

  // Meetup Modal State
  const [showMeetupModal, setShowMeetupModal] = useState(false);
  const [meetupLoc, setMeetupLoc] = useState('');
  const [meetupEmails, setMeetupEmails] = useState('');
  const [meetupSource, setMeetupSource] = useState('');

  // ==========================================
  // 1. DATA FETCHING
  // ==========================================
  const fetchPassengerData = async () => {
    setLoading(true);
    try {
      const rideRes = await fetch(`${API_SERVER}/rides/current`, { 
          headers: { 'Authorization': `Bearer ${token}` } 
      });
      const rideData = await rideRes.json();
      if(rideData.hasActiveRide) setCurrentRide(rideData.ride);
      else setCurrentRide(null);

      const invRes = await fetch(`${API_SERVER}/meetups/invites/pending`, { 
          headers: { 'Authorization': `Bearer ${token}` } 
      });
      const invData = await invRes.json();
      if(invData.invites) setInvites(invData.invites);

      if (view === 'history') {
        fetchHistory();
        fetchHistoryStats();
      }

    } catch(e) { 
        console.error("Data sync error:", e); 
    } finally {
        setLoading(false);
    }
  };

  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
        const offset = historyPage * pagination.limit;
        let url = `${API_SERVER}/rides/history?limit=${pagination.limit}&offset=${offset}`;
        if (historyFilter !== 'all') {
            url += `&status=${historyFilter}`;
        }
        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success) {
            setHistory(data.rides);
            setPagination(prev => ({ ...prev, total: data.pagination.total }));
        }
    } catch (error) {
        console.error("History fetch error", error);
    } finally {
        setHistoryLoading(false);
    }
  };

  const fetchHistoryStats = async () => {
      try {
          const res = await fetch(`${API_SERVER}/rides/stats`, {
              headers: { 'Authorization': `Bearer ${token}` }
          });
          const data = await res.json();
          if (data.success) setHistoryStats(data.summary);
      } catch (error) {
          console.error("Stats error", error);
      }
  };

  // ==========================================
  // 2. EFFECTS
  // ==========================================
  useEffect(() => { fetchPassengerData(); }, []);

  useEffect(() => {
    if (lastNotification) {
        fetchPassengerData();
        // ✅ ADD: Type-specific user feedback
        if (lastNotification.type === 'ride_completed') {
            alert('🎉 Your ride has been completed!');
        } else if (lastNotification.type === 'ride_cancelled_by_driver') {
            alert('⚠️ Your driver cancelled. Finding another driver...');
        } else if (lastNotification.type === 'meetup_cancelled') {
            alert('❌ The meetup has been cancelled by the organizer.');
        }
    }
}, [lastNotification]);


  useEffect(() => {
      if (view === 'history') {
          fetchHistory();
          fetchHistoryStats(); 
      }
  }, [view, historyPage, historyFilter]);

  // ==========================================
  // 3. ACTION HANDLERS
  // ==========================================
  const handleRespondInvite = async (inviteId, response, sourceLocation = null) => {
    try {
        const payload = { response };
        if (response === 'accepted') {
            if (!sourceLocation) return alert("Source location is required!");
            payload.source_location = sourceLocation;
        }

        const res = await fetch(`${API_SERVER}/meetups/invites/${inviteId}/respond`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            await fetchPassengerData();
            if (response === 'accepted') setView('dashboard');
        }
    } catch (error) { alert("Network error"); }
  };

  const bookRide = async () => {
    try {
      const res = await fetch(`${API_SERVER}/book-ride`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ source_location: source, dest_location: dest })
      });
      if(res.ok) {
        setSource(''); setDest('');
        await fetchPassengerData();
        setView('dashboard');
      } else {
          const d = await res.json();
          alert(d.error);
      }
    } catch(e) { alert("Booking failed"); }
  };

  const cancelRide = async (id) => {
    if(!window.confirm("Cancel ride?")) return;
    try {
        await fetch(`${API_SERVER}/rides/${id}/cancel`, { 
            method: 'DELETE', 
            headers: { 'Authorization': `Bearer ${token}` } 
        });
        await fetchPassengerData();
    } catch(e) { alert("Cancellation failed"); }
  };

  const createMeetup = async () => {
    try {
        await fetch(`${API_SERVER}/meetups/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ 
                meetup_location: meetupLoc, 
                invitee_usernames: meetupEmails.split(',').map(e => e.trim()),
                organizer_source_location: meetupSource 
            })
        });
        alert("Meetup Created!");
        setShowMeetupModal(false);
        fetchPassengerData();
        setView('dashboard');
    } catch(e) { alert("Error creating meetup"); }
  };

  const getStatusColor = (status) => {
      switch(status) {
          case 'completed': return 'bg-green-100 text-green-700 border-green-200';
          case 'cancelled': return 'bg-red-100 text-red-700 border-red-200';
          case 'assigned': return 'bg-blue-100 text-blue-700 border-blue-200';
          case 'pending': return 'bg-yellow-100 text-yellow-700 border-yellow-200';
          default: return 'bg-gray-100 text-gray-700 border-gray-200';
      }
  };

  // ==========================================
  // 4. UI RENDER
  // ==========================================
  return (
    <div className="flex flex-col fade-in h-[calc(100vh-100px)]">
      
      {/* Top Navigation Bar */}
      <div className='pb-4'>
        <nav className="flex flex-row justify-between lg:justify-start gap-4">
          {[
            { id: 'book', label: 'Book Ride', icon: <MapPin size={18}/> },
            { id: 'dashboard', label: 'Current Ride', icon: <Home size={18}/> },
            { id: 'meetups', label: 'Meetups', icon: <Users size={18}/> },
            { id: 'history', label: 'History', icon: <History size={18}/> }
          ].map(item => (
            <button 
              key={item.id}
              onClick={() => setView(item.id)}
              className={`
                flex-1 px-4 py-3 rounded-lg font-bold text-sm flex items-center justify-center gap-3 transition whitespace-nowrap
                ${view === item.id 
                  ? 'bg-black text-white shadow-md' 
                  : 'text-gray-600 hover:bg-gray-100'
                }
              `}
            >
              {item.icon} 
              <span className="hidden sm:inline">{item.label}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 h-full overflow-hidden flex flex-col">
        {view === 'book' && (
          <div className="flex w-full h-full">
            
            {/* Left Side: Input Form */}
            <div className="w-full lg:w-1/2 p-8 lg:p-12 flex flex-col justify-center">
              
              <h1 className="text-4xl lg:text-5xl font-bold text-gray-900 leading-tight mb-8">
                Request a ride now!
              </h1>
              
              <div className="flex items-center gap-2 mb-6">
                 <div className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs font-bold uppercase">Promo</div>
                 <p className="text-sm font-medium text-gray-600">Best quality rides at lowest cost.</p>
              </div>

              {/* Input Container */}
              <div className="relative mb-8">
                <div className="absolute left-[18px] top-[18px] bottom-[18px] w-0.5 bg-gray-900 z-10 flex flex-col justify-between items-center pointer-events-none">
                   <div className="w-2.5 h-2.5 bg-black rounded-full -ml-[1px]"></div>
                   <div className="w-2.5 h-2.5 bg-black -ml-[1px]"></div>
                </div>

                <div className="space-y-3">
                    <div className="relative">
                        <input 
                            placeholder="Pickup location" 
                            value={source} 
                            onChange={e=>setSource(e.target.value)} 
                            className="w-full bg-gray-100 p-3.5 pl-10 rounded-lg outline-none font-medium placeholder-gray-500 focus:ring-2 focus:ring-black transition"
                        />
                        <Navigation size={16} className="absolute right-4 top-4 text-gray-400 cursor-pointer hover:text-black"/>
                    </div>
                    <div className="relative">
                        <input 
                            placeholder="Dropoff location" 
                            value={dest} 
                            onChange={e=>setDest(e.target.value)} 
                            className="w-full bg-gray-100 p-3.5 pl-10 rounded-lg outline-none font-medium placeholder-gray-500 focus:ring-2 focus:ring-black transition"
                        />
                    </div>
                </div>
              </div>

              <div className="flex gap-4">
                  <button onClick={bookRide} className="flex-1 bg-black text-white py-3.5 rounded-lg font-bold text-lg hover:bg-gray-800 transition">
                    Book Ride
                  </button>
              </div>
            </div>

            {/* Right Side: Hero Image */}
            <div className=" lg:block w-1/2 h-full bg relative overflow-hidden">   
                {/* ✅ CHANGE 2: Use the imported image variable here */}
                <img 
                    src={RideHeroImg} 
                    alt="Ride Illustration" 
                    className="absolute inset-0 w-full h-full object-cover rounded-3xl transition duration-700"
                />
                
            </div>
          </div>
        )}

        {/* ... Rest of the components (Dashboard, Meetups, History) remain exactly the same ... */}
        
        {view === 'dashboard' && (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 max-w-2xl w-full mx-auto my-auto">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2"><Home size={20}/> Current Ride</h2>
            {currentRide ? (
              <div className="bg-green-50 border border-green-200 p-6 rounded-xl animate-slide-up">
                <div className="flex justify-between items-start mb-6 border-b border-green-200 pb-4">
                  <span className="bg-green-200 text-green-900 px-3 py-1 rounded-full text-xs font-bold uppercase animate-pulse">{currentRide.status}</span>
                  {currentRide.driver ? (
                    <div className="text-right text-sm">
                      <p className="font-bold text-lg">{currentRide.driver.driver_name}</p>
                      <p className="text-gray-600">{currentRide.driver.vehicle_id}</p>
                      <p className="text-gray-500 text-xs mt-1">{currentRide.driver.contact_number}</p>
                    </div>
                  ) : (
                      <span className="text-gray-500 text-sm italic">Finding your driver...</span>
                  )}
                </div>
                
                <div className="space-y-4 mb-6 relative">
                    <div className="absolute left-2 top-2 bottom-2 w-0.5 bg-gray-300"></div>
                    <div className="flex gap-4 relative z-10">
                        <div className="w-4 h-4 rounded-full bg-white border-4 border-gray-400 mt-1"></div>
                        <div>
                            <p className="text-xs text-gray-500 font-bold uppercase">PICKUP</p>
                            <p className="font-medium">{currentRide.source_location}</p>
                        </div>
                    </div>
                    <div className="flex gap-4 relative z-10">
                        <div className="w-4 h-4 rounded-full bg-black border-4 border-black mt-1"></div>
                        <div>
                            <p className="text-xs text-gray-500 font-bold uppercase">DROPOFF</p>
                            <p className="font-medium">{currentRide.dest_location}</p>
                        </div>
                    </div>
                </div>

                <button onClick={() => cancelRide(currentRide.ride_id)} className="w-full bg-white text-red-600 border border-red-200 py-3 rounded-lg font-bold hover:bg-red-50 transition">Cancel Ride</button>
              </div>
            ) : (
              <div className="text-center py-12 text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                  <Car size={48} className="mx-auto mb-3 opacity-20"/>
                  <p>No active ride</p>
              </div>
            )}
          </div>
        )}

        {view === 'meetups' && (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 max-w-3xl w-full mx-auto my-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold flex items-center gap-2"><Users size={20}/> Meetups</h2>
              <button onClick={() => setShowMeetupModal(true)} className="bg-black text-white px-4 py-2 rounded-lg font-bold text-sm flex gap-2 hover:bg-gray-800 transition"><Plus size={16}/> Create</button>
            </div>
            
            {invites.length === 0 ? (
                <div className="text-center py-8 text-gray-400 bg-gray-50 rounded-lg">No pending invites</div>
            ) : (
              <div className="space-y-3">
                {invites.map(inv => (
                  <div key={inv.invite_id} className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg">
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="font-bold text-gray-800 text-lg">{inv.organizer_name} invited you!</p>
                            <p className="text-sm text-gray-600 mt-1">Meet at: <strong>{inv.meetup_location}</strong></p>
                        </div>
                        <span className="text-[10px] font-bold bg-yellow-200 text-yellow-800 px-2 py-1 rounded uppercase">Pending</span>
                    </div>
                    <div className="flex gap-3 mt-4">
                        <button onClick={() => {
                                const src = prompt("Enter your pickup location:");
                                if(src) handleRespondInvite(inv.invite_id, 'accepted', src);
                            }}
                            className="flex-1 bg-black text-white py-2 rounded-lg text-sm font-bold hover:bg-gray-800 transition"
                        >Accept & Ride</button>
                        <button onClick={() => {
                                if(window.confirm("Decline?")) handleRespondInvite(inv.invite_id, 'rejected');
                            }}
                            className="flex-1 bg-white border border-gray-300 text-gray-600 py-2 rounded-lg text-sm font-bold hover:bg-gray-50 transition"
                        >Decline</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {showMeetupModal && (
              <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
                <div className="bg-white p-6 rounded-xl w-full max-w-md shadow-2xl">
                   <div className="flex justify-between items-center mb-6">
                       <h3 className="font-bold text-xl">Create Meetup</h3>
                       <button onClick={()=>setShowMeetupModal(false)}><X className="text-gray-400 hover:text-black"/></button>
                   </div>
                   <div className="space-y-4">
                       <input className="w-full bg-gray-100 p-3 rounded-lg" value={meetupLoc} onChange={e=>setMeetupLoc(e.target.value)} placeholder="Destination (e.g. Mall)" />
                       <input className="w-full bg-gray-100 p-3 rounded-lg" value={meetupSource} onChange={e=>setMeetupSource(e.target.value)} placeholder="Your Pickup Location" />
                       <textarea className="w-full bg-gray-100 p-3 rounded-lg h-24" value={meetupEmails} onChange={e=>setMeetupEmails(e.target.value)} placeholder="Emails: a@a.com, b@b.com" />
                       <button onClick={createMeetup} className="w-full bg-black text-white py-3 rounded-lg font-bold">Send Invites</button>
                   </div>
                </div>
              </div>
            )}
          </div>
        )}

        {view === 'history' && (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 h-full flex flex-col max-w-4xl w-full mx-auto">
             
             {/* 1. Statistics Dashboard */}
             {historyStats && (
                 <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                     <div className="bg-black text-white p-4 rounded-xl">
                        <p className="text-xs text-gray-400 uppercase font-bold">Total Rides</p>
                        <p className="text-2xl font-extrabold">{historyStats.total_rides}</p>
                     </div>
                     <div className="bg-green-50 text-green-800 p-4 rounded-xl border border-green-100">
                        <p className="text-xs uppercase font-bold opacity-70">Completed</p>
                        <div className="flex items-center gap-2">
                            <CheckCircle size={20}/>
                            <p className="text-2xl font-extrabold">{historyStats.completed}</p>
                        </div>
                     </div>
                     <div className="bg-red-50 text-red-800 p-4 rounded-xl border border-red-100">
                        <p className="text-xs uppercase font-bold opacity-70">Cancelled</p>
                        <div className="flex items-center gap-2">
                            <XCircle size={20}/>
                            <p className="text-2xl font-extrabold">{historyStats.cancelled}</p>
                        </div>
                     </div>
                     <div className="bg-gray-50 text-gray-800 p-4 rounded-xl border border-gray-200">
                        <p className="text-xs uppercase font-bold opacity-70">Unique Drivers</p>
                        <div className="flex items-center gap-2">
                            <User size={20}/>
                            <p className="text-2xl font-extrabold">{historyStats.unique_drivers}</p>
                        </div>
                     </div>
                 </div>
             )}

             <div className="flex flex-col md:flex-row justify-between items-center mb-4 gap-4">
                <h2 className="text-xl font-bold flex items-center gap-2"><History size={20}/> Ride History</h2>
                
                {/* 2. Filters */}
                <div className="flex bg-gray-100 p-1 rounded-lg">
                    {['all', 'completed', 'cancelled'].map(filter => (
                        <button
                            key={filter}
                            onClick={() => { setHistoryFilter(filter); setHistoryPage(0); }}
                            className={`px-4 py-1.5 rounded-md text-xs font-bold capitalize transition ${historyFilter === filter ? 'bg-white shadow text-black' : 'text-gray-500 hover:text-black'}`}
                        >
                            {filter}
                        </button>
                    ))}
                </div>
             </div>
             
             {/* 3. List Area */}
             <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-3">
                {historyLoading ? (
                    <div className="text-center py-20"><RefreshCw className="animate-spin mx-auto text-gray-400"/></div>
                ) : history.length > 0 ? history.map(r => (
                  <div key={r.ride_id} className="group p-4 border border-gray-100 rounded-xl hover:bg-gray-50 hover:border-gray-200 transition duration-200">
                    
                    <div className="flex justify-between items-start mb-3">
                        <span className={`text-[10px] font-bold px-2 py-1 rounded border uppercase tracking-wider ${getStatusColor(r.status)}`}>
                            {r.status}
                        </span>
                        
                        <div className="flex items-center gap-1 text-gray-400 text-xs">
                            <Calendar size={12}/>
                            <span>{new Date(r.created_at).toLocaleDateString()}</span>
                            <Clock size={12} className="ml-2"/>
                            <span>{new Date(r.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        {/* Route Visual */}
                        <div className="flex flex-col items-center gap-1 mt-1">
                            <div className="w-2 h-2 rounded-full bg-gray-300"></div>
                            <div className="w-0.5 h-8 bg-gray-200"></div>
                            <div className="w-2 h-2 rounded-full bg-black"></div>
                        </div>

                        {/* Locations */}
                        <div className="flex-1">
                            <div className="mb-2">
                                <p className="text-xs text-gray-400 font-bold uppercase">From</p>
                                <p className="text-sm font-medium text-gray-700">{r.source_location}</p>
                            </div>
                            <div>
                                <p className="text-xs text-gray-400 font-bold uppercase">To</p>
                                <p className="text-base font-bold text-gray-900">{r.dest_location}</p>
                            </div>
                        </div>

                        {/* Driver Info (If exists) */}
                        {r.driver_name && (
                            <div className="hidden sm:block text-right bg-white border border-gray-100 p-2 rounded-lg shadow-sm w-32">
                                <p className="text-xs text-gray-400 font-bold uppercase mb-1">Driver</p>
                                <p className="text-sm font-bold truncate">{r.driver_name}</p>
                                <p className="text-xs text-gray-500 mt-0.5">{r.vehicle_id}</p>
                            </div>
                        )}
                    </div>
                  </div>
                )) : (
                    <div className="text-center py-20 text-gray-400 flex flex-col items-center">
                        <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                            <History size={32} className="opacity-20"/>
                        </div>
                        <p className="font-medium">No rides found</p>
                    </div>
                )}
             </div>

             {/* 4. Pagination */}
             <div className="mt-4 pt-4 border-t border-gray-100 flex justify-between items-center">
                 <span className="text-xs text-gray-400 font-bold uppercase">
                     Showing {history.length} of {pagination.total} rides
                 </span>
                 <div className="flex gap-2">
                     <button 
                        disabled={historyPage === 0}
                        onClick={() => setHistoryPage(p => Math.max(0, p - 1))}
                        className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                     >
                         <ChevronLeft size={16}/>
                     </button>
                     <button 
                        disabled={(historyPage + 1) * pagination.limit >= pagination.total}
                        onClick={() => setHistoryPage(p => p + 1)}
                        className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                     >
                         <ChevronRight size={16}/>
                     </button>
                 </div>
             </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PassengerDashboard;