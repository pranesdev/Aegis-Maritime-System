'use client';

import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import svgPaths from '../imports/Html→Body/svg-ojito7t2v5';
import imgAvatar from '../imports/Html→Body/a52062035fa706d341aac18ad942fcfdb76e8eab.png';
import { getRuntimeEnv } from '@/lib/env';

const LeafletMap = lazy(() => import('@/components/LeafletMap'));

// ── Helpers ──────────────────────────────────────────────────────────────────

function zoneColor(zone) {
  return { SAFE: '#00ff95', ALERT: '#00daf3', WARNING: '#ffb800', DANGER: '#ef4444' }[zone] || '#57607a';
}
function zoneBg(zone) {
  return { SAFE: 'rgba(0,255,149,0.3)', ALERT: 'rgba(0,218,243,0.3)', WARNING: 'rgba(255,184,0,0.3)', DANGER: 'rgba(239,68,68,0.4)' }[zone] || 'rgba(87,96,122,0.3)';
}
function statusColor(s) {
  return { ACTIVE: '#00ff95', CAUTION: '#ffb800', DOCKING: '#849396', OFFLINE: '#57607a' }[s] || '#00ff95';
}
function fmtTime() {
  return new Date().toISOString().slice(11, 19) + ' UTC';
}
function nowHm() {
  const d = new Date();
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
function fmtDate(ts) {
  try {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'UTC' }).format(new Date(ts)) + ' UTC';
  } catch { return ts; }
}

const ZONE_DOT = { SAFE: 'bg-[#00ff95]', WARNING: 'bg-[#ffb800]', DANGER: 'bg-[#ef4444]' };
const ZONE_BADGE = {
  SAFE: 'bg-[rgba(0,255,149,0.15)] border-[rgba(0,255,149,0.3)] text-[#00ff95]',
  WARNING: 'bg-[rgba(255,184,0,0.15)] border-[rgba(255,184,0,0.3)] text-[#ffb800]',
  DANGER: 'bg-[rgba(239,68,68,0.15)] border-[rgba(239,68,68,0.3)] text-[#ef4444]',
};

