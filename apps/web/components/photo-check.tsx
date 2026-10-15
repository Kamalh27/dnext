"use client";

import { useRef, useState } from "react";
import { Camera, ImagePlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError, photoCheck } from "@/lib/api";
import { gate } from "@/lib/auth";
import { resizeToJpeg } from "@/lib/image";
import { t } from "@/lib/i18n";
import { apiErrorText } from "@/lib/limit-text";
import { riskName } from "@/lib/overview";
import { classOfRisk } from "@/lib/svgmap";
import type { Lang, PhotoResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Modal } from "./modal";

const sevText = (tr: ReturnType<typeof t>) => ({ low: tr.sevLow, moderate: tr.sevModerate, high: tr.sevHigh }) as const;
const lvlText = (tr: ReturnType<typeof t>) => ({ low: tr.lvlLow, medium: tr.lvlMedium, high: tr.lvlHigh }) as const;
const SEVERITY = { low: "bg-yellow-100 text-yellow-900", moderate: "bg-orange-200 text-orange-950", high: "bg-red-200 text-red-950" } as const;

/** Markdown for the chat when the person adds the result to the conversation. */
export function photoMarkdown(r: PhotoResult, lang: Lang): string {
  const tr = t(lang);
  const lines = [`**${tr.photoTitle}**`, "", r.analysis.summary, ""];
  for (const o of r.analysis.observations) lines.push(`- **${o.sign}** (${sevText(tr)[o.severity]}): ${o.evidence}`);
  if (r.context) lines.push("", `${tr.photoContext}: ${riskName(Math.max(1, classOfRisk(r.context.peak_risk)), lang)} (${r.context.peak_risk.toFixed(1)})`);
  lines.push("", `_${r.disclaimer}_`);
  return lines.join("\n");
}

export function PhotoCheckModal({ lang, open, onClose, scenarioId, onAddToChat }: {
  lang: Lang; open: boolean; onClose: () => void; scenarioId?: string; onAddToChat: (markdown: string) => void;
}) {
  const tr = t(lang);
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ b64: string; dataUrl: string } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PhotoResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setPreview(null); setNote(""); setResult(null); setError(null); setBusy(false); };
  const close = () => { reset(); onClose(); };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setResult(null);
    setError(null);
    try { setPreview(await resizeToJpeg(file)); } catch { setError(tr.photoBad); }
  };
  const analyse = async () => {
    if (!preview || busy) return;
    if (!gate()) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await photoCheck({ image_b64: preview.b64, language: lang, note: note.trim() || undefined, scenario_id: scenarioId }));
    } catch (e) {
      if (!(e instanceof ApiError && e.isAuthRequired)) setError(e instanceof ApiError && (e.isBurst || e.isDaily) ? apiErrorText(e, lang, 0) : tr.photoFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title={tr.photoTitle} closeLabel={tr.close}>
      <div className="space-y-4 px-5 py-4 text-sm">
        <p className="text-muted-foreground">{tr.photoIntro}</p>
        <input ref={input} type="file" accept="image/*" capture="environment" className="sr-only" data-testid="photo-input" onChange={(e) => void pick(e.target.files?.[0])} />
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview.dataUrl} alt={tr.photoTitle} className="mx-auto max-h-64 rounded-lg border object-contain" />
        ) : (
          <button type="button" onClick={() => input.current?.click()}
            className="flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
            <Camera className="size-6" aria-hidden />{tr.photoChoose}
          </button>
        )}
        {preview && !result && (
          <>
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">{tr.photoNote}</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className="mt-1 h-9 w-full rounded-md border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void analyse()} disabled={busy} data-testid="photo-analyse">
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}{busy ? tr.photoBusy : tr.photoAnalyse}
              </Button>
              <Button variant="outline" onClick={() => input.current?.click()} disabled={busy}><ImagePlus className="size-4" aria-hidden />{tr.photoOther}</Button>
            </div>
          </>
        )}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {result && (
          <div className="space-y-3" data-testid="photo-result">
            <p className="font-medium">{result.analysis.scene}</p>
            {result.analysis.looks_manipulated_or_unrelated && <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-950">{tr.photoUnrelated}</p>}
            {result.analysis.observations.length > 0 ? (
              <ul className="space-y-2">
                {result.analysis.observations.map((o, i) => (
                  <li key={i} className="rounded-lg border px-3 py-2">
                    <p className="flex items-center gap-2 font-medium">{o.sign}<span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", SEVERITY[o.severity])}>{sevText(tr)[o.severity]}</span></p>
                    <p className="mt-0.5 text-muted-foreground">{o.evidence}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">{tr.photoNothing}</p>
            )}
            <p>{result.analysis.summary}</p>
            <p className="text-xs text-muted-foreground">{tr.photoConfidence}: {lvlText(tr)[result.analysis.confidence]}</p>
            {result.context && (
              <p className="rounded-lg bg-muted px-3 py-2">
                {tr.photoContext}: <b>{lang === "th" ? result.context.area_th || result.context.area : result.context.area}</b> · {riskName(Math.max(1, classOfRisk(result.context.peak_risk)), lang)} ({result.context.peak_risk.toFixed(1)})
              </p>
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">{result.disclaimer}</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => { onAddToChat(photoMarkdown(result, lang)); close(); }}>{tr.photoAddToChat}</Button>
              <Button variant="outline" onClick={reset}>{tr.photoAnother}</Button>
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{tr.photoPrivacy}</p>
      </div>
    </Modal>
  );
}
