// ===========================================================================
// api-server.js — AEGIS Maritime backend
// Modern JavaScript (ESM) with JSDoc type hints. No TypeScript toolchain.
// ===========================================================================
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import mongoose from 'mongoose'
import http from 'node:http'
import crypto from 'node:crypto'
import { Server } from 'socket.io'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import os from 'node:os'
import fs from 'node:fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ---------------------------------------------------------------------------
// JSDoc type definitions (replace the previous TypeScript interfaces)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} BoatRecord
 * @property {string}  [_id]      Mongo document id
 * @property {string}  boatId     Optional boat identifier (default "BOAT1")
 * @property {number}  lat        Latitude (decimal degrees)
 * @property {number}  lon        Longitude (decimal degrees)
 * @property {number} [distance]  Distance to the nearest boundary in km
 * @property {string} [zone]      "SAFE" | "WARNING" | "DANGER" | "ALERT" | "CLEAR"
 * @property {Date}    timestamp  When the ping was recorded
 */

/**
 * @typedef {Object} AlertEvent
 * @property {string}  [_id]
 * @property {string}  boatId
 * @property {string}  zone
 * @property {number}  lat
 * @property {number}  lon
 * @property {Date}    timestamp
 */

/**
 * @typedef {Object} LocationPayload
 * @property {string} [boatId]
 * @property {number} lat
 * @property {number} lon
 * @property {number} [distance]
 * @property {string} [zone]
 */

