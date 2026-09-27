import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { createRoom, deleteRoom, getRoom, pruneRooms, touchRoom, validPublishToken } from './rooms.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8kb' }));
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/config', (_req, res) => {
  const publicUrl = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '';
  res.json({ publicUrl });
});
app.post('/api/rooms', (_req, res) => res.status(201).json(createRoom()));
app.get('/api/rooms/:id', (req, res) => {
  const room = getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: 'Sala não encontrada ou expirada.' });
  touchRoom(room);
  return res.json({ id: room.id, live: Boolean(room.publisher), viewers: room.viewers.size });
});
app.delete('/api/rooms/:id', (req, res) => {
  const room = getRoom(req.params.id);
  if (!room || !validPublishToken(room, req.get('X-Publish-Token'))) return res.sendStatus(403);
  room.publisher?.close(1000, 'Sala encerrada');
  for (const viewer of room.viewers) viewer.close(1000, 'Sala encerrada');
  deleteRoom(room.id);
  return res.sendStatus(204);
});

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
app.use(express.static(dist, { index: false }));
app.get(/.*/, (_req, res) => res.sendFile(join(dist, 'index.html')));

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== '/ws') return socket.destroy();
  const room = getRoom(url.searchParams.get('room'));
  const role = url.searchParams.get('role');
  if (!room || !['publish', 'watch'].includes(role)) return socket.destroy();
  if (role === 'publish' && !validPublishToken(room, url.searchParams.get('token'))) return socket.destroy();
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, room, role));
});

function sendState(room) {
  const state = JSON.stringify({ type: 'state', live: Boolean(room.publisher), viewers: room.viewers.size });
  if (room.publisher?.readyState === WebSocket.OPEN) room.publisher.send(state);
  for (const viewer of room.viewers) if (viewer.readyState === WebSocket.OPEN) viewer.send(state);
}

wss.on('connection', (ws, room, role) => {
  touchRoom(room);
  if (role === 'publish') {
    if (room.publisher) room.publisher.close(1000, 'Nova transmissão iniciada');
    room.publisher = ws;
    room.lastFrame = null;
  } else {
    if (room.viewers.size >= 20) return ws.close(1013, 'Sala cheia');
    room.viewers.add(ws);
    if (room.lastFrame) ws.send(room.lastFrame, { binary: true });
  }
  sendState(room);
  ws.on('message', (data, binary) => {
    if (!binary && data.toString() === 'keepalive') { touchRoom(room); return; }
    if (role !== 'publish' || !binary || room.publisher !== ws) return;
    // JPEG only. This is a bounded, low-latency frame relay, not a media archive.
    if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8 || data[data.length - 2] !== 0xff || data[data.length - 1] !== 0xd9) return;
    room.lastFrame = data;
    touchRoom(room);
    for (const viewer of room.viewers) {
      if (viewer.readyState === WebSocket.OPEN && viewer.bufferedAmount < 2 * 1024 * 1024) viewer.send(data, { binary: true });
    }
  });
  ws.on('close', () => {
    if (role === 'publish' && room.publisher === ws) { room.publisher = null; room.lastFrame = null; }
    if (role === 'watch') room.viewers.delete(ws);
    touchRoom(room);
    sendState(room);
  });
});

setInterval(pruneRooms, 60 * 60 * 1000).unref();
const port = Number(process.env.PORT || 3001);
server.listen(port, () => console.log(`Stage em http://localhost:${port}`));
