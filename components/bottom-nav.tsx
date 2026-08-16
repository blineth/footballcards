"use client"

import { cn } from "@/lib/utils"
import { CalendarDays, Shield, Trophy, Users } from "lucide-react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"

const items = [
  { label: "Today", href: "/", icon: CalendarDays, match: (p: string, q: string) => p === "/" && !q },
  {
    label: "Premier League",
    href: "/?league=premier-league",
    icon: Trophy,
    match: (p: string, q: string) => p === "/" && q === "premier-league",
  },
  {
    label: "Championship",
    href: "/?league=championship",
    icon: Shield,
    match: (p: string, q: string) => p === "/" && q === "championship",
  },
  { label: "Players", href: "/players", icon: Users, match: (p: string) => p.startsWith("/players") },
]

export function BottomNav() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const league = searchParams.get("league") ?? ""

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80"
    >
      <ul className="mx-auto flex max-w-lg items-stretch justify-between px-2 pb-[env(safe-area-inset-bottom)]">
        {items.map((item) => {
          const active = item.match(pathname, league)
          const Icon = item.icon
          return (
            <li key={item.label} className="flex-1">
              <Link
                href={item.href}
                className={cn(
                  "flex flex-col items-center gap-1 py-2.5 text-[0.65rem] font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="size-5" strokeWidth={active ? 2.4 : 1.9} />
                <span className="leading-none text-pretty text-center">{item.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
