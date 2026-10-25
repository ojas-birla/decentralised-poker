// shared/crypto/dealingView.ts
// Pure functions: rebuild the dealing state of ONE hand from the ordered event log, and say what
// this player owes next. No React, no sockets, no randomness. Clients, bots and tests all use it.
//
// Chain rule (SPEC §2): unlocks of one card go in ascending seat order, each taking the previous
// output. Hole card of seat X: the other active seats, then X privately. Board card: all active seats.
import { unlockCard, from32Hex, to32Hex, type Padlock } from "./padlock";
import { verifyReveal } from "./verify";
import { CARD_POINTS, cardIndexFromPoint } from "./cards";
import { holeCardIndices, BOARD_INDICES } from "../engine/cards";

// Minimal structural types, so this file needs nothing from protocol.ts / types.ts.
// Any real EventRow from the server fits these.
export interface DealingEnvelope {
  seat: number;
  type: string;
  payload: unknown;
}
export interface DealingEventRow {
  index?: number;
  kind: "envelope" | "server";
  handNumber: number;
  body: unknown;
}
type EventRow = DealingEventRow;
type Envelope = DealingEnvelope;

export type Seat = 0 | 1 | 2 | 3;
export type ForSeat = Seat | "board";

export interface UnlockChain { forSeat: ForSeat; chain: { seat: number; value: string }[] }

export interface DealingView {
  commitments: Record<number, string>;   // seat -> commitment
  shuffleSteps: number;                  // accepted shuffle steps so far
  deck: string[] | null;                 // deck after the latest accepted step (null before the first)
  shuffleDone: boolean;
  unlocks: Record<number, UnlockChain>;  // deck position -> accepted unlock chain
  reveals: Record<number, string>;       // seat -> revealed padlock hex
}

const HEX64 = /^[0-9a-f]{64}$/;
const norm = (h: unknown): string | null => {
  if (typeof h !== "string") return null;
  const s = (h.startsWith("0x") ? h.slice(2) : h).toLowerCase();
  return HEX64.test(s) ? s : null;
};

/** Who sees deck position `i` this hand? A seat, "board", or null if the position is not dealt (13..51). */
export function expectedForSeat(i: number, dealer: Seat, activeSeats: readonly number[]): ForSeat | null {
  for (const s of activeSeats) if (holeCardIndices(s as Seat, dealer).includes(i)) return s as Seat;
  const board = [...BOARD_INDICES.flop, ...BOARD_INDICES.turn, ...BOARD_INDICES.river];
  return board.includes(i) ? "board" : null;
}

/** Seats that must unlock this card, in order. */
export function unlockOrder(forSeat: ForSeat, activeSeats: readonly number[]): number[] {
  return [...activeSeats].sort((a, b) => a - b).filter((s) => s !== forSeat);
}

