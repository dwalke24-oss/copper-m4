// Reads the refund store and the demo orders for the Refund Console. They
// change with every refund, so this runs per request (connection()) inside
// <Suspense>, not at build time.
import { connection } from "next/server";
import { RefundQueue } from "@/components/copper/refund-queue";
import { lineLabel, readOrders } from "@/lib/copper/orders";
import { getAutoRefundLimit, listRefunds } from "@/lib/copper/refunds/store";

export async function RefundConsole() {
  await connection();
  const [requests, limitUsd, orders] = await Promise.all([
    listRefunds(),
    getAutoRefundLimit(),
    readOrders(),
  ]);
  return (
    <RefundQueue
      requests={requests}
      limitUsd={limitUsd}
      orders={orders.map((o) => ({
        orderId: o.orderId,
        email: o.email,
        items: o.lines.map(lineLabel).join(", "),
        purchasedAt: o.purchasedAt,
      }))}
    />
  );
}
