import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./cabinet.css";
import "./small-screens.css";
import "./game-screen.css";
import "./club-lobby.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#100e1c",
};

export const metadata: Metadata = {
  title: "BLITZ · Neko Arcade",
  description:
    "Play Thirty-One with the night crew at Neko Arcade. Draw, discard, or knock with a coach that reads the table.",
  icons: { icon: "/art/card-cat.png" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
