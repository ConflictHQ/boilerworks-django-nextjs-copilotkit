// Covers the copilot generative-UI surfaces:
//   - the workflow-transition HITL approve/deny component in both its
//     interactive (pending) and resolved (approved / denied) states,
//   - the drafted-form card (field summary + edit link, plus the drafting state)
//     and its destructive error card, and
//   - the agent wiring: the `confirm_workflow_transition` frontend tool
//     (parameter schema, args-driven card, approved/denied answers to the run)
//     and the draft renderer's created / error result handling, inside the
//     library's conversation over a recorded agent.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  AgentChat,
  CalliopeAgentProvider,
  createMockAgent,
  toolCallEvents,
  useAgentController,
  type MockTurn,
} from "@calliopelabs/ui/agent";
import { UIProvider } from "@calliopelabs/ui";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { WorkflowTransitionApproval } from "@/copilot/WorkflowTransitionApproval";
import { FormDraftCard } from "@/copilot/FormDraftCard";
import { FormDraftErrorCard } from "@/copilot/FormDraftErrorCard";
import { COPILOT_TOOL_CONFIRM_TRANSITION, COPILOT_TOOL_DRAFT_FORM } from "@/copilot/config";
import {
  CopilotToolRenders,
  DraftFormRender,
  confirmTransitionTool,
  copilotRenderers,
} from "@/copilot/CopilotToolRenders";

// next/link needs no router in these presentational tests — render a plain <a>.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

// vitest.config.ts does not enable `globals`, so @testing-library/react's
// auto-cleanup is not registered — unmount between tests explicitly.
afterEach(cleanup);

function renderIntl(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>
  );
}