function ZoneBadge({ zone }) {
  if (!zone) return <span className="text-[#8a96ad]">—</span>;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] font-bold tracking-widest ${ZONE_BADGE[zone] ?? 'bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.1)] text-[#8a96ad]'}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${ZONE_DOT[zone] ?? 'bg-[#8a96ad]'} ${zone === 'WARNING' || zone === 'DANGER' ? 'animate-pulse' : ''}`} />
      {zone}
    </span>
  );
}

function EmptyRow({ cols, loading }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-14 text-center text-[#5a6478] text-[11px] font-bold tracking-widest">
        {loading ? (
          <div className="flex items-center justify-center gap-2">
            <svg className="w-4 h-4 text-[#00daf3] animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            <span>FETCHING RECORDS...</span>
          </div>
        ) : 'NO RECORDS FOUND'}
      </td>
    </tr>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function MaritimeDashboard() {
  const navigate = useNavigate();
  const [vesselId, setVesselId] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeNav, setActiveNav] = useState(null);
  const [activeTopTab, setActiveTopTab] = useState('TACTICAL');
  const [showSettings, setShowSettings] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [weatherLayer, setWeatherLayer] = useState(null);
  const [cloudsTileOn, setCloudsTileOn] = useState(false);
  const [boats, setBoats] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [selectedBoatId, setSelectedBoatId] = useState(null);
  const activeBoatIdRef = useRef(null);
  useEffect(() => {
    activeBoatIdRef.current = selectedBoatId;
  }, [selectedBoatId]);
  const [selectedBoat, setSelectedBoat] = useState(null);
  const [demoMode, setDemoMode] = useState(false);
  const [serverStatus, setServerStatus] = useState('Connecting...');
  const [showDangerAlert, setShowDangerAlert] = useState(false);
  const [dangerAlertBoat, setDangerAlertBoat] = useState('');
  // Right-side push-style alerts. Fired when any boat (real backend
  // OR demo fleet) crosses into the WARNING boundary line. Up to 4
  // visible at once; older ones fall off the bottom of the stack.
  const [toasts, setToasts] = useState([]);
  const [cmdInput, setCmdInput] = useState('');
  const [systemStability, setSystemStability] = useState(99.8);
  const [logisticsData, setLogisticsData] = useState({ totalSupplyCarriers: 0, networkStatus: 'UNKNOWN', vessels: [] });
  const [commsData, setCommsData] = useState({ status: 'OFFLINE', activeChannels: [], logs: [] });
  const [tacticalLogs, setTacticalLogs] = useState([
    { id: 1, timestamp: '14:23:45 UTC', level: 'NOMINAL', message: 'System initialized. Radar arrays online.' },
    { id: 2, timestamp: '14:25:12 UTC', level: 'WARNING', message: 'Unidentified vessel detected in sector 4.' },
    { id: 3, timestamp: '14:28:05 UTC', level: 'CRITICAL', message: 'Vessel breached boundary zone. Intercept recommended.' }
  ]);
  const [lastUpdate, setLastUpdate] = useState(nowHm());
  const [rawDistance, setRawDistance] = useState(99);
  const [envData, setEnvData] = useState({ windSpeed: 18, swellHeight: 2.4, loading: true });
  
  // Detailed Logs State
  const [logsActiveTab, setLogsActiveTab] = useState('movement');
  const [historyMovements, setHistoryMovements] = useState([]);
  const [historyZoneEvents, setHistoryZoneEvents] = useState([]);
  const [boatFilter, setBoatFilter] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState(null);
  
  const previousZoneRef = useRef('UNKNOWN');

  // Check auth
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/login');
    }
  }, [navigate]);

  // Close dropdowns on outside click (simple approximation: just close on any nav change)
  useEffect(() => {
    setShowSettings(false);
    setShowNotifications(false);
    setShowProfile(false);
  }, [activeTopTab, activeNav]);

  // Fetch real-time environmental data
  useEffect(() => {
    let active = true;
    const fetchEnv = async () => {
      try {
        setEnvData(prev => ({ ...prev, loading: true }));
        // Default to a central coordinate in the Indian Ocean near Tamil Nadu
        const lat = 10.0;
        const lon = 79.5;
        const [marineRes, weatherRes] = await Promise.all([
          fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&current=wave_height`),
          fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=a63a66e50c1159983af837acb9e4efa8`)
        ]);
        const marine = await marineRes.json();
        const weather = await weatherRes.json();
        if (active) {
          const windMps = weather.wind?.speed ?? 0;
          const windKnots = windMps * 1.94384;
          const rainMm = weather.rain?.['1h'] ?? (weather.rain?.['3h'] ?? 0);
          
          setEnvData({
            windSpeed: windKnots,
            swellHeight: marine.current?.wave_height ?? 0,
            clouds: weather.clouds?.all ?? 0,
            pressure: weather.main?.pressure ?? 1012,
            storms: rainMm,
            loading: false
          });
        }
      } catch (err) {
        if (active) setEnvData(prev => ({ ...prev, loading: false }));
      }
    };
    fetchEnv();
    const interval = setInterval(fetchEnv, 300000); // 5 minutes
    return () => { active = false; clearInterval(interval); };
  }, []);

  // Detailed Logs fetcher
  const fetchLogsData = useCallback(async () => {
    setLogsLoading(true);
    setLogsError(null);
    try {
      const BACKEND = getRuntimeEnv().NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000';
      const token = localStorage.getItem('token');
      const headers = { Authorization: `Bearer ${token}` };
      const qs = boatFilter.trim() ? `?boatId=${encodeURIComponent(boatFilter.trim())}` : '';
      const [movRes, alertRes] = await Promise.all([
        fetch(`${BACKEND}/api/location/history${qs}`, { headers }),
        fetch(`${BACKEND}/api/alerts${qs}`, { headers }),
      ]);
      if (movRes.ok) setHistoryMovements(await movRes.json());
      if (alertRes.ok) setHistoryZoneEvents(await alertRes.json());
    } catch {
      setLogsError('SYSTEM OFFLINE');
    } finally {
      setLogsLoading(false);
    }
  }, [boatFilter]);

  useEffect(() => {
    if (activeTopTab === 'DETAILED LOGS') {
      const id = setTimeout(fetchLogsData, boatFilter ? 400 : 0);
      return () => clearTimeout(id);
    }
  }, [fetchLogsData, boatFilter, activeTopTab]);

  // Backend Integration hooks
  const handleLocationUpdate = useCallback((lat, lng) => {
    // handled by boats state
  }, []);

  const handleProximityUpdate = useCallback((distance) => {
    setRawDistance(distance);
  }, []);

  const handleSpeedUpdate = useCallback((speed) => {}, []);
  const handleZoneUpdate = useCallback((z) => {}, []);
  const handleEEZUpdate = useCallback((name) => {}, []);

  const handleBoatSelect = useCallback((boat) => {
    setSelectedBoat(boat);
    setSelectedBoatId(boat.boatId);
  }, []);

  const addAlert = useCallback((msg, level) => {
    const entry = { id: Date.now().toString(), time: fmtTime(), message: msg, level };
    setAlerts(prev => [entry, ...prev.slice(0, 29)]);
  }, []);

  // Track per-boat zone transitions so we can write a quiet line into
  // the bell-icon notifications panel AND fire a right-side push
  // notification when any vessel crosses into the WARNING (or DANGER)
  // boundary line. Throttled per boat+zone so the 250 ms demo tick
  // doesn't spam.
  const lastZoneByBoatRef = useRef(new Map());
  const lastAlertAtRef = useRef(new Map());

  // Push a self-contained alert card onto the right-side toast stack.
  // Auto-dismisses after `durationMs` (default 6 s).
  const pushWarningToast = useCallback((boatId, zone) => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const isDanger = zone === 'DANGER';
    
    if (isDanger) {
      setShowDangerAlert(true);
      setDangerAlertBoat(boatId);
    }

    setToasts(prev => [
      ...prev,
      {
        id,
        boatId,
        zone,
        title: isDanger ? 'DANGER ZONE BREACH' : 'WARNING LINE CROSSED',
        body: isDanger
          ? `${boatId} crossed into DANGER zone.`
          : `${boatId} reached the WARNING boundary line.`,
        durationMs: 6000,
        createdAt: Date.now(),
      },
    ]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
      // Store in notification tab after popup is finished
      addAlert(
        isDanger ? `${boatId} crossed into DANGER zone.` : `${boatId} reached the WARNING boundary line.`,
        isDanger ? 'danger' : 'warning'
      );
    }, 6000);
  }, [addAlert]);

  const handleBoatsUpdate = useCallback((nextBoats) => {
      setBoats(nextBoats);

      // Per-boat zone history: log every upgrade transition into the
      // bell-icon notifications panel, AND fire a right-side push
      // toast when the boat reaches WARNING (or DANGER) — the user
      // explicitly asked for a popup on the WARNING line.
      const history = lastZoneByBoatRef.current;
      const lastAlert = lastAlertAtRef.current;
      const now = Date.now();
      const RANK = { SAFE: 0, ALERT: 1, WARNING: 2, DANGER: 3 };
      for (const b of nextBoats) {
        const prev = history.get(b.boatId) ?? 'SAFE';
        const next = b.zone ?? 'SAFE';
        if (prev === next) continue;
        history.set(b.boatId, next);
        const prevRank = RANK[prev] ?? 0;
        const nextRank = RANK[next] ?? 0;
        if (nextRank <= prevRank) continue;
        if (next === 'SAFE') continue;
        const key = `${b.boatId}|${next}`;
        const lastAt = lastAlert.get(key) ?? 0;
        if (now - lastAt < 8000) continue;
        lastAlert.set(key, now);
        addAlert(
          `Vessel ${b.boatId} entered ${next} zone.`,
          next === 'DANGER' ? 'danger' : next === 'WARNING' ? 'warning' : 'info'
        );
        // Right-side push popup on WARNING line breach (and on
        // DANGER, since DANGER > WARNING). ALERT is too noisy to
        // pop up — it just gets a quiet log entry.
        if (next === 'WARNING' || next === 'DANGER') {
          pushWarningToast(b.boatId, next);
        }
      }
      // Garbage-collect: forget boats that have left the fleet.
      for (const key of history.keys()) {
        if (!nextBoats.some(b => b.boatId === key)) history.delete(key);
      }

      if (!activeBoatIdRef.current && nextBoats.length > 0) {
        setSelectedBoatId(nextBoats[0].boatId);
        setSelectedBoat(nextBoats[0]);
        return;
      }
      if (activeBoatIdRef.current) {
        const selected = nextBoats.find((b) => b.boatId === activeBoatIdRef.current) || null;
        if (selected) {
          setSelectedBoat(selected);
        }
      }
  }, [addAlert, pushWarningToast]);

  // Backend connection & polling
  useEffect(() => {
    const BACKEND_URL = getRuntimeEnv().NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000';
    const token = localStorage.getItem('token') || '';
    const headers = { 'Authorization': `Bearer ${token}` };
    
    // Socket.io connection
    const socket = io(BACKEND_URL, {
      extraHeaders: headers
    });
    
    socket.on('connect', () => {
      setServerStatus('Backend Connected');
    });
    
    socket.on('disconnect', () => {
      setServerStatus('Connecting...');
    });
    
    socket.on('locationUpdate', (newData) => {
      setBoats(prev => {
        const exists = prev.find(b => b.boatId === newData.boatId);
        if (exists) {
          return prev.map(b => b.boatId === newData.boatId ? { ...b, ...newData } : b);
        }
        return [...prev, { ...newData, speed: 12.5, heading: 45, type: 'PATROL CLASS', group: 'SECTOR ' + (prev.length + 1), status: 'ACTIVE' }];
      });
    });
    
    socket.on('alertEvent', (alert) => {
      setAlerts(prev => [{
        id: alert._id || String(Date.now()),
        time: new Date(alert.timestamp).toISOString().slice(11, 19) + ' UTC',
        message: `Zone: ${alert.zone} at ${alert.lat?.toFixed(4)}, ${alert.lon?.toFixed(4)}`,
        level: alert.zone === 'DANGER' ? 'danger' : alert.zone === 'WARNING' ? 'warning' : 'info'
      }, ...prev].slice(0, 8));
    });

    const load = async () => {
      try {
        const [alertRes, latestRes, logRes, commRes] = await Promise.all([
          fetch(`${BACKEND_URL}/api/alerts`, { headers }),
          fetch(`${BACKEND_URL}/api/location/latest`, { headers }),
          fetch(`${BACKEND_URL}/api/logistics`, { headers }),
          fetch(`${BACKEND_URL}/api/comms/latest`, { headers })
        ]);
        if (alertRes.ok) {
           const alertData = await alertRes.json();
           const formatted = alertData.map((a, i) => ({
             id: a._id || String(i),
             time: new Date(a.timestamp).toISOString().slice(11, 19) + ' UTC',
             message: `Zone: ${a.zone} at ${a.lat?.toFixed(4)}, ${a.lon?.toFixed(4)}`,
             level: a.zone === 'DANGER' ? 'danger' : a.zone === 'WARNING' ? 'warning' : 'info'
           }));
           if (formatted.length > 0) {
             setAlerts(formatted);
           } else {
             setAlerts([
               { id: 'init-1', time: fmtTime(), message: 'System initialized. Tactical log ready.', level: 'info' }
             ]);
           }
        }
        
        if (latestRes.ok) {
          const rows = await latestRes.json();
          if (Array.isArray(rows)) {
            const normalized = rows
              .filter((r) => r?.lat !== undefined && r?.lon !== undefined)
              .map((r, i) => ({
                boatId: String(r.boatId || 'BOAT1'),
                lat: Number(r.lat),
                lon: Number(r.lon),
                zone: r.zone || 'SAFE',
                speed: 12.5,
                heading: 45,
                type: 'PATROL CLASS',
                group: 'SECTOR ' + (i+1),
                status: 'ACTIVE'
              }));
            setBoats(normalized);
            setLastUpdate(nowHm());
          }
        }
        
        if (logRes.ok) {
           const logData = await logRes.json();
           setLogisticsData(logData);
        }
        
        if (commRes.ok) {
           const commData = await commRes.json();
           setCommsData(commData);
        }
        
      } catch (err) {
        console.error("Fetch error:", err);
      }
    };
    load();
    const id = setInterval(load, 5_000);
    return () => {
      clearInterval(id);
      socket.disconnect();
    };
  }, []);

  const currentZone = selectedBoat?.zone ?? 'SAFE';
  const currentLocation = selectedBoat ? { lat: selectedBoat.lat, lon: selectedBoat.lon } : { lat: 1.29, lon: 103.85 };
  const proximityToBorder = rawDistance < 99 ? rawDistance.toFixed(1) : (selectedBoat ? Math.round((selectedBoat.zone === 'DANGER' ? 1.2 : selectedBoat.zone === 'WARNING' ? 4.5 : selectedBoat.zone === 'ALERT' ? 8.3 : 24) * 10) / 10 : 24);
  const currentSpeed = selectedBoat?.speed ?? 0;
  const nearestEEZ = 'SCS-ZONE-7B';

  // Zone transition for the SELECTED boat's proximity banner (top of screen).
// The push-toast system in handleBoatsUpdate already covers every vessel.
useEffect(() => {
    const prev = previousZoneRef.current;
    if (currentZone !== prev && currentZone !== 'UNKNOWN' && prev !== 'UNKNOWN') {
      // No-op — keep the ref in sync so the next comparison is fresh.
    }
    previousZoneRef.current = currentZone;
  }, [currentZone]);

  const filteredBoats = vesselId ? boats.filter(b => b.boatId.toLowerCase().includes(vesselId.toLowerCase())) : boats;

  function handleCmdSubmit() {
    if (!cmdInput.trim()) return;
    addAlert(`CMD: ${cmdInput}`, 'info');
    setCmdInput('');
  }

  const navItems = [
    { label: 'Fleet', icon: <svg viewBox="0 0 18.45 20" className="w-[18px] h-[20px]"><path d={svgPaths.p348f1400} fill="currentColor" /></svg> },
    { label: 'Sensors', icon: <svg viewBox="0 0 20 20" className="w-5 h-5"><path d={svgPaths.pb4d1000} fill="currentColor" /></svg> },
    { label: 'Threats', icon: <svg viewBox="0 0 22 19" className="w-[22px] h-[19px]"><path d={svgPaths.p7555480} fill="currentColor" /></svg> },
    { label: 'Weather', icon: <svg viewBox="0 0 22 16" className="w-[22px] h-[16px]"><path d={svgPaths.pebcf900} fill="currentColor" /></svg> },
    { label: 'Live Feed', icon: <svg viewBox="0 0 24 24" className="w-[19px] h-[20px]"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" fill="currentColor"/></svg> },
  ];

  const isConnected = serverStatus === 'Backend Connected' || serverStatus?.startsWith('Demo Mode Active');

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#020817]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
      
      {/* ── Background Map Layer (No filter to keep natural satellite colors) ── */}
      <div className="absolute inset-0 z-0 bg-[#020817]">
        <Suspense fallback={<div className="flex w-full h-full items-center justify-center text-cyan-400">Loading Map...</div>}>
           <LeafletMap
              onLocationUpdate={handleLocationUpdate}
              onProximityUpdate={handleProximityUpdate}
              onSpeedUpdate={handleSpeedUpdate}
              onStatusUpdate={setServerStatus}
              onZoneUpdate={handleZoneUpdate}
              onEEZUpdate={handleEEZUpdate}
              onBoatSelect={handleBoatSelect}
              onBoatsUpdate={handleBoatsUpdate}
              selectedBoatId={selectedBoatId}
              demoMode={demoMode}
              weatherLayer={activeNav === 'Weather' ? weatherLayer : null}
              cloudsTileOn={activeNav === 'Weather' ? cloudsTileOn : false}
              // Hover inspector (the floating callout under the cursor)
              // is only useful on the Weather tab — disable everywhere
              // else so it doesn't pop up over Fleet / Sensors / etc.
              enableHoverInspector={activeNav === 'Weather' && activeTopTab === 'TACTICAL'}
              // Cloud-cover tile toggle (independent of the active layer).
              cloudsTileOn={cloudsTileOn}
            />
        </Suspense>
      </div>

      {/* ── Weather Canvas Overlay (SkyLayer UI) ── */}

      <header className="absolute top-4 left-4 right-4 h-[52px] bg-gradient-aegis-rich grain-overlay glass-panel rounded-2xl px-6 flex items-center gap-8 z-20 pointer-events-auto">
        <span className="text-[#c3f5ff] text-[17px] font-bold tracking-[0.06em] shrink-0 z-10 relative" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          AEGIS MARITIME COMMAND
        </span>
        <div className="flex items-center gap-1.5 z-10 relative">
          {['TACTICAL', 'BOUNDARY GRID', 'LOGISTICS', 'COMMS', 'DETAILED LOGS'].map(tab => (
            <button key={tab} onClick={() => setActiveTopTab(tab)} className={`px-4 py-1.5 text-[11px] tracking-widest rounded-md transition-all cursor-pointer ${activeTopTab === tab ? 'text-[#c3f5ff] bg-[rgba(195,245,255,0.08)] font-semibold shadow-inner border border-[rgba(0,218,243,0.3)]' : 'text-[#bac9cc] border border-transparent hover:text-[#dce4e5] hover:bg-[rgba(255,255,255,0.04)]'}`}>
              {tab}
            </button>
          ))}
        </div>
        
<div className="flex-1 flex justify-center pointer-events-none z-10 relative"></div>

        <div className="flex items-center gap-4 ml-2 shrink-0 z-10 relative">
          {/* Settings */}
          <div className="relative flex items-center">
            <button onClick={() => {setShowSettings(!showSettings); setShowNotifications(false); setShowProfile(false);}} className={`transition-colors cursor-pointer icon-pop ${showSettings ? 'text-[#c3f5ff]' : 'text-[#bac9cc] hover:text-[#c3f5ff]'}`}>
              <svg viewBox="0 0 20 20" className="w-5 h-5"><path d={svgPaths.p3cdadd00} fill="currentColor" /></svg>
            </button>
            {showSettings && (
              <div className="absolute top-[180%] right-[-10px] w-64 bg-gradient-aegis-rich grain-overlay glass-panel rounded-xl shadow-[0_15px_50px_rgba(0,0,0,0.6)] p-4 z-[5000] animate-fade-in overflow-hidden">
                 <div className="text-[#c3f5ff] text-[12px] font-bold tracking-widest mb-3 border-b border-[rgba(8,164,167,0.3)] pb-2 relative z-10">SYSTEM SETTINGS</div>
                 <div className="flex flex-col gap-3 text-[11px] text-[#dce4e5] relative z-10">
                   <label className="flex items-center justify-between cursor-pointer group"><span className="tracking-wider group-hover:text-[#00daf3] transition-colors">AUDIO ALERTS</span><input type="checkbox" defaultChecked className="accent-[#00daf3]" /></label>
                   <label className="flex items-center justify-between cursor-pointer group"><span className="tracking-wider group-hover:text-[#00daf3] transition-colors">HIGH CONTRAST</span><input type="checkbox" className="accent-[#00daf3]" /></label>
                   <label className="flex items-center justify-between cursor-pointer group"><span className="tracking-wider group-hover:text-[#00daf3] transition-colors">DATA STREAM</span><input type="checkbox" defaultChecked className="accent-[#00daf3]" /></label>
                   <label className="flex items-center justify-between cursor-pointer group mt-2 pt-2 border-t border-[rgba(8,164,167,0.3)]"><span className="tracking-wider text-[#ef4444] font-bold">CLEAR CACHE</span></label>
                 </div>
              </div>
            )}
          </div>
          
          {/* Notifications */}
          <div className="relative flex items-center">
            <button onClick={() => {setShowNotifications(!showNotifications); setShowSettings(false); setShowProfile(false);}} className={`transition-colors cursor-pointer icon-pop relative ${showNotifications ? 'text-[#c3f5ff]' : 'text-[#bac9cc] hover:text-[#c3f5ff]'}`}>
              <svg viewBox="0 0 16 20" className="w-4 h-5"><path d={svgPaths.p164b49c0} fill="currentColor" /></svg>
              {alerts.length > 0 && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-[#ef4444] rounded-full animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.8)]" />}
            </button>
            {showNotifications && (
              <div className="absolute top-[180%] right-[-10px] w-80 bg-gradient-aegis-rich grain-overlay glass-panel rounded-xl shadow-[0_15px_50px_rgba(0,0,0,0.6)] overflow-hidden z-[5000] flex flex-col max-h-[350px] animate-fade-in">
                 <div className="px-4 py-3 border-b border-[rgba(8,164,167,0.3)] flex justify-between items-center relative z-10 bg-[rgba(3,15,38,0.4)]">
                   <span className="text-[#c3f5ff] text-[12px] font-bold tracking-widest">RECENT ALERTS</span>
                   <button className="text-[9px] text-[#8a96ad] hover:text-[#c3f5ff] transition-colors cursor-pointer" onClick={() => setAlerts([])}>CLEAR ALL</button>
                 </div>
                 <div className="overflow-y-auto p-2 flex flex-col gap-1 custom-scrollbar relative z-10">
                   {alerts.length === 0 ? <div className="text-center p-6 text-[#5a6478] text-[10px]">No alerts</div> : 
                     alerts.slice(0, 8).map(a => (
                       <div key={a.id} className="px-3 py-2 bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.06)] rounded-lg text-[10px] text-[#dce4e5] cursor-pointer transition-colors border border-transparent hover:border-[rgba(8,164,167,0.5)]">
                         <div className="font-bold mb-1" style={{ color: a.level === 'danger' ? '#ef4444' : a.level === 'warning' ? '#ffb800' : '#00daf3' }}>{a.time}</div>
                         <div className="leading-relaxed opacity-90">{a.message}</div>
                       </div>
                     ))
                   }
                 </div>
              </div>
            )}
          </div>
          
          {/* Profile */}
          <div className="relative flex items-center">
            <button onClick={() => {setShowProfile(!showProfile); setShowSettings(false); setShowNotifications(false);}} className={`transition-colors cursor-pointer icon-pop ${showProfile ? 'text-[#c3f5ff]' : 'text-[#bac9cc] hover:text-[#c3f5ff]'}`}>
              <svg viewBox="0 0 20 20" className="w-5 h-5"><path d={svgPaths.p3de21300} fill="currentColor" /></svg>
            </button>
            {showProfile && (
              <div className="absolute top-[180%] right-[-10px] w-60 bg-gradient-aegis-rich grain-overlay glass-panel rounded-xl shadow-[0_15px_50px_rgba(0,0,0,0.6)] p-5 z-[5000] flex flex-col items-center animate-fade-in overflow-hidden">
                 <div className="relative z-10 flex flex-col items-center w-full">
                   <div className="w-16 h-16 bg-[#00e5ff] rounded-full overflow-hidden relative mb-4 border-2 border-[rgba(195,245,255,0.4)] shadow-[0_0_20px_rgba(0,229,255,0.2)] hover-lift">
                     <img src={imgAvatar} alt="" className="absolute h-full left-[-70%] top-0 w-[240%] max-w-none opacity-90 mix-blend-multiply" />
                   </div>
                   <div className="text-[#c3f5ff] text-[15px] font-bold tracking-[0.06em] mb-1" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>ADMIRAL J.</div>
                   <div className="text-[#00ff95] text-[10px] tracking-widest font-bold mb-5 bg-[rgba(0,255,149,0.1)] px-3 py-1 rounded-full border border-[rgba(0,255,149,0.2)]">CLEARANCE: LEVEL 7</div>
                   <div className="w-full h-[1px] bg-[rgba(8,164,167,0.3)] mb-3" />
                   <button onClick={() => { localStorage.removeItem('token'); localStorage.removeItem('role'); navigate('/login'); }} className="w-full py-2.5 bg-[rgba(239,68,68,0.1)] text-[10px] text-[#ef4444] border border-transparent hover:border-[rgba(239,68,68,0.5)] hover:bg-[rgba(239,68,68,0.2)] rounded-lg tracking-widest font-bold cursor-pointer transition-all">SECURE LOGOUT</button>
                 </div>
              </div>
            )}
          </div>
        </div>
      </header>
      {/* ── Weather Toggle Pill ── */}
      <div className={`absolute top-[72px] left-1/2 -translate-x-1/2 z-20 transition-all duration-300 ${activeNav === 'Weather' && activeTopTab === 'TACTICAL' ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-gradient-aegis-rich grain-overlay glass-panel rounded-full p-1 relative overflow-hidden">
            <div className="relative z-10 flex">
            {['wind', 'clouds', 'storm', 'pressure'].map(mode => (
              <button
                key={mode}
                onClick={() => setWeatherLayer(mode)}
                className={`px-6 py-2 text-[10px] font-bold tracking-[0.15em] rounded-full transition-all ${weatherLayer === mode ? 'bg-[#304865] text-[#c3f5ff] shadow-inner border border-[rgba(0,218,243,0.3)]' : 'text-[#8a96ad] hover:text-[#dce4e5] hover:bg-[rgba(255,255,255,0.04)]'}`}
              >
                {mode === 'clouds' ? 'PRECIPITATION' : mode.toUpperCase()}
              </button>
            ))}
            </div>
          </div>
          <button 
            onClick={() => setCloudsTileOn(!cloudsTileOn)} 
            className={`flex items-center justify-center w-9 h-9 rounded-full bg-gradient-aegis-rich grain-overlay glass-panel transition-all relative overflow-hidden ${cloudsTileOn ? 'text-[#c3f5ff] border-[rgba(0,218,243,0.3)]' : 'text-[#8a96ad] hover:text-[#dce4e5]'}`}
            title="Toggle Clouds Tile"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="relative z-10">
              <path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM19 18H6c-2.21 0-4-1.79-4-4s1.79-4 4-4h.71C7.37 7.69 9.48 6 12 6c3.04 0 5.5 2.46 5.5 5.5v.5H19c1.66 0 3 1.34 3 3s-1.34 3-3 3z"/>
            </svg>
          </button>
        </div>
      </div>
      
      {/* ── Weather Legends ── */}
      <div className={`absolute bottom-6 left-[80px] z-20 transition-all duration-300 ${activeNav === 'Weather' && activeTopTab === 'TACTICAL' ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
        <div className="bg-gradient-aegis-rich grain-overlay glass-panel rounded-xl p-4 text-[#dfe6f0] text-[11px] w-[260px] relative">
          <div className="font-semibold mb-2 text-[#f2f5fa] relative z-10">
            {weatherLayer === 'wind' ? 'Wind (Bft)' : weatherLayer === 'clouds' ? 'Precipitation (mm/h)' : weatherLayer === 'storm' ? 'Storm/Precipitation (mm/h)' : 'Pressure (hPa)'}
          </div>
          <div className="w-full h-[9px] rounded-[5px] my-1.5" style={{
            background: weatherLayer === 'wind' ? 'linear-gradient(to right, rgb(35,70,170) 0%, rgb(35,150,185) 25%, rgb(70,185,120) 41.7%, rgb(190,215,80) 58.3%, rgb(230,180,60) 75%, rgb(230,120,50) 83.3%, rgb(210,70,50) 91.7%, rgb(150,30,40) 100%)' :
                        weatherLayer === 'clouds' ? 'linear-gradient(to right, rgb(10,30,50) 0%, rgb(100,150,250) 20%, rgb(50,100,220) 40%, rgb(20,50,180) 60%, rgb(150,50,150) 80%, rgb(255,0,0) 100%)' :
                        weatherLayer === 'storm' ? 'linear-gradient(to right, rgb(10,30,50) 0%, rgb(100,150,250) 20%, rgb(50,100,220) 40%, rgb(20,50,180) 60%, rgb(150,50,150) 80%, rgb(255,0,0) 100%)' :
                        'linear-gradient(to right, rgb(40,60,150) 0%, rgb(70,110,190) 20%, rgb(140,180,210) 40%, rgb(225,220,200) 60%, rgb(220,150,90) 80%, rgb(190,70,50) 100%)'
          }}></div>
          <div className="flex justify-between text-[9px] text-[#93a0b6] relative z-10">
            {weatherLayer === 'wind' ? (
              <><span>0</span><span>3</span><span>5</span><span>7</span><span>9</span><span>10</span><span>11</span><span>12</span></>
            ) : weatherLayer === 'clouds' ? (
              <><span>0</span><span>0.5</span><span>2</span><span>5</span><span>10</span><span>20+</span></>
            ) : weatherLayer === 'storm' ? (
              <><span>0</span><span>0.5</span><span>2</span><span>5</span><span>10</span><span>20+</span></>
            ) : (
              <><span>970</span><span>985</span><span>1000</span><span>1015</span><span>1030</span><span>1045</span></>
            )}
          </div>
        </div>
      </div>


      {/* ── Top Tabs Overlays ── */}
      {activeTopTab !== 'TACTICAL' && activeTopTab !== 'BOUNDARY GRID' && (
        <div className="absolute inset-0 z-[15] backdrop-blur-xl bg-[rgba(2,8,23,0.85)] pointer-events-auto flex items-center justify-center p-20 animate-fade-in">
           {activeTopTab === 'STRATEGIC' && (
             <div className="w-full h-full border border-[rgba(59,73,76,0.6)] rounded-3xl flex flex-col p-10 shadow-[0_0_50px_rgba(0,0,0,0.5)] relative overflow-hidden bg-[rgba(10,15,20,0.5)]">
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[rgba(0,218,243,0.05)] rounded-full blur-[100px] pointer-events-none" />
                <h1 className="text-[#c3f5ff] text-[36px] font-bold tracking-[0.1em] mb-10" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>STRATEGIC OVERVIEW</h1>
                <div className="grid grid-cols-3 gap-8 flex-1">
                  <div className="bg-[rgba(10,14,26,0.5)] border border-[rgba(59,73,76,0.6)] rounded-2xl p-8 flex flex-col justify-between hover:border-[rgba(195,245,255,0.3)] transition-colors">
                    <div>
                      <h3 className="text-[#8a96ad] text-[12px] font-bold tracking-widest mb-4">GLOBAL FLEET READINESS</h3>
                      <div className="text-[64px] text-[#00ff95] font-bold mb-2 leading-none" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>94%</div>
                      <div className="text-[12px] text-[#dce4e5] opacity-80 leading-relaxed mt-4">All primary patrol vessels are fully operational and responding to automated ping sequences within nominal thresholds.</div>
                    </div>
                    <div className="w-full h-3 bg-[#192122] rounded-full overflow-hidden mt-6 shadow-inner"><div className="w-[94%] h-full bg-gradient-to-r from-[#00daf3] to-[#00ff95]" /></div>
                  </div>
                  <div className="bg-[rgba(10,14,26,0.5)] border border-[rgba(59,73,76,0.6)] rounded-2xl p-8 flex flex-col justify-between hover:border-[rgba(195,245,255,0.3)] transition-colors">
                    <div>
                      <h3 className="text-[#8a96ad] text-[12px] font-bold tracking-widest mb-4">ACTIVE THEATERS</h3>
                      <div className="text-[64px] text-[#c3f5ff] font-bold mb-2 leading-none" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>03</div>
                      <div className="text-[14px] text-[#00daf3] font-bold mt-4 tracking-wider">SCS-7B, IO-4A, PAC-9</div>
                    </div>
                    <div className="flex gap-2 mt-6">
                      <div className="h-3 flex-1 bg-[rgba(0,218,243,0.3)] rounded-full" />
                      <div className="h-3 flex-1 bg-[rgba(0,218,243,0.3)] rounded-full" />
                      <div className="h-3 flex-1 bg-[rgba(0,218,243,0.3)] rounded-full" />
                    </div>
                  </div>
                  <div className="bg-[rgba(10,14,26,0.5)] border border-[rgba(239,68,68,0.3)] rounded-2xl p-8 flex flex-col justify-between hover:border-[rgba(239,68,68,0.6)] transition-colors relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-b from-[rgba(239,68,68,0.1)] to-transparent pointer-events-none" />
                    <div className="relative">
                      <h3 className="text-[#ef4444] text-[12px] font-bold tracking-widest mb-4">DEFENSE POSTURE</h3>
                      <div className="text-[42px] text-[#ef4444] font-bold mb-2 leading-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>ELEVATED</div>
                      <div className="text-[12px] text-[#dce4e5] opacity-80 mt-4 leading-relaxed">Protocol Omega is active due to unidentified contacts in sector 7B. Recommend standby for potential intercept vectors.</div>
                    </div>
                    <button className="w-full py-3 bg-[rgba(239,68,68,0.15)] text-[#ef4444] font-bold tracking-widest text-[12px] rounded-xl border border-[rgba(239,68,68,0.4)] hover:bg-[rgba(239,68,68,0.25)] transition-colors mt-6 cursor-pointer relative">REVIEW PROTOCOLS</button>
                  </div>
                </div>
             </div>
           )}
           {activeTopTab === 'LOGISTICS' && (
             <div className="w-full h-full border border-[rgba(59,73,76,0.6)] rounded-3xl flex flex-col p-10 shadow-[0_0_50px_rgba(0,0,0,0.5)] bg-[rgba(10,15,20,0.5)] overflow-hidden">
                <div className="flex items-center justify-between mb-8">
                  <h1 className="text-[#c3f5ff] text-[36px] font-bold tracking-[0.1em]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>SUPPLY & LOGISTICS</h1>
                  <div className="flex gap-4">
                    <div className="bg-[rgba(30,40,45,0.6)] px-4 py-2 rounded-lg border border-[rgba(59,73,76,0.5)] text-[#dce4e5] text-[11px] font-bold tracking-widest">TOTAL SUPPLY CARRIERS: {logisticsData.totalSupplyCarriers}</div>
                    <div className="bg-[rgba(0,255,149,0.1)] px-4 py-2 rounded-lg border border-[rgba(0,255,149,0.3)] text-[#00ff95] text-[11px] font-bold tracking-widest">NETWORK: {logisticsData.networkStatus}</div>
                  </div>
                </div>
                <div className="flex-1 bg-[rgba(10,14,26,0.5)] border border-[rgba(59,73,76,0.6)] rounded-2xl p-6 overflow-hidden flex flex-col">
                   <div className="overflow-y-auto custom-scrollbar flex-1 pr-4">
                     <table className="w-full text-left text-[12px] text-[#dce4e5]">
                       <thead>
                         <tr className="text-[#8a96ad] tracking-widest border-b border-[rgba(59,73,76,0.5)] sticky top-0 bg-[rgba(10,14,26,0.9)] backdrop-blur-sm z-10">
                           <th className="pb-4 pt-2 font-bold px-4">VESSEL ID</th>
                           <th className="pb-4 pt-2 font-bold px-4">STATUS</th>
                           <th className="pb-4 pt-2 font-bold px-4">FUEL LEVEL</th>
                           <th className="pb-4 pt-2 font-bold px-4">AMMUNITION</th>
                           <th className="pb-4 pt-2 font-bold px-4 text-right">MAINTENANCE SCHED</th>
                         </tr>
                       </thead>
                       <tbody>
                         {logisticsData.vessels.map((v, i) => (
                           <tr key={i} className="border-b border-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.02)] transition-colors">
                             <td className="py-5 font-bold tracking-wider px-4 text-[#c3f5ff]">{v.id}</td>
                             <td className="py-5 px-4"><span className="bg-[rgba(0,255,149,0.15)] text-[#00ff95] px-2 py-1 rounded text-[10px] font-bold tracking-wider">{v.status}</span></td>
                             <td className="py-5 px-4">
                               <div className="flex items-center gap-4">
                                 <div className="w-32 h-1.5 bg-[#192122] rounded-full overflow-hidden shadow-inner"><div className={`h-full ${v.fuel > 40 ? 'bg-[#00ff95]' : 'bg-[#ffb800]'}`} style={{width:`${v.fuel}%`}}/></div>
                                 <span className="text-[11px] font-bold text-[#8a96ad] w-8">{Math.round(v.fuel)}%</span>
                               </div>
                             </td>
                             <td className="py-5 px-4"><span className="text-[#00daf3] font-bold tracking-widest">{v.ammo}</span></td>
                             <td className="py-5 px-4 text-right text-[#8a96ad] font-mono">{v.maintenance}</td>
                           </tr>
                         ))}
                       </tbody>
                     </table>
                   </div>
                </div>
             </div>
           )}
           {activeTopTab === 'COMMS' && (
             <div className="w-full h-full border border-[rgba(59,73,76,0.6)] rounded-3xl flex flex-col p-10 shadow-[0_0_50px_rgba(0,0,0,0.5)] bg-[rgba(10,15,20,0.5)]">
                <h1 className="text-[#c3f5ff] text-[36px] font-bold tracking-[0.1em] mb-8" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>ENCRYPTED COMMS RELAY</h1>
                <div className="flex gap-8 flex-1 min-h-0">
                  <div className="flex-1 bg-[#020817] border border-[rgba(59,73,76,0.6)] rounded-2xl p-8 font-mono text-[13px] leading-relaxed text-[#00ff95] overflow-y-auto custom-scrollbar shadow-inner relative">
                     <div className="absolute top-4 right-4 text-[10px] bg-[rgba(0,255,149,0.1)] text-[#00ff95] px-3 py-1 rounded-full font-sans font-bold tracking-widest border border-[rgba(0,255,149,0.3)]">{commsData.status}</div>
                     <div className="opacity-70">&gt; INITIALIZING SECURE HANDSHAKE... OK</div>
                     <div className="opacity-70">&gt; QUANTUM KEY EXCHANGE... SUCCESS (AES-256-GCM)</div>
                     <div className="opacity-70">&gt; UPLINK TO SATELLITE NETWORK... ESTABLISHED</div>
                     
                     {commsData.logs.map((log, i) => (
                       <div key={i}>
                         <div className={`mt-6 font-bold ${log.type === 'incoming' ? 'text-[#00daf3]' : 'text-[#ffb800]'}`}>&gt; {log.type === 'incoming' ? 'INCOMING' : 'OUTGOING'} TRANSMISSION [{log.sender}] : {new Date(log.time).toISOString().slice(11, 19)} UTC</div>
                         <div className={`text-[#dce4e5] mt-3 pl-5 border-l-2 py-2 rounded-r-lg ${log.type === 'incoming' ? 'border-[rgba(0,218,243,0.5)] bg-[rgba(0,218,243,0.05)]' : 'border-[rgba(255,184,0,0.5)] bg-[rgba(255,184,0,0.05)]'}`}>
                           "{log.message}"
                         </div>
                       </div>
                     ))}
                     <div className="mt-6 flex items-center gap-2">
                       <span className="text-[#00ff95]">&gt; AWAITING INPUT</span>
                       <span className="w-2.5 h-4 bg-[#00ff95] animate-pulse" />
                     </div>
                  </div>
                  <div className="w-80 flex flex-col gap-6 shrink-0">
                    <div className="bg-[rgba(10,14,26,0.5)] border border-[rgba(59,73,76,0.6)] rounded-2xl p-6 flex-1">
                      <h3 className="text-[#8a96ad] text-[11px] font-bold tracking-widest mb-4">ACTIVE CHANNELS</h3>
                      <div className="flex flex-col gap-3">
                        {(commsData.activeChannels || []).map((ch, i) => (
                          <div key={ch} className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-colors ${i===0 ? 'bg-[rgba(0,218,243,0.1)] border-[rgba(0,218,243,0.4)]' : 'bg-[rgba(255,255,255,0.03)] border-transparent hover:border-[rgba(59,73,76,0.6)]'}`}>
                            <span className={`text-[11px] font-bold tracking-wider ${i===0 ? 'text-[#c3f5ff]' : 'text-[#8a96ad]'}`}>{ch}</span>
                            <span className="w-2 h-2 rounded-full bg-[#00ff95] shadow-[0_0_8px_rgba(0,255,149,0.8)]" />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
             </div>
           )}
        </div>
      )}

      {/* ── Boundary Guide Panel ── */}
      {activeTopTab === 'BOUNDARY GRID' && (
        <div className="absolute top-[88px] left-1/2 -translate-x-1/2 w-[850px] z-20 pointer-events-auto">
          <div className="backdrop-blur-md bg-[rgba(20,28,31,0.75)] rounded-2xl border border-[rgba(59,73,76,0.5)] overflow-hidden flex flex-col shadow-[0_8px_32px_rgba(0,0,0,0.4)] animate-fade-in p-6 relative">
             <div className="flex justify-between items-start mb-6 border-b border-[rgba(59,73,76,0.5)] pb-4">
               <div>
                 <div className="text-[#c3f5ff] text-[15px] font-bold tracking-[0.02em] uppercase mb-1 font-sans" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                   TAMIL NADU MARITIME BOUNDARY GUIDE
                 </div>
                 <div className="text-[#8a96ad] text-[11px] font-sans">Fixed-distance offshore zones</div>
               </div>
               <div className="flex items-center gap-2">
                 <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-[#00ff95] shadow-[0_0_8px_#00ff95]' : 'bg-[#ef4444] shadow-[0_0_8px_#ef4444]'}`} />
                 <span className="text-[#8a96ad] text-[11px] font-sans font-bold">{isConnected ? 'BACKEND ONLINE' : 'BACKEND OFFLINE'}</span>
               </div>
             </div>

             <div className="grid grid-cols-2 gap-4 mb-6">
               {/* Coastline */}
               <div className="bg-[rgba(10,15,20,0.5)] border border-[rgba(59,73,76,0.4)] rounded-xl p-4 flex flex-col gap-2 shadow-inner">
                 <div className="flex items-center gap-3">
                   <div className="w-8 h-0 border-t-2 border-[#00daf3]" />
                   <span className="text-[#dce4e5] text-[12px] font-bold font-sans">Tamil Nadu Coastline</span>
                 </div>
                 <div className="text-[#8a96ad] text-[11px] font-sans pl-11">Baseline reference (shoreline)</div>
               </div>

               {/* Alert Zone */}
               <div className="bg-[rgba(10,15,20,0.5)] border border-[rgba(0,255,149,0.3)] rounded-xl p-4 flex flex-col gap-2 shadow-[inset_0_0_15px_rgba(0,255,149,0.05)]">
                 <div className="flex items-center gap-3">
                   <div className="w-8 h-0 border-t-2 border-dashed border-[#00ff95]" />
                   <span className="text-[#00ff95] text-[12px] font-bold font-sans">Alert Zone (20 km)</span>
                 </div>
                 <div className="text-[#8a96ad] text-[11px] font-sans pl-11">20 km IMBL monitoring band</div>
               </div>

               {/* Warning Zone */}
               <div className="bg-[rgba(10,15,20,0.5)] border border-[rgba(255,184,0,0.4)] rounded-xl p-4 flex flex-col gap-2 shadow-[inset_0_0_15px_rgba(255,184,0,0.05)]">
                 <div className="flex items-center gap-3">
                   <div className="w-8 h-0 border-t-2 border-dashed border-[#ffb800]" />
                   <span className="text-[#ffb800] text-[12px] font-bold font-sans">Warning Zone (12 km)</span>
                 </div>
                 <div className="text-[#8a96ad] text-[11px] font-sans pl-11">12 km IMBL caution band</div>
               </div>

               {/* Danger Zone */}
               <div className="bg-[rgba(10,15,20,0.5)] border border-[rgba(239,68,68,0.4)] rounded-xl p-4 flex flex-col gap-2 shadow-[inset_0_0_15px_rgba(239,68,68,0.1)] relative overflow-hidden">
                 <div className="absolute inset-0 bg-gradient-to-r from-[rgba(239,68,68,0.05)] to-transparent pointer-events-none" />
                 <div className="flex items-center gap-3 relative">
                   <div className="w-8 h-0 border-t-2 border-dashed border-[#ef4444]" />
                   <span className="text-[#ef4444] text-[12px] font-bold font-sans">Danger Zone (5 km)</span>
                 </div>
                 <div className="text-[#8a96ad] text-[11px] font-sans pl-11 relative">Critical IMBL proximity, turn back immediately</div>
               </div>

               {/* IMBL Palk Strait */}
               <div className="bg-[rgba(10,15,20,0.5)] border border-[rgba(59,73,76,0.4)] rounded-xl p-4 flex flex-col gap-2 shadow-inner">
                 <div className="flex items-center gap-3">
                   <div className="w-8 h-0 border-t-2 border-[#ef4444]" />
                   <span className="text-[#dce4e5] text-[12px] font-bold font-sans">IMBL - Palk Strait</span>
                 </div>
                 <div className="text-[#8a96ad] text-[11px] font-sans pl-11">International maritime boundary (1974)</div>
               </div>

               {/* IMBL Gulf of Mannar */}
               <div className="bg-[rgba(10,15,20,0.5)] border border-[rgba(59,73,76,0.4)] rounded-xl p-4 flex flex-col gap-2 shadow-inner">
                 <div className="flex items-center gap-3">
                   <div className="w-8 h-0 border-t-2 border-[#ef4444]" />
                   <span className="text-[#dce4e5] text-[12px] font-bold font-sans">IMBL - Gulf of Mannar</span>
                 </div>
                 <div className="text-[#8a96ad] text-[11px] font-sans pl-11">International maritime boundary (1976)</div>
               </div>
             </div>

             {/* Bottom Legend text */}
             <div className="grid grid-cols-2 gap-4 text-[11px] text-[#8a96ad] font-sans mb-4 px-2 border-t border-[rgba(59,73,76,0.5)] pt-4">
               <div className="flex items-center gap-3">
                 <div className="w-6 h-0 border-t-2 border-[#00ff95]" />
                 <span>Clear ({'>'}20 km from IMBL)</span>
               </div>
               <div className="flex items-center gap-3">
                 <div className="w-6 h-0 border-t-2 border-dashed border-[#00ff95]" />
                 <span>Alert (12-20 km from IMBL)</span>
               </div>
               <div className="flex items-center gap-3">
                 <div className="w-6 h-0 border-t-2 border-dashed border-[#ffb800]" />
                 <span>Warning (5-12 km from IMBL)</span>
               </div>
               <div className="flex items-center gap-3">
                 <div className="w-6 h-0 border-t-2 border-dashed border-[#ef4444]" />
                 <span>Danger ({'<='}5 km from IMBL)</span>
               </div>
             </div>
          </div>
        </div>
      )}

      {/* ── Left Sidebar (Floating Nav) ── */}
      

      {/* ── Placeholders for Other Tabs ── */}
      {activeTopTab === 'STRATEGIC' && (
        <div className="absolute inset-0 z-[5] flex items-center justify-center animate-fade-in pointer-events-none">
           <div className="text-[#c3f5ff] text-[24px] font-bold tracking-[0.2em] opacity-30" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>STRATEGIC COMMAND OFFLINE</div>
        </div>
      )}
      {activeTopTab === 'LOGISTICS' && (
        <div className="absolute inset-0 z-[5] flex items-center justify-center animate-fade-in pointer-events-none">
           <div className="text-[#c3f5ff] text-[24px] font-bold tracking-[0.2em] opacity-30" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>LOGISTICS NETWORK STANDBY</div>
        </div>
      )}
      {activeTopTab === 'COMMS' && (
        <div className="absolute inset-0 z-[5] flex items-center justify-center animate-fade-in pointer-events-none">
           <div className="text-[#c3f5ff] text-[24px] font-bold tracking-[0.2em] opacity-30" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>COMMS RELAY SECURE</div>
        </div>
      )}
      
