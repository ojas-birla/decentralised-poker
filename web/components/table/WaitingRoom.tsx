"use client";

import { SEATS } from "@/lib/lobby";
import { weiToEth } from "@/lib/createTable";
import { WaitingRoomState, bannerText, countWhere, filledSeats } from "@/lib/waitingRoom";
import SeatCard from "./SeatCard";

export default function WaitingRoom({
  room,
  myAddress,
}: {
  room: WaitingRoomState;
  myAddress: string | null;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Table #{room.tableId}: waiting room</h1>
        <p className="text-sm text-gray-600">
          Buy-in {weiToEth(room.buyInWei)} test ETH · {room.hands} hands · {filledSeats(room)}/
          {SEATS} seats filled
        </p>
      </div>

      <p className="rounded border border-blue-500 p-3 text-sm">{bannerText(room)}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        {room.seats.map((s, i) => (
          <SeatCard
            key={i}
            index={i}
            seat={s}
            isYou={!!myAddress && s.address === myAddress}
          />
        ))}
      </div>

      <p className="text-sm text-gray-600">
        Deposited {countWhere(room, "deposited")}/{SEATS} · Ready {countWhere(room, "ready")}/
        {SEATS}
      </p>
    </div>
  );
}