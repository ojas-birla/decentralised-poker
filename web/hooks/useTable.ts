"use client";

// D5: the table session (SPEC-2.1 section 8, D5). One hook per table page.
// - finds my seat, loads my session key (never creates one here)
// - emits `hello` on every socket (re)connect, retries BAD_SEAT with backoff 1/2/4... up to 30 s
// - keeps {state, events, timer, players} from the 6 server events, dropping stale indexes
// - send(): signs with the session key, ONE envelope in flight, seq +1 only on ok,
//   BAD_SEQ/DUPLICATE -> adopt reject.nextSeq and resend once
import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserProvider, Contract, type Wallet } from "ethers";
import type {
  AbortMsg,
  EnvelopeAck,
  EventMsg,
  EventRow,
  GameState,
  HelloAck,
  MessageType,
  PlayerPresence,
  PresenceMsg,
  Seat,
  StateMsg,
  TimerInfo,
  TimerMsg,
} from "@poker/shared";
import { signEnvelope } from "@poker/shared/envelope";
import { POKER_ABI, POKER_ADDRESS } from "@poker/shared/contract";
import { useSocket } from "@/components/SocketProvider";
import { useWallet } from "@/components/WalletProvider";
import { SERVER_URL } from "@/lib/lobby";
import { getEthereum } from "@/lib/chain";
import { loadSessionKey } from "@/lib/sessionKey";

export type TablePhase =
  | "no_wallet" // wallet not connected
  | "locating" // finding my seat
  | "connecting" // socket not connected yet
  | "joining" // hello sent, waiting for the ack
  | "waiting_seat" // server does not know my seat yet (chain watcher lag), retrying
  | "live"
  | "reconnecting"
  | "error";

export interface SendOptions {
  handNumber?: number; // default: 0 for join/ready, otherwise the current hand
}
export type SendFn = (
  type: MessageType,
  payload: unknown,
  opts?: SendOptions
) => Promise<EnvelopeAck>;

export interface TableSession {
  phase: TablePhase;
  error: string | null;
  mySeat: Seat | null;
  state: GameState | null; // per-seat publicState from the server
  lastIndex: number; // highest log index held (-1 = none)
  timer: TimerInfo | null;
  players: PlayerPresence[];
  events: EventRow[];
  abort: AbortMsg | null;
  pending: boolean; // an envelope is in flight (disable the action buttons)
  send: SendFn;
}

const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];
const ACK_TIMEOUT_MS = 10000;

