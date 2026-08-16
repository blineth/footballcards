import { AppHeader } from "@/components/app-header"
import { BottomNav } from "@/components/bottom-nav"
import { FixturesView } from "@/components/fixtures-view"
import { formatMatchDate, londonToday } from "@/lib/date"
import Link from "next/link"
import { Suspense } from "react"

export const dynamic = "force-dynamic"

export default function HomePage() {
  const today = londonToday()
  return (
    <div className="min-h-screen pb-20">
      <AppHeader
        title="Football Cards"
        subtitle={`Today · ${formatMatchDate(today)}`}
        right={
          <Link
            href="/admin/import"
            className="rounded-full bg-navy-foreground/10 px-3 py-1.5 text-xs font-semibold text-navy-foreground transition-colors hover:bg-navy-foreground/20"
          >
            Import
          </Link>
        }
      />
      <main className="mx-auto max-w-lg px-4 py-4">
        <Suspense fallback={null}>
          <FixturesView />
        </Suspense>
      </main>
      <Suspense fallback={null}>
        <BottomNav />
      </Suspense>
    </div>
  )
}
