// src/components/MapView.jsx
import { MapContainer, TileLayer, Polyline, Marker, GeoJSON, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect } from 'react';
import { useMemo } from 'react';
import tnCoastline from '../../../backend-api/src/tn_coastline.json';
import imblBoundary from '../../../backend-api/src/imbl_boundary.json';

// Fix for default Leaflet icons in React
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
// Custom vessel marker icon (gradient pin with pulse ring)
function createVesselIcon(zone) {
  const color = zone === 'Danger' ? '#ef4444' : zone === 'Warning' ? '#f59e0b' : zone === 'Alert' ? '#22c55e' : '#06b6d4';
  return L.divIcon({
    className: '',
    html: `
      <div style="position:relative;width:40px;height:40px;">
        <div style="position:absolute;inset:-4px;border-radius:50%;background:${color};opacity:0.2;animation:aegisPing 1.5s infinite;"></div>
        <svg width="40" height="40" viewBox="0 0 24 24" style="position:absolute;left:0;top:0;display:block;filter:drop-shadow(0 3px 6px rgba(0,0,0,0.5))">
          <defs>
            <linearGradient id="vg${zone}" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="${color}"/>
              <stop offset="100%" stop-color="${color}88"/>
            </linearGradient>
          </defs>
          <path fill="url(#vg${zone})" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
        </svg>
      </div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

// Helper component to smoothly pan the map to the boat's location
// Pan only when followVessel is enabled
function MapController({ center, followVessel }) {
  const map = useMap();
  useEffect(() => {
    if (followVessel) map.panTo(center);
  }, [center, followVessel, map]);
  return null;
}

// Detect user drag to disable following
function DragDetector({ onDrag }) {
  useMapEvents({ dragstart: onDrag });
  return null;
}

export default function MapView({
  boatPosition,
  boatPath,
  followVessel = true,
  onManualPan,
  zone = 'SAFE',
}) {
  const vesselIcon = useMemo(() => createVesselIcon(zone), [zone]);
  const coastlineStyle = useMemo(() => ({ color: '#2563eb', weight: 3, opacity: 0.8 }), []);
  const imblBoundaryStyle = useMemo(() => ({ color: '#dc2626', weight: 3, dashArray: '10, 10' }), []);

  return (
    <MapContainer 
      center={boatPosition} 
      zoom={10} 
      style={{ flex: 1, height: '100vh', width: '100%', zIndex: 0 }} 
    >
      {/* Dark/ocean tile layer */}
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        attribution='Tiles &copy; Esri | ESRI'
        maxZoom={18}
      />
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png"
        attribution=""
        maxZoom={18}
      />
      <GeoJSON data={tnCoastline} style={coastlineStyle} interactive={false} />
      <GeoJSON data={imblBoundary} style={imblBoundaryStyle} interactive={false} />
      {/* Path trail */}
      {boatPath.length > 1 && (
        <Polyline
          positions={boatPath}
          pathOptions={{ color: '#38bdf8', weight: 2.5, opacity: 0.7, pane: 'overlayPane', interactive: false }}
        />
      )}
      <Marker position={boatPosition} icon={vesselIcon} />
      <MapController center={boatPosition} followVessel={followVessel} />
      <DragDetector onDrag={onManualPan} />
      <style>{`
        @keyframes aegisPing {
          0%  { transform: scale(1);   opacity: 0.25; }
          70% { transform: scale(2.2); opacity: 0;    }
          100%{ transform: scale(2.2); opacity: 0;    }
        }
      `}</style>
    </MapContainer>
  );
} 