/**
 * @typedef {import('express').Request}  Request
 * @typedef {import('express').Response} Response
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Default backend port (override via PORT env, e.g. set in docker-compose.yml).
// Compose publishes the backend on 4000, so 4000 is the right default.
const PORT = Number(process.env.PORT) || 4000
const MONGO_URI = process.env.MONGO_URI
const JWT_SECRET = process.env.JWT_SECRET

if (process.env.NODE_ENV === 'production' && !JWT_SECRET) {
  console.error('❌ JWT_SECRET is missing. Cannot start in production without a secure secret.')
  process.exit(1)
}
const SAFE_JWT_SECRET = JWT_SECRET || 'aegis-super-secret-key-2026'

const HARDWARE_API_KEY = process.env.HARDWARE_API_KEY
if (process.env.NODE_ENV === 'production' && !HARDWARE_API_KEY) {
  console.error('❌ HARDWARE_API_KEY is missing. Cannot start in production without a secure hardware key.')
  process.exit(1)
}
const SAFE_HARDWARE_API_KEY = HARDWARE_API_KEY || 'aegis-hardware-secret-2026'

if (!MONGO_URI) {
  console.warn('⚠️ MONGO_URI is not set – continuing without MongoDB for local/dev startup.')
  console.warn('   Configure it in .env to enable persistence and data-backed endpoints.')
}

// Mask the password before logging so we don't leak secrets to the log output.
const maskedUri = MONGO_URI
  ? MONGO_URI.replace(/(mongodb(?:\+srv)?:\/\/[^:]+:)([^@]+)(@)/, '$1***$3')
  : 'not-configured'
console.log('🔧 Backend starting with PORT=', PORT)
console.log('🔧 MONGO_URI =', maskedUri)

// CORS: reflect the request Origin (allows any host that points at this
// backend). Because the frontend auto-detects this host's LAN IP at
// startup and bakes it into window.__ENV__, the request Origin will
// always be `http://<lan-ip>:3000` from another device, or
// `http://localhost:3000` from the host. Both are valid.
// If you need to lock this down for production, set ALLOWED_ORIGINS as a
// comma-separated list of allowed origins in the environment.

function getLanIp() {
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address
      }
    }
  }
  return '127.0.0.1'
}

const autoFrontend = `http://${getLanIp()}:3000`
const explicitFrontend = process.env.FRONTEND_URL || ''

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

if (explicitFrontend && !ALLOWED_ORIGINS.includes(explicitFrontend)) {
  ALLOWED_ORIGINS.push(explicitFrontend)
}
if (!ALLOWED_ORIGINS.includes(autoFrontend)) {
  ALLOWED_ORIGINS.push(autoFrontend)
}
if (!ALLOWED_ORIGINS.includes('http://localhost:3000')) {
  ALLOWED_ORIGINS.push('http://localhost:3000')
}

function isLocalDevOrigin(origin) {
  if (!origin) return true
  try {
    const { hostname } = new URL(origin)
    return ['localhost', '127.0.0.1', '::1'].includes(hostname)
  } catch {
    return false
  }
}

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || isLocalDevOrigin(origin)) return callback(null, true) // same-origin / curl / local dev
    if (ALLOWED_ORIGINS.length === 0) return callback(null, true)
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true)
    return callback(new Error(`Origin ${origin} not allowed by CORS`))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}

// ---------------------------------------------------------------------------
// App + Socket.IO setup
// ---------------------------------------------------------------------------

const app = express()
app.use(helmet({
  contentSecurityPolicy: false, // Don't block the frontend from loading local assets
  crossOriginEmbedderPolicy: false
}))
app.use(cors(corsOptions))
app.use(express.json({ limit: '10kb' }))

const server = http.createServer(app)
const io = new Server(server, { cors: corsOptions })

// Login rate limiter
const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // Limit each IP to 5 login requests per `window`
  message: { message: 'Too many login attempts, please try again after a minute' },
  standardHeaders: true,
  legacyHeaders: false,
})

// ---------------------------------------------------------------------------
// 1. Connect to MongoDB
// ---------------------------------------------------------------------------

if (MONGO_URI) {
  mongoose
    .connect(MONGO_URI, {
      // Time out quickly if the Atlas cluster can't be reached so we see the
      // error in the logs instead of hanging silently.
      serverSelectionTimeoutMS: 10_000,
      connectTimeoutMS: 10_000,
    })
    .then(() => console.log('✅ MongoDB Atlas Connected!'))
    .catch((err) => console.log('❌ MongoDB Connection Error:', err))
} else {
  console.warn('⚠️ Skipping MongoDB connection because MONGO_URI is not configured.')
}

// ---------------------------------------------------------------------------
// 2. Mongoose schemas & models
// ---------------------------------------------------------------------------

const boatSchema = new mongoose.Schema({
  boatId:    { type: String, required: true },
  lat:       { type: Number, required: true },
  lon:       { type: Number, required: true },
  distance:  { type: Number },
  zone:      { type: String },
  timestamp: { type: Date, default: Date.now },
})
// Indexes for the queries the API makes (get-latest, history per boat).
boatSchema.index({ timestamp: -1 })
boatSchema.index({ boatId: 1, timestamp: -1 })
const Boat = mongoose.model('Boat', boatSchema)

const boatRegistrationSchema = new mongoose.Schema({
  boatId:    { type: String, required: true, unique: true },
  name:      { type: String, required: true },
  status:    { type: String, default: 'active' },
  updatedAt: { type: Date, default: Date.now },
})
const BoatRegistration = mongoose.model('BoatRegistration', boatRegistrationSchema)

const alertSchema = new mongoose.Schema({
  boatId:    { type: String, required: true },
  zone:      { type: String },
  lat:       { type: Number },
  lon:       { type: Number },
  timestamp: { type: Date, default: Date.now },
})
alertSchema.index({ timestamp: -1 })
const AlertEvent = mongoose.model('AlertEvent', alertSchema)

/**
 * Per-boat last zone seen by the server (used to detect zone changes).
 * Using a Map avoids race conditions where two boats racing through zones
 * incorrectly trigger alerts for each other.
 * @type {Map<string, string|null>}
 */
const lastZoneByBoat = new Map()

// ---------------------------------------------------------------------------
// 2b. Health check
// ---------------------------------------------------------------------------

/**
 * @param {Request}  _req
 * @param {Response} res
 */
app.get('/health', (_req, res) => {
  const dbState = mongoose.connection.readyState
  const dbConnected = dbState === 1

  res.status(200).json({
    status: 'ok',
    service: 'aegis-backend-api',
    db: dbConnected ? 'connected' : 'disconnected',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  })
})

// ---------------------------------------------------------------------------
// 2c. Auth login (token-based)
// ---------------------------------------------------------------------------

/**
 * Demo-grade login endpoint. The hackathon route (the front-end still
 * supports the admin/admin123 shortcut) goes through here as well so the
 * back-end is the single source of truth for credentials.
 *
 * In production replace this with hashed-password verification against a
 * User model + a signed JWT. For now, credentials are read from env so
 * operators can rotate them without redeploying.
 *
 * @param {Request}  req
 * @param {Response} res
 */
