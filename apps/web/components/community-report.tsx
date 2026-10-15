"use client";

import { useEffect, useRef, useState } from "react";
import { AdvancedMarker, InfoWindow, Pin } from "@vis.gl/react-google-maps";
import { Camera, ImagePlus, Loader2, LocateFixed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError, fetchCommunityReports, flagCommunityReport, submitCommunityReport } from "@/lib/api";
import { gate } from "@/lib/auth";
import { fmt, t } from "@/lib/i18n";
import { resizeToJpeg } from "@/lib/image";
import { apiErrorText } from "@/lib/limit-text";
import { reportReasonKey, timeAgo } from "@/lib/safe";
import type { CommunityReport, Lang, ReportKind, ReportVerdict } from "@/lib/types";
import { Modal } from "./modal";
import type { Pt } from "./map-controls";

const KIND_COLOR: Record<ReportKind, string> = { landslide: "#c62828", road_blocked: "#ef6c00", slope_damage: "#8d6e63" };
const kindText = (k: ReportKind, tr: ReturnType<typeof t>) => ({ landslide: tr.reportKindLandslide, road_blocked: tr.reportKindRoad, slope_damage: tr.reportKindSlope })[k];

export function ReportModal({ lang, open, onClose, me, centre, onDone }: {
  lang: Lang; open: boolean; onClose: () => void; me: Pt | null; centre: () => Pt | null; onDone: () => void;
}) {
  const tr = t(lang);
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ b64: string; dataUrl: string } | null>(null);
  const [place, setPlace] = useState<Pt | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<ReportVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setPreview(null); setPlace(null); setNote(""); setVerdict(null); setError(null); setBusy(false); };
  const close = () => { reset(); onClose(); };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try { setPreview(await resizeToJpeg(file)); } catch { setError(tr.photoBad); }
  };
  const useMe = () => {
    if (me) return setPlace(me);
    if (!navigator.geolocation) return setError(tr.locationFail);
    navigator.geolocation.getCurrentPosition(
      (pos) => setPlace({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => setError(err.code === err.PERMISSION_DENIED ? tr.locationDenied : tr.locationFail),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };
  const send = async () => {
    if (!preview || busy) return;
    if (!place) return setError(tr.reportNeedPlace);
    if (!gate()) return;
    setBusy(true); setError(null);
    try {
      const v = await submitCommunityReport({ image_b64: preview.b64, lat: place.lat, lng: place.lng, language: lang, note: note.trim() || undefined });
      setVerdict(v);
      if (v.status === "published") onDone();
    } catch (e) {
      if (!(e instanceof ApiError && e.isAuthRequired)) setError(e instanceof ApiError && (e.isBurst || e.isDaily) ? apiErrorText(e, lang, 0) : tr.photoFailed);
    } finally {
      setBusy(false);
    }
  };

  const why = verdict && verdict.status !== "published" ? tr[reportReasonKey(verdict.reason)] : null;

  return (
    <Modal open={open} onClose={close} title={tr.communityTitle} closeLabel={tr.close}>
      <div className="space-y-4 px-5 py-4 text-sm">
        <p className="text-muted-foreground">{tr.reportIntro}</p>
        <input ref={input} type="file" accept="image/*" capture="environment" className="sr-only" data-testid="report-input" onChange={(e) => void pick(e.target.files?.[0])} />
        {!verdict && (
          <>
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.dataUrl} alt={tr.communityTitle} className="mx-auto max-h-56 rounded-lg border object-contain" />
            ) : (
              <button type="button" onClick={() => input.current?.click()} className="flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
                <Camera className="size-6" aria-hidden />{tr.photoChoose}
              </button>
            )}
            {preview && (
              <>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{tr.reportPlace}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" onClick={useMe}><LocateFixed className="size-4" aria-hidden />{tr.reportUseMe}</Button>
                    <Button variant="outline" size="sm" onClick={() => { const c = centre(); if (c) setPlace(c); }}>{tr.reportUseCentre}</Button>
                    {place && <span className="text-xs text-emerald-700 dark:text-emerald-400" data-testid="report-place">{tr.reportPlaceSet}</span>}
                  </div>
                </div>
                <label className="block">
                  <span className="text-xs font-medium text-muted-foreground">{tr.photoNote}</span>
                  <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className="mt-1 h-9 w-full rounded-md border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void send()} disabled={busy} data-testid="report-send">{busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}{busy ? tr.reportBusy : tr.reportSend}</Button>
                  <Button variant="outline" onClick={() => input.current?.click()} disabled={busy}><ImagePlus className="size-4" aria-hidden />{tr.photoOther}</Button>
                </div>
              </>
            )}
          </>
        )}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {verdict && (
          <div className="space-y-3" data-testid="report-verdict" data-status={verdict.status}>
            <p className="font-medium">{verdict.status === "published" ? (verdict.merged ? tr.reportMerged : tr.reportPublished) : verdict.status === "review" ? tr.reportReview : tr.reportRejected}</p>
            {why && <p className="text-muted-foreground">{why}</p>}
            {verdict.summary && <p>{verdict.summary}</p>}
            <Button variant="outline" onClick={close}>{tr.close}</Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{tr.reportPrivacy}</p>
      </div>
    </Modal>
  );
}

/** Published community reports as markers; a click shows what the AI saw with the "not verified" note and a flag button. Renders inside <Map>. */
export function ReportMarkers({ lang, version }: { lang: Lang; version: number }) {
  const tr = t(lang);
  const [list, setList] = useState<CommunityReport[]>([]);
  const [open, setOpen] = useState<CommunityReport | null>(null);
  const [flagged, setFlagged] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    fetchCommunityReports().then((r) => live && setList(r.reports)).catch(() => live && setList([]));
    return () => { live = false; };
  }, [version]);

  const flag = async (id: string) => {
    if (!gate()) return;
    try { await flagCommunityReport(id); setFlagged((s) => new Set(s).add(id)); } catch { /* the button stays; a second try is fine */ }
  };

  return (
    <>
      {list.map((r) => (
        <AdvancedMarker key={r.id} position={{ lat: r.lat, lng: r.lng }} title={kindText(r.kind, tr)} onClick={() => setOpen(r)}>
          <Pin background={KIND_COLOR[r.kind]} borderColor="#fff" glyphColor="#fff" glyph="!" scale={0.85} />
        </AdvancedMarker>
      ))}
      {open && (
        <InfoWindow position={{ lat: open.lat, lng: open.lng }} onClose={() => setOpen(null)} headerContent={<b>{kindText(open.kind, tr)}</b>}>
          <div className="w-56 space-y-1.5 pr-1 text-xs break-words text-black">
            <p>{open.summary}</p>
            <p className="text-neutral-600">{(lang === "th" ? open.tambon_th || open.tambon : open.tambon) ?? ""} · {timeAgo(open.created, lang)}{open.confirmations > 0 ? ` · ${fmt(tr.reportConfirmed, { n: open.confirmations + 1 })}` : ""}</p>
            <p className="text-neutral-600">{tr.reportsNote}</p>
            {flagged.has(open.id) ? <p>{tr.reportFlagged}</p> : <button type="button" onClick={() => void flag(open.id)} className="underline underline-offset-2">{tr.reportFlag}</button>}
          </div>
        </InfoWindow>
      )}
    </>
  );
}
