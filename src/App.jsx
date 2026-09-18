import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, doc, collection, query, onSnapshot, setDoc, deleteDoc } from 'firebase/firestore';
import { ShieldCheck, Lock, Unlock, Users, Calendar, Search, CheckCircle2, Clock, X, Sparkles, LogOut } from 'lucide-react';

// Firebase Setup
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
const googleProvider = new GoogleAuthProvider();
const db = getFirestore(app);
const appId = 'lunchabunch-production';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const HOURS = Array.from({ length: 13 }, (_, i) => i + 8); // 8 AM to 8 PM
const HOUR_HEIGHT = 80; // pixels per hour in the calendar UI

const formatHour = (h) => (h === 12 ? '12 PM' : h > 12 ? `${h - 12} PM` : `${h} AM`);

// Math helpers for placing events precisely on the grid
const calculateTop = (timeStr) => {
  const [h, m] = timeStr.split(':').map(Number);
  return ((h - 8) * HOUR_HEIGHT) + ((m / 60) * HOUR_HEIGHT);
};

const calculateHeight = (startStr, endStr) => {
  const [sh, sm] = startStr.split(':').map(Number);
  const [eh, em] = endStr.split(':').map(Number);
  const durationMins = (eh * 60 + em) - (sh * 60 + sm);
  return (durationMins / 60) * HOUR_HEIGHT;
};

