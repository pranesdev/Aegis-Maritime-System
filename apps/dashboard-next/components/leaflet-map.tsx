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

function extractImblLineFeature(data: unknown): turf.Feature<turf.LineString | turf.MultiLineString> | null {
  if (!data || typeof data !== "object") return null

  const maybeFeature = data as { type?: string; geometry?: { type?: string } }
  if (
    maybeFeature.type === "Feature" &&
    (maybeFeature.geometry?.type === "LineString" || maybeFeature.geometry?.type === "MultiLineString")
  ) {
    return maybeFeature as turf.Feature<turf.LineString | turf.MultiLineString>
  }

  const featureCollection = data as { type?: string; features?: Array<{ geometry?: { type?: string } }> }
  if (featureCollection.type !== "FeatureCollection" || !Array.isArray(featureCollection.features)) return null

  const lineFeature = featureCollection.features.find(
    (feature) => feature?.geometry?.type === "LineString" || feature?.geometry?.type === "MultiLineString"
  )

  return (lineFeature as turf.Feature<turf.LineString | turf.MultiLineString>) ?? null
}

function buildImblOffsetFeatures(data: unknown) {
  const sourceLine = extractImblLineFeature(data)
  if (!sourceLine) return [] as Array<{ name: string; color: string; distanceKm: number; feature: turf.Feature<turf.LineString | turf.MultiLineString> }>

  return IMBL_OFFSET_CONFIG.map((config) => ({
    name: config.name,
    color: config.color,
    distanceKm: config.distanceKm,
    feature: turf.lineOffset(sourceLine, IMBL_OFFSET_DIRECTION * config.distanceKm, {
      units: "kilometers",
    }) as turf.Feature<turf.LineString | turf.MultiLineString>,
  }))
}

