// Module 4: refunds. The rules and the limit are plain code, so these run with
// no AI key: the Refund agent's one model call is replaced by a fake.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RefundReading } from "@/lib/copper/refunds/agent";

// The Refund agent's model call: whatever the test sets, or a failure.
let reading: RefundReading | Error = { category: "changed_mind", note: "n" };
const calls: unknown[] = [];
vi.mock("@/lib/ai/call", async (original) => ({
  ...(await original<object>()),
  callObject: async (info: unknown, options: unknown) => {
    calls.push({ info, options });
    if (reading instanceof Error) throw reading;
    return { output: reading };
  },
}));

const NOW = new Date("2026-11-17T18:00:00Z");

const { readOrders, findOrder, dayBefore } =
  await import("@/lib/copper/orders");
const { checkLine, decideRefund, daysSince } =
  await import("@/lib/copper/refunds/policy");
const { parseLimit, envAutoRefundLimit, DEFAULT_AUTO_REFUND_LIMIT_USD } =
  await import("@/lib/copper/refunds/config");
const store = await import("@/lib/copper/refunds/store");
const { requestRefund } = await import("@/lib/copper/refunds/agent");
const { lookupOrder, checkRefundStatus, refundTools, requestRefundInput } =
  await import("@/lib/copper/assistant/refund-tools");

const order = async (id: string) =>
  (await readOrders(NOW)).find((o) => o.orderId === id)!;

