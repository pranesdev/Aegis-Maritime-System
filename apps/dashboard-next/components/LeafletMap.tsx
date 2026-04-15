"use client"

import { useEffect, useRef, useState } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { io, Socket } from "socket.io-client"
import * as turf from "@turf/turf"

interface LeafletMapProps {
  onLocationUpdate: (lat: number, lng: number) => void
  onProximityUpdate: (distance: number) => void
  onSpeedUpdate: (speed: number) => void
  onStatusUpdate?: (status: string) => void
  onEEZUpdate?: (name: string) => void
  onZoneUpdate?: (zone: string) => void
  onBoatSelect?: (boat: BoatMarkerData) => void
  onBoatsUpdate?: (boats: BoatMarkerData[]) => void
  selectedBoatId?: string | null
  demoMode?: boolean
}

type BoatZoneStatus = "SAFE" | "WARNING" | "DANGER"
type ZoneWithUnknown = BoatZoneStatus | "UNKNOWN"
type GeofenceZoneStatus = "DANGER" | "WARNING" | "ALERT" | "CLEAR"

type BoatMarkerData = {
  boatId: string
  lat: number
  lon: number
  zone: ZoneWithUnknown
  distance?: number
  timestamp?: string
}

type TurfLineFeature = turf.Feature<turf.LineString | turf.MultiLineString>

// ─── Tamil Nadu Coastline + Distance Zones ─────────────────────────────────
// Coordinates are [lat, lng]
const TN_COASTLINE_FALLBACK: [number, number][] = [
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

const BUFFER_ZONE_KM = {
  DANGER: 5,
  WARNING: 12,
  ALERT: 20,
} as const

let coastlineSegments: { start: [number, number]; end: [number, number] }[] = []
let imblSegments: { start: [number, number]; end: [number, number] }[] = []

const IMBL_OFFSET_DIRECTION = -1
const IMBL_OFFSET_CONFIG = [
  { name: "Danger Line", distanceKm: -5, color: "#ea580c" },
  { name: "Warning Line", distanceKm: -12, color: "#eab308" },
  { name: "Safe Line", distanceKm: -20, color: "#22c55e" },
] as const

function initCoastlineSegments(coastlineCoords: [number, number][]) {
  coastlineSegments = []
  for (let i = 0; i < coastlineCoords.length - 1; i++) {
    coastlineSegments.push({
      start: coastlineCoords[i],
      end: coastlineCoords[i + 1],
    })
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

function calculateBearing(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
  const phi1 = (fromLat * Math.PI) / 180
  const phi2 = (toLat * Math.PI) / 180
  const deltaLambda = ((toLon - fromLon) * Math.PI) / 180
  const y = Math.sin(deltaLambda) * Math.cos(phi2)
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda)
  const theta = Math.atan2(y, x)
  return ((theta * 180) / Math.PI + 360) % 360
}

function calculateDistanceToBoundary(lat: number, lng: number): number {
  if (coastlineSegments.length === 0) initCoastlineSegments(TN_COASTLINE_FALLBACK)

  let minDistance = Infinity
  for (const segment of coastlineSegments) {
    const distance = pointToSegmentDistance(lat, lng, segment.start[0], segment.start[1], segment.end[0], segment.end[1])
    if (distance < minDistance) minDistance = distance
  }
  return minDistance === Infinity ? 999 : minDistance
}

function extractImblSegments(data: unknown): { start: [number, number]; end: [number, number] }[] {
  const segments: { start: [number, number]; end: [number, number] }[] = []
  const featureCollection = data as {
    type?: string
    features?: Array<{ geometry?: { type?: string; coordinates?: unknown } }>
  }
  if (featureCollection?.type !== "FeatureCollection" || !Array.isArray(featureCollection.features)) return segments

  const pushLineSegments = (line: unknown) => {
    if (!Array.isArray(line)) return
    const points = line
      .filter((point): point is [number, number] => Array.isArray(point) && point.length >= 2)
      .map(([lng, lat]) => [Number(lat), Number(lng)] as [number, number])
      .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng))
    for (let i = 0; i < points.length - 1; i++) {
      segments.push({ start: points[i], end: points[i + 1] })
    }
  }

  for (const feature of featureCollection.features) {
    const geometry = feature?.geometry
    if (!geometry) continue
    if (geometry.type === "LineString") pushLineSegments(geometry.coordinates)
    if (geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)) {
      for (const line of geometry.coordinates) pushLineSegments(line)
    }
  }

  return segments
}

function calculateDistanceToImblBoundary(lat: number, lng: number): number {
  if (imblSegments.length === 0) return calculateDistanceToBoundary(lat, lng)
  let minDistance = Infinity
  for (const segment of imblSegments) {
    const distance = pointToSegmentDistance(lat, lng, segment.start[0], segment.start[1], segment.end[0], segment.end[1])
    if (distance < minDistance) minDistance = distance
  }
  return minDistance === Infinity ? 999 : minDistance
}