app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {}
  const adminUser = process.env.ADMIN_USER || 'admin'
  const adminPass = process.env.ADMIN_PASSWORD || 'admin123'

  if (!username || !password) {
    return res.status(400).json({ message: 'username and password are required' })
  }

  if (username !== adminUser || password !== adminPass) {
    return res.status(401).json({ message: 'Invalid credentials. Access Denied.' })
  }

  // Cryptographically sign a standard JWT token using HMAC-SHA256
  const token = signJwt({ username, role: 'admin' }, 86400)
  res.json({
    role: 'admin',
    token,
    boatId: null,
  })
})

/**
 * Sign a JWT token using HMAC SHA256.
 * @param {object} payload
 * @param {number} [expiresInSeconds=86400]
 * @returns {string}
 */
function signJwt(payload, expiresInSeconds = 86400) {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const fullPayload = { ...payload, iat: now, exp: now + expiresInSeconds }

  const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url')
  const base64Payload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url')
  const signature = crypto
    .createHmac('sha256', SAFE_JWT_SECRET)
    .update(`${base64Header}.${base64Payload}`)
    .digest('base64url')

  return `${base64Header}.${base64Payload}.${signature}`
}

/**
 * Verify a JWT token string.
 * @param {string} token
 * @returns {object|null}
 */
function verifyJwt(token) {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null

  const [base64Header, base64Payload, signature] = parts
  
  try {
    const headerObj = JSON.parse(Buffer.from(base64Header, 'base64url').toString('utf8'))
    if (headerObj.alg !== 'HS256') return null
  } catch {
    return null
  }

  const expectedSig = crypto
    .createHmac('sha256', SAFE_JWT_SECRET)
    .update(`${base64Header}.${base64Payload}`)
    .digest('base64url')

  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return null
    }
    const payload = JSON.parse(Buffer.from(base64Payload, 'base64url').toString('utf8'))
    const now = Math.floor(Date.now() / 1000)
    if (payload.exp && payload.exp < now) return null
    return payload
  } catch {
    return null
  }
}

/**
 * Middleware to authenticate requests via Bearer JWT token.
 * @param {Request} req
 * @param {Response} res
 * @param {import('express').NextFunction} next
 */
function authenticateJwt(req, res, next) {
  // Bypassed for local development
  req.user = { id: 'dev-user', role: 'admin' };
  next();
}

// ---------------------------------------------------------------------------
// 2d. Input validation helpers
// ---------------------------------------------------------------------------

const ALLOWED_ZONES = ['SAFE', 'WARNING', 'DANGER', 'NO_FIX']

/**
 * Coerce a value into a finite number, or return NaN.
 * @param {unknown} v
 * @returns {number}
 */
function toFiniteNumber(v) {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : NaN
}

/**
 * Validate a `POST /api/location` payload. Returns either the cleaned data
 * (with parsed floats) or a string describing the first failure.
 * @param {unknown} body
 * @returns {{ ok: true, data: LocationPayload } | { ok: false, error: string }}
 */
function validateLocationPayload(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Body must be a JSON object' }
  }
  let { boatId, lat, lon, lng, distance, distM, zone } = body
  if (lon === undefined && lng !== undefined) {
    lon = lng
  }
  if (distance === undefined && distM !== undefined) {
    distance = distM
  }

  if (typeof boatId !== 'string' || boatId.trim() === '' || boatId.length > 64) {
    return { ok: false, error: 'boatId must be a non‑empty string (max 64 chars)' }
  }

  const latN = toFiniteNumber(lat)
  const lonN = toFiniteNumber(lon)
  if (!Number.isFinite(latN) || latN < -90 || latN > 90) {
    return { ok: false, error: 'lat must be a finite number between -90 and 90' }
  }
  if (!Number.isFinite(lonN) || lonN < -180 || lonN > 180) {
    return { ok: false, error: 'lon must be a finite number between -180 and 180' }
  }

  let distanceN = distance !== undefined ? toFiniteNumber(distance) : null
