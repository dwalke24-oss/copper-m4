// Refund requests and the console's auto-refund limit. This is the only file
// that knows where they're kept, so moving them to a database later means
// changing only this file.
//
// For now they live in the server's memory: they reset when the server
// restarts, and on Vercel separate server instances don't share them. Fine
// for a class demo; a real Copper Crew would need a database table.
import { envAutoRefundLimit, parseLimit } from "@/lib/copper/refunds/config";
import type { LineCheck, ReasonCategory } from "@/lib/copper/refunds/policy";

export type RefundStatus =
  "auto_approved" | "pending_review" | "approved" | "rejected" | "denied";

export type RefundRequest = {
  /** The customer's reference, like "R-1001". */
  id: string;
  orderId: string;
  customerName: string;
  lines: LineCheck[];
  amountUsd: number;
  /** What the customer said, in their words. */
  customerReason: string;
  /** The Refund agent's reading of it. */
  category: ReasonCategory;
  /** The Refund agent's one-line summary for the Copper Crew. */
  agentNote: string;
  /** The policy rule that decided where it went. */
  rule: string;
  /** The auto-refund limit when it was decided. */
  limitUsd: number;
  status: RefundStatus;
  decidedBy: "policy" | "person" | null;
  /** The Copper Crew's note to the customer, on approve or reject. */
  reviewerNote: string | null;
  createdAt: string;
  decidedAt: string | null;
};

export type NewRefund = Omit<
  RefundRequest,
  "id" | "createdAt" | "decidedAt" | "decidedBy" | "reviewerNote"
>;

type State = {
  requests: RefundRequest[];
  nextNumber: number;
  /** Set on the Refund Console; null means use the environment or default. */
  limitUsd: number | null;
};

const fresh = (): State => ({ requests: [], nextNumber: 1001, limitUsd: null });

// Kept on globalThis so the dev server's hot reload doesn't wipe it.
const holder = globalThis as typeof globalThis & { __copperRefunds?: State };
const state = (): State => (holder.__copperRefunds ??= fresh());

/** Statuses where the money has gone (or will) back to the customer. */
const REFUNDED: RefundStatus[] = ["auto_approved", "approved"];
/** Statuses that hold an order line, so it can't be requested twice. */
const HOLDING: RefundStatus[] = ["auto_approved", "approved", "pending_review"];

/** Every request, newest first. */
export async function listRefunds(): Promise<RefundRequest[]> {
  return structuredClone(state().requests).reverse();
}

export async function getRefund(id: string): Promise<RefundRequest | null> {
  const found = state().requests.find(
    (r) => r.id.toLowerCase() === id.trim().toLowerCase(),
  );
  return found ? structuredClone(found) : null;
}

/** Saves a new request and gives it a reference number. */
export async function addRefund(input: NewRefund): Promise<RefundRequest> {
  const s = state();
  const now = new Date().toISOString();
  const decided = input.status !== "pending_review";
  const request: RefundRequest = {
    ...structuredClone(input),
    id: `R-${s.nextNumber++}`,
    decidedBy: decided ? "policy" : null,
    reviewerNote: null,
    createdAt: now,
    decidedAt: decided ? now : null,
  };
  s.requests.push(request);
  return structuredClone(request);
}

export type ReviewResult =
  { ok: true; request: RefundRequest } | { ok: false; error: string };

/**
 * A person approves or rejects a waiting request. Only "pending_review" can
 * change, so a double click (or two people at once) can't decide it twice.
 */
export async function reviewRefund(
  id: string,
  decision: "approved" | "rejected",
  note?: string,
): Promise<ReviewResult> {
  const request = state().requests.find((r) => r.id === id);
  if (!request) return { ok: false, error: `No refund request ${id}.` };
  if (request.status !== "pending_review")
    return { ok: false, error: `${id} was already decided.` };
  request.status = decision;
  request.decidedBy = "person";
  request.reviewerNote = note?.trim() ? note.trim().slice(0, 500) : null;
  request.decidedAt = new Date().toISOString();
  return { ok: true, request: structuredClone(request) };
}

/** Dollars already refunded, or approved, on an order. */
export async function refundedUsdFor(orderId: string): Promise<number> {
  const total = state()
    .requests.filter(
      (r) => r.orderId === orderId && REFUNDED.includes(r.status),
    )
    .reduce((sum, r) => sum + r.amountUsd, 0);
  return Math.round(total * 100) / 100;
}

/** The open or refunded request holding each order line, by line ID. */
export async function heldLinesFor(
  orderId: string,
): Promise<Map<string, RefundRequest>> {
  const held = new Map<string, RefundRequest>();
  for (const r of state().requests) {
    if (r.orderId !== orderId || !HOLDING.includes(r.status)) continue;
    for (const line of r.lines) held.set(line.lineId, structuredClone(r));
  }
  return held;
}

/** The auto-refund limit in force right now. */
export async function getAutoRefundLimit(): Promise<number> {
  return state().limitUsd ?? envAutoRefundLimit();
}

/** Sets the limit from the console. Returns the new limit, or null if the value isn't usable. */
export async function setAutoRefundLimit(
  value: unknown,
): Promise<number | null> {
  const usd = parseLimit(value);
  if (usd === null) return null;
  state().limitUsd = usd;
  return usd;
}

/** Empties the store. For tests. */
export function resetRefunds(): void {
  holder.__copperRefunds = fresh();
}
