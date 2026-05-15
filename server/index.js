const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

const LOG_FILE = path.join(__dirname, 'events.log');
const SERIAL_PORT = process.env.SERIAL_PORT || '/dev/ttyUSB0';
const BAUD_RATE = parseInt(process.env.BAUD_RATE) || 115200;
const PORT = parseInt(process.env.PORT) || 3001;

// ─── X-talk message parser ─────────────────────────────────────────────────
// Handles formats: X{addr}B[CMD] and X{addr}B[CMD=VALUE]
// Anomaly format: X{addr}B[ANOMALY{nn}=DETECTED|CLEARED]
function parseXtalk(raw) {
  const trimmed = (raw || '').trim();
  const ts = new Date().toISOString();

  // Standard: X001B[PICKUP] or X001B[STOCK=017] or X001B[WEIGHT=+001.500]
  const m = trimmed.match(/^X(\d{3})B\[([A-Z0-9]+)(?:=([^\]]+))?\]$/);
  if (!m) return null;

  const [, addr, cmd, val] = m;
  const address = `X${addr}`;
  const base = { raw: trimmed, address, timestamp: ts };

  switch (cmd) {
    case 'PICKUP':
      return { ...base, type: 'PICKUP', event: 'Item lifted from shelf' };

    case 'STOCK':
      return {
        ...base,
        type: 'STOCK',
        stock_count: parseInt(val, 10),
        event: `Absolute stock count: ${parseInt(val, 10)} item(s)`,
      };

    case 'STOCKCHANGE': {
      const delta = parseInt(val, 10);
      return {
        ...base,
        type: 'STOCKCHANGE',
        stock_change: delta,
        direction: delta > 0 ? 'INCREASE' : 'DECREASE',
        event: delta > 0
          ? `Stock increased by ${Math.abs(delta)} (item returned)`
          : `Stock decreased by ${Math.abs(delta)} (item removed)`,
      };
    }

    case 'WEIGHT': {
      const kg = parseFloat(val);
      return {
        ...base,
        type: 'WEIGHT',
        weight_kg: kg,
        weight_g: Math.round(kg * 1000),
        event: `Absolute weight: ${kg.toFixed(3)} kg (${Math.round(kg * 1000)} g)`,
      };
    }

    case 'CALIBRATION':
      return { ...base, type: 'CALIBRATION_DONE', event: 'Sensor calibration complete' };

    default:
      // ANOMALY01=DETECTED / ANOMALY01=CLEARED
      if (cmd.startsWith('ANOMALY')) {
        const anomalyId = cmd.replace('ANOMALY', '');
        const detected = val === 'DETECTED';
        return {
          ...base,
          type: detected ? 'ANOMALY_DETECTED' : 'ANOMALY_CLEARED',
          anomaly_id: anomalyId,
          event: detected
            ? `Anomaly ${anomalyId} detected (unexpected item weight)`
            : `Anomaly ${anomalyId} cleared`,
        };
      }
      return { ...base, type: 'UNKNOWN', command: cmd, value: val, event: `Unknown: ${trimmed}` };
  }
}

// ─── Logging ──────────────────────────────────────────────────────────────
function logEvent(event) {
  const entry = JSON.stringify(event);
  console.log('[EVENT]', entry);
  fs.appendFileSync(LOG_FILE, entry + '\n');
}

// ─── State change broadcast ───────────────────────────────────────────────
let lastStockCount = null;

function broadcastEvent(event) {
  logEvent(event);
  io.emit('sensor_event', event);

  if (event.type === 'PICKUP') {
    io.emit('state_change', { state: 'PICKUP', event });

  } else if (event.type === 'STOCKCHANGE' && event.stock_change > 0) {
    io.emit('state_change', { state: 'RETURNED', event });

  } else if (event.type === 'STOCK') {
    // Infer return if absolute count increased from last known value
    if (lastStockCount !== null && event.stock_count > lastStockCount) {
      io.emit('state_change', { state: 'RETURNED', event });
    } else {
      io.emit('state_change', { state: 'IDLE', event });
    }
    lastStockCount = event.stock_count;

  } else if (event.type === 'WEIGHT') {
    io.emit('state_change', { state: 'IDLE', event });

  } else if (event.type === 'ANOMALY_DETECTED' || event.type === 'ANOMALY_CLEARED') {
    io.emit('state_change', { state: 'ANOMALY', event });
  }
}

