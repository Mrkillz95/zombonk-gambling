import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetLobbyQueryKey,
  getGetActiveLobbyQueryKey,
  getGetPlayerQueryKey,
} from "@workspace/api-client-react";

export interface LobbySocketState {
  connected: boolean;
}

/**
 * Opens a WebSocket to the realtime lobby hub and invalidates the relevant
 * react-query caches whenever the server broadcasts an update. Auto-reconnects
 * with backoff. The getLobby query also polls on an interval as a fallback in
 * case the socket is unavailable, so updates are never fully lost.
 */
export function useLobbySocket(
  lobbyId: number | null,
  playerId: number | null,
): LobbySocketState {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedRef = useRef(false);

  useEffect(() => {
    if (!lobbyId || !playerId) return;
    closedRef.current = false;
    let attempts = 0;

    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: getGetLobbyQueryKey(lobbyId) });
      queryClient.invalidateQueries({
        queryKey: getGetActiveLobbyQueryKey({ playerId }),
      });
      queryClient.invalidateQueries({ queryKey: getGetPlayerQueryKey(playerId) });
    };

    const connect = () => {
      if (closedRef.current) return;
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const url = `${proto}://${window.location.host}/api/lobby-ws?lobbyId=${lobbyId}&playerId=${playerId}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        attempts = 0;
        setConnected(true);
        invalidate();
      };

      ws.onmessage = () => {
        // Any server message (presence change, chat, transfer, round update)
        // means our cached lobby state is stale.
        invalidate();
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (closedRef.current) return;
        attempts += 1;
        const delay = Math.min(1000 * 2 ** attempts, 10_000);
        reconnectRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      closedRef.current = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
    };
  }, [lobbyId, playerId, queryClient]);

  return { connected };
}
