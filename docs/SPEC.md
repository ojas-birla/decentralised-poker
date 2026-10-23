# SPEC.md: Decentralised Poker Interface Contracts

Status: DRAFT v1. Once all four of us agree, treat this file as frozen. Any change needs all four people to agree and a commit message starting with `SPEC:`.

Scope: this file covers Phase 0 steps 0.2 to 0.6 (message envelope, message types, checkpoint, game states). Everything else is in the main plan.

Conventions used throughout:

- Seats are numbered 0 to 3 in code (Player 1 to 4 in the UI).
- Addresses are lowercase 0x-prefixed hex. Hashes and signatures are 0x-prefixed hex.
- Big numbers (wei) are decimal strings in JSON, never JS numbers.
- Chips are integers. 1 player starts with 1000 chips. `weiPerChip = buyIn / 1000`, so the creator's buy-in must be divisible by 1000 wei (enforced in `createTable`).
- Curve points and scalars (crypto module) are 32-byte hex strings.

---

## 1. Message envelope (step 0.2)

Every game message sent over socket.io uses this one envelope.

```ts
interface Envelope<T = unknown> {
  tableId: string;       // on-chain table id, as decimal string
  handNumber: number;    // 0 before the first hand (lobby messages), then 1..N
  seq: number;           // per-sender counter, starts at 1, +1 for every message that sender sends at this table (across hands). No gaps, no repeats.
  sender: string;        // wallet address of the player (the one registered on-chain)
  seat: 0 | 1 | 2 | 3;   // sender's seat, redundant but checked against the table
  type: MessageType;     // see section 2
  payload: T;            // type-specific, see section 2
  sig: string;           // signature by the sender's SESSION KEY over the digest below
}
```

### Signing

`digest = keccak256(utf8(canonicalJson({ tableId, handNumber, seq, sender, seat, type, payload })))`

- `canonicalJson` = JSON with keys sorted alphabetically at every level, no whitespace.
- `sig` = secp256k1 signature of `digest` by the session key (65-byte r,s,v hex).
- Receivers recover the signer and check it equals the session key registered on-chain for `sender` at this table.
- Implemented once in `shared/envelope.ts` as `signEnvelope()` and `verifyEnvelope()`. Nobody re-implements this.

### Validation rules (server and every client apply the same ones)

1. Signature recovers to the registered session key for `sender`.
2. `seat` matches `sender`'s seat at this table.
3. `seq` equals the last seen `seq` from this sender + 1. Duplicates are ignored and logged; gaps are rejected and logged.
4. `handNumber` equals the current hand (except `join`, `ready` and `checkpoint_sig`, see section 2).
5. `type` is allowed in the current game state (section 4).
6. Payload passes the type's schema and the engine accepts it.

Rejected messages are never forwarded and never change state. The server replies to the sender only with:

```ts
interface Reject { refSeq: number; code: RejectCode; message: string }
type RejectCode = "BAD_SIG" | "BAD_SEAT" | "BAD_SEQ" | "DUPLICATE" | "WRONG_HAND" | "WRONG_STATE"
                | "NOT_YOUR_TURN" | "ILLEGAL_ACTION" | "BAD_PAYLOAD";
```

### Server-originated messages

The server is a relay and timekeeper and has no key that can act for a player. It sends these (unsigned, informational; clients never trust them for money or card data, they recompute from the signed event log):

```ts
type ServerEvent =
  | { kind: "state"; state: TableState; deadline?: number }       // game state changed; deadline = unix ms
  | { kind: "event"; index: number; envelope: Envelope }          // the ordered log entry, forwarded to all
  | { kind: "timer"; seat: number; deadline: number }             // whose clock is running
  | { kind: "auto"; seat: number; action: "fold" | "check"; handNumber: number } // timer expired
  | { kind: "presence"; seat: number; connected: boolean }
  | { kind: "abort"; handNumber: number; reason: AbortReason }
  | { kind: "reject"; reject: Reject };

type AbortReason = "CRYPTO_STALL" | "BAD_REVEAL" | "DUPLICATE_CARD" | "PLAYER_ABANDONED";
```

The event log is the single source of truth: an ordered list of accepted envelopes plus server events, indexed from 0. A reconnecting client requests everything from index 0 (or from a snapshot index) and rebuilds its view by replaying it through the shared engine.

---

## 2. Message types (step 0.3)

```ts
type MessageType =
  | "join" | "ready" | "commit_padlock" | "shuffle_step" | "unlock_card"
  | "bet_action" | "reveal_padlock" | "checkpoint_sig" | "abandon_vote";
```

Note: `commit_padlock` is not in the original 0.3 list but is required by plan step 3.3 (each player publishes a commitment before the shuffle). It is included here as the 9th type.

