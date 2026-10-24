"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@poker/shared";
import { SERVER_URL, USE_MOCK } from "@/lib/lobby";
import { ConnectionState } from "@/lib/statusLog";

export type PokerSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface SocketContextValue {
  socket: PokerSocket | null; // null in mock mode, and for the first render
  connection: ConnectionState;
}

const SocketContext = createContext<SocketContextValue | null>(null);

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const socketRef = useRef<PokerSocket | null>(null);
  const [socket, setSocket] = useState<PokerSocket | null>(null);
  const [connection, setConnection] = useState<ConnectionState>(
    USE_MOCK ? "mock" : "connecting"
  );

  useEffect(() => {
    if (USE_MOCK) return;

    // Strict-mode guard: the Socket object is created once and kept in a ref.
    // React runs this effect, then its cleanup, then the effect again in dev.
    // The cleanup only disconnects and the second run reconnects the SAME
    // socket, so the server never sees two live connections.
        if (!socketRef.current) {
      const created: PokerSocket = io(SERVER_URL, {
        autoConnect: false,
        transports: ["websocket"],
      });
      socketRef.current = created;
    }
    const s = socketRef.current;
    setSocket(s);

    const onConnect = () => setConnection("connected");
    const onDisconnect = () => setConnection("disconnected");
    const onError = () => setConnection("disconnected");

    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    s.on("connect_error", onError);

    setConnection("connecting");
    s.connect();

    return () => {
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.off("connect_error", onError);
      s.disconnect();
    };
  }, []);

  const value = useMemo(() => ({ socket, connection }), [socket, connection]);
  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket(): SocketContextValue {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error("useSocket must be used inside <SocketProvider>");
  return ctx;
}