// SPEC-2.2 §7 C2 tests: `street` log entries.
import { describe, it, expect } from "vitest";
import { startHand } from "@poker/shared";
import type { GameState, MessageType, Seat } from "@poker/shared";
import { openDb, type Db } from "./db";
import { addPlayer, createGame, getEvents, getPlayer, loadGame, saveState, setDeposited } from "./store";
import { ingest, type IngestDeps } from "./ingest";
import { afterChange } from "./lifecycle";
import { reconnect } from "./reconnect";
import { TURN_MS, fireDueTimers } from "./timers";
import { streetsEntered } from "./streetLog";

const T = "1";
const wallet = (i: number) => "0x" + String(i + 1).repeat(40);
const key = (i: number) => "0x" + String(i + 5).repeat(40);
const deps: IngestDeps = { verifySig: e => e.sig === "0xok", verifyCheckpointSig: () => true };
const L = { randomDeck: () => Array.from({ length: 52 }, (_, i) => i) };

function table(db: Db) {
  createGame(db, { tableId: T, creator: wallet(0), buyInWei: 1_000_000_000_000_000n, totalHands: 3 });
  for (let i = 0; i < 4; i++) addPlayer(db, { tableId: T, seat: i as Seat, wallet: wallet(i), sessionKey: key(i) });
  for (let i = 0; i < 4; i++) setDeposited(db, T, i);
}
const state = (db: Db) => loadGame(db, T)!.state;
const mk = (db: Db, seat: number, type: MessageType, payload: unknown, handNumber: number) => ({
  tableId: T, handNumber, seq: getPlayer(db, T, seat)!.lastSeq + 1, sender: wallet(seat), seat, type, payload, sig: "0xok",
});
function send(db: Db, seat: number, type: MessageType, payload: unknown, handNumber: number) {
  const r = ingest(db, deps, mk(db, seat, type, payload, handNumber));
  if (!r.ok) throw new Error(`${type} from seat ${seat} rejected: ${r.reject.code} ${r.reject.message}`);
  afterChange(db, T, L);
}
const bet = (db: Db, seat: number, action: string) => send(db, seat, "bet_action", { action }, state(db).handNumber);
/** Hand 1 is dealt: dealer 1, small blind 2, big blind 3, seat 0 acts first. */
function startedTable(db: Db) {
  table(db);
  for (let i = 0; i < 4; i++) send(db, i, "ready", { ready: true }, 0);
  expect(state(db).tableState).toBe("betting");
}
const streetEntries = (db: Db) =>
  getEvents(db, T).filter(e => e.kind === "server" && (e.body as { kind: string }).kind === "street");
const streetNames = (db: Db) => streetEntries(db).map(e => (e.body as { street: string }).street);