| Type | Sent by | Allowed in state | handNumber | Purpose |
| --- | --- | --- | --- | --- |
| `join` | any seated player | `lobby`, `waiting_deposits` | 0 | Announce presence, bind socket to seat and session key |
| `ready` | any seated player | `waiting_deposits`, `ready`, `settlement` | 0 (first hand) or next hand number | Player is connected and ready to start (or continue) |
| `commit_padlock` | every active player | `dealing` | current | Publish hash of this hand's padlock |
| `shuffle_step` | the player whose turn it is | `dealing` | current | Lock and shuffle the whole deck, pass on |
| `unlock_card` | any active player | `dealing`, `betting` (for board cards) | current | Remove own padlock from one card |
| `bet_action` | the player to act | `betting` | current | fold / check / call / raise / allin |
| `reveal_padlock` | every player still in the hand | `showdown` | current | Reveal this hand's padlock secret so cards can be verified |
| `checkpoint_sig` | every non-evicted player | `settlement`, `finished` | the hand being settled | Signature over the checkpoint |
| `abandon_vote` | active players (not the accused) | any in-hand state | current | Vote that a player has gone for good |

### Payloads

```ts
// join
interface JoinPayload {
  sessionKey: string;      // address of the session key (must equal the on-chain registered one)
}

// ready
interface ReadyPayload {
  ready: true;
}

// commit_padlock
interface CommitPadlockPayload {
  commitment: string;      // keccak256(padlockScalar || tableId || handNumber), hex
}

// shuffle_step
interface ShuffleStepPayload {
  step: 0 | 1 | 2 | 3;     // equals the sender's seat position in the shuffle order
  deck: string[];          // exactly 52 curve points (hex), locked by this player and all earlier ones, in new shuffled order
}

// unlock_card
interface UnlockCardPayload {
  cardIndex: number;       // 0..51, position in the shuffled deck
  forSeat: number | "board";  // seat that will see the card, or "board" for community cards
  value: string;           // curve point (hex): the card value with the sender's padlock removed
}

// bet_action
interface BetActionPayload {
  action: "fold" | "check" | "call" | "raise" | "allin";
  amount?: number;         // raise: total bet to raise TO for this round (chips). Omitted for other actions.
}

// reveal_padlock
interface RevealPadlockPayload {
  padlock: string;         // the padlock scalar (hex) used this hand. Must hash to the earlier commitment.
}

// checkpoint_sig
interface CheckpointSigPayload {
  checkpointNumber: number;
  checkpointHash: string;  // EIP-712 hash of the Checkpoint (section 3)
  signature: string;       // EIP-712 signature by the session key
}

// abandon_vote
interface AbandonVotePayload {
  accusedSeat: number;
  reason: "TIMEOUT" | "DISCONNECTED";
}
```

### Card positions and unlock order

- The deck after the 4th shuffle step is `deck[0..51]`, and that index is the card's identity for all later messages.
- Hole cards: seat `s` gets `deck[2*s]` and `deck[2*s+1]`... after the dealer rotation is applied. Rule: deal order starts at the seat left of the dealer, one card at a time, two rounds; the engine in `shared/` computes the mapping and everyone calls the same function `holeCardIndices(seat, dealer)`.
- Board: `deck[8]`, `deck[9]`, `deck[10]` flop; `deck[11]` turn; `deck[12]` river (burn cards are skipped to keep it simple: no burns).
- For a hole card, the other three players each send `unlock_card` with `forSeat = owner`. The owner removes their own padlock locally and never sends it.
- For a board card, all four send `unlock_card` with `forSeat = "board"`.
- Unlock requests are triggered by the engine, not by chat: when the game state requires a card, every client that owes an unlock sends it automatically.

### Timers tied to messages

| Waiting for | Time limit | If it expires |
| --- | --- | --- |
| `bet_action` | 30 s | Server emits `auto` (check if free, else fold) |
| any crypto message (`commit_padlock`, `shuffle_step`, `unlock_card`, `reveal_padlock`) | 60 s (reconnect grace) | Hand aborts, `AbortReason = CRYPTO_STALL`, and that player is marked as stalling |
| `checkpoint_sig` | 60 s | See section 3, eviction |

---

## 3. Checkpoint (step 0.4)

A checkpoint is the signed balance sheet that the contract accepts. Players sign one after every hand. Only the latest valid one is used.

```ts
interface Checkpoint {
  tableId: string;           // uint256 on-chain id
  checkpointNumber: number;  // uint64. 1 after hand 1, 2 after hand 2, etc. Must strictly increase.
  balances: [string, string, string, string]; // wei owed to seat 0..3, decimal strings
  evicted: [boolean, boolean, boolean, boolean]; // true = seat removed from the table (abandoned)
}
```

