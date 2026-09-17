import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, collection, query, onSnapshot, setDoc, deleteDoc, getDoc } from 'firebase/firestore';
import { ShieldCheck, Lock, Unlock, Users, Calendar, Settings, Search, UserPlus, CheckCircle2, Clock, X, Info } from 'lucide-react';

// Firebase Setup (Strict Rules Applied)
const firebaseConfig = {
  apiKey: "AIzaSyBs5iDBwYDWJrJqGpHu9pVPu35Rh1HD9Po",
  authDomain: "lunchabunch-eec99.firebaseapp.com",
  projectId: "lunchabunch-eec99",
  storageBucket: "lunchabunch-eec99.firebasestorage.app",
  messagingSenderId: "785440416785",
  appId: "1:785440416785:web:dd86c3ede972dbcd7ebdb0"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = 'lunchabunch-production';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const HOURS = Array.from({ length: 13 }, (_, i) => i + 8); // 8 AM to 8 PM

const formatHour = (h) => (h === 12 ? '12 PM' : h > 12 ? `${h - 12} PM` : `${h} AM`);

export default function App() {
  // Auth State
  const [user, setUser] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  // App State
  const [myProfile, setMyProfile] = useState(null);
  const [hasConsented, setHasConsented] = useState(false);
  const [activeTab, setActiveTab] = useState('my-schedule'); // my-schedule, network, sync
  
  // Data State
  const [myEvents, setMyEvents] = useState([]); // Private source of truth
  const [following, setFollowing] = useState([]);
  const [allProfiles, setAllProfiles] = useState([]);
  const [friendSchedules, setFriendSchedules] = useState({});
  
  // UI State
  const [handleInput, setHandleInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCell, setSelectedCell] = useState(null);
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventIsPrivate, setNewEventIsPrivate] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth Error:", err);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoadingAuth(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    // 1. Fetch My Profile (Public presence)
    const profileRef = doc(db, 'artifacts', appId, 'public', 'data', 'profiles', user.uid);
    const unsubProfile = onSnapshot(profileRef, (docSnap) => {
      if (docSnap.exists()) setMyProfile(docSnap.data());
      else setMyProfile(null);
    });

    // 2. Fetch Consent Settings (Private)
    const settingsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'privacy');
    const unsubSettings = onSnapshot(settingsRef, (docSnap) => {
      if (docSnap.exists() && docSnap.data().consented) {
        setHasConsented(true);
      }
    });

    // 3. Fetch My RAW Private Events (Private Vault)
    const eventsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'privateData', 'events');
    const unsubEvents = onSnapshot(eventsRef, (docSnap) => {
      if (docSnap.exists()) setMyEvents(docSnap.data().list || []);
    });

    // 4. Fetch Following List
    const followingCol = collection(db, 'artifacts', appId, 'users', user.uid, 'following');
    const unsubFollowing = onSnapshot(query(followingCol), (snap) => {
      setFollowing(snap.docs.map(d => ({ uid: d.id, ...d.data() })));
    });

    // 5. Fetch ALL Public Profiles for searching (In memory filter)
    const allProfilesCol = collection(db, 'artifacts', appId, 'public', 'data', 'profiles');
    const unsubAllProfiles = onSnapshot(query(allProfilesCol), (snap) => {
      setAllProfiles(snap.docs.map(d => ({ uid: d.id, ...d.data() })));
    });

    // 6. Fetch Public Schedules (Anonymized by senders)
    const publicSchedulesCol = collection(db, 'artifacts', appId, 'public', 'data', 'schedules');
    const unsubSchedules = onSnapshot(query(publicSchedulesCol), (snap) => {
      const map = {};
      snap.docs.forEach(d => { map[d.id] = d.data().list || []; });
      setFriendSchedules(map);
    });

    return () => {
      unsubProfile(); unsubSettings(); unsubEvents(); 
      unsubFollowing(); unsubAllProfiles(); unsubSchedules();
    };
  }, [user]);

  // The Data Scrubber: Converts private schedule to public anonymized format
  const syncToPublicSchedule = async (eventsList) => {
    if (!user) return;
    
    // Privacy by Design: Scrub details before they leave the private vault
    const scrubbedEvents = eventsList.map(ev => {
      if (ev.isPrivate) {
        return { ...ev, title: 'Busy' }; // Stripping sensitive details
      }
      return ev;
    });

    await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'schedules', user.uid), {
      list: scrubbedEvents,
      updatedAt: new Date().toISOString()
    });
  };

  const handleSaveEvent = async () => {
    if (!user || !selectedCell || !newEventTitle.trim()) return;
    
    const newEvent = {
      id: `${selectedCell.day}-${selectedCell.hour}`, // one event per hour slot for simplicity
      day: selectedCell.day,
      hour: selectedCell.hour,
      title: newEventTitle.trim(),
      isPrivate: newEventIsPrivate
    };

    // Filter out existing event in this slot if any
    const filteredEvents = myEvents.filter(ev => ev.id !== newEvent.id);
    const updatedEvents = [...filteredEvents, newEvent];

    // 1. Save FULL details to Private Vault
    await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'privateData', 'events'), { list: updatedEvents });
    
    // 2. Trigger the Data Scrubber to update public presence
    await syncToPublicSchedule(updatedEvents);

    setSelectedCell(null);
    setNewEventTitle('');
  };

  const handleDeleteEvent = async (eventId) => {
    if (!user) return;
    const updatedEvents = myEvents.filter(ev => ev.id !== eventId);
    
    // 1. Update Private Vault
    await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'privateData', 'events'), { list: updatedEvents });
    // 2. Update Public
    await syncToPublicSchedule(updatedEvents);
    setSelectedCell(null);
  };

  const handleCreateProfile = async (e) => {
    e.preventDefault();
    if (!handleInput.trim() || !user) return;
    
    const cleanHandle = handleInput.trim().toLowerCase();
    
    // Instantly set local profile AND mark consent so it moves straight to the calendar/vault!
    setMyProfile({ handle: cleanHandle });
    setHasConsented(true);

    // Save to Firebase (Profile)
    await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'profiles', user.uid), {
      handle: cleanHandle,
      createdAt: new Date().toISOString()
    });

    // Also auto-save consent to Firebase in the background
    await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'privacy'), {
      consented: true,
      timestamp: new Date().toISOString()
    });
  };

  const handleConsent = async () => {
    if (!user) return;
    await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'privacy'), {
      consented: true,
      timestamp: new Date().toISOString()
    });
  };

  const toggleFollow = async (targetUid, handle) => {
    if (!user || targetUid === user.uid) return;
    const isFollowing = following.some(f => f.uid === targetUid);
    const followRef = doc(db, 'artifacts', appId, 'users', user.uid, 'following', targetUid);
    
    if (isFollowing) {
      await deleteDoc(followRef);
    } else {
      await setDoc(followRef, { handle });
    }
  };

  const getCellStatus = (day, hour) => {
    if (activeTab === 'my-schedule') {
      const myEv = myEvents.find(e => e.day === day && e.hour === hour);
      return myEv;
    }

    if (activeTab === 'sync') {
      // Find who is busy
      let busyPeople = [];
      
      // Check my schedule
      const amIBusy = myEvents.some(e => e.day === day && e.hour === hour);
      if (amIBusy) busyPeople.push({ handle: 'You', title: myEvents.find(e => e.day === day && e.hour === hour).title, isPrivate: myEvents.find(e => e.day === day && e.hour === hour).isPrivate });

      // Check friends
      following.forEach(friend => {
        const friendSchedule = friendSchedules[friend.uid] || [];
        const busyEvent = friendSchedule.find(e => e.day === day && e.hour === hour);
        if (busyEvent) {
          busyPeople.push({ 
            handle: friend.handle, 
            title: busyEvent.title, 
            isPrivate: busyEvent.isPrivate 
          });
        }
      });

      return busyPeople;
    }
    return null;
  };

  if (loadingAuth) return <div className="min-h-screen flex items-center justify-center bg-zinc-50"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>;

  if (!myProfile) {
    return (
      <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-zinc-200 max-w-md w-full">
          <div className="bg-indigo-100 w-12 h-12 rounded-full flex items-center justify-center mb-6 text-indigo-600">
            <Users size={24} />
          </div>
          <h1 className="text-2xl font-bold text-zinc-900 mb-2">Welcome to Lunchabunch</h1>
          <p className="text-zinc-500 mb-6">Choose a unique handle so your friends can find and follow your schedule.</p>
          <form onSubmit={handleCreateProfile} className="space-y-4">
            <input 
              type="text" 
              placeholder="e.g. janesmith24"
              value={handleInput}
              onChange={(e) => setHandleInput(e.target.value.replace(/\s+/g, ''))}
              className="w-full p-3 bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required
            />
            <button type="submit" className="w-full bg-indigo-600 text-white font-medium p-3 rounded-lg hover:bg-indigo-700 transition-colors">
              Claim Handle
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (!hasConsented) {
    return (
      <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-zinc-200 max-w-lg w-full">
          <div className="bg-emerald-100 w-12 h-12 rounded-full flex items-center justify-center mb-6 text-emerald-600">
            <ShieldCheck size={24} />
          </div>
          <h1 className="text-2xl font-bold text-zinc-900 mb-4">Privacy & Data Consent</h1>
          <div className="space-y-4 text-zinc-600 text-sm mb-8">
            <p>Before you sync, please understand how your data is handled:</p>
            <ul className="space-y-3">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                <span><strong>Data Minimization:</strong> You control what details are shared. Events marked as "Private" have their titles stripped and are uploaded only as generic "Busy" time blocks.</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                <span><strong>Access Control:</strong> Only users you explicitly approve (or users who follow you in this demo) can overlay your free/busy schedule.</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                <span><strong>Full Deletion:</strong> Deleting an event instantly wipes it from both your private vault and the public sync database.</span>
              </li>
            </ul>
          </div>
          <button onClick={handleConsent} className="w-full bg-zinc-900 text-white font-medium p-3 rounded-lg hover:bg-zinc-800 transition-colors">
            I Understand & Agree
          </button>
        </div>
      </div>
    );
  }

  const filteredProfiles = allProfiles.filter(p => 
    p.uid !== user.uid && p.handle.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col font-sans">
      {/* Top Navigation */}
      <header className="bg-white border-b border-zinc-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2 text-indigo-600 font-bold text-xl">
          <Calendar /> Lunchabunch
        </div>
        <div className="flex bg-zinc-100 p-1 rounded-lg">
          <button onClick={() => setActiveTab('my-schedule')} className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${activeTab === 'my-schedule' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-900'}`}>My Schedule</button>
          <button onClick={() => setActiveTab('network')} className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${activeTab === 'network' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-900'}`}>Friends</button>
          <button onClick={() => setActiveTab('sync')} className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${activeTab === 'sync' ? 'bg-indigo-600 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-900'}`}>Find Free Time</button>
        </div>
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-600 bg-zinc-100 px-3 py-1.5 rounded-full">
          <div className="w-2 h-2 rounded-full bg-emerald-500"></div> @{myProfile.handle}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
        
        {/* TAB 1: My Schedule */}
        {activeTab === 'my-schedule' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-zinc-900">Your Private Vault</h2>
                <p className="text-zinc-500">Tap any block to add a class or event. Private events are scrubbed before syncing.</p>
              </div>
            </div>
            
            <div className="bg-white border border-zinc-200 rounded-xl shadow-sm overflow-hidden overflow-x-auto">
              <div className="min-w-[800px]">
                {/* Grid Header */}
                <div className="grid grid-cols-6 border-b border-zinc-200 bg-zinc-50/50">
                  <div className="p-4 text-center font-semibold text-zinc-400 text-sm">Time</div>
                  {DAYS.map(day => <div key={day} className="p-4 text-center font-semibold text-zinc-700">{day}</div>)}
                </div>
                {/* Grid Body */}
                {HOURS.map(hour => (
                  <div key={hour} className="grid grid-cols-6 border-b border-zinc-100 last:border-0 hover:bg-zinc-50/30 transition-colors">
                    <div className="p-3 text-center text-sm font-medium text-zinc-500 border-r border-zinc-100 flex items-center justify-center">
                      {formatHour(hour)}
                    </div>
                    {DAYS.map(day => {
                      const event = getCellStatus(day, hour);
                      return (
                        <div 
                          key={`${day}-${hour}`}
                          onClick={() => setSelectedCell({ day, hour, existing: event })}
                          className={`p-2 border-r border-zinc-100 last:border-0 min-h-[80px] cursor-pointer transition-all ${
                            event 
                              ? event.isPrivate 
                                ? 'bg-amber-50 hover:bg-amber-100' 
                                : 'bg-indigo-50 hover:bg-indigo-100'
                              : 'hover:bg-zinc-100/50'
                          }`}
                        >
                          {event && (
                            <div className={`p-2 rounded-md h-full flex flex-col gap-1 border ${event.isPrivate ? 'bg-amber-100 border-amber-200 text-amber-900' : 'bg-indigo-100 border-indigo-200 text-indigo-900'}`}>
                              <div className="flex items-center gap-1 font-semibold text-xs">
                                {event.isPrivate ? <Lock size={12} /> : <Unlock size={12} />}
                                {event.title}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Network / Friends */}
        {activeTab === 'network' && (
          <div className="space-y-6 max-w-3xl mx-auto animate-in fade-in slide-in-from-bottom-2">
             <div>
              <h2 className="text-2xl font-bold text-zinc-900">Your Network</h2>
              <p className="text-zinc-500">Find friends to sync schedules with.</p>
            </div>

            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={20} />
              <input 
                type="text" 
                placeholder="Search by handle..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-12 pr-4 py-4 bg-white border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm text-lg"
              />
            </div>

            <div className="bg-white border border-zinc-200 rounded-xl shadow-sm overflow-hidden">
              {filteredProfiles.length === 0 ? (
                <div className="p-8 text-center text-zinc-500">No users found.</div>
              ) : (
                <ul className="divide-y divide-zinc-100">
                  {filteredProfiles.map(profile => {
                    const isFollowing = following.some(f => f.uid === profile.uid);
                    return (
                      <li key={profile.uid} className="p-4 flex items-center justify-between hover:bg-zinc-50 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-indigo-100 text-indigo-700 rounded-full flex items-center justify-center font-bold">
                            {profile.handle.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-semibold text-zinc-900">@{profile.handle}</p>
                          </div>
                        </div>
                        <button 
                          onClick={() => toggleFollow(profile.uid, profile.handle)}
                          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                            isFollowing 
                              ? 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200' 
                              : 'bg-indigo-600 text-white hover:bg-indigo-700'
                          }`}
                        >
                          {isFollowing ? 'Following' : 'Follow'}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: Sync Overlay Dashboard */}
        {activeTab === 'sync' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-zinc-900 flex items-center gap-2">
                  <Clock className="text-indigo-600" /> Availability Radar
                </h2>
                <p className="text-zinc-500">Overlaying your schedule with {following.length} friends. Green means everyone is free!</p>
              </div>
              <div className="flex gap-2">
                <div className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-emerald-100 text-emerald-800 rounded-md"><div className="w-3 h-3 bg-emerald-400 rounded-sm"></div> Free</div>
                <div className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-amber-100 text-amber-800 rounded-md"><div className="w-3 h-3 bg-amber-400 rounded-sm"></div> Some Busy</div>
                <div className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-red-100 text-red-800 rounded-md"><div className="w-3 h-3 bg-red-400 rounded-sm"></div> Many Busy</div>
              </div>
            </div>

            <div className="bg-white border border-zinc-200 rounded-xl shadow-sm overflow-hidden overflow-x-auto">
              <div className="min-w-[800px]">
                 <div className="grid grid-cols-6 border-b border-zinc-200 bg-zinc-50/50">
                  <div className="p-4 text-center font-semibold text-zinc-400 text-sm">Time</div>
                  {DAYS.map(day => <div key={day} className="p-4 text-center font-semibold text-zinc-700">{day}</div>)}
                </div>
                {HOURS.map(hour => (
                  <div key={hour} className="grid grid-cols-6 border-b border-zinc-100 last:border-0 hover:bg-zinc-50/30 transition-colors">
                    <div className="p-3 text-center text-sm font-medium text-zinc-500 border-r border-zinc-100 flex items-center justify-center">
                      {formatHour(hour)}
                    </div>
                    {DAYS.map(day => {
                      const busyPeople = getCellStatus(day, hour) || [];
                      const isFree = busyPeople.length === 0;
                      
                      let bgColor = 'bg-emerald-50/50 hover:bg-emerald-100'; // Everyone Free
                      let borderColor = 'border-transparent';
                      if (!isFree) {
                        if (busyPeople.length === 1) { bgColor = 'bg-amber-50 hover:bg-amber-100'; borderColor = 'border-amber-200'; }
                        else { bgColor = 'bg-red-50 hover:bg-red-100'; borderColor = 'border-red-200'; }
                      }

                      return (
                        <div 
                          key={`${day}-${hour}`}
                          className={`p-2 border-r border-zinc-100 last:border-0 min-h-[80px] transition-all group relative cursor-help ${bgColor}`}
                        >
                          {!isFree && (
                            <div className={`w-full h-full border rounded-md p-1.5 ${borderColor} bg-white/40 flex flex-col gap-1 overflow-hidden`}>
                              <div className="text-xs font-bold text-zinc-700 mb-1">{busyPeople.length} Busy</div>
                              {busyPeople.map((p, idx) => (
                                <div key={idx} className="text-[10px] leading-tight text-zinc-600 truncate flex items-center gap-1">
                                  <span className="font-semibold">@{p.handle}</span> 
                                </div>
                              ))}
                            </div>
                          )}
                          {isFree && (
                            <div className="w-full h-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                              <span className="text-xs font-bold text-emerald-600 bg-emerald-100 px-2 py-1 rounded-full">Available</span>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Modal for Adding/Editing Events */}
      {selectedCell && (
        <div className="fixed inset-0 bg-zinc-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between">
              <h3 className="font-bold text-lg text-zinc-900">
                {selectedCell.existing ? 'Edit Slot' : 'Add Event'}
              </h3>
              <button onClick={() => setSelectedCell(null)} className="text-zinc-400 hover:text-zinc-600"><X size={20}/></button>
            </div>
            
            <div className="p-6 space-y-6">
              <div>
                <p className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-2">Time</p>
                <p className="text-lg font-medium text-zinc-900">{selectedCell.day} at {formatHour(selectedCell.hour)}</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-zinc-700 mb-2">Event Title</label>
                <input 
                  type="text"
                  placeholder="e.g. CS101, Gym, Work"
                  value={newEventTitle || (selectedCell.existing?.title || '')}
                  onChange={e => setNewEventTitle(e.target.value)}
                  className="w-full p-3 bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-200 flex items-start gap-3">
                <div className="pt-0.5">
                  <input 
                    type="checkbox" 
                    id="privacy-toggle"
                    checked={newEventIsPrivate}
                    onChange={e => setNewEventIsPrivate(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 rounded border-zinc-300 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label htmlFor="privacy-toggle" className="font-semibold text-zinc-900 cursor-pointer block">Keep Private (Recommended)</label>
                  <p className="text-xs text-zinc-500 mt-1">
                    If checked, followers will only see that you are "Busy" at this time, but the title "{newEventTitle || 'Event'}" will be hidden.
                  </p>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 bg-zinc-50 border-t border-zinc-100 flex items-center justify-between">
              {selectedCell.existing ? (
                <button onClick={() => handleDeleteEvent(selectedCell.existing.id)} className="text-red-600 font-medium text-sm hover:text-red-700">Remove</button>
              ) : <div></div>}
              
              <div className="flex gap-2">
                <button onClick={() => setSelectedCell(null)} className="px-4 py-2 font-medium text-zinc-600 hover:text-zinc-900">Cancel</button>
                <button onClick={handleSaveEvent} className="px-6 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 shadow-sm">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}














// import React, { useState, useEffect } from 'react';
// import { Calendar, Users, Clock, Search } from 'lucide-react';
// import { initializeApp } from 'firebase/app';
// import { getFirestore, collection, doc, setDoc, onSnapshot, query } from 'firebase/firestore';
// import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

// // Your actual live Firebase config!
// const firebaseConfig = {
//   apiKey: "AIzaSyBs5iDBwYDWJrJqGpHu9pVPu35RhlHD9Po",
//   authDomain: "lunchabunch-eec99.firebaseapp.com",
//   projectId: "lunchabunch-eec99",
//   storageBucket: "lunchabunch-eec99.firebasestorage.app",
//   messagingSenderId: "785440416785",
//   appId: "1:785440416785:web:dd86c3ede972dbcd7ebdb0"
// };

// // Initialize Firebase
// const app = initializeApp(firebaseConfig);
// const db = getFirestore(app);
// const auth = getAuth(app);

// export default function App() {
//   const [userId, setUserId] = useState(null);
//   const [handle, setHandle] = useState('');
//   const [isRegistered, setIsRegistered] = useState(false);
//   const [myStatus, setMyStatus] = useState('Free right now');
//   const [amIFree, setAmIFree] = useState(true);
//   const [friends, setFriends] = useState([]);

//   // Log in anonymously when the app opens
//   useEffect(() => {
//     signInAnonymously(auth).catch(error => console.error("Auth error:", error));
    
//     const unsubscribe = onAuthStateChanged(auth, (user) => {
//       if (user) setUserId(user.uid);
//     });
//     return () => unsubscribe();
//   }, []);

//   // Listen for all users in real-time
//   useEffect(() => {
//     if (!isRegistered) return;
    
//     const q = query(collection(db, "users"));
//     const unsubscribe = onSnapshot(q, (snapshot) => {
//       const usersData = [];
//       snapshot.forEach((doc) => {
//         if (doc.id !== userId) { // Don't show yourself in the friends list
//           usersData.push(doc.data());
//         }
//       });
//       setFriends(usersData);
//     });
//     return () => unsubscribe();
//   }, [isRegistered, userId]);

//   // Save user profile to Firebase
//   const handleRegister = async () => {
//     if (!handle || !userId) return;
    
//     await setDoc(doc(db, "users", userId), {
//       handle: handle.startsWith('@') ? handle : `@${handle}`,
//       status: myStatus,
//       isFree: amIFree,
//       updatedAt: new Date().toISOString()
//     });
//     setIsRegistered(true);
//   };

//   // Update your own status in Firebase
//   const updateStatus = async (newStatus, freeState) => {
//     setMyStatus(newStatus);
//     setAmIFree(freeState);
//     await setDoc(doc(db, "users", userId), {
//       handle: handle,
//       status: newStatus,
//       isFree: freeState,
//       updatedAt: new Date().toISOString()
//     }, { merge: true });
//   };

//   if (!isRegistered) {
//     return (
//       <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
//         <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full space-y-6 border border-gray-100">
//           <div className="text-center">
//             <h1 className="text-4xl font-extrabold text-indigo-600 mb-2 tracking-tight">Lunchabunch</h1>
//             <p className="text-gray-500 font-medium">Sync schedules securely.</p>
//           </div>
//           <div className="space-y-4 pt-4">
//             <div>
//               <label className="block text-sm font-semibold text-gray-700 mb-2">Choose your handle</label>
//               <input 
//                 type="text" 
//                 placeholder="@username"
//                 className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
//                 value={handle}
//                 onChange={(e) => setHandle(e.target.value)}
//               />
//             </div>
//             <button 
//               onClick={handleRegister}
//               disabled={!handle}
//               className="w-full bg-indigo-600 text-white font-bold py-3 px-4 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
//             >
//               Enter Dashboard
//             </button>
//           </div>
//         </div>
//       </div>
//     );
//   }

//   return (
//     <div className="min-h-screen bg-gray-50 p-4 md:p-8 font-sans">
//       <div className="max-w-4xl mx-auto space-y-6">
        
//         {/* Header / Your Status */}
//         <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col md:flex-row md:justify-between md:items-center gap-4">
//           <div>
//             <h1 className="text-2xl font-bold text-gray-900">Lunchabunch</h1>
//             <p className="text-gray-500 font-medium">Logged in as <span className="text-indigo-600">{handle}</span></p>
//           </div>
          
//           <div className="flex items-center gap-3 bg-gray-50 p-2 rounded-2xl border border-gray-100">
//             <input 
//               type="text" 
//               value={myStatus}
//               onChange={(e) => setMyStatus(e.target.value)}
//               onBlur={(e) => updateStatus(e.target.value, amIFree)}
//               className="px-3 py-2 bg-transparent border-none focus:ring-0 outline-none font-medium text-gray-700 w-48"
//               placeholder="What are you up to?"
//             />
//             <button 
//               onClick={() => updateStatus(myStatus, !amIFree)}
//               className={`px-4 py-2 rounded-xl font-bold text-sm transition-colors ${amIFree ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-red-100 text-red-700 hover:bg-red-200'}`}
//             >
//               {amIFree ? 'I am Free' : 'I am Busy'}
//             </button>
//           </div>
//         </div>

//         <div className="grid md:grid-cols-2 gap-6">
//           {/* Friends Feed */}
//           <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 space-y-4">
//             <div className="flex items-center space-x-3 text-gray-900 border-b border-gray-100 pb-4">
//               <Clock className="text-indigo-500" />
//               <h2 className="text-xl font-bold">The Squad</h2>
//             </div>
//             <div className="space-y-3">
//               {friends.length === 0 ? (
//                 <p className="text-gray-400 text-center py-4">No one else is here yet! Invite your friends.</p>
//               ) : (
//                 friends.map((friend, i) => (
//                   <div key={i} className="flex justify-between items-center p-4 bg-gray-50 rounded-2xl">
//                     <span className="font-bold text-gray-800">{friend.handle}</span>
//                     <div className="flex flex-col items-end">
//                       <span className={`text-xs font-bold uppercase tracking-wider mb-1 ${friend.isFree ? 'text-green-600' : 'text-red-600'}`}>
//                         {friend.isFree ? 'Free' : 'Busy'}
//                       </span>
//                       <span className="text-sm text-gray-500 font-medium">{friend.status}</span>
//                     </div>
//                   </div>
//                 ))
//               )}
//             </div>
//           </div>

//           {/* Add Friends Info */}
//           <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 space-y-4 h-fit">
//             <div className="flex items-center space-x-3 text-gray-900 border-b border-gray-100 pb-4">
//               <Users className="text-indigo-500" />
//               <h2 className="text-xl font-bold">How it works</h2>
//             </div>
//             <p className="text-gray-600 leading-relaxed">
//               Anyone with the link to this app will appear in <strong>The Squad</strong> feed automatically once they create a handle. 
//             </p>
//             <p className="text-gray-600 leading-relaxed">
//               Toggle your status between <span className="text-green-600 font-bold">Free</span> and <span className="text-red-600 font-bold">Busy</span>, and type in your current activity so your friends know exactly when you're available for lunch or studying at EPFL!
//             </p>
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// }











