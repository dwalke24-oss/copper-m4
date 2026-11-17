// Module 4: the refund tools Ask Copper (the Support agent) can use.
// - lookup_order: finds the customer's order, so Copper knows what's on it.
// - request_refund: hands the case to the Refund agent (lib/copper/refunds/agent.ts).
// - check_refund_status: says where a request stands after a person decides.
// None of them takes an amount: what's refunded comes from the order and the
// rules, never from the chat.
import { tool } from "ai";
import { z } from "zod";
import { findOrder, lineLabel } from "@/lib/copper/orders";
import { requestRefund } from "@/lib/copper/refunds/agent";
import { checkLine } from "@/lib/copper/refunds/policy";
import {
  getRefund,
  heldLinesFor,
  type RefundStatus,
} from "@/lib/copper/refunds/store";

const orderId = z
  .string()
  .min(3)
  .max(40)
  .describe("The order number, like CSL-1001.");
const email = z
  .string()
  .min(3)
  .max(200)
  .describe("The email address on the order, exactly as the customer gave it.");

export const lookupOrderInput = z.object({ orderId, email });

export type OrderLookup =
  | {
      status: "ok";
      orderId: string;
      purchasedAt: string;
      lines: {
        lineId: string;
        item: string;
        priceUsd: number;
        /** Whether the refund rules allow it today, before any reason. */
        withinRefundWindow: boolean;
        /** An open or finished refund request for this item, if any. */
        refund: { referenceId: string; status: RefundStatus } | null;
      }[];
    }
  | { status: "not_found"; message: string };

/** lookup_order: one order, only when the order number and email match. */
export async function lookupOrder(
  input: z.infer<typeof lookupOrderInput>,
  now: Date = new Date(),
): Promise<OrderLookup> {
  const order = await findOrder(input.orderId, input.email, now);
  if (!order)
    return {
      status: "not_found",
      message:
        "No order matches that order number and email. Ask the customer to check both.",
    };
  const held = await heldLinesFor(order.orderId);
  return {
    status: "ok",
    orderId: order.orderId,
    purchasedAt: order.purchasedAt,
    lines: order.lines.map((line) => {
      const request = held.get(line.lineId);
      return {
        lineId: line.lineId,
        item: lineLabel(line),
        priceUsd: line.priceUsd,
        withinRefundWindow: checkLine(line, order.purchasedAt, now).eligible,
        refund: request
          ? { referenceId: request.id, status: request.status }
          : null,
      };
    }),
  };
}

export const requestRefundInput = z.object({
  orderId,
  email,
  lineIds: z
    .array(z.string().min(1))
    .min(1)
    .max(10)
    .describe("The lineId of each item to refund, from lookup_order."),
  reason: z
    .string()
    .min(2)
    .max(1000)
    .describe("Why the customer wants a refund, in their own words."),
});

export const checkRefundStatusInput = z.object({
  referenceId: z
    .string()
    .min(3)
    .max(20)
    .describe("The refund reference, like R-1001."),
  email,
});

export type RefundStatusResult =
  | {
      status: "ok";
      referenceId: string;
      requestStatus: RefundStatus;
      amountUsd: number;
      items: string[];
      /** The Copper Crew's note, once a person has decided. */
      note: string | null;
    }
  | { status: "not_found"; message: string };

const NOT_FOUND: RefundStatusResult = {
  status: "not_found",
  message:
    "No refund request matches that reference and email. Ask the customer to check both.",
};

/** check_refund_status: where one request stands. The email must match the order. */
export async function checkRefundStatus(
  input: z.infer<typeof checkRefundStatusInput>,
): Promise<RefundStatusResult> {
  const request = await getRefund(input.referenceId);
  if (!request) return NOT_FOUND;
  // Proves it's the customer's own request without showing anyone's email.
  const order = await findOrder(request.orderId, input.email);
  if (!order) return NOT_FOUND;
  return {
    status: "ok",
    referenceId: request.id,
    requestStatus: request.status,
    amountUsd: request.amountUsd,
    items: request.lines.map((l) => l.label),
    note: request.reviewerNote,
  };
}

export const refundTools = {
  lookup_order: tool({
    description:
      "Finds a customer's order by order number and the email on it. Returns each item with its lineId, price, whether it's within its refund window, and any refund already requested for it.",
    inputSchema: lookupOrderInput,
    execute: async (input) => lookupOrder(input),
  }),
  request_refund: tool({
    description:
      "Files a refund request with the Refund agent for items on an order. The refund rules decide the outcome: refunded now, sent to a person on the Copper Crew for approval, or not eligible. Returns that outcome, a reference number and a message to pass on.",
    inputSchema: requestRefundInput,
    execute: async (input) => requestRefund(input),
  }),
  check_refund_status: tool({
    description:
      "Checks where a refund request stands (refunded, waiting for approval, approved, rejected or not eligible) by its reference number and the email on the order.",
    inputSchema: checkRefundStatusInput,
    execute: async (input) => checkRefundStatus(input),
  }),
};
