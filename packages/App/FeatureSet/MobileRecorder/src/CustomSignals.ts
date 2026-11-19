import {
  SESSION_REPLAY_CUSTOM_SIGNAL_COOLDOWN_MS,
  SESSION_REPLAY_MAX_CUSTOM_SIGNAL_EVENT_NAME_LENGTH,
  SESSION_REPLAY_MAX_CUSTOM_SIGNAL_MATCH_LENGTH,
  SESSION_REPLAY_MAX_CUSTOM_SIGNAL_NAME_LENGTH,
  SESSION_REPLAY_MAX_CUSTOM_SIGNALS,
  SessionReplayCustomSignalConfig,
  SessionReplayCustomSignalTrigger,
} from "./Contract";

/*
 * The application's own frustration signals (issue #6443), as this recorder
 * detects them: a tap on a view it names by testID (issue #6517), a route
 * the app moves to, an event it passes to track(), an error whose text it
 * knows. A click on an element is a CSS selector on a web page, so click
 * signals are left to the browser recorder.
 *
 * The reading and the matching are copies of Common's
 * Types/Rum/SessionReplayFrustrationSignals (readCustomSignal and the
 * matchesSessionReplay* functions); ContractParity holds them to Common on
 * the same inputs. Nothing a signal matched against is ever recorded: a hit
 * carries the signal's name - and, for a tap whose touch was recorded,
 * where on the screen it was, as the touch itself already says.
 */

/* The triggers this recorder can detect. */
export type MobileCustomSignalTrigger = Exclude<
  SessionReplayCustomSignalTrigger,
  "click"
>;

const TRIGGERS: ReadonlyArray<SessionReplayCustomSignalTrigger> = [
  "click",
  "tap",
  "page",
  "event",
  "error",
];

/* How many testIDs, from the touched view up, a tap is matched against. */
export const MAX_TAP_TARGET_TEST_IDS: number = 32;