export function deriveDealing(
  events: readonly EventRow[],
  hand: number,
  activeSeats: readonly number[],
  dealer: Seat,
): DealingView {
  const order = [...activeSeats].sort((a, b) => a - b);
  const v: DealingView = { commitments: {}, shuffleSteps: 0, deck: null, shuffleDone: false, unlocks: {}, reveals: {} };

  for (const row of events) {
    if (row.kind !== "envelope" || row.handNumber !== hand) continue;
    const env = row.body as Envelope;
    const seat = env.seat;
    if (!order.includes(seat)) continue;
    const p = env.payload as any;

    switch (env.type) {
      case "commit_padlock": {
        const c = typeof p?.commitment === "string" ? p.commitment.toLowerCase() : null;
        if (c && v.commitments[seat] === undefined) v.commitments[seat] = c;
        break;
      }
      case "shuffle_step": {
        const allCommitted = order.every((s) => v.commitments[s] !== undefined);
        if (!allCommitted || v.shuffleDone) break;
        if (p?.step !== v.shuffleSteps || order[v.shuffleSteps] !== seat) break;
        if (!Array.isArray(p.deck) || p.deck.length !== 52) break;
        const deck = p.deck.map(norm);
        if (deck.some((d: string | null) => d === null)) break;
        v.deck = deck as string[];
        v.shuffleSteps += 1;
        if (v.shuffleSteps === order.length) v.shuffleDone = true;
        break;
      }
      case "unlock_card": {
        if (!v.shuffleDone) break;
        const i = p?.cardIndex;
        if (!Number.isInteger(i)) break;
        const forSeat = expectedForSeat(i, dealer, order);
        if (forSeat === null || p.forSeat !== forSeat) break;
        const required = unlockOrder(forSeat, order);
        const entry = v.unlocks[i] ?? { forSeat, chain: [] };
        if (entry.chain.length >= required.length) break;
        if (required[entry.chain.length] !== seat) break;           // wrong sender or out of order
        const value = norm(p.value);
        if (!value) break;
        entry.chain.push({ seat, value });
        v.unlocks[i] = entry;                                         // only stored once something was accepted
        break;
      }
      case "reveal_padlock": {
        const pad = norm(p?.padlock);
        if (pad && v.reveals[seat] === undefined) v.reveals[seat] = pad;
        break;
      }
    }
  }
  return v;
}

export type Duty =
  | { kind: "commit" }
  | { kind: "shuffle"; step: number; deckIn: string[] }
  | { kind: "unlock"; cardIndex: number; forSeat: ForSeat; valueIn: string }
  | { kind: "reveal" };

/**
 * Everything this player can send right now. Send them ONE AT A TIME (await each ack) because every
 * message needs the next seq number. Call again after each new event.
 */
export function nextDuties(o: {
  view: DealingView;
  mySeat: Seat;
  activeSeats: readonly number[];
  dealer: Seat;
  needsCards: readonly number[] | null;  // state.needsCards
  showdown: boolean;                     // tableState === "showdown"
  stillInHand: boolean;                  // not folded
}): Duty[] {
  const { view, mySeat, dealer } = o;
  const order = [...o.activeSeats].sort((a, b) => a - b);
  if (!order.includes(mySeat)) return [];

  if (view.commitments[mySeat] === undefined) return [{ kind: "commit" }];
  if (!order.every((s) => view.commitments[s] !== undefined)) return [];

  if (!view.shuffleDone) {
    return order[view.shuffleSteps] === mySeat
      ? [{ kind: "shuffle", step: view.shuffleSteps, deckIn: view.deck ?? [...CARD_POINTS] }]
      : [];
  }

  const duties: Duty[] = [];
  for (const i of o.needsCards ?? []) {
    const forSeat = expectedForSeat(i, dealer, order);
    if (forSeat === null) continue;
    const required = unlockOrder(forSeat, order);
    const chain = view.unlocks[i]?.chain ?? [];
    if (chain.length < required.length && required[chain.length] === mySeat) {
      const valueIn = chain.length ? chain[chain.length - 1].value : view.deck![i];
      duties.push({ kind: "unlock", cardIndex: i, forSeat, valueIn });
    }
  }
  if (o.showdown && o.stillInHand && view.reveals[mySeat] === undefined) duties.push({ kind: "reveal" });
  return duties;
}

/** Value of a hole card after the other seats' unlocks, i.e. with ONLY the owner's padlock left. null while pending. */
export function lockedForOwner(view: DealingView, cardIndex: number, activeSeats: readonly number[]): string | null {
  const u = view.unlocks[cardIndex];
  if (!u || u.forSeat === "board") return null;
  return u.chain.length === unlockOrder(u.forSeat, activeSeats).length ? u.chain[u.chain.length - 1].value : null;
}

export type MyCards =
  | { ok: true; cards: [number, number] }
  | { ok: false; reason: "PENDING" | "NOT_A_CARD" };