describe("street log entries (SPEC-2.2 §4)", () => {
  it("(a) a preflop round that closes writes exactly one `flop` entry", () => {
    const db = openDb(); startedTable(db);
    bet(db, 0, "call"); bet(db, 1, "call"); bet(db, 2, "call");
    expect(streetNames(db)).toEqual([]);   // big blind still has the option
    bet(db, 3, "check");
    expect(state(db).street).toBe("flop");
    expect(streetNames(db)).toEqual(["flop"]);
    const e = streetEntries(db)[0];
    expect(e.handNumber).toBe(1);
    expect(e.body).toEqual({ kind: "street", handNumber: 1, street: "flop" });
  });

  it("(b) everyone all-in preflop writes flop, turn, river in order with increasing indexes", () => {
    const db = openDb(); startedTable(db);
    for (const seat of [0, 1, 2, 3]) bet(db, seat, "allin");
    expect(streetNames(db)).toEqual(["flop", "turn", "river"]);
    const idx = streetEntries(db).map(e => e.index);
    expect(idx[0]).toBeLessThan(idx[1]);
    expect(idx[1]).toBeLessThan(idx[2]);
    // the last envelope comes before the streets it caused
    const lastEnvelope = getEvents(db, T).filter(e => e.kind === "envelope").at(-1)!.index;
    expect(idx[0]).toBeGreaterThan(lastEnvelope);
    expect(streetNames(db).filter(s => s === "showdown" || s === "preflop")).toEqual([]);
  });

  it("(c) a hand that ends by folding writes no `street` entry", () => {
    const db = openDb(); startedTable(db);
    bet(db, 0, "fold"); bet(db, 1, "fold"); bet(db, 2, "fold");
    expect(state(db).tableState).toBe("settlement");
    expect(streetEntries(db)).toHaveLength(0);
  });

  it("(d) buildView().events after a reconnect contains them", () => {
    const db = openDb(); startedTable(db);
    bet(db, 0, "call"); bet(db, 1, "call"); bet(db, 2, "call"); bet(db, 3, "check");
    const r = reconnect(db, deps, mk(db, 0, "join", { sessionKey: key(0) }, 0));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const streets = r.view.events.filter(e => e.kind === "server" && (e.body as { kind: string }).kind === "street");
    expect(streets.map(e => (e.body as { street: string }).street)).toEqual(["flop"]);
  });

  it("(e) no entry body contains a card or the deck", () => {
    const db = openDb(); startedTable(db);
    for (const seat of [0, 1, 2, 3]) bet(db, seat, "allin");
    for (const e of streetEntries(db)) {
      expect(Object.keys(e.body as object).sort()).toEqual(["handNumber", "kind", "street"]);
    }
    const json = JSON.stringify(streetEntries(db));
    for (const word of ["holeCards", "deck", "board", "cards"]) expect(json).not.toContain(word);
  });

  it("an auto-check that closes the round also writes the `flop` entry (timers.ts)", () => {
    const db = openDb(); startedTable(db);
    bet(db, 0, "call"); bet(db, 1, "call"); bet(db, 2, "call"); // seat 3 (big blind) can check, but does not
    expect(streetNames(db)).toEqual([]);
    const fired = fireDueTimers(db, Date.now() + TURN_MS + 1000);
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ kind: "auto", action: "check" });
    expect(streetNames(db)).toEqual(["flop"]);
    const ev = getEvents(db, T);
    const autoIdx = ev.find(e => (e.body as { kind: string }).kind === "auto")!.index;
    expect(streetEntries(db)[0].index).toBeGreaterThan(autoIdx);
  });

  it("the lifecycle run-out (betting closed, nobody to act) logs every street too", () => {
    const db = openDb(); startedTable(db);
    const s = structuredClone(state(db)) as GameState;
    // Everyone all-in with nobody to act: the case lifecycle.ts handles with advanceStreet().
    s.seats.forEach(p => { p.isAllIn = true; p.committedThisHand += p.chips; p.chips = 0; });
    s.toActSeat = null;
    saveState(db, T, s);
    afterChange(db, T, L);
    expect(streetNames(db)).toEqual(["flop", "turn", "river"]);
  });
});

describe("streetsEntered()", () => {
  const at = (street: GameState["street"], handNumber = 1) => ({ street, handNumber }) as GameState;
  it("lists every street passed, never preflop or showdown", () => {
    expect(streetsEntered(at("preflop"), at("flop"))).toEqual(["flop"]);
    expect(streetsEntered(at("flop"), at("turn"))).toEqual(["turn"]);
    expect(streetsEntered(at("preflop"), at("showdown"))).toEqual(["flop", "turn", "river"]);
    expect(streetsEntered(at("turn"), at("showdown"))).toEqual(["river"]);
    expect(streetsEntered(at("river"), at("showdown"))).toEqual([]);
  });
  it("is empty when nothing moved, or the hand number changed", () => {
    expect(streetsEntered(at("flop"), at("flop"))).toEqual([]);
    expect(streetsEntered(at("river"), at("preflop", 2))).toEqual([]);
  });
});