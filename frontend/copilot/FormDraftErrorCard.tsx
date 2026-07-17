"use client";

import { useTranslations } from "next-intl";
import { TriangleAlertIcon } from "lucide-react";

export type FormDraftErrorCardProps = {
  /** Human-readable failure message (permission_denied / error results). */
  message?: string;
  /** Schema validation messages (invalid_schema results). */
  errors?: string[];
};

/**
 * Destructive-styled card rendered inside the chat when a `draft_form_definition`
 * tool call comes back with a non-`created` status (permission denied, invalid
 * schema, or a generic error). Presentational only — the CopilotKit glue lives
 * in `CopilotToolRenders`. Deliberately carries no "Open in Form Engine" link:
 * nothing was persisted.
 */
export function FormDraftErrorCard({ message, errors }: FormDraftErrorCardProps) {
  const t = useTranslations("copilot.formDraft");
  const hasErrors = Array.isArray(errors) && errors.length > 0;

  return (
    <div className="border-destructive/50 bg-destructive/5 text-card-foreground w-full rounded-lg border p-3 text-sm shadow-sm">
      <div className="flex items-center gap-2">
        <div className="bg-destructive/10 text-destructive rounded-md p-1.5">
          <TriangleAlertIcon className="h-4 w-4" />
        </div>
        <span className="text-destructive font-medium">{t("errorTitle")}</span>
      </div>

      {hasErrors ? (
        <ul className="text-muted-foreground mt-2 list-disc space-y-0.5 pl-5 text-xs">
          {errors.map((entry, i) => (
            <li key={`${entry}-${i}`}>{entry}</li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground mt-2 text-xs">{message || t("errorGeneric")}</p>
      )}
    </div>
  );
}
