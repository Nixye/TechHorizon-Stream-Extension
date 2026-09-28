import { WebSocket } from 'ws';

const origin = process.argv[2];
if (!origin || !origin.startsWith('https://')) {
  console.error('Uso: node server/live-smoke.js https://seu-servico.example');
  process.exit(2);
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const messages = [];
    socket.on('message', (data, binary) => { if (!binary) messages.push(JSON.parse(data.toString())); });
    socket.once('open', () => resolve({ socket, messages }));
    socket.once('error', reject);
  });
}

async function nextMessage(peer, predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const found = peer.messages.find(predicate);
    if (found) return found;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Sinal WebRTC não chegou');
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
    const viewerId = (await nextMessage(viewer, message => message.type === 'viewer')).id;
    const signal = { description: { type: 'offer', sdp: 'v=0\r\n' } };
    publisher.socket.send(JSON.stringify({ type: 'signal', to: viewerId, signal }));
    const received = await nextMessage(viewer, message => message.type === 'signal');
    if (JSON.stringify(received.signal) !== JSON.stringify(signal)) throw new Error('Sinal WebRTC incorreto');
    console.log('API e sinalização WebRTC públicas: OK');
  } finally {
    publisher?.socket.terminate();
    viewer?.socket.terminate();
    await fetch(`${origin}/api/rooms/${id}`, { method: 'DELETE', headers: { 'X-Publish-Token': publishToken } });
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
