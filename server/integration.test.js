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
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
    ws.once('close', () => reject(new Error('WebSocket closed before opening')));
  });
}

function nextBinary(ws) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Frame timed out')), 3000);
    const handler = (data, isBinary) => {
      if (!isBinary) return;
      clearTimeout(timeout);
      ws.off('message', handler);
      resolve(data);
    };
    ws.on('message', handler);
  });
}

test('publishing relays frames to viewers and rejects an invalid publisher', { timeout: 10000 }, async () => {
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
    const frame = Buffer.from([0xff, 0xd8, 0x00, 0x01, 0xff, 0xd9]);
    const received = nextBinary(viewer);
    publisher.send(frame);
    assert.deepEqual(await received, frame);
    assert.equal((await fetch(`${origin}/api/rooms/${id}`)).status, 200);
    assert.equal((await fetch(`${origin}/api/rooms/${id}`, { method: 'DELETE', headers: { 'X-Publish-Token': 'wrong' } })).status, 403);
    assert.equal((await fetch(`${origin}/api/rooms/${id}`, { method: 'DELETE', headers: { 'X-Publish-Token': publishToken } })).status, 204);
    assert.equal((await fetch(`${origin}/api/rooms/${id}`)).status, 404);
  } finally {
    publisher?.terminate();
    viewer?.terminate();
    child.kill();
  }
});
