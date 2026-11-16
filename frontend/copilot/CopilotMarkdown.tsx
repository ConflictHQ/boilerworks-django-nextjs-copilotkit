"use client";

import ReactMarkdown, { type Components } from "react-markdown";

/* Links open in a new tab; images render as links, so nothing loads unasked. */
const COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-0.5 pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-0.5 pl-4">{children}</ol>,
  code: ({ children }) => (
    <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="bg-muted my-1.5 overflow-x-auto rounded p-2 text-xs">{children}</pre>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2"
    >
      {children}
    </a>
  ),
  img: ({ src, alt }) =>
    typeof src === "string" ? (
      <a href={src} target="_blank" rel="noopener noreferrer" className="text-primary underline">
        {alt || src}
      </a>
    ) : null,
};

/** The assistant's words as markdown: the conversation's `renderContent`. */
export function CopilotMarkdown({ text }: { text: string }) {
  return (
    <div className="text-sm leading-relaxed break-words">
      <ReactMarkdown components={COMPONENTS}>{text}</ReactMarkdown>
    </div>
  );
}
