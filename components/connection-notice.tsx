import { AlertTriangle, Database, PlugZap } from "lucide-react"
import { cn } from "@/lib/utils"

type Variant = "live" | "historical" | "generic"

const config: Record<Variant, { icon: typeof PlugZap; title: string }> = {
  live: { icon: PlugZap, title: "Live data source not connected" },
  historical: { icon: Database, title: "Historical database is empty" },
  generic: { icon: AlertTriangle, title: "Data unavailable" },
}

export function ConnectionNotice({
  variant = "generic",
  message,
  nextStep,
  className,
}: {
  variant?: Variant
  message: string
  nextStep?: string
  className?: string
}) {
  const { icon: Icon, title } = config[variant]
  return (
    <div
      className={cn(
        "flex gap-3 rounded-2xl border border-dashed border-border bg-card p-4",
        className,
      )}
      role="status"
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
        <Icon className="size-4.5" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground text-pretty">{message}</p>
        {nextStep ? (
          <p className="mt-2 text-xs font-medium text-primary text-pretty">Next step: {nextStep}</p>
        ) : null}
      </div>
    </div>
  )
}