if (zone === "WARN") zone = "WARNING";
else if (zone === "DANG") zone = "DANGER";
else if (zone === "NOFIX") zone = "NO_FIX";

  if (zone !== undefined && zone !== null && !ALLOWED_ZONES.includes(zone)) {
    return {
      ok: false,
      error: `zone must be one of: ${ALLOWED_ZONES.join(', ')}`,
    }
  }

  return {
    ok: true,
    data: {
      boatId: boatId.trim(),
      lat: latN,
      lon: lonN,
      distance: distanceN,
      zone: zone ?? undefined,
    },
  }
}

// ---------------------------------------------------------------------------
// 3. ESP32 posts raw location data here
// ---------------------------------------------------------------------------

/**
 * @param {Request}  req
 * @param {Response} res
 */
app.post('/api/location', async (req, res) => {
  // ---- 1️⃣ Hardware‑key authentication ---------------------------------
  const hardwareKey = req.headers['x-aegis-key'] || ''

  const providedBuffer = Buffer.alloc(64)
  const expectedBuffer = Buffer.alloc(64)
  providedBuffer.write(hardwareKey.substring(0, 64))
  expectedBuffer.write(SAFE_HARDWARE_API_KEY.substring(0, 64))

  if (!crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    console.log(`[AUTH FAIL] Unauthorized access attempt with key: ${hardwareKey}`)
    return res.status(401).json({ error: 'Unauthorized hardware access' })
  }

  // ---- 2️⃣ Payload Bypass (Validation Removed for Troubleshooting)
  const { boatId, lat, lon, distance, zone } = req.body

  console.log(`[RECEIVED] Attempting to save: Boat=${boatId}, ${zone}`)

  // ---- 3️⃣ Persist to MongoDB ------------------------------
  try {
    const newData = new Boat({ boatId, lat, lon, distance, zone })
    await newData.save()

    // --- Zone-change alert detection ---
    const previousZone = lastZoneByBoat.get(boatId)
    if (zone && zone !== previousZone && (zone === 'WARNING' || zone === 'DANGER')) {
      const alert = new AlertEvent({ boatId, zone, lat, lon })
      await alert.save()
      io.emit('alertEvent', alert)
      console.log(`[ALERT] ${boatId} entered ${zone} zone`)
    }
    lastZoneByBoat.set(boatId, zone)

    if (typeof io !== 'undefined') {
      io.emit('locationUpdate', newData)
    }

    console.log(`[SAVED TO DB] BoatId: ${boatId}, Lat: ${lat}, Lon: ${lon}, Zone: ${zone}`)
    res.status(201).json({ message: 'Data saved!', data: newData })
  } catch (err) {
    console.error('❌ DB Save Error:', err)
    res.status(500).json({ error: 'Failed to save to database' })
  }
})

// ---------------------------------------------------------------------------
// 4. React dashboard gets the latest record
// ---------------------------------------------------------------------------

/**
 * @param {Request}  _req
 * @param {Response} res
 */
app.get('/api/location', authenticateJwt, async (_req, res) => {
  try {
    const latest = await Boat.findOne().sort({ timestamp: -1 })
    if (latest) {
      res.json(latest)
    } else {
      res.status(204).send()
    }
  } catch (err) {
    console.error('❌ DB Fetch Error:', err)
    res.status(500).json({ error: 'Failed to fetch data' })
  }
})

// ---------------------------------------------------------------------------
// 5. Movement history (latest 200 records, optionally filtered by boatId)
// ---------------------------------------------------------------------------

/**
 * @param {Request}  req
 * @param {Response} res
 */
app.get('/api/location/history', authenticateJwt, async (req, res) => {
  try {
    const query = {}
    if (req.query.boatId) query.boatId = String(req.query.boatId)
    const all = await Boat.find(query).sort({ timestamp: -1 }).limit(200)
    res.json(all)
  } catch (err) {
    console.error('❌ DB History Error:', err)
    res.status(500).json({ error: 'Failed to fetch history' })
  }
})

// ---------------------------------------------------------------------------
// 5b. Latest location per boat (group by boatId)
// ---------------------------------------------------------------------------

/**
 * @param {Request}  _req
 * @param {Response} res
 */
