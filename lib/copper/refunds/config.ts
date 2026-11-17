// The auto-refund limit: refunds up to this many dollars (per order, counting
// what's already been refunded on it) go through without a person. Anything
// over it waits on the Refund Console for the Copper Crew to approve.
//
// Where the limit comes from, first match wins:
// 1. The value set on the Refund Console (kept in the refund store).
// 2. REFUND_AUTO_LIMIT_USD in .env.local / the Vercel project settings.
// 3. DEFAULT_AUTO_REFUND_LIMIT_USD below.

/**
 * $100 sends every device (Copper Home $149, Copper Notes $129) to a person
 * while an annual Copper Plus refund ($79) goes through on its own.
 */
export const DEFAULT_AUTO_REFUND_LIMIT_USD = 100;

/** Highest limit the console accepts. */
export const MAX_AUTO_REFUND_LIMIT_USD = 10_000;

/**
 * A limit in dollars, or null when the value isn't a usable limit. 0 is
 * allowed and means every refund needs a person.
 */
export function parseLimit(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(/^\$/, "");
  if (text === "") return null;
  const usd = Number(text);
  if (!Number.isFinite(usd) || usd < 0 || usd > MAX_AUTO_REFUND_LIMIT_USD)
    return null;
  return Math.round(usd * 100) / 100;
}

/** REFUND_AUTO_LIMIT_USD if it's a usable limit, otherwise the default. */
export function envAutoRefundLimit(): number {
  return (
    parseLimit(process.env.REFUND_AUTO_LIMIT_USD) ??
    DEFAULT_AUTO_REFUND_LIMIT_USD
  );
}
