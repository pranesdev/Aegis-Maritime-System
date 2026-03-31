"use client"

import { useEffect, useRef, useState } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { io, Socket } from "socket.io-client"

interface LeafletMapProps {
  onLocationUpdate: (lat: number, lng: number) => void
  onProximityUpdate: (distance: number) => void
  onSpeedUpdate: (speed: number) => void
  onStatusUpdate?: (status: string) => void
  onEEZUpdate?: (name: string) => void
  onZoneUpdate?: (zone: string) => void
  demoMode?: boolean
}

// ─── Tamil Nadu Maritime Boundaries ─────────────────────────────────────────
// Coordinates are [lat, lng]

// Base Tamil Nadu coastline used to derive fixed-distance maritime zones
const TN_COASTLINE_COORDS: [number, number][] = [
  [13.47, 80.30], [13.32, 80.30], [13.20, 80.30], [13.08, 80.29],
  [12.95, 80.27], [12.82, 80.23], [12.70, 80.20], [12.57, 80.18],
  [12.45, 80.14], [12.32, 80.10], [12.20, 80.06], [12.08, 80.00],
  [11.96, 79.86], [11.84, 79.79], [11.72, 79.77], [11.60, 79.77],
  [11.48, 79.77], [11.36, 79.78], [11.24, 79.80], [11.12, 79.81],
  [11.00, 79.82], [10.88, 79.83], [10.76, 79.84], [10.64, 79.84],
  [10.52, 79.85], [10.40, 79.85], [10.28, 79.84], [10.16, 79.81],
  [10.04, 79.79], [9.92, 79.66], [9.80, 79.53], [9.68, 79.40],
  [9.56, 79.27], [9.44, 79.24], [9.32, 79.30], [9.20, 79.16],
  [9.08, 78.94], [8.96, 78.70], [8.84, 78.48], [8.72, 78.21],
  [8.60, 77.95], [8.48, 77.84], [8.36, 77.74], [8.24, 77.64],
  [8.12, 77.57], [8.02, 77.52],
]

const TN_LAND_CENTROID: [number, number] = [10.9, 78.7]

// Base IMBL coordinates — actual India–Sri Lanka maritime boundary
const IMBL_PALK_COORDS: [number, number][] = [
  [10.80, 80.30], [10.60, 80.20], [10.47, 80.12], [10.22, 79.97],
  [9.95,  79.82], [9.72, 79.67], [9.52, 79.57], [9.35, 79.49],
  [9.17,  79.43], [9.00, 79.35],
]
const IMBL_GULF_COORDS: [number, number][] = [
  [9.17, 79.43], [9.00, 79.20], [8.83, 78.92], [8.68, 78.62],
  [8.53, 78.32], [8.38, 78.02], [8.23, 77.72], [8.10, 77.46],
  [7.95, 77.20], [7.80, 76.95],
]

// offsetLine is a hoisted function declaration defined below — safe to call here
const TN_MARITIME_BOUNDARIES = [
  {
    name: "Tamil Nadu Coastline",
    color: "#06b6d4",
    weight: 2,
    opacity: 0.8,
    dashArray: null as string | null,
    description: "Shoreline (Baseline)",
    usedForDistance: false,
    showInLegend: true,
    coordinates: TN_COASTLINE_COORDS,
  },
  {
    name: "Warning Zone (25 km)",
    color: "#f59e0b",
    weight: 2.5,
    opacity: 0.9,
    dashArray: "10, 6" as string | null,
    description: "Fixed 25 km offshore boundary from TN coast",
    usedForDistance: true,
    showInLegend: true,
    coordinates: offsetFromCoastline(TN_COASTLINE_COORDS, 25, TN_LAND_CENTROID),
  },
  {
    name: "Danger Zone (12 km)",
    color: "#f97316",
    weight: 2.5,
    opacity: 0.95,
    dashArray: "6, 4" as string | null,
    description: "Fixed 12 km offshore boundary from TN coast",
    usedForDistance: true,
    showInLegend: true,
    coordinates: offsetFromCoastline(TN_COASTLINE_COORDS, 12, TN_LAND_CENTROID),
  },
  {
    name: "IMBL — Palk Strait",
    color: "#ef4444",
    weight: 3,
    opacity: 1.0,
    dashArray: "14, 6" as string | null,
    description: "India–Sri Lanka International Maritime Boundary (1974)",
    usedForDistance: true,
    showInLegend: true,
    coordinates: IMBL_PALK_COORDS,
  },
  {
    name: "IMBL — Gulf of Mannar",
    color: "#ef4444",
    weight: 3,
    opacity: 1.0,
    dashArray: "14, 6" as string | null,
    description: "India–Sri Lanka International Maritime Boundary (1976)",
    usedForDistance: true,
    showInLegend: true,
    coordinates: IMBL_GULF_COORDS,
  },
]

