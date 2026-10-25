import type { Metadata } from "next";
import "./globals.css";
import { SocketProvider } from "@/components/SocketProvider";
import { WalletProvider } from "@/components/WalletProvider";

// Fonts are loaded by the browser from Google Fonts (see the <link> below) instead of by
// next/font, so the build never has to download anything. The --font-* variables are
// defined in globals.css.
const FONTS_URL =
  "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Playfair+Display:wght@600;700;800&family=Space+Grotesk:wght@400;500;600;700&display=swap";

export const metadata: Metadata = {
  title: "Decentralised Poker",
  description: "4-player Texas Hold'em with padlock shuffling and on-chain escrow",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={FONTS_URL} />
      </head>
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
