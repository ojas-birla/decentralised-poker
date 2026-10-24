// D6: GameState (per-seat publicState from the server) -> TableView (what the UI renders).
// Pure function, no React, no sockets. SPEC-2.1 section 8, D6.
// Runtime imports go to the exact shared files, not "@poker/shared", so the engine and
// pokersolver are not pulled into the browser bundle.
import type { BetActionPayload, GameState, PlayerPresence, Seat, TimerInfo } from "@poker/shared";
import { cardName } from "@poker/shared/engine/cards";
import { legalActions } from "@poker/shared/engine/legalActions";
import type { CardCode, PlayerAction, PlayerView, TableView } from "@/lib/tableView";

export interface ToTableViewInput {
  state: GameState;
  mySeat: Seat | null;
  players: PlayerPresence[]; // from the `presence` events / hello view
  timer: TimerInfo | null;
  totalHands: number; // from GET /api/tables/:id (or the lobby row)
  myCards?: readonly number[] | null; // from useDealing (real shuffle); server cards win if present
}

const TOTAL_CHIPS = 4000;

function pair(cards: readonly number[] | undefined): [CardCode, CardCode] | null {
  if (!cards || cards.length !== 2) return null;
  return [cardName(cards[0]), cardName(cards[1])];
}

export function toTableView({
  state,
  mySeat,
  players,
  timer,
  totalHands,
  myCards,
}: ToTableViewInput): TableView {
  const showdownLike = state.tableState === "showdown" || state.tableState === "settlement";
  const handInPlay =
    state.tableState === "dealing" ||
    state.tableState === "betting" ||
    state.tableState === "showdown" ||
    state.tableState === "settlement";

  const seats: PlayerView[] = state.seats.map((p, i) => {
    const presence = players.find((x) => x.seat === i);
    const hole = state.holeCards[i];
    return {
      address: p.wallet ? p.wallet.toLowerCase() : null,
      connected: presence ? presence.connected : p.connected,
      stack: p.chips,
      currentBet: p.committedThisStreet,
      folded: p.hasFolded,
      allIn: p.isAllIn,
      busted: p.chips === 0 && !p.inHand,
      isDealer: handInPlay && i === state.dealerSeat,
      // Only set when the server actually sent both cards: that happens at a real showdown
      // for non-folded seats (publicState keeps them visible), never before.
      revealed:
        showdownLike && !p.hasFolded ? pair(hole) ?? undefined : undefined,
    };
  });

  // Bets still in front of players are NOT in the pot (matches tableView.ts).
  const pot = state.seats.reduce((sum, p) => sum + (p.committedThisHand - p.committedThisStreet), 0);

  const turnSeat = state.toActSeat;
  const view: TableView = {
    tableId: state.tableId,
    state: state.tableState,
    handNumber: state.handNumber,
    totalHands,
    seats,
    board: state.board.map(cardName),
    pot,
    mySeat,
    // Server cards first (dev deck), then the cards my browser unlocked (real shuffle).
    myHole:
      mySeat !== null ? pair(state.holeCards[mySeat]) ?? pair(myCards ?? undefined) : null,
    turnSeat,
    turnDeadlineMs: turnSeat !== null && timer && timer.seat === turnSeat ? timer.deadline : null,
    legal: mySeat !== null ? legalActions(state, mySeat) : null,
  };

  if (process.env.NODE_ENV !== "production" && !chipsAddUp(view)) {
    console.warn("TableView chip invariant broken: stacks + bets + pot !== 4000", view);
  }
  return view;
}

/** sum(stack + currentBet) + pot === 4000 (the invariant from SPEC-2.1 section 8, D6). */
export function chipsAddUp(view: TableView): boolean {
  const onTable = view.seats.reduce((sum, p) => sum + p.stack + p.currentBet, 0);
  return onTable + view.pot === TOTAL_CHIPS;
}

/** UI action -> bet_action payload. `raiseTo` is the TOTAL bet this street. */
export function toBetPayload(action: PlayerAction): BetActionPayload {
  switch (action.type) {
    case "raise":
      return { action: "raise", amount: action.raiseTo };
    case "fold":
    case "check":
    case "call":
    case "allin":
      return { action: action.type };
  }
}