### Rules (all enforced by the contract; clients enforce them before signing)

1. `sum(balances) == totalDeposited` (which is `4 * buyIn`). Always exactly equal, no rounding loss.
2. Every balance is `chips * weiPerChip` for an integer chip count. Chip counts across the four seats sum to 4000.
3. An evicted seat can still have a non-zero balance (their remaining chips are returned to them, see below).
4. `checkpointNumber` must be greater than the currently stored one.
5. Signed by every seat where `evicted[seat] == false`, and only by that seat's registered session key.
6. A checkpoint for hand N covers the table state AFTER hand N is fully settled. It never describes a hand in progress.

### What an aborted hand does to the balances

This is the one rule that most often goes wrong, so it is fixed here:

- **Hand aborted for a technical reason (`CRYPTO_STALL`, `BAD_REVEAL`, `DUPLICATE_CARD`, no abandonment):** the hand is rolled back. All chips committed this hand go back to their original owners. The next checkpoint reflects the balances from before the hand. `handNumber` still increments for the log, but the checkpoint number is only incremented when a checkpoint is actually signed.
- **Hand aborted because a player abandoned (`PLAYER_ABANDONED`):** the abandoner forfeits whatever they already put into the pot this hand. That amount is split equally among the remaining active players (odd leftover chip goes to the first of them to the left of the dealer). The abandoner's remaining chips stay in their balance and are returned to them. Everyone else's committed chips that were not forfeited return as normal. The abandoner is set `evicted = true` in that checkpoint.

### EIP-712 typing

```
Domain: { name: "DecentralisedPoker", version: "1", chainId: 84532, verifyingContract: <contract address> }

Checkpoint(
  uint256 tableId,
  uint64  checkpointNumber,
  uint256[4] balances,
  bool[4] evicted
)
```

- The domain binds each signature to this chain and this contract, and `tableId` binds it to this table, so a checkpoint cannot be replayed elsewhere.
- Signed by the session key, not the wallet, so no MetaMask pop-up is needed.
- The contract verifies with OpenZeppelin `ECDSA` and `EIP712` against the session keys stored at join time.
- `checkpointHash` in the `checkpoint_sig` message is the EIP-712 digest of this struct.

### Signing flow

1. A hand finishes. Every client runs the shared engine and computes the checkpoint locally.
2. A client signs only if its own computed `balances` and `evicted` equal what the other clients propose (the proposal is the checkpoint hash broadcast with the first `checkpoint_sig`). If it disagrees, it does not sign and shows an error banner.
3. The server collects `checkpoint_sig` messages and stores them. When all required signatures exist, they are stored as the latest checkpoint.
4. At the end of the game (`finished`), any player can submit the latest full set of signatures to `submitCheckpoint`. After the 2-minute challenge window, anyone calls `finalize`, then each player calls `withdraw`.

### Eviction checkpoint

If a player vanishes for good (an `abandon_vote` from all other active players, or no `checkpoint_sig` from them after the 60 s limit), the remaining three sign a checkpoint with `evicted[seat] = true` for that seat. It is accepted on-chain after the challenge window like any other checkpoint. If three players cannot agree, the 1-hour `emergencyRefund` is the fallback.

### Worked example

Buy-in 0.001 ETH = `1000000000000000` wei, so `weiPerChip = 1000000000000` and total deposited is `4000000000000000` wei (4000 chips).

After hand 3, seat 0 has 1300 chips, seat 1 has 700, seat 2 has 1200, seat 3 has 800. The checkpoint is:

```json
{
  "tableId": "7",
  "checkpointNumber": 3,
  "balances": ["1300000000000000", "700000000000000", "1200000000000000", "800000000000000"],
  "evicted": [false, false, false, false]
}
```

The balances sum to `4000000000000000`, which equals the total deposited.

---

## 4. Game states (step 0.5)

There are two layers. The table moves through the outer lifecycle once; the hand loop (`dealing` to `settlement`) repeats for every hand.

```ts
type TableState =
  | "lobby"              // table exists on-chain, fewer than 4 seats filled
  | "waiting_deposits"   // all 4 seats taken, waiting for deposit confirmations and presence
  | "ready"              // 4 deposits confirmed on-chain and all 4 players sent `ready`
  | "dealing"            // hand in progress: commitments, shuffle, hole-card unlocks
  | "betting"            // hand in progress: a betting round (preflop, flop, turn, river), board cards unlocked between rounds
  | "showdown"           // players still in the hand reveal padlocks, engine ranks hands
  | "settlement"         // pot awarded, checkpoint being signed by all non-evicted players
  | "finished"           // all hands played, or only one player holds all chips; final checkpoint ready to submit
  | "aborted";           // table cancelled, or unrecoverable failure; refunds only
```

