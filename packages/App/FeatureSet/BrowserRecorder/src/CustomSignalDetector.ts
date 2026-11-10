import {
  SESSION_REPLAY_CUSTOM_SIGNAL_COOLDOWN_MS,
  SessionReplayCustomSignalConfig,
  SessionReplayCustomSignalTrigger,
  matchesSessionReplayErrorText,
  matchesSessionReplayEventName,
  matchesSessionReplayPagePattern,
} from "Common/Types/Rum/SessionReplayFrustrationSignals";

/*
 * The application's own signals (its Frustration Signals page): a click on
 * an element, a visit to a page, an event from track(), an error whose text
 * it knows. Each is detected here, in the browser, against what the page
 * really has - the raw path, the raw error message, the clicked element -
 * and reported by NAME only. What was matched never leaves the browser
 * because of a signal: an error's text is masked like any other before it
 * is recorded, and a signal's marker carries the name the application chose
 * and, for a click, where on the screen it was.
 *
 * A signal that counts as frustration is counted and triggered exactly like
 * the built-in four (the recorder's onCustomSignal); one that does not is a
 * marker on the timeline and a count on the session.
 *
 * The same signal is reported at most once per
 * SESSION_REPLAY_CUSTOM_SIGNAL_COOLDOWN_MS: an error thrown in a loop or a
 * button clicked in a burst is one moment, not fifty.
 */

export interface CustomSignalHit {
  name: string;
  trigger: SessionReplayCustomSignalTrigger;
  isFrustration: boolean;
  atUnixMs: number;
  /* Viewport coordinates of the click, for click signals only. */
  x?: number;
  y?: number;
}

export interface CustomSignalDetectorOptions {
  signals: Array<SessionReplayCustomSignalConfig>;
  onSignal: (hit: CustomSignalHit) => void;
}

export default class CustomSignalDetector {
  private readonly signals: Array<SessionReplayCustomSignalConfig>;
  private readonly onSignal: (hit: CustomSignalHit) => void;

  private readonly lastReportedAtMs: Map<string, number> = new Map<
    string,
    number
  >();

  /*
   * The page the last page check ran for, so a replaceState that only
   * changes the query string is not a second visit to the same page.
   */
  private lastPageKey: string | null = null;

  private started: boolean = false;
  private readonly clickListener: (event: MouseEvent) => void;

  public constructor(options: CustomSignalDetectorOptions) {
    this.signals = options.signals;
    this.onSignal = options.onSignal;

    this.clickListener = (event: MouseEvent): void => {
      this.handleClick(event);
    };
  }

  public hasSignals(trigger: SessionReplayCustomSignalTrigger): boolean {
    return this.signals.some(
      (signal: SessionReplayCustomSignalConfig): boolean => {
        return signal.trigger === trigger;
      },
    );
  }

  /*
   * A click listener only when there is a click signal to look for, in the
   * capture phase (a component that stops propagation still clicked) and
   * passive (the page's own handling is never delayed).
   */
  public start(documentRef: Document = document): void {
    if (this.started) {
      return;
    }

    this.started = true;

    if (this.hasSignals("click")) {
      documentRef.addEventListener(
        "click",
        this.clickListener as EventListener,
        { capture: true, passive: true },
      );
    }
  }

  public stop(documentRef: Document = document): void {
    if (!this.started) {
      return;
    }

    this.started = false;

    documentRef.removeEventListener(
      "click",
      this.clickListener as EventListener,
      true,
    );
  }

  /*
   * The page is now this one: on load and on every route change. Each path
   * is checked (the pathname, and for a hash-routed app the route after the
   * #), and a signal fires once for the visit even when both match.
   */
  public notifyPage(paths: Array<string>, atUnixMs: number): void {
    const key: string = paths.join("\n");

    if (key === this.lastPageKey) {
      return;
    }

    this.lastPageKey = key;

    for (const signal of this.signals) {
      if (signal.trigger !== "page") {
        continue;
      }

      const matched: boolean = paths.some((path: string): boolean => {
        return matchesSessionReplayPagePattern(signal.match, path);
      });

      if (matched) {
        this.report(signal, atUnixMs);
      }
    }
  }

  /* The page called track(name). */
  public notifyEvent(name: string, atUnixMs: number): void {
    for (const signal of this.signals) {
      if (
        signal.trigger === "event" &&
        matchesSessionReplayEventName(signal.match, name)
      ) {
        this.report(signal, atUnixMs);
      }
    }
  }

  /*
   * An error happened - uncaught, a rejection, or console.error - and this
   * is its RAW text, before masking. It is only compared here, never kept.
   */
  public notifyErrorText(text: string, atUnixMs: number): void {
    for (const signal of this.signals) {
      if (
        signal.trigger === "error" &&
        matchesSessionReplayErrorText(signal.match, text)
      ) {
        this.report(signal, atUnixMs);
      }
    }
  }

  private handleClick(event: MouseEvent): void {
    const target: EventTarget | null = event.target;

    if (
      !target ||
      typeof Element === "undefined" ||
      !(target instanceof Element)
    ) {
      return;
    }

    const atUnixMs: number = Date.now();

    for (const signal of this.signals) {
      if (signal.trigger !== "click") {
        continue;
      }

      let matched: boolean = false;

      try {
        matched = target.closest(signal.match) !== null;
      } catch {
        // A selector this browser cannot read matches nothing.
        matched = false;
      }

      if (matched) {
        this.report(signal, atUnixMs, {
          x: typeof event.clientX === "number" ? event.clientX : 0,
          y: typeof event.clientY === "number" ? event.clientY : 0,
        });
      }
    }
  }

  private report(
    signal: SessionReplayCustomSignalConfig,
    atUnixMs: number,
    at?: { x: number; y: number },
  ): void {
    const last: number | undefined = this.lastReportedAtMs.get(signal.name);

    if (
      last !== undefined &&
      atUnixMs - last < SESSION_REPLAY_CUSTOM_SIGNAL_COOLDOWN_MS
    ) {
      return;
    }

    this.lastReportedAtMs.set(signal.name, atUnixMs);

    const hit: CustomSignalHit = {
      name: signal.name,
      trigger: signal.trigger,
      isFrustration: signal.isFrustration,
      atUnixMs: atUnixMs,
    };

    if (at) {
      hit.x = at.x;
      hit.y = at.y;
    }

    this.onSignal(hit);
  }

  /*
   * The paths a page can be matched on: its pathname, and for a hash-routed
   * app (#/checkout/error) the route after the #, without its query.
   */
  public static pagePathsOf(location: {
    pathname: string;
    hash: string;
  }): Array<string> {
    const paths: Array<string> = [location.pathname || "/"];
    const hash: string = location.hash || "";

    if (hash.charAt(1) === "/") {
      const route: string = hash.slice(1).split("?")[0] || "/";

      if (route !== paths[0]) {
        paths.push(route);
      }
    }

    return paths;
  }
}
