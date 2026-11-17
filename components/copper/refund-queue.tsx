"use client";

// The Refund Console's working area (Module 4): the auto-refund limit, the
// refunds waiting for a person to Approve or Reject, everything already
// decided, and the demo orders to try in the chat. It redraws when Copper
// files a refund in the docked chat, and checks for new ones every few seconds.
import { CheckIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatUsd } from "@/lib/copper/catalog";
import {
  CHAT_IDLE_EVENT,
  isChatBusy,
  REFUNDS_CHANGED_EVENT,
} from "@/lib/copper/chat-activity";
import {
  type ActionResult,
  approveRefundAction,
  rejectRefundAction,
  setAutoRefundLimitAction,
} from "@/lib/copper/refunds/actions";
import { REASON_LABELS } from "@/lib/copper/refunds/policy";
import type { RefundRequest, RefundStatus } from "@/lib/copper/refunds/store";

/** How often the console checks the server for new refunds. */
export const REFRESH_EVERY_MS = 5000;

export type DemoOrder = {
  orderId: string;
  email: string;
  items: string;
  purchasedAt: string;
};

const STATUS: Record<RefundStatus, { label: string; className: string }> = {
  auto_approved: {
    label: "Auto-refunded",
    className: "bg-accent text-white",
  },
  approved: { label: "Approved", className: "bg-accent text-white" },
  pending_review: {
    label: "Waiting",
    className: "bg-chart-4 text-chart-5",
  },
  rejected: { label: "Rejected", className: "bg-chart-3 text-white" },
  denied: { label: "Not eligible", className: "bg-chart-3 text-white" },
};

function StatusBadge({ status }: { status: RefundStatus }) {
  const { label, className } = STATUS[status];
  return <Badge className={className}>{label}</Badge>;
}

