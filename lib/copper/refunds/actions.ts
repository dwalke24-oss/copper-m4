"use server";

// What the Refund Console's buttons do. Each one changes the refund store, then
// refresh() redraws the console with the new state.
//
// No sign-in yet (it arrives in a later module), so anyone who opens /support
// can press these. Fine for a class demo, not for real money.
import { refresh } from "next/cache";
import { reviewRefund, setAutoRefundLimit } from "@/lib/copper/refunds/store";

export type ActionResult = { ok: true } | { ok: false; error: string };

async function review(
  id: string,
  decision: "approved" | "rejected",
  note: string,
): Promise<ActionResult> {
  const result = await reviewRefund(String(id), decision, String(note ?? ""));
  refresh();
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/** A person on the Copper Crew approves a waiting refund. */
export async function approveRefundAction(
  id: string,
  note: string,
): Promise<ActionResult> {
  return review(id, "approved", note);
}

/** A person on the Copper Crew rejects a waiting refund. */
export async function rejectRefundAction(
  id: string,
  note: string,
): Promise<ActionResult> {
  return review(id, "rejected", note);
}

/** Changes the auto-refund limit for every refund filed from now on. */
export async function setAutoRefundLimitAction(
  value: string,
): Promise<ActionResult> {
  const usd = await setAutoRefundLimit(value);
  if (usd === null)
    return {
      ok: false,
      error: "Enter a dollar amount from 0 to 10,000.",
    };
  refresh();
  return { ok: true };
}
