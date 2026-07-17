// Covers the copilot generative-UI surfaces:
//   - the workflow-transition HITL approve/deny component in both its
//     interactive (pending) and resolved (approved / denied) states,
//   - the drafted-form card (field summary + edit link, plus the drafting state)
//     and its destructive error card, and
//   - the CopilotToolRenders wiring: the renamed `confirm_workflow_transition`
//     frontend tool (parameter schema, args-driven card, approved/denied respond
//     payloads) and the draft render's created / error result handling.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { WorkflowTransitionApproval } from "@/copilot/WorkflowTransitionApproval";
import { FormDraftCard } from "@/copilot/FormDraftCard";
import { FormDraftErrorCard } from "@/copilot/FormDraftErrorCard";
import { COPILOT_TOOL_CONFIRM_TRANSITION, COPILOT_TOOL_DRAFT_FORM } from "@/copilot/config";

// Capture every useCopilotAction registration so the render / renderAndWaitForResponse
// closures can be exercised directly, without a live CopilotKit provider.
const { registered } = vi.hoisted(() => ({ registered: [] as unknown[] }));
vi.mock("@copilotkit/react-core", () => ({
  useCopilotAction: (action: unknown) => {
    registered.push(action);
  },
}));

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

// --- CopilotToolRenders wiring ---------------------------------------------

type CapturedParameter = {
  name: string;
  type?: string;
  required?: boolean;
  description?: string;
};

type CapturedAction = {
  name: string;
  available?: string;
  description?: string;
  parameters?: CapturedParameter[];
  render?: (props: {
    status: string;
    args: Record<string, unknown>;
    result?: unknown;
  }) => ReactElement;
  renderAndWaitForResponse?: (props: {
    status: string;
    args: Record<string, unknown>;
    respond?: (result: unknown) => void;
  }) => ReactElement;
};

function getAction(name: string): CapturedAction {
  const found = registered.find((a) => (a as CapturedAction).name === name);
  if (!found) throw new Error(`useCopilotAction was not registered for "${name}"`);
  return found as CapturedAction;
}

describe("CopilotToolRenders", () => {
  beforeEach(async () => {
    registered.length = 0;
    const { CopilotToolRenders } = await import("@/copilot/CopilotToolRenders");
    render(<CopilotToolRenders />);
  });

  describe("confirm_workflow_transition (frontend HITL tool)", () => {
    it("registers under the frontend tool name with the agreed parameter schema", () => {
      const action = getAction(COPILOT_TOOL_CONFIRM_TRANSITION);

      expect(action.name).toBe("confirm_workflow_transition");
      expect(action.description).toMatch(/approve or deny/i);

      const params = action.parameters ?? [];
      expect(params.map((p) => p.name)).toEqual([
        "instance_ref",
        "workflow_name",
        "from_state_label",
        "to_state_label",
        "label",
        "message",
      ]);
      expect(params.every((p) => p.type === "string")).toBe(true);

      const required = Object.fromEntries(params.map((p) => [p.name, p.required]));
      expect(required.instance_ref).toBe(true);
      expect(required.workflow_name).toBe(false);
      expect(required.from_state_label).toBe(false);
      expect(required.to_state_label).toBe(false);
      expect(required.label).toBe(false);
      expect(required.message).toBe(false);
    });

    it("renders the approval card from args and responds { approved: true } on approve", () => {
      const action = getAction(COPILOT_TOOL_CONFIRM_TRANSITION);
      const respond = vi.fn();

      renderIntl(
        action.renderAndWaitForResponse!({
          status: "executing",
          args: {
            instance_ref: "WI-1",
            workflow_name: "Invoice",
            from_state_label: "Draft",
            to_state_label: "In review",
          },
          respond,
        })
      );

      expect(screen.getByText("Draft")).toBeTruthy();
      expect(screen.getByText("In review")).toBeTruthy();
      expect(screen.getByText("on Invoice")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
      expect(respond).toHaveBeenCalledWith({ approved: true });
    });

    it("responds { approved: false } on deny", () => {
      const action = getAction(COPILOT_TOOL_CONFIRM_TRANSITION);
      const respond = vi.fn();

      renderIntl(
        action.renderAndWaitForResponse!({
          status: "executing",
          args: { instance_ref: "WI-1", from_state_label: "Draft", to_state_label: "In review" },
          respond,
        })
      );

      fireEvent.click(screen.getByRole("button", { name: "Deny" }));
      expect(respond).toHaveBeenCalledWith({ approved: false });
    });
  });

  describe("draft_form_definition (render-only generative UI)", () => {
    it("is registered render-only via available: disabled", () => {
      const action = getAction(COPILOT_TOOL_DRAFT_FORM);
      expect(action.available).toBe("disabled");
      expect(action.parameters).toBeUndefined();
    });

    it("while streaming, draws the drafting card from the schema properties in args", () => {
      const action = getAction(COPILOT_TOOL_DRAFT_FORM);

      renderIntl(
        action.render!({
          status: "inProgress",
          args: {
            name: "Client intake",
            slug: "client-intake",
            schema: { type: "object", properties: { email: { type: "string", title: "Email" } } },
          },
        })
      );

      expect(screen.getByText("Client intake")).toBeTruthy();
      expect(screen.getByText("Drafting…")).toBeTruthy();
      expect(screen.getByText("Email")).toBeTruthy();
      expect(screen.queryByRole("link")).toBeNull();
    });

    it("on created, keeps the args field list and shows slug/version from the result", () => {
      const action = getAction(COPILOT_TOOL_DRAFT_FORM);

      renderIntl(
        action.render!({
          status: "complete",
          args: {
            name: "Client intake",
            slug: "client-intake",
            schema: {
              type: "object",
              properties: {
                email: { type: "string", title: "Email" },
                age: { type: "integer" },
              },
            },
          },
          result: {
            status: "created",
            slug: "client-intake",
            version: 2,
            name: "Client intake",
            form_status: "draft",
          },
        })
      );

      expect(screen.getByText("Client intake")).toBeTruthy();
      expect(screen.getByText("2 fields")).toBeTruthy();
      expect(screen.getByText("Email")).toBeTruthy();
      expect(screen.getByText("Saved as client-intake · v2")).toBeTruthy();

      const link = screen.getByRole("link", { name: /Open in Form Engine/ });
      expect(link.getAttribute("href")).toBe("/forms/client-intake");
    });

    it("on permission_denied, renders the error card with the message and no link", () => {
      const action = getAction(COPILOT_TOOL_DRAFT_FORM);

      renderIntl(
        action.render!({
          status: "complete",
          args: { name: "X", slug: "x", schema: {} },
          result: {
            status: "permission_denied",
            message: "You do not have permission to create form definitions.",
          },
        })
      );

      expect(screen.getByText("Couldn't draft form")).toBeTruthy();
      expect(
        screen.getByText("You do not have permission to create form definitions.")
      ).toBeTruthy();
      expect(screen.queryByRole("link")).toBeNull();
    });

    it("on invalid_schema, lists the validation errors", () => {
      const action = getAction(COPILOT_TOOL_DRAFT_FORM);

      renderIntl(
        action.render!({
          status: "complete",
          args: { name: "X", slug: "x", schema: {} },
          result: {
            status: "invalid_schema",
            errors: ["'type' is required", "properties must be an object"],
          },
        })
      );

      expect(screen.getByText("Couldn't draft form")).toBeTruthy();
      expect(screen.getByText("'type' is required")).toBeTruthy();
      expect(screen.getByText("properties must be an object")).toBeTruthy();
    });
  });
});