### Transitions

| From | To | Trigger |
| --- | --- | --- |
| (none) | `lobby` | `createTable` confirmed on-chain, creator has seat 0 |
| `lobby` | `lobby` | `joinTable` confirmed on-chain for seats 1 to 3 |
| `lobby` | `waiting_deposits` | 4th seat filled on-chain (contract status becomes "started") |
| `lobby` | `aborted` | `cancelTable` used by a player before the table fills |
| `waiting_deposits` | `ready` | 4 deposit events seen by the server AND 4 `ready` messages received |
| `waiting_deposits` | `aborted` | Deposit not confirmed within 10 minutes of the table filling (refunds available) |
| `ready` | `dealing` | Server starts hand 1 (`handNumber = 1`) |
| `dealing` | `betting` | All 4 commitments received, shuffle complete, hole cards unlocked |
| `dealing` | `settlement` | Hand aborted (`CRYPTO_STALL`, `DUPLICATE_CARD`): roll back or apply abandonment, go straight to checkpoint |
| `betting` | `betting` | Round complete, next board cards unlocked (flop, turn, river) |
| `betting` | `showdown` | Betting complete on the river, or all remaining players all-in |
| `betting` | `settlement` | Everyone but one player folds (no showdown) |
| `betting` | `settlement` | Hand aborted (e.g. `CRYPTO_STALL` during a board unlock) |
| `showdown` | `settlement` | All reveals verified, pots awarded |
| `showdown` | `settlement` | Reveal failed verification (`BAD_REVEAL`): hand aborted and rolled back |
| `settlement` | `dealing` | All non-evicted players signed the checkpoint AND more hands remain AND at least 2 players have chips |
| `settlement` | `finished` | Last hand done, OR one player has all chips, OR fewer than 2 non-evicted players remain |
| `finished` | (end) | Final checkpoint submitted, finalized, and withdrawn on-chain |
| any non-`lobby` | `aborted` | 1-hour emergency refund window passes without a finalized checkpoint |

### Allowed message types by state

| State | Allowed types |
| --- | --- |
| `lobby` | `join` |
| `waiting_deposits` | `join`, `ready` |
| `ready` | `ready` |
| `dealing` | `commit_padlock`, `shuffle_step`, `unlock_card`, `abandon_vote` |
| `betting` | `bet_action`, `unlock_card`, `abandon_vote` |
| `showdown` | `reveal_padlock`, `abandon_vote` |
| `settlement` | `checkpoint_sig`, `ready`, `abandon_vote` |
| `finished` | `checkpoint_sig` (for the final checkpoint only) |
| `aborted` | none |

### Hand-level rules that depend on state

- Chips: 1000 per player, blinds 5 and 10, fixed. Dealer button moves one seat clockwise (skipping busted players) every hand.
- Busted players (0 chips) become spectators. They no longer sign checkpoints in the sense of being counted active for play, but they are still `evicted = false` and still sign the checkpoint (they own a balance of 0 and must agree to the sheet).
- Heads-up (2 players with chips left): dealer posts the small blind and acts first before the flop.
- Ties split the pot. An odd leftover chip goes to the first winner to the left of the dealer.
- Side pots are required for all-ins.
- A hand is in exactly one of `dealing`, `betting`, `showdown`, `settlement` at any time. The table is never in two states.

---

## 5. Shared types location (step 0.6 housekeeping)

These definitions live in code in one place and everything imports from there:

```
shared/
  envelope.ts      // Envelope, MessageType, payload interfaces, sign/verify
  checkpoint.ts    // Checkpoint, EIP-712 typed data, hashing, validation
  states.ts        // TableState, allowed-transition table, allowed-message table
  engine/          // pure poker engine (Phase 1, Person C)
```

Rule of thumb: if two people disagree about a field name, this file wins. If this file is wrong, fix this file first, then the code.

---

## 6. Open decisions to confirm in the first 30 minutes

Tick these off and delete the section once agreed:

- [ ] Confirm the abandonment rule in section 3 (forfeited chips split among active players, remainder returned, abandoner evicted).
- [ ] Confirm no burn cards (simplifies card indexing in section 2).
- [ ] Confirm `ready` between hands is automatic (clients send it on their own after signing the checkpoint) rather than a button.
- [ ] Confirm `commit_padlock` is the added 9th message type.
- [ ] Confirm the buy-in must be divisible by 1000 wei.
- [ ] Confirm the session key is an ordinary secp256k1 key (so it works with EIP-712 and `ECDSA` in the contract), separate from the ristretto255 padlock scalars.