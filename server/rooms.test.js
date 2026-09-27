import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, getRoom, validPublishToken, deleteRoom } from './rooms.js';

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
