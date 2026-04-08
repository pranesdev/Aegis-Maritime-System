"use client"

import { useState, useEffect, useCallback } from "react"

// ─── Types ────────────────────────────────────────────────────────────────────

type MovementRecord = {
  _id: string
  boatId: string
  lat: number
  lon: number
  distance?: number
  zone?: string
  timestamp: string
}

type ZoneEvent = {
  _id: string
  boatId: string
  zone: string
  lat: number
  lon: number
  timestamp: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ZONE_TEXT: Record<string, string> = {
  SAFE:    "text-green-400",
  WARNING: "text-yellow-400",
  DANGER:  "text-red-400",
}

const ZONE_DOT: Record<string, string> = {
  SAFE:    "bg-green-400",
  WARNING: "bg-yellow-400",
  DANGER:  "bg-red-400",
}

const ZONE_BADGE: Record<string, string> = {
  SAFE:    "bg-green-950/40 border-green-500/30 text-green-400",
  WARNING: "bg-yellow-950/40 border-yellow-500/30 text-yellow-300",
  DANGER:  "bg-red-950/40 border-red-500/30 text-red-400",
}

function fmtDate(ts: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "short",
      timeStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(ts)) + " UTC"
  } catch {
    return ts
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ZoneBadge({ zone }: { zone?: string }) {
  if (!zone) return <span className="text-gray-600">—</span>
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-semibold ${
        ZONE_BADGE[zone] ?? "bg-gray-900/40 border-gray-700 text-gray-400"
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
          ZONE_DOT[zone] ?? "bg-gray-600"
        } ${zone === "WARNING" ? "animate-pulse" : ""}`}
      />
      {zone}
    </span>
  )
}

function EmptyRow({ cols, loading }: { cols: number; loading: boolean }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-14 text-center text-gray-500">
        {loading ? (
          <div className="flex items-center justify-center gap-2">
            <div className="w-5 h-5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            <span>Loading…</span>
          </div>
        ) : (
          "No records found"
        )}
      </td>
    </tr>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LogsPage() {
  const [activeTab, setActiveTab]     = useState<"movement" | "zone">("movement")
  const [movements,  setMovements]    = useState<MovementRecord[]>([])
  const [zoneEvents, setZoneEvents]   = useState<ZoneEvent[]>([])
  const [boatFilter, setBoatFilter]   = useState("")
  const [loading,    setLoading]      = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [error,       setError]       = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000"
    const qs      = boatFilter.trim() ? `?boatId=${encodeURIComponent(boatFilter.trim())}` : ""

    setLoading(true)
    setError(null)
    try {
      const [movRes, alertRes] = await Promise.all([
        fetch(`${BACKEND}/api/location/history${qs}`),
        fetch(`${BACKEND}/api/alerts${qs}`),
      ])
      if (movRes.ok)   setMovements(await movRes.json())
      if (alertRes.ok) setZoneEvents(await alertRes.json())
      setLastRefresh(new Date())
    } catch {
      setError("Backend offline — showing cached data")
    } finally {
      setLoading(false)
    }
  }, [boatFilter])

  // Initial fetch + re-fetch when filter changes
  useEffect(() => {
    const id = setTimeout(fetchData, boatFilter ? 400 : 0)
    return () => clearTimeout(id)
  }, [fetchData, boatFilter])

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(fetchData, 30_000)
    return () => clearInterval(id)
  }, [fetchData])

  return (
    <div className="min-h-screen bg-[#020817] text-white font-sans">

      {/* Ambient background */}
      <div className="fixed inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute inset-0 bg-gradient-to-br from-[#020817] via-[#0a1628] to-[#071525]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_rgba(6,182,212,0.08)_0%,_transparent_50%)]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-3 md:px-6 py-5 md:py-8">

        {/* ── Page header ───────────────────────────────────────────────── */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight">Logs</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              Boat movement history and zone change events
            </p>
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto">
            {/* Boat ID filter */}
            <div className="flex items-center bg-[#0d2137] rounded-lg overflow-hidden border border-[#1e3a5f] flex-1 md:flex-none">
              <svg className="w-4 h-4 text-gray-500 ml-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Filter by Boat ID…"
                value={boatFilter}
                onChange={(e) => setBoatFilter(e.target.value)}
                className="bg-transparent px-3 py-1.5 text-sm text-cyan-300 placeholder-cyan-700/50 focus:outline-none w-44 md:w-52"
              />
              {boatFilter && (
                <button
                  onClick={() => setBoatFilter("")}
                  aria-label="Clear filter"
                  className="mr-2 text-gray-500 hover:text-gray-300 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {/* Refresh */}
            <button
              onClick={fetchData}
              disabled={loading}
              aria-label="Refresh data"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1e3a5f] bg-[#0d2137] text-sm text-gray-300 hover:text-gray-100 hover:border-cyan-500/40 transition-colors disabled:opacity-50 flex-shrink-0"
            >
              <svg
                className={`w-4 h-4 flex-shrink-0 ${loading ? "animate-spin" : ""}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>

        {/* Status bar */}
        <div className="flex items-center gap-3 mb-4 text-xs">
          {lastRefresh && (
            <span className="text-gray-600" suppressHydrationWarning>
              Updated {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          {error && (
            <span className="flex items-center gap-1 text-yellow-500">
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              {error}
            </span>
          )}
        </div>

        {/* ── Tabs ──────────────────────────────────────────────────────── */}
        <div className="flex gap-1 border-b border-[#1e3a5f]/50 mb-5">
          {(["movement", "zone"] as const).map((tab) => {
            const label = tab === "movement" ? "Movement History" : "Zone Events"
            const count = tab === "movement" ? movements.length : zoneEvents.length
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  activeTab === tab
                    ? "border-cyan-400 text-cyan-400"
                    : "border-transparent text-gray-400 hover:text-gray-200"
                }`}
              >
                {label}
                <span className="rounded-full px-1.5 py-0.5 text-xs bg-[#1e3a5f]/80 text-gray-400">
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        {/* ── Movement History ──────────────────────────────────────────── */}
        {activeTab === "movement" && (
          <div className="rounded-xl border border-[#1e3a5f]/50 bg-[#0d2137]/60 overflow-hidden">
            <div className="px-4 py-3 border-b border-[#1e3a5f]/40 bg-[#071525]/60 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                Boat Positions
              </span>
              <span className="text-xs text-gray-600">{movements.length} records</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#1e3a5f]/40">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Boat ID
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Latitude
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Longitude
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider hidden md:table-cell">
                      Distance
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Zone
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider hidden lg:table-cell">
                      Timestamp
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {movements.length === 0 ? (
                    <EmptyRow cols={6} loading={loading} />
                  ) : (
                    movements.map((m, i) => (
                      <tr
                        key={m._id ?? i}
                        className="border-b border-[#1e3a5f]/20 last:border-0 hover:bg-[#1e3a5f]/10 transition-colors"
                      >
                        <td className="px-4 py-3 font-mono font-semibold text-cyan-300">
                          {m.boatId ?? "—"}
                        </td>
                        <td className="px-4 py-3 font-mono text-gray-300 tabular-nums">
                          {m.lat != null ? `${m.lat.toFixed(5)}°N` : "—"}
                        </td>
                        <td className="px-4 py-3 font-mono text-gray-300 tabular-nums">
                          {m.lon != null ? `${m.lon.toFixed(5)}°E` : "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-400 tabular-nums hidden md:table-cell">
                          {m.distance != null ? `${m.distance.toFixed(1)} km` : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <ZoneBadge zone={m.zone} />
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs hidden lg:table-cell whitespace-nowrap">
                          {fmtDate(m.timestamp)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Zone Events ───────────────────────────────────────────────── */}
        {activeTab === "zone" && (
          <div className="rounded-xl border border-[#1e3a5f]/50 bg-[#0d2137]/60 overflow-hidden">
            <div className="px-4 py-3 border-b border-[#1e3a5f]/40 bg-[#071525]/60 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                Zone Changes
              </span>
              <span className="text-xs text-gray-600">{zoneEvents.length} events</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#1e3a5f]/40">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Boat ID
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Zone
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Latitude
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Longitude
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider hidden lg:table-cell">
                      Timestamp
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {zoneEvents.length === 0 ? (
                    <EmptyRow cols={5} loading={loading} />
                  ) : (
                    zoneEvents.map((a, i) => (
                      <tr
                        key={a._id ?? i}
                        className="border-b border-[#1e3a5f]/20 last:border-0 hover:bg-[#1e3a5f]/10 transition-colors"
                      >
                        <td className="px-4 py-3 font-mono font-semibold text-cyan-300">
                          {a.boatId ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          <ZoneBadge zone={a.zone} />
                        </td>
                        <td className="px-4 py-3 font-mono text-gray-300 tabular-nums">
                          {a.lat != null ? `${a.lat.toFixed(5)}°N` : "—"}
                        </td>
                        <td className="px-4 py-3 font-mono text-gray-300 tabular-nums">
                          {a.lon != null ? `${a.lon.toFixed(5)}°E` : "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs hidden lg:table-cell whitespace-nowrap">
                          {fmtDate(a.timestamp)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
