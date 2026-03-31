# Aegis Maritime System

Monorepo for maritime tracking with backend API, web dashboards, and ESP32 firmware.

## Workspace Layout

- apps/
  - backend-api/          Express + Socket.IO API and serial bridge
    - src/
      - api-server.js     Main backend server entrypoint
      - services/
        - serial-bridge.js  USB serial to API bridge
  - dashboard-next/       Next.js dashboard
  - dashboard-vite/       Vite React dashboard
- firmware/
  - esp32/
    - receiver/
      - receiver.ino
    - transmitter/
      - transmitter.ino
- scripts/
  - start.ps1             Runs all app dev servers from workspace root

## Dev Commands

From the repository root:

- npm run dev            Start backend + both dashboards
- npm run dev:backend    Start backend API only
- npm run dev:vite       Start Vite dashboard only
- npm run dev:next       Start Next dashboard only

From apps/backend-api:

- npm run dev            Start API server
- npm run dev:bridge     Start serial bridge (COM input to API)
