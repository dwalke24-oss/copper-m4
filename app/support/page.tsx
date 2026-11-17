import type { Metadata } from "next";
import { Suspense } from "react";
import { AskCopper } from "@/components/copper/ask-copper";
import { RefundConsole } from "@/components/copper/refund-console";
import { SiteHeader } from "@/components/copper/site-header";
import { Skeleton } from "@/components/ui/skeleton";
import { isAiConfigured } from "@/lib/ai/call";

export const metadata: Metadata = { title: "Support | Copper State Labs" };

export default function Support() {
  return (
    // Leaves room on the right for the docked chat.
    <div className="flex flex-1 flex-col lg:pr-[28rem]">
      <SiteHeader />
      <main
        data-testid="refund-console"
        className="mx-auto w-full max-w-3xl flex-1 px-4 py-8"
      >
        <h1 className="font-display text-3xl font-bold">Refund Console</h1>
        <p className="text-muted-foreground mt-2">
          Customers ask Copper for refunds in the chat. Copper hands each one to
          the Refund agent, the refund rules decide, and anything over the limit
          waits here for the Copper Crew.
        </p>
        <Suspense fallback={<Skeleton className="mt-6 h-64 w-full" />}>
          <RefundConsole />
        </Suspense>
      </main>
      <AskCopper aiConfigured={isAiConfigured()} docked />
    </div>
  );
}
