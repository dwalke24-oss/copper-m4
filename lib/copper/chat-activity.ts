// How the docked chat and the Refund Console keep in step on the Support page
// (browser only). The chat says when it's busy answering and when it has filed
// a refund; the console redraws on that signal, and also checks the server
// every few seconds, so refunds filed anywhere else still show up.
//
// The console holds off while the chat is answering: Copper's answer streams
// in over one long request, and redrawing the page in the middle of it could
// cut that request off.

/** Fired on window when a refund was filed in the chat. */
export const REFUNDS_CHANGED_EVENT = "copper:refunds-changed";

/** Fired on window when the chat finishes answering. */
export const CHAT_IDLE_EVENT = "copper:chat-idle";

let busy = false;

/** The chat calls this when it starts (true) and finishes (false) an answer. */
export function setChatBusy(value: boolean): void {
  busy = value;
  if (!value) window.dispatchEvent(new Event(CHAT_IDLE_EVENT));
}

/** Whether the chat is in the middle of an answer. */
export function isChatBusy(): boolean {
  return busy;
}

/** The chat calls this after it files a refund. */
export function announceRefundsChanged(): void {
  window.dispatchEvent(new Event(REFUNDS_CHANGED_EVENT));
}
