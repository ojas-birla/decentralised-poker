# decentralised-poker

4-player Texas Hold'em with no trusted dealer. Built in 30 hours for a hackathon.

Players shuffle the deck themselves using padlock (commutative) encryption, every move is a signed message, and buy-ins are held in a contract on Base Sepolia. The server only relays messages and runs the turn clock. Testnet only, nothing here is audited.

Message formats and game states are in `docs/SPEC.md`.

## Folders

- `contracts/` Solidity escrow contract + Hardhat
- `shared/` crypto (padlock, shuffle, verify), game engine, envelope signing
- `server/` express + socket.io relay, sqlite, timers, bots
- `web/` Next.js frontend

## Setup

Node 20+. From the repo root:

```
npm install
```

Only at the root. Don't run it again inside the folders, it's a workspace.

On Windows, if better-sqlite3 fails to build, install the C++ build tools from Visual Studio Build Tools.

## Run (no blockchain, 1 you + 3 bots)

Easiest way to see the game working. Three terminals.

1. Server

```
cp server/.env.example server/.env
```

Set `POKER_SKIP_CHAIN=1` in `server/.env`, then:

```
npm run dev -w server
```

Wait for `game server on :4000`.

2. Web

```
cp web/.env.example web/.env.local
```

In `web/.env.local` set `NEXT_PUBLIC_SERVER_URL=http://localhost:4000` and `NEXT_PUBLIC_USE_MOCK=false`, then:

```
npm run dev -w web
```

3. Bots

```
npm run bots -w server -- --seed --human 0xYourWallet
```

You get seat 0. It prints a line, paste it in the browser console on localhost:3000, reload, open the table.

Without `--human` it's 4 bots playing a full table, no browser needed.

## Run (UI only)

Set `NEXT_PUBLIC_USE_MOCK=true` in `web/.env.local` and run `npm run dev -w web`. Shows sample tables, no server.

## Run (Base Sepolia)

Deploy:

```
cd contracts
cp .env.example .env     # add DEPLOYER_PRIVATE_KEY (funded testnet key)
npx hardhat run scripts/deploy.ts --network baseSepolia
```

This writes the address into `shared/contract.ts`, `server/.env` and `web/.env`. If you use `web/.env.local`, copy `NEXT_PUBLIC_CONTRACT_ADDRESS` there yourself.

Then in `server/.env` set `RPC_URL`, `CONTRACT_ADDRESS`, `POKER_SKIP_CHAIN=0`. In `web/.env.local` set `NEXT_PUBLIC_CHAIN_ID=84532`, `NEXT_PUBLIC_CONTRACT_ADDRESS`, `NEXT_PUBLIC_USE_MOCK=false`. Start server and web as above, connect MetaMask on Base Sepolia, create a table.

Fill other seats with bots (each key needs testnet ETH, joining is a real deposit):

```
BOT_KEYS=0xkey1,0xkey2,0xkey3 npm run bots -w server -- --table <id> --seats 1,2,3
```

PowerShell: `$env:BOT_KEYS="0xkey1,0xkey2,0xkey3"; npm run bots -w server -- --table <id> --seats 1,2,3`

## Env vars

server: `PORT` (4000), `RPC_URL`, `CONTRACT_ADDRESS`, `DB_PATH` (./data/game.db), `WEB_ORIGIN` (must match the browser URL exactly), `POKER_SKIP_CHAIN` (1 = no chain watcher), `CHAIN_CONFIRMATIONS` (2)

web: `NEXT_PUBLIC_SERVER_URL`, `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_CONTRACT_ADDRESS`, `NEXT_PUBLIC_USE_MOCK`

contracts: `DEPLOYER_PRIVATE_KEY`, `BASE_SEPOLIA_RPC_URL`

## Tests

```
npm test -w shared
npm test -w server
npm test -w web
cd contracts && npx hardhat test
```

## Problems

"Connection to the game server lost" / stuck on "Loading table...":
- server isn't running, or isn't on the port in `NEXT_PUBLIC_SERVER_URL`
- you changed `.env.local` and didn't restart the web app
- `WEB_ORIGIN` doesn't match the browser URL
- `NEXT_PUBLIC_USE_MOCK` is still true
- the table id isn't in the server's db (e.g. you deleted `server/data/`). Seed a new one.

"Cannot find package" / "is not a function" in tests: run `npm install` at the root. If that doesn't fix it, delete `node_modules` and `package-lock.json` and reinstall.

`server/.env.example` has `POKER_SKIP_CHAIN=0` and `CHAIN_CONFIRMATIONS=2` on one line. Split them after copying or the second is ignored.

Port in use on Windows: `netstat -ano | findstr :4000` then `taskkill /PID <pid> /F`.
