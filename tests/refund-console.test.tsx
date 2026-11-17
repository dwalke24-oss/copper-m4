// Module 4: the Refund Console's Approve / Reject buttons and limit box. The
// Server Actions are replaced by spies, so this checks what the page sends.
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RefundRequest } from "@/lib/copper/refunds/store";

const actions = vi.hoisted(() => ({
  approveRefundAction: vi.fn(async () => ({ ok: true as const })),
  rejectRefundAction: vi.fn(async () => ({ ok: true as const })),
  setAutoRefundLimitAction: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock("@/lib/copper/refunds/actions", () => actions);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { RefundQueue, REFRESH_EVERY_MS } =
  await import("@/components/copper/refund-queue");
const { announceRefundsChanged, setChatBusy } =
  await import("@/lib/copper/chat-activity");

afterEach(() => {
  cleanup();
  setChatBusy(false);
  vi.useRealTimers();
  vi.clearAllMocks();
});

const request = (over: Partial<RefundRequest>): RefundRequest => ({
  id: "R-1001",
  orderId: "CSL-1001",
  customerName: "Maria Lopez",
  lines: [
    {
      lineId: "CSL-1001-1",
      label: "Copper Notes (Desert Sand)",
      priceUsd: 129,
      eligible: true,
      rule: "Devices can be returned within 30 days (day 10).",
    },
  ],
  amountUsd: 129,
  customerReason: "It doesn't fit my routine.",
  category: "changed_mind",
  agentNote: "Bought Copper Notes, no longer wants it.",
  rule: "$129 is over the $100 auto-refund limit, so a person approves it.",
  limitUsd: 100,
  status: "pending_review",
  decidedBy: null,
  reviewerNote: null,
  createdAt: "2026-11-17T18:00:00Z",
  decidedAt: null,
  ...over,
});

const renderQueue = (requests: RefundRequest[], limitUsd = 100) =>
  render(<RefundQueue requests={requests} limitUsd={limitUsd} orders={[]} />);

describe("Refund Console", () => {
  it("shows each waiting refund with the customer's words, the agent's note and the rule", () => {
    renderQueue([
      request({}),
      request({
        id: "R-1002",
        status: "auto_approved",
        decidedBy: "policy",
        amountUsd: 79,
      }),
    ]);
    const card = within(screen.getByTestId("review-card"));
    expect(card.getByText(/doesn't fit my routine/)).toBeInTheDocument();
    expect(card.getByText(/no longer wants it/)).toBeInTheDocument();
    expect(
      card.getByText(/over the \$100 auto-refund limit/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Waiting for approval \(1\)/ }),
    ).toBeVisible();
    expect(screen.getByText("Auto-refunded")).toBeInTheDocument();
    expect(screen.getByTestId("refund-limit")).toHaveTextContent("$100");
  });

  it("Approve and Reject send the request and the optional note", async () => {
    renderQueue([request({})]);
    fireEvent.change(screen.getByLabelText(/Note to the customer/), {
      target: { value: "Approved, sorry it didn't work out." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Approve/ }));
    await waitFor(() =>
      expect(actions.approveRefundAction).toHaveBeenCalledWith(
        "R-1001",
        "Approved, sorry it didn't work out.",
      ),
    );
    // After a decision the card leaves the queue, so Reject gets a fresh one.
    cleanup();
    renderQueue([request({ id: "R-1002" })]);
    fireEvent.click(screen.getByRole("button", { name: /Reject/ }));
    await waitFor(() =>
      expect(actions.rejectRefundAction).toHaveBeenCalledWith("R-1002", ""),
    );
  });

  it("saves a new auto-refund limit", async () => {
    renderQueue([], 100);
    expect(screen.getByText(/Nothing waiting/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Limit in dollars"), {
      target: { value: "150" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(actions.setAutoRefundLimitAction).toHaveBeenCalledWith("150"),
    );
  });

  it("redraws when Copper files a refund in the chat", () => {
    renderQueue([]);
    announceRefundsChanged();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("checks the server every few seconds, so refunds filed in another tab show up", () => {
    vi.useFakeTimers();
    renderQueue([]);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(REFRESH_EVERY_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(REFRESH_EVERY_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("never redraws in the middle of a chat answer, and catches up when the chat is done", () => {
    vi.useFakeTimers();
    renderQueue([]);
    setChatBusy(true);
    vi.advanceTimersByTime(REFRESH_EVERY_MS * 3);
    announceRefundsChanged();
    expect(refresh).not.toHaveBeenCalled();
    setChatBusy(false);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("has a Refresh button", () => {
    renderQueue([]);
    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