export interface MobileCustomSignalHit {
  name: string;
  trigger: MobileCustomSignalTrigger;
  isFrustration: boolean;
  atUnixMs: number;
  /* A tap signal's position, only when its touch was recorded. */
  x?: number;
  y?: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isTrigger(value: unknown): value is SessionReplayCustomSignalTrigger {
  return (
    typeof value === "string" &&
    TRIGGERS.indexOf(value as SessionReplayCustomSignalTrigger) !== -1
  );
}

interface ReadCustomSignal extends SessionReplayCustomSignalConfig {
  isEnabled: boolean;
}

/*
 * Common's isSessionReplayTapPatternUsable: some of a testID, then at most
 * one star, at its end.
 */
export function isTapPatternUsable(pattern: string): boolean {
  const star: number = pattern.indexOf("*");

  return star === -1 || (star > 0 && star === pattern.length - 1);
}

function readCustomSignal(value: unknown): ReadCustomSignal | null {
  const record: Record<string, unknown> = asRecord(value);
  const name: string =
    typeof record["name"] === "string" ? record["name"].trim() : "";
  const trigger: unknown = record["trigger"];
  const match: string =
    typeof record["match"] === "string" ? record["match"].trim() : "";

  if (
    name.length === 0 ||
    name.length > SESSION_REPLAY_MAX_CUSTOM_SIGNAL_NAME_LENGTH ||
    !isTrigger(trigger) ||
    match.length === 0 ||
    match.length >
      (trigger === "event"
        ? SESSION_REPLAY_MAX_CUSTOM_SIGNAL_EVENT_NAME_LENGTH
        : SESSION_REPLAY_MAX_CUSTOM_SIGNAL_MATCH_LENGTH) ||
    (trigger === "page" &&
      match.charAt(0) !== "/" &&
      match.charAt(0) !== "*") ||
    (trigger === "tap" && !isTapPatternUsable(match))
  ) {
    return null;
  }

  return {
    name,
    trigger,
    match,
    isFrustration: record["isFrustration"] !== false,
    isEnabled: record["isEnabled"] !== false,
  };
}

/*
 * The signals in a config response's frustrationSignals - or in a cached
 * copy of the policy, which keeps the same field - that this recorder
 * detects. Never throws: anything unusable is no signal. Read exactly as
 * the server reads them - names unique ignoring case, at most twenty, then
 * the ones switched off left out (the server sends none) - and only then
 * are the click signals, which this recorder cannot detect, set aside.
 */
export function readCustomSignals(
  frustrationSignals: unknown,
): Array<SessionReplayCustomSignalConfig> {
  const list: unknown = asRecord(frustrationSignals)["customSignals"];
  const read: Array<ReadCustomSignal> = [];
  const seenNames: Array<string> = [];

  if (Array.isArray(list)) {
    for (const entry of list) {
      const signal: ReadCustomSignal | null = readCustomSignal(entry);

      if (!signal) {
        continue;
      }

      const key: string = signal.name.toLowerCase();

      if (seenNames.indexOf(key) !== -1) {
        continue;
      }

      seenNames.push(key);
      read.push(signal);

      if (read.length >= SESSION_REPLAY_MAX_CUSTOM_SIGNALS) {
        break;
      }
    }
  }

  const signals: Array<SessionReplayCustomSignalConfig> = [];

  for (const signal of read) {
    if (signal.isEnabled && signal.trigger !== "click") {
      signals.push({
        name: signal.name,
        trigger: signal.trigger,
        match: signal.match,
        isFrustration: signal.isFrustration,
      });
    }
  }

  return signals;
}

// One escaped byte: "%c3", "%2F".
const ESCAPED_BYTE: RegExp = /^%[0-9A-Fa-f]{2}$/;

/*
 * Text with no ASCII in it: an escaped character is decoded only when it
 * stays beyond ASCII composed (NFC writes three in ASCII).
 */
const BEYOND_ASCII: RegExp = /^[\u0080-\uffff]+$/;

// An escape, or a character beyond ASCII: a path with a spelling to settle.
const SPELLED_CHARACTER: RegExp = /[%\u0080-\uffff]/;

function composed(text: string): string {
  return typeof text.normalize === "function" ? text.normalize("NFC") : text;
}

/*
 * A path in the spelling a person reads it, a copy of Common's
 * UrlScrubber.normalizePathSpelling(path, true) (#8195): each escape of a
 * character beyond ASCII decoded ("/caf%c3%a9" and "/cafe%CC%81" are
 * "/café"), the words composed, and every other escape kept, in upper-case
 * hex, so "/a%2Fb" stays apart from "/a/b".
 */
export function readPathAsWritten(path: string): string {
  if (!SPELLED_CHARACTER.test(path)) {
    return path;
  }

  let spelled: string = "";
  let words: string = "";
  let index: number = 0;

  while (index < path.length) {
    const escape: string = path.slice(index, index + 3);

    if (!ESCAPED_BYTE.test(escape)) {
      words += path.charAt(index);
      index += 1;
      continue;
    }

    // A character's escapes: 2 to 4 bytes, as many as its first says.
    const lead: number = parseInt(escape.slice(1), 16);
    const length: number =
      lead < 0xc2 ? 0 : lead < 0xe0 ? 6 : lead < 0xf0 ? 9 : 12;
    let character: string = "";

    try {
      character = length
        ? decodeURIComponent(path.slice(index, index + length))
        : "";
    } catch {
      // Not UTF-8: cut short, written too long, a surrogate.
    }

    if (BEYOND_ASCII.test(composed(character))) {
      words += character;
      index += length;
      continue;
    }

    spelled += composed(words) + escape.toUpperCase();
    words = "";
    index += 3;
  }

  return spelled + composed(words);
}

function canonicalPath(path: string): string {
  let end: number = path.length;

  while (end > 1 && path.charAt(end - 1) === "/") {
    end--;
  }

  return readPathAsWritten(path.slice(0, end)).toLowerCase();
}

/*
 * Does a route match a page pattern? A star stands for any run of
 * characters; everything else is compared as written, ignoring case and the
 * slashes at the end, in the spelling a person reads (readPathAsWritten).
 * The pattern is split on its stars and the pieces are found in order - no
 * regular expression is built from it.
 */
export function matchesPagePattern(pattern: string, path: string): boolean {
  const target: string = canonicalPath(path);
  const pieces: Array<string> = canonicalPath(pattern.trim()).split("*");

  if (pieces.length === 1) {
    return target === pieces[0];
  }

  const first: string = pieces[0] || "";
  const last: string = pieces[pieces.length - 1] || "";

  if (target.slice(0, first.length) !== first) {
    return false;
  }

  let position: number = first.length;

  for (let index: number = 1; index < pieces.length - 1; index++) {
    const piece: string = pieces[index] || "";

    if (piece.length === 0) {
      continue;
    }

    const found: number = target.indexOf(piece, position);

    if (found === -1) {
      return false;
    }

    position = found + piece.length;
  }

  return (
    target.length - position >= last.length &&
    target.slice(target.length - last.length) === last
  );
}

export function matchesErrorText(match: string, text: string): boolean {
  return (
    match.length > 0 && text.toLowerCase().indexOf(match.toLowerCase()) !== -1
  );
}

export function matchesEventName(match: string, name: string): boolean {
  return match.trim().toLowerCase() === name.trim().toLowerCase();
}

/*
 * Common's matchesSessionReplayTapTarget: the testID exactly, or - a
 * pattern ending in a star - one that starts with what comes before it.
 * Case is ignored.
 */
export function matchesTapTarget(match: string, testId: string): boolean {
  const pattern: string = match.trim().toLowerCase();
  const target: string = testId.toLowerCase();

  if (!pattern || !target || !isTapPatternUsable(pattern)) {
    return false;
  }

  return pattern.charAt(pattern.length - 1) === "*"
    ? target.indexOf(pattern.slice(0, -1)) === 0
    : target === pattern;
}

/*
 * The testIDs a tap can be matched against, as the native module hands
 * them over: strings only, none empty or longer than a match can be, at
 * most MAX_TAP_TARGET_TEST_IDS of them. Anything else is no testID.
 */
export function readTapTargetTestIds(value: unknown): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  const testIds: Array<string> = [];

