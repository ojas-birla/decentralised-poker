// shared/types.ts

// --- Section 4: Game States ---
export type TableState =
  | "lobby"
  | "waiting_deposits"
  | "ready"
  | "dealing"
  | "betting"
  | "showdown"
  | "settlement"
  | "finished"
  | "aborted";

export type AbortReason = "CRYPTO_STALL" | "BAD_REVEAL" | "DUPLICATE_CARD" | "PLAYER_ABANDONED";

// --- Section 2: Message Types ---
export type MessageType =
  | "join" | "ready" | "commit_padlock" | "shuffle_step" | "unlock_card"
  | "bet_action" | "reveal_padlock" | "checkpoint_sig" | "abandon_vote";

// --- Section 1: Envelope ---
export interface Envelope<T = unknown> {
  tableId: string;       // decimal string
  handNumber: number;    
  seq: number;           
  sender: string;        // wallet address
  seat: 0 | 1 | 2 | 3;   
  type: MessageType;     
  payload: T;            
  sig: string;           // 65-byte hex
}

// --- Section 3: Checkpoint ---
export interface Checkpoint {
  tableId: string;
  checkpointNumber: number;
  balances: [string, string, string, string]; // wei as decimal strings
  evicted: [boolean, boolean, boolean, boolean];
}

// --- Section 2: Payloads ---
export interface JoinPayload { sessionKey: string; }
export interface ReadyPayload { ready: true; }
export interface CommitPadlockPayload { commitment: string; }
export interface ShuffleStepPayload { step: 0 | 1 | 2 | 3; deck: string[]; }
export interface UnlockCardPayload { cardIndex: number; forSeat: number | "board"; value: string; }
export interface BetActionPayload { action: "fold" | "check" | "call" | "raise" | "allin"; amount?: number; }
export interface RevealPadlockPayload { padlock: string; }
export interface CheckpointSigPayload { checkpointNumber: number; checkpointHash: string; signature: string; }
export interface AbandonVotePayload { accusedSeat: number; reason: "TIMEOUT" | "DISCONNECTED"; }

// --- Section 1: Reject Codes ---
export type RejectCode = 
  | "BAD_SIG" | "BAD_SEAT" | "BAD_SEQ" | "DUPLICATE" | "WRONG_HAND" 
  | "WRONG_STATE" | "NOT_YOUR_TURN" | "ILLEGAL_ACTION" | "BAD_PAYLOAD";

export interface Reject {
  refSeq: number;
  code: RejectCode;
  message: string;
  nextSeq?: number;   // set by the server on BAD_SEQ and DUPLICATE
}