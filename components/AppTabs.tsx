"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

export function AppTabs() {
  const pathname = usePathname()
  const tabs = [
    { href: "/", label: "Fixture radar" },
    { href: "/shortlist", label: "Card shortlist" },
  ]

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 px-4 pb-[max(0.6rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur">
      <div className="mx-auto grid max-w-2xl grid-cols-2 gap-2">
        {tabs.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`rounded-xl px-3 py-2.5 text-center text-xs font-extrabold transition ${active ? "bg-navy text-navy-foreground shadow-sm" : "bg-secondary text-muted-foreground"}`}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
