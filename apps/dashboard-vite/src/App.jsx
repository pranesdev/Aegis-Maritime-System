import { useState, useEffect, useRef } from "react";
import MapView from "./components/MapView";
import "./App.css";

const BOUNDARY_POINTS = [
  [9.50, 80.30], [9.70, 80.20], [9.95, 80.10], [10.15, 79.95], [10.35, 79.80],
];

const GEOFENCE_CENTER = [9.35, 79.49];
const GEOFENCE_THRESHOLDS = {
  SAFE_KM: 12,
  WARNING_KM: 25,
};

const ZONE_MESSAGES = {
  SAFE: "You are in safe waters",
  WARNING: "Approaching restricted maritime boundary",
  DANGER: "You have crossed the maritime boundary! Immediate action required",
};

const MAX_PATH = 80;

function formatAge(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getGeofenceStatus(lat, lon) {
  const distanceKm = haversineDistanceKm(lat, lon, GEOFENCE_CENTER[0], GEOFENCE_CENTER[1]);
  const zone =
    distanceKm < GEOFENCE_THRESHOLDS.SAFE_KM ? "SAFE" :
    distanceKm < GEOFENCE_THRESHOLDS.WARNING_KM ? "WARNING" :
    "DANGER";
  return { zone, distanceKm };
}

export default function App() {
  const [boatPosition, setBoatPosition] = useState([9.30, 79.80]);
  const [boatPath, setBoatPath]         = useState([[9.30, 79.80]]);
  const [zone, setZone]                 = useState("UNKNOWN");
  const [distance, setDistance]         = useState(null);
  const [speed, setSpeed]               = useState(null);
  const [status, setStatus]             = useState("connecting");
  const [lastUpdateMs, setLastUpdateMs] = useState(null);
  const [followVessel, setFollowVessel] = useState(true);
  const [zoneToasts, setZoneToasts]     = useState([]);
  const [dangerModalOpen, setDangerModalOpen] = useState(false);
  const [, setTick]                     = useState(0);
  const prevPosRef                      = useRef(null);
  const prevTimeRef                     = useRef(null);
  const prevZoneRef                     = useRef("UNKNOWN");

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const previousZone = prevZoneRef.current;
    if (zone === previousZone) return;
    if (zone === "UNKNOWN") {
      prevZoneRef.current = zone;
      return;
    }

    const toast = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      zone,
      message: ZONE_MESSAGES[zone],
    };

    setZoneToasts((prev) => [...prev, toast].slice(-4));
    const timeoutId = window.setTimeout(() => {
      setZoneToasts((prev) => prev.filter((item) => item.id !== toast.id));
    }, 5000);

    if (zone === "DANGER") setDangerModalOpen(true);
    prevZoneRef.current = zone;

    return () => window.clearTimeout(timeoutId);
  }, [zone]);

  useEffect(() => {
    const fetchTelemetry = async () => {
      try {
        const res = await fetch("http://localhost:3000/api/location");
        if (!res.ok) throw new Error("API error " + res.status);
        const data = await res.json();

        if (data?.lat !== undefined && data?.lon !== undefined) {
          const lat = Number(data.lat);
          const lon = Number(data.lon);
          const now = Date.now();

          // Compute speed from position delta
          if (prevPosRef.current && prevTimeRef.current) {
            const dt = (now - prevTimeRef.current) / 3_600_000; // hours
            if (dt > 0) {
              const [pLat, pLon] = prevPosRef.current;
              const R = 6371;
              const dLat = ((lat - pLat) * Math.PI) / 180;
              const dLon = ((lon - pLon) * Math.PI) / 180;
              const a = Math.sin(dLat / 2) ** 2 +
                Math.cos((pLat * Math.PI) / 180) * Math.cos((lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
              const distKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
              const kn = (distKm / dt) * 0.539957;
              if (kn < 50) setSpeed(kn);
            }
          }
          prevPosRef.current  = [lat, lon];
          prevTimeRef.current = now;

          setBoatPosition([lat, lon]);
          setBoatPath(prev => {
            const next = [...prev, [lat, lon]];
            return next.length > MAX_PATH ? next.slice(next.length - MAX_PATH) : next;
          });
          const geofence = getGeofenceStatus(lat, lon);
          setDistance(geofence.distanceKm);
          setZone(geofence.zone);
          setLastUpdateMs(now);
          setStatus("live");
        } else {
          setStatus("error");
        }
      } catch {
        setStatus("offline");
      }
    };

    fetchTelemetry();
    const t = setInterval(fetchTelemetry, 1500);
    return () => clearInterval(t);
  }, []);

  const zoneCls =
    zone === "DANGER"  ? "zone-danger"  :
    zone === "WARNING" ? "zone-warning" :
    zone === "SAFE"    ? "zone-safe"    : "zone-unknown";

  const statusLabel =
    status === "live"    ? "Live"        :
    status === "offline" ? "Offline"     :
    status === "error"   ? "Data Error"  : "Connecting...";

  const staleMs = lastUpdateMs ? Date.now() - lastUpdateMs : null;
  const isStale = staleMs !== null && staleMs > 10_000;

  return (
    <div className="dashboard-root">
      <div className="zone-toast-stack" aria-live="polite">
        {zoneToasts.map((toast) => (
          <div key={toast.id} className={`zone-toast zone-toast-${toast.zone.toLowerCase()}`} role="status">
            <p className="zone-toast-title">{toast.zone}</p>
            <p className="zone-toast-message">{toast.message}</p>
          </div>
        ))}
      </div>

      {dangerModalOpen && zone === "DANGER" && (
        <div className="zone-modal-backdrop" role="presentation">
          <div className="zone-modal" role="alertdialog" aria-modal="true" aria-label="Danger zone alert">
            <p className="zone-modal-kicker">Danger Alert</p>
            <h2 className="zone-modal-title">Maritime Boundary Breach</h2>
            <p className="zone-modal-text">{ZONE_MESSAGES.DANGER}</p>
            <p className="zone-modal-sub">Immediate course correction is required to return to safe waters.</p>
            <div className="zone-modal-actions">
              <button className="zone-modal-btn" onClick={() => setDangerModalOpen(false)}>Acknowledge</button>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${zoneCls}-border`}>
        {/* Brand */}
        <div className="sidebar-brand">
          <div className="brand-icon">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </div>
          <div>
            <h1 className="brand-title">AEGIS</h1>
            <p className="brand-sub">Maritime Boundary Detection</p>
          </div>
        </div>

        {/* Zone badge */}
        <div className={`zone-badge ${zoneCls}`}>
          <span className={`zone-dot ${zoneCls}-dot`} />
          <span className="zone-label">{zone}</span>
          {zone === "DANGER"  && <span className="zone-tag">Restricted Waters</span>}
          {zone === "WARNING" && <span className="zone-tag">Boundary Near</span>}
          {zone === "SAFE"    && <span className="zone-tag">Safe Zone</span>}
        </div>

        {/* Connection status */}
        <div className={`status-row ${isStale ? "status-stale" : ""}`}>
          <span className={`status-dot status-${status}`} />
          <span className="status-label">{statusLabel}</span>
          {lastUpdateMs && (
            <span className="status-age">{formatAge(Date.now() - lastUpdateMs)}</span>
          )}
        </div>

        {/* Metric cards */}
        <div className="metrics">
          <MetricCard
            icon={<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>}
            label="Location"
            value={status === "live" ? `${boatPosition[0].toFixed(4)}\u00b0 N` : "--"}
            sub={status === "live" ? `${boatPosition[1].toFixed(4)}\u00b0 E` : "No fix"}
            accent="cyan"
          />
          <MetricCard
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><path strokeLinecap="round" d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>}
            label="Distance to Border"
            value={distance !== null ? `${distance.toFixed(2)} km` : "--"}
            sub={zone !== "UNKNOWN" ? zone : "Calculating"}
            accent={zone === "DANGER" ? "red" : zone === "WARNING" ? "amber" : "green"}
            alert={zone === "DANGER" || zone === "WARNING"}
          />
          <MetricCard
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>}
            label="Speed"
            value={speed !== null ? `${speed.toFixed(1)} kn` : "--"}
            sub="Calculated"
            accent="cyan"
          />
          <MetricCard
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 13l4.553 2.276A1 1 0 0021 21.382V10.618a1 1 0 00-.553-.894L15 7m0 13V7m0 0L9 4"/></svg>}
            label="Path Points"
            value={`${boatPath.length} pts`}
            sub={`max ${MAX_PATH}`}
            accent="cyan"
          />
        </div>

        {/* Follow vessel toggle */}
        <button
          className={`follow-btn ${followVessel ? "follow-btn-active" : ""}`}
          onClick={() => setFollowVessel(v => !v)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
          </svg>
          {followVessel ? "Following Vessel" : "Follow Vessel"}
        </button>

        <p className="sidebar-footer">&copy; 2026 Maritime Safety Authority</p>
      </aside>

      {/* Map */}
      <main className="map-area">
        <MapView
          boatPosition={boatPosition}
          boundaryPoints={BOUNDARY_POINTS}
          boatPath={boatPath}
          followVessel={followVessel}
          onManualPan={() => setFollowVessel(false)}
          zone={zone}
          geofenceCenter={GEOFENCE_CENTER}
          geofenceRings={GEOFENCE_THRESHOLDS}
        />
      </main>
    </div>
  );
}

function MetricCard({ icon, label, value, sub, accent, alert }) {
  return (
    <div className={`metric-card metric-${accent} ${alert ? "metric-alert" : ""}`}>
      <div className={`metric-icon metric-icon-${accent}`}>{icon}</div>
      <div className="metric-body">
        <p className="metric-label">{label}</p>
        <p className="metric-value">{value}</p>
        {sub && <p className="metric-sub">{sub}</p>}
      </div>
    </div>
  );
}
