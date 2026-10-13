"use client";

import { memo, type ComponentProps } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

type P<T extends keyof React.JSX.IntrinsicElements> = Omit<ComponentProps<T>, "ref" | "node"> & { node?: unknown };
const strip = <T extends { node?: unknown }>({ node, ...rest }: T) => { void node; return rest; };

/** Compact styles for the narrow chat column. No raw HTML is rendered (react-markdown escapes it); links open in a new tab. */
const components: Components = {
  h1: (p: P<"h1">) => <h4 {...strip(p)} className="mt-3 mb-1.5 text-[15px] leading-snug font-semibold first:mt-0" />,
  h2: (p: P<"h2">) => <h4 {...strip(p)} className="mt-3 mb-1.5 text-[15px] leading-snug font-semibold first:mt-0" />,
  h3: (p: P<"h3">) => <h4 {...strip(p)} className="mt-3 mb-1 text-sm leading-snug font-semibold first:mt-0" />,
  h4: (p: P<"h4">) => <h5 {...strip(p)} className="mt-2.5 mb-1 text-sm leading-snug font-semibold first:mt-0" />,
  h5: (p: P<"h5">) => <h5 {...strip(p)} className="mt-2.5 mb-1 text-sm leading-snug font-medium first:mt-0" />,
  h6: (p: P<"h6">) => <h5 {...strip(p)} className="mt-2.5 mb-1 text-sm leading-snug font-medium text-muted-foreground first:mt-0" />,
  p: (p: P<"p">) => <p {...strip(p)} className="my-1.5 first:mt-0 last:mb-0" />,
  ul: (p: P<"ul">) => <ul {...strip(p)} className="my-1.5 list-disc space-y-0.5 pl-5 marker:text-muted-foreground first:mt-0 last:mb-0" />,
  ol: (p: P<"ol">) => <ol {...strip(p)} className="my-1.5 list-decimal space-y-0.5 pl-5 marker:text-muted-foreground first:mt-0 last:mb-0" />,
  li: (p: P<"li">) => <li {...strip(p)} className="pl-0.5 [&>ol]:my-0.5 [&>p]:my-0.5 [&>ul]:my-0.5" />,
  strong: (p: P<"strong">) => <strong {...strip(p)} className="font-semibold" />,
  em: (p: P<"em">) => <em {...strip(p)} className="italic" />,
  a: ({ node, href, children, ...rest }: P<"a">) => {
    void node;
    void rest;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline underline-offset-2 break-words hover:no-underline">
        {children}
      </a>
    );
  },
  code: ({ node, className, ...rest }: P<"code">) => {
    void node;
    return <code {...rest} className={cn("rounded-[3px] bg-muted px-1 py-0.5 font-mono text-[0.85em] break-words", className)} />;
  },
  pre: (p: P<"pre">) => <pre {...strip(p)} className="my-2 overflow-x-auto rounded-md bg-muted p-2.5 text-xs leading-relaxed [&_code]:bg-transparent [&_code]:p-0" />,
  blockquote: (p: P<"blockquote">) => <blockquote {...strip(p)} className="my-2 border-l-2 border-primary/40 pl-3 text-muted-foreground" />,
  hr: () => <hr className="my-3 border-border" />,
  table: ({ node, ...rest }: P<"table">) => {
    void node;
    return (
      <div className="my-2 overflow-x-auto rounded-md border">
        <table {...rest} className="w-full border-collapse text-left text-xs" />
      </div>
    );
  },
  thead: (p: P<"thead">) => <thead {...strip(p)} className="bg-muted/70" />,
  th: (p: P<"th">) => <th {...strip(p)} className="border-b px-2 py-1 font-semibold whitespace-nowrap" />,
  tbody: (p: P<"tbody">) => <tbody {...strip(p)} className="[&_tr:last-child_td]:border-b-0" />,
  td: (p: P<"td">) => <td {...strip(p)} className="border-b px-2 py-1 align-top" />,
  img: () => null,
};

const plugins = [remarkGfm];

/** Assistant text as markdown. Memoized on the text, so finished messages do not re-render while a later one streams. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="min-w-0 break-words [overflow-wrap:anywhere]">
      <ReactMarkdown remarkPlugins={plugins} components={components} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
});