/** My two hole cards (card identities 0..51). Computed locally; never send the result. */
export function myHoleCards(
  view: DealingView, mySeat: Seat, padlock: Padlock, dealer: Seat, activeSeats: readonly number[],
): MyCards {
  const out: number[] = [];
  for (const i of holeCardIndices(mySeat, dealer)) {
    const locked = lockedForOwner(view, i, activeSeats);
    if (locked === null) return { ok: false, reason: "PENDING" };
    const id = cardIndexFromPoint(unlockCard(locked, padlock));
    if (id === undefined) return { ok: false, reason: "NOT_A_CARD" };
    out.push(id);
  }
  return { ok: true, cards: out as [number, number] };
}

/** Public board card identity for a deck position, or null while pending / not a card. */
export function boardCard(view: DealingView, cardIndex: number, activeSeats: readonly number[]): number | null {
  const u = view.unlocks[cardIndex];
  if (!u || u.forSeat !== "board") return null;
  if (u.chain.length !== unlockOrder("board", activeSeats).length) return null;
  return cardIndexFromPoint(u.chain[u.chain.length - 1].value) ?? null;
}

export type ShowdownCheck =
  | { ok: true; hands: Record<number, [number, number]>; board: number[] }
  | { ok: false; reason: "PENDING" }
  | { ok: false; reason: "BAD_REVEAL" | "DUPLICATE_CARD"; seat?: number };

/**
 * Showdown check, pure, so the web client AND the server engine run the same code on the same log.
 * `revealSeats` = seats that must reveal (still in the hand, not folded).
 * Checks: every reveal matches its commitment, every hole card decodes to a real card, and no card
 * appears twice among the revealed hole cards plus the board. Folded players' cards are never needed.
 */
export function verifyAllReveals(o: {
  view: DealingView; tableId: string; hand: number; dealer: Seat;
  activeSeats: readonly number[]; revealSeats: readonly number[];
}): ShowdownCheck {
  const { view } = o;
  if (!o.revealSeats.every((s) => view.reveals[s] !== undefined)) return { ok: false, reason: "PENDING" };

  const hands: Record<number, [number, number]> = {};
  const seen = new Set<number>();
  const dup = (id: number) => (seen.has(id) ? true : (seen.add(id), false));

  for (const seat of o.revealSeats) {
    const commitment = view.commitments[seat];
    if (commitment === undefined) return { ok: false, reason: "BAD_REVEAL", seat };
    let pad: Padlock;
    try { const scalar = from32Hex(view.reveals[seat]); pad = { scalar, hex: to32Hex(scalar) }; }
    catch { return { ok: false, reason: "BAD_REVEAL", seat }; }

    const ids: number[] = [];
    for (const i of holeCardIndices(seat as Seat, o.dealer)) {
      const locked = lockedForOwner(view, i, o.activeSeats);
      if (locked === null) return { ok: false, reason: "BAD_REVEAL", seat };   // owner's cards were never fully unlocked
      const id = cardIndexFromPoint(unlockCard(locked, pad));
      if (id === undefined) return { ok: false, reason: "BAD_REVEAL", seat };
      const r = verifyReveal({ revealedPadlockHex: pad.hex, commitmentHex: commitment, tableId: o.tableId,
        handNumber: o.hand, lockedCardHex: locked, claimedCardIndex: id });
      if (!r.ok) return { ok: false, reason: "BAD_REVEAL", seat };
      if (dup(id)) return { ok: false, reason: "DUPLICATE_CARD", seat };
      ids.push(id);
    }
    hands[seat] = ids as [number, number];
  }

  const board: number[] = [];
  for (const i of [...BOARD_INDICES.flop, ...BOARD_INDICES.turn, ...BOARD_INDICES.river]) {
    const id = boardCard(view, i, o.activeSeats);
    if (id === null) continue;
    if (dup(id)) return { ok: false, reason: "DUPLICATE_CARD" };
    board.push(id);
  }
  return { ok: true, hands, board };
}