{activeTopTab === 'TACTICAL' && (
      <nav className="absolute top-1/2 -translate-y-1/2 left-4 bg-gradient-aegis-rich grain-overlay glass-panel rounded-2xl flex flex-col items-center py-5 gap-3 z-20 shadow-[0_8px_32px_rgba(0,0,0,0.5)] w-[68px] pointer-events-auto overflow-hidden">

        {navItems.map(({ label, icon }) => (
          <button key={label} onClick={() => setActiveNav(activeNav === label ? null : label)} title={label}
            className={`flex items-center justify-center w-11 h-11 rounded-xl transition-all cursor-pointer icon-pop ${activeNav === label ? 'bg-[rgba(0,218,243,0.15)] text-[#00daf3] shadow-[inset_0_0_15px_rgba(0,218,243,0.2)] border border-[rgba(0,218,243,0.3)]' : 'text-[#bac9cc] hover:text-[#c3f5ff] hover:bg-[rgba(255,255,255,0.06)]'}`}>
            <span className={`z-10 relative ${activeNav === label ? 'text-[#00daf3] scale-110 drop-shadow-[0_0_8px_rgba(0,218,243,0.6)]' : 'text-[#bac9cc]'}`}>{icon}</span>
          </button>
        ))}

        <div className="w-10 h-[1px] bg-[rgba(8,164,167,0.3)] my-3 z-10 relative" />
        <button onClick={() => setDemoMode(d => !d)} title="Demo Mode"
          className={`w-11 h-11 flex items-center justify-center rounded-xl transition-all cursor-pointer border icon-pop z-10 relative ${demoMode ? 'bg-[rgba(124,58,237,0.2)] border-[#7c3aed] text-[#a78bfa] shadow-[0_0_20px_rgba(124,58,237,0.4)]' : 'border-transparent text-[#bac9cc] hover:bg-[rgba(255,255,255,0.06)] hover:text-[#c3f5ff]'}`}>
          {demoMode ? '◉' : '○'}
        </button>
      </nav>
      )}

      {/* ── Left Floating Info Panel ── */}
      

      {/* ── Placeholders for Other Tabs ── */}
      {activeTopTab === 'STRATEGIC' && (
        <div className="absolute inset-0 z-[5] flex items-center justify-center animate-fade-in pointer-events-none">
           <div className="text-[#c3f5ff] text-[24px] font-bold tracking-[0.2em] opacity-30" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>STRATEGIC COMMAND OFFLINE</div>
        </div>
      )}
      {activeTopTab === 'LOGISTICS' && (
        <div className="absolute inset-0 z-[5] flex items-center justify-center animate-fade-in pointer-events-none">
           <div className="text-[#c3f5ff] text-[24px] font-bold tracking-[0.2em] opacity-30" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>LOGISTICS NETWORK STANDBY</div>
        </div>
      )}
      {activeTopTab === 'COMMS' && (
        <div className="absolute inset-0 z-[5] flex items-center justify-center animate-fade-in pointer-events-none">
           <div className="text-[#c3f5ff] text-[24px] font-bold tracking-[0.2em] opacity-30" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>COMMS RELAY SECURE</div>
        </div>
      )}
      
