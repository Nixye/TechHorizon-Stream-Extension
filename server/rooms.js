import { randomBytes, timingSafeEqual } from 'node:crypto';

const ROOM_TTL_MS = 12 * 60 * 60 * 1000;
const rooms = new Map();

export function createRoom() {
  const id = randomBytes(12).toString('base64url');
  const publishToken = randomBytes(32).toString('base64url');
  const room = { id, publishToken, createdAt: Date.now(), publisher: null, viewers: new Set(), lastFrame: null };
  rooms.set(id, room);
  return { id, publishToken };
}

export function getRoom(id) {
  const room = rooms.get(id);
  if (!room) return null;
  if (Date.now() - room.createdAt > ROOM_TTL_MS && !room.publisher) {
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

export function pruneRooms() {
  for (const [id, room] of rooms) {
    if (Date.now() - room.createdAt > ROOM_TTL_MS && !room.publisher) rooms.delete(id);
  }
}
