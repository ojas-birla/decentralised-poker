import type { Metadata } from "next";
import "./globals.css";
import { SocketProvider } from "@/components/SocketProvider";
import { WalletProvider } from "@/components/WalletProvider";

export const metadata: Metadata = {
  title: "Decentralised Poker",
  description: "4-player Texas Hold'em with padlock shuffling and on-chain escrow",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <SocketProvider>
            <main className="mx-auto max-w-5xl p-6">{children}</main>
          </SocketProvider>
        </WalletProvider>
      </body>
    </html>
  );
}