import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { logger } from "./logger.js";

/**
 * Realtime hub for multiplayer lobbies.
 *
 * Transport is push-only: clients open a WebSocket to receive lobby events
 * (presence, chat, transfers, round lifecycle). All mutations still go through
 * the validated REST endpoints; this hub only fans out notifications so peers
 * can refetch / react live. Clients also poll as a fallback, so a dropped
 * socket degrades gracefully rather than freezing the room.
 */

export const LOBBY_WS_PATH = "/api/lobby-ws";

interface LobbyConn {
  ws: WebSocket;
  lobbyId: number;
  playerId: number;
  alive: boolean;
}

export interface LobbyEvent {
  type:
    | "presence"
    | "member_joined"
    | "member_left"
    | "chat"
    | "transfer"
    | "round_started"
    | "round_resolved"
    | "lobby_closed";
  lobbyId: number;
  [key: string]: unknown;
}

// lobbyId -> set of live connections
const lobbies = new Map<number, Set<LobbyConn>>();

let wss: WebSocketServer | null = null;
let heartbeat: NodeJS.Timeout | null = null;

function parseConnParams(url: string | undefined): {
  lobbyId: number;
  playerId: number;
} | null {
  if (!url) return null;
  // url is like /api/lobby-ws?lobbyId=1&playerId=2
  const q = url.indexOf("?");
  if (q === -1) return null;
  const params = new URLSearchParams(url.slice(q + 1));
  const lobbyId = Number(params.get("lobbyId"));
  const playerId = Number(params.get("playerId"));
  if (!Number.isInteger(lobbyId) || lobbyId <= 0) return null;
  if (!Number.isInteger(playerId) || playerId <= 0) return null;
  return { lobbyId, playerId };
}

function onlineIds(lobbyId: number): number[] {
  const set = lobbies.get(lobbyId);
  if (!set) return [];
  return [...new Set([...set].map((c) => c.playerId))];
}

/** Player ids currently connected to a lobby (used to mark presence in state). */
export function getOnlinePlayerIds(lobbyId: number): number[] {
  return onlineIds(lobbyId);
}

/** Send an event to every live connection in a lobby. */
export function broadcastToLobby(lobbyId: number, event: LobbyEvent): void {
  const set = lobbies.get(lobbyId);
  if (!set || set.size === 0) return;
  const payload = JSON.stringify(event);
  for (const conn of set) {
    if (conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(payload);
    }
  }
}

function broadcastPresence(lobbyId: number): void {
  broadcastToLobby(lobbyId, {
    type: "presence",
    lobbyId,
    online: onlineIds(lobbyId),
  });
}

function removeConn(conn: LobbyConn): void {
  const set = lobbies.get(conn.lobbyId);
  if (!set) return;
  set.delete(conn);
  if (set.size === 0) {
    lobbies.delete(conn.lobbyId);
  } else {
    broadcastPresence(conn.lobbyId);
  }
}

/**
 * Attach the lobby WebSocket server to an existing HTTP server. Uses noServer
 * mode so only upgrade requests on LOBBY_WS_PATH are handled, leaving the rest
 * of the HTTP/Express stack untouched.
 */
export function attachRealtime(server: import("node:http").Server): void {
  if (wss) return;
  wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    let pathname = "";
    try {
      pathname = new URL(req.url ?? "", "http://localhost").pathname;
    } catch {
      pathname = "";
    }
    if (pathname !== LOBBY_WS_PATH) {
      return; // not ours; leave for any other upgrade handler
    }

    const params = parseConnParams(req.url);
    if (!params) {
      socket.destroy();
      return;
    }

    wss!.handleUpgrade(req, socket, head, (ws) => {
      const conn: LobbyConn = {
        ws,
        lobbyId: params.lobbyId,
        playerId: params.playerId,
        alive: true,
      };

      let set = lobbies.get(params.lobbyId);
      if (!set) {
        set = new Set();
        lobbies.set(params.lobbyId, set);
      }
      set.add(conn);

      ws.on("pong", () => {
        conn.alive = true;
      });
      ws.on("close", () => removeConn(conn));
      ws.on("error", () => removeConn(conn));

      // Greet the new connection with the current presence list, and tell the
      // room someone is online now.
      ws.send(
        JSON.stringify({
          type: "presence",
          lobbyId: params.lobbyId,
          online: onlineIds(params.lobbyId),
        } satisfies LobbyEvent),
      );
      broadcastPresence(params.lobbyId);
    });
  });

  // Heartbeat: drop sockets that stopped responding to pings.
  heartbeat = setInterval(() => {
    for (const set of lobbies.values()) {
      for (const conn of set) {
        if (!conn.alive) {
          conn.ws.terminate();
          removeConn(conn);
          continue;
        }
        conn.alive = false;
        try {
          conn.ws.ping();
        } catch {
          removeConn(conn);
        }
      }
    }
  }, 30_000);

  wss.on("close", () => {
    if (heartbeat) clearInterval(heartbeat);
  });

  logger.info({ path: LOBBY_WS_PATH }, "Lobby realtime hub attached");
}