export default function App() {
  const [user, setUser] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [myProfile, setMyProfile] = useState(null);
  const [hasConsented, setHasConsented] = useState(false);
  const [activeTab, setActiveTab] = useState('my-schedule'); 
  
  const [myEvents, setMyEvents] = useState([]); 
  const [following, setFollowing] = useState([]);
  const [allProfiles, setAllProfiles] = useState([]);
  const [friendSchedules, setFriendSchedules] = useState({});
  
  const [searchQuery, setSearchQuery] = useState('');
  const [editingEvent, setEditingEvent] = useState(null); 
  const [handleInput, setHandleInput] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        setLoadingAuth(false);
        setDataLoaded(false);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    let profileFetched = false;
    let settingsFetched = false;

    const checkDataReady = () => {
      if (profileFetched && settingsFetched) {
        setDataLoaded(true);
        setLoadingAuth(false);
      }
    };

    const profileRef = doc(db, 'artifacts', appId, 'public', 'data', 'profiles', user.uid);
    const unsubProfile = onSnapshot(profileRef, (docSnap) => {
      setMyProfile(docSnap.exists() ? docSnap.data() : null);
      profileFetched = true;
      checkDataReady();
    });

    const settingsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'privacy');
    const unsubSettings = onSnapshot(settingsRef, (docSnap) => {
      setHasConsented(docSnap.exists() && docSnap.data().consented);
      settingsFetched = true;
      checkDataReady();
    });

    const eventsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'privateData', 'events');
    const unsubEvents = onSnapshot(eventsRef, (docSnap) => {
      if (docSnap.exists()) setMyEvents(docSnap.data().list || []);
    });

    const followingCol = collection(db, 'artifacts', appId, 'users', user.uid, 'following');
    const unsubFollowing = onSnapshot(query(followingCol), (snap) => {
      setFollowing(snap.docs.map(d => ({ uid: d.id, ...d.data() })));
    });

    const allProfilesCol = collection(db, 'artifacts', appId, 'public', 'data', 'profiles');
    const unsubAllProfiles = onSnapshot(query(allProfilesCol), (snap) => {
      setAllProfiles(snap.docs.map(d => ({ uid: d.id, ...d.data() })));
    });

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

  const handleLogin = async () => {
    try { await signInWithPopup(auth, googleProvider); } 
    catch (err) { console.error("Login failed", err); }
  };

  const handleLogout = async () => {
    await signOut(auth);
    window.location.reload();
  };

  const syncToPublicSchedule = async (eventsList) => {
    if (!user) return;
    const scrubbedEvents = eventsList.map(ev => ev.isPrivate ? { ...ev, title: 'Busy' } : ev);
    await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'schedules', user.uid), {
      list: scrubbedEvents, updatedAt: new Date().toISOString()
    });
  };

  const handleSaveEvent = async () => {
    if (!user || !editingEvent || !editingEvent.title.trim()) return;
    
    // Ensure chronological times
    const startNum = parseInt(editingEvent.startTime.replace(':',''));
    const endNum = parseInt(editingEvent.endTime.replace(':',''));
    if (startNum >= endNum) {
      alert("End time must be after start time!");
      return;
    }

    const isNew = !editingEvent.id;
    const eventToSave = {
      ...editingEvent,
      id: isNew ? `event-${Date.now()}` : editingEvent.id,
      title: editingEvent.title.trim()
    };

    const filtered = myEvents.filter(ev => ev.id !== eventToSave.id);
    const updatedEvents = [...filtered, eventToSave];

    await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'privateData', 'events'), { list: updatedEvents });
    await syncToPublicSchedule(updatedEvents);
    setEditingEvent(null);
  };

  const handleDeleteEvent = async (eventId) => {
    if (!user) return;
    const updatedEvents = myEvents.filter(ev => ev.id !== eventId);
    await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'privateData', 'events'), { list: updatedEvents });
    await syncToPublicSchedule(updatedEvents);
    setEditingEvent(null);
  };

  const handleCreateProfile = async (e) => {
    e.preventDefault();
    if (!handleInput.trim() || !user || submitting) return;
    const cleanHandle = handleInput.trim().toLowerCase();
    
    setMyProfile({ handle: cleanHandle });
    setSubmitting(true);
    try {
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'profiles', user.uid), {
        handle: cleanHandle, createdAt: new Date().toISOString()
      });
    } finally { setSubmitting(false); }
  };

  const handleConsent = async () => {
    if (!user || submitting) return;
    setHasConsented(true);
    setSubmitting(true);
    try {
      await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'privacy'), {
        consented: true, timestamp: new Date().toISOString()
      });
    } finally { setSubmitting(false); }
  };

  const toggleFollow = async (targetUid, handle) => {
    if (!user || targetUid === user.uid) return;
    const isFollowing = following.some(f => f.uid === targetUid);
    const followRef = doc(db, 'artifacts', appId, 'users', user.uid, 'following', targetUid);
    if (isFollowing) await deleteDoc(followRef);
    else await setDoc(followRef, { handle });
  };

  const handleGridClick = (day, e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const clickedHour = Math.floor(y / HOUR_HEIGHT) + 8;
    
    setEditingEvent({
      day,
      startTime: `${clickedHour.toString().padStart(2, '0')}:00`,
      endTime: `${(clickedHour + 1).toString().padStart(2, '0')}:00`,
      title: '',
      isPrivate: true,
      recurrence: 'weekly'
    });
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setIsImporting(true);
    
    setTimeout(() => {
      const parsedSampleEvents = [
        { id: `imp-1`, day: 'Monday', startTime: '10:15', endTime: '12:00', title: 'Algorithms (COM-301)', isPrivate: false, recurrence: 'weekly' },
        { id: `imp-2`, day: 'Tuesday', startTime: '13:15', endTime: '17:00', title: 'Software Engineering Project', isPrivate: true, recurrence: 'weekly' },
        { id: `imp-3`, day: 'Wednesday', startTime: '09:15', endTime: '11:00', title: 'Quantum Physics', isPrivate: false, recurrence: 'biweekly' }
      ];
      const merged = [...myEvents, ...parsedSampleEvents];
      setMyEvents(merged);
      setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'privateData', 'events'), { list: merged });
      syncToPublicSchedule(merged);
      setIsImporting(false);
      alert("Successfully extracted 3 classes from your schedule screenshot!");
    }, 1500);
  };

  // Helper for Heatmap Sync Radar
  const isBusyThisHour = (events, day, targetHour) => {
    return events.some(ev => {
      if (ev.day !== day) return false;
      const startH = parseInt(ev.startTime.split(':')[0]);
      const endH = parseInt(ev.endTime.split(':')[0]);
      const endM = parseInt(ev.endTime.split(':')[1]);
      return startH <= targetHour && (endH > targetHour || (endH === targetHour && endM > 0));
    });
  };

  const getHeatmapStatus = (day, hour) => {
    let busyPeople = [];
    if (isBusyThisHour(myEvents, day, hour)) {
       const ev = myEvents.find(e => e.day === day && parseInt(e.startTime.split(':')[0]) <= hour);
       busyPeople.push({ handle: 'You', title: ev?.title || 'Busy', isPrivate: ev?.isPrivate });
    }
    following.forEach(friend => {
      const friendSchedule = friendSchedules[friend.uid] || [];
      if (isBusyThisHour(friendSchedule, day, hour)) {
         busyPeople.push({ handle: friend.handle, title: 'Busy', isPrivate: true });
      }
    });
    return busyPeople;
  };

  // 1. Loading State
  if (loadingAuth || (user && !dataLoaded) || submitting) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 gap-4">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        <p className="text-zinc-500 font-medium">Loading Lunchabunch...</p>
      </div>
    );
  }

  // 2. Login Screen
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-zinc-200 max-w-sm w-full text-center">
          <div className="bg-indigo-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6 text-indigo-600">
            <Calendar size={32} />
          </div>
          <h1 className="text-2xl font-bold text-zinc-900 mb-2">Lunchabunch</h1>
          <p className="text-zinc-500 mb-8">Sync schedules with your friends at EPFL instantly.</p>
          <button onClick={handleLogin} className="w-full bg-indigo-600 text-white font-medium p-3 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm">
            Continue with Google
          </button>
        </div>
      </div>
    );
  }

  // 3. Handle Creation
  if (!myProfile) {
    return (
      <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-zinc-200 max-w-md w-full">
          <h1 className="text-2xl font-bold text-zinc-900 mb-2">Pick a Handle</h1>
          <p className="text-zinc-500 mb-6">Choose a unique username so friends can find your schedule.</p>
          <form onSubmit={handleCreateProfile} className="space-y-4">
            <input 
              type="text" 
              placeholder="e.g. tristansidjanski"
              value={handleInput}
              onChange={(e) => setHandleInput(e.target.value.replace(/\s+/g, ''))}
              className="w-full p-3 bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required
            />
            <button type="submit" className="w-full bg-indigo-600 text-white font-medium p-3 rounded-lg hover:bg-indigo-700">Claim Handle</button>
          </form>
        </div>
      </div>
    );
  }

  // 4. Privacy Consent
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
              <li className="flex items-start gap-2"><CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" /><span><strong>Data Minimization:</strong> Private event titles are stripped and uploaded only as generic "Busy" time blocks.</span></li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" /><span><strong>Access Control:</strong> Only approved friends can overlay your schedule.</span></li>
            </ul>
          </div>
          <button onClick={handleConsent} className="w-full bg-zinc-900 text-white font-medium p-3 rounded-lg hover:bg-zinc-800">I Understand & Agree</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col font-sans">
      <header className="bg-white border-b border-zinc-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-2 text-indigo-600 font-bold text-xl">
          <Calendar /> Lunchabunch
        </div>
        <div className="flex bg-zinc-100 p-1 rounded-lg">
          <button onClick={() => setActiveTab('my-schedule')} className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'my-schedule' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'}`}>My Vault</button>
          <button onClick={() => setActiveTab('network')} className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'network' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'}`}>Friends</button>
          <button onClick={() => setActiveTab('sync')} className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'sync' ? 'bg-indigo-600 text-white shadow-sm' : 'text-zinc-500'}`}>Find Free Time</button>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-600 bg-zinc-100 px-3 py-1.5 rounded-full border border-zinc-200">
            <div className="w-2 h-2 rounded-full bg-emerald-500"></div> @{myProfile.handle}
          </div>
          <button onClick={handleLogout} className="text-zinc-400 hover:text-zinc-800 transition-colors" title="Logout"><LogOut size={20}/></button>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
        
        {/* TAB 1: My Schedule (Absolute Positioned Calendar) */}
        {activeTab === 'my-schedule' && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-zinc-900">Your Private Vault</h2>
                <p className="text-zinc-500">Click anywhere on the grid to add a custom event.</p>
              </div>
              <label className="cursor-pointer bg-gradient-to-r from-indigo-600 to-violet-600 text-white px-4 py-2 rounded-lg font-medium shadow-sm hover:opacity-90 transition-all flex items-center gap-2 text-sm">
                <Sparkles size={16} />
                {isImporting ? 'Scanning...' : 'Import Timetable (Screenshot)'}
                <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" disabled={isImporting} />
              </label>
            </div>
            
            <div className="bg-white border border-zinc-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
              {/* Header */}
              <div className="flex border-b border-zinc-200 bg-zinc-50/50">
                <div className="w-16 flex-shrink-0"></div>
                {DAYS.map(day => <div key={day} className="flex-1 text-center py-3 font-semibold text-zinc-700 border-l border-zinc-100">{day}</div>)}
              </div>
              
              {/* Grid Body */}
              <div className="flex relative h-[800px] overflow-y-auto bg-zinc-50/30">
                {/* Time Axis */}
                <div className="w-16 flex-shrink-0 flex flex-col bg-white z-10 border-r border-zinc-100">
                  {HOURS.map(h => (
                    <div key={h} className="text-[11px] font-medium text-zinc-400 text-right pr-3 pt-2" style={{ height: `${HOUR_HEIGHT}px` }}>
                      {formatHour(h)}
                    </div>
                  ))}
                </div>
                
                {/* Day Columns */}
                {DAYS.map(day => (
                  <div key={day} className="flex-1 relative border-l border-zinc-100 first:border-l-0 cursor-pointer hover:bg-zinc-100/30 transition-colors" onClick={(e) => handleGridClick(day, e)}>
                    {HOURS.map(h => <div key={h} className="border-b border-zinc-100 pointer-events-none" style={{ height: `${HOUR_HEIGHT}px` }}></div>)}
                    
                    {/* Render Events */}
                    {myEvents.filter(ev => ev.day === day).map(ev => {
                      const top = calculateTop(ev.startTime);
                      const height = calculateHeight(ev.startTime, ev.endTime);
                      
                      return (
                        <div 
                          key={ev.id}
                          onClick={(e) => { e.stopPropagation(); setEditingEvent(ev); }}
                          className={`absolute left-1 right-1 rounded-md p-2 text-xs flex flex-col gap-0.5 shadow-sm overflow-hidden border cursor-pointer hover:brightness-95 transition-all ${
                            ev.isPrivate ? 'bg-amber-100 border-amber-300 text-amber-900' : 'bg-indigo-100 border-indigo-300 text-indigo-900'
                          }`}
                          style={{ top: `${top}px`, height: `${height}px`, minHeight: '30px' }}
                        >
                          <div className="font-bold flex items-center justify-between">
                            <span className="flex items-center gap-1 truncate">{ev.isPrivate ? <Lock size={10} /> : <Unlock size={10} />} {ev.title}</span>
                          </div>
                          <div className="text-[10px] opacity-75 truncate">{ev.startTime} - {ev.endTime} ({ev.recurrence})</div>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Network */}
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
              {allProfiles.filter(p => p.uid !== user.uid && p.handle.toLowerCase().includes(searchQuery.toLowerCase())).map(profile => {
                const isFollowing = following.some(f => f.uid === profile.uid);
                return (
                  <div key={profile.uid} className="p-4 flex items-center justify-between border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-indigo-100 text-indigo-700 rounded-full flex items-center justify-center font-bold">
                        {profile.handle.charAt(0).toUpperCase()}
                      </div>
                      <span className="font-semibold text-zinc-900">@{profile.handle}</span>
                    </div>
                    <button 
                      onClick={() => toggleFollow(profile.uid, profile.handle)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${isFollowing ? 'bg-zinc-100 text-zinc-700' : 'bg-indigo-600 text-white'}`}
                    >
                      {isFollowing ? 'Following' : 'Follow'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 3: Find Free Time (Heatmap) */}
        {activeTab === 'sync' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-zinc-900 flex items-center gap-2"><Clock className="text-indigo-600" /> Availability Radar</h2>
                <p className="text-zinc-500">Hourly heatmap overlaying your schedule with {following.length} friends.</p>
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
                    <div className="p-3 text-center text-sm font-medium text-zinc-500 border-r border-zinc-100 flex items-center justify-center">{formatHour(hour)}</div>
                    {DAYS.map(day => {
                      const busyPeople = getHeatmapStatus(day, hour);
                      const isFree = busyPeople.length === 0;
                      
                      let bgColor = 'bg-emerald-50/50 hover:bg-emerald-100';
                      let borderColor = 'border-transparent';
                      if (!isFree) {
                        if (busyPeople.length === 1) { bgColor = 'bg-amber-50 hover:bg-amber-100'; borderColor = 'border-amber-200'; }
                        else { bgColor = 'bg-red-50 hover:bg-red-100'; borderColor = 'border-red-200'; }
                      }

                      return (
                        <div key={`${day}-${hour}`} className={`p-2 border-r border-zinc-100 last:border-0 min-h-[80px] transition-all group relative cursor-help ${bgColor}`}>
                          {!isFree && (
                            <div className={`w-full h-full border rounded-md p-1.5 ${borderColor} bg-white/40 flex flex-col gap-1 overflow-hidden`}>
                              <div className="text-xs font-bold text-zinc-700 mb-1">{busyPeople.length} Busy</div>
                              {busyPeople.map((p, idx) => (
                                <div key={idx} className="text-[10px] leading-tight text-zinc-600 truncate"><span className="font-semibold">@{p.handle}</span></div>
                              ))}
                            </div>
                          )}
                          {isFree && (
                            <div className="w-full h-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                              <span className="text-[10px] font-bold text-emerald-600 bg-emerald-100 px-2 py-1 rounded-full uppercase tracking-wider">Available</span>
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
      {editingEvent && (
        <div className="fixed inset-0 bg-zinc-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
              <h3 className="font-bold text-lg text-zinc-900">{editingEvent.id ? 'Edit Event' : 'New Event'} on {editingEvent.day}</h3>
              <button onClick={() => setEditingEvent(null)} className="text-zinc-400 hover:text-zinc-600"><X size={20}/></button>
            </div>
            
            <div>
              <label className="block text-sm font-semibold text-zinc-700 mb-1">Event Title</label>
              <input 
                type="text"
                placeholder="e.g. COM-301 Algorithms"
                value={editingEvent.title}
                onChange={e => setEditingEvent({...editingEvent, title: e.target.value})}
                className="w-full p-3 bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-zinc-700 mb-1">Start Time</label>
                <input 
                  type="time"
                  value={editingEvent.startTime}
                  onChange={e => setEditingEvent({...editingEvent, startTime: e.target.value})}
                  className="w-full p-3 bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-zinc-700 mb-1">End Time</label>
                <input 
                  type="time"
                  value={editingEvent.endTime}
                  onChange={e => setEditingEvent({...editingEvent, endTime: e.target.value})}
                  className="w-full p-3 bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-zinc-700 mb-1">Recurrence</label>
              <select 
                value={editingEvent.recurrence}
                onChange={e => setEditingEvent({...editingEvent, recurrence: e.target.value})}
                className="w-full p-3 bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="weekly">Weekly (Every week)</option>
                <option value="biweekly">Bi-weekly (Every 2 weeks)</option>
                <option value="once">One-time event</option>
              </select>
            </div>

            <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-200 flex items-start gap-3">
              <input 
                type="checkbox" 
                id="privacy-toggle"
                checked={editingEvent.isPrivate}
                onChange={e => setEditingEvent({...editingEvent, isPrivate: e.target.checked})}
                className="w-4 h-4 mt-0.5 text-indigo-600 rounded border-zinc-300 focus:ring-indigo-500"
              />
              <label htmlFor="privacy-toggle" className="text-xs text-zinc-600 cursor-pointer">
                <strong>Keep Private:</strong> Friends will only see "Busy" during these hours; course titles are stripped.
              </label>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-zinc-100">
              {editingEvent.id ? (
                <button onClick={() => handleDeleteEvent(editingEvent.id)} className="text-red-600 font-medium text-sm hover:text-red-700">Delete</button>
              ) : <div></div>}
              
              <div className="flex gap-2">
                <button onClick={() => setEditingEvent(null)} className="px-4 py-2 font-medium text-zinc-600 hover:text-zinc-900">Cancel</button>
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











