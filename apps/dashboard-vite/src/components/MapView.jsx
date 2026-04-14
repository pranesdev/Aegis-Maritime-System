import { MapContainer, TileLayer, Polyline, Marker, GeoJSON, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect } from 'react';
import { useMemo } from 'react';
import tnCoastline from '../../../backend-api/src/tn_coastline.json';
import imblBoundary from '../../../backend-api/src/imbl_boundary.json';

// Custom vessel marker icon with radar pulse SVG
function createVesselIcon(zone) {
  const colorMap = {
    'Danger': '#EF4444',
    'Warning': '#F59E0B',
    'Alert': '#10B981',
    'Clear': '#06b6d4',
  };
  const color = colorMap[zone] || '#06b6d4';
  
  return L.divIcon({
    className: 'custom-vessel-marker',
    html: `
      <div style="position:relative;width:48px;height:48px;">
        <svg 
          width="48" 
          height="48" 
          viewBox="0 0 48 48" 
          style="position:absolute;left:0;top:0;display:block;filter:drop-shadow(0 4px 8px rgba(0,0,0,0.6));"
        >
          <defs>
            <linearGradient id="vesselGrad${zone}" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="${color}"/>
              <stop offset="100%" stop-color="${color}" stop-opacity="0.6"/>
            </linearGradient>
            <style>
              @keyframes radarPulse {
                0% { r: 0; opacity: 0.8; }
                100% { r: 32; opacity: 0; }
              }
            </style>
          </defs>
          
          <!-- Radar pulse circles -->
          <circle cx="24" cy="24" r="0" stroke="${color}" stroke-width="2" fill="none" 
            style="animation: radarPulse 1.8s ease-out infinite;" />
          <circle cx="24" cy="24" r="0" stroke="${color}" stroke-width="1.5" fill="none" 
            style="animation: radarPulse 1.8s ease-out infinite 0.6s;" opacity="0.6" />
          
          <!-- Vessel pin -->
          <path fill="url(#vesselGrad${zone})" d="M24 4C16.27 4 10 10.27 10 18c0 9.66 14 22 14 22s14-12.34 14-22c0-7.73-6.27-14-14-14zm0 18c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z"/>
          
          <!-- Center glow -->
          <circle cx="24" cy="24" r="4" fill="${color}" opacity="0.9"/>
          <circle cx="24" cy="24" r="2" fill="white" opacity="0.9"/>
        </svg>
      </div>
    `,
    iconSize: [48, 48],
    iconAnchor: [24, 24],
    popupAnchor: [0, -24],
  });
}

// Helper component to smoothly pan map to vessel
function MapController({ center, followVessel }) {
  const map = useMap();
  useEffect(() => {
    if (followVessel) map.panTo(center);
  }, [center, followVessel, map]);
  return null;
}

// Detect user drag to disable auto-follow
function DragDetector({ onDrag }) {
  useMapEvents({ dragstart: onDrag });
  return null;
}

export default function MapView({
  boatPosition,
  boatPath,
  followVessel = true,
  onManualPan,
  zone = 'Clear',
}) {
  const vesselIcon = useMemo(() => createVesselIcon(zone), [zone]);
  const coastlineStyle = useMemo(() => ({ 
    color: '#3b82f6', 
    weight: 2.5, 
    opacity: 0.7 
  }), []);
  const imblBoundaryStyle = useMemo(() => ({ 
    color: '#EF4444', 
    weight: 2, 
    dashArray: '8, 6',
    opacity: 0.8,
  }), []);

  return (
    <MapContainer 
      center={boatPosition} 
      zoom={10} 
      style={{ flex: 1, height: '100vh', width: '100%', zIndex: 0 }} 
    >
      {/* Dark CartoDB tile layer */}
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; CartoDB'
        maxZoom={19}
      />
      
      {/* Coastline & IMBL boundaries */}
      <GeoJSON data={tnCoastline} style={coastlineStyle} interactive={false} />
      <GeoJSON data={imblBoundary} style={imblBoundaryStyle} interactive={false} />
      
      {/* Path trail with glassmorphic style */}
      {boatPath.length > 1 && (
        <Polyline
          positions={boatPath}
          pathOptions={{ 
            color: '#06b6d4', 
            weight: 2, 
            opacity: 0.6,
            pane: 'overlayPane', 
            interactive: false,
            dashArray: '4, 4',
          }}
        />
      )}
      
      {/* Vessel marker with radar pulse */}
      <Marker position={boatPosition} icon={vesselIcon} />
      
      <MapController center={boatPosition} followVessel={followVessel} />
      <DragDetector onDrag={onManualPan} />
    </MapContainer>
  );
}