"use client";

import { useState } from "react";
import { useCopilotAction } from "@copilotkit/react-core";
import { COPILOT_TOOL_DRAFT_FORM, COPILOT_TOOL_TRANSITION_WORKFLOW } from "./config";
import { FormDraftCard, type DraftField } from "./FormDraftCard";
import {
  WorkflowTransitionApproval,
  type WorkflowApprovalStatus,
} from "./WorkflowTransitionApproval";

// --- defensive parsers for the (backend-owned) tool payloads --------------

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
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

function extractFields(source: Record<string, unknown>): DraftField[] {
  // JSON-Schema shape ({ schema: { properties: { … } } }) — matches the Form Engine.
  const schema = toRecord(source.schema);
  const properties = schema ? toRecord(schema.properties) : null;
  if (properties) {
    return Object.entries(properties).map(([name, raw]) => {
      const prop = toRecord(raw) ?? {};
      return {
        name,
        label: str(prop.title) ?? str(prop.label),
        type: str(prop["x-widget"]) ?? str(prop.type),
      };
    });
  }
  // Flat shape ({ fields: [{ name, type, label }] }).
  if (Array.isArray(source.fields)) {
    return source.fields.map((raw, i) => {
      const field = toRecord(raw) ?? {};
      return {
        name: str(field.name) ?? `field_${i + 1}`,
        label: str(field.label) ?? str(field.title),
        type: str(field.type),
      };
    });
  }
  return [];
}

function parseDraftForm(source: Record<string, unknown>) {
  const slug = str(source.slug) ?? str(source.form_slug);
  return {
    name: str(source.name) ?? str(source.title) ?? "",
    description: str(source.description),
    fields: extractFields(source),
    editHref: slug ? `/forms/${slug}` : "/forms/new",
  };
}

// --- HITL wrapper: owns the approve/deny decision + calls respond() -------

function WorkflowTransitionHITL({
  args,
  respond,
}: {
  args: Record<string, unknown>;
  respond?: (result: unknown) => void;
}) {
  const [decision, setDecision] = useState<null | "approved" | "denied">(null);

  const status: WorkflowApprovalStatus = decision ?? (respond ? "pending" : "waiting");

  return (
    <WorkflowTransitionApproval
      workflow={str(args.workflow) ?? str(args.workflow_name) ?? str(args.workflowName)}
      fromState={str(args.from_state) ?? str(args.fromState) ?? str(args.from)}
      toState={str(args.to_state) ?? str(args.toState) ?? str(args.to)}
      status={status}
      onApprove={() => {
        setDecision("approved");
        respond?.({ confirmed: true });
      }}
      onDeny={() => {
        setDecision("denied");
        respond?.({ confirmed: false });
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
  // keeps this render-only (the agent executes the tool, we just render it).
  useCopilotAction({
    name: COPILOT_TOOL_DRAFT_FORM,
    available: "disabled",
    render: ({ status, args, result }) => {
      const complete = status === "complete";
      const source = (complete ? toRecord(result) : null) ?? toRecord(args) ?? {};
      return <FormDraftCard {...parseDraftForm(source)} drafting={!complete} />;
    },
  });

  // Human-in-the-loop: approve/deny the workflow transition. `respond` resumes
  // the agent with `{ confirmed }`, which drives its confirmed=true re-call.
  useCopilotAction({
    name: COPILOT_TOOL_TRANSITION_WORKFLOW,
    renderAndWaitForResponse: ({ args, respond }) => (
      <WorkflowTransitionHITL args={args as Record<string, unknown>} respond={respond} />
    ),
  });

  return null;
}
