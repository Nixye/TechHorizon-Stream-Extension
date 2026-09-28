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
let captureStarting = false;
let wsKeepaliveTimer = 0;
let reconnectTimer = 0;
let unloading = false;
let audioEnabled = false;
let owner = false;
let viewerPeer: RTCPeerConnection | null = null;
let earlyViewerCandidates: RTCIceCandidateInit[] = [];
const hostPeers = new Map<string, RTCPeerConnection>();
const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }];

type Signal = { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };

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
    <div class="player"><video id="screen" aria-label="Tela compartilhada" autoplay playsinline muted></video><div id="player-empty" class="player-empty"><span class="empty-icon">◉</span><h3>Aguardando a transmissão</h3><p>Quando alguém começar a compartilhar, a imagem aparece aqui.</p></div><span class="player-live" id="player-live" hidden>● AO VIVO</span><button class="focus-exit" id="focus-exit" type="button" aria-label="Sair do modo foco" hidden>Sair do foco ✕</button></div>
    <div class="player-bottom"><div><span class="section-kicker">CÓDIGO DA SALA</span><strong id="watch-code"></strong></div><div><span class="section-kicker">ESPECTADORES</span><strong id="viewer-count">—</strong></div><button class="button button-outline" id="audio-toggle">Ativar som</button><button class="button button-outline" id="copy-room">Copiar código</button><button class="button button-primary" id="focus-toggle" type="button">Modo foco ⛶</button></div><div id="notice" class="notice" role="status">${owner ? 'Compartilhe apenas o código; o link de captura dá permissão para transmitir.' : 'Clique em Ativar som para ouvir o áudio da transmissão.'}</div>`;
  setText('#watch-code', roomId);
  el<HTMLButtonElement>('#focus-toggle').onclick = () => setFocusMode(true);
  el<HTMLButtonElement>('#focus-exit').onclick = () => setFocusMode(false);
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
    const video = el<HTMLVideoElement>('#screen');
    if (audioEnabled) { audioEnabled = false; video.muted = true; setText('#audio-toggle', 'Ativar som'); return; }
    try {
      video.muted = false;
      await video.play();
      audioEnabled = true;
      setText('#audio-toggle', 'Desativar som');
      setText('#notice', 'Som ativado. O áudio depende da fonte escolhida por quem transmite.');
    } catch { video.muted = true; setText('#notice', 'O navegador bloqueou o áudio. Tente clicar novamente em Ativar som.'); }
  };
  el<HTMLButtonElement>('#copy-room').onclick = async () => {
    try { await navigator.clipboard.writeText(roomId); setText('#notice', 'Código copiado.'); } catch { setText('#notice', 'Copie o código exibido acima.'); }
  };
  connectViewer();
}
function setFocusMode(enabled: boolean) {
  document.body.classList.toggle('focus-mode', enabled);
  el<HTMLButtonElement>('#focus-exit').hidden = !enabled;
  if (enabled) el<HTMLButtonElement>('#focus-exit').focus();
  else el<HTMLButtonElement>('#focus-toggle').focus();
}
function connectViewer() {
  if (!roomId) return;
  const viewerSocket = new WebSocket(wsUrl('watch'));
  socket = viewerSocket;
  viewerSocket.onopen = () => startWebSocketKeepalive(viewerSocket);
  viewerSocket.onmessage = event => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'state') {
      setText('#live-badge', message.live ? '● AO VIVO' : '○ AGUARDANDO');
      setText('#viewer-count', String(message.viewers));
      if (message.live && !message.audio) setText('#notice', 'Vídeo ao vivo. A janela ou aba escolhida não forneceu áudio.');
      else if (message.live && !audioEnabled) setText('#notice', 'Áudio disponível. Clique em Ativar som para ouvir.');
      else if (message.live) setText('#notice', 'Vídeo e áudio ao vivo.');
      if (!message.live) clearViewerMedia();
    }
    if (message.type === 'signal') {
      if (message.signal?.candidate && !viewerPeer) { earlyViewerCandidates.push(message.signal.candidate); return; }
      viewerSignaling = viewerSignaling.then(() => receiveViewerSignal(message.signal, viewerSocket)).catch(() => {
        if (socket === viewerSocket) setText('#notice', 'Não foi possível estabelecer a conexão direta. Tente entrar novamente na sala.');
      });
    }
  };
  viewerSocket.onclose = () => {
    stopWebSocketKeepalive();
    if (unloading) return;
    setText('#live-badge', '○ RECONECTANDO');
    clearViewerMedia();
    earlyViewerCandidates = [];
    reconnectTimer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`);
        if (response.status === 404) { setText('#live-badge', '○ SALA ENCERRADA'); return; }
      } catch { /* Tentar novamente pelo WebSocket. */ }
      connectViewer();
    }, 3_000);
  };
}
let viewerSignaling = Promise.resolve();
const pendingCandidates = new WeakMap<RTCPeerConnection, RTCIceCandidateInit[]>();
function sendSignal(ws: WebSocket, signal: Signal, to?: string) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'signal', ...(to ? { to } : {}), signal }));
}
async function addRemoteSignal(pc: RTCPeerConnection, signal: Signal) {
  if (signal.description) {
    await pc.setRemoteDescription(signal.description);
    for (const candidate of pendingCandidates.get(pc) || []) await pc.addIceCandidate(candidate);
    pendingCandidates.delete(pc);
  } else if (signal.candidate) {
    if (pc.remoteDescription) await pc.addIceCandidate(signal.candidate);
    else pendingCandidates.set(pc, [...(pendingCandidates.get(pc) || []), signal.candidate]);
  }
}
async function receiveViewerSignal(signal: Signal, ws: WebSocket) {
  if (socket !== ws) return;
  if (signal.description?.type === 'offer') {
    clearViewerMedia();
    const pc = new RTCPeerConnection({ iceServers });
    viewerPeer = pc;
    pendingCandidates.set(pc, earlyViewerCandidates.splice(0));
    const remoteStream = new MediaStream();
    pc.ontrack = event => {
      remoteStream.addTrack(event.track);
      const video = el<HTMLVideoElement>('#screen');
      video.srcObject = remoteStream;
      video.muted = !audioEnabled;
      video.onplaying = () => {
        if (viewerPeer !== pc) return;
        el<HTMLElement>('#player-empty').hidden = true;
        el<HTMLElement>('#player-live').hidden = false;
      };
      void video.play().catch(() => setText('#notice', 'Clique em Ativar som para iniciar a reprodução.'));
    };
    pc.onicecandidate = event => { if (event.candidate) sendSignal(ws, { candidate: event.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => {
      if (viewerPeer === pc && ['failed', 'disconnected'].includes(pc.connectionState)) setText('#notice', 'Conexão direta interrompida. Confira a rede ou entre novamente na sala.');
    };
    await addRemoteSignal(pc, signal);
    await pc.setLocalDescription(await pc.createAnswer());
    if (pc.localDescription) sendSignal(ws, { description: pc.localDescription });
  } else if (viewerPeer) await addRemoteSignal(viewerPeer, signal);
}
function clearViewerMedia() {
  viewerPeer?.close();
  viewerPeer = null;
  const video = app.querySelector<HTMLVideoElement>('#screen');
  if (video) { video.onplaying = null; video.srcObject = null; }
  if (!app.querySelector('#player-empty')) return;
  el<HTMLElement>('#player-empty').hidden = false;
  el<HTMLElement>('#player-live').hidden = true;
}
function showHost() {
  el<HTMLElement>('#workspace').innerHTML = `
    <div class="workspace-head"><div><span class="section-kicker">ESTÚDIO DE TRANSMISSÃO</span><h2>Você no comando<span class="accent">.</span></h2></div><span class="live-pill" id="host-badge"><i></i> FORA DO AR</span></div>
    <div class="host-preview"><video id="preview" autoplay muted playsinline></video><div id="preview-empty"><span>▣</span><h3>Sua prévia aparece aqui</h3><p>Você escolhe exatamente o que será compartilhado.</p></div></div>
    <div class="host-controls"><div><span class="section-kicker">SALA</span><strong id="host-code"></strong></div><div><span class="section-kicker">ASSISTINDO</span><strong id="host-viewers">0</strong></div><button class="button button-primary" id="start">Compartilhar aplicativo ↗</button><button class="button button-outline" id="stop" disabled>Parar transmissão</button></div>
    <div id="notice" class="notice" role="status"></div><div class="info-strip"><span class="info-icon">✳</span><p>Escolha a aba ou janela do aplicativo e ative o áudio dessa fonte, se o navegador oferecer. A tela inteira é bloqueada para não transmitir o som de toda a máquina. Se a janela não oferecer áudio, tente compartilhar a aba do aplicativo.</p></div>`;
  setText('#host-code', roomId);
  el<HTMLButtonElement>('#start').onclick = startCapture;
  el<HTMLButtonElement>('#stop').onclick = stopCapture;
}
async function startCapture() {
  if (!roomId || !publishToken) { setText('#notice', 'Link de transmissão inválido.'); return; }
  if (!navigator.mediaDevices?.getDisplayMedia) { setText('#notice', 'Este navegador não permite captura de tela aqui. Abra o link em Chrome ou Edge via HTTPS.'); return; }
  if (captureStarting || stream) return;
  captureStarting = true;
  el<HTMLButtonElement>('#start').disabled = true;
  try {
    const captureOptions = { video: { frameRate: 30 }, audio: true, systemAudio: 'exclude', windowAudio: 'window', surfaceSwitching: 'exclude' } as DisplayMediaStreamOptions;
    const captured = await navigator.mediaDevices.getDisplayMedia(captureOptions);
    const surface = captured.getVideoTracks()[0]?.getSettings().displaySurface;
    if (surface !== 'window' && surface !== 'browser') {
      captured.getTracks().forEach(track => track.stop());
      setText('#notice', 'Selecione uma aba ou janela do aplicativo. Este navegador precisa identificar a fonte para evitar capturar áudio da máquina inteira.');
      return;
    }
    stream = captured;
    const video = el<HTMLVideoElement>('#preview');
    video.srcObject = stream;
    await video.play();
    stream.getVideoTracks()[0].addEventListener('ended', stopCapture, { once: true });
    for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'media', audio: false }));
      setText('#notice', 'O áudio da fonte escolhida terminou. Reinicie a captura para selecionar uma aba ou janela com áudio.');
    }, { once: true });
    const publisherSocket = new WebSocket(wsUrl('publish'));
    socket = publisherSocket;
    publisherSocket.onopen = () => {
      startWebSocketKeepalive(publisherSocket);
      publisherSocket.send(JSON.stringify({ type: 'media', audio: Boolean(stream?.getAudioTracks().length) }));
      setText('#host-badge', '● AO VIVO');
      el<HTMLElement>('#preview-empty').hidden = true;
      el<HTMLButtonElement>('#start').disabled = true;
      el<HTMLButtonElement>('#stop').disabled = false;
      setText('#notice', stream?.getAudioTracks().length ? 'Transmitindo vídeo e áudio da aba ou janela escolhida.' : 'Vídeo ativo, mas esta fonte não forneceu áudio. Escolha uma aba ou janela com Compartilhar áudio ativado.');
    };
    publisherSocket.onmessage = event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'state') setText('#host-viewers', String(message.viewers));
      if (message.type === 'viewers') for (const id of message.ids) void createHostPeer(id, publisherSocket);
      if (message.type === 'viewer-joined') void createHostPeer(message.id, publisherSocket);
      if (message.type === 'viewer-left') closeHostPeer(message.id);
      if (message.type === 'signal') {
        const pc = hostPeers.get(message.from);
        if (pc) void addRemoteSignal(pc, message.signal).catch(() => closeHostPeer(message.from));
      }
    };
    publisherSocket.onclose = () => { stopWebSocketKeepalive(); if (socket === publisherSocket && stream) { stopCapture(); setText('#notice', 'Conexão encerrada. Tente iniciar novamente.'); } };
  } catch (error) {
    stopCapture();
    setText('#notice', error instanceof Error && error.name === 'NotAllowedError' ? 'Captura cancelada. Escolha uma fonte para começar.' : 'Não foi possível iniciar a captura.');
  } finally {
    captureStarting = false;
    if (!stream) el<HTMLButtonElement>('#start').disabled = false;
  }
}
async function createHostPeer(id: string, ws: WebSocket) {
  if (hostPeers.has(id) || socket !== ws || !stream || typeof id !== 'string') return;
  const pc = new RTCPeerConnection({ iceServers });
  hostPeers.set(id, pc);
  for (const track of stream.getTracks()) pc.addTrack(track, stream);
  pc.onicecandidate = event => { if (event.candidate) sendSignal(ws, { candidate: event.candidate.toJSON() }, id); };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') {
      closeHostPeer(id);
      setText('#notice', 'Um espectador não conseguiu estabelecer conexão direta. Redes restritivas podem exigir um relay TURN.');
    }
  };
  try {
    await pc.setLocalDescription(await pc.createOffer());
    if (hostPeers.get(id) === pc && pc.localDescription) sendSignal(ws, { description: pc.localDescription }, id);
  } catch { closeHostPeer(id); }
}
function closeHostPeer(id: string) {
  hostPeers.get(id)?.close();
  hostPeers.delete(id);
}
function stopCapture() {
  stopWebSocketKeepalive();
  for (const id of hostPeers.keys()) closeHostPeer(id);
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
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.body.classList.contains('focus-mode')) {
    event.preventDefault();
    setFocusMode(false);
  }
});
window.addEventListener('beforeunload', () => {
  unloading = true;
  window.clearTimeout(reconnectTimer);
  stopWebSocketKeepalive();
  if (stream) stopCapture();
  clearViewerMedia();
});