app.get('/api/location/latest', authenticateJwt, async (_req, res) => {
  try {
    const latestPerBoat = await Boat.aggregate([
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$boatId',
          boatId:    { $first: '$boatId' },
          lat:       { $first: '$lat' },
          lon:       { $first: '$lon' },
          distance:  { $first: '$distance' },
          zone:      { $first: '$zone' },
          timestamp: { $first: '$timestamp' },
        },
      },
      { $sort: { boatId: 1 } },
    ])
    res.json(latestPerBoat)
  } catch (err) {
    console.error('❌ DB Latest Error:', err)
    res.status(500).json({ error: 'Failed to fetch latest boat locations' })
  }
})

// ---------------------------------------------------------------------------
// 6. Alert events (newest 100, optionally filtered by boatId)
// ---------------------------------------------------------------------------

/**
 * @param {Request}  req
 * @param {Response} res
 */
app.get('/api/alerts', authenticateJwt, async (req, res) => {
  try {
    const query = {}
    if (req.query.boatId) query.boatId = String(req.query.boatId)
    const alerts = await AlertEvent.find(query).sort({ timestamp: -1 }).limit(100)
    res.json(alerts)
  } catch (err) {
    console.error('❌ DB Alerts Error:', err)
    res.status(500).json({ error: 'Failed to fetch alerts' })
  }
})

// ---------------------------------------------------------------------------
// 6.5 Mock endpoints for Logistics and Comms
// ---------------------------------------------------------------------------

/**
 * @param {Request}  req
 * @param {Response} res
 */
app.get('/api/logistics', authenticateJwt, (req, res) => {
  const vessels = Array.from({ length: 8 }, (_, i) => ({
    id: `PATROL-0${i + 1}`,
    status: 'ACTIVE',
    fuel: Math.floor(Math.random() * 60 + 20),
    ammo: 'NOMINAL',
    maintenance: `T-Minus ${(i + 1) * 12}:00:00`
  }))
  res.json({
    totalSupplyCarriers: 4,
    networkStatus: 'OPTIMAL',
    vessels
  })
})

/**
 * @param {Request}  req
 * @param {Response} res
 */
app.get('/api/comms/latest', authenticateJwt, (req, res) => {
  const activeChannels = ['HQ-CENTRAL', 'FLEET-CMD', 'AIR-SUPPORT', 'COAST-GUARD']
  const logs = [
    { sender: 'HQ-CENTRAL', time: new Date(Date.now() - 300000).toISOString(), message: "All vessels in Sector 7B hold current patrol patterns. Await further vector instructions. Be advised, intel suggests non-squawking vessels operating near the EEZ boundary.", type: 'incoming' },
    { sender: 'FLEET-CMD', time: new Date(Date.now() - 60000).toISOString(), message: "Copy HQ. Patrols holding. Sensors adjusted to maximum sweep rate. Awaiting further.", type: 'outgoing' }
  ]
  res.json({
    status: 'CONNECTION SECURE',
    activeChannels,
    logs
  })
})

// ---------------------------------------------------------------------------
// 7. Serve static frontend files
// ---------------------------------------------------------------------------

const frontendBuildPath = path.resolve(__dirname, '../../dashboard-next/dist')
app.use(express.static(frontendBuildPath))

// For any other request, send the index.html so React Router handles routing
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next()
  }
  const indexPath = path.join(frontendBuildPath, 'index.html')
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath)
  } else {
    res.send('Aegis Backend is running! (Frontend build not found)')
  }
})

// ---------------------------------------------------------------------------
// Error Handling & Graceful Shutdown
// ---------------------------------------------------------------------------

// Centralized Express Error Handler
app.use((err, _req, res, _next) => {
  console.error('🔥 Unhandled Express Error:', err)
  res.status(err.status || 500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message,
  })
})

// Start the server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Aegis Backend API running on http://0.0.0.0:${PORT}`)
})

// Graceful process teardown
function shutdownGracefully(signal) {
  console.log(`\n🛑 ${signal} signal received. Initiating graceful shutdown...`)
  server.close(() => {
    console.log('HTTP & Socket.IO servers closed.')
    mongoose.connection.close(false).then(() => {
      console.log('MongoDB Atlas connection closed.')
      process.exit(0)
    })
  })
}

process.on('SIGINT', () => shutdownGracefully('SIGINT'))
process.on('SIGTERM', () => shutdownGracefully('SIGTERM'))
