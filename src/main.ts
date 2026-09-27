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
let rendering = false;
let lastFrameUrl = '';

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
    showRoomCreated();
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
function showRoomCreated() {
  const hostUrl = new URL('/host', publicBaseUrl || location.href);
  hostUrl.searchParams.set('room', roomId);
  hostUrl.searchParams.set('token', publishToken);
  el<HTMLElement>('#workspace').innerHTML = `
    <div class="workspace-head"><div><span class="section-kicker">SALA CRIADA</span><h2>Pronto para entrar<span class="accent">.</span></h2></div><span class="live-pill"><i></i> AGUARDANDO TRANSMISSÃO</span></div>
    <div class="room-card"><span class="section-kicker">CÓDIGO PARA QUEM VAI ASSISTIR</span><div class="room-code" id="room-code"></div><p>Envie este código aos seus amigos. Eles podem entrar por este site ou pela Activity.</p><div class="room-actions"><button class="button button-outline" id="copy-code">Copiar código</button><button class="button button-primary" id="open-host">Abrir transmissão ↗</button></div></div>
    <div class="info-strip"><span class="info-icon">✳</span><p>O link de transmissão é privado: ele dá permissão para publicar na sala. Compartilhe apenas o <strong>código</strong> com espectadores.</p></div><div id="notice" class="notice" role="status"></div>`;
  setText('#room-code', roomId);
  el<HTMLButtonElement>('#copy-code').onclick = async () => {
    try { await navigator.clipboard.writeText(roomId); setText('#notice', 'Código copiado.'); }
    catch { setText('#notice', 'Selecione e copie o código acima.'); }
  };
  el<HTMLButtonElement>('#open-host').onclick = () => {
    if (inDiscord && !publicBaseUrl) { setText('#notice', 'A URL pública de captura não está configurada no servidor.'); return; }
    void openHost(hostUrl.href);
  };
}
function showWatch() {
  el<HTMLElement>('#workspace').innerHTML = `
    <div class="workspace-head"><div><span class="section-kicker">ASSISTINDO AGORA</span><h2>A sala ao vivo<span class="accent">.</span></h2></div><span class="live-pill" id="live-badge"><i></i> CONECTANDO</span></div>
    <div class="player"><img id="screen" alt="Tela compartilhada" /><div id="player-empty" class="player-empty"><span class="empty-icon">◉</span><h3>Aguardando a transmissão</h3><p>Quando alguém começar a compartilhar, a imagem aparece aqui.</p></div><span class="player-live" id="player-live">● AO VIVO</span></div>
    <div class="player-bottom"><div><span class="section-kicker">CÓDIGO DA SALA</span><strong id="watch-code"></strong></div><div><span class="section-kicker">ESPECTADORES</span><strong id="viewer-count">—</strong></div><button class="text-link" id="copy-room">Copiar código ↗</button></div><div id="notice" class="notice" role="status"></div>`;
  setText('#watch-code', roomId);
  el<HTMLButtonElement>('#copy-room').onclick = async () => {
    try { await navigator.clipboard.writeText(roomId); setText('#notice', 'Código copiado.'); } catch { setText('#notice', 'Copie o código exibido acima.'); }
  };
  connectViewer();
}
function connectViewer() {
  if (!roomId) return;
  socket = new WebSocket(wsUrl('watch'));
  socket.binaryType = 'blob';
  socket.onmessage = event => {
    if (typeof event.data === 'string') {
      const message = JSON.parse(event.data);
      if (message.type === 'state') {
        setText('#live-badge', message.live ? '● AO VIVO' : '○ AGUARDANDO');
        setText('#viewer-count', String(message.viewers));
        if (!message.live) clearFrame();
      }
    } else {
      if (lastFrameUrl) URL.revokeObjectURL(lastFrameUrl);
      lastFrameUrl = URL.createObjectURL(event.data);
      el<HTMLImageElement>('#screen').src = lastFrameUrl;
      el<HTMLElement>('#player-empty').hidden = true;
      el<HTMLElement>('#player-live').hidden = false;
    }
  };
  socket.onclose = () => { setText('#live-badge', '○ DESCONECTADO'); clearFrame(); };
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
    <div id="notice" class="notice" role="status"></div><div class="info-strip"><span class="info-icon">✳</span><p>Escolha uma aba, janela ou tela no seletor do navegador. A transmissão termina ao clicar em parar, fechar a aba ou usar o botão de compartilhamento do navegador.</p></div>`;
  setText('#host-code', roomId);
  el<HTMLButtonElement>('#start').onclick = startCapture;
  el<HTMLButtonElement>('#stop').onclick = stopCapture;
}
async function startCapture() {
  if (!roomId || !publishToken) { setText('#notice', 'Link de transmissão inválido.'); return; }
  if (!navigator.mediaDevices?.getDisplayMedia) { setText('#notice', 'Este navegador não permite captura de tela aqui. Abra o link em Chrome ou Edge via HTTPS.'); return; }
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 10 }, audio: false });
    const video = el<HTMLVideoElement>('#preview');
    video.srcObject = stream;
    await video.play();
    stream.getVideoTracks()[0].addEventListener('ended', stopCapture, { once: true });
    socket = new WebSocket(wsUrl('publish'));
    socket.onopen = () => {
      setText('#host-badge', '● AO VIVO');
      el<HTMLElement>('#preview-empty').hidden = true;
      el<HTMLButtonElement>('#start').disabled = true;
      el<HTMLButtonElement>('#stop').disabled = false;
      setText('#notice', 'Transmitindo. Compartilhe apenas o código da sala com os espectadores.');
      timer = window.setInterval(sendFrame, 100);
    };
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.type === 'state') setText('#host-viewers', String(message.viewers));
    };
    socket.onclose = () => { if (stream) { stopCapture(); setText('#notice', 'Conexão encerrada. Tente iniciar novamente.'); } };
  } catch (error) {
    stopCapture();
    setText('#notice', error instanceof Error && error.name === 'NotAllowedError' ? 'Captura cancelada. Escolha uma fonte para começar.' : 'Não foi possível iniciar a captura.');
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
window.addEventListener('beforeunload', () => { if (stream) stopCapture(); if (lastFrameUrl) URL.revokeObjectURL(lastFrameUrl); });
