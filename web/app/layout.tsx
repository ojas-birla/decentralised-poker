import type { Metadata } from "next";
import { JetBrains_Mono, Playfair_Display, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { SocketProvider } from "@/components/SocketProvider";
import { WalletProvider } from "@/components/WalletProvider";

// Fonts for the poker table. They only define CSS variables here, so the
// rest of the app keeps its default font.
const grotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-grotesk", display: "swap" });
const display = Playfair_Display({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-table", display: "swap" });

export const metadata: Metadata = {
  title: "Decentralised Poker",
  description: "4-player Texas Hold'em with padlock shuffling and on-chain escrow",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${grotesk.variable} ${display.variable} ${mono.variable}`}>
        <WalletProvider>
          <SocketProvider>
            <main className="mx-auto max-w-5xl p-6">{children}</main>
          </SocketProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
