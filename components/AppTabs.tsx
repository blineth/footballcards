"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { BarChart3, CalendarDays, Sparkles, TicketCheck } from "lucide-react"

export function AppTabs() {
  const pathname = usePathname()
  const tabs = [
    { href: "/", label: "Matches", icon: CalendarDays },
    { href: "/multi-match", label: "Multi", icon: Sparkles },
    { href: "/accumulator", label: "Accas", icon: TicketCheck },
    { href: "/performance", label: "Results", icon: BarChart3 },
  ]

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-[#07120e]/95 px-3 pb-[max(0.55rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl">
      <div className="mx-auto grid max-w-3xl grid-cols-4 gap-1.5">
        {tabs.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href)
          const Icon=tab.icon
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-[0.62rem] font-extrabold transition ${active ? "bg-emerald-400 text-emerald-950 shadow-sm" : "text-white/45 hover:bg-white/5 hover:text-white/70"}`}
            >
              <Icon className="size-4" strokeWidth={active?2.6:2}/>
              <span>{tab.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
