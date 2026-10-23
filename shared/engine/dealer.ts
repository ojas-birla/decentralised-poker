// shared/engine/dealer.ts
import { GameState, PlayerState } from "./types";
import { holeCardIndices, CardId } from "./cards";

// Helper to find the next active seat (not evicted, has chips)
function nextActiveSeat(currentSeat: number, seats: PlayerState[]): 0 | 1 | 2 | 3 {
  let next = (currentSeat + 1) % 4;
  for (let i = 0; i < 4; i++) {
    if (!seats[next].evicted && seats[next].chips > 0) {
      return next as 0 | 1 | 2 | 3;
    }
    next = (next + 1) % 4;
  }
  return currentSeat as 0 | 1 | 2 | 3; // Fallback
}

export function startHand(state: GameState, rngCards?: CardId[]): GameState {
  const newState = { ...state, seats: [...state.seats] } as GameState;
  
  // 1. Move dealer button
  newState.dealerSeat = nextActiveSeat(state.dealerSeat, newState.seats);
  
  // 2. Identify active players to check for heads-up
  const activeSeats = newState.seats
    .map((p, i) => (!p.evicted && p.chips > 0) ? i : -1)
    .filter(i => i !== -1) as (0 | 1 | 2 | 3)[];
    
  const isHeadsUp = activeSeats.length === 2;

  // 3. Post Blinds (Heads-up rules apply)
  let sbSeat: 0 | 1 | 2 | 3;
  let bbSeat: 0 | 1 | 2 | 3;
  let firstToAct: 0 | 1 | 2 | 3;

  if (isHeadsUp) {
    // SPEC: Heads-up (2 players left): dealer posts the small blind and acts first before the flop.
    sbSeat = newState.dealerSeat;
    bbSeat = nextActiveSeat(sbSeat, newState.seats);
    firstToAct = sbSeat; 
  } else {
    // Standard (3+ players)
    sbSeat = nextActiveSeat(newState.dealerSeat, newState.seats);
    bbSeat = nextActiveSeat(sbSeat, newState.seats);
    firstToAct = nextActiveSeat(bbSeat, newState.seats);
  }

  // 4. Reset player states for the new hand
  newState.seats = newState.seats.map(p => ({
    ...p,
    inHand: p.chips > 0 && !p.evicted,
    hasFolded: false,
    isAllIn: false,
    committedThisStreet: 0,
    committedThisHand: 0,
  })) as [PlayerState, PlayerState, PlayerState, PlayerState];

  // Post Small Blind (Math.min handles short stacks)
  const sbAmount = Math.min(newState.blinds.small, newState.seats[sbSeat].chips);
  newState.seats[sbSeat].chips -= sbAmount;
  newState.seats[sbSeat].committedThisStreet = sbAmount;
  newState.seats[sbSeat].committedThisHand = sbAmount;
  if (newState.seats[sbSeat].chips === 0) newState.seats[sbSeat].isAllIn = true;

  // Post Big Blind
  const bbAmount = Math.min(newState.blinds.big, newState.seats[bbSeat].chips);
  newState.seats[bbSeat].chips -= bbAmount;
  newState.seats[bbSeat].committedThisStreet = bbAmount;
  newState.seats[bbSeat].committedThisHand = bbAmount;
  if (newState.seats[bbSeat].chips === 0) newState.seats[bbSeat].isAllIn = true;

  // 5. Setup Betting State
  newState.currentBet = newState.blinds.big;
  newState.lastRaiseSize = newState.blinds.big;
  newState.toActSeat = firstToAct;
  newState.street = "preflop";
  newState.board = [];
  newState.pots = [];

  // 6. Deal Hole Cards
  newState.holeCards = [[], [], [], []];
  if (rngCards) {
    // Phase 2 (Server Dealing)
    for (let s = 0; s < 4; s++) {
      if (newState.seats[s].inHand) {
        const [idx1, idx2] = holeCardIndices(s as 0|1|2|3, newState.dealerSeat);
        newState.holeCards[s] = [rngCards[idx1], rngCards[idx2]];
      }
    }
    newState.needsCards = null;
  } else {
    // Phase 3 (Padlock Shuffle) - Engine pauses and waits for unlocks
    newState.needsCards = [];
    for (let s = 0; s < 4; s++) {
      if (newState.seats[s].inHand) {
         newState.needsCards.push(...holeCardIndices(s as 0|1|2|3, newState.dealerSeat));
      }
    }
  }

  return newState;
}