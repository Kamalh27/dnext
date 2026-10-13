import { Modal } from "./modal";
import { LogoMark } from "./logo";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

const link = "font-medium underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function AboutModal({ lang, open, onClose }: { lang: Lang; open: boolean; onClose: () => void }) {
  const tr = t(lang);
  return (
    <Modal open={open} onClose={onClose} title={tr.aboutTitle} closeLabel={tr.close}>
      <div className="space-y-5 px-5 py-4 text-sm leading-relaxed">
        <div className="flex items-center gap-3">
          <LogoMark className="size-12" />
          <div>
            <p className="text-lg font-semibold tracking-tight">DNext · LandslideWatch TH</p>
            <p className="text-muted-foreground">{tr.aboutTagline}</p>
          </div>
        </div>
        <p>{tr.aboutIntro}</p>
        <section>
          <h3 className="mb-1.5 font-semibold">{tr.aboutHowTitle}</h3>
          <ul className="list-disc space-y-1 pl-5">{tr.aboutHow.map((x) => <li key={x}>{x}</li>)}</ul>
        </section>
        <section className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-amber-950 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-100">
          <h3 className="mb-1 font-semibold">{tr.aboutLimitsTitle}</h3>
          <p>{tr.aboutLimits}</p>
          <p className="mt-2">
            {tr.aboutOfficial}{" "}
            <a className={link} href="https://www.tmd.go.th" target="_blank" rel="noopener noreferrer">{tr.tmd}</a>
            {" · "}
            <a className={link} href="https://www.disaster.go.th" target="_blank" rel="noopener noreferrer">{tr.ddpm}</a>
          </p>
        </section>
        <section>
          <h3 className="mb-1.5 font-semibold">{tr.aboutBuiltTitle}</h3>
          <p className="text-muted-foreground">{tr.aboutBuilt}</p>
        </section>
      </div>
    </Modal>
  );
}
