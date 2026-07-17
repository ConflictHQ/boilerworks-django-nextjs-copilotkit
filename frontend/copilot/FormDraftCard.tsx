"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowUpRightIcon, FileTextIcon, Loader2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type DraftField = { name: string; label?: string; type?: string };

export type FormDraftCardProps = {
  name: string;
  description?: string;
  fields: DraftField[];
  editHref: string;
  drafting?: boolean;
  /** Persisted slug — only known once the draft is created (from the result). */
  slug?: string;
  /** Persisted version — only known once the draft is created (from the result). */
  version?: number;
};

const MAX_VISIBLE_FIELDS = 6;

/**
 * Generative-UI card rendered inside the chat when the agent drafts a form
 * definition. Presentational only — the CopilotKit glue lives in
 * `CopilotToolRenders`.
 */
export function FormDraftCard({
  name,
  description,
  fields,
  editHref,
  drafting = false,
  slug,
  version,
}: FormDraftCardProps) {
  const t = useTranslations("copilot.formDraft");
  const visible = fields.slice(0, MAX_VISIBLE_FIELDS);
  const overflow = fields.length - visible.length;

  return (
    <div className="bg-card text-card-foreground w-full rounded-lg border p-3 text-sm shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="bg-primary/10 text-primary rounded-md p-1.5">
            {drafting ? (
              <Loader2Icon className="h-4 w-4 animate-spin" />
            ) : (
              <FileTextIcon className="h-4 w-4" />
            )}
          </div>
          <span className="truncate font-medium">{name || t("untitled")}</span>
        </div>
        <Badge variant="secondary" className="shrink-0">
          {drafting ? t("drafting") : t("title")}
        </Badge>
      </div>

      {!drafting && slug !== undefined && version !== undefined ? (
        <p className="text-muted-foreground mt-1 text-xs">{t("savedAs", { slug, version })}</p>
      ) : null}

      {description ? (
        <p className="text-muted-foreground mt-2 line-clamp-2">{description}</p>
      ) : null}

      <p className="text-muted-foreground mt-2 text-xs font-medium">
        {fields.length > 0 ? t("fields", { count: fields.length }) : t("noFields")}
      </p>

      {visible.length > 0 ? (
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {visible.map((field, i) => (
            <li
              key={`${field.name}-${i}`}
              className="bg-muted text-muted-foreground rounded-md px-2 py-0.5 text-xs"
            >
              <span className="text-foreground">{field.label || field.name}</span>
              {field.type ? <span className="ml-1 opacity-70">· {field.type}</span> : null}
            </li>
          ))}
          {overflow > 0 ? (
            <li className="text-muted-foreground px-1 py-0.5 text-xs">+{overflow}</li>
          ) : null}
        </ul>
      ) : null}

      {!drafting ? (
        <Button asChild size="sm" variant="outline" className="mt-3 w-full">
          <Link href={editHref}>
            {t("edit")}
            <ArrowUpRightIcon className="ml-1 h-3.5 w-3.5" />
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