// Store boundary segments for distance calculation (IMBL lines only)
let allBoundarySegments: { start: [number, number]; end: [number, number] }[] = []

function initBoundarySegments() {
  allBoundarySegments = []
  for (const boundary of TN_MARITIME_BOUNDARIES) {
    if (!boundary.usedForDistance) continue
    const coords = boundary.coordinates
    for (let i = 0; i < coords.length - 1; i++) {
      allBoundarySegments.push({
        start: coords[i],
        end: coords[i + 1],
      })
    }
  }
}

// Haversine formula for accurate distance calculation
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371 // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

// Calculate distance from point to line segment
function pointToSegmentDistance(
  pLat: number,
  pLng: number,
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const d1 = haversineDistance(pLat, pLng, lat1, lng1)
  const d2 = haversineDistance(pLat, pLng, lat2, lng2)
  const segmentLength = haversineDistance(lat1, lng1, lat2, lng2)

  if (segmentLength < 0.001) return Math.min(d1, d2)

  const t = Math.max(0, Math.min(1,
    ((pLat - lat1) * (lat2 - lat1) + (pLng - lng1) * (lng2 - lng1)) /
    ((lat2 - lat1) * (lat2 - lat1) + (lng2 - lng1) * (lng2 - lng1))
  ))

  const projLat = lat1 + t * (lat2 - lat1)
  const projLng = lng1 + t * (lng2 - lng1)

  return haversineDistance(pLat, pLng, projLat, projLng)
}

// Calculate minimum distance to nearest IMBL boundary
function calculateDistanceToBoundary(lat: number, lng: number): number {
  if (allBoundarySegments.length === 0) initBoundarySegments()

  let minDistance = Infinity
  for (const segment of allBoundarySegments) {
    const distance = pointToSegmentDistance(lat, lng, segment.start[0], segment.start[1], segment.end[0], segment.end[1])
    if (distance < minDistance) minDistance = distance
  }
  return minDistance === Infinity ? 999 : minDistance
}

// Find the name of the nearest boundary line
function findNearestBoundary(lat: number, lng: number): string {
  if (allBoundarySegments.length === 0) initBoundarySegments()

  let minDistance = Infinity
  let nearestName = "Tamil Nadu Waters"

  for (const boundary of TN_MARITIME_BOUNDARIES) {
    const coords = boundary.coordinates
    let featureMin = Infinity
    for (let i = 0; i < coords.length - 1; i++) {
      const d = pointToSegmentDistance(lat, lng, coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1])
      if (d < featureMin) featureMin = d
    }
    if (featureMin < minDistance) {
      minDistance = featureMin
      nearestName = boundary.name
    }
  }
  return nearestName
}

// ─── Demo Mode Route (SAFE → WARNING → DANGER → back) ─────────────────────
const DEMO_WAYPOINTS: { lat: number; lon: number }[] = [
  { lat: 9.80,  lon: 79.10 }, // Start far west — clearly SAFE (>40 km from IMBL)
  { lat: 9.70,  lon: 79.15 }, // Still SAFE
  { lat: 9.60,  lon: 79.22 }, // Still SAFE
  { lat: 9.50,  lon: 79.32 }, // Entering WARNING (~22 km)
  { lat: 9.40,  lon: 79.40 }, // Deep WARNING (~15 km)
  { lat: 9.30,  lon: 79.48 }, // Entering DANGER (~10 km)
  { lat: 9.22,  lon: 79.53 }, // Deep DANGER (~5 km)
  { lat: 9.30,  lon: 79.48 }, // Turning back
  { lat: 9.40,  lon: 79.40 }, // WARNING again
  { lat: 9.50,  lon: 79.32 },
  { lat: 9.60,  lon: 79.22 }, // Back to SAFE
  { lat: 9.70,  lon: 79.15 },
]

// Interpolate many small steps between each waypoint for smooth movement
function buildDemoRoute(waypoints: { lat: number; lon: number }[], stepsPerSegment: number) {
  const result: { lat: number; lon: number }[] = []
  for (let i = 0; i < waypoints.length; i++) {
    const from = waypoints[i]
    const to = waypoints[(i + 1) % waypoints.length]
    for (let s = 0; s < stepsPerSegment; s++) {
      const t = s / stepsPerSegment
      result.push({
        lat: from.lat + (to.lat - from.lat) * t,
        lon: from.lon + (to.lon - from.lon) * t,
      })
    }
  }
  return result
}

