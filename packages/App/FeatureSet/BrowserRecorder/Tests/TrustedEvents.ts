/*
 * Events dispatched the way the browser dispatches the user's own input:
 * with isTrusted true.
 *
 * dispatchEvent() marks every event it dispatches untrusted - in jsdom as
 * in a browser - and the recorder, like the web-vitals library, takes only
 * trusted input as the visitor's (a script's synthetic click does not end
 * LCP). jsdom dispatches its own trusted events through the implementation
 * object behind each wrapper, skipping the step that clears the flag; this
 * does exactly that, and nothing else.
 *
 * The timeStamp can be set too: jsdom stamps an event with the wall clock,
 * where a browser stamps it on the performance clock - the clock the
 * recorder and web-vitals compare it with.
 */

type Implementation = Record<string, unknown>;

function implementationOf(wrapper: unknown): Implementation {
  for (const symbol of Object.getOwnPropertySymbols(wrapper)) {
    if (symbol.description === "impl") {
      return (wrapper as unknown as Record<symbol, Implementation>)[symbol]!;
    }
  }

  throw new Error("Not a jsdom object: there is no implementation behind it.");
}

export function dispatchTrusted(
  target: EventTarget,
  event: Event,
  timeStamp?: number,
): boolean {
  const eventImpl: Implementation = implementationOf(event);
  const targetImpl: Implementation = implementationOf(target);

  eventImpl["isTrusted"] = true;

  if (timeStamp !== undefined) {
    eventImpl["timeStamp"] = timeStamp;
  }

  return (targetImpl["_dispatch"] as (event: Implementation) => boolean).call(
    targetImpl,
    eventImpl,
  );
}

/* The visitor's own input of `type` on the document (keydown, click...). */
export function userInput(type: string, timeStamp?: number): void {
  dispatchTrusted(document, new Event(type, { bubbles: true }), timeStamp);
}

/*
 * document.visibilityState as the test says, until resetDocumentState().
 * jsdom's own answer lives on the prototype; an own property shadows it.
 */
export function defineVisibilityState(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });
}

/* document.prerendering, likewise. jsdom has none. */
export function definePrerendering(prerendering: boolean): void {
  Object.defineProperty(document, "prerendering", {
    value: prerendering,
    configurable: true,
  });
}

/* Back to jsdom's own visibilityState, and no prerendering. */
export function resetDocumentState(): void {
  delete (document as unknown as Record<string, unknown>)["visibilityState"];
  delete (document as unknown as Record<string, unknown>)["prerendering"];
}

/*
 * The page changes visibility as the browser would show it: the state,
 * then a trusted visibilitychange stamped at `timeStamp` when one is given.
 */
export function changeVisibility(
  state: "visible" | "hidden",
  timeStamp?: number,
): void {
  defineVisibilityState(state);
  dispatchTrusted(document, new Event("visibilitychange"), timeStamp);
}

/* A prerendered page is opened: prerendering ends, then prerenderingchange. */
export function activatePrerender(timeStamp?: number): void {
  definePrerendering(false);
  dispatchTrusted(document, new Event("prerenderingchange"), timeStamp);
}
