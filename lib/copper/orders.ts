// Customer orders, for refunds (Module 4). This is the only file that knows
// where orders are kept, so swapping the JSON file for a database later means
// changing only readOrders().
import type { ProductId } from "@/lib/copper/catalog";
import data from "./data/orders.json";

export type DeviceLine = {
  lineId: string;
  kind: "device";
  productId: ProductId;
  name: string;
  color: string;
  priceUsd: number;
};

export type PlanLine = {
  lineId: string;
  kind: "plan";
  planId: "copper-plus";
  name: string;
  billing: "monthly" | "annual";
  priceUsd: number;
};

export type OrderLine = DeviceLine | PlanLine;

export type Order = {
  orderId: string;
  email: string;
  customerName: string;
  /** The day it was bought, as YYYY-MM-DD. */
  purchasedAt: string;
  lines: OrderLine[];
};

/** The calendar day (YYYY-MM-DD, UTC) `days` before `now`. */
export function dayBefore(now: Date, days: number): string {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/**
 * Every order. The demo orders store how many days ago they were bought, so
 * their purchase dates move with today and they never age out of the windows.
 */
export async function readOrders(now: Date = new Date()): Promise<Order[]> {
  return data.orders.map(({ daysAgo, ...order }) => ({
    ...structuredClone(order),
    purchasedAt: dayBefore(now, daysAgo),
  })) as Order[];
}

const clean = (value: string) => value.trim().toLowerCase();

/**
 * One order, only when the order number AND the email on it both match. The
 * email is the identity check: without it, anyone could refund anyone's order.
 */
export async function findOrder(
  orderId: string,
  email: string,
  now: Date = new Date(),
): Promise<Order | null> {
  const orders = await readOrders(now);
  return (
    orders.find(
      (o) =>
        clean(o.orderId) === clean(orderId) && clean(o.email) === clean(email),
    ) ?? null
  );
}

/** "Copper Notes (Desert Sand)", "Copper Plus (annual)". */
export function lineLabel(line: OrderLine): string {
  return line.kind === "device"
    ? `${line.name} (${line.color})`
    : `${line.name} (${line.billing})`;
}