// My seat: GET /api/tables/:id (exists after C6), else read the chain (players[i] = seat i).
async function findMySeat(tableId: string, wallet: string): Promise<Seat | null> {
  try {
    const res = await fetch(`${SERVER_URL}/api/tables/${tableId}`, { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { seats?: { seat: number; wallet: string }[] };
      const mine = data.seats?.find((s) => s.wallet.toLowerCase() === wallet);
      if (mine) return mine.seat as Seat;
    }
  } catch {
    /* server unreachable or no such route yet: fall back to the chain */
  }
  const eth = getEthereum();
  if (!eth) return null;
  const contract = new Contract(POKER_ADDRESS, POKER_ABI, new BrowserProvider(eth));
  const t = await contract.getTable(BigInt(tableId));
  const idx = (t.players as string[]).findIndex((p) => p.toLowerCase() === wallet);
  return idx >= 0 ? (idx as Seat) : null;
}

export function useTable(tableId: string): TableSession {
  const { socket } = useSocket();
  const { address } = useWallet();

  const [phase, setPhase] = useState<TablePhase>("locating");
  const [error, setError] = useState<string | null>(null);
  const [mySeat, setMySeat] = useState<Seat | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [timer, setTimer] = useState<TimerInfo | null>(null);
  const [players, setPlayers] = useState<PlayerPresence[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [lastIndex, setLastIndex] = useState(-1);
  const [abort, setAbort] = useState<AbortMsg | null>(null);
  const [pending, setPending] = useState(0);

  const seqRef = useRef(1);
  const stateIndexRef = useRef(-1);
  const eventIndexRef = useRef(-1);
  const stateRef = useRef<GameState | null>(null);
  const skRef = useRef<Wallet | null>(null);
  const seatRef = useRef<Seat | null>(null);
  const walletRef = useRef<string | null>(null);
  const joinedRef = useRef(false);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    // fresh start for this (socket, wallet, table)
    seqRef.current = 1;
    stateIndexRef.current = -1;
    eventIndexRef.current = -1;
    stateRef.current = null;
    seatRef.current = null;
    joinedRef.current = false;
    setState(null);
    setTimer(null);
    setPlayers([]);
    setEvents([]);
    setLastIndex(-1);
    setAbort(null);
    setError(null);
    setMySeat(null);

    if (!address) {
      setPhase("no_wallet");
      return;
    }
    if (!socket) {
      setPhase("connecting"); // mock mode or first render
      return;
    }
    const sk = loadSessionKey(address, tableId);
    if (!sk) {
      setError(
        "No session key for this table in this browser. Join the table from the lobby with this wallet first."
      );
      setPhase("error");
      return;
    }

    const sock = socket;
    const wallet = address;
    skRef.current = sk;
    walletRef.current = wallet;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;
    let gen = 0;
    const cleanups: Array<() => void> = [];

    setPhase("locating");

    findMySeat(tableId, wallet)
      .then((seat) => {
        if (cancelled) return;
        if (seat === null) {
          setError("Your wallet is not seated at this table.");
          setPhase("error");
          return;
        }
        seatRef.current = seat;
        setMySeat(seat);

        const scheduleRetry = () => {
          if (cancelled) return;
          const delay = BACKOFF_MS[Math.min(retryCount, BACKOFF_MS.length - 1)];
          retryCount += 1;
          retryTimer = setTimeout(() => hello(false), delay);
        };

        const hello = (seqRetried: boolean) => {
          if (cancelled || !sock.connected) return; // the "connect" event will call us
          const myGen = ++gen;
          if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = null;
          }
          setPhase("joining");
          const joinEnvelope = signEnvelope(sk.privateKey, {
            tableId,
            handNumber: 0,
            seq: seqRef.current,
            sender: wallet,
            seat,
            type: "join",
            payload: { sessionKey: sk.address.toLowerCase() },
          });
          sock
            .timeout(ACK_TIMEOUT_MS)
            .emit(
              "hello",
              { joinEnvelope, fromIndex: eventIndexRef.current + 1 },
              (err: Error | null, ack: HelloAck) => {
                if (cancelled || myGen !== gen) return;
                if (err || !ack) {
                  scheduleRetry();
                  return;
                }
                if (ack.ok) {
                  retryCount = 0;
                  joinedRef.current = true;
                  const v = ack.view;
                  seqRef.current = v.nextSeq; // rule 3: after every hello
                  if (v.lastIndex >= stateIndexRef.current) {
                    stateIndexRef.current = v.lastIndex;
                    stateRef.current = v.state;
                    setState(v.state);
                  }
                  const fresh = v.events.filter((e) => e.index > eventIndexRef.current);
                  if (fresh.length > 0) {
                    eventIndexRef.current = fresh[fresh.length - 1].index;
                    setEvents((prev) => [...prev, ...fresh]);
                  }
                  setLastIndex(eventIndexRef.current);
                  setPlayers(v.players);
                  setTimer(v.timer);
                  setError(null);
                  setPhase("live");
                  return;
                }
                const r = ack.reject;
                if (r.code === "BAD_SEAT") {
                  setPhase("waiting_seat"); // chain watcher has not seen my seat yet
                  scheduleRetry();
                  return;
                }
                if (
                  (r.code === "BAD_SEQ" || r.code === "DUPLICATE") &&
                  r.nextSeq !== undefined &&
                  !seqRetried
                ) {
                  seqRef.current = r.nextSeq;
                  hello(true);
                  return;
                }
                setError(`${r.code}: ${r.message}`);
                setPhase("error");
              }
            );
        };

        const onConnect = () => hello(false);
        const onDisconnect = () => {
          gen += 1; // ignore any hello ack still in flight
          joinedRef.current = false;
          if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = null;
          }
          setPhase("reconnecting");
        };
        const onState = (m: StateMsg) => {
          if (m.tableId !== tableId || m.index < stateIndexRef.current) return;
          stateIndexRef.current = m.index;
          stateRef.current = m.state;
          setState(m.state);
        };
        const onEvent = (m: EventMsg) => {
          if (m.tableId !== tableId || m.entry.index <= eventIndexRef.current) return;
          eventIndexRef.current = m.entry.index;
          setLastIndex(m.entry.index);
          setEvents((prev) => [...prev, m.entry]);
        };
        const onTimer = (m: TimerMsg) => {
          if (m.tableId !== tableId) return;
          setTimer(m.seat === null || m.deadline === null ? null : { seat: m.seat, deadline: m.deadline });
        };
        const onPresence = (m: PresenceMsg) => {
          if (m.tableId !== tableId) return;
          setPlayers((prev) =>
            prev.map((p) => (p.seat === m.seat ? { ...p, connected: m.connected } : p))
          );
        };
        const onAbort = (m: AbortMsg) => {
          if (m.tableId === tableId) setAbort(m);
        };
        // "auto" needs no handler: the server follows it with an `event` and a `state`,
        // and the log entry (kind "auto") is what the status log shows.

        sock.on("connect", onConnect);
        sock.on("disconnect", onDisconnect);
        sock.on("state", onState);
        sock.on("event", onEvent);
        sock.on("timer", onTimer);
        sock.on("presence", onPresence);
        sock.on("abort", onAbort);
        cleanups.push(() => {
          sock.off("connect", onConnect);
          sock.off("disconnect", onDisconnect);
          sock.off("state", onState);
          sock.off("event", onEvent);
          sock.off("timer", onTimer);
          sock.off("presence", onPresence);
          sock.off("abort", onAbort);
        });

        if (sock.connected) hello(false);
        else setPhase("connecting");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError((e as Error)?.message || "Could not find your seat at this table.");
        setPhase("error");
      });

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      cleanups.forEach((f) => f());
    };
  }, [socket, address, tableId]);

  const send = useCallback<SendFn>(
    (type, payload, opts) => {
      const notReady = (message: string): EnvelopeAck => ({
        ok: false,
        reject: { refSeq: seqRef.current, code: "WRONG_STATE", message },
      });

      const sendOnce = async (): Promise<EnvelopeAck> => {
        const sk = skRef.current;
        const seat = seatRef.current;
        const wallet = walletRef.current;
        if (!socket || !sk || seat === null || !wallet || !joinedRef.current) {
          return notReady("Not connected to the table yet.");
        }
        const handNumber =
          opts?.handNumber ??
          (type === "join" || type === "ready" ? 0 : stateRef.current?.handNumber ?? 0);

        for (let attempt = 0; attempt < 2; attempt++) {
          if (!socket.connected) return notReady("Connection lost. Reconnecting…");
          const env = signEnvelope(sk.privateKey, {
            tableId,
            handNumber,
            seq: seqRef.current,
            sender: wallet,
            seat,
            type,
            payload,
          });
          const ack = await new Promise<EnvelopeAck>((resolve) => {
            socket
              .timeout(ACK_TIMEOUT_MS)
              .emit("envelope", env, (err: Error | null, a: EnvelopeAck) =>
                resolve(err || !a ? notReady("The server did not answer in time.") : a)
              );
          });
          if (ack.ok) {
            seqRef.current += 1; // rule 2: only on ok
            return ack;
          }
          const r = ack.reject;
          if (
            attempt === 0 &&
            (r.code === "BAD_SEQ" || r.code === "DUPLICATE") &&
            r.nextSeq !== undefined
          ) {
            seqRef.current = r.nextSeq; // rule 4: adopt and resend once
            continue;
          }
          return ack;
        }
        return notReady("Could not send.");
      };

      // rule 1: one envelope in flight, everything else waits in line
      const run = () => sendOnce();
      const p = queueRef.current.then(run, run);
      queueRef.current = p.catch(() => undefined);
      setPending((n) => n + 1);
      return p.finally(() => setPending((n) => n - 1));
    },
    [socket, tableId]
  );

  return {
    phase,
    error,
    mySeat,
    state,
    lastIndex,
    timer,
    players,
    events,
    abort,
    pending: pending > 0,
    send,
  };
}