/** Search in the province picker: English or Thai name, in either language setting, best matches first. */
import type { Province } from "./types.ts";

const norm = (s: string) => s.normalize("NFC").toLowerCase().trim();

export function filterProvinces(list: Province[], query: string, lang: "en" | "th"): Province[] {
  const q = norm(query);
  const label = (p: Province) => norm(lang === "th" ? p.name_th || p.name : p.name);
  if (!q) return list;
  const scored: [number, Province][] = [];
  for (const p of list) {
    const names = [norm(p.name), norm(p.name_th || "")];
    let score = -1;
    if (names.some((n) => n === q)) score = 0;
    else if (names.some((n) => n.startsWith(q))) score = 1;
    else if (names.some((n) => n.split(/[\s-]+/).some((w) => w.startsWith(q)))) score = 2;
    else if (names.some((n) => n.includes(q))) score = 3;
    if (score >= 0) scored.push([score, p]);
  }
  return scored.sort((a, b) => a[0] - b[0] || label(a[1]).localeCompare(label(b[1]), lang)).map(([, p]) => p);
}
