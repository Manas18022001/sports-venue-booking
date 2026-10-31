import type { Metadata } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "../components/providers";
import { SiteFooter, SiteHeader } from "../components/site-shell";

export const metadata: Metadata = {
  title: { default: "Turfit — Make time to play", template: "%s | Turfit" },
  description:
    "Find a court, rally your people, and make time to play. Discover sports venues and book your next game with Turfit.",
};
export const viewport = { themeColor: "#183f34" };
const manrope = localFont({
  src: "../../public/fonts/manrope-variable.ttf",
  variable: "--font-manrope",
  display: "swap",
  weight: "200 800",
});

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className={manrope.variable}>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <Providers>
          <SiteHeader />
          <div id="main-content" tabIndex={-1}>
            {children}
          </div>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
