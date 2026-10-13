import { ApiError } from "./api-error";
import { fmt, t } from "./i18n";
import type { Lang } from "./types";

/** "3 h" / "40 min": whole hours (rounded up) from an hour away, minutes below that. */
export function humanWhen(seconds: number | null | undefined, lang: Lang): string {
  const tr = t(lang);
  const s = Math.max(60, seconds ?? 3600);
  return s >= 3600 ? fmt(tr.whenH, { n: Math.ceil(s / 3600) }) : fmt(tr.whenMin, { n: Math.ceil(s / 60) });
}

/** User-facing text for a failed gated call, in the UI language. `burstLeft` is the live countdown for burst limits. */
export function apiErrorText(err: ApiError, lang: Lang, burstLeft = 0): string {
  const tr = t(lang);
  if (err.isAuthRequired) return tr.signInNeeded;
  if (err.isBurst) return burstLeft > 0 ? fmt(tr.limitBurst, { n: burstLeft }) : tr.limitBurstOver;
  if (err.isDaily) {
    const when = humanWhen(err.retryAfterS, lang);
    if (err.kind === "chat" || err.kind === "run")
      return fmt(err.kind === "chat" ? tr.limitChat : tr.limitRun, { used: err.used ?? err.limit ?? "", limit: err.limit ?? "", when });
    return fmt(tr.limitDaily, { when });
  }
  return err.message;
}