{activeTopTab === 'TACTICAL' && (
      <div className="absolute top-[88px] left-[100px] bottom-[88px] w-[320px] flex flex-col gap-5 z-20 pointer-events-none">
        
        {activeNav === 'Fleet' && (
          <>
            {/* Active Fleet */}
            <div className="pointer-events-auto bg-gradient-aegis-rich grain-overlay glass-panel rounded-2xl overflow-hidden flex flex-col max-h-[50%] animate-fade-in relative">
              <div className="bg-[rgba(3,15,38,0.4)] border-b border-[rgba(8,164,167,0.3)] flex items-center justify-between px-5 py-3.5 shrink-0 relative z-10">
                <span className="text-[#c3f5ff] text-[15px] font-bold tracking-[0.02em]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>ACTIVE FLEET</span>
                <span className="bg-[rgba(195,245,255,0.15)] text-[#c3f5ff] text-[10px] font-bold tracking-[0.08em] px-2.5 py-1 rounded">
                  {String(boats.filter(b => b.status !== 'OFFLINE').length).padStart(2, '0')} UNITS
                </span>
              </div>
              <div className="p-3 flex-1 overflow-y-auto flex flex-col gap-2.5 custom-scrollbar relative z-10">
                 <div className="relative mb-1">
                    <input value={vesselId} onChange={e => setVesselId(e.target.value)}
                      placeholder="SEARCH ID..."
                      className="w-full bg-[rgba(10,14,26,0.6)] border border-[rgba(255,255,255,0.08)] rounded-lg px-4 py-2 text-[11px] text-[#dce4e5] outline-none focus:border-[rgba(0,218,243,0.5)] transition-colors" />
                 </div>

                 {/* Demo-mode fleet grid — replaces the regular vessel
                     cards while demo mode is active. Two-column grid
                     of zone-coloured chips, each clickable to select
                     the boat. Demo boats don't carry status/type/group
                     fields, so the regular card layout would render
                     empty anyway. */}
                 <div className="grid grid-cols-2 gap-2">
                   {filteredBoats.length === 0 && (
                     <div className="col-span-2 text-[#5a6478] text-[11px] text-center mt-4">
                       NO VESSELS FOUND
                     </div>
                   )}
                   {filteredBoats.map((b) => {
                     const isSelected = selectedBoatId === b.boatId;
                     const color = zoneColor(b.zone);
                     const bg = zoneBg(b.zone);
                     const isAlert = b.zone === 'WARNING' || b.zone === 'DANGER' || b.zone === 'ALERT';
                     return (
                       <button
                         key={b.boatId}
                         onClick={() => {
                           setSelectedBoatId(b.boatId);
                           setSelectedBoat(b);
                         }}
                         title={`${b.boatId} — ${b.zone}`}
                         className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left cursor-pointer transition-all glass-panel relative overflow-hidden ${
                           isSelected
                             ? 'shadow-[0_0_14px_rgba(56,189,248,0.4)] scale-[1.02]'
                             : 'opacity-90 hover:opacity-100 hover:scale-[1.01]'
                         }`}
                         style={{
                           borderColor: isSelected ? color : `${color}80`,
                           color: '#dce4e5',
                           background: isSelected
                             ? `linear-gradient(135deg, ${bg}, ${bg.replace('0.3', '0.45').replace('0.4', '0.55')})`
                             : bg,
                           borderWidth: isSelected ? '1.5px' : '1px',
                         }}
                       >
                         <span
                           className={`w-2 h-2 rounded-full shrink-0 ${
                             isAlert ? 'animate-pulse' : ''
                           }`}
                           style={{ background: color, boxShadow: `0 0 8px ${color}` }}
                         />
                         <div className="flex-1 min-w-0">
                           <div className="flex items-center justify-between gap-1">
                             <div className="text-[#c3f5ff] text-[11px] font-bold tracking-widest truncate">
                               {b.boatId}
                             </div>
                             {!demoMode && (
                               <span className="text-[8px] font-bold opacity-70" style={{ color: statusColor(b.status) }}>
                                 {b.status}
                               </span>
                             )}
                           </div>
                           <div className="text-[10px] tracking-wider truncate" style={{ color }}>
                             {b.zone}
                           </div>
                           {!demoMode && (
                             <div className="text-[8px] text-[#8a96ad] truncate opacity-60">
                               {b.type} | {b.group}
                             </div>
                           )}
                         </div>
                       </button>
                     );
                   })}
                 </div>
              </div>
            </div>

            {/* Telemetry */}
            <div className="pointer-events-auto bg-gradient-aegis-rich grain-overlay glass-panel rounded-2xl p-5 shrink-0 relative overflow-hidden animate-fade-in">
              <div className="absolute top-0 right-0 w-32 h-32 bg-[rgba(0,218,243,0.05)] rounded-bl-full pointer-events-none z-10" />
              <div className="text-[#00daf3] text-[11px] font-bold tracking-widest mb-4 border-b border-[rgba(8,164,167,0.3)] pb-2.5 relative z-10">
                TELEMETRY — {selectedBoat?.boatId ?? 'NO VESSEL'}
              </div>
              <div className="flex flex-col gap-3 text-[11px] relative z-10">
                <div className="flex justify-between items-center">
                  <span className="text-[#8a96ad]">LOCATION</span>
                  <span className="text-[#c3f5ff] font-medium">{currentLocation.lat.toFixed(3)}°N {currentLocation.lon.toFixed(3)}°E</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[#8a96ad]">BORDER PROX.</span>
                  <span style={{ color: proximityToBorder < 5 ? '#ef4444' : '#c3f5ff' }} className={`font-medium ${proximityToBorder < 5 ? 'animate-pulse-dot font-bold' : ''}`}>
                    {proximityToBorder} KM
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[#8a96ad]">SPEED</span>
                  <span className="text-[#c3f5ff] font-medium">{currentSpeed} KN</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[#8a96ad]">NEAREST EEZ</span>
                  <span className="text-[#fde047] font-medium">{nearestEEZ}</span>
                </div>
                <div className="flex justify-between items-center pt-1 mt-1 border-t border-[rgba(59,73,76,0.3)]">
                  <span className="text-[#8a96ad]">ZONE</span>
                  <span className="font-bold text-[12px] tracking-wider" style={{ color: zoneColor(currentZone) }}>{currentZone}</span>
                </div>
              </div>
            </div>

            {/* Environmental */}
            <div className="pointer-events-auto bg-gradient-aegis-rich grain-overlay glass-panel rounded-2xl p-4 shrink-0 relative animate-fade-in">
                <div className="text-[#c3f5ff] text-[11px] font-bold tracking-widest mb-3 relative z-10">ENVIRONMENTAL</div>
                <div className="grid grid-cols-2 gap-3 relative z-10">
                  <div className="bg-[rgba(10,15,20,0.5)] border border-[rgba(59,73,76,0.4)] rounded-xl p-3 shadow-inner">
                    <div className="flex items-center gap-2 mb-1.5">
                      <svg viewBox="0 0 11.67 9.92" className="w-3 h-3 text-[#00daf3] shrink-0"><path d={svgPaths.p33fbcd00} fill="currentColor" /></svg>
                      <span className="text-[#8a96ad] text-[9px] font-bold tracking-widest">WIND</span>
                    </div>
                    <div className="text-[#dce4e5] text-[18px] font-bold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                      {envData.loading ? '...' : Math.round(envData.windSpeed)} <span className="text-[10px] text-[#5a6478] font-normal">KTS</span>
                    </div>
                  </div>
                  <div className="bg-[rgba(10,15,20,0.5)] border border-[rgba(59,73,76,0.4)] rounded-xl p-3 shadow-inner">
                    <div className="flex items-center gap-2 mb-1.5">
                      <svg viewBox="0 0 11.67 9.74" className="w-3 h-3 text-[#00daf3] shrink-0"><path d={svgPaths.pfc60700} fill="currentColor" /></svg>
                      <span className="text-[#8a96ad] text-[9px] font-bold tracking-widest">SWELL</span>
                    </div>
                    <div className="text-[#dce4e5] text-[18px] font-bold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                      {envData.loading ? '...' : envData.swellHeight.toFixed(1)} <span className="text-[10px] text-[#5a6478] font-normal">M</span>
                    </div>
                  </div>
                </div>
            </div>
          </>
        )}

        {/* ── Sensors Panel ── */}
        {activeNav === 'Sensors' && (
          <div className="pointer-events-auto bg-gradient-aegis-rich grain-overlay glass-panel rounded-2xl p-6 flex-1 min-h-0 flex flex-col animate-fade-in relative">
            <div className="text-[#c3f5ff] text-[15px] font-bold tracking-[0.02em] mb-6 border-b border-[rgba(8,164,167,0.3)] pb-4 relative z-10" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>SENSOR ARRAYS</div>
            <div className="flex-1 flex flex-col gap-5 overflow-y-auto custom-scrollbar pr-2 relative z-10">
              <div className="bg-[rgba(3,15,38,0.4)] border border-[rgba(0,218,243,0.3)] rounded-xl p-5 shadow-[inset_0_0_20px_rgba(0,218,243,0.1)]">
                 <div className="flex justify-between items-center mb-4">
                   <div className="text-[#00daf3] text-[12px] font-bold tracking-widest">RADAR NETWORK</div>
                   <div className="w-2 h-2 rounded-full bg-[#00ff95] animate-pulse" />
                 </div>
                 <div className="flex flex-col gap-2">
                   <div className="flex justify-between text-[11px] text-[#dce4e5] border-b border-[rgba(255,255,255,0.05)] pb-1"><span>STATUS</span><span className="text-[#00ff95] font-bold tracking-wider">ONLINE</span></div>
                   <div className="flex justify-between text-[11px] text-[#dce4e5] border-b border-[rgba(255,255,255,0.05)] pb-1"><span>SWEEP RATE</span><span className="font-mono">1.2s</span></div>
                   <div className="flex justify-between text-[11px] text-[#dce4e5] border-b border-[rgba(255,255,255,0.05)] pb-1"><span>RANGE</span><span className="font-mono">450 NM</span></div>
                   <div className="flex justify-between text-[11px] text-[#dce4e5]"><span>SENSITIVITY</span><span className="font-mono">HIGH</span></div>
                 </div>
              </div>
              <div className="bg-[rgba(10,15,20,0.5)] border border-[rgba(59,73,76,0.4)] rounded-xl p-5 hover:border-[rgba(255,184,0,0.4)] transition-colors">
                 <div className="flex justify-between items-center mb-4">
                   <div className="text-[#8a96ad] text-[12px] font-bold tracking-widest">SONAR B-BANDS</div>
                   <div className="w-2 h-2 rounded-full bg-[#ffb800]" />
                 </div>
                 <div className="flex flex-col gap-2">
                   <div className="flex justify-between text-[11px] text-[#dce4e5] border-b border-[rgba(255,255,255,0.05)] pb-1"><span>STATUS</span><span className="text-[#ffb800] font-bold tracking-wider">DEGRADED</span></div>
                   <div className="flex justify-between text-[11px] text-[#dce4e5] border-b border-[rgba(255,255,255,0.05)] pb-1"><span>PING INT</span><span className="font-mono">5.0s</span></div>
                   <div className="flex justify-between text-[11px] text-[#dce4e5] border-b border-[rgba(255,255,255,0.05)] pb-1"><span>THERMOCLINE</span><span className="font-mono">-80m</span></div>
                   <div className="flex justify-between text-[11px] text-[#dce4e5]"><span>ERROR</span><span className="text-[#ef4444] font-mono">B7-NODE</span></div>
                 </div>
              </div>
              <div className="bg-[rgba(10,15,20,0.5)] border border-[rgba(59,73,76,0.4)] rounded-xl p-5 hover:border-[rgba(0,255,149,0.3)] transition-colors">
                 <div className="flex justify-between items-center mb-4">
                   <div className="text-[#8a96ad] text-[12px] font-bold tracking-widest">SATELLITE UPLINK</div>
                   <div className="w-2 h-2 rounded-full bg-[#00ff95]" />
                 </div>
                 <div className="flex flex-col gap-2">
                   <div className="flex justify-between text-[11px] text-[#dce4e5] border-b border-[rgba(255,255,255,0.05)] pb-1"><span>STATUS</span><span className="text-[#00ff95] font-bold tracking-wider">ONLINE</span></div>
                   <div className="flex justify-between text-[11px] text-[#dce4e5] border-b border-[rgba(255,255,255,0.05)] pb-1"><span>LATENCY</span><span className="font-mono">42ms</span></div>
                   <div className="flex justify-between text-[11px] text-[#dce4e5]"><span>BANDWIDTH</span><span className="font-mono">98%</span></div>
                 </div>
              </div>
            </div>
            <div className="pointer-events-auto bg-[rgba(3,15,38,0.4)] border-t border-[rgba(8,164,167,0.3)] p-4 shrink-0 mt-4 rounded-b-2xl relative z-10">
          <div className="flex items-center justify-between mb-3.5">
            <span className="text-[#00daf3] text-[10px] font-bold tracking-[0.1em]">SYSTEM STABILITY</span>
            <span className="text-[#00ff95] text-[11px] font-bold">{systemStability.toFixed(1)}%</span>
          </div>
          <div className="flex items-center gap-4 mb-3 text-[10px]">
            {/* LED + BUZZER mirror the SELECTED boat's zone so the
                Threats panel reads the same boundary state as the
                map. Selecting a different boat swaps the values. */}
            <div className="flex items-center gap-2">
              <span className="text-[#8a96ad] font-bold tracking-widest">LED</span>
              <span className="font-bold" style={{ color: zoneColor(currentZone) }}>
                {currentZone === 'SAFE' ? 'IDLE' : currentZone === 'ALERT' ? 'CAUTION' : currentZone === 'WARNING' ? 'ADVISE' : 'ALARM'}
              </span>
            </div>
            <div className="w-[1px] h-3 bg-[rgba(59,73,76,0.6)]" />
            <div className="flex items-center gap-2">
              <span className="text-[#8a96ad] font-bold tracking-widest">BUZZER</span>
              <span className="font-bold" style={{ color: (currentZone === 'DANGER' || currentZone === 'WARNING') ? zoneColor(currentZone) : '#bac9cc' }}>
                {currentZone === 'DANGER' ? 'ACTIVE — FAST' : currentZone === 'WARNING' ? 'ACTIVE — SLOW' : 'STANDBY'}
              </span>
            </div>
            <div className="w-[1px] h-3 bg-[rgba(59,73,76,0.6)]" />
            <div className="flex items-center gap-1.5">
              <span className="text-[#8a96ad] font-bold tracking-widest">VESSEL</span>
              <span className="text-[#c3f5ff] font-bold tracking-wider">{selectedBoat?.boatId ?? '—'}</span>
            </div>
          </div>
          <div className="bg-[rgba(2,8,23,0.6)] h-1.5 rounded-full overflow-hidden shadow-inner">
            <div className="h-full bg-gradient-to-r from-[#00daf3] to-[#00ff95] transition-all" style={{ width: `${systemStability}%` }} />
          </div>
        </div>
      </div>
    )}

    {/* ── Threats Panel (Vessels By Zone) ── */}
        {activeNav === 'Threats' && (
          <div className="pointer-events-auto bg-gradient-aegis-rich grain-overlay glass-panel rounded-2xl overflow-hidden flex flex-col animate-fade-in relative my-auto min-h-[420px]">
            <div className="bg-[rgba(3,15,38,0.4)] border-b border-[rgba(8,164,167,0.3)] flex items-center justify-between px-5 py-3.5 shrink-0 relative z-10">
              <span className="text-[#c3f5ff] text-[15px] font-bold tracking-[0.02em]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>VESSELS BY ZONE</span>
              <span className="bg-[rgba(195,245,255,0.15)] text-[#c3f5ff] text-[10px] font-bold tracking-[0.08em] px-2.5 py-1 rounded">
                {boats.length} UNITS
              </span>
            </div>
             
             <div className="flex flex-col justify-center gap-4 p-5 flex-1 relative z-10">
               {/* SAFE Card */}
               <div className="bg-[rgba(10,15,20,0.5)] border border-[rgba(0,255,149,0.3)] rounded-xl p-4 flex items-center justify-between shadow-[inset_0_0_20px_rgba(0,255,149,0.05)]">
                 <div className="flex items-center gap-4">
                   <div className="w-8 h-8 rounded-full border border-[rgba(0,255,149,0.4)] flex items-center justify-center">
                     <div className="w-3 h-3 rounded-full bg-[#00ff95] shadow-[0_0_8px_#00ff95]" />
                   </div>
                   <div className="flex flex-col">
                     <span className="text-[#00ff95] text-[12px] font-bold tracking-widest font-sans">SAFE</span>
                     <span className="text-[#8a96ad] text-[10px] font-sans">Nominal operations</span>
                   </div>
                 </div>
                 <span className="text-[#00ff95] text-[36px] font-bold leading-none font-sans" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                   {boats.filter(b => b.zone === 'SAFE' || b.zone === 'CLEAR').length}
                 </span>
               </div>

               {/* WARNING Card */}
               <div className="bg-[rgba(10,15,20,0.5)] border border-[rgba(255,184,0,0.4)] rounded-xl p-4 flex items-center justify-between shadow-[inset_0_0_20px_rgba(255,184,0,0.05)] hover:border-[rgba(255,184,0,0.6)] transition-colors">
                 <div className="flex items-center gap-4">
                   <div className="w-8 h-8 rounded-full border border-[rgba(255,184,0,0.4)] flex items-center justify-center">
                     <div className="w-3 h-3 rounded-full bg-[#ffb800] shadow-[0_0_8px_#ffb800]" />
                   </div>
                   <div className="flex flex-col">
                     <span className="text-[#ffb800] text-[12px] font-bold tracking-widest font-sans">WARNING</span>
                     <span className="text-[#8a96ad] text-[10px] font-sans">Approaching IMBL</span>
                   </div>
                 </div>
                 <span className="text-[#ffb800] text-[36px] font-bold leading-none font-sans" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                   {boats.filter(b => b.zone === 'WARNING' || b.zone === 'ALERT').length}
                 </span>
               </div>

               {/* DANGER Card */}
               <div className="bg-[rgba(10,15,20,0.5)] border border-[rgba(239,68,68,0.5)] rounded-xl p-4 flex items-center justify-between shadow-[inset_0_0_20px_rgba(239,68,68,0.1)] relative overflow-hidden">
                 <div className="absolute inset-0 bg-gradient-to-r from-[rgba(239,68,68,0.1)] to-transparent pointer-events-none" />
                 <div className="flex items-center gap-4 relative">
                   <div className="w-8 h-8 rounded-full border border-[rgba(239,68,68,0.6)] flex items-center justify-center bg-[rgba(239,68,68,0.1)]">
                     <div className="w-3 h-3 rounded-full bg-[#ef4444] shadow-[0_0_12px_#ef4444] animate-pulse" />
                   </div>
                   <div className="flex flex-col">
                     <span className="text-[#ef4444] text-[12px] font-bold tracking-widest font-sans">DANGER</span>
                     <span className="text-[#8a96ad] text-[10px] font-sans">Immediate action required</span>
                   </div>
                 </div>
                 <span className="text-[#ef4444] text-[36px] font-bold leading-none font-sans relative" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                   {boats.filter(b => b.zone === 'DANGER').length}
                 </span>
               </div>
             </div>
          </div>
        )}

        {/* ── Logs Panel ── */}
        {activeNav === 'Live Feed' && (
          <div className="pointer-events-auto bg-gradient-aegis-rich grain-overlay glass-panel rounded-2xl overflow-hidden flex flex-col flex-1 min-h-[400px] animate-fade-in relative">
            <div className="bg-[rgba(3,15,38,0.4)] border-b border-[rgba(8,164,167,0.3)] flex items-center justify-between px-5 py-3.5 shrink-0 relative z-10">
              <span className="text-[#c3f5ff] text-[15px] font-bold tracking-[0.02em]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>TACTICAL LOG</span>
              <svg viewBox="0 0 10.5 10.5" className="w-3.5 h-3.5 text-[#8a96ad]"><path d={svgPaths.p1c1607c0} fill="currentColor" /></svg>
            </div>
            <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4 min-h-0 custom-scrollbar relative z-10">
              {alerts.length === 0 && <div className="text-[#5a6478] text-[11px] text-center py-4">No recent events</div>}
              {alerts.map((a, i) => (
                <div key={a.id} className={`relative pl-4 py-1 transition-opacity ${i >= 5 ? 'opacity-40' : ''}`}>
                  <div className="absolute left-0 top-0 bottom-0 w-1 rounded-full" style={{ background: a.level === 'danger' ? '#ef4444' : a.level === 'warning' ? '#ffb800' : '#00daf3' }} />
                  <div className="text-[10px] font-bold mb-1 tracking-wider" style={{ color: a.level === 'danger' ? '#ef4444' : a.level === 'warning' ? '#ffb800' : '#00daf3' }}>{a.time}</div>
                  <div className="text-[#dce4e5] text-[11px] leading-relaxed">{a.message}</div>
                </div>
              ))}
            </div>
            </div>
        )}
      </div>
      )}

      {/* ── Floating Bottom Bar ── */}
      

      {/* ── Placeholders for Other Tabs ── */}
      {activeTopTab === 'STRATEGIC' && (
        <div className="absolute inset-0 z-[5] pt-[80px] pb-6 px-6 pointer-events-auto flex items-center justify-center animate-fade-in">
           <div className="w-full max-w-3xl py-20 bg-gradient-aegis-rich grain-overlay glass-panel rounded-2xl flex flex-col items-center justify-center shadow-[0_20px_60px_rgba(0,0,0,0.8)] border border-[rgba(8,164,167,0.3)]">
             <div className="text-[#c3f5ff] text-[24px] font-bold tracking-[0.2em] opacity-80 relative z-10" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>STRATEGIC COMMAND OFFLINE</div>
             <div className="text-[#00daf3] text-[12px] tracking-[0.1em] mt-4 opacity-70 relative z-10">AWAITING AUTHORIZATION...</div>
           </div>
        </div>
      )}
      {activeTopTab === 'LOGISTICS' && (
        <div className="absolute inset-0 z-[5] pt-[80px] pb-6 px-6 pointer-events-auto flex items-center justify-center animate-fade-in">
           <div className="w-full max-w-3xl py-20 bg-gradient-aegis-rich grain-overlay glass-panel rounded-2xl flex flex-col items-center justify-center shadow-[0_20px_60px_rgba(0,0,0,0.8)] border border-[rgba(8,164,167,0.3)]">
             <div className="text-[#c3f5ff] text-[24px] font-bold tracking-[0.2em] opacity-80 relative z-10" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>LOGISTICS NETWORK STANDBY</div>
             <div className="text-[#00daf3] text-[12px] tracking-[0.1em] mt-4 opacity-70 relative z-10">INITIALIZING SUPPLY ROUTES...</div>
           </div>
        </div>
      )}
      {activeTopTab === 'COMMS' && (
        <div className="absolute inset-0 z-[5] pt-[80px] pb-6 px-6 pointer-events-auto flex items-center justify-center animate-fade-in">
           <div className="w-full max-w-3xl py-20 bg-gradient-aegis-rich grain-overlay glass-panel rounded-2xl flex flex-col items-center justify-center shadow-[0_20px_60px_rgba(0,0,0,0.8)] border border-[rgba(8,164,167,0.3)]">
             <div className="text-[#c3f5ff] text-[24px] font-bold tracking-[0.2em] opacity-80 relative z-10" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>COMMS RELAY SECURE</div>
             <div className="text-[#00daf3] text-[12px] tracking-[0.1em] mt-4 opacity-70 relative z-10">ENCRYPTION ACTIVE...</div>
           </div>
        </div>
      )}

      {/* ── DETAILED LOGS ── */}
      {activeTopTab === 'DETAILED LOGS' && (
        <div className="absolute inset-0 z-[15] pt-[80px] pb-12 px-6 pointer-events-auto flex items-center justify-center bg-[rgba(2,8,23,0.85)] backdrop-blur-md animate-fade-in">
          <div className="w-full h-full max-w-6xl max-h-[800px] bg-gradient-aegis-rich grain-overlay glass-panel rounded-2xl flex flex-col overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.8)] relative">
            {/* Header */}
            <div className="px-6 py-4 border-b border-[rgba(8,164,167,0.3)] bg-[rgba(3,15,38,0.4)] flex items-center justify-between shrink-0 relative z-10">
              <div>
                <h1 className="text-[18px] font-bold text-[#c3f5ff] tracking-[0.1em]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>DETAILED LOGS</h1>
                <p className="text-[10px] text-[#8a96ad] tracking-widest mt-1">HISTORICAL MOVEMENT & ZONE INCIDENTS</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center bg-[rgba(20,28,31,0.8)] border border-[rgba(59,73,76,0.5)] rounded overflow-hidden h-8">
                  <svg className="w-3.5 h-3.5 text-[#00daf3] ml-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  <input type="text" placeholder="FILTER BOAT ID..." value={boatFilter} onChange={(e) => setBoatFilter(e.target.value)} className="bg-transparent px-3 text-[11px] text-[#c3f5ff] placeholder-[#5a6478] focus:outline-none w-40 font-mono tracking-widest" />
                  {boatFilter && <button onClick={() => setBoatFilter('')} className="mr-2 text-[#8a96ad] hover:text-[#00daf3]"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>}
                </div>
                <button onClick={fetchLogsData} disabled={logsLoading} className="flex items-center gap-2 px-4 h-8 bg-[rgba(0,218,243,0.1)] hover:bg-[rgba(0,218,243,0.2)] border border-[rgba(0,218,243,0.4)] rounded text-[#00daf3] text-[10px] font-bold tracking-widest transition-colors">
                  <svg className={`w-3.5 h-3.5 ${logsLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  REFRESH
                </button>
              </div>
            </div>
            
            {/* Tabs */}
            <div className="flex gap-1 border-b border-[rgba(8,164,167,0.3)] bg-[rgba(3,15,38,0.2)] px-6 relative z-10">
              {[ {id: 'movement', label: 'MOVEMENT HISTORY', count: historyMovements.length}, {id: 'zone', label: 'ZONE INCIDENTS', count: historyZoneEvents.length} ].map(tab => (
                <button key={tab.id} onClick={() => setLogsActiveTab(tab.id)} className={`flex items-center gap-2 px-4 py-3 text-[11px] font-bold tracking-widest transition-all border-b-2 -mb-[1px] ${logsActiveTab === tab.id ? 'border-[#00daf3] text-[#00daf3] bg-[rgba(0,218,243,0.05)]' : 'border-transparent text-[#8a96ad] hover:text-[#dce4e5]'}`}>
                  {tab.label}
                  <span className={`px-1.5 py-0.5 rounded text-[9px] ${logsActiveTab === tab.id ? 'bg-[rgba(0,218,243,0.15)]' : 'bg-[rgba(255,255,255,0.05)]'}`}>{tab.count}</span>
                </button>
              ))}
            </div>
            
            
            {/* Table Area */}
            <div className="flex-1 overflow-y-auto custom-scrollbar relative bg-[rgba(3,15,38,0.2)] z-10">
              {logsError && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-[rgba(239,68,68,0.1)] border border-[#ef4444] text-[#ef4444] text-[10px] font-bold tracking-widest px-4 py-1.5 rounded z-10 flex items-center gap-2">
                  <span className="animate-pulse">⚠</span> {logsError}
                </div>
              )}
              
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-[rgba(6,25,48,0.95)] backdrop-blur-md z-10 shadow-md">
                  <tr>
                    <th className="px-6 py-3 text-[10px] font-bold text-[#8a96ad] tracking-widest border-b border-[rgba(59,73,76,0.5)]">ID</th>
                    {logsActiveTab === 'movement' && <th className="px-6 py-3 text-[10px] font-bold text-[#8a96ad] tracking-widest border-b border-[rgba(59,73,76,0.5)]">LATITUDE</th>}
                    {logsActiveTab === 'movement' && <th className="px-6 py-3 text-[10px] font-bold text-[#8a96ad] tracking-widest border-b border-[rgba(59,73,76,0.5)]">LONGITUDE</th>}
                    {logsActiveTab === 'movement' && <th className="px-6 py-3 text-[10px] font-bold text-[#8a96ad] tracking-widest border-b border-[rgba(59,73,76,0.5)]">DISTANCE</th>}
                    <th className="px-6 py-3 text-[10px] font-bold text-[#8a96ad] tracking-widest border-b border-[rgba(59,73,76,0.5)]">ZONE</th>
                    {logsActiveTab === 'zone' && <th className="px-6 py-3 text-[10px] font-bold text-[#8a96ad] tracking-widest border-b border-[rgba(59,73,76,0.5)]">LATITUDE</th>}
                    {logsActiveTab === 'zone' && <th className="px-6 py-3 text-[10px] font-bold text-[#8a96ad] tracking-widest border-b border-[rgba(59,73,76,0.5)]">LONGITUDE</th>}
                    <th className="px-6 py-3 text-[10px] font-bold text-[#8a96ad] tracking-widest border-b border-[rgba(59,73,76,0.5)]">TIMESTAMP</th>
                  </tr>
                </thead>
                <tbody className="text-[12px] font-mono">
                  {logsActiveTab === 'movement' ? (
                    historyMovements.length === 0 ? <EmptyRow cols={6} loading={logsLoading} /> : 
                    historyMovements.map((m, i) => (
                      <tr key={m._id ?? i} className="border-b border-[rgba(59,73,76,0.2)] hover:bg-[rgba(255,255,255,0.02)] transition-colors">
                        <td className="px-6 py-3 text-[#00daf3] font-bold">{m.boatId ?? '—'}</td>
                        <td className="px-6 py-3 text-[#dce4e5]">{m.lat != null ? `${m.lat.toFixed(5)}°N` : '—'}</td>
                        <td className="px-6 py-3 text-[#dce4e5]">{m.lon != null ? `${m.lon.toFixed(5)}°E` : '—'}</td>
                        <td className="px-6 py-3 text-[#8a96ad]">{m.distance != null ? `${m.distance.toFixed(1)} km` : '—'}</td>
                        <td className="px-6 py-3"><ZoneBadge zone={m.zone} /></td>
                        <td className="px-6 py-3 text-[#5a6478] text-[10px] tracking-wider">{fmtDate(m.timestamp)}</td>
                      </tr>
                    ))
                  ) : (
                    historyZoneEvents.length === 0 ? <EmptyRow cols={5} loading={logsLoading} /> :
                    historyZoneEvents.map((a, i) => (
                      <tr key={a._id ?? i} className="border-b border-[rgba(59,73,76,0.2)] hover:bg-[rgba(255,255,255,0.02)] transition-colors">
                        <td className="px-6 py-3 text-[#00daf3] font-bold">{a.boatId ?? '—'}</td>
                        <td className="px-6 py-3"><ZoneBadge zone={a.zone} /></td>
                        <td className="px-6 py-3 text-[#dce4e5]">{a.lat != null ? `${a.lat.toFixed(5)}°N` : '—'}</td>
                        <td className="px-6 py-3 text-[#dce4e5]">{a.lon != null ? `${a.lon.toFixed(5)}°E` : '—'}</td>
                        <td className="px-6 py-3 text-[#5a6478] text-[10px] tracking-wider">{fmtDate(a.timestamp)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      
{activeTopTab === 'TACTICAL' && (
      <footer className="absolute bottom-6 left-1/2 -translate-x-1/2 h-[44px] rounded-full bg-gradient-aegis-rich grain-overlay glass-panel border border-[rgba(8,164,167,0.3)] px-6 flex items-center gap-4 text-[10px] text-[#a8b8c4] z-20 shadow-[0_-8px_32px_rgba(0,0,0,0.5)] pointer-events-auto overflow-hidden whitespace-nowrap">
        <span className="text-[#c3f5ff] font-bold tracking-[0.1em] shrink-0 z-10 relative">AEGIS COMMAND V4.2</span>
        <span className="text-[rgba(59,73,76,0.4)] shrink-0 z-10 relative">|</span>
        <span className="text-[#00ff95] font-semibold tracking-widest shrink-0 z-10 relative">● SYSTEM STABLE</span>
        <span className="text-[rgba(59,73,76,0.4)] shrink-0 z-10 relative">|</span>
        
        {/* Indicators */}
        <div className="flex items-center gap-3 shrink-0 z-10 relative">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] tracking-widest font-bold">LED</span>
            <div
              className="w-2 h-2 rounded-full"
              style={{
                background: zoneColor(currentZone),
                boxShadow: `0 0 8px ${zoneColor(currentZone)}`,
              }}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] tracking-widest font-bold">BUZZER</span>
            <div
              className={`w-2 h-2 rounded-full ${
                currentZone === 'WARNING' || currentZone === 'DANGER' ? 'animate-pulse' : ''
              }`}
              style={{
                background:
                  currentZone === 'WARNING' || currentZone === 'DANGER'
                    ? zoneColor(currentZone)
                    : 'rgba(255,255,255,0.2)',
                boxShadow:
                  currentZone === 'WARNING' || currentZone === 'DANGER'
                    ? `0 0 8px ${zoneColor(currentZone)}`
                    : 'none',
                animationDuration:
                  currentZone === 'DANGER' ? '0.4s' : '1.2s',
              }}
            />
          </div>
          <span className="text-[10px] tracking-widest text-[#8a96ad] ml-2">
            VESSEL: <span className="text-[#c3f5ff] font-bold">{selectedBoat?.boatId ?? '—'}</span>
          </span>
        </div>
        
        <div className="flex-1 flex justify-center pointer-events-none z-10 relative"></div>
        
        <span className="text-[rgba(59,73,76,0.4)] shrink-0 z-10 relative">|</span>
        <span className="tracking-widest shrink-0 z-10 relative">UPTIME: {lastUpdate}</span>
        <span className="text-[rgba(59,73,76,0.4)] shrink-0 z-10 relative">|</span>
        <span className="text-[#00daf3] font-semibold tracking-widest cursor-pointer hover:text-white transition-colors icon-pop shrink-0 z-10 relative">LIVE FEEDS</span>
      </footer>
      )}



      {/* ── Right-side push notifications (WARNING line alerts) ──
          Fires whenever any boat (real backend OR demo fleet) crosses
          into the WARNING (or DANGER) zone. Stacks at the top-right
          corner, newest at the bottom, up to 4 visible at once. */}
      <div className="fixed top-20 right-4 z-[3000] flex flex-col-reverse gap-2 pointer-events-none w-[340px]">
        {toasts.slice(-4).map(t => {
          const color = zoneColor(t.zone);
          const bg = zoneBg(t.zone);
          const icon = t.zone === 'DANGER' ? '⚠' : '⚡';
          return (
            <div
              key={t.id}
              className="pointer-events-auto rounded-xl overflow-hidden border shadow-[0_18px_40px_rgba(0,0,0,0.55)] backdrop-blur-md animate-slide-in"
              style={{
                background: 'linear-gradient(180deg, rgba(10,16,28,0.95), rgba(6,12,22,0.92))',
                borderColor: `${color}80`,
              }}
            >
              {/* Coloured top accent line */}
              <div
                className="h-[3px] w-full"
                style={{ background: `linear-gradient(90deg, ${color}, ${color}55)` }}
              />
              <div className="px-4 py-3 flex gap-3 items-start">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-[16px] font-bold"
                  style={{ background: bg, color, boxShadow: `0 0 14px ${color}55` }}
                >
                  {icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className="text-[10px] tracking-widest text-[#8a96ad] font-bold uppercase">
                      AEGIS · BOUNDARY ALERT
                    </span>
                    <button
                      onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
                      className="text-[#5a6478] hover:text-[#c3f5ff] text-[14px] leading-none cursor-pointer transition-colors"
                      aria-label="Dismiss"
                      title="Dismiss"
                    >
                      ×
                    </button>
                  </div>
                  <div
                    className="text-[13px] font-bold tracking-wide leading-tight"
                    style={{ color }}
                  >
                    {t.title}
                  </div>
                  <div className="text-[11px] text-[#dce4e5] mt-1 leading-snug opacity-90">
                    {t.body}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── DANGER ZONE MODAL ── */}
      {showDangerAlert && (
        <div className="fixed inset-0 z-[4000] flex items-center justify-center bg-[rgba(0,0,0,0.6)] backdrop-blur-sm animate-fade-in pointer-events-auto">
          <div className="bg-[#0b1016] border border-[#ef4444] rounded-2xl w-[420px] shadow-[0_0_40px_rgba(239,68,68,0.2)] overflow-hidden relative">
            <div className="absolute inset-0 pointer-events-none rounded-2xl shadow-[inset_0_0_20px_rgba(239,68,68,0.1)]" />
            <div className="p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-10 h-10 rounded-full bg-[rgba(239,68,68,0.1)] border border-[#ef4444] flex items-center justify-center text-[#ef4444]">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </div>
                <h3 className="text-[#ef4444] text-[16px] font-bold tracking-widest font-sans" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>DANGER ZONE BREACH</h3>
              </div>
              <p className="text-[#a1a1aa] text-[12px] leading-relaxed mb-8 font-mono">
                Vessel <strong className="text-white">{dangerAlertBoat}</strong> has entered a DANGER zone. Immediate operator action required. Verify vessel identity and initiate emergency protocols.
              </p>
              <div className="flex items-center gap-4">
                <button onClick={() => setShowDangerAlert(false)} className="flex-1 bg-[#ef4444] text-white py-2.5 rounded-lg text-[11px] font-bold tracking-widest shadow-[0_0_15px_rgba(239,68,68,0.4)] hover:bg-[#dc2626] transition-colors">
                  ACKNOWLEDGE
                </button>
                <button onClick={() => setShowDangerAlert(false)} className="flex-1 bg-transparent border border-[#ef4444] text-[#ef4444] py-2.5 rounded-lg text-[11px] font-bold tracking-widest hover:bg-[rgba(239,68,68,0.1)] transition-colors">
                  RECALL ALL
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
