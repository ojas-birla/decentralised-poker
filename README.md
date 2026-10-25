# Decentralised Poker

A 4-player Texas Hold'em game where nobody has to trust the dealer. Cards are shuffled with commutative ("padlock") encryption, every move is a signed message, and the money sits in an escrow contract on **Base Sepolia**.

> Testnet only. The cryptography has not been audited. Do not use real funds.

## How it works

- **Padlock shuffle.** Each player locks every card with their own secret key and shuffles the deck. Locks can be removed in any order, so a card is only revealed when every player has unlocked it. No single player, and not the server, sees the whole deck.
- **Signed messages.** Every game message is wrapped in an envelope signed by a per-table *session key* that was registered on-chain when the player joined. Receivers verify the signature, seat, sequence number, hand number and game state before accepting anything.
- **Server is a relay and timekeeper.** It orders messages, forwards them, runs the turn clock and stores the event log. It holds no key that can act for a player. Clients recompute their view from the signed log instead of trusting the server for cards or money.
- **On-chain escrow.** Buy-ins are deposited in `DecentralisedPoker.sol`. Results are settled by signed checkpoints with a challenge period, then `finalize` and `withdraw`. `emergencyRefund` and `cancelTable` cover abandoned or unfilled tables.

What is **not** trustless: the relay can delay or censor messages (the clock and abort rules limit the damage), players can collude off-chain, and the code is unaudited.

The message formats and state machine are specified in [`docs/SPEC.md`](docs/SPEC.md).

## Repository layout

| Folder | What it is |
| --- | --- |
| `contracts/` | Solidity escrow contract, Hardhat config, deploy script, contract tests |
| `shared/` | Code used by both server and web: padlock/shuffle/verify crypto, game engine, envelope signing, protocol types, generated contract ABI |
| `server/` | Express + socket.io relay, SQLite event log, turn timers, chain watcher, headless bots |
| `web/` | Next.js 14 frontend (lobby, create table, live table) |
| `docs/` | `SPEC.md` interface specification |

This is an npm workspace, so one `npm install` at the root sets up all four packages.

## Prerequisites

- **Node.js 20 or newer** and npm
- **MetaMask** (or another browser wallet) for playing on a real chain
- For a real deployment: a funded **Base Sepolia** account (get test ETH from a faucet)
- On Windows, `better-sqlite3` is a native module. If `npm install` fails while building it, install the "Desktop development with C++" tools from Visual Studio Build Tools and retry.

## Install

From the repo root:

```bash
npm install
```

Do not run `npm install` separately inside `shared/`, `server/` or `web/`; the workspace links them together.

## Run it

There are three ways to run the project, from easiest to most complete.

### 1. UI only, no server (mock mode)

Good for working on the look of the lobby and table.

```bash
cd web
cp .env.example .env.local        # Windows: copy .env.example .env.local
```

Make sure `.env.local` contains `NEXT_PUBLIC_USE_MOCK=true`, then:

```bash
npm run dev -w web                 # from the repo root
```

Open <http://localhost:3000>. The lobby shows sample tables and no server is needed.

### 2. Full game locally, no blockchain (1 browser + 3 bots)

This runs the real server and real game flow, but skips the chain watcher so you need no wallet funds.

**Terminal 1: the server**

```bash
cp server/.env.example server/.env
```

Edit `server/.env` and set `POKER_SKIP_CHAIN=1` (see the note on the `.env.example` formatting under Troubleshooting). Then start it:

```bash
npm run dev -w server
```

It should print `game server on :4000`. Leave it running.

**Terminal 2: the web app**

```bash
cp web/.env.example web/.env.local
```

Edit `web/.env.local`:

```
NEXT_PUBLIC_SERVER_URL=http://localhost:4000
NEXT_PUBLIC_USE_MOCK=false
```

```bash
npm run dev -w web
```

**Terminal 3: seed a table with bots**

```bash
npm run bots -w server -- --seed --human 0xYourWalletAddress
```

Seat 0 becomes your wallet and seats 1 to 3 are bots. The script prints a `localStorage` line. Open <http://localhost:3000>, open the browser console (F12), paste that line, then reload and open the table.

To watch four bots play a whole table with no browser at all:

```bash
npm run bots -w server -- --seed
```

Useful bot options: `--hands <n>`, `--think <min,max>` (ms), `--stall <seats>` (those seats never act, so the 30 s clock folds them), `--garbage <seats>` (spray invalid messages), `--traffic <file>` (log every message).

### 3. Real chain on Base Sepolia

**a. Deploy the contract**

```bash
cd contracts
cp .env.example .env
```

Fill in `DEPLOYER_PRIVATE_KEY` (a throwaway test key with Base Sepolia ETH) and optionally `BASE_SEPOLIA_RPC_URL`. Then:

```bash
npx hardhat run scripts/deploy.ts --network baseSepolia
```

The script writes the new address into `shared/contract.ts`, `web/.env` and `server/.env` for you. If you use `web/.env.local` instead of `web/.env`, copy `NEXT_PUBLIC_CONTRACT_ADDRESS` across.

