import { MarketingEvent } from "../../../../Types/Marketing/MarketingEvent";

/*
 * Read the event out of one `emitInBackground` call recorded by a spy.
 *
 * Callers pass a `() => MarketingEvent` builder rather than a built event, so
 * that assembling the event happens inside emitInBackground's try and cannot
 * turn the already-committed transaction that triggered it into a failure.
 * A spy therefore records the builder, not the event. Both forms are accepted
 * here because emitInBackground accepts both.
 */
export type ResolveEmittedMarketingEventFunction = (
  emitted: unknown,
) => MarketingEvent;

export const resolveEmittedMarketingEvent: ResolveEmittedMarketingEventFunction =
  (emitted: unknown): MarketingEvent => {
    if (typeof emitted === "function") {
      return (emitted as () => MarketingEvent)();
    }

    return emitted as MarketingEvent;
  };