const time = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export function RefundQueue({
  requests,
  limitUsd,
  orders,
}: {
  requests: RefundRequest[];
  limitUsd: number;
  orders: DemoOrder[];
}) {
  const router = useRouter();

  // Keep the console current: redraw right away when the docked chat files a
  // refund, every few seconds while this tab is showing (refunds filed in
  // another tab or window), and when the tab comes back into view. Never in
  // the middle of a chat answer: redrawing then could cut Copper's answer
  // off, so a redraw that's due waits until the chat is idle.
  useEffect(() => {
    let due = false;
    const refresh = () => {
      if (isChatBusy()) {
        due = true;
        return;
      }
      due = false;
      router.refresh();
    };
    const showing = () => document.visibilityState === "visible";
    const whenShowing = () => showing() && refresh();
    const whenIdle = () => due && refresh();
    const timer = window.setInterval(whenShowing, REFRESH_EVERY_MS);
    window.addEventListener(REFUNDS_CHANGED_EVENT, refresh);
    window.addEventListener(CHAT_IDLE_EVENT, whenIdle);
    window.addEventListener("focus", whenShowing);
    document.addEventListener("visibilitychange", whenShowing);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(REFUNDS_CHANGED_EVENT, refresh);
      window.removeEventListener(CHAT_IDLE_EVENT, whenIdle);
      window.removeEventListener("focus", whenShowing);
      document.removeEventListener("visibilitychange", whenShowing);
    };
  }, [router]);

  const waiting = requests.filter((r) => r.status === "pending_review");
  const decided = requests.filter((r) => r.status !== "pending_review");

  return (
    <div className="mt-6 space-y-8">
      {/* Keyed by the limit, so the box resets when the saved limit changes. */}
      <LimitCard key={limitUsd} limitUsd={limitUsd} />

      <section aria-labelledby="waiting-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="waiting-heading" className="text-xl font-semibold">
            Waiting for approval{" "}
            <span className="text-muted-foreground text-base font-normal">
              ({waiting.length})
            </span>
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.refresh()}
            title={`The console also checks for new refunds every ${REFRESH_EVERY_MS / 1000} seconds.`}
          >
            <RefreshCwIcon /> Refresh
          </Button>
        </div>
        {waiting.length === 0 ? (
          <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">
            Nothing waiting. Refunds over {formatUsd(limitUsd)} show up here for
            a person to approve.
          </p>
        ) : (
          waiting.map((request) => (
            <ReviewCard key={request.id} request={request} />
          ))
        )}
      </section>

      <section aria-labelledby="history-heading" className="space-y-3">
        <h2 id="history-heading" className="text-xl font-semibold">
          Decided
        </h2>
        {decided.length === 0 ? (
          <p className="text-muted-foreground text-sm">No refunds yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ref</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Items</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {decided.map((r) => (
                <TableRow key={r.id} title={r.rule}>
                  <TableCell className="font-mono">{r.id}</TableCell>
                  <TableCell>{r.orderId}</TableCell>
                  <TableCell className="whitespace-normal">
                    {r.lines.map((l) => l.label).join(", ")}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {r.status === "denied" ? "—" : formatUsd(r.amountUsd)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.decidedBy === "person" ? "Copper Crew" : "Rules"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section aria-labelledby="orders-heading" className="space-y-3">
        <h2 id="orders-heading" className="text-xl font-semibold">
          Demo orders
        </h2>
        <p className="text-muted-foreground text-sm">
          Fictional orders to try in the chat: give Copper an order number and
          its email.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Items</TableHead>
              <TableHead>Bought</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((o) => (
              <TableRow key={o.orderId}>
                <TableCell className="font-mono">{o.orderId}</TableCell>
                <TableCell>{o.email}</TableCell>
                <TableCell className="whitespace-normal">{o.items}</TableCell>
                <TableCell>{o.purchasedAt}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function LimitCard({ limitUsd }: { limitUsd: number }) {
  const [value, setValue] = useState(String(limitUsd));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Auto-refund limit</CardTitle>
        <CardDescription>
          Eligible refunds up to{" "}
          <strong data-testid="refund-limit">{formatUsd(limitUsd)}</strong> per
          order go back to the customer automatically. Anything over it waits
          here for a person. Set it to 0 to approve every refund by hand.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            start(async () => {
              const result = await setAutoRefundLimitAction(value);
              setError(result.ok ? null : result.error);
              if (result.ok) toast.success("Auto-refund limit updated");
            });
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="refund-limit-input">Limit in dollars</Label>
            <Input
              id="refund-limit-input"
              inputMode="decimal"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className="w-32"
              aria-invalid={error ? true : undefined}
            />
          </div>
          <Button
            type="submit"
            disabled={pending || value.trim() === String(limitUsd)}
          >
            Save
          </Button>
        </form>
        {error && <p className="text-destructive mt-2 text-sm">{error}</p>}
      </CardContent>
    </Card>
  );
}

function ReviewCard({ request }: { request: RefundRequest }) {
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  const decide = (
    action: (id: string, note: string) => Promise<ActionResult>,
    done: string,
  ) =>
    start(async () => {
      const result = await action(request.id, note);
      if (result.ok) toast.success(`${request.id} ${done}`);
      else toast.error(result.error);
    });

  return (
    <Card data-testid="review-card" data-refund={request.id}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline gap-x-3">
          <span className="font-mono">{request.id}</span>
          <span>{formatUsd(request.amountUsd)}</span>
          <span className="text-muted-foreground text-sm font-normal">
            {request.orderId} · {request.customerName} ·{" "}
            {time(request.createdAt)}
          </span>
        </CardTitle>
        <CardDescription>
          {request.lines.map((l) => l.label).join(", ")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-muted-foreground">Customer said</dt>
          <dd>&ldquo;{request.customerReason}&rdquo;</dd>
          <dt className="text-muted-foreground">Refund agent</dt>
          <dd>
            <Badge variant="outline" className="mr-2">
              {REASON_LABELS[request.category]}
            </Badge>
            {request.agentNote}
          </dd>
          <dt className="text-muted-foreground">Why it&apos;s here</dt>
          <dd>{request.rule}</dd>
          <dt className="text-muted-foreground">Rules</dt>
          <dd>
            <ul className="space-y-0.5">
              {request.lines.map((l) => (
                <li key={l.lineId}>
                  {l.eligible ? "✓" : "✗"} {l.label}: {l.rule}
                </li>
              ))}
            </ul>
          </dd>
        </dl>
        <div className="grid gap-1.5">
          <Label htmlFor={`note-${request.id}`}>
            Note to the customer (optional)
          </Label>
          <Input
            id={`note-${request.id}`}
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Copper reads this out when they ask for the status"
          />
        </div>
      </CardContent>
      <CardFooter className="gap-2">
        <Button
          disabled={pending}
          onClick={() => decide(approveRefundAction, "approved")}
        >
          <CheckIcon /> Approve
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => decide(rejectRefundAction, "rejected")}
        >
          <XIcon /> Reject
        </Button>
      </CardFooter>
    </Card>
  );
}
