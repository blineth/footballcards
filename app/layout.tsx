import { Analytics } from "@vercel/analytics/next"
import type { Metadata, Viewport } from "next"
import { Manrope, Geist_Mono } from "next/font/google"
import { AppTabs } from "@/components/AppTabs"
import "./globals.css"

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-sans",
})

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  title: "Match Edge | Bet Builder",
  description:
    "Confirmed-lineup football betting research for fouls, cards, shots and shots on target.",
  generator: "v0.app",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
}

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#07120e",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${manrope.variable} ${geistMono.variable} bg-background`}>
      <body className="font-sans antialiased">
        {children}
        <AppTabs />
        {process.env.NODE_ENV === "production" && <Analytics />}
      </body>
    </html>
  )
}
