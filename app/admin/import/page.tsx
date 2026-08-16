"use client"

import { useMemo, useRef, useState } from "react"
import useSWR from "swr"
import { AppHeader } from "@/components/app-header"
import { Button } from "@/components/ui/button"
import { fetcher } from "@/lib/fetcher"
import { CheckCircle2, Database, FileUp, Loader2 } from "lucide-react"

type Dataset = "player_baselines" | "h2h" | "referees" | "player_referee_history"
type Format = "csv" | "json"

interface CountsResponse {
  connected: boolean
  counts: Record<Dataset, number> | null
}

const datasetInfo: Record<Dataset, { title: string; description: string; template: string }> = {
  player_baselines: {
    title: "Player baselines",
    description: "Season totals: cards, fouls, minutes, starts and per-90 figures.",
    template: "player_baselines.csv",
  },
  h2h: {
    title: "Player H2H",
    description: "Individual player-v-opponent match history with fouls and cards.",
    template: "h2h.csv",
  },
  referees: {
    title: "Referees",
    description: "Referee card/foul tendencies by season and competition.",
    template: "referees.csv",
  },
  player_referee_history: {
    title: "Player × referee",
    description: "Whether specific referees have previously booked specific players.",
    template: "player_referee_history.csv",
  },
}

export default function ImportPage() {
  const { data, mutate } = useSWR<CountsResponse>("/api/admin/import", fetcher)
  const [dataset, setDataset] = useState<Dataset>("player_baselines")
  const [format, setFormat] = useState<Format>("csv")
  const [content, setContent] = useState("")
  const [fileName, setFileName] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const total = useMemo(() => {
    if (!data?.counts) return 0
    return Object.values(data.counts).reduce((sum, n) => sum + n, 0)
  }, [data?.counts])

  async function chooseFile(file: File | undefined) {
    if (!file) return
    setFileName(file.name)
    setFormat(file.name.toLowerCase().endsWith(".json") ? "json" : "csv")
    setContent(await file.text())
    setMessage(null)
  }

  async function submit() {
    if (!content.trim()) {
      setMessage({ type: "error", text: "Choose a CSV or JSON file first." })
      return
    }
    setSubmitting(true)
    setMessage(null)
    try {
      const response = await fetch("/api/admin/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataset, format, content }),
      })
      const body = await response.json()
      if (!response.ok || !body.ok) throw new Error(body.error || "Import failed")
      setMessage({ type: "success", text: `Imported ${body.rows} rows into ${datasetInfo[dataset].title}.` })
      setContent("")
      setFileName("")
      await mutate()
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Import failed." })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-lg pb-24">
      <AppHeader
        title="Import research data"
        subtitle="Load the historical library into Neon"
        back={{ href: "/", label: "Today" }}
      />

      <div className="space-y-5 p-4">
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-navy text-navy-foreground">
              <Database className="size-5" />
            </div>
            <div>
              <p className="font-bold text-foreground">{data?.connected ? "Neon connected" : "Database not connected"}</p>
              <p className="text-xs text-muted-foreground">
                {data?.connected ? `${total.toLocaleString()} historical records currently stored` : "Add DATABASE_URL in Vercel first."}
              </p>
            </div>
          </div>

          {data?.counts ? (
            <div className="mt-4 grid grid-cols-2 gap-2">
              {(Object.keys(datasetInfo) as Dataset[]).map((key) => (
                <div key={key} className="rounded-xl bg-secondary p-3">
                  <p className="font-mono text-xl font-bold tabular-nums text-foreground">
                    {(data.counts?.[key] ?? 0).toLocaleString()}
                  </p>
                  <p className="mt-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
                    {datasetInfo[key].title}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h2 className="text-base font-bold text-foreground">1. Choose dataset</h2>
          <div className="mt-3 grid gap-2">
            {(Object.keys(datasetInfo) as Dataset[]).map((key) => (
              <button
                type="button"
                key={key}
                onClick={() => {
                  setDataset(key)
                  setMessage(null)
                }}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  dataset === key ? "border-primary bg-primary/5" : "border-border bg-card"
                }`}
              >
                <p className="text-sm font-bold text-foreground">{datasetInfo[key].title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{datasetInfo[key].description}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h2 className="text-base font-bold text-foreground">2. Select CSV or JSON</h2>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.json,text/csv,application/json"
            className="hidden"
            onChange={(event) => chooseFile(event.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-secondary/50 px-4 py-8 text-sm font-bold text-foreground"
          >
            <FileUp className="size-5" />
            {fileName || "Choose file"}
          </button>
          <p className="mt-2 text-xs text-muted-foreground">
            Expected template: <span className="font-mono">{datasetInfo[dataset].template}</span>
          </p>
        </section>

        {message ? (
          <div
            className={`rounded-2xl border p-4 text-sm ${
              message.type === "success"
                ? "border-strong/30 bg-strong/10 text-strong"
                : "border-destructive/30 bg-destructive/10 text-destructive"
            }`}
          >
            <div className="flex items-start gap-2">
              {message.type === "success" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : null}
              <span>{message.text}</span>
            </div>
          </div>
        ) : null}

        <Button className="h-12 w-full rounded-2xl font-bold" disabled={submitting || !content || !data?.connected} onClick={submit}>
          {submitting ? <Loader2 className="mr-2 size-4 animate-spin" /> : <FileUp className="mr-2 size-4" />}
          Import {datasetInfo[dataset].title}
        </Button>

        <p className="rounded-xl bg-secondary px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          Missing cells are stored as missing data, not zero. Keep previous-league history for promoted and relegated clubs so the radar has useful baselines before new-season samples grow.
        </p>
      </div>
    </main>
  )
}
