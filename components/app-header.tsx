import { cn } from "@/lib/utils"
import Link from "next/link"
import type { ReactNode } from "react"

interface AppHeaderProps {
  title: string
  subtitle?: string
  back?: { href: string; label?: string }
  right?: ReactNode
  className?: string
}

export function AppHeader({ title, subtitle, back, right, className }: AppHeaderProps) {
  return (
    <header className={cn("sticky top-0 z-30 bg-navy text-navy-foreground", className)}>
      <div className="mx-auto max-w-lg px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {back ? (
              <Link
                href={back.href}
                className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-navy-foreground/70 transition-colors hover:text-navy-foreground"
              >
                <span aria-hidden>&larr;</span>
                {back.label ?? "Back"}
              </Link>
            ) : null}
            <h1 className="text-balance text-xl font-bold leading-tight tracking-tight">{title}</h1>
            {subtitle ? (
              <p className="mt-0.5 text-sm text-navy-foreground/70">{subtitle}</p>
            ) : null}
          </div>
          {right ? <div className="shrink-0">{right}</div> : null}
        </div>
      </div>
    </header>
  )
}