function findNearestBoundary(lat: number, lng: number): string {
  const distance = calculateDistanceToImblBoundary(lat, lng)
  if (distance <= BUFFER_ZONE_KM.DANGER) return `DANGER Zone (${BUFFER_ZONE_KM.DANGER} km)`
  if (distance <= BUFFER_ZONE_KM.WARNING) return `WARNING Zone (${BUFFER_ZONE_KM.WARNING} km)`
  if (distance <= BUFFER_ZONE_KM.ALERT) return `ALERT Zone (${BUFFER_ZONE_KM.ALERT} km)`
  return "Deep Indian Waters. You are safe."
}

function parseCoastlineFromGeoJson(data: unknown): [number, number][] | null {
  if (!data || typeof data !== "object") return null
  const featureCollection = data as {
    type?: string
    features?: Array<{ geometry?: { type?: string; coordinates?: unknown } }>
  }
  if (featureCollection.type !== "FeatureCollection" || !Array.isArray(featureCollection.features)) return null

  const latLngs: [number, number][] = []
  for (const feature of featureCollection.features) {
    if (feature?.geometry?.type !== "LineString") continue
    const coords = feature.geometry.coordinates
    if (!Array.isArray(coords)) continue

    const segment = coords
      .filter((point): point is [number, number] => Array.isArray(point) && point.length >= 2)
      .map(([lng, lat]) => [Number(lat), Number(lng)] as [number, number])
      .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng))

    if (segment.length === 0) continue

    if (latLngs.length > 0) {
      const [prevLat, prevLng] = latLngs[latLngs.length - 1]
      const [nextLat, nextLng] = segment[0]
      if (Math.abs(prevLat - nextLat) < 1e-6 && Math.abs(prevLng - nextLng) < 1e-6) {
        latLngs.push(...segment.slice(1))
      } else {
        latLngs.push(...segment)
      }
    } else {
      latLngs.push(...segment)
    }
  }

  return latLngs.length > 1 ? latLngs : null
}

function extractImblLineFeature(data: unknown): TurfLineFeature | null {
  if (!data || typeof data !== "object") return null

  const maybeFeature = data as { type?: string; geometry?: { type?: string; coordinates?: unknown } }
  if (
    maybeFeature.type === "Feature" &&
    (maybeFeature.geometry?.type === "LineString" || maybeFeature.geometry?.type === "MultiLineString")
  ) {
    return maybeFeature as TurfLineFeature
  }

  const featureCollection = data as { type?: string; features?: Array<{ geometry?: { type?: string; coordinates?: unknown } }> }
  if (featureCollection.type !== "FeatureCollection" || !Array.isArray(featureCollection.features)) return null

  const lineFeature = featureCollection.features.find(
    (feature) => feature?.geometry?.type === "LineString" || feature?.geometry?.type === "MultiLineString"
  )

  return (lineFeature as TurfLineFeature) ?? null
}

function normalizeLineStringCoordinates(coords: unknown): [number, number][] {
  if (!Array.isArray(coords)) return []
  return coords
    .filter((point): point is [number, number] => Array.isArray(point) && point.length >= 2)
    .map(([lng, lat]) => [Number(lat), Number(lng)] as [number, number])
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng))
}

function getLineStringsFromFeature(feature: TurfLineFeature | null): [number, number][][] {
  if (!feature || !feature.geometry) return []

  const geometry = feature.geometry
  if (geometry.type === "LineString") {
    const line = normalizeLineStringCoordinates(geometry.coordinates)
    return line.length > 1 ? [line] : []
  }

  if (geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates
      .map(normalizeLineStringCoordinates)
      .filter((line) => line.length > 1)
  }

  return []
}

function buildImblOffsetFeatures(data: unknown) {
  const sourceLine = extractImblLineFeature(data)
  if (!sourceLine) return [] as Array<{ name: string; color: string; distanceKm: number; feature: TurfLineFeature }>

  return IMBL_OFFSET_CONFIG.map((config) => {
    try {
      const feature = turf.lineOffset(sourceLine as any, IMBL_OFFSET_DIRECTION * config.distanceKm, {
        units: "kilometers",
      }) as TurfLineFeature

      const lines = getLineStringsFromFeature(feature)
      if (lines.length === 0) {
        console.warn("Skipping invalid IMBL offset feature geometry", { config })
        return null
      }

      return {
        name: config.name,
        color: config.color,
        distanceKm: config.distanceKm,
        feature,
      }
    } catch (error) {
      console.warn("Failed to create IMBL offset feature", { config, error: error instanceof Error ? error.message : String(error) })
      return null
    }
  }).filter(Boolean) as Array<{ name: string; color: string; distanceKm: number; feature: TurfLineFeature }>
}

function getMidpointLatLngFromFeature(feature: TurfLineFeature): [number, number] | null {
  const geometry = feature.geometry
  if (geometry.type === "LineString") {
    const coords = geometry.coordinates
    if (!Array.isArray(coords) || coords.length === 0) return null
    const mid = coords[Math.floor(coords.length / 2)]
    if (!Array.isArray(mid) || mid.length < 2) return null
    return [Number(mid[1]), Number(mid[0])]
  }

  if (geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)) {
    const line = geometry.coordinates.find((segment: unknown) => Array.isArray(segment) && segment.length > 0)
    if (!line || !Array.isArray(line)) return null
    const mid = line[Math.floor(line.length / 2)]
    if (!Array.isArray(mid) || mid.length < 2) return null
    return [Number(mid[1]), Number(mid[0])]
  }

  return null
}

