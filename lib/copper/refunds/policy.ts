// The refund rules, as plain code (Product Bible Section 9). No AI here: the
// model can describe a case, but whether money moves, and how much, is decided
// by these functions alone, so a customer can't talk their way past them.
//
// - Devices: returnable within 30 days.
// - Copper Plus annual: refundable within 14 days.
// - Copper Plus monthly: not refunded for partial months.
// - Outage or bug claims: always a person (the supervisors-only Refund
//   Exceptions Playbook).
// - Up to the auto-refund limit: refunded automatically. Over it: a person.
import { formatUsd } from "@/lib/copper/catalog";
import { lineLabel, type Order, type OrderLine } from "@/lib/copper/orders";

export const RETURN_WINDOW_DAYS = 30;
export const ANNUAL_PLAN_WINDOW_DAYS = 14;

export const REASON_CATEGORIES = [
  "changed_mind",
  "defective",
  "outage_or_bug",
  "billing_mistake",
  "other",
] as const;

export type ReasonCategory = (typeof REASON_CATEGORIES)[number];

export const REASON_LABELS: Record<ReasonCategory, string> = {
  changed_mind: "Changed their mind",
  defective: "Defective or not working",
  outage_or_bug: "Outage or bug",
  billing_mistake: "Billing mistake",
  other: "Other",
};

export type LineCheck = {
  lineId: string;
  label: string;
  priceUsd: number;
  eligible: boolean;
  /** Which rule applied, in plain English. */
  rule: string;
};

export type PolicyDecision = {
  outcome: "auto_approved" | "needs_review" | "denied";
  /** What would be refunded: 0 when denied. */
  amountUsd: number;
  lines: LineCheck[];
  /** Why this outcome, for the Copper Crew. */
  rule: string;
};

const cents = (usd: number) => Math.round(usd * 100) / 100;

/** Whole days from the purchase day to today (the purchase day is day 0). */
export function daysSince(purchasedAt: string, now: Date): number {
  const start = Date.parse(`${purchasedAt}T00:00:00Z`);
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((today - start) / 86_400_000);
}

/** Whether one order line can be refunded today, and the rule that says so. */
export function checkLine(
  line: OrderLine,
  purchasedAt: string,
  now: Date,
): LineCheck {
  const days = daysSince(purchasedAt, now);
  const base = {
    lineId: line.lineId,
    label: lineLabel(line),
    priceUsd: line.priceUsd,
  };
  if (line.kind === "device") {
    return days <= RETURN_WINDOW_DAYS
      ? {
          ...base,
          eligible: true,
          rule: `Devices can be returned within ${RETURN_WINDOW_DAYS} days (day ${days}).`,
        }
      : {
          ...base,
          eligible: false,
          rule: `Outside the ${RETURN_WINDOW_DAYS}-day return window (day ${days}). A defect may still be covered by the warranty.`,
        };
  }
  if (line.billing === "monthly") {
    return {
      ...base,
      eligible: false,
      rule: "Monthly Copper Plus isn't refunded for partial months.",
    };
  }
  return days <= ANNUAL_PLAN_WINDOW_DAYS
    ? {
        ...base,
        eligible: true,
        rule: `Annual Copper Plus is refundable within ${ANNUAL_PLAN_WINDOW_DAYS} days (day ${days}).`,
      }
    : {
        ...base,
        eligible: false,
        rule: `Outside the ${ANNUAL_PLAN_WINDOW_DAYS}-day refund window for annual Copper Plus (day ${days}).`,
      };
}

export type DecideRefundInput = {
  order: Order;
  /** The order lines being refunded; they must belong to `order`. */
  lineIds: string[];
  category: ReasonCategory;
  now: Date;
  limitUsd: number;
  /** Already refunded (or approved) on this order, so splitting a refund into small pieces can't dodge the limit. */
  alreadyRefundedUsd: number;
};

/**
 * The decision for one refund request:
 * - an outage or bug claim → a person decides (supervisor playbook);
 * - any line outside the rules → denied, with the rule for each line;
 * - total (plus what's already refunded on the order) within the limit →
 *   refunded automatically;
 * - otherwise → a person decides.
 */
export function decideRefund(input: DecideRefundInput): PolicyDecision {
  const { order, now, limitUsd, alreadyRefundedUsd } = input;
  const wanted = new Set(input.lineIds);
  const chosen = order.lines.filter((line) => wanted.has(line.lineId));
  if (chosen.length === 0 || chosen.length !== wanted.size) {
    throw new Error("Every line must belong to the order.");
  }
  const lines = chosen.map((line) => checkLine(line, order.purchasedAt, now));
  const amountUsd = cents(lines.reduce((sum, l) => sum + l.priceUsd, 0));

  if (input.category === "outage_or_bug") {
    return {
      outcome: "needs_review",
      amountUsd,
      lines,
      rule: "Outage or bug claims go to a supervisor (Refund Exceptions Playbook).",
    };
  }

  const refused = lines.filter((l) => !l.eligible);
  if (refused.length > 0) {
    return {
      outcome: "denied",
      amountUsd: 0,
      lines,
      rule: refused.map((l) => `${l.label}: ${l.rule}`).join(" "),
    };
  }

  const total = cents(amountUsd + alreadyRefundedUsd);
  const counted =
    alreadyRefundedUsd > 0
      ? `${formatUsd(amountUsd)} plus ${formatUsd(alreadyRefundedUsd)} already refunded on this order`
      : formatUsd(amountUsd);
  if (total <= limitUsd) {
    return {
      outcome: "auto_approved",
      amountUsd,
      lines,
      rule: `${counted} is within the ${formatUsd(limitUsd)} auto-refund limit.`,
    };
  }
  return {
    outcome: "needs_review",
    amountUsd,
    lines,
    rule: `${counted} is over the ${formatUsd(limitUsd)} auto-refund limit, so a person approves it.`,
  };
}
