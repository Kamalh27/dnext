"use client";

import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchTrend } from "@/lib/api";
import { t } from "@/lib/i18n";
import { riskName } from "@/lib/overview";
import type { Lang, Province, Trend } from "@/lib/types";

/** The last 30 days of a province's peak risk, from the BigQuery history the daily job writes. Shows nothing when there is no history store. */
export function TrendCard({ lang, province }: { lang: Lang; province: Province }) {
  const tr = t(lang);
  const [state, setState] = useState<{ pcode: string; trend: Trend | null }>({ pcode: "", trend: null });
  useEffect(() => {
    let live = true;
    fetchTrend(province.pcode).then((tr_) => live && setState({ pcode: province.pcode, trend: tr_ })).catch(() => live && setState({ pcode: province.pcode, trend: null }));
    return () => { live = false; };
  }, [province.pcode]);
  const trend = state.pcode === province.pcode ? state.trend : null;
  if (!trend?.available) return null;
  const days = trend.days;
  const name = lang === "th" ? province.name_th || province.name : province.name;
  const nf = new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-GB", { day: "numeric", month: "short" });
  const data = days.map((d) => ({ ...d, label: nf.format(new Date(`${d.date}T00:00:00`)) }));
  return (
    <section aria-label={tr.trendTitle} data-testid="trend-card" className="rounded-xl border bg-card p-3.5 shadow-xs">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{tr.trendTitle}: {name}</h3>
      {days.length < 2 ? (
        <p className="mt-2 text-sm text-muted-foreground">{tr.trendBuilding}</p>
      ) : (
        <div className="mt-2 h-36" role="img" aria-label={`${tr.trendTitle}: ${name}`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={24} />
              <YAxis domain={[0, 5]} ticks={[0, 1, 2, 3, 4, 5]} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v) => [`${v}`, tr.trendPeak]} labelFormatter={(l, p) => `${l} · ${p?.[0]?.payload?.risk_class ? riskName(p[0].payload.risk_class, lang) : "—"}`} />
              <Line type="monotone" dataKey="risk_max" stroke="#bd0026" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">{tr.trendNote}</p>
    </section>
  );
}
