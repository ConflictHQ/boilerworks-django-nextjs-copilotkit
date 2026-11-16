"use client";

import { useState } from "react";
import {
  defineTool,
  parseResult,
  useAgentTool,
  type AgentRenderers,
  type ToolRendererProps,
} from "@calliopelabs/ui/agent";
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
  answered,
}: {
  workflow?: string;
  fromState?: string;
  toState?: string;
  respond?: (result: unknown) => void;
  /** How the call was answered, once it has a result. */
  answered?: boolean;
}) {
  const [decision, setDecision] = useState<null | "approved" | "denied">(null);

  const status: WorkflowApprovalStatus =
    decision ??
    (answered === undefined ? (respond ? "pending" : "waiting") : answered ? "approved" : "denied");

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

/** What the agent passes when it asks for a transition's approval. */
export interface ConfirmTransitionArgs {
  instance_ref: string;
  workflow_name?: string;
  from_state_label?: string;
  to_state_label?: string;
  label?: string;
  message?: string;
}

/**
 * Human-in-the-loop: a genuine FRONTEND tool the agent calls to obtain human
 * approval BEFORE it executes the (backend-only) workflow transition. It has a
 * card and no handler, so the run waits until the card calls `respond`, which
 * resumes the agent with `{ approved }` and drives its confirmed=true re-call.
 */
export const confirmTransitionTool = defineTool<ConfirmTransitionArgs>({
  name: COPILOT_TOOL_CONFIRM_TRANSITION,
  description:
    "Ask the human to approve or deny a workflow transition before executing it; returns {approved}.",
  parameters: {
    type: "object",
    properties: {
      instance_ref: {
        type: "string",
        description:
          "Reference id of the workflow instance being transitioned (from the confirmation_required payload).",
      },
      workflow_name: { type: "string", description: "Human-readable name of the workflow." },
      from_state_label: {
        type: "string",
        description: "Human-readable label of the current state.",
      },
      to_state_label: { type: "string", description: "Human-readable label of the target state." },
      label: { type: "string", description: "Label of the transition being applied." },
      message: { type: "string", description: "Optional additional context to show the human." },
    },
    required: ["instance_ref"],
  },
  render: ({ call, args, respond }) => {
    const result = toRecord(parseResult(call));
    return (
      <WorkflowTransitionHITL
        workflow={args?.workflow_name}
        fromState={args?.from_state_label}
        toState={args?.to_state_label}
        respond={respond}
        answered={result && typeof result.approved === "boolean" ? result.approved : undefined}
      />
    );
  },
});

/**
 * Generative UI: the drafted form definition, drawn from the backend tool's
 * call. It is a renderer, not a tool, so its name never reaches the frontend
 * tool list and never collides with the identically-named backend tool.
 */
export function DraftFormRender({ call, args, result }: ToolRendererProps) {
  const draft = draftFromArgs(toRecord(args) ?? {});

  // Still streaming the tool call — show the draft taking shape.
  if (call.status !== "complete") {
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
}

/** The assistant's renderers for the backend's tool calls. */
export const copilotRenderers: AgentRenderers = {
  tools: { [COPILOT_TOOL_DRAFT_FORM]: DraftFormRender },
};

/**
 * Offers the browser's tools to the agent while mounted. Renders nothing
 * itself; must be mounted inside the agent provider.
 */
export function CopilotToolRenders() {
  useAgentTool(confirmTransitionTool);
  return null;
}
