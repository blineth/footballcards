"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

export function AppTabs() {
  const pathname = usePathname()
  const tabs = [
    { href: "/", label: "Matches" },
    { href: "/bet-builder", label: "Bet Builder" },
    { href: "/multi-match", label: "Multi Match" },
  ]

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-[#07120e]/95 px-3 pb-[max(0.6rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl">
      <div className="mx-auto grid max-w-2xl grid-cols-3 gap-2">
        {tabs.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`rounded-xl px-2 py-2.5 text-center text-[0.7rem] font-extrabold transition ${active ? "bg-emerald-400 text-emerald-950 shadow-sm" : "bg-white/5 text-white/45"}`}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
