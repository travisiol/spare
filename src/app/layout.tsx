import type { Metadata, Viewport } from "next";
import { Bodoni_Moda, DM_Sans } from "next/font/google";
import "./globals.css";

const bodoni = Bodoni_Moda({ variable: "--font-bodoni", subsets: ["latin"], axes: ["opsz"], display: "swap" });
const dmSans = DM_Sans({ variable: "--font-dm-sans", subsets: ["latin"], axes: ["opsz"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "SPARE — Keep the change. Own the company.", template: "%s · SPARE" },
  description: "SPARE rounds up your everyday purchases and, once a week with your approval, turns the change into tokenized stock.",
};

export const viewport: Viewport = { themeColor: "#E7EFF5" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${bodoni.variable} ${dmSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
