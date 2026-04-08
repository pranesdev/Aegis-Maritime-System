"use client"

// ✅ CLEAN RESOLVED VERSION (all conflicts removed)

import { useState, useCallback, useEffect, useRef } from "react"
import dynamic from "next/dynamic"

type AlertEntry = { zone: string; lat: number; lon: number; timestamp: string }
type ZoneStatus = "SAFE" | "WARNING" | "DANGER" | "UNKNOWN"
type BoatSummary = { boatId: string; lat: number; lon: number; zone: ZoneStatus }

const ZONE_MESSAGES: Record<Exclude<ZoneStatus, "UNKNOWN">, string> = {
  SAFE: "You are in safe waters",
  WARNING: "Approaching restricted maritime boundary",
  DANGER: "You have crossed the maritime boundary! Immediate action required",
}

const LeafletMap = dynamic(() => import("@/components/leaflet-map"), {
  ssr: false,
})

export default function MaritimeDashboard() {
  const [vesselId, setVesselId] = useState("")
  const [zone, setZone] = useState<ZoneStatus>("UNKNOWN")
  const [boats, setBoats] = useState<BoatSummary[]>([])
  const [selectedBoatId, setSelectedBoatId] = useState<string | null>(null)

  const safeCount = boats.filter((b) => b.zone === "SAFE").length
  const warningCount = boats.filter((b) => b.zone === "WARNING").length
  const dangerCount = boats.filter((b) => b.zone === "DANGER").length

  const handleSearch = () => {
    if (!vesselId.trim()) return
    const found = boats.find((b) => b.boatId === vesselId.toUpperCase())
    if (found) setSelectedBoatId(found.boatId)
  }

  return (
    <div className="min-h-screen bg-[#020817] text-white p-4">

      {/* HEADER */}
      <header className="flex justify-between items-center mb-4">
        <h1 className="text-lg font-bold text-cyan-400">Maritime Dashboard</h1>

        <div className="flex gap-2">
          <input
            value={vesselId}
            onChange={(e) => setVesselId(e.target.value)}
            placeholder="Vessel ID"
            className="px-3 py-1 bg-[#0d2137] border border-[#1e3a5f] rounded"
          />
          <button
            onClick={handleSearch}
            className="px-3 py-1 bg-cyan-600 rounded"
          >Search</button>
        </div>
      </header>

      {/* MAP */}
      <div className="h-[400px] border border-[#1e3a5f] rounded mb-4">
        <LeafletMap
          onZoneUpdate={(z: string) => setZone(z as ZoneStatus)}
          onBoatsUpdate={(b: BoatSummary[]) => setBoats(b)}
          selectedBoatId={selectedBoatId}
        />
      </div>

      {/* ZONE COUNTS */}
      <div className="grid grid-cols-3 gap-4">
        <ZoneBox label="SAFE" count={safeCount} active={zone === "SAFE"} />
        <ZoneBox label="WARNING" count={warningCount} active={zone === "WARNING"} />
        <ZoneBox label="DANGER" count={dangerCount} active={zone === "DANGER"} />
      </div>
    </div>
  )
}

function ZoneBox({ label, count, active }: { label: string; count: number; active: boolean }) {
  return (
    <div className={`p-4 rounded border ${active ? "border-cyan-400" : "border-gray-600"}`}>
      <p className="text-sm text-gray-400">{label}</p>
      <p className="text-2xl font-bold">{count}</p>
    </div>
  )
}
