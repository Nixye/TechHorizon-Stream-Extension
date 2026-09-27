import { DiscordSDK } from '@discord/embedded-app-sdk';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/700.css';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/700.css';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app')!;
const params = new URLSearchParams(location.search);
const isHost = location.pathname === '/host';
const clientId = '1553857876232241263';
const inDiscord = window.parent !== window;
const sdk = inDiscord ? new DiscordSDK(clientId) : null;
let roomId = params.get('room') || '';
let publishToken = params.get('token') || '';
let publicBaseUrl = import.meta.env.VITE_PUBLIC_URL || '';
let socket: WebSocket | null = null;
let stream: MediaStream | null = null;
let timer = 0;
let roomKeepaliveTimer = 0;
let wsKeepaliveTimer = 0;
let reconnectTimer = 0;
let unloading = false;
let rendering = false;
let lastFrameUrl = '';
let captureAudioContext: AudioContext | null = null;
let playbackContext: AudioContext | null = null;
let playbackAt = 0;
let audioEnabled = false;
let owner = false;

try { owner = Boolean(roomId && sessionStorage.getItem(`stage-owner-${roomId}`)); } catch { /* Storage can be blocked in embeds. */ }

function el<T extends HTMLElement>(selector: string): T { return app.querySelector<T>(selector)!; }
function setText(selector: string, value: string) { el<HTMLElement>(selector).textContent = value; }
function wsUrl(role: 'watch' | 'publish') {
  const url = new URL('/ws', location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('room', roomId);
  url.searchParams.set('role', role);
  if (role === 'publish') url.searchParams.set('token', publishToken);
  return url.href;
}
function startWebSocketKeepalive(ws: WebSocket) {
  window.clearInterval(wsKeepaliveTimer);
  wsKeepaliveTimer = window.setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send('keepalive');
  }, 60_000);
}
function stopWebSocketKeepalive() {
  window.clearInterval(wsKeepaliveTimer);
  wsKeepaliveTimer = 0;
}
function renderShell() {
  app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <a class="brand" href="/" aria-label="Stage, início"><span class="brand-icon">◉</span><span>STAGE<span class="brand-dot">.</span></span></a>
        <span class="top-label">STREAM TOGETHER <span class="label-dash">/</span> DISCORD ACTIVITY</span>
        <span class="top-status"><i></i>${inDiscord ? 'DENTRO DO DISCORD' : 'WEB APP'}</span>
      </header>
      <main class="main">
        <aside class="sidebar">
          <div class="eyebrow"><span class="eyebrow-line"></span> UM ESPAÇO PARA MOSTRAR</div>
          <h1>Seu jogo.<br>Seu app.<br><em>Seu palco.</em></h1>
          <p class="intro">Compartilhe uma janela ou a tela inteira com quem está na sua sala. Simples, direto e ao vivo.</p>
          <div class="side-divider"></div>
          <div class="steps"><div class="step"><span>01</span><p>Crie uma sala</p></div><div class="step"><span>02</span><p>Abra o link de transmissão no navegador</p></div><div class="step"><span>03</span><p>Compartilhe o código com quem vai assistir</p></div></div>
          <div class="sidebar-foot">FEITO PARA ASSISTIR JUNTOS <span>↗</span></div>
        </aside>
        <section class="workspace" id="workspace"></section>
      </main>
      <footer class="footer"><span>STAGE / 2026</span><span>CAPTURA COM SUA PERMISSÃO • SEM GRAVAÇÃO</span><span>DESENVOLVIDO PARA DISCORD</span></footer>
    </div>`;
}
function showHome() {
  el<HTMLElement>('#workspace').innerHTML = `
    <div class="workspace-head"><div><span class="section-kicker">SUA SALA DE STREAM</span><h2>Comece por aqui<span class="accent">.</span></h2></div><span class="live-pill"><i></i> PRONTO PARA COMEÇAR</span></div>
    <div class="action-grid">
      <article class="action-card primary"><div class="card-top"><span class="card-number">01 / TRANSMITIR</span><span class="card-symbol">↗</span></div><div class="card-visual visual-broadcast"><span class="visual-window"><i></i><i></i><i></i><b>▶</b></span><span class="visual-rings"></span></div><h3>Entre em cena</h3><p>Crie uma sala e escolha qual tela ou aplicativo mostrar.</p><button class="button button-primary" id="create">Criar sala <span>↗</span></button></article>
      <article class="action-card"><div class="card-top"><span class="card-number">02 / ASSISTIR</span><span class="card-symbol">◉</span></div><div class="card-visual visual-watch"><span class="play-circle">▶</span><span class="visual-bars"></span></div><h3>Assista junto</h3><p>Tem um código? Entre na sala para ver a transmissão.</p><form id="join-form" class="join-form"><input id="room-input" placeholder="Cole o código da sala" autocomplete="off" aria-label="Código da sala" required /><button class="button button-outline" type="submit">Entrar <span>→</span></button></form></article>
    </div><div id="notice" class="notice" role="status"></div>
    <div class="info-strip"><span class="info-icon">✳</span><p><strong>Como funciona:</strong> a captura começa em uma aba normal do navegador; seus amigos assistem aqui ou dentro da Activity do Discord.</p></div>`;
  el<HTMLButtonElement>('#create').onclick = create;
  el<HTMLFormElement>('#join-form').onsubmit = event => {
    event.preventDefault();
    const id = el<HTMLInputElement>('#room-input').value.trim();
    if (id) location.href = `/watch?room=${encodeURIComponent(id)}`;
  };
}
async function create() {
  const button = el<HTMLButtonElement>('#create');
  button.disabled = true;
  setText('#notice', 'Criando sala…');
  try {
    const response = await fetch('/api/rooms', { method: 'POST' });
    if (!response.ok) throw new Error('Não foi possível criar a sala.');
    const room: { id: string; publishToken: string } = await response.json();
    roomId = room.id;
    publishToken = room.publishToken;
    if (!publicBaseUrl) {
      const configResponse = await fetch('/api/config');
      if (configResponse.ok) publicBaseUrl = (await configResponse.json()).publicUrl || '';
    }
    owner = true;
    try { sessionStorage.setItem(`stage-owner-${roomId}`, publishToken); } catch { /* The current page remains the owner. */ }
    history.replaceState({}, '', `/watch?room=${encodeURIComponent(roomId)}`);
    showWatch();
  } catch (error) {
    setText('#notice', error instanceof Error ? error.message : 'Falha ao criar sala.');
    button.disabled = false;
  }
}
async function openHost(url: string) {
  if (sdk) {
    try { await sdk.ready(); await sdk.commands.openExternalLink({ url }); return; } catch { /* Fall through to regular link. */ }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
function hostUrl() {
  const url = new URL('/host', publicBaseUrl || location.href);
  url.searchParams.set('room', roomId);
  url.searchParams.set('token', publishToken);
  return url.href;
}
function showWatch() {
  el<HTMLElement>('#workspace').innerHTML = `
    <div class="workspace-head"><div><span class="section-kicker">${owner ? 'SUA SALA' : 'ASSISTINDO AGORA'}</span><h2>${owner ? 'Sala pronta para transmitir' : 'A sala ao vivo'}<span class="accent">.</span></h2></div><span class="live-pill" id="live-badge"><i></i> CONECTANDO</span></div>
    ${owner ? '<div class="owner-panel"><div><strong>Você está na sua sala</strong><p>Abra a captura em uma aba do navegador. A transmissão aparecerá aqui e para quem entrar com o código.</p></div><button class="button button-primary" id="open-host">Abrir captura com áudio ↗</button></div>' : ''}
    <div class="player"><img id="screen" alt="Tela compartilhada" /><div id="player-empty" class="player-empty"><span class="empty-icon">◉</span><h3>Aguardando a transmissão</h3><p>Quando alguém começar a compartilhar, a imagem aparece aqui.</p></div><span class="player-live" id="player-live">● AO VIVO</span></div>
    <div class="player-bottom"><div><span class="section-kicker">CÓDIGO DA SALA</span><strong id="watch-code"></strong></div><div><span class="section-kicker">ESPECTADORES</span><strong id="viewer-count">—</strong></div><button class="button button-outline" id="audio-toggle">Ativar som</button><button class="button button-outline" id="copy-room">Copiar código</button></div><div id="notice" class="notice" role="status">${owner ? 'Compartilhe apenas o código; o link de captura dá permissão para transmitir.' : 'Clique em Ativar som para ouvir o áudio da transmissão.'}</div>`;
  setText('#watch-code', roomId);
  if (owner) {
    publishToken ||= (() => { try { return sessionStorage.getItem(`stage-owner-${roomId}`) || ''; } catch { return ''; } })();
    el<HTMLButtonElement>('#open-host').onclick = async () => {
      if (!publishToken) { setText('#notice', 'Abra uma nova sala para recuperar o link de transmissão.'); return; }
      if (!publicBaseUrl) {
        try {
          const response = await fetch('/api/config');
          if (response.ok) publicBaseUrl = (await response.json()).publicUrl || '';
        } catch { /* Show the configuration error below if needed. */ }
      }
      if (inDiscord && !publicBaseUrl) { setText('#notice', 'A URL pública de captura não está configurada.'); return; }
      await openHost(hostUrl());
    };
  }
  el<HTMLButtonElement>('#audio-toggle').onclick = async () => {
    if (audioEnabled) {
      audioEnabled = false;
      await playbackContext?.suspend();
      setText('#audio-toggle', 'Ativar som');
      return;
    }
    try {
      playbackContext ||= new AudioContext();
      await playbackContext.resume();
      audioEnabled = true;
      playbackAt = 0;
      setText('#audio-toggle', 'Desativar som');
      setText('#notice', 'Som ativado. O áudio depende da fonte escolhida por quem transmite.');
    } catch { setText('#notice', 'O navegador bloqueou o áudio. Tente clicar novamente em Ativar som.'); }
  };
  el<HTMLButtonElement>('#copy-room').onclick = async () => {
    try { await navigator.clipboard.writeText(roomId); setText('#notice', 'Código copiado.'); } catch { setText('#notice', 'Copie o código exibido acima.'); }
  };
  connectViewer();
}
function connectViewer() {
  if (!roomId) return;
  const viewerSocket = new WebSocket(wsUrl('watch'));
  socket = viewerSocket;
  viewerSocket.binaryType = 'blob';
  viewerSocket.onopen = () => startWebSocketKeepalive(viewerSocket);
  viewerSocket.onmessage = event => {
    if (typeof event.data === 'string') {
      const message = JSON.parse(event.data);
      if (message.type === 'state') {
        setText('#live-badge', message.live ? '● AO VIVO' : '○ AGUARDANDO');
        setText('#viewer-count', String(message.viewers));
        if (message.live && !message.audio) setText('#notice', 'Vídeo ao vivo. A fonte de captura ainda não forneceu áudio.');
        else if (message.live && !audioEnabled) setText('#notice', 'Áudio disponível. Clique em Ativar som para ouvir.');
        else if (message.live) setText('#notice', 'Vídeo e áudio ao vivo.');
        if (!message.live) clearFrame();
      }
    } else if (event.data instanceof Blob) void handleMediaPacket(event.data);
  };
  viewerSocket.onclose = () => {
    stopWebSocketKeepalive();
    if (unloading) return;
    setText('#live-badge', '○ RECONECTANDO');
    clearFrame();
    reconnectTimer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`);
        if (response.status === 404) { setText('#live-badge', '○ SALA ENCERRADA'); return; }
      } catch { /* Tentar novamente pelo WebSocket. */ }
      connectViewer();
    }, 3_000);
  };
}
async function handleMediaPacket(blob: Blob) {
  if (blob.size === 1284) {
    const packet = await blob.arrayBuffer();
    if (new DataView(packet).getUint32(0) === 0x53413031) { playAudioPacket(packet); return; }
  }
  if (lastFrameUrl) URL.revokeObjectURL(lastFrameUrl);
  lastFrameUrl = URL.createObjectURL(blob);
  el<HTMLImageElement>('#screen').src = lastFrameUrl;
  el<HTMLElement>('#player-empty').hidden = true;
  el<HTMLElement>('#player-live').hidden = false;
}
function playAudioPacket(packet: ArrayBuffer) {
  if (!audioEnabled || !playbackContext || packet.byteLength !== 1284) return;
  const view = new DataView(packet);
  if (view.getUint32(0) !== 0x53413031) return;
  const buffer = playbackContext.createBuffer(1, 640, 16000);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < 640; i++) samples[i] = view.getInt16(4 + i * 2, true) / 32768;
  const source = playbackContext.createBufferSource();
  source.buffer = buffer;
  source.connect(playbackContext.destination);
  const now = playbackContext.currentTime;
  if (playbackAt < now || playbackAt > now + 0.35) playbackAt = now + 0.08;
  source.start(playbackAt);
  playbackAt += buffer.duration;
}
function clearFrame() {
  el<HTMLElement>('#player-empty').hidden = false;
  el<HTMLElement>('#player-live').hidden = true;
  el<HTMLImageElement>('#screen').removeAttribute('src');
  if (lastFrameUrl) URL.revokeObjectURL(lastFrameUrl);
  lastFrameUrl = '';
}
function showHost() {
  el<HTMLElement>('#workspace').innerHTML = `
    <div class="workspace-head"><div><span class="section-kicker">ESTÚDIO DE TRANSMISSÃO</span><h2>Você no comando<span class="accent">.</span></h2></div><span class="live-pill" id="host-badge"><i></i> FORA DO AR</span></div>
    <div class="host-preview"><video id="preview" autoplay muted playsinline></video><div id="preview-empty"><span>▣</span><h3>Sua prévia aparece aqui</h3><p>Você escolhe exatamente o que será compartilhado.</p></div></div>
    <div class="host-controls"><div><span class="section-kicker">SALA</span><strong id="host-code"></strong></div><div><span class="section-kicker">ASSISTINDO</span><strong id="host-viewers">0</strong></div><button class="button button-primary" id="start">Compartilhar tela ↗</button><button class="button button-outline" id="stop" disabled>Parar transmissão</button></div>
    <div id="notice" class="notice" role="status"></div><div class="info-strip"><span class="info-icon">✳</span><p>Escolha uma aba, janela ou tela e marque a opção de compartilhar áudio quando o navegador oferecer. Som de jogo e de aplicativos depende do suporte do navegador à fonte escolhida.</p></div>`;
  setText('#host-code', roomId);
  el<HTMLButtonElement>('#start').onclick = startCapture;
  el<HTMLButtonElement>('#stop').onclick = stopCapture;
}
async function startCapture() {
  if (!roomId || !publishToken) { setText('#notice', 'Link de transmissão inválido.'); return; }
  if (!navigator.mediaDevices?.getDisplayMedia) { setText('#notice', 'Este navegador não permite captura de tela aqui. Abra o link em Chrome ou Edge via HTTPS.'); return; }
  try {
    const captureOptions = { video: { frameRate: 10 }, audio: true, systemAudio: 'include' as const };
    stream = await navigator.mediaDevices.getDisplayMedia(captureOptions);
    const video = el<HTMLVideoElement>('#preview');
    video.srcObject = stream;
    await video.play();
    stream.getVideoTracks()[0].addEventListener('ended', stopCapture, { once: true });
    const publisherSocket = new WebSocket(wsUrl('publish'));
    socket = publisherSocket;
    publisherSocket.onopen = () => {
      startWebSocketKeepalive(publisherSocket);
      setText('#host-badge', '● AO VIVO');
      el<HTMLElement>('#preview-empty').hidden = true;
      el<HTMLButtonElement>('#start').disabled = true;
      el<HTMLButtonElement>('#stop').disabled = false;
      setText('#notice', stream?.getAudioTracks().length ? 'Transmitindo vídeo e áudio da fonte selecionada.' : 'Transmitindo vídeo. A fonte selecionada não forneceu áudio; tente uma aba com Compartilhar áudio ativado.');
      timer = window.setInterval(sendFrame, 100);
      if (stream?.getAudioTracks().length) void startAudioCapture(stream, publisherSocket);
    };
    publisherSocket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.type === 'state') setText('#host-viewers', String(message.viewers));
    };
    publisherSocket.onclose = () => { stopWebSocketKeepalive(); if (socket === publisherSocket && stream) { stopCapture(); setText('#notice', 'Conexão encerrada. Tente iniciar novamente.'); } };
  } catch (error) {
    stopCapture();
    setText('#notice', error instanceof Error && error.name === 'NotAllowedError' ? 'Captura cancelada. Escolha uma fonte para começar.' : 'Não foi possível iniciar a captura.');
  }
}
async function startAudioCapture(capturedStream: MediaStream, publisherSocket: WebSocket) {
  try {
    const context = new AudioContext();
    captureAudioContext = context;
    await context.audioWorklet.addModule('/audio-capture-worklet.js');
    if (stream !== capturedStream) { await context.close(); return; }
    const source = context.createMediaStreamSource(capturedStream);
    const processor = new AudioWorkletNode(context, 'screen-audio-capture');
    processor.port.onmessage = event => {
      if (publisherSocket.readyState !== WebSocket.OPEN || publisherSocket.bufferedAmount > 512 * 1024) return;
      const pcm = new Uint8Array(event.data as ArrayBuffer);
      if (pcm.byteLength !== 1280) return;
      const packet = new Uint8Array(1284);
      packet.set([0x53, 0x41, 0x30, 0x31]);
      packet.set(pcm, 4);
      publisherSocket.send(packet);
    };
    source.connect(processor);
    processor.connect(context.destination);
    await context.resume();
  } catch {
    setText('#notice', 'Vídeo ativo, mas o navegador não iniciou a captura de áudio. Tente Chrome ou Edge atualizado.');
  }
}
function sendFrame() {
  if (rendering || socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > 1024 * 1024) return;
  const video = el<HTMLVideoElement>('#preview');
  if (!video.videoWidth || !video.videoHeight) return;
  rendering = true;
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 1280 / video.videoWidth, 720 / video.videoHeight);
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
  canvas.toBlob(async blob => {
    try { if (blob && socket?.readyState === WebSocket.OPEN) socket.send(await blob.arrayBuffer()); }
    finally { rendering = false; }
  }, 'image/jpeg', 0.68);
}
function stopCapture() {
  void captureAudioContext?.close().catch(() => {});
  captureAudioContext = null;
  stopWebSocketKeepalive();
  window.clearInterval(timer);
  timer = 0;
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  socket?.close();
  socket = null;
  const video = app.querySelector<HTMLVideoElement>('#preview');
  if (video) video.srcObject = null;
  if (app.querySelector('#host-badge')) {
    setText('#host-badge', '○ FORA DO AR');
    el<HTMLElement>('#preview-empty').hidden = false;
    el<HTMLButtonElement>('#start').disabled = false;
    el<HTMLButtonElement>('#stop').disabled = true;
  }
}

renderShell();
if (isHost) showHost();
else if (location.pathname === '/watch' && roomId) showWatch();
else showHome();
window.addEventListener('beforeunload', () => {
  unloading = true;
  window.clearInterval(roomKeepaliveTimer);
  window.clearTimeout(reconnectTimer);
  stopWebSocketKeepalive();
  if (stream) stopCapture();
  if (lastFrameUrl) URL.revokeObjectURL(lastFrameUrl);
  void playbackContext?.close();
});
