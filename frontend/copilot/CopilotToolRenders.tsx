"use client";

import { useState } from "react";
import { useCopilotAction } from "@copilotkit/react-core";
import { COPILOT_TOOL_CONFIRM_TRANSITION, COPILOT_TOOL_DRAFT_FORM } from "./config";
import { FormDraftCard, type DraftField } from "./FormDraftCard";
import { FormDraftErrorCard } from "./FormDraftErrorCard";
import {
  WorkflowTransitionApproval,
  type WorkflowApprovalStatus,
} from "./WorkflowTransitionApproval";

// --- defensive parsers for the (backend-owned) draft-form payload ----------

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(str).filter((v): v is string => v !== undefined) : [];
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// The agent drafts `schema` as a JSON-Schema object ({ type, properties, required });
// the field summary is derived from those `properties`. That is exactly what the
// same-repo backend `draft_form_definition` tool accepts — no flat `fields[]` shape
// is ever emitted, so we parse only this one.
function extractFields(source: Record<string, unknown>): DraftField[] {
  const schema = toRecord(source.schema);
  const properties = schema ? toRecord(schema.properties) : null;
  if (!properties) return [];
  return Object.entries(properties).map(([name, raw]) => {
    const prop = toRecord(raw) ?? {};
    return {
      name,
      label: str(prop.title) ?? str(prop.label),
      type: str(prop["x-widget"]) ?? str(prop.type),
    };
  });
}

// The drafted form as described by the tool *arguments* (name/description/fields).
// The saved slug/version live on the tool *result*, which never echoes the schema,
// so the field summary always comes from here — even once the draft is created.
function draftFromArgs(args: Record<string, unknown>) {
  return {
    name: str(args.name) ?? "",
    description: str(args.description),
    fields: extractFields(args),
  };
}

// --- HITL wrapper: owns the approve/deny decision + calls respond() --------

function WorkflowTransitionHITL({
  workflow,
  fromState,
  toState,
  respond,
}: {
  workflow?: string;
  fromState?: string;
  toState?: string;
  respond?: (result: unknown) => void;
}) {
  const [decision, setDecision] = useState<null | "approved" | "denied">(null);

  const status: WorkflowApprovalStatus = decision ?? (respond ? "pending" : "waiting");

  return (
    <WorkflowTransitionApproval
      workflow={workflow}
      fromState={fromState}
      toState={toState}
      status={status}
      onApprove={() => {
        setDecision("approved");
        respond?.({ approved: true });
      }}
      onDeny={() => {
        setDecision("denied");
        respond?.({ approved: false });
      }}
    />
  );
}

/**
 * Registers CopilotKit renders for the agent's tool calls. Renders nothing
 * itself — the output is injected into the chat stream by CopilotKit. Must be
 * mounted inside `<CopilotKit>`.
 */
export function CopilotToolRenders() {
  // Generative UI: display the drafted form definition. `available: "disabled"`
  // keeps this render-only AND keeps the name out of the advertised frontend tool
  // list, so it never collides with the identically-named backend tool.
  useCopilotAction({
    name: COPILOT_TOOL_DRAFT_FORM,
    available: "disabled",
    render: ({ status, args, result }) => {
      const draft = draftFromArgs(toRecord(args) ?? {});

      // Still streaming the tool call — show the draft taking shape.
      if (status !== "complete") {
        return <FormDraftCard {...draft} editHref="/forms/new" drafting />;
      }

      // Completed. The backend returns either { status: 'created', slug, version,
      // name, form_status } or a failure ({ status: permission_denied |
      // invalid_schema | error, message?/errors? }).
      const res = toRecord(result) ?? {};
      if (str(res.status) !== "created") {
        return <FormDraftErrorCard message={str(res.message)} errors={strList(res.errors)} />;
      }

      const slug = str(res.slug);
      return (
        <FormDraftCard
          name={str(res.name) ?? draft.name}
          description={draft.description}
          fields={draft.fields}
          slug={slug}
          version={num(res.version)}
          editHref={slug ? `/forms/${slug}` : "/forms/new"}
        />
      );
    },
  });

  // Human-in-the-loop: a genuine FRONTEND tool the agent calls to obtain human
  // approval BEFORE it executes the (backend-only) workflow transition. `respond`
  // resumes the agent with `{ approved }`, which drives its confirmed=true re-call.
  useCopilotAction({
    name: COPILOT_TOOL_CONFIRM_TRANSITION,
    description:
      "Ask the human to approve or deny a workflow transition before executing it; returns {approved}.",
    parameters: [
      {
        name: "instance_ref",
        type: "string",
        required: true,
        description:
          "Reference id of the workflow instance being transitioned (from the confirmation_required payload).",
      },
      {
        name: "workflow_name",
        type: "string",
        required: false,
        description: "Human-readable name of the workflow.",
      },
      {
        name: "from_state_label",
        type: "string",
        required: false,
        description: "Human-readable label of the current state.",
      },
      {
        name: "to_state_label",
        type: "string",
        required: false,
        description: "Human-readable label of the target state.",
      },
      {
        name: "label",
        type: "string",
        required: false,
        description: "Label of the transition being applied.",
      },
      {
        name: "message",
        type: "string",
        required: false,
        description: "Optional additional context to show the human.",
      },
    ],
    renderAndWaitForResponse: ({ args, respond }) => (
      <WorkflowTransitionHITL
        workflow={args.workflow_name}
        fromState={args.from_state_label}
        toState={args.to_state_label}
        respond={respond}
      />
    ),
  });

  return null;
}
