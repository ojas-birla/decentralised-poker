// server/src/seed.ts
// Dev helper: puts a few open tables in the database so the lobby page has something to show.
// Run: npm run seed -w server   (safe to run twice)
import { openDb } from "./db";
import { addPlayer, createGame, loadGame } from "./store";

const db = openDb(process.env.DB_PATH ?? "./data/game.db");
const wallet = (n: number) => "0x" + n.toString(16).padStart(40, "0");
const sessionKey = (n: number) => "0x" + (n + 0xa00).toString(16).padStart(40, "0");

const tables = [
  { id: "101", buyIn: 1_000_000_000_000_000n, hands: 10, players: 1 }, // 0.001 ETH
  { id: "102", buyIn: 2_000_000_000_000_000n, hands: 5, players: 3 },  // 0.002 ETH, one seat left
];

let t = Date.now();
for (const tb of tables) {
  if (loadGame(db, tb.id)) { console.log(`table ${tb.id} already exists`); continue; }
  createGame(db, { tableId: tb.id, creator: wallet(Number(tb.id) * 10), buyInWei: tb.buyIn, totalHands: tb.hands }, t++);
  for (let seat = 0; seat < tb.players; seat++) {
    const n = Number(tb.id) * 10 + seat;
    addPlayer(db, { tableId: tb.id, seat: seat as 0 | 1 | 2 | 3, wallet: wallet(n), sessionKey: sessionKey(n) });
  }
  console.log(`created table ${tb.id} with ${tb.players}/4 seats`);
}
db.close();