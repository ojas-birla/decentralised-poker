"use client";

import { Banner } from "@/lib/statusLog";
import CountdownTimer from "./CountdownTimer";

const STYLES = {
  info: "bg-blue-600 text-white",
  warn: "bg-amber-400 text-slate-900",
  error: "bg-red-600 text-white",
} as const;

export default function StatusBanner({ banner }: { banner: Banner | null }) {
  if (!banner) return null;
  return (
    <div
      role={banner.level === "error" ? "alert" : "status"}
      className={`rounded-xl px-4 py-2 text-center text-sm font-medium ${STYLES[banner.level]}`}
    >
      {banner.text}
      {banner.deadlineMs !== undefined && (
        <>
          {" "}
          Time left: <CountdownTimer deadlineMs={banner.deadlineMs} />
        </>
      )}
    </div>
  );
}