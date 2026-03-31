"use client"

import { useState, useCallback, useEffect } from "react"
import dynamic from "next/dynamic"

type AlertEntry = { zone: string; lat: number; lon: number; timestamp: string }

const SAMPLE_ALERTS: AlertEntry[] = [
  { zone: "SAFE",    lat: 9.8012, lon: 79.3045, timestamp: "2026-03-31T18:05:00.000Z" },
  { zone: "WARNING", lat: 9.5534, lon: 79.4412, timestamp: "2026-03-31T18:11:00.000Z" },
  { zone: "DANGER",  lat: 9.3891, lon: 79.5023, timestamp: "2026-03-31T18:16:00.000Z" },
  { zone: "WARNING", lat: 9.4203, lon: 79.4788, timestamp: "2026-03-31T18:19:00.000Z" },
  { zone: "SAFE",    lat: 9.6011, lon: 79.3612, timestamp: "2026-03-31T18:22:00.000Z" },
]

function formatRelativeTime(timestamp: string) {
  const date = new Date(timestamp)
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000)
  if (diffSec < 60)    return `${diffSec}s ago`
  if (diffSec < 3600)  return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "short", timeStyle: "short", timeZone: "UTC",
  }).format(date) + " UTC"
}

const LeafletMap = dynamic(() => import("@/components/leaflet-map"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full rounded-xl bg-[#0a2540] flex items-center justify-center" style={{ minHeight: "500px" }}>
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin" />
        <span className="text-cyan-400 text-sm">Loading Map...</span>
      </div>
    </div>
  ),
})

const ZONE_CONFIG = {
  SAFE:    { dot: "bg-green-400",  text: "text-green-400",  border: "border-green-500/30",  activeBg: "bg-green-950/30",  glow: "34,197,94",   badge: "bg-green-950/30 border-green-500/30 text-green-400",   alertBg: "bg-green-950/80 border-green-500/40",   alertText: "text-green-300"  },
  WARNING: { dot: "bg-yellow-400", text: "text-yellow-400", border: "border-yellow-500/30", activeBg: "bg-yellow-950/30", glow: "250,204,21",  badge: "bg-yellow-950/50 border-yellow-500/50 text-yellow-300", alertBg: "bg-yellow-950/80 border-yellow-500/40", alertText: "text-yellow-300" },
  DANGER:  { dot: "bg-red-400",    text: "text-red-400",    border: "border-red-500/30",    activeBg: "bg-red-950/30",    glow: "239,68,68",   badge: "bg-red-950/50 border-red-500/50 text-red-300",         alertBg: "bg-red-950/80 border-red-500/40",       alertText: "text-red-300"    },
  UNKNOWN: { dot: "bg-gray-600",   text: "text-gray-500",   border: "border-gray-700/50",   activeBg: "",                 glow: "100,116,139", badge: "bg-gray-900/50 border-gray-700/50 text-gray-500",       alertBg: "",                                     alertText: ""                },
}

