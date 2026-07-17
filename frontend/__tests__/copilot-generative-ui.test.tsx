// Covers the copilot generative-UI surfaces:
//   - the workflow-transition HITL approve/deny component in both its
//     interactive (pending) and resolved (approved / denied) states, and
//   - the drafted-form card (field summary + edit link, plus the drafting state).
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { WorkflowTransitionApproval } from "@/copilot/WorkflowTransitionApproval";
import { FormDraftCard } from "@/copilot/FormDraftCard";

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
});
