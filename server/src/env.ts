// server/src/env.ts
// Loads server/.env and exports typed config. Import this instead of reading process.env elsewhere.
import { config } from "dotenv";

config(); // reads .env from the working directory (npm run ... -w server runs in server/)

const str = (name: string, fallback: string): string => {
  const v = process.env[name];
  return v !== undefined && v.trim() !== "" ? v.trim() : fallback;
};

export const RPC_URL = str("RPC_URL", "https://sepolia.base.org");
export const CONTRACT_ADDRESS = str("CONTRACT_ADDRESS", "0x0000000000000000000000000000000000000000");
export const PORT = Number(str("PORT", "4000"));
export const DB_PATH = str("DB_PATH", "./data/game.db");
export const WEB_ORIGIN = str("WEB_ORIGIN", "http://localhost:3000"); // comma-separated for several
/** POKER_SKIP_CHAIN=1 disables the chain watcher (bot tests with --seed). */
export const SKIP_CHAIN = process.env.POKER_SKIP_CHAIN === "1";
/** How many blocks deep a deposit must be before the server counts it (Base Sepolia: 2 blocks is about 4 s). */
export const CHAIN_CONFIRMATIONS = Math.max(0, Number(str("CHAIN_CONFIRMATIONS", "2")) || 0);
