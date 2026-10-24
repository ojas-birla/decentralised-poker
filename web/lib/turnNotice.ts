// D5: "the seat whose turn it is has disconnected" -> a banner notice. Pure, so it is unit tested.
import type { GameState, PlayerPresence, TimerInfo } from "@poker/shared";
import type { TableNotice } from "@/lib/statusLog";

export function disconnectedTurnNotice(
  state: GameState,
  players: PlayerPresence[],
  timer: TimerInfo | null,
  mySeat: number | null
): TableNotice | null {
  const seat = state.toActSeat;
  if (seat === null || seat === mySeat) return null; // nobody to act, or it is your own turn

  // Presence events are fresher than the copy inside the state.
  const connected = players.find((p) => p.seat === seat)?.connected ?? state.seats[seat].connected;
  if (connected) return null;

  // Only trust the clock if it is the clock of that seat.
  const deadlineMs = timer && timer.seat === seat ? timer.deadline : undefined;
  return { kind: "seat_disconnected", seat, deadlineMs };
}