export default function MaritimeDashboard() {
  const [vesselId,          setVesselId]          = useState("")
  const [currentLocation,   setCurrentLocation]   = useState("Fetching...")
  const [proximityToBorder, setProximityToBorder] = useState("--")
  const [currentSpeed,      setCurrentSpeed]      = useState("--")
  const [serverStatus,      setServerStatus]      = useState("Connecting...")
  const [isNearBoundary,    setIsNearBoundary]    = useState(false)
  const [zone,              setZone]              = useState<"SAFE"|"WARNING"|"DANGER"|"UNKNOWN">("UNKNOWN")
  const [nearestEEZ,        setNearestEEZ]        = useState("Calculating...")
  const [boatId,            setBoatId]            = useState("BOAT1")
  const [alerts,            setAlerts]            = useState<AlertEntry[]>([])
  const [demoMode,          setDemoMode]          = useState(false)
  const [showBoundaryMenu,  setShowBoundaryMenu]  = useState(false)
  const [lastUpdate,        setLastUpdate]        = useState<Date | null>(null)
  const [, setTick]                               = useState(0)

  const handleLocationUpdate = useCallback((lat: number, lng: number) => {
    setCurrentLocation(`${lat.toFixed(4)}\u00b0 N, ${lng.toFixed(4)}\u00b0 E`)
    setLastUpdate(new Date())
  }, [])

  const handleProximityUpdate = useCallback((distance: number) => {
    setProximityToBorder(`${distance.toFixed(1)} km`)
    setIsNearBoundary(distance < 50)
  }, [])

  const handleSpeedUpdate = useCallback((speed: number) => {
    setCurrentSpeed(`${speed.toFixed(1)} kn`)
  }, [])

  const handleZoneUpdate = useCallback((z: string) => {
    setZone(z as "SAFE"|"WARNING"|"DANGER"|"UNKNOWN")
  }, [])
  const handleEEZUpdate = useCallback((name: string) => setNearestEEZ(name), [])

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 15_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000"
    const load = async () => {
      try {
        const [alertRes, locRes] = await Promise.all([
          fetch(`${BACKEND_URL}/api/alerts`),
          fetch(`${BACKEND_URL}/api/location`),
        ])
        if (alertRes.ok) setAlerts(await alertRes.json())
        if (locRes.ok) {
          const loc = await locRes.json()
          if (loc.boatId) setBoatId(loc.boatId)
          if (loc.zone)   setZone(loc.zone)
        }
      } catch { /* backend offline */ }
    }
    load()
    const id = setInterval(load, 10_000)
    return () => clearInterval(id)
  }, [])

  const handleSearch = () => {
    if (!vesselId.trim()) return
    setCurrentLocation("Searching...")
    setTimeout(() => {
      setCurrentLocation("8.9123\u00b0 N, 78.4567\u00b0 E")
      setProximityToBorder("8.3 km")
      setCurrentSpeed("10.1 kn")
    }, 1000)
  }

  const isConnected   = serverStatus === "Backend Connected" || serverStatus === "Demo Mode Active"
  const zoneCfg       = ZONE_CONFIG[zone] ?? ZONE_CONFIG.UNKNOWN
  const displayAlerts = alerts.length > 0 ? alerts : SAMPLE_ALERTS

  return (
    <div className="min-h-screen text-white font-sans flex flex-col bg-[#020817]">
      <div className="fixed inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute inset-0 bg-gradient-to-br from-[#020817] via-[#0a1628] to-[#071525]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_rgba(6,182,212,0.10)_0%,_transparent_50%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_rgba(34,197,94,0.07)_0%,_transparent_50%)]" />
      </div>

      <div className="relative z-10 flex flex-col flex-1 min-h-0">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-[#1e3a5f]/50 gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full border border-cyan-400/60 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-cyan-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-bold tracking-wide text-white leading-tight">Smart Maritime Boundary Detection</h1>
              <p className="text-xs text-cyan-400/70 tracking-widest uppercase">AEGIS System</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center bg-[#0d2137] rounded-lg overflow-hidden border border-[#1e3a5f]">
              <input
                type="text"
                placeholder="Vessel ID..."
                value={vesselId}
                onChange={(e) => setVesselId(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="bg-transparent px-3 py-2 text-base text-cyan-300 placeholder-cyan-700/50 focus:outline-none w-40"
              />
              <button onClick={handleSearch} aria-label="Search vessel"
                className="px-3 py-2 hover:bg-[#1e3a5f]/40 transition-colors border-l border-[#1e3a5f]">
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </button>
            </div>

            <div className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#0d2137] border border-[#1e3a5f]">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isConnected ? "bg-green-400 animate-pulse" : "bg-red-500"}`} />
              <span className="text-sm font-medium text-gray-300">{boatId}</span>
              <span className={`text-sm ${isConnected ? "text-green-400" : "text-red-400"}`}>{serverStatus}</span>
              {lastUpdate && (
                <span className="text-sm text-gray-500 hidden sm:block" suppressHydrationWarning>
                  &middot; {Math.round((Date.now() - lastUpdate.getTime()) / 1000)}s ago
                </span>
              )}
            </div>

            <button onClick={() => setDemoMode(m => !m)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-semibold transition-all border ${
                demoMode
                  ? "bg-purple-700/50 border-purple-400/60 text-white shadow-[0_0_12px_rgba(147,51,234,0.35)]"
                  : "bg-[#0d2137] border-[#1e3a5f] text-gray-300 hover:border-purple-500/50 hover:text-purple-300"}`}>
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${demoMode ? "bg-purple-300 animate-pulse" : "bg-gray-600"}`} />
              {demoMode ? "Stop Demo" : "Demo Mode"}
            </button>
          </div>
        </header>

        {/* Hardware + Zone Status Bar */}
        <div className="flex items-center gap-6 px-6 py-2.5 border-b border-[#1e3a5f]/30 bg-[#071525]/80 flex-wrap">
          <div className="flex items-center gap-2">
            <div className={`relative w-4 h-4 rounded-full flex-shrink-0 transition-all duration-300 ${
              zone === "DANGER" ? "bg-red-500 shadow-[0_0_10px_3px_rgba(239,68,68,0.6)]"
              : zone === "WARNING" ? "bg-yellow-400 shadow-[0_0_10px_3px_rgba(250,204,21,0.5)] animate-pulse"
              : "bg-gray-700 border border-gray-600"}`} />
            <span className="text-sm text-gray-500 uppercase tracking-wider">LED</span>
            <span className={`text-sm font-semibold ${zone === "DANGER" ? "text-red-400" : zone === "WARNING" ? "text-yellow-400" : "text-gray-600"}`}>
              {zone === "DANGER" ? "ON" : zone === "WARNING" ? "BLINK" : "OFF"}
            </span>
          </div>

          <div className="w-px h-4 bg-[#1e3a5f]" aria-hidden="true" />

          <div className="flex items-center gap-2">
            <svg className={`w-4 h-4 flex-shrink-0 ${zone === "DANGER" ? "text-red-400 drop-shadow-[0_0_5px_rgba(239,68,68,0.8)]" : "text-gray-600"}`} fill="currentColor" viewBox="0 0 24 24">
              <path d="M3 9v6h4l5 5V4L7 9H3z" />
              {zone === "DANGER" && <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />}
            </svg>
            <span className="text-sm text-gray-500 uppercase tracking-wider">Buzzer</span>
            <span className={`text-sm font-semibold ${zone === "DANGER" ? "text-red-400" : "text-gray-600"}`}>
              {zone === "DANGER" ? "ACTIVE" : "OFF"}
            </span>
          </div>

          <div className="w-px h-4 bg-[#1e3a5f]" aria-hidden="true" />

          <div role="status" aria-label={`Current zone: ${zone}`}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm font-bold uppercase tracking-wider ${zoneCfg.badge}`}>
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${zoneCfg.dot} ${zone === "WARNING" ? "animate-pulse" : ""}`} />
            Zone: {zone}
          </div>

          {demoMode && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-purple-500/40 bg-purple-900/20 ml-auto">
              <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
              <span className="text-purple-300 text-sm font-semibold uppercase tracking-wider">Demo Active</span>
            </div>
          )}
        </div>

        {/* Zone Alert Banner */}
        {(zone === "DANGER" || zone === "WARNING") && (
          <div role="alert" className={`flex items-center gap-3 px-6 py-2.5 border-b ${zoneCfg.alertBg}`}>
            <div className={`w-2 h-2 rounded-full animate-pulse flex-shrink-0 ${zoneCfg.dot}`} />
            <span className={`text-base font-semibold ${zoneCfg.alertText}`}>
              {zone === "DANGER"
                ? "DANGER ZONE -- Vessel has crossed into restricted waters!"
                : "WARNING -- Vessel is approaching a boundary zone"}
            </span>
            <div className="ml-auto flex items-center gap-3 text-sm text-gray-400 flex-shrink-0">
              <span>{boatId}</span>
              <span>{proximityToBorder} to border</span>
            </div>
          </div>
        )}

        {/* Main Content */}
        <div className="flex flex-col lg:flex-row flex-1 min-h-0 p-5 gap-5">
          {/* Sidebar metric cards */}
          <div className="flex flex-row lg:flex-col gap-3 lg:w-72 xl:w-80 flex-shrink-0 flex-wrap lg:flex-nowrap">
            <MetricCard label="Current Location" value={currentLocation} accent="cyan"
              icon={<svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" /></svg>} />
            <MetricCard label="Proximity to Border" value={proximityToBorder} accent={isNearBoundary ? "red" : "green"} alert={isNearBoundary}
              icon={<svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" strokeWidth={2} /><circle cx="12" cy="12" r="6" strokeWidth={2} />
                <circle cx="12" cy="12" r="2" strokeWidth={2} /><path strokeLinecap="round" strokeWidth={2} d="M12 2v4M12 18v4M2 12h4M18 12h4" /></svg>} />
            <MetricCard label="Current Speed" value={currentSpeed} accent="cyan"
              icon={<svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>} />
            <MetricCard label="Nearest EEZ" value={nearestEEZ.replace(" EEZ", "")} accent="amber"
              icon={<svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064" /></svg>} />
          </div>

          {/* Map */}
          <div className="flex-1 relative rounded-xl overflow-hidden"
            style={{ minHeight: "500px", border: "1px solid rgba(30, 58, 95, 0.5)", boxShadow: "0 0 30px rgba(6, 182, 212, 0.06)" }}>
            <LeafletMap
              onLocationUpdate={handleLocationUpdate}
              onProximityUpdate={handleProximityUpdate}
              onSpeedUpdate={handleSpeedUpdate}
              onStatusUpdate={setServerStatus}
              onZoneUpdate={handleZoneUpdate}
              onEEZUpdate={handleEEZUpdate}
              demoMode={demoMode}
            />
            {/* Status overlay */}
            <div className="absolute bottom-3 left-3 right-3 z-[1000] pointer-events-none">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl p-4"
                style={{ background: "rgba(10, 22, 40, 0.9)", backdropFilter: "blur(12px)", border: "1px solid rgba(30, 58, 95, 0.4)" }}>
                <OverlayStat label="Location" value={currentLocation}   color={isNearBoundary ? "text-red-300" : "text-cyan-300"} />
                <OverlayStat label="Distance" value={proximityToBorder} color={isNearBoundary ? "text-red-300" : "text-green-300"} />
                <OverlayStat label="Speed"    value={currentSpeed}      color="text-cyan-300" />
                <OverlayStat label="Zone"     value={zone}              color={zoneCfg.text} />
              </div>
            </div>
          </div>
        </div>

        {/* Bottom panels */}
        <div className="flex flex-col lg:flex-row px-5 gap-5 pb-5">
          <div className="flex-1 rounded-xl p-5 border border-[#1e3a5f]/50 bg-[#0d2137]/70">
            <h2 className="text-sm font-bold text-cyan-400 mb-4 uppercase tracking-widest">Vessels by Zone</h2>
            <div className="grid grid-cols-3 gap-3">
              <ZoneCount zone="SAFE"    count={zone === "SAFE"    ? 1 : 0} active={zone === "SAFE"} />
              <ZoneCount zone="WARNING" count={zone === "WARNING" ? 1 : 0} active={zone === "WARNING"} />
              <ZoneCount zone="DANGER"  count={zone === "DANGER"  ? 1 : 0} active={zone === "DANGER"} />
            </div>
          </div>

          <div className="lg:w-80 xl:w-96 rounded-xl p-5 border border-[#1e3a5f]/50 bg-[#0d2137]/70">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-cyan-400 uppercase tracking-widest">Zone Change Log</h2>
              <span className="text-sm text-gray-600">{displayAlerts.length} events</span>
            </div>
            <div className="overflow-y-auto max-h-48 pr-1">
              {displayAlerts.map((a, i) => <AlertRow key={i} alert={a} />)}
            </div>
          </div>
        </div>

        {/* Legend + Footer */}
        <div className="px-5 pb-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl p-3 border border-[#1e3a5f]/30 bg-[#0d2137]/40 relative">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <button
                onClick={() => setShowBoundaryMenu((prev) => !prev)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold uppercase tracking-wider border border-cyan-500/40 text-cyan-300 bg-[#0a1e33] hover:bg-[#102742] transition-colors"
              >
                <span className="w-2 h-2 rounded-full bg-cyan-400" />
                Boundary Guide
                <span className="text-cyan-500">{showBoundaryMenu ? "Close" : "Open"}</span>
              </button>
              <LegendItem color="#22c55e" label="Safe (>25 km from coast)" />
              <LegendItem color="#f59e0b" label="Warning (12-25 km from coast)" dashed />
              <LegendItem color="#f97316" label="Danger (<12 km from coast)" dashed />
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-500 flex-shrink-0">
              <div className="flex items-center gap-1.5">
                <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-green-400 animate-pulse" : "bg-red-500"}`} />
                <span>{serverStatus}</span>
              </div>
              <span>&copy; 2026 Maritime Safety Authority</span>
            </div>

            {showBoundaryMenu && (
              <div className="absolute bottom-[calc(100%+10px)] left-0 right-0 rounded-xl border border-cyan-500/30 bg-[#071525]/95 backdrop-blur-md p-4 shadow-[0_12px_40px_rgba(0,0,0,0.45)] z-20">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-cyan-300">Tamil Nadu Maritime Boundary Guide</h3>
                  <span className="text-sm text-gray-500">Fixed-distance offshore zones</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <BoundaryGuideItem color="#06b6d4" title="Tamil Nadu Coastline" subtitle="Baseline reference (shoreline)" />
                  <BoundaryGuideItem color="#f59e0b" title="Warning Zone (25 km)" subtitle="Fixed 25 km from coast, approach with caution" dashed />
                  <BoundaryGuideItem color="#f97316" title="Danger Zone (12 km)" subtitle="Fixed 12 km from coast, turn back immediately" dashed />
                  <BoundaryGuideItem color="#ef4444" title="IMBL - Palk Strait" subtitle="International maritime boundary (1974)" dashed />
                  <BoundaryGuideItem color="#ef4444" title="IMBL - Gulf of Mannar" subtitle="International maritime boundary (1976)" dashed />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Sub-components

function MetricCard({ label, value, accent, icon, alert }: {
  label: string; value: string; accent: "cyan"|"green"|"red"|"amber"; icon: React.ReactNode; alert?: boolean
}) {
  const cfg = {
    cyan:  { border: "rgba(6,182,212,0.3)",  glow: "rgba(6,182,212,0.12)",  text: "text-cyan-300",  iconBg: "from-cyan-500 to-teal-600"   },
    green: { border: "rgba(34,197,94,0.3)",  glow: "rgba(34,197,94,0.12)",  text: "text-green-300", iconBg: "from-green-500 to-teal-600"  },
    red:   { border: "rgba(239,68,68,0.4)",  glow: "rgba(239,68,68,0.2)",   text: "text-red-300",   iconBg: "from-red-500 to-red-700"     },
    amber: { border: "rgba(245,158,11,0.3)", glow: "rgba(245,158,11,0.12)", text: "text-amber-300", iconBg: "from-amber-500 to-orange-600" },
  }[accent]
  return (
    <div className={`flex items-center gap-3 p-5 rounded-xl w-full transition-all duration-300 ${alert ? "animate-pulse" : ""}`}
      style={{ background: "linear-gradient(135deg, #0f2d4e 0%, #0a1e33 100%)", boxShadow: `0 4px 16px ${cfg.glow}`, border: `1px solid ${cfg.border}` }}>
      <div className={`w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 bg-gradient-to-br ${cfg.iconBg}`}>{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-gray-400 uppercase tracking-wider leading-none mb-1">{label}</p>
        <p className={`text-base font-mono font-semibold ${cfg.text} truncate`}>{value}</p>
      </div>
    </div>
  )
}

function OverlayStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="text-center">
      <p className="text-xs text-gray-500 uppercase tracking-wider mb-1 leading-none">{label}</p>
      <p className={`text-base font-mono font-medium ${color} truncate`}>{value}</p>
    </div>
  )
}

function ZoneCount({ zone, count, active }: { zone: string; count: number; active: boolean }) {
  const cfg = ZONE_CONFIG[zone as keyof typeof ZONE_CONFIG]
  return (
    <div className={`flex flex-col items-center justify-center gap-2 rounded-xl border p-5 ${cfg.border} ${active ? cfg.activeBg : ""} transition-all`}
      style={{ boxShadow: active ? `0 0 20px rgba(${cfg.glow},0.2)` : "none" }}>
      <div className={`w-8 h-8 rounded-full border-2 ${cfg.border} flex items-center justify-center ${active ? "animate-pulse" : ""}`}>
        <span className={`w-3.5 h-3.5 rounded-full ${cfg.dot}`} />
      </div>
      <p className={`text-sm font-bold uppercase tracking-widest ${cfg.text}`}>{zone}</p>
      <p className={`text-4xl font-black leading-none ${cfg.text}`}>{count}</p>
      <p className="text-sm text-gray-500">{count === 1 ? "vessel" : "vessels"}</p>
    </div>
  )
}

function AlertRow({ alert }: { alert: AlertEntry }) {
  const dotColor  = alert.zone === "DANGER" ? "bg-red-400"   : alert.zone === "WARNING" ? "bg-yellow-400" : "bg-green-400"
  const textColor = alert.zone === "DANGER" ? "text-red-400" : alert.zone === "WARNING" ? "text-yellow-400" : "text-green-400"
  return (
    <div className="flex items-center gap-2.5 py-2 border-b border-[#1e3a5f]/20 last:border-0">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
      <span className={`text-sm font-bold w-20 flex-shrink-0 ${textColor}`}>{alert.zone}</span>
      <span className="text-sm text-gray-500 flex-1 truncate">{alert.lat?.toFixed(4)}&deg;N, {alert.lon?.toFixed(4)}&deg;E</span>
      <span className="text-sm text-gray-600 flex-shrink-0 whitespace-nowrap">{formatRelativeTime(alert.timestamp)}</span>
    </div>
  )
}

function LegendItem({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-sm text-gray-400">
      <span className="inline-block w-6 h-0.5 rounded flex-shrink-0"
        style={{ background: dashed ? `repeating-linear-gradient(90deg,${color} 0,${color} 4px,transparent 4px,transparent 7px)` : color }} />
      {label}
    </span>
  )
}

function BoundaryGuideItem({ color, title, subtitle, dashed }: { color: string; title: string; subtitle: string; dashed?: boolean }) {
  return (
    <div className="rounded-lg border border-[#1e3a5f]/40 bg-[#0b1d32]/80 p-3">
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="inline-block w-8 h-0.5 rounded flex-shrink-0"
          style={{ background: dashed ? `repeating-linear-gradient(90deg,${color} 0,${color} 4px,transparent 4px,transparent 7px)` : color }}
        />
        <span className="text-sm font-semibold text-gray-100">{title}</span>
      </div>
      <p className="text-sm text-gray-400">{subtitle}</p>
    </div>
  )
}
