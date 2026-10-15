"use client";

import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { LogoMark } from "./logo";

/** Text the user can change before exporting: plain contenteditable, so what is on screen is what the PDF prints. */
export function Editable({ as: Tag = "p", text, className }: { as?: ElementType; text: string; className?: string }) {
  return <Tag contentEditable suppressContentEditableWarning spellCheck={false} className={cn("report-edit rounded-sm outline-none", className)}>{text}</Tag>;
}

export function ReportHeader({ title, chips, prepared }: { title: string; chips: { icon: ReactNode; text: string }[]; prepared: string }) {
  return (
    <header className="report-header -mx-6 -mt-6 rounded-t bg-primary px-6 pt-5 pb-5 text-primary-foreground sm:-mx-9 sm:-mt-9 sm:px-9 sm:pt-7">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <LogoMark className="size-9 rounded-lg" inverted />
          <div className="leading-tight">
            <p className="text-sm font-semibold tracking-wide">DNext</p>
            <p className="text-[11px] opacity-80">Landslide risk screening · Thailand</p>
          </div>
        </div>
        <p className="text-[11px] opacity-80">{prepared}</p>
      </div>
      <Editable as="h1" text={title} className="mt-5 text-[26px] leading-tight font-semibold" />
      <ul className="mt-3 flex flex-wrap gap-2">
        {chips.map((c, i) => (
          <li key={i} className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-medium">{c.icon}{c.text}</li>
        ))}
      </ul>
    </header>
  );
}

export function SectionHeading({ icon, n, title }: { icon: ReactNode; n: number; title: string }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 border-b-2 border-primary/25 pb-1.5 text-[15px] font-semibold text-neutral-900">
      <span className="inline-flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground" aria-hidden>{icon}</span>
      <span className="text-primary tabular-nums">{n}.</span>{title}
    </h2>
  );
}

export function KpiTile({ icon, label, value, tone = "neutral" }: { icon: ReactNode; label: string; value: string; tone?: "neutral" | "warn" }) {
  return (
    <div className={cn("report-block flex items-center gap-3 rounded-lg border px-3 py-2.5", tone === "warn" ? "border-amber-300 bg-amber-50" : "border-neutral-300 bg-neutral-50")}>
      <span className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-lg", tone === "warn" ? "bg-amber-200 text-amber-900" : "bg-primary/10 text-primary")} aria-hidden>{icon}</span>
      <div className="min-w-0">
        <dd className="text-[17px] leading-none font-semibold tabular-nums">{value}</dd>
        <dt className="mt-1 text-[11px] leading-tight text-neutral-600">{label}</dt>
      </div>
    </div>
  );
}

export function Callout({ icon, title, children, tone = "info" }: { icon: ReactNode; title: string; children: ReactNode; tone?: "info" | "note" }) {
  return (
    <aside className={cn("report-block rounded-lg border-l-4 px-4 py-3", tone === "info" ? "border-primary bg-primary/5" : "border-amber-500 bg-amber-50")}>
      <p className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-neutral-900"><span aria-hidden>{icon}</span>{title}</p>
      {children}
    </aside>
  );
}

export interface Cell { text: string; chip?: string }
/** A plain styled table (header band, zebra rows); a cell with `chip` shows a colour swatch, e.g. a risk class. */
export function ReportTable({ title, columns, rows, numeric = [] }: { title?: string; columns: string[]; rows: (string | number | Cell)[][]; numeric?: number[] }) {
  return (
    <div>
      {title && <p className="mb-1.5 text-[12px] font-semibold text-neutral-800 [break-after:avoid]">{title}</p>}
      <table className="w-full border-collapse text-[11.5px]">
        <thead>
          <tr>{columns.map((c, i) => <th key={i} className={cn("bg-primary px-2 py-1.5 font-semibold text-primary-foreground", numeric.includes(i) ? "text-right" : "text-left")}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className={ri % 2 ? "bg-neutral-50" : "bg-white"}>
              {r.map((c, ci) => {
                const cell = typeof c === "object" ? c : { text: String(c) };
                return (
                  <td key={ci} className={cn("border-b border-neutral-200 px-2 py-1 align-top", numeric.includes(ci) && "text-right tabular-nums")}>
                    {cell.chip && <i className="mr-1.5 inline-block size-2.5 rounded-sm border border-neutral-500 align-middle" style={{ background: cell.chip }} />}
                    {cell.text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Horizontal bars, drawn with plain boxes so they print sharply. */
export function BarList({ title, rows, unit }: { title: string; rows: { label: string; value: number; color?: string }[]; unit?: string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  const nf = new Intl.NumberFormat();
  return (
    <div className="report-block">
      <p className="mb-1.5 text-[12px] font-semibold text-neutral-800">{title}</p>
      <ul className="space-y-1">
        {rows.map((r, i) => (
          <li key={i} className="grid grid-cols-[8.5rem_1fr_4rem] items-center gap-2 text-[11px]">
            <span className="truncate" title={r.label}>{r.label}</span>
            <span className="h-3.5 rounded-sm bg-neutral-100"><span className="block h-full rounded-sm" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: r.color ?? "#8a5a2b" }} /></span>
            <span className="text-right tabular-nums">{nf.format(r.value)}{unit ? ` ${unit}` : ""}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
