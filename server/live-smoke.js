import { WebSocket } from 'ws';

const origin = process.argv[2];
if (!origin || !origin.startsWith('https://')) {
  console.error('Uso: node server/live-smoke.js https://seu-servico.example');
  process.exit(2);
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

async function main() {
  const response = await fetch(`${origin}/api/rooms`, { method: 'POST' });
  if (!response.ok) throw new Error(`Criar sala: HTTP ${response.status}`);
  const { id, publishToken } = await response.json();
  let viewer;
  let publisher;
  try {
    const wsBase = origin.replace(/^https:/, 'wss:');
    viewer = await connect(`${wsBase}/ws?room=${id}&role=watch`);
    publisher = await connect(`${wsBase}/ws?room=${id}&role=publish&token=${publishToken}`);
    const frame = Buffer.from([0xff, 0xd8, 0, 1, 0xff, 0xd9]);
    const received = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Quadro não chegou')), 5000);
      viewer.on('message', (data, binary) => {
        if (!binary) return;
        clearTimeout(timeout);
        resolve(data);
      });
    });
    publisher.send(frame);
    if (!Buffer.from(await received).equals(frame)) throw new Error('Quadro recebido incorreto');
    console.log('API e retransmissão WebSocket públicas: OK');
  } finally {
    publisher?.terminate();
    viewer?.terminate();
    await fetch(`${origin}/api/rooms/${id}`, { method: 'DELETE', headers: { 'X-Publish-Token': publishToken } });
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