beforeEach(() => {
  store.resetRefunds();
  reading = { category: "changed_mind", note: "Wants a refund." };
  calls.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe("orders", () => {
  it("finds an order only when the order number and email both match", async () => {
    expect(
      await findOrder("csl-1001", " Maria.Lopez@example.com ", NOW),
    ).toMatchObject({
      orderId: "CSL-1001",
    });
    expect(await findOrder("CSL-1001", "someone@example.com", NOW)).toBeNull();
    expect(
      await findOrder("CSL-9999", "maria.lopez@example.com", NOW),
    ).toBeNull();
  });

  it("dates the demo orders relative to today, so they never age out", async () => {
    expect((await order("CSL-1001")).purchasedAt).toBe(dayBefore(NOW, 10));
    expect(daysSince((await order("CSL-1004")).purchasedAt, NOW)).toBe(45);
  });
});

describe("refund rules", () => {
  const device = {
    lineId: "x",
    kind: "device" as const,
    productId: "copper-home" as const,
    name: "Copper Home",
    color: "Night Sky",
    priceUsd: 149,
  };
  const plan = (billing: "monthly" | "annual") => ({
    lineId: "p",
    kind: "plan" as const,
    planId: "copper-plus" as const,
    name: "Copper Plus",
    billing,
    priceUsd: billing === "annual" ? 79 : 7.99,
  });

  it("devices: day 30 is in the return window, day 31 is not", () => {
    expect(checkLine(device, dayBefore(NOW, 30), NOW).eligible).toBe(true);
    expect(checkLine(device, dayBefore(NOW, 31), NOW).eligible).toBe(false);
  });

  it("annual Copper Plus: day 14 is refundable, day 15 is not; monthly never is", () => {
    expect(checkLine(plan("annual"), dayBefore(NOW, 14), NOW).eligible).toBe(
      true,
    );
    expect(checkLine(plan("annual"), dayBefore(NOW, 15), NOW).eligible).toBe(
      false,
    );
    expect(checkLine(plan("monthly"), dayBefore(NOW, 1), NOW)).toMatchObject({
      eligible: false,
      rule: expect.stringMatching(/partial months/),
    });
  });

  const decide = async (
    id: string,
    limitUsd: number,
    category: "changed_mind" | "outage_or_bug" = "changed_mind",
    alreadyRefundedUsd = 0,
    lineIds?: string[],
  ) => {
    const o = await order(id);
    return decideRefund({
      order: o,
      lineIds: lineIds ?? o.lines.map((l) => l.lineId),
      category,
      now: NOW,
      limitUsd,
      alreadyRefundedUsd,
    });
  };

  it("within the limit is refunded automatically; over it goes to a person; the limit itself counts as within", async () => {
    expect(await decide("CSL-1003", 100)).toMatchObject({
      outcome: "auto_approved",
      amountUsd: 79,
    });
    expect(await decide("CSL-1003", 79)).toMatchObject({
      outcome: "auto_approved",
    });
    expect(await decide("CSL-1003", 78.99)).toMatchObject({
      outcome: "needs_review",
    });
    expect(await decide("CSL-1001", 100)).toMatchObject({
      outcome: "needs_review",
      amountUsd: 129,
    });
    expect(await decide("CSL-1003", 0)).toMatchObject({
      outcome: "needs_review",
    });
  });

  it("counts what's already refunded on the order, so splitting a refund can't dodge the limit", async () => {
    const d = await decide("CSL-1003", 100, "changed_mind", 30);
    expect(d.outcome).toBe("needs_review");
    expect(d.rule).toMatch(/already refunded/);
  });

  it("denies anything outside the rules, with the reason, and refunds nothing", async () => {
    const d = await decide("CSL-1004", 1000);
    expect(d).toMatchObject({ outcome: "denied", amountUsd: 0 });
    expect(d.rule).toMatch(/30-day return window/);
    expect((await decide("CSL-1002", 1000)).outcome).toBe("denied");
    expect((await decide("CSL-1006", 1000)).outcome).toBe("denied");
  });

  it("always sends outage or bug claims to a person, even small or out-of-window ones", async () => {
    expect((await decide("CSL-1002", 1000, "outage_or_bug")).outcome).toBe(
      "needs_review",
    );
  });

  it("refuses lines that aren't on the order", async () => {
    await expect(
      decide("CSL-1001", 100, "changed_mind", 0, ["CSL-1005-1"]),
    ).rejects.toThrow();
  });
});

describe("the auto-refund limit", () => {
  it("reads REFUND_AUTO_LIMIT_USD, falling back to the default when it's missing or unusable", () => {
    vi.stubEnv("REFUND_AUTO_LIMIT_USD", "");
    expect(envAutoRefundLimit()).toBe(DEFAULT_AUTO_REFUND_LIMIT_USD);
    vi.stubEnv("REFUND_AUTO_LIMIT_USD", "250");
    expect(envAutoRefundLimit()).toBe(250);
    vi.stubEnv("REFUND_AUTO_LIMIT_USD", "-5");
    expect(envAutoRefundLimit()).toBe(DEFAULT_AUTO_REFUND_LIMIT_USD);
    vi.stubEnv("REFUND_AUTO_LIMIT_USD", "lots");
    expect(envAutoRefundLimit()).toBe(DEFAULT_AUTO_REFUND_LIMIT_USD);
  });

  it("accepts 0 to 10,000 dollars, with or without a $", () => {
    expect(parseLimit("0")).toBe(0);
    expect(parseLimit("$75.5")).toBe(75.5);
    expect(parseLimit("10001")).toBeNull();
    expect(parseLimit("")).toBeNull();
  });

  it("a limit set on the console wins over the environment and applies to the next refund", async () => {
    vi.stubEnv("REFUND_AUTO_LIMIT_USD", "250");
    expect(await store.getAutoRefundLimit()).toBe(250);
    expect(await store.setAutoRefundLimit("50")).toBe(50);
    expect(await store.getAutoRefundLimit()).toBe(50);
    expect(await store.setAutoRefundLimit("abc")).toBeNull();
    expect(await store.getAutoRefundLimit()).toBe(50);

    const result = await requestRefund(
      {
        orderId: "CSL-1003",
        email: "priya.shah@example.com",
        lineIds: ["CSL-1003-1"],
        reason: "Not using it",
      },
      NOW,
    );
    expect(result.status).toBe("pending_review");
  });
});

describe("the Refund agent", () => {
  const priya = {
    orderId: "CSL-1003",
    email: "priya.shah@example.com",
    lineIds: ["CSL-1003-1"],
    reason: "I'm not using it.",
  };

  it("refunds an eligible request within the limit, logs its model call as module 4, and saves it", async () => {
    const result = await requestRefund(priya, NOW);
    expect(result).toMatchObject({
      status: "auto_approved",
      amountUsd: 79,
      referenceId: "R-1001",
      message: expect.stringMatching(/\$79.*R-1001/),
    });
    expect(calls[0]).toMatchObject({
      info: { module: 4, feature: "refund-agent" },
    });
    const [saved] = await store.listRefunds();
    expect(saved).toMatchObject({
      status: "auto_approved",
      decidedBy: "policy",
      limitUsd: 100,
      customerReason: "I'm not using it.",
    });
  });

  it("sends a request over the limit to a person, without telling the customer the limit", async () => {
    const result = await requestRefund(
      {
        orderId: "CSL-1001",
        email: "maria.lopez@example.com",
        lineIds: ["CSL-1001-1"],
        reason: "Not for me",
      },
      NOW,
    );
    expect(result.status).toBe("pending_review");
    expect(JSON.stringify(result)).not.toMatch(/\$100|limit/i);
  });

  it("uses the model's reading only for the category: an outage claim goes to a person", async () => {
    reading = { category: "outage_or_bug", note: "Copper Cloud was down." };
    const result = await requestRefund(
      {
        orderId: "CSL-1002",
        email: "sam.whitehorse@example.com",
        lineIds: ["CSL-1002-1"],
        reason: "Copper was down all week",
      },
      NOW,
    );
    expect(result.status).toBe("pending_review");
  });

  it("still decides when the model call fails, filing the reason as 'other'", async () => {
    reading = new Error("model down");
    const result = await requestRefund(priya, NOW);
    expect(result.status).toBe("auto_approved");
    expect((await store.listRefunds())[0].category).toBe("other");
  });

  it("won't file anything without the right email, or for items not on the order", async () => {
    expect(
      (await requestRefund({ ...priya, email: "attacker@example.com" }, NOW))
        .status,
    ).toBe("order_not_found");
    expect(
      (await requestRefund({ ...priya, lineIds: ["CSL-1001-1"] }, NOW)).status,
    ).toBe("unknown_items");
    expect(await store.listRefunds()).toHaveLength(0);
  });

  it("won't refund the same item twice", async () => {
    await requestRefund(priya, NOW);
    const again = await requestRefund(priya, NOW);
    expect(again).toMatchObject({
      status: "already_requested",
      referenceId: "R-1001",
    });
    expect(await store.listRefunds()).toHaveLength(1);
  });

  it("a denied request doesn't hold the item", async () => {
    const jordan = {
      orderId: "CSL-1004",
      email: "jordan.begay@example.com",
      lineIds: ["CSL-1004-1"],
      reason: "x",
    };
    expect((await requestRefund(jordan, NOW)).status).toBe("denied");
    expect((await requestRefund(jordan, NOW)).status).toBe("denied");
  });

  it("request_refund has no amount field: the chat can't choose how much", () => {
    expect(Object.keys(requestRefundInput.shape).sort()).toEqual([
      "email",
      "lineIds",
      "orderId",
      "reason",
    ]);
    expect(
      requestRefundInput.parse({ ...priya, amountUsd: 500 }),
    ).not.toHaveProperty("amountUsd");
  });
});

describe("Approve / Reject", () => {
  const maria = {
    orderId: "CSL-1001",
    email: "maria.lopez@example.com",
    lineIds: ["CSL-1001-1"],
    reason: "Not for me",
  };

  it("a person approves a waiting refund once; a second decision is refused", async () => {
    const { referenceId } = (await requestRefund(maria, NOW)) as {
      referenceId: string;
    };
    const first = await store.reviewRefund(referenceId, "approved", " Enjoy! ");
    expect(first).toMatchObject({
      ok: true,
      request: {
        status: "approved",
        decidedBy: "person",
        reviewerNote: "Enjoy!",
      },
    });
    expect(await store.reviewRefund(referenceId, "rejected")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/already decided/),
    });
    expect(await store.refundedUsdFor("CSL-1001")).toBe(129);
  });

  it("only waiting requests can be decided", async () => {
    const { referenceId } = (await requestRefund(
      {
        orderId: "CSL-1003",
        email: "priya.shah@example.com",
        lineIds: ["CSL-1003-1"],
        reason: "x",
      },
      NOW,
    )) as { referenceId: string };
    expect((await store.reviewRefund(referenceId, "rejected")).ok).toBe(false);
    expect((await store.reviewRefund("R-9999", "approved")).ok).toBe(false);
  });

  it("a rejected refund frees the item and adds nothing to what's been refunded", async () => {
    const { referenceId } = (await requestRefund(maria, NOW)) as {
      referenceId: string;
    };
    await store.reviewRefund(referenceId, "rejected", "Opened and used.");
    expect(await store.refundedUsdFor("CSL-1001")).toBe(0);
    expect((await requestRefund(maria, NOW)).status).toBe("pending_review");
  });

  it("the customer sees the decision and note with check_refund_status, only with the right email", async () => {
    const { referenceId } = (await requestRefund(maria, NOW)) as {
      referenceId: string;
    };
    expect(
      await checkRefundStatus({ referenceId, email: maria.email }),
    ).toMatchObject({ requestStatus: "pending_review", amountUsd: 129 });
    await store.reviewRefund(referenceId, "rejected", "Opened and used.");
    expect(
      await checkRefundStatus({ referenceId, email: maria.email }),
    ).toMatchObject({ requestStatus: "rejected", note: "Opened and used." });
    expect(
      (await checkRefundStatus({ referenceId, email: "x@example.com" })).status,
    ).toBe("not_found");
  });
});

