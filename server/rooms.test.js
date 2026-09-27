import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, getRoom, validPublishToken, deleteRoom, pruneRooms, ROOM_IDLE_TTL_MS } from './rooms.js';

test('room IDs and publishing credentials are distinct and unguessable', () => {
  const first = createRoom();
  const second = createRoom();
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.publishToken, first.id);
  assert.ok(first.id.length >= 16);
  assert.ok(first.publishToken.length >= 40);
  const room = getRoom(first.id);
  assert.equal(validPublishToken(room, first.publishToken), true);
  assert.equal(validPublishToken(room, second.publishToken), false);
  assert.equal(validPublishToken(room, undefined), false);
  deleteRoom(first.id);
  deleteRoom(second.id);
  assert.equal(getRoom(first.id), null);
});

test('empty rooms expire six hours after their last activity', () => {
  const created = createRoom();
  const room = getRoom(created.id);
  room.lastActivityAt = Date.now() + 10_000 - ROOM_IDLE_TTL_MS;
  pruneRooms(room.lastActivityAt + ROOM_IDLE_TTL_MS);
  assert.equal(getRoom(created.id), room);
  pruneRooms(room.lastActivityAt + ROOM_IDLE_TTL_MS + 1);
  assert.equal(getRoom(created.id), null);
});

test('rooms with connected participants do not expire', () => {
  const created = createRoom();
  const room = getRoom(created.id);
  const viewer = {};
  room.viewers.add(viewer);
  room.lastActivityAt = Date.now() - ROOM_IDLE_TTL_MS - 1;
  pruneRooms();
  assert.equal(getRoom(created.id), room);
  room.viewers.delete(viewer);
  deleteRoom(created.id);
});
