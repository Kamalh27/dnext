"use client";

import { Slider } from "@/components/ui/slider";
import { t } from "@/lib/i18n";
import type { Lang, MapLayerItem } from "@/lib/types";
import { cn } from "@/lib/utils";

export type LayerPatch = { visible?: boolean; opacity?: number };

/** Compact legend strip: one chip per class colour. */
export function LegendStrip({ legend }: { legend: MapLayerItem["legend"] }) {
  if (!legend.length) return null;
  return (
    <span className="flex shrink-0 overflow-hidden rounded-[2px] border border-black/20" aria-hidden>
      {legend.slice(0, 6).map((l) => (
        <span key={l.label} className="h-3 w-2.5" style={{ background: l.color }} />
      ))}
    </span>
  );
}

function LayerRow({ l, lang, onChange }: { l: MapLayerItem; lang: Lang; onChange: (id: string, p: LayerPatch) => void }) {
  const tr = t(lang);
  return (
    <li className="space-y-1.5 px-3 py-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={l.visible}
          aria-label={`${tr.layerShow}: ${l.name}`}
          onClick={() => onChange(l.id, { visible: !l.visible })}
          className={cn(
            "relative h-4 w-7 shrink-0 rounded-full border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
            l.visible ? "border-primary bg-primary" : "border-border bg-muted",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "absolute top-1/2 left-0.5 size-3 -translate-y-1/2 rounded-full bg-white shadow transition-transform",
              l.visible && "translate-x-3",
            )}
          />
        </button>
        <span className={cn("min-w-0 flex-1 truncate font-medium", !l.visible && "text-muted-foreground")} title={l.name}>{l.name}</span>
        <LegendStrip legend={l.legend} />
      </div>
      <Slider
        aria-label={`${l.name}: ${tr.layerOpacity}`}
        min={0}
        max={1}
        step={0.05}
        disabled={!l.visible}
        value={[l.opacity]}
        onValueChange={(v) => onChange(l.id, { opacity: Array.isArray(v) ? v[0] : v })}
      />
    </li>
  );
}

/** Scenario and reference layers: visibility switch, opacity slider and legend swatch. Layout only: the parent owns open/close. */
export function LayersPanel({ id, lang, scenario, reference, onChange }: {
  id: string; lang: Lang; scenario: MapLayerItem[]; reference: MapLayerItem[]; onChange: (id: string, p: LayerPatch) => void;
}) {
  const tr = t(lang);
  const sections = [
    { key: "scenario", title: tr.layersScenario, items: scenario },
    { key: "reference", title: tr.layersReference, items: reference },
  ].filter((x) => x.items.length > 0);
  return (
    <div
      id={id}
      role="group"
      aria-label={tr.layersTitle}
      className="absolute top-0 right-full z-10 mr-2 flex max-h-[min(70dvh,26rem)] w-64 max-w-[calc(100vw-4.5rem)] flex-col overflow-hidden rounded-[4px] border bg-card/95 text-xs shadow-lg backdrop-blur-md"
    >
      <p className="border-b px-3 py-2 text-[13px] font-semibold">{tr.layersTitle}</p>
      <div className="overflow-y-auto">
        {sections.map((sec) => (
          <section key={sec.key} aria-labelledby={`${id}-${sec.key}`} className="border-b last:border-b-0">
            <h3 id={`${id}-${sec.key}`} className="bg-muted/60 px-3 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
              {sec.title}
            </h3>
            <ul className="divide-y">
              {sec.items.map((l) => <LayerRow key={l.id} l={l} lang={lang} onChange={onChange} />)}
            </ul>
          </section>
        ))}
        {sections.length === 0 && <p className="px-3 py-3 text-muted-foreground">{tr.layersNone}</p>}
      </div>
    </div>
  );
}
