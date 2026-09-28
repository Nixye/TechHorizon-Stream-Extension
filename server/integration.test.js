import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { WebSocket } from 'ws';

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForHealth(origin) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch(`${origin}/api/health`)).ok) return; } catch { /* Starting. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Server did not start');
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const messages = [];
    ws.on('message', (data, binary) => { if (!binary) messages.push(JSON.parse(data.toString())); });
    ws.once('open', () => resolve({ ws, messages }));
    ws.once('error', reject);
    ws.once('close', () => reject(new Error('WebSocket closed before opening')));
  });
}

async function nextMessage(peer, predicate) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const found = peer.messages.find(predicate);
    if (found) return found;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Signal timed out');
}

test('publishing routes WebRTC signaling and rejects an invalid publisher', { timeout: 10000 }, async () => {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/index.js'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), PUBLIC_URL: 'https://stage.example' }, stdio: 'ignore' });
  let publisher;
  let viewer;
  try {
    await waitForHealth(origin);
    assert.deepEqual(await (await fetch(`${origin}/api/config`)).json(), { publicUrl: 'https://stage.example' });
    const response = await fetch(`${origin}/api/rooms`, { method: 'POST' });
    assert.equal(response.status, 201);
    const { id, publishToken } = await response.json();
    assert.equal((await fetch(`${origin}/api/rooms/${id}`)).status, 200);
    await assert.rejects(connect(`ws://127.0.0.1:${port}/ws?room=${id}&role=publish&token=wrong`));
    viewer = await connect(`ws://127.0.0.1:${port}/ws?room=${id}&role=watch`);
    publisher = await connect(`ws://127.0.0.1:${port}/ws?room=${id}&role=publish&token=${publishToken}`);
    const viewerId = (await nextMessage(viewer, message => message.type === 'viewer')).id;
    assert.deepEqual((await nextMessage(publisher, message => message.type === 'viewers')).ids, [viewerId]);
    publisher.ws.send(JSON.stringify({ type: 'media', audio: true }));
    assert.equal((await nextMessage(viewer, message => message.type === 'state' && message.audio)).audio, true);
    const offer = { description: { type: 'offer', sdp: 'v=0\r\n' } };
    publisher.ws.send(JSON.stringify({ type: 'signal', to: viewerId, signal: offer }));
    assert.deepEqual((await nextMessage(viewer, message => message.type === 'signal')).signal, offer);
    const answer = { description: { type: 'answer', sdp: 'v=0\r\n' } };
    viewer.ws.send(JSON.stringify({ type: 'signal', signal: answer }));
    assert.deepEqual((await nextMessage(publisher, message => message.type === 'signal' && message.from === viewerId)).signal, answer);
    assert.equal((await fetch(`${origin}/api/rooms/${id}`)).status, 200);
    assert.equal((await fetch(`${origin}/api/rooms/${id}`, { method: 'DELETE', headers: { 'X-Publish-Token': 'wrong' } })).status, 403);
    assert.equal((await fetch(`${origin}/api/rooms/${id}`, { method: 'DELETE', headers: { 'X-Publish-Token': publishToken } })).status, 204);
    assert.equal((await fetch(`${origin}/api/rooms/${id}`)).status, 404);
  } finally {
    publisher?.ws.terminate();
    viewer?.ws.terminate();
    child.kill();
  }
});
