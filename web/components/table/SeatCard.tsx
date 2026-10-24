"use client";

import { SeatView } from "@/lib/waitingRoom";

function shortAddress(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function Status({ label, on }: { label: string; on: boolean }) {
  return (
    <li className="flex items-center justify-between text-sm">
      <span>{label}</span>
      <span className={on ? "font-medium text-green-600" : "text-gray-500"}>
        {on ? "Yes ✓" : "No"}
      </span>
    </li>
  );
}

export default function SeatCard({
  index,
  seat,
  isYou,
}: {
  index: number;
  seat: SeatView;
  isYou: boolean;
}) {
  if (seat.address === null) {
    return (
      <div className="rounded border border-dashed p-4 text-sm text-gray-500">
        <p className="font-medium">Seat {index + 1}</p>
        <p className="mt-2">Empty. Waiting for a player to join.</p>
      </div>
    );
  }

  return (
    <div className={`rounded border p-4 ${isYou ? "border-black" : ""}`}>
      <div className="flex items-center justify-between">
        <p className="font-medium">
          Seat {index + 1}
          {index === 0 && <span className="ml-2 text-xs text-gray-500">(creator)</span>}
        </p>
        {isYou && <span className="rounded bg-black px-2 py-0.5 text-xs text-white">You</span>}
      </div>
      <p className="mt-1 font-mono text-xs text-gray-600">{shortAddress(seat.address)}</p>
      <ul className="mt-3 space-y-1">
        <Status label="Connected" on={seat.connected} />
        <Status label="Deposited" on={seat.deposited} />
        <Status label="Ready" on={seat.ready} />
      </ul>
    </div>
  );
}