// ─── Serial port setup ────────────────────────────────────────────────────
let serialConnected = false;

function initSerial() {
  try {
    const { SerialPort } = require('serialport');
    const { ReadlineParser } = require('@serialport/parser-readline');

    const port = new SerialPort({ path: SERIAL_PORT, baudRate: BAUD_RATE });
    const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

    port.on('open', () => {
      serialConnected = true;
      console.log(`[SERIAL] Connected: ${SERIAL_PORT} @ ${BAUD_RATE} baud`);
      io.emit('serial_status', { connected: true, port: SERIAL_PORT, baud: BAUD_RATE });
    });

    port.on('error', (err) => {
      serialConnected = false;
      console.error('[SERIAL] Error:', err.message);
      io.emit('serial_status', { connected: false, error: err.message });
    });

    port.on('close', () => {
      serialConnected = false;
      console.log('[SERIAL] Port closed');
      io.emit('serial_status', { connected: false });
    });

    parser.on('data', (data) => {
      const event = parseXtalk(data);
      if (event) broadcastEvent(event);
      else console.warn('[SERIAL] Unparsed data:', data);
    });

  } catch (err) {
    console.warn(`[SERIAL] Unavailable (${err.message}) — running in demo/simulation mode`);
    io.emit('serial_status', { connected: false, error: err.message, demo: true });
  }
}

initSerial();

// ─── REST API ─────────────────────────────────────────────────────────────

// Simulate a raw X-talk message (for testing without hardware)
app.post('/simulate', (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ ok: false, error: 'message required' });

  const event = parseXtalk(message);
  if (!event) return res.status(400).json({ ok: false, error: 'Could not parse X-talk message' });

  broadcastEvent(event);
  res.json({ ok: true, event });
});

// Get paginated event log
app.get('/logs', (req, res) => {
  try {
    const lines = fs.readFileSync(LOG_FILE, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(JSON.parse)
      .reverse()
      .slice(0, 500);
    res.json(lines);
  } catch {
    res.json([]);
  }
});

// Clear log file
app.delete('/logs', (req, res) => {
  fs.writeFileSync(LOG_FILE, '');
  res.json({ ok: true });
});

// Health check / status
app.get('/status', (req, res) => {
  res.json({
    ok: true,
    serial: { connected: serialConnected, port: SERIAL_PORT, baud: BAUD_RATE },
    lastStockCount,
    uptime: process.uptime(),
  });
});

// ─── Socket.io ────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);

  // Send last 100 events on connect
  try {
    const history = fs.readFileSync(LOG_FILE, 'utf8')
      .split('\n')
      .filter(Boolean)
      .slice(-100)
      .map(JSON.parse);
    socket.emit('history', history);
  } catch { /* empty log */ }

  socket.emit('serial_status', { connected: serialConnected, port: SERIAL_PORT, baud: BAUD_RATE });

  socket.on('disconnect', () => {
    console.log(`[WS] Client disconnected: ${socket.id}`);
  });
});

// ─── Serve built React app (production / RPi) ─────────────────────────────
// Build once on dev machine with: npm run build
// Then the RPi only needs: node server/index.js
const clientDist = path.join(__dirname, '../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback — serve index.html for all non-API routes
  app.get(/^(?!\/simulate|\/logs|\/status).*/, (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
  console.log(`[SERVER] Serving built client from ${clientDist}`);
} else {
  console.log('[SERVER] No client/dist found — run "npm run build" or use Vite dev server');
}

// ─── Start ────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`[SERVER] Nexmosphere monitor running on http://localhost:${PORT}`);
  console.log(`[SERVER] Serial port: ${SERIAL_PORT} @ ${BAUD_RATE} baud`);
  console.log(`[SERVER] Log file: ${LOG_FILE}`);
});