describe("the Support agent's refund tools", () => {
  it("lookup_order lists each item with its lineId, window and any refund on it", async () => {
    await requestRefund(
      {
        orderId: "CSL-1005",
        email: "alex.kim@example.com",
        lineIds: ["CSL-1005-2"],
        reason: "x",
      },
      NOW,
    );
    const found = await lookupOrder(
      { orderId: "CSL-1005", email: "alex.kim@example.com" },
      NOW,
    );
    expect(found).toMatchObject({
      status: "ok",
      lines: [
        { lineId: "CSL-1005-1", withinRefundWindow: true, refund: null },
        {
          lineId: "CSL-1005-2",
          refund: { referenceId: "R-1001", status: "pending_review" },
        },
      ],
    });
    expect(JSON.stringify(found)).not.toMatch(/@example\.com/);
    expect(
      (await lookupOrder({ orderId: "CSL-1005", email: "no@example.com" }, NOW))
        .status,
    ).toBe("not_found");
  });

  it("all three are described and runnable, and Ask Copper offers them", async () => {
    const { copperTools } = await import("@/lib/copper/assistant/tools");
    for (const name of [
      "lookup_order",
      "request_refund",
      "check_refund_status",
    ]) {
      const tool = refundTools[name as keyof typeof refundTools];
      expect(tool.description).toMatch(/\w{4,}/);
      expect(copperTools).toHaveProperty(name);
    }
  });
});