**b. Configure and start the server**

In `server/.env`:

```
PORT=4000
RPC_URL=https://sepolia.base.org
CONTRACT_ADDRESS=<address from deploy>
DB_PATH=./data/game.db
WEB_ORIGIN=http://localhost:3000
POKER_SKIP_CHAIN=0
CHAIN_CONFIRMATIONS=2
```

```bash
npm run dev -w server
```

**c. Configure and start the web app**

In `web/.env.local`:

```
NEXT_PUBLIC_SERVER_URL=http://localhost:4000
NEXT_PUBLIC_CHAIN_ID=84532
NEXT_PUBLIC_CONTRACT_ADDRESS=<address from deploy>
NEXT_PUBLIC_USE_MOCK=false
```

```bash
npm run dev -w web
```

**d. Play.** Connect MetaMask on Base Sepolia, create a table in the browser, and note its table id. Fill the other seats with bots (each needs its own funded key, because joining makes a real deposit):

```bash
BOT_KEYS=0xkey1,0xkey2,0xkey3 npm run bots -w server -- --table <id> --seats 1,2,3
```

On Windows PowerShell use:

```powershell
$env:BOT_KEYS="0xkey1,0xkey2,0xkey3"; npm run bots -w server -- --table <id> --seats 1,2,3
```

## Configuration reference

**`server/.env`**

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `4000` | HTTP and socket.io port |
| `RPC_URL` | `https://sepolia.base.org` | JSON-RPC endpoint for the chain watcher |
| `CONTRACT_ADDRESS` | zero address | Deployed `DecentralisedPoker` contract |
| `DB_PATH` | `./data/game.db` | SQLite file for tables and the event log |
| `WEB_ORIGIN` | `http://localhost:3000` | Allowed CORS origin(s), comma-separated |
| `POKER_SKIP_CHAIN` | `0` | `1` disables the chain watcher (local bot testing) |
| `CHAIN_CONFIRMATIONS` | `2` | Blocks a deposit must be buried under before it counts |
| `POKER_DEV_DECK` | unset | `1` keeps the older server-dealt deck, for development only |

**`web/.env.local`**

| Variable | Meaning |
| --- | --- |
| `NEXT_PUBLIC_SERVER_URL` | URL of the game server, e.g. `http://localhost:4000` |
| `NEXT_PUBLIC_CHAIN_ID` | `84532` for Base Sepolia |
| `NEXT_PUBLIC_CONTRACT_ADDRESS` | Same address the server uses |
| `NEXT_PUBLIC_USE_MOCK` | `true` shows sample data with no server; **must be `false` to play** |

**`contracts/.env`**

| Variable | Meaning |
| --- | --- |
| `DEPLOYER_PRIVATE_KEY` | Key that pays for deployment |
| `BASE_SEPOLIA_RPC_URL` | RPC endpoint (defaults to the public one) |

Never commit `.env` files. `.env.example` files are safe to commit.

## Tests

```bash
npm test -w shared       # crypto and game engine
npm test -w server       # relay, lifecycle, reconnect, timers, bots
npm test -w web          # view logic
cd contracts && npx hardhat test    # contract
```

Type checks: `npm run typecheck -w shared`, and the same for `server` and `web`.

## Troubleshooting

**"Connection to the game server lost. Trying to reconnect…" / "Loading table…"**
The browser cannot reach the server. Check, in order:
1. The server terminal is running and printed `game server on :4000`.
2. `NEXT_PUBLIC_SERVER_URL` in the web env matches that port, and you restarted `npm run dev -w web` after changing it (Next.js reads env vars at startup).
3. `WEB_ORIGIN` in `server/.env` matches the address in your browser bar exactly, for example `http://localhost:3000`.
4. The table id exists. The server stores tables in SQLite, so after deleting `server/data/` an old `/table/40` link points at nothing. Create or seed a new table.
5. Open the browser console (F12, Network tab, filter WS) to see whether the socket is refused or rejected.

**`Cannot find package 'ethers'` or `X is not a function` in tests**
Run `npm install` at the repo root, not inside a sub-folder, so all workspaces resolve to the same dependencies. If it persists, delete `node_modules` and `package-lock.json` at the root and install again.

**`.env.example` formatting.** `server/.env.example` has `POKER_SKIP_CHAIN=0` and `CHAIN_CONFIRMATIONS=2` run together on one line (and `web/.env.example` has no trailing newline). After copying, make sure each variable sits on its own line, or the second one is silently ignored.

**Port already in use** (Windows): `netstat -ano | findstr :4000`, then `taskkill /PID <pid> /F`, or change `PORT`.

**Deposits never show up on a real chain.** Check that `CONTRACT_ADDRESS` matches the deployed contract, that `POKER_SKIP_CHAIN` is not `1`, and give it a few seconds for `CHAIN_CONFIRMATIONS` blocks.

## Status

Hackathon project. Treat the protocol as a prototype: the on-chain checkpoint and dispute path, the shuffle verification, and the relay trust assumptions described above are the areas that need the most review before any real-money use.