// ─── Demo Mode Route (SAFE near coast → WARNING → DANGER farther offshore → back) ──
const DEMO_WAYPOINTS: { lat: number; lon: number }[] = [
  { lat: 9.80,  lon: 79.10 },
  { lat: 9.70,  lon: 79.15 },
  { lat: 9.60,  lon: 79.22 },
  { lat: 9.50,  lon: 79.32 },
  { lat: 9.40,  lon: 79.40 },
  { lat: 9.30,  lon: 79.48 },
  { lat: 9.22,  lon: 79.53 },
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
  onBoatSelect,
  onBoatsUpdate,
  selectedBoatId,
  demoMode = false,
}: LeafletMapProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  const markerByBoatRef = useRef<Map<string, any>>(new Map())
  const boatDataByIdRef = useRef<Map<string, BoatMarkerData>>(new Map())
  const pathPolylineRef = useRef<any>(null)
  const pathRef = useRef<[number, number][]>([])
  const socketRef = useRef<Socket | null>(null)
  const [isTracking, setIsTracking] = useState(false)
  const [boundaryCount, setBoundaryCount] = useState(0)
  const lastPositionByBoatRef = useRef<Map<string, { lat: number; lng: number; time: number }>>(new Map())
  const headingByBoatRef = useRef<Map<string, number>>(new Map())
  const demoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const demoIndexRef = useRef(0)
  const followVesselRef = useRef(true)
  const selectedBoatIdRef = useRef<string | null>(selectedBoatId ?? null)
  const primaryPathBoatIdRef = useRef<string | null>(selectedBoatId ?? null)
  const [followVessel, setFollowVessel] = useState(true)
  const styleElRef = useRef<HTMLStyleElement | null>(null)
  const zoneBoundaryRefs = useRef<{ safe: any; warning: any; danger: any }>({
    safe: null,
    warning: null,
    danger: null,
  })
  const trajectoryPolylineRef = useRef<any>(null)

  const normalizeZone = (zone: unknown): ZoneWithUnknown => {
    if (zone === "SAFE" || zone === "WARNING" || zone === "DANGER") return zone
    return "UNKNOWN"
  }

  const vesselIcon = (zone: ZoneWithUnknown, selected: boolean, headingDeg: number) => {
    const ringColor = zone === "DANGER" ? "#ff4a4a" : zone === "WARNING" ? "#fde047" : zone === "SAFE" ? "#5effa8" : "#38bdf8"
    return L.divIcon({
      className: `vessel-marker ${selected ? "selected" : ""}`,
      html: `
        <div class="boat-marker-wrapper ${selected ? "selected" : ""}" style="transform: rotate(${headingDeg}deg); --ring-color: ${ringColor};">
          <div class="boat-marker-radar">
            <span class="boat-radar-ring"></span>
            <span class="boat-radar-ring boat-radar-ring--delay"></span>
          </div>
          <img src="/icons/boat-1.png" class="boat-marker-icon" alt="Boat marker" />
        </div>
      `,
      iconSize: [48, 48],
      iconAnchor: [24, 36],
      tooltipAnchor: [0, -18],
      popupAnchor: [0, -20],
    })
  }

  const getZoneFromDistance = (distanceKm: number): GeofenceZoneStatus => {
    if (distanceKm <= BUFFER_ZONE_KM.DANGER) return "DANGER"
    if (distanceKm <= BUFFER_ZONE_KM.WARNING) return "WARNING"
    if (distanceKm <= BUFFER_ZONE_KM.ALERT) return "ALERT"
    return "CLEAR"
  }

  const geofenceZoneToBoatZone = (zone: GeofenceZoneStatus): BoatZoneStatus => {
    if (zone === "DANGER") return "DANGER"
    if (zone === "WARNING") return "WARNING"
    return "SAFE"
  }

  const updateBoundaryStyles = (zone: GeofenceZoneStatus) => {
    const safeLine = zoneBoundaryRefs.current.safe
    const warningLine = zoneBoundaryRefs.current.warning
    const dangerLine = zoneBoundaryRefs.current.danger

    if (safeLine) {
      safeLine.setStyle({
        color: zone === "ALERT" || zone === "CLEAR" ? "#22c55e" : "#16a34a",
        weight: zone === "ALERT" || zone === "CLEAR" ? 3.2 : 2.5,
        opacity: zone === "ALERT" || zone === "CLEAR" ? 1 : 0.85,
      })
    }

    if (warningLine) {
      warningLine.setStyle({
        color: zone === "WARNING" || zone === "DANGER" ? "#fde047" : "#f59e0b",
        weight: zone === "WARNING" || zone === "DANGER" ? 4 : 2.5,
        opacity: zone === "WARNING" || zone === "DANGER" ? 1 : 0.9,
      })
    }

    if (dangerLine) {
      dangerLine.setStyle({
        color: zone === "DANGER" ? "#ef4444" : "#f97316",
        weight: zone === "DANGER" ? 4.5 : 2.5,
        opacity: zone === "DANGER" ? 1 : 0.95,
      })
    }
  }

  const processGeofenceState = (lat: number, lng: number): GeofenceZoneStatus => {
    const distance = calculateDistanceToImblBoundary(lat, lng)
    const zone = getZoneFromDistance(distance)
    onProximityUpdate(distance)
    onZoneUpdate?.(zone)
    onEEZUpdate?.(findNearestBoundary(lat, lng))
    updateBoundaryStyles(zone)
    return zone
  }

  const getZoneColor = (zone: ZoneWithUnknown) =>
    zone === "DANGER" ? "#ff4a4a" : zone === "WARNING" ? "#fde047" : zone === "SAFE" ? "#5effa8" : "#38bdf8"

  const updateMarkerAppearance = (marker: any, boat: BoatMarkerData, selected: boolean) => {
    const element = marker.getElement() as HTMLElement | null
    if (!element) return

    const wrapper = element.querySelector(".boat-marker-wrapper") as HTMLElement | null
    if (!wrapper) return

    wrapper.classList.toggle("selected", selected)
    wrapper.style.setProperty("--ring-color", getZoneColor(boat.zone))
  }

  const emitBoats = () => {
    const boats = Array.from(boatDataByIdRef.current.values()).sort((a, b) => a.boatId.localeCompare(b.boatId))
    onBoatsUpdate?.(boats)
  }

  const refreshMarkerStyles = () => {
    const selected = selectedBoatIdRef.current
    for (const [id, marker] of markerByBoatRef.current.entries()) {
      const boat = boatDataByIdRef.current.get(id)
      if (!boat) continue
      updateMarkerAppearance(marker, boat, selected === id)
      marker.setTooltipContent(`<b>${boat.boatId}</b><br>Status: ${boat.zone}`)
    }
  }

  const updateSelectedBoatState = (boat: BoatMarkerData, currentTime: number, directSpeed?: number) => {
    onLocationUpdate(boat.lat, boat.lon)
    processGeofenceState(boat.lat, boat.lon)

    const prev = lastPositionByBoatRef.current.get(boat.boatId)
    let speedKnots = 0
    if (typeof directSpeed === "number" && Number.isFinite(directSpeed) && directSpeed >= 0) {
      speedKnots = Math.min(directSpeed, 120)
      onSpeedUpdate(speedKnots)
    } else if (prev) {
      const timeDiff = (currentTime - prev.time) / 1000 / 3600
      if (timeDiff > 0) {
        const distKm = haversineDistance(boat.lat, boat.lon, prev.lat, prev.lng)
        speedKnots = (distKm / timeDiff) * 0.539957
        if (Number.isFinite(speedKnots) && speedKnots >= 0) {
          speedKnots = Math.min(speedKnots, 120)
          onSpeedUpdate(speedKnots)
        }
      }
    } else {
      onSpeedUpdate(0)
    }

    // Calculate and update predictive trajectory for selected boat
    if (primaryPathBoatIdRef.current === boat.boatId && speedKnots > 0) {
      const heading = headingByBoatRef.current.get(boat.boatId) ?? 0
      const speedKmh = speedKnots * 1.852 // Convert knots to km/h
      const timeHours = 5 / 60 // 5 minutes in hours
      const distanceKm = speedKmh * timeHours

      try {
        const currentPoint = turf.point([boat.lon, boat.lat])
        const projectedPoint = turf.destination(currentPoint, distanceKm, heading, {
          units: "kilometers",
        })
        const projectedCoords = projectedPoint.geometry.coordinates // [lng, lat]
        const trajectoryCoords: [number, number][] = [[boat.lat, boat.lon], [projectedCoords[1], projectedCoords[0]]]

        if (!trajectoryPolylineRef.current) {
          trajectoryPolylineRef.current = L.polyline(trajectoryCoords, {
            color: "#22d3ee",
            weight: 3,
            opacity: 0.8,
            dashArray: "5, 10",
          }).addTo(mapInstanceRef.current!)
        } else {
          trajectoryPolylineRef.current.setLatLngs(trajectoryCoords)
        }
      } catch (error) {
        console.warn("Failed to calculate predictive trajectory", { boatId: boat.boatId, error })
        if (trajectoryPolylineRef.current) {
          trajectoryPolylineRef.current.remove()
          trajectoryPolylineRef.current = null
        }
      }
    } else {
      // Remove trajectory if not selected or no speed
      if (trajectoryPolylineRef.current) {
        trajectoryPolylineRef.current.remove()
        trajectoryPolylineRef.current = null
      }
    }

    if (primaryPathBoatIdRef.current === boat.boatId) {
      pathRef.current.push([boat.lat, boat.lon])
      if (pathRef.current.length > 200) pathRef.current.shift()
      pathPolylineRef.current?.setLatLngs(pathRef.current)
    }

    lastPositionByBoatRef.current.set(boat.boatId, { lat: boat.lat, lng: boat.lon, time: currentTime })
  }

  const upsertBoat = (boat: BoatMarkerData, opts?: { shouldPan?: boolean; zoomOnSelect?: boolean; directSpeed?: number }) => {
    const map = mapInstanceRef.current
    if (!map) return

    const selectedId = selectedBoatIdRef.current
    const existing = markerByBoatRef.current.get(boat.boatId)

    const previous = lastPositionByBoatRef.current.get(boat.boatId)
    if (previous) {
      const heading = calculateBearing(previous.lat, previous.lng, boat.lat, boat.lon)
      if (Number.isFinite(heading)) headingByBoatRef.current.set(boat.boatId, heading)
    } else if (!headingByBoatRef.current.has(boat.boatId)) {
      headingByBoatRef.current.set(boat.boatId, 0)
    }

    const heading = headingByBoatRef.current.get(boat.boatId) ?? 0
    if (existing) {
      existing.setLatLng([boat.lat, boat.lon])
      existing.setZIndexOffset(1000)
      updateMarkerAppearance(existing, boat, selectedId === boat.boatId)
      existing.setTooltipContent(`<b>${boat.boatId}</b><br>Status: ${boat.zone}`)
      existing.setPopupContent(`<b>${boat.boatId}</b><br>Lat: ${boat.lat.toFixed(4)}<br>Lon: ${boat.lon.toFixed(4)}<br>Zone: ${boat.zone}`)
    } else {
      const marker = L.marker([boat.lat, boat.lon], {
        icon: vesselIcon(boat.zone, selectedId === boat.boatId, heading),
        zIndexOffset: 1000,
      }).addTo(map)

      marker.bindTooltip(`<b>${boat.boatId}</b><br>Status: ${boat.zone}`, {
        direction: "top",
        offset: [0, -18],
        className: "eez-tooltip",
      })
      marker.bindPopup(`<b>${boat.boatId}</b><br>Lat: ${boat.lat.toFixed(4)}<br>Lon: ${boat.lon.toFixed(4)}<br>Zone: ${boat.zone}`)
      marker.on("click", () => {
        selectedBoatIdRef.current = boat.boatId
        primaryPathBoatIdRef.current = boat.boatId
        pathRef.current = [[boat.lat, boat.lon]]
        pathPolylineRef.current?.setLatLngs(pathRef.current)
        refreshMarkerStyles()
        onBoatSelect?.(boat)
        updateSelectedBoatState(boat, Date.now())
        map.setView([boat.lat, boat.lon], Math.max(map.getZoom(), 10), { animate: true })
      })
      markerByBoatRef.current.set(boat.boatId, marker)
    }

    boatDataByIdRef.current.set(boat.boatId, boat)
    refreshMarkerStyles()

    if (!selectedBoatIdRef.current) {
      selectedBoatIdRef.current = boat.boatId
      primaryPathBoatIdRef.current = boat.boatId
      onBoatSelect?.(boat)
    }

    if (selectedBoatIdRef.current === boat.boatId) {
      updateSelectedBoatState(boat, Date.now(), opts?.directSpeed)
      if (opts?.shouldPan && followVesselRef.current) {
        map.panTo([boat.lat, boat.lon])
      }
      if (opts?.zoomOnSelect) {
        map.setView([boat.lat, boat.lon], Math.max(map.getZoom(), 10), { animate: true })
      }
    }

    emitBoats()
  }

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return

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

    // Add satellite/ocean tile layer
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

    const renderZoneBoundaries = (
      coastlineCoords: [number, number][],
      _coastlineGeoJson: unknown,
      imblGeoJson: unknown
    ) => {
      if (!map._container) {
        console.warn("Map container not ready, skipping boundary rendering")
        return
      }

      const safeAddLayer = (layerName: string, layer: any, details?: Record<string, unknown>): any | null => {
        if (!map || !map._container || typeof map._container.appendChild !== 'function') {
          console.warn("Map not ready for layer addition", { layer: layerName })
          return null
        }
        try {
          layer.addTo(map)
          return layer
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          console.warn("Skipping invalid map layer", {
            layer: layerName,
            ...details,
            error: message,
          })
          return null
        }
      }

      const geoJsonOptions = {
        coordsToLatLng: (coords: [number, number]) => L.latLng(coords[1], coords[0]),
      }

      initCoastlineSegments(coastlineCoords)
      let visibleLimitCount = 0

      const safeCoastline = coastlineCoords.filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng))
      const validCoastline = safeCoastline.length > 1 && safeCoastline.every((point) => Array.isArray(point) && point.length === 2)
      if (validCoastline) {
        try {
          const coastlineLayer = safeAddLayer("coastline", L.polyline(safeCoastline, {
            color: "#2563eb",
            weight: 3,
            opacity: 0.8,
            interactive: false,
          }), { points: safeCoastline.length })
          if (coastlineLayer) {
            coastlineLayer.bringToBack()
            visibleLimitCount += 1
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          console.warn("Invalid coastline geometry", { points: safeCoastline.length, error: message })
        }
      } else {
        console.warn("Skipping coastline layer due to invalid coordinate data", { points: safeCoastline.length })
      }

      const imblFeature = extractImblLineFeature(imblGeoJson)
      if (imblFeature) {
        imblSegments = extractImblSegments(imblGeoJson)
        const imblLines = getLineStringsFromFeature(imblFeature)
        if (imblLines.length > 0) {
          try {
            const imblLayer = safeAddLayer(
              "imbl-main",
              L.featureGroup(
                imblLines.map((line) =>
                  L.polyline(line, {
                    color: "#dc2626",
                    weight: 3,
                    dashArray: "10, 10",
                    interactive: false,
                  })
                )
              ),
              { segments: imblSegments.length }
            )
            if (imblLayer) visibleLimitCount += 1
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            console.warn("Invalid IMBL line geometry", { error: message })
          }
        }

        const offsetFeatures = buildImblOffsetFeatures(imblGeoJson)
        offsetFeatures.forEach((offset) => {
          const offsetLines = getLineStringsFromFeature(offset.feature)
          if (offsetLines.length === 0) {
            console.warn("Skipping invalid IMBL offset feature", { name: offset.name, distanceKm: offset.distanceKm })
            return
          }

          try {
            const offsetLayer = safeAddLayer(
              "imbl-offset",
              L.featureGroup(
                offsetLines.map((line) =>
                  L.polyline(line, {
                    color: offset.color,
                    weight: 2,
                    dashArray: "5, 5",
                    interactive: false,
                  })
                )
              ),
              {
                name: offset.name,
                distanceKm: offset.distanceKm,
              }
            )
            if (offsetLayer) visibleLimitCount += 1
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            console.warn("Invalid IMBL offset geometry", { name: offset.name, distanceKm: offset.distanceKm, error: message })
          }

          const mid = getMidpointLatLngFromFeature(offset.feature)
          if (!mid || !mid.every(Number.isFinite)) {
            console.warn("Skipping invalid IMBL offset label", { name: offset.name, distanceKm: offset.distanceKm, mid })
            return
          }

          try {
            L.marker(mid, {
              icon: L.divIcon({
                className: "eez-label",
                html: `<div style="background:${offset.color};color:#fff;padding:4px 9px;border-radius:7px;font-size:12px;white-space:nowrap;box-shadow:0 2px 10px rgba(0,0,0,0.45);font-weight:700;border:1px solid rgba(255,255,255,0.3);">${offset.name} (${offset.distanceKm} km)</div>`,
                iconSize: [180, 28],
                iconAnchor: [90, 14],
              }),
            }).addTo(map)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            console.warn("[browser] Invalid IMBL offset label", { name: offset.name, distanceKm: offset.distanceKm, error: message })
          }
        })
      }
      if (!imblGeoJson) {
        imblSegments = []
      }

      zoneBoundaryRefs.current.safe = null
      zoneBoundaryRefs.current.warning = null
      zoneBoundaryRefs.current.danger = null
      setBoundaryCount(visibleLimitCount)
    }

    Promise.all([
      fetch("/data/tn_coastline.json").then((response) => response.ok ? response.json() : null),
      fetch("/data/imbl_boundary.json").then((response) => response.ok ? response.json() : null),
    ])
      .then(([coastGeoJson, imblGeoJson]) => {
        const coastline = parseCoastlineFromGeoJson(coastGeoJson) || TN_COASTLINE_FALLBACK
        setTimeout(() => {
          renderZoneBoundaries(
            coastline,
            coastGeoJson ?? {
              type: "FeatureCollection",
              features: [],
            },
            imblGeoJson
          )
        }, 100)
      })
      .catch(() => {
        const fallbackGeoJson = {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {},
              geometry: {
                type: "LineString",
                coordinates: TN_COASTLINE_FALLBACK.map(([lat, lng]) => [lng, lat]),
              },
            },
          ],
        }
        setTimeout(() => {
          renderZoneBoundaries(TN_COASTLINE_FALLBACK, fallbackGeoJson, null)
        }, 100)
      })

    // Initial selected vessel fallback
    const initialBoat: BoatMarkerData = {
      boatId: selectedBoatIdRef.current || "BOAT1",
      lat: 9.8,
      lon: 79.1,
      zone: "SAFE",
    }
    upsertBoat(initialBoat, { shouldPan: false })

    // Path trail polyline
    const pathPolyline = L.polyline([], {
      color: "#38bdf8",
      weight: 3,
      opacity: 0.7,
      pane: "overlayPane",
      interactive: false,
    }).addTo(map)
    pathPolyline.bringToBack()
    pathPolylineRef.current = pathPolyline

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
      @import url('https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500;700&display=swap');
      @keyframes radarPulse {
        0% { transform: scale(0.8); opacity: 0.45; }
        70% { transform: scale(2.3); opacity: 0; }
        100% { opacity: 0; }
      }
      .leaflet-container {
        background: radial-gradient(circle at top, rgba(12, 34, 58, 0.96), rgba(3, 9, 19, 1));
        font-family: 'Roboto Mono', 'Courier New', monospace;
      }
      .leaflet-control-zoom a {
        background: rgba(4, 20, 41, 0.92) !important;
        color: #7dd3fc !important;
        border: 1px solid rgba(56, 189, 248, 0.24) !important;
        box-shadow: 0 0 18px rgba(56, 189, 248, 0.18) !important;
      }
      .leaflet-control-zoom a:hover {
        background: rgba(9, 34, 60, 0.98) !important;
      }
      .leaflet-control-attribution {
        background: rgba(6, 15, 28, 0.78) !important;
        color: #94a3b8 !important;
        font-size: 10px !important;
        border: 1px solid rgba(56, 189, 248, 0.16) !important;
        backdrop-filter: blur(12px);
      }
      .leaflet-control-attribution a {
        color: #67e8f9 !important;
      }
      .hud-panel {
        backdrop-filter: blur(18px);
        background: rgba(4, 12, 24, 0.72);
        border: 1px solid rgba(56, 189, 248, 0.18);
        box-shadow: 0 18px 60px rgba(0, 0, 0, 0.32);
        border-radius: 1rem;
        color: #e2e8f0;
      }
      .hud-panel.hud-status-panel {
        border-color: rgba(34, 211, 238, 0.28);
      }
      .hud-panel.hud-button {
        border-color: rgba(56, 189, 248, 0.25);
      }
      .hud-panel.hud-counter {
        border-color: rgba(59, 130, 246, 0.22);
      }
      .hud-panel .hud-label {
        color: #cbd5e1;
      }
      .hud-panel .hud-value,
      .leaflet-popup-content-wrapper,
      .eez-tooltip,
      .leaflet-control-attribution {
        font-family: 'Roboto Mono', 'Courier New', monospace !important;
      }
      .leaflet-popup-content-wrapper {
        background: rgba(6, 15, 30, 0.88) !important;
        border: 1px solid rgba(56, 189, 248, 0.16) !important;
        color: #f8fafc !important;
        border-radius: 1rem !important;
        box-shadow: 0 20px 70px rgba(0, 0, 0, 0.5) !important;
        backdrop-filter: blur(18px) !important;
      }
      .leaflet-popup-tip {
        background: rgba(6, 15, 30, 0.88) !important;
      }
      .leaflet-popup-close-button {
        color: #7dd3fc !important;
      }
      .eez-tooltip {
        background: rgba(4, 12, 24, 0.96) !important;
        color: #e2e8f0 !important;
        border: 1px solid rgba(34, 211, 238, 0.25) !important;
        border-radius: 0.75rem !important;
        padding: 8px 11px !important;
        font-size: 12px !important;
        box-shadow: 0 8px 30px rgba(0,0,0,0.35) !important;
      }
      .boat-marker-wrapper {
        position: relative;
        width: 48px;
        height: 48px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .boat-marker-wrapper.selected .boat-marker-icon {
        filter: drop-shadow(0 0 16px rgba(56, 189, 248, 0.85));
      }
      .boat-marker-radar {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
      }
      .boat-radar-ring {
        position: absolute;
        width: 42px;
        height: 42px;
        border: 2px solid var(--ring-color);
        border-radius: 9999px;
        opacity: 0.55;
        animation: radarPulse 1.8s ease-out infinite;
      }
      .boat-radar-ring--delay {
        animation-delay: 0.6s;
      }
      .boat-marker-icon {
        width: 44px;
        height: 44px;
        display: block;
        transform-origin: center center;
        position: relative;
        z-index: 1;
      }
      .vessel-marker {
        width: 46px !important;
        height: 46px !important;
        display: flex !important;
        align-items: center;
        justify-content: center;
      }
      .vessel-radar {
        position: relative;
        width: 26px;
        height: 26px;
      }
      .vessel-radar .radar-ring {
        position: absolute;
        inset: 0;
        border-radius: 50%;
        box-shadow: 0 0 12px rgba(96, 165, 250, 0.45);
        animation: radarPulse 1.8s ease-out infinite;
      }
      .vessel-radar .radar-ring--delay {
        animation-delay: 0.6s;
      }
      .vessel-radar .vessel-core {
        position: absolute;
        inset: 7px;
        border-radius: 50%;
        z-index: 2;
        width: 12px;
        height: 12px;
      }
      .vessel-marker.selected .vessel-core {
        box-shadow: 0 0 24px rgba(255, 255, 255, 0.45), inset 0 0 16px rgba(255, 255, 255, 0.75);
      }
      .hud-status-pill {
        min-width: 5px;
        min-height: 5px;
        border-radius: 9999px;
      }
      .status-safe { background: #5effa8 !important; box-shadow: 0 0 14px #5effa8; }
      .status-warning { background: #fff55b !important; box-shadow: 0 0 18px #fff55b; }
      .status-danger { background: #ff4a4a !important; box-shadow: 0 0 18px #ff4a4a; }
      .status-unknown { background: #38bdf8 !important; box-shadow: 0 0 14px #38bdf8; }
    `
    document.head.appendChild(style)
    styleElRef.current = style

    return () => {
      window.clearTimeout(invalidateTimeoutShort)
      window.clearTimeout(invalidateTimeoutLong)
      ro.disconnect()
      map.off("dragstart", handleDragStart)
      if (trajectoryPolylineRef.current) {
        trajectoryPolylineRef.current.remove()
        trajectoryPolylineRef.current = null
      }
      if (styleElRef.current) {
        styleElRef.current.remove()
        styleElRef.current = null
      }
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }
    }
  }, [onLocationUpdate, onProximityUpdate, onSpeedUpdate, onEEZUpdate, onZoneUpdate, onBoatSelect, onBoatsUpdate])

  useEffect(() => {
    if (!selectedBoatId || !mapInstanceRef.current) return
    // Remove old trajectory when switching boats
    if (trajectoryPolylineRef.current) {
      trajectoryPolylineRef.current.remove()
      trajectoryPolylineRef.current = null
    }
    selectedBoatIdRef.current = selectedBoatId
    primaryPathBoatIdRef.current = selectedBoatId
    const boat = boatDataByIdRef.current.get(selectedBoatId)
    if (!boat) return
    pathRef.current = [[boat.lat, boat.lon]]
    pathPolylineRef.current?.setLatLngs(pathRef.current)
    updateSelectedBoatState(boat, Date.now())
    refreshMarkerStyles()
    mapInstanceRef.current.setView([boat.lat, boat.lon], Math.max(mapInstanceRef.current.getZoom(), 10), { animate: true })
  }, [selectedBoatId])

  // Socket.io real-time connection + initial REST fetch
  useEffect(() => {
    if (!mapInstanceRef.current) return

    const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000"

    // Initial REST fetch — load latest snapshot for all boats
    fetch(`${BACKEND_URL}/api/location/latest`)
      .then(r => r.ok ? r.json() : [])
      .then((rows: Array<{ boatId?: string; lat?: number; lon?: number; zone?: string; distance?: number; timestamp?: string }>) => {
        const normalizedRows = Array.isArray(rows) ? rows : []
        if (normalizedRows.length === 0) return fetch(`${BACKEND_URL}/api/location`).then(r => r.ok ? r.json() : null).then((single) => single ? [single] : [])
        return normalizedRows
      })
      .then((rows: Array<{ boatId?: string; lat?: number; lon?: number; zone?: string; distance?: number; timestamp?: string }>) => {
        if (!Array.isArray(rows) || rows.length === 0) return
        for (const row of rows) {
          if (row.lat === undefined || row.lon === undefined) continue
          const boat: BoatMarkerData = {
            boatId: row.boatId || "BOAT1",
            lat: Number(row.lat),
            lon: Number(row.lon),
            zone: normalizeZone(row.zone),
            distance: row.distance,
            timestamp: row.timestamp,
          }
          upsertBoat(boat, { shouldPan: false })
        }
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

    socket.on("locationUpdate", (data: { boatId?: string; lat: number; lon: number; speed?: number; zone?: string; distance?: number; timestamp?: string }) => {
      if (demoMode) return
      const lat = Number(data.lat)
      const lng = Number(data.lon)
      const boat: BoatMarkerData = {
        boatId: data.boatId || "BOAT1",
        lat,
        lon: lng,
        zone: normalizeZone(data.zone),
        distance: data.distance,
        timestamp: data.timestamp,
      }
      upsertBoat(boat, {
        shouldPan: true,
        directSpeed: typeof data.speed === "number" ? Number(data.speed) : undefined,
      })
    })

    socketRef.current = socket

    return () => {
      socket.disconnect()
    }
  }, [demoMode, onLocationUpdate, onProximityUpdate, onSpeedUpdate, onStatusUpdate, onEEZUpdate, onZoneUpdate, onBoatSelect, onBoatsUpdate])

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
      const demoBoatId = "DEMO-BOAT1"
      selectedBoatIdRef.current = demoBoatId
      primaryPathBoatIdRef.current = demoBoatId
      const demoZone = getZoneFromDistance(calculateDistanceToImblBoundary(lat, lng))
      upsertBoat({ boatId: demoBoatId, lat, lon: lng, zone: geofenceZoneToBoatZone(demoZone) }, { shouldPan: true })
      demoIndexRef.current = (demoIndexRef.current + 1) % DEMO_ROUTE.length
    }, 250)

    return () => {
      if (demoIntervalRef.current) {
        clearInterval(demoIntervalRef.current)
        demoIntervalRef.current = null
      }
    }
  }, [demoMode, onLocationUpdate, onProximityUpdate, onSpeedUpdate, onStatusUpdate, onEEZUpdate, onZoneUpdate, onBoatSelect, onBoatsUpdate])

  return (
    <div className="relative w-full h-full" style={{ minHeight: '520px' }}>
      <div ref={mapRef} className="w-full h-full" style={{ minHeight: '520px', borderRadius: '1rem' }} />

      <div className="absolute top-4 left-4 z-[1000]">
        <div className="hud-panel hud-status-panel flex items-center gap-3 px-4 py-3 rounded-2xl text-base font-medium">
          <div className={`hud-status-pill ${isTracking ? 'status-safe animate-pulse' : 'status-warning'}`} />
          <span className="text-sm text-slate-100">{isTracking ? 'LIVE' : 'OFFLINE'}</span>
        </div>
      </div>

      <div className="absolute top-4 right-4 z-[1000]">
        <div className="flex items-center gap-3">
          {!followVessel && (
            <button
              onClick={() => {
                followVesselRef.current = true
                setFollowVessel(true)
                if (mapInstanceRef.current && selectedBoatIdRef.current) {
                  const selectedMarker = markerByBoatRef.current.get(selectedBoatIdRef.current)
                  if (selectedMarker) mapInstanceRef.current.panTo(selectedMarker.getLatLng())
                }
              }}
              className="hud-panel hud-button flex items-center gap-2 px-4 py-3 rounded-2xl text-sm font-semibold text-white transition-all"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Re-center
            </button>
          )}
          {followVessel && (
            <div className="hud-panel hud-status-panel flex items-center gap-2 px-4 py-3 rounded-2xl text-sm font-medium">
              <span className="hud-status-pill status-safe animate-pulse" />
              <span className="text-emerald-200">Following</span>
            </div>
          )}
          <div className="hud-panel hud-counter px-4 py-3 rounded-2xl text-sm text-cyan-200 font-medium">
            <span className="hud-label">Limit Count</span>
            <div className="hud-value">{boundaryCount} zones</div>
          </div>
        </div>
      </div>
    </div>
  )
}