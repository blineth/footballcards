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
  title: "Match Edge | Football Intelligence",
  description:
    "Football intelligence for match predictions, player props, live signals, target-odds builders and transparent model performance.",
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