const DEMO_ROUTE = buildDemoRoute(DEMO_WAYPOINTS, 40)

export default function LeafletMap({
  onLocationUpdate,
  onProximityUpdate,
  onSpeedUpdate,
  onStatusUpdate,
  onEEZUpdate,
  onZoneUpdate,
  demoMode = false,
}: LeafletMapProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const pathPolylineRef = useRef<L.Polyline | null>(null)
  const pathRef = useRef<[number, number][]>([])
  const socketRef = useRef<Socket | null>(null)
  const [isTracking, setIsTracking] = useState(false)
  const [boundaryCount, setBoundaryCount] = useState(0)
  const lastPositionRef = useRef<{ lat: number; lng: number; time: number } | null>(null)
  const demoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const demoIndexRef = useRef(0)
  const followVesselRef = useRef(true)
  const [followVessel, setFollowVessel] = useState(true)
  const styleElRef = useRef<HTMLStyleElement | null>(null)

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    // Initialize boundary segments
    initBoundarySegments()

    // Initialize map — centred on Tamil Nadu coast
    const map = L.map(mapRef.current, {
      center: [10.5, 79.5],
      zoom: 7,
      zoomControl: true,
      attributionControl: true,
      minZoom: 2,
      maxZoom: 18,
      worldCopyJump: true,
      scrollWheelZoom: true,
      wheelDebounceTime: 80,
      wheelPxPerZoomLevel: 120,
    })

    // Add satellite/ocean tile layer (free, no API key)
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      attribution: 'Tiles &copy; Esri | EEZ Data &copy; Marine Regions',
      maxZoom: 19,
    }).addTo(map)

    // Add a labels layer with larger, clearer place names on satellite view
    L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {
      attribution: '',
      maxZoom: 19,
      pane: 'overlayPane',
      opacity: 0.95,
    }).addTo(map)

    // Draw all Tamil Nadu maritime boundaries
    TN_MARITIME_BOUNDARIES.forEach((boundary) => {
      const latLngs = boundary.coordinates

      // Glow/halo under the line
      L.polyline(latLngs, {
        color: boundary.color,
        weight: boundary.weight + 7,
        opacity: 0.18,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(map)

      // Main boundary line
      const line = L.polyline(latLngs, {
        color: boundary.color,
        weight: boundary.weight,
        opacity: boundary.opacity,
        dashArray: boundary.dashArray ?? undefined,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(map)

      line.bindTooltip(`<b>${boundary.name}</b><br><small>${boundary.description}</small>`, {
        permanent: false,
        direction: "center",
        className: "eez-tooltip",
      })

      // Mid-point label (only for legend-visible entries)
      if (boundary.showInLegend) {
        const mid = latLngs[Math.floor(latLngs.length / 2)]
        L.marker(mid, {
          icon: L.divIcon({
            className: "eez-label",
            html: `<div style="background:${boundary.color};color:#fff;padding:5px 11px;border-radius:7px;font-size:13px;white-space:nowrap;box-shadow:0 2px 10px rgba(0,0,0,0.5);font-weight:700;border:1px solid rgba(255,255,255,0.3);">${boundary.name}</div>`,
            iconSize: [230, 30],
            iconAnchor: [115, 15],
          }),
        }).addTo(map)
      }
    })

    setBoundaryCount(TN_MARITIME_BOUNDARIES.length)

    // Custom vessel marker
    const vesselIcon = L.divIcon({
      className: "vessel-marker",
      html: `
        <div style="position: relative;">
          <div style="position: absolute; width: 46px; height: 46px; left: -3px; top: -3px; background: rgba(6, 182, 212, 0.25); border-radius: 50%; animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
          <div style="position: absolute; width: 32px; height: 32px; left: 4px; top: 4px; background: rgba(34, 197, 94, 0.2); border-radius: 50%; animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite 0.5s;"></div>
          <svg width="40" height="40" viewBox="0 0 64 64" style="filter: drop-shadow(0 4px 8px rgba(0,0,0,0.5));">
            <defs>
              <linearGradient id="vesselGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#06b6d4" />
                <stop offset="50%" stop-color="#22c55e" />
                <stop offset="100%" stop-color="#0891b2" />
              </linearGradient>
            </defs>
            <path fill="#e2f3ff" d="M13 36h38l-7 15H20z" />
            <path fill="url(#vesselGrad)" d="M17 34h30l-5 11H22z" />
            <path fill="#fb923c" d="M29 18h5v16h-5z" />
            <path fill="#f8fafc" d="M34 19l10 6H34z" />
            <path fill="#bae6fd" d="M20 34h24l-3 7H23z" opacity="0.85" />
          </svg>
        </div>
      `,
      iconSize: [40, 40],
      iconAnchor: [20, 40],
    })

    // Initial position
    const initialLat = 9.80
    const initialLng = 79.10
    const marker = L.marker([initialLat, initialLng], { icon: vesselIcon }).addTo(map)
    marker.bindPopup("<b>Your Vessel</b><br>Live ESP32 Tracking").openPopup()
    markerRef.current = marker

    // Path trail polyline
    const pathPolyline = L.polyline([], {
      color: "#38bdf8",
      weight: 3,
      opacity: 0.7,
    }).addTo(map)
    pathPolylineRef.current = pathPolyline

    // Initial updates
    onLocationUpdate(initialLat, initialLng)
    const initialDistance = calculateDistanceToBoundary(initialLat, initialLng)
    onProximityUpdate(initialDistance)
    onSpeedUpdate(0)

    mapInstanceRef.current = map

    // Leaflet needs invalidateSize after flex layout settles.
    // Stop auto-following when user manually pans or zooms.
    const handleDragStart = () => {
      followVesselRef.current = false
      setFollowVessel(false)
    }
    map.on("dragstart", handleDragStart)

    const safeInvalidateSize = () => {
      if (!mapInstanceRef.current) return
      try {
        map.invalidateSize()
      } catch {
        // Ignore late invalidation calls during unmount/teardown.
      }
    }

    const invalidateTimeoutShort = window.setTimeout(safeInvalidateSize, 50)
    const invalidateTimeoutLong = window.setTimeout(safeInvalidateSize, 300)

    // Also revalidate whenever the container is resized
    const ro = new ResizeObserver(safeInvalidateSize)
    if (mapRef.current) ro.observe(mapRef.current)

    // Add styles
    const style = document.createElement("style")
    style.textContent = `
      @keyframes ping {
        75%, 100% { transform: scale(2.5); opacity: 0; }
      }
      .leaflet-container {
        background: linear-gradient(180deg, #0a2540 0%, #0d3058 50%, #071e30 100%);
        font-family: inherit;
      }
      .leaflet-control-zoom a {
        background: rgba(13, 33, 55, 0.95) !important;
        color: #06b6d4 !important;
        border-color: rgba(30, 58, 95, 0.5) !important;
      }
      .leaflet-control-zoom a:hover {
        background: rgba(20, 45, 74, 0.98) !important;
      }
      .leaflet-control-attribution {
        background: rgba(10, 22, 40, 0.85) !important;
        color: #64748b !important;
        font-size: 10px !important;
      }
      .leaflet-control-attribution a {
        color: #06b6d4 !important;
      }
      .eez-tooltip {
        background: rgba(13, 33, 55, 0.98) !important;
        color: white !important;
        border: 1px solid rgba(6, 182, 212, 0.5) !important;
        border-radius: 8px !important;
        padding: 6px 10px !important;
        font-size: 12px !important;
        box-shadow: 0 4px 20px rgba(0,0,0,0.4) !important;
      }
      .leaflet-popup-content-wrapper {
        background: rgba(13, 33, 55, 0.98) !important;
        color: white !important;
        border: 1px solid rgba(6, 182, 212, 0.4) !important;
        border-radius: 12px !important;
        box-shadow: 0 10px 50px rgba(0, 0, 0, 0.5) !important;
      }
      .leaflet-popup-tip {
        background: rgba(13, 33, 55, 0.98) !important;
      }
      .leaflet-popup-close-button {
        color: #06b6d4 !important;
      }
    `
    document.head.appendChild(style)
    styleElRef.current = style

    return () => {
      window.clearTimeout(invalidateTimeoutShort)
      window.clearTimeout(invalidateTimeoutLong)
      ro.disconnect()
      map.off("dragstart", handleDragStart)
      if (styleElRef.current) {
        styleElRef.current.remove()
        styleElRef.current = null
      }
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }
    }
  }, [onLocationUpdate, onProximityUpdate, onSpeedUpdate])

  // Socket.io real-time connection + initial REST fetch
  useEffect(() => {
    if (!mapInstanceRef.current) return

    const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000"

    // Initial REST fetch — show latest position immediately on load
    fetch(`${BACKEND_URL}/api/location`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.lat) return
        const lat = Number(data.lat)
        const lng = Number(data.lon)
        if (markerRef.current && mapInstanceRef.current) {
          markerRef.current.setLatLng([lat, lng])
          if (followVesselRef.current) mapInstanceRef.current.panTo([lat, lng])
        }
        pathRef.current.push([lat, lng])
        pathPolylineRef.current?.setLatLngs(pathRef.current)
        onLocationUpdate(lat, lng)
        const distance = data.distance != null ? Number(data.distance) : calculateDistanceToBoundary(lat, lng)
        onProximityUpdate(distance)
        if (data.zone) onZoneUpdate?.(data.zone)
        onEEZUpdate?.(findNearestBoundary(lat, lng))
        lastPositionRef.current = { lat, lng, time: Date.now() }
        setIsTracking(true)
        onStatusUpdate?.("Backend Connected")
      })
      .catch(() => onStatusUpdate?.("Backend Offline"))

    // Socket.io for real-time push from ESP32
    const socket = io(BACKEND_URL)

    socket.on("connect", () => {
      setIsTracking(true)
      onStatusUpdate?.("Backend Connected")
    })

    socket.on("disconnect", () => {
      setIsTracking(false)
      onStatusUpdate?.("Backend Offline")
    })

    socket.on("locationUpdate", (data: { lat: number; lon: number; distance?: number; zone?: string }) => {
      const lat = Number(data.lat)
      const lng = Number(data.lon)
      const currentTime = Date.now()

      if (markerRef.current && mapInstanceRef.current) {
        markerRef.current.setLatLng([lat, lng])
        if (followVesselRef.current) mapInstanceRef.current.panTo([lat, lng])
      }

      pathRef.current.push([lat, lng])
      if (pathRef.current.length > 200) pathRef.current.shift()
      pathPolylineRef.current?.setLatLngs(pathRef.current)

      onLocationUpdate(lat, lng)
      const distance = data.distance != null ? Number(data.distance) : calculateDistanceToBoundary(lat, lng)
      onProximityUpdate(distance)
      if (data.zone) onZoneUpdate?.(data.zone)
      onEEZUpdate?.(findNearestBoundary(lat, lng))

      if (typeof (data as { speed?: unknown }).speed === "number") {
        const directSpeed = Number((data as { speed: number }).speed)
        if (Number.isFinite(directSpeed) && directSpeed >= 0) {
          onSpeedUpdate(Math.min(directSpeed, 120))
        }
      } else if (lastPositionRef.current) {
        const timeDiff = (currentTime - lastPositionRef.current.time) / 1000 / 3600
        if (timeDiff > 0) {
          const distKm = haversineDistance(lat, lng, lastPositionRef.current.lat, lastPositionRef.current.lng)
          const speedKnots = (distKm / timeDiff) * 0.539957
          if (Number.isFinite(speedKnots) && speedKnots >= 0) onSpeedUpdate(Math.min(speedKnots, 120))
        }
      } else {
        onSpeedUpdate(0)
      }
      lastPositionRef.current = { lat, lng, time: currentTime }
    })

    socketRef.current = socket

    return () => {
      socket.disconnect()
    }
  }, [onLocationUpdate, onProximityUpdate, onSpeedUpdate, onStatusUpdate, onEEZUpdate, onZoneUpdate])

  // ─── Demo Mode ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!demoMode) {
      if (demoIntervalRef.current) {
        clearInterval(demoIntervalRef.current)
        demoIntervalRef.current = null
      }
      return
    }
    // Reset path for fresh demo run
    pathRef.current = []
    pathPolylineRef.current?.setLatLngs([])
    demoIndexRef.current = 0
    setIsTracking(true)
    onStatusUpdate?.("Demo Mode Active")

    demoIntervalRef.current = setInterval(() => {
      if (!mapInstanceRef.current) return
      const point = DEMO_ROUTE[demoIndexRef.current]
      const lat = point.lat
      const lng = point.lon
      const currentTime = Date.now()

      if (markerRef.current) markerRef.current.setLatLng([lat, lng])
      if (followVesselRef.current) mapInstanceRef.current.panTo([lat, lng])

      pathRef.current.push([lat, lng])
      if (pathRef.current.length > 200) pathRef.current.shift()
      pathPolylineRef.current?.setLatLngs(pathRef.current)

      onLocationUpdate(lat, lng)
      const distance = calculateDistanceToBoundary(lat, lng)
      onProximityUpdate(distance)
      onEEZUpdate?.(findNearestBoundary(lat, lng))

      // Determine zone
      if (distance < 12) {
        onZoneUpdate?.("DANGER")
      } else if (distance < 25) {
        onZoneUpdate?.("WARNING")
      } else {
        onZoneUpdate?.("SAFE")
      }

      if (lastPositionRef.current) {
        const timeDiff = (currentTime - lastPositionRef.current.time) / 1000 / 3600
        if (timeDiff > 0) {
          const distKm = haversineDistance(lat, lng, lastPositionRef.current.lat, lastPositionRef.current.lng)
          const speedKnots = (distKm / timeDiff) * 0.539957
          if (Number.isFinite(speedKnots) && speedKnots >= 0) onSpeedUpdate(Math.min(speedKnots, 120))
        }
      } else {
        onSpeedUpdate(0)
      }
      lastPositionRef.current = { lat, lng, time: currentTime }
      demoIndexRef.current = (demoIndexRef.current + 1) % DEMO_ROUTE.length
    }, 250)

    return () => {
      if (demoIntervalRef.current) {
        clearInterval(demoIntervalRef.current)
        demoIntervalRef.current = null
      }
    }
  }, [demoMode, onLocationUpdate, onProximityUpdate, onSpeedUpdate, onStatusUpdate, onEEZUpdate, onZoneUpdate])

  return (
    <div className="relative w-full h-full" style={{ minHeight: '520px' }}>
      <div ref={mapRef} className="w-full h-full" style={{ minHeight: '520px', borderRadius: '1rem' }} />

      <div className="absolute top-4 left-4 z-[1000]">
        <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg text-base font-medium" style={{
          background: "linear-gradient(135deg, rgba(10, 22, 40, 0.95) 0%, rgba(13, 33, 55, 0.9) 100%)",
          border: "1px solid rgba(6, 182, 212, 0.4)",
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.4)",
        }}>
          <div className={`w-3 h-3 rounded-full flex-shrink-0 ${isTracking ? "bg-green-400 animate-pulse" : "bg-yellow-400"}`} />
          <span className="text-sm text-gray-200">{isTracking ? "Live" : "Offline"}</span>
        </div>
      </div>

      <div className="absolute top-4 right-4 z-[1000]">
        <div className="flex items-center gap-2">
          {!followVessel && (
            <button
              onClick={() => {
                followVesselRef.current = true
                setFollowVessel(true)
                if (markerRef.current && mapInstanceRef.current) {
                  mapInstanceRef.current.panTo(markerRef.current.getLatLng())
                }
              }}
              className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg text-sm font-semibold text-white transition-all"
              style={{ background: "rgba(6,182,212,0.9)", border: "1px solid rgba(6,182,212,0.8)", boxShadow: "0 2px 12px rgba(6,182,212,0.4)" }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Re-center
            </button>
          )}
          {followVessel && (
            <div className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg text-sm font-medium" style={{ background: "rgba(10,22,40,0.85)", border: "1px solid rgba(34,197,94,0.4)" }}>
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-green-300">Following</span>
            </div>
          )}
          <div className="px-3 py-2.5 rounded-lg text-sm text-cyan-400 font-medium" style={{ background: "rgba(10,22,40,0.85)", border: "1px solid rgba(6,182,212,0.3)" }}>
            {boundaryCount} limits
          </div>
        </div>
      </div>
    </div>
  )
}

// Create a fixed-distance offshore line from coastline by pushing points away from TN land centroid.
function offsetFromCoastline(
  points: [number, number][],
  offsetKm: number,
  landCentroid: [number, number]
): [number, number][] {
  return points.map(([lat, lng]) => {
    const latScaleKm = 111
    const lngScaleKm = 111 * Math.cos((lat * Math.PI) / 180)

    const awayLatKm = (lat - landCentroid[0]) * latScaleKm
    const awayLngKm = (lng - landCentroid[1]) * lngScaleKm
    const norm = Math.hypot(awayLatKm, awayLngKm) || 1

    const shiftLatKm = (awayLatKm / norm) * offsetKm
    const shiftLngKm = (awayLngKm / norm) * offsetKm

    return [
      lat + shiftLatKm / latScaleKm,
      lng + shiftLngKm / (lngScaleKm || 1),
    ]
  })
}

