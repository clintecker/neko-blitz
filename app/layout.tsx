import type { ReactNode } from "react";
import "./globals.css";
import "./cabinet.css";
import "./small-screens.css";
import "./game-screen.css";
import "./club-lobby.css";

// Link unfurls need absolute URLs, so every shared art path resolves
// against the canonical origin instead of the request host.
const origin = "https://neko-blitz.clint-419.workers.dev";
const shareTitle = "Neko Blitz — a neon Thirty-One card club";
const shareDescription =
  "A neon Thirty-One card club with public-information strategy, " +
  "online friends and an evolving synth soundtrack.";
const shareImage = {
  url: "/art/og-neko-blitz.jpg",
  width: 1216,
  height: 640,
};

export const metadata = {
  metadataBase: new URL(origin),
  title: "BLITZ · Neko Arcade",
  description:
    "Play Thirty-One with the night crew at Neko Arcade. Draw, discard, or knock with a coach that reads the table.",
  icons: { icon: "/art/card-cat.png" },
  openGraph: {
    type: "website",
    url: origin,
    siteName: "Neko Blitz",
    title: shareTitle,
    description: shareDescription,
    images: [shareImage],
  },
  twitter: {
    card: "summary_large_image",
    title: shareTitle,
    description: shareDescription,
    images: [shareImage],
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#100e1c",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