function getMidpointLatLngFromFeature(feature: turf.Feature<turf.LineString | turf.MultiLineString>): [number, number] | null {
  const geometry = feature.geometry
  if (geometry.type === "LineString") {
    const coords = geometry.coordinates
    if (!Array.isArray(coords) || coords.length === 0) return null
    const mid = coords[Math.floor(coords.length / 2)]
    if (!Array.isArray(mid) || mid.length < 2) return null
    return [Number(mid[1]), Number(mid[0])]
  }

  if (geometry.type === "MultiLineString") {
    const line = geometry.coordinates.find((segment) => Array.isArray(segment) && segment.length > 0)
    if (!line) return null
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
  const mapInstanceRef = useRef<L.Map | null>(null)
  const markerByBoatRef = useRef<Map<string, L.Marker>>(new Map())
  const boatDataByIdRef = useRef<Map<string, BoatMarkerData>>(new Map())
  const pathPolylineRef = useRef<L.Polyline | null>(null)
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
  const zoneBoundaryRefs = useRef<{ safe: L.Polyline | null; warning: L.Polyline | null; danger: L.Polyline | null }>({
    safe: null,
    warning: null,
    danger: null,
  })

  const normalizeZone = (zone: unknown): ZoneWithUnknown => {
    if (zone === "SAFE" || zone === "WARNING" || zone === "DANGER") return zone
    return "UNKNOWN"
  }

  const vesselIcon = (zone: ZoneWithUnknown, selected: boolean, _headingDeg: number) => {
    const color = zone === "DANGER" ? "#ef4444" : zone === "WARNING" ? "#f59e0b" : zone === "SAFE" ? "#22c55e" : "#06b6d4"
    return L.divIcon({
      className: "vessel-marker",
      html: `
        <div style="width:18px;height:18px;border-radius:999px;background:${color};border:2px solid ${selected ? "#fde047" : "#ffffff"};box-shadow:${selected ? "0 0 0 2px rgba(253,224,71,0.35)" : "0 0 0 1px rgba(15,23,42,0.55)"};"></div>
      `,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
      tooltipAnchor: [0, -12],
      popupAnchor: [0, -10],
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

  const emitBoats = () => {
    const boats = Array.from(boatDataByIdRef.current.values()).sort((a, b) => a.boatId.localeCompare(b.boatId))
    onBoatsUpdate?.(boats)
  }

  const refreshMarkerStyles = () => {
    const selected = selectedBoatIdRef.current
    for (const [id, marker] of markerByBoatRef.current.entries()) {
      const boat = boatDataByIdRef.current.get(id)
      if (!boat) continue
      const heading = headingByBoatRef.current.get(id) ?? 0
      marker.setIcon(vesselIcon(boat.zone, selected === id, heading))
      marker.setTooltipContent(`<b>${boat.boatId}</b><br>Status: ${boat.zone}`)
    }
  }

  const updateSelectedBoatState = (boat: BoatMarkerData, currentTime: number, directSpeed?: number) => {
    onLocationUpdate(boat.lat, boat.lon)
    processGeofenceState(boat.lat, boat.lon)

    const prev = lastPositionByBoatRef.current.get(boat.boatId)
    if (typeof directSpeed === "number" && Number.isFinite(directSpeed) && directSpeed >= 0) {
      onSpeedUpdate(Math.min(directSpeed, 120))
    } else if (prev) {
      const timeDiff = (currentTime - prev.time) / 1000 / 3600
      if (timeDiff > 0) {
        const distKm = haversineDistance(boat.lat, boat.lon, prev.lat, prev.lng)
        const speedKnots = (distKm / timeDiff) * 0.539957
        if (Number.isFinite(speedKnots) && speedKnots >= 0) onSpeedUpdate(Math.min(speedKnots, 120))
      }
    } else {
      onSpeedUpdate(0)
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
      existing.setIcon(vesselIcon(boat.zone, selectedId === boat.boatId, heading))
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

    const renderZoneBoundaries = (
      coastlineCoords: [number, number][],
      _coastlineGeoJson: unknown,
      imblGeoJson: unknown
    ) => {
      const safeAddLayer = <T extends L.Layer>(layerName: string, layer: T, details?: Record<string, unknown>): T | null => {
        try {
          layer.addTo(map)
          return layer
        } catch (error) {
          console.warn("Skipping invalid map layer", {
            layer: layerName,
            ...details,
            error,
          })
          return null
        }
      }

      initCoastlineSegments(coastlineCoords)
      let visibleLimitCount = 0

      const safeCoastline = coastlineCoords.filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng))
      if (safeCoastline.length > 1) {
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
      }

      if (imblGeoJson) {
        imblSegments = extractImblSegments(imblGeoJson)
        const imblLayer = safeAddLayer("imbl-main", L.geoJSON(imblGeoJson as any, {
          style: {
            color: "#dc2626",
            weight: 3,
            dashArray: "10, 10",
          },
          interactive: false,
        }), { segments: imblSegments.length })
        if (imblLayer) visibleLimitCount += 1

        const offsetFeatures = buildImblOffsetFeatures(imblGeoJson)
        offsetFeatures.forEach((offset) => {
          const offsetLayer = safeAddLayer("imbl-offset", L.geoJSON(offset.feature as any, {
            style: {
              color: offset.color,
              weight: 2,
              dashArray: "5, 5",
            },
            interactive: false,
          }), {
            name: offset.name,
            distanceKm: offset.distanceKm,
          })
          if (offsetLayer) visibleLimitCount += 1

          const mid = getMidpointLatLngFromFeature(offset.feature)
          if (!mid) return

          L.marker(mid, {
            icon: L.divIcon({
              className: "eez-label",
              html: `<div style="background:${offset.color};color:#fff;padding:4px 9px;border-radius:7px;font-size:12px;white-space:nowrap;box-shadow:0 2px 10px rgba(0,0,0,0.45);font-weight:700;border:1px solid rgba(255,255,255,0.3);">${offset.name} (${offset.distanceKm} km)</div>`,
              iconSize: [180, 28],
              iconAnchor: [90, 14],
            }),
          }).addTo(map)
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
        renderZoneBoundaries(
          coastline,
          coastGeoJson ?? {
            type: "FeatureCollection",
            features: [],
          },
          imblGeoJson
        )
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
        renderZoneBoundaries(TN_COASTLINE_FALLBACK, fallbackGeoJson, null)
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
  }, [onLocationUpdate, onProximityUpdate, onSpeedUpdate, onEEZUpdate, onZoneUpdate, onBoatSelect, onBoatsUpdate])

  useEffect(() => {
    if (!selectedBoatId || !mapInstanceRef.current) return
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
                if (mapInstanceRef.current && selectedBoatIdRef.current) {
                  const selectedMarker = markerByBoatRef.current.get(selectedBoatIdRef.current)
                  if (selectedMarker) mapInstanceRef.current.panTo(selectedMarker.getLatLng())
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