  for (const entry of value) {
    if (
      typeof entry === "string" &&
      entry.length > 0 &&
      entry.length <= SESSION_REPLAY_MAX_CUSTOM_SIGNAL_MATCH_LENGTH
    ) {
      testIds.push(entry);
    }

    if (testIds.length >= MAX_TAP_TARGET_TEST_IDS) {
      break;
    }
  }

  return testIds;
}

/*
 * The path a route stands for, as written: an absolute URL's path, without
 * its query or fragment, starting with a slash. Unlike the recorded route
 * nothing in it is redacted - a pattern names the app's own screens, and
 * what it is compared with never leaves the device.
 */
export function routeMatchPath(route: unknown): string {
  let path: string = typeof route === "string" ? route.trim() : "";

  const scheme: number = path.indexOf("://");

  if (scheme > 0 && scheme < 32) {
    const pathStart: number = path.indexOf("/", scheme + 3);
    path = pathStart === -1 ? "/" : path.slice(pathStart);
  }

  let end: number = path.length;

  for (const separator of ["?", "#"]) {
    const at: number = path.indexOf(separator);

    if (at !== -1 && at < end) {
      end = at;
    }
  }

  path = path.slice(0, end);

  return path.charAt(0) === "/" ? path : `/${path}`;
}

/*
 * Which of the application's signals a moment matches. Each name fires at
 * most once a second, as in the browser recorder: an error thrown in a loop
 * is one moment on the timeline, not fifty.
 */
export class CustomSignalMatcher {
  private readonly lastFiredAt: Map<string, number> = new Map<string, number>();

  /*
   * A tap on a view whose testID a tap signal names - or on anything inside
   * it: testIds holds the touched view's testID and those of the views
   * around it, out to the replay root, the touched one first.
   */
  public matchTap(
    signals: ReadonlyArray<SessionReplayCustomSignalConfig>,
    testIds: ReadonlyArray<string>,
    atUnixMs: number,
  ): Array<MobileCustomSignalHit> {
    if (testIds.length === 0) {
      return [];
    }

    return this.collect(
      signals,
      "tap",
      atUnixMs,
      (signal: SessionReplayCustomSignalConfig): boolean => {
        return testIds.some((testId: string): boolean => {
          return matchesTapTarget(signal.match, testId);
        });
      },
    );
  }

  public matchPage(
    signals: ReadonlyArray<SessionReplayCustomSignalConfig>,
    route: unknown,
    atUnixMs: number,
  ): Array<MobileCustomSignalHit> {
    const path: string = routeMatchPath(route);

    return this.collect(
      signals,
      "page",
      atUnixMs,
      (signal: SessionReplayCustomSignalConfig): boolean => {
        return matchesPagePattern(signal.match, path);
      },
    );
  }

  public matchEvent(
    signals: ReadonlyArray<SessionReplayCustomSignalConfig>,
    eventName: string,
    atUnixMs: number,
  ): Array<MobileCustomSignalHit> {
    return this.collect(
      signals,
      "event",
      atUnixMs,
      (signal: SessionReplayCustomSignalConfig): boolean => {
        return matchesEventName(signal.match, eventName);
      },
    );
  }

  public matchErrorText(
    signals: ReadonlyArray<SessionReplayCustomSignalConfig>,
    text: string,
    atUnixMs: number,
  ): Array<MobileCustomSignalHit> {
    if (!text) {
      return [];
    }

    return this.collect(
      signals,
      "error",
      atUnixMs,
      (signal: SessionReplayCustomSignalConfig): boolean => {
        return matchesErrorText(signal.match, text);
      },
    );
  }

  /* A new session starts with no signal cooling down. */
  public reset(): void {
    this.lastFiredAt.clear();
  }

  private collect(
    signals: ReadonlyArray<SessionReplayCustomSignalConfig>,
    trigger: MobileCustomSignalTrigger,
    atUnixMs: number,
    matches: (signal: SessionReplayCustomSignalConfig) => boolean,
  ): Array<MobileCustomSignalHit> {
    const hits: Array<MobileCustomSignalHit> = [];

    for (const signal of signals) {
      if (signal.trigger !== trigger || !matches(signal)) {
        continue;
      }

      const key: string = signal.name.toLowerCase();
      const last: number | undefined = this.lastFiredAt.get(key);

      if (
        last !== undefined &&
        atUnixMs >= last &&
        atUnixMs - last < SESSION_REPLAY_CUSTOM_SIGNAL_COOLDOWN_MS
      ) {
        continue;
      }

      this.lastFiredAt.set(key, atUnixMs);
      hits.push({
        name: signal.name,
        trigger,
        isFrustration: signal.isFrustration,
        atUnixMs,
      });
    }

    return hits;
  }
}
