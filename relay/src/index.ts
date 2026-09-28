import { DurableObject } from 'cloudflare:workers';

type Peer = { role: 'publish' | 'watch'; id: string; subscribed?: string; mime?: string };
type Env = { ROOMS: DurableObjectNamespace<MediaRoom>; SITE_ORIGIN: string; DISCORD_APP_ID: string };
const ROOM_ID = /^[A-Za-z0-9_-]{16}$/;
const PEER_ID = /^[A-Za-z0-9_-]{22}$/;
const MAX_SEGMENT_BYTES = 2_000_000;

function allowedOrigin(origin: string | null, env: Env): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return url.origin === env.SITE_ORIGIN ||
      (url.protocol === 'https:' && url.hostname === `${env.DISCORD_APP_ID}.discordsays.com`);
  } catch { return false; }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ ok: true, service: 'vortex-relay' });
    if (url.pathname !== '/relay' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Not found', { status: 404 });
    if (!allowedOrigin(request.headers.get('Origin'), env)) return new Response('Origin not allowed', { status: 403 });
    const room = url.searchParams.get('room') || '';
    const id = url.searchParams.get('id') || '';
    const role = url.searchParams.get('role');
    if (!ROOM_ID.test(room) || !PEER_ID.test(id) || (role !== 'watch' && role !== 'publish')) return new Response('Invalid room connection', { status: 400 });
    const roomResponse = await fetch(`${env.SITE_ORIGIN}/api/rooms/${encodeURIComponent(room)}`, { headers: { Accept: 'application/json' } });
    if (!roomResponse.ok) return new Response('Room unavailable', { status: roomResponse.status === 404 ? 404 : 503 });
    return env.ROOMS.getByName(room).fetch(request);
  },
};

export class MediaRoom extends DurableObject<Env> {
  private latest = new Map<string, ArrayBuffer>();

  private peer(ws: WebSocket): Peer | null {
    const peer = ws.deserializeAttachment() as Peer | null;
    return peer && (peer.role === 'watch' || peer.role === 'publish') ? peer : null;
  }

  private sockets(role?: Peer['role']): WebSocket[] {
    return this.ctx.getWebSockets().filter(ws => !role || this.peer(ws)?.role === role);
  }

  private publisher(id: string): Peer | null {
    for (const ws of this.sockets('publish')) {
      const peer = this.peer(ws);
      if (peer?.id === id && peer.mime) return peer;
    }
    return null;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const role = url.searchParams.get('role') as Peer['role'];
    const id = url.searchParams.get('id')!;
    const limit = role === 'publish' ? 6 : 20;
    const current = this.sockets(role);
    if (current.length >= limit && !current.some(ws => this.peer(ws)?.id === id)) return new Response('Room full', { status: 429 });
    for (const ws of current) if (this.peer(ws)?.id === id) ws.close(4000, 'Reconnected');
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ role, id } satisfies Peer);
    server.send(JSON.stringify({ type: 'ready', id }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const peer = this.peer(ws);
    if (!peer) { ws.close(1008, 'Invalid connection'); return; }
    if (message instanceof ArrayBuffer) {
      if (peer.role !== 'publish' || !peer.mime || message.byteLength > MAX_SEGMENT_BYTES || message.byteLength === 0) { ws.close(1008, 'Invalid media'); return; }
      this.latest.set(peer.id, message);
      for (const viewer of this.sockets('watch')) if (this.peer(viewer)?.subscribed === peer.id) {
        try { viewer.send(message); } catch { /* The viewer will reconnect. */ }
      }
      return;
    }
    if (message.length > 512) { ws.close(1009, 'Message too large'); return; }
    let data: Record<string, unknown>;
    try { data = JSON.parse(message) as Record<string, unknown>; } catch { return; }
    if (peer.role === 'publish') {
      if (data.type === 'format' && typeof data.mime === 'string' && /^video\/webm;codecs=(vp8|vp9)(,opus)?$/.test(data.mime)) {
        peer.mime = data.mime;
        ws.serializeAttachment(peer);
        for (const viewer of this.sockets('watch')) if (this.peer(viewer)?.subscribed === peer.id) viewer.send(JSON.stringify({ type: 'format', id: peer.id, mime: peer.mime }));
      }
      return;
    }
    if (data.type === 'subscribe' && typeof data.id === 'string' && PEER_ID.test(data.id)) {
      peer.subscribed = data.id;
      ws.serializeAttachment(peer);
      const publisher = this.publisher(data.id);
      if (publisher?.mime) {
        ws.send(JSON.stringify({ type: 'format', id: data.id, mime: publisher.mime }));
        const latest = this.latest.get(data.id);
        if (latest) ws.send(latest);
      } else ws.send(JSON.stringify({ type: 'waiting', id: data.id }));
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    const peer = this.peer(ws);
    if (peer?.role === 'publish') {
      this.latest.delete(peer.id);
      for (const viewer of this.sockets('watch')) if (this.peer(viewer)?.subscribed === peer.id) viewer.send(JSON.stringify({ type: 'offline', id: peer.id }));
    }
    ws.close(code, reason);
  }
}