describe("WorkflowTransitionApproval (HITL)", () => {
  it("pending: renders the transition and fires approve/deny callbacks", () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    renderIntl(
      <WorkflowTransitionApproval
        workflow="Invoice"
        fromState="draft"
        toState="in_review"
        status="pending"
        onApprove={onApprove}
        onDeny={onDeny}
      />
    );

    expect(screen.getByText("draft")).toBeTruthy();
    expect(screen.getByText("in_review")).toBeTruthy();
    expect(screen.getByText("on Invoice")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onApprove).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it("approved: shows the resolved message and hides the action buttons", () => {
    renderIntl(
      <WorkflowTransitionApproval status="approved" onApprove={() => {}} onDeny={() => {}} />
    );

    expect(screen.getByText("Transition approved")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Deny" })).toBeNull();
  });

  it("denied: shows the denied message", () => {
    renderIntl(
      <WorkflowTransitionApproval status="denied" onApprove={() => {}} onDeny={() => {}} />
    );

    expect(screen.getByText("Transition denied")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Deny" })).toBeNull();
  });
});

describe("FormDraftCard (generative UI)", () => {
  it("renders the name, pluralized field count, fields, and the edit link", () => {
    renderIntl(
      <FormDraftCard
        name="Client intake"
        description="Collect new client details"
        fields={[
          { name: "email", label: "Email", type: "string" },
          { name: "age", type: "integer" },
        ]}
        editHref="/forms/new"
      />
    );

    expect(screen.getByText("Client intake")).toBeTruthy();
    expect(screen.getByText("2 fields")).toBeTruthy();
    expect(screen.getByText("Email")).toBeTruthy();

    const link = screen.getByRole("link", { name: /Open in Form Engine/ });
    expect(link.getAttribute("href")).toBe("/forms/new");
  });

  it("drafting: shows the drafting badge and hides the edit link", () => {
    renderIntl(<FormDraftCard name="Draft" fields={[]} editHref="/forms/new" drafting />);

    expect(screen.getByText("Drafting…")).toBeTruthy();
    expect(screen.getByText("No fields yet")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("created: surfaces the persisted slug and version", () => {
    renderIntl(
      <FormDraftCard
        name="Client intake"
        fields={[{ name: "email", label: "Email" }]}
        editHref="/forms/client-intake"
        slug="client-intake"
        version={2}
      />
    );

    expect(screen.getByText("Saved as client-intake · v2")).toBeTruthy();
  });
});

describe("FormDraftErrorCard (generative UI)", () => {
  it("renders a single message and no edit link", () => {
    renderIntl(<FormDraftErrorCard message="You do not have permission." />);

    expect(screen.getByText("Couldn't draft form")).toBeTruthy();
    expect(screen.getByText("You do not have permission.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("lists schema validation errors when provided", () => {
    renderIntl(
      <FormDraftErrorCard errors={["'type' is required", "properties must be an object"]} />
    );

    expect(screen.getByText("'type' is required")).toBeTruthy();
    expect(screen.getByText("properties must be an object")).toBeTruthy();
  });

  it("falls back to a generic message when neither message nor errors are given", () => {
    renderIntl(<FormDraftErrorCard />);

    expect(screen.getByText("The form could not be drafted.")).toBeTruthy();
  });
});

// --- agent wiring ------------------------------------------------------------

/** The conversation as the rail draws it, over a recorded agent, with the copilot's tools. */
function Conversation({
  turns,
  onRequest,
}: {
  turns: MockTurn[];
  onRequest?: (i: unknown) => void;
}) {
  const agent = createMockAgent({ turns, delay: 0, ...(onRequest ? { onRequest } : {}) });
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <UIProvider>
        <CalliopeAgentProvider agent={agent}>
          <CopilotToolRenders />
          <Send />
          <AgentChat renderers={copilotRenderers} />
        </CalliopeAgentProvider>
      </UIProvider>
    </NextIntlClientProvider>
  );
}

/** Asks once, as the person would. */
function Send() {
  const controller = useAgentController();
  return (
    <button type="button" onClick={() => void controller?.send("go")}>
      ask
    </button>
  );
}

describe("confirm_workflow_transition (frontend HITL tool)", () => {
  it("is defined under the frontend tool name with the agreed parameter schema", () => {
    expect(confirmTransitionTool.name).toBe("confirm_workflow_transition");
    expect(confirmTransitionTool.description).toMatch(/approve or deny/i);
    expect(confirmTransitionTool.handler).toBeUndefined();
    const schema = confirmTransitionTool.parameters as {
      properties: Record<string, { type: string }>;
      required: string[];
    };
    expect(Object.keys(schema.properties)).toEqual([
      "instance_ref",
      "workflow_name",
      "from_state_label",
      "to_state_label",
      "label",
      "message",
    ]);
    expect(Object.values(schema.properties).every((p) => p.type === "string")).toBe(true);
    expect(schema.required).toEqual(["instance_ref"]);
  });

  it.each([
    ["Approve", true],
    ["Deny", false],
  ])(
    "is offered to the agent, draws the card from args and answers %s",
    async (button, approved) => {
      const requests: {
        tools: { name: string }[];
        messages: { role: string; content?: unknown }[];
      }[] = [];
      render(
        <Conversation
          onRequest={(input) => requests.push(input as never)}
          turns={[
            toolCallEvents("call-1", COPILOT_TOOL_CONFIRM_TRANSITION, {
              instance_ref: "WI-1",
              workflow_name: "Invoice",
              from_state_label: "Draft",
              to_state_label: "In review",
            }),
            [],
          ]}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: "ask" }));

      expect(await screen.findByText("on Invoice")).toBeTruthy();
      expect(screen.getByText("Draft")).toBeTruthy();
      expect(screen.getByText("In review")).toBeTruthy();
      expect(requests[0].tools.map((t) => t.name)).toContain(COPILOT_TOOL_CONFIRM_TRANSITION);
      // The draft renderer is not a tool: its name never reaches the agent's tool list.
      expect(requests[0].tools.map((t) => t.name)).not.toContain(COPILOT_TOOL_DRAFT_FORM);

      fireEvent.click(screen.getByRole("button", { name: button }));
      await waitFor(() => expect(requests).toHaveLength(2));
      const answer = requests[1].messages.find((m) => m.role === "tool");
      expect(JSON.parse(String(answer?.content))).toEqual({ approved });
    }
  );
});

describe("draft_form_definition (render-only generative UI)", () => {
  const args = {
    name: "Client intake",
    slug: "client-intake",
    schema: {
      type: "object",
      properties: {
        email: { type: "string", title: "Email" },
        age: { type: "integer" },
      },
    },
  };

  it("while streaming, draws the drafting card from the schema properties in args", () => {
    renderIntl(
      <DraftFormRender
        call={{ id: "c", name: COPILOT_TOOL_DRAFT_FORM, args: "", status: "streaming" }}
        args={args}
        result={undefined}
        agent={undefined as never}
      />
    );

    expect(screen.getByText("Client intake")).toBeTruthy();
    expect(screen.getByText("Drafting…")).toBeTruthy();
    expect(screen.getByText("Email")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("on created, keeps the args field list and shows slug/version from the result", async () => {
    render(
      <Conversation
        turns={[
          toolCallEvents("call-2", COPILOT_TOOL_DRAFT_FORM, args, {
            result: {
              status: "created",
              slug: "client-intake",
              version: 2,
              name: "Client intake",
              form_status: "draft",
            },
          }),
        ]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "ask" }));

    expect(await screen.findByText("Saved as client-intake · v2")).toBeTruthy();
    expect(screen.getByText("Client intake")).toBeTruthy();
    expect(screen.getByText("2 fields")).toBeTruthy();
    expect(screen.getByText("Email")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Open in Form Engine/ });
    expect(link.getAttribute("href")).toBe("/forms/client-intake");
  });

  it("on permission_denied, renders the error card with the message and no link", async () => {
    render(
      <Conversation
        turns={[
          toolCallEvents(
            "call-3",
            COPILOT_TOOL_DRAFT_FORM,
            { name: "X", slug: "x", schema: {} },
            {
              result: {
                status: "permission_denied",
                message: "You do not have permission to create form definitions.",
              },
            }
          ),
        ]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "ask" }));

    expect(await screen.findByText("Couldn't draft form")).toBeTruthy();
    expect(screen.getByText("You do not have permission to create form definitions.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Open in Form Engine/ })).toBeNull();
  });

  it("on invalid_schema, lists the validation errors", async () => {
    render(
      <Conversation
        turns={[
          toolCallEvents(
            "call-4",
            COPILOT_TOOL_DRAFT_FORM,
            { name: "X", slug: "x", schema: {} },
            {
              result: {
                status: "invalid_schema",
                errors: ["'type' is required", "properties must be an object"],
              },
            }
          ),
        ]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "ask" }));

    expect(await screen.findByText("'type' is required")).toBeTruthy();
    expect(screen.getByText("properties must be an object")).toBeTruthy();
  });
});
