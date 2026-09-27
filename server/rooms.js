import { randomBytes, timingSafeEqual } from 'node:crypto';

export const ROOM_IDLE_TTL_MS = 6 * 60 * 60 * 1000;
const rooms = new Map();

export function createRoom() {
  const id = randomBytes(12).toString('base64url');
  const publishToken = randomBytes(32).toString('base64url');
  const room = { id, publishToken, lastActivityAt: Date.now(), publisher: null, viewers: new Set(), lastFrame: null };
  rooms.set(id, room);
  return { id, publishToken };
}

export function getRoom(id) {
  const room = rooms.get(id);
  if (!room) return null;
  if (isExpired(room)) {
    rooms.delete(id);
    return null;
  }
  return room;
}

export function validPublishToken(room, supplied) {
  if (typeof supplied !== 'string') return false;
  const a = Buffer.from(room.publishToken);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function deleteRoom(id) { rooms.delete(id); }

export function touchRoom(room) { room.lastActivityAt = Date.now(); }

function isExpired(room, now = Date.now()) {
  return !room.publisher && room.viewers.size === 0 && now - room.lastActivityAt > ROOM_IDLE_TTL_MS;
}

export function pruneRooms(now = Date.now()) {
  for (const [id, room] of rooms) {
    if (isExpired(room, now)) rooms.delete(id);
  }
}
