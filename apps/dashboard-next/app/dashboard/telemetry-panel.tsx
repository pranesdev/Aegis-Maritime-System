"use client"

import React from 'react'

interface TelemetryProps {
  boatId: string;
  lat: number;
  lon: number;
  speed: number;
  distanceToBoundary: number;
  zone: string;
}

export function TelemetryPanel({ boatId, lat, lon, speed, distanceToBoundary, zone }: TelemetryProps) {
  
  // Coast Guard Intercept Calculation
  // Assuming a standard Coast Guard interceptor boat travels at 40 knots (approx 74 km/h)
  const interceptorSpeedKmh = 74; 
  let interceptTimeMins = 0;
  
  // If the boat is in danger, calculate how long it takes to reach them based on their distance
  if (distanceToBoundary < 20) {
     const hoursToIntercept = distanceToBoundary / interceptorSpeedKmh;
     interceptTimeMins = Math.round(hoursToIntercept * 60);
  }

  const isDanger = zone === "DANGER" || zone === "WARNING";

  return (
    <div className="absolute bottom-6 left-6 z-[1000] w-80">
      <div className="backdrop-blur-md bg-slate-900/80 border border-cyan-500/30 rounded-2xl p-5 shadow-[0_8px_32px_rgba(0,0,0,0.5)] text-slate-200 font-mono">
        
        {/* Header */}
        <div className="flex justify-between items-center mb-4 border-b border-slate-700/50 pb-3">
          <h3 className="text-lg font-bold text-cyan-400 tracking-wider">VESSEL UPLINK</h3>
          <span className="text-xs bg-cyan-950/50 text-cyan-300 px-2 py-1 rounded border border-cyan-800">
            {boatId}
          </span>
        </div>

        {/* GPS Data */}
        <div className="space-y-3 mb-5">
          <div className="flex justify-between">
            <span className="text-slate-500 text-sm">LATITUDE</span>
            <span className="font-semibold">{lat.toFixed(5)}° N</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500 text-sm">LONGITUDE</span>
            <span className="font-semibold">{lon.toFixed(5)}° E</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500 text-sm">SPEED</span>
            <span className="font-semibold">{speed.toFixed(1)} KTS</span>
          </div>
        </div>

        {/* Crisis Response Section */}
        <div className={`rounded-xl p-4 border ${isDanger ? 'bg-red-950/40 border-red-500/50' : 'bg-emerald-950/40 border-emerald-500/50'}`}>
           <div className="text-xs text-slate-400 mb-1">BOUNDARY PROXIMITY</div>
           <div className={`text-2xl font-bold mb-2 ${isDanger ? 'text-red-400' : 'text-emerald-400'}`}>
             {distanceToBoundary.toFixed(2)} KM
           </div>
           
           {/* The "Wow" Factor: Intercept Time */}
           {isDanger && (
             <div className="mt-3 pt-3 border-t border-red-900/50 flex justify-between items-center">
               <span className="text-xs text-red-300">EST. INTERCEPT TIME</span>
               <span className="text-sm font-bold text-red-400 animate-pulse">{interceptTimeMins} MINS</span>
             </div>
           )}
        </div>
      </div>
    </div>
  )
}