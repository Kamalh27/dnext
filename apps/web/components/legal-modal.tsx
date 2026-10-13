import { Modal } from "./modal";
import { legal, type LegalKind } from "@/lib/legal";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

export function LegalModal({ lang, kind, onClose }: { lang: Lang; kind: LegalKind | null; onClose: () => void }) {
  const tr = t(lang);
  const doc = kind ? legal[lang].docs[kind] : null;
  return (
    <Modal open={!!doc} onClose={onClose} title={doc?.title ?? ""} closeLabel={tr.close}>
      {doc && (
        <article className="space-y-5 px-5 py-4 text-sm leading-relaxed">
          <p className="text-xs text-muted-foreground">{legal[lang].updated}</p>
          {doc.sections.map((s) => (
            <section key={s.h}>
              <h3 className="mb-1.5 font-semibold">{s.h}</h3>
              {s.p?.map((x) => <p key={x} className="text-foreground/90">{x}</p>)}
              {s.ul && <ul className="list-disc space-y-1 pl-5 text-foreground/90">{s.ul.map((x) => <li key={x}>{x}</li>)}</ul>}
            </section>
          ))}
        </article>
      )}
    </Modal>
  );
}
