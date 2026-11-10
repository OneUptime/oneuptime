import {
  SESSION_REPLAY_FRUSTRATION_LIMITS,
  SESSION_REPLAY_MAX_CUSTOM_SIGNALS,
  SESSION_REPLAY_MAX_CUSTOM_SIGNAL_NAME_LENGTH,
  SESSION_REPLAY_MAX_IGNORED_SELECTORS,
  SESSION_REPLAY_MAX_IGNORED_SELECTOR_LENGTH,
  SessionReplayCustomSignal,
  SessionReplayCustomSignalTrigger,
  SessionReplayFrustrationNumberLimit,
  SessionReplayFrustrationNumberLimits,
  SessionReplayFrustrationSettings,
  getSessionReplayCustomSignalMatchMaxLength,
  isSessionReplayCustomSignalTrigger,
  isSessionReplayPagePatternAnchored,
} from "../../Types/Rum/SessionReplayFrustrationSignals";

/*
 * The strict check of RumApplication.sessionReplayFrustrationSignals on
 * every write, and the settings page's own check before it sends one.
 *
 * Where the recorder's normalizer repairs what it is handed, this says what
 * is wrong, in words that name the rule or the signal: a write that would
 * have been quietly clamped is refused instead, so what the page shows is
 * what was saved. A write that passes comes back canonical - names and
 * matches trimmed, every rule present, ids on every signal - and that is
 * what is stored.
 *
 * Not bundled into the recorder: it is the messages that make it heavy.
 */

export interface SessionReplayFrustrationSettingsCheck {
  // The canonical settings to store, or null when the column is cleared.
  settings: SessionReplayFrustrationSettings | null;
  // What is wrong, or null when nothing is.
  problem: string | null;
}

/*
 * Names a signal of the application's own may not take, because the list
 * and the timeline already use them for the built-in four.
 */
const BUILT_IN_SIGNAL_NAMES: ReadonlyArray<string> = [
  "rage click",
  "rage clicks",
  "dead click",
  "dead clicks",
  "error click",
  "error clicks",
  "refresh rage",
];

class SettingsProblem extends Error {}

function fail(message: string): never {
  throw new SettingsProblem(message);
}

function readRecord(value: unknown, what: string): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    fail(`${what} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function readSwitch(value: unknown, what: string): boolean {
  if (value === undefined) {
    return true;
  }

  if (typeof value !== "boolean") {
    fail(`${what} must be true or false.`);
  }

  return value;
}

function readWholeNumber(
  value: unknown,
  limit: SessionReplayFrustrationNumberLimit,
  what: string,
): number {
  if (value === undefined) {
    return limit.defaultValue;
  }

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < limit.min ||
    value > limit.max
  ) {
    fail(`${what} must be a whole number from ${limit.min} to ${limit.max}.`);
  }

  return value;
}

function hasControlCharacter(text: string): boolean {
  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }

  return false;
}

/*
 * Could this be a CSS selector? The server has no DOM to ask, so this is the
 * shape check a parser would fail first: brackets and quotes that close, no
 * declaration block or statement end, nothing that starts or ends on a
 * combinator, no empty entry in a list. The settings page also asks the
 * browser itself (document.querySelector) before it sends one, and the
 * recorder treats a selector its browser refuses as one that matches
 * nothing, so a selector that slips past here costs only itself.
 *
 * One pass over the text, no regular expression: it is the customer's.
 */
export function isPlausibleCssSelector(selector: string): boolean {
  const text: string = selector.trim();

  if (text.length === 0 || hasControlCharacter(text)) {
    return false;
  }

  const closers: Array<string> = [];
  let quote: string = "";
  let previous: string = ",";

  for (let index: number = 0; index < text.length; index++) {
    const character: string = text.charAt(index);

    if (character === "\\") {
      index++;
      previous = "a";
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = "";
      }

      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      previous = "a";
      continue;
    }

    if (character === "{" || character === "}" || character === ";") {
      return false;
    }

    if (character === "[") {
      closers.push("]");
    } else if (character === "(") {
      closers.push(")");
    } else if (character === "]" || character === ")") {
      if (closers.pop() !== character) {
        return false;
      }
    }

    if (character === " ") {
      continue;
    }

    const isJoiner: boolean = isSelectorJoiner(character);

    if (isJoiner && closers.length === 0 && isSelectorJoiner(previous)) {
      return false;
    }

    previous = character;
  }

  if (quote || closers.length > 0) {
    return false;
  }

  return !isSelectorJoiner(previous);
}

/* A list comma or a combinator: what cannot start, end or follow another. */
function isSelectorJoiner(character: string): boolean {
  return (
    character === "," ||
    character === ">" ||
    character === "+" ||
    character === "~"
  );
}

function readSelectorList(value: unknown, what: string): Array<string> {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    fail(`${what} must be a list of CSS selectors.`);
  }

  if (value.length > SESSION_REPLAY_MAX_IGNORED_SELECTORS) {
    fail(
      `${what}: list at most ${SESSION_REPLAY_MAX_IGNORED_SELECTORS} selectors.`,
    );
  }

  const selectors: Array<string> = [];

  for (const entry of value) {
    if (typeof entry !== "string") {
      fail(`${what} must be a list of CSS selectors.`);
    }

    const selector: string = entry.trim();

    if (selector.length === 0) {
      continue;
    }

    if (selector.length > SESSION_REPLAY_MAX_IGNORED_SELECTOR_LENGTH) {
      fail(
        `${what}: a selector can be at most ${SESSION_REPLAY_MAX_IGNORED_SELECTOR_LENGTH} characters.`,
      );
    }

    if (!isPlausibleCssSelector(selector)) {
      fail(`${what}: "${selector}" is not a CSS selector.`);
    }

    if (selectors.indexOf(selector) === -1) {
      selectors.push(selector);
    }
  }

  return selectors;
}

/*
 * What is wrong with one signal's match, or null. Shared with the settings
 * page, which shows it under the field.
 */
export function getSessionReplayCustomSignalMatchProblem(
  trigger: SessionReplayCustomSignalTrigger,
  match: string,
): string | null {
  const text: string = match.trim();
  const maxLength: number = getSessionReplayCustomSignalMatchMaxLength(trigger);

  if (trigger === "click") {
    if (text.length === 0) {
      return "Enter the CSS selector of the element, such as #pay-button or .checkout-submit.";
    }

    if (text.length > maxLength) {
      return `A selector can be at most ${maxLength} characters.`;
    }

    return isPlausibleCssSelector(text)
      ? null
      : `"${text}" is not a CSS selector.`;
  }

  if (trigger === "page") {
    if (text.length === 0) {
      return "Enter the page's path, such as /checkout/error.";
    }

    if (text.length > maxLength) {
      return `A page pattern can be at most ${maxLength} characters.`;
    }

    if (!isSessionReplayPagePatternAnchored(text)) {
      return "A page pattern starts with / (or with * to match the end of any path), such as /checkout/error.";
    }

    if (
      text.indexOf("?") !== -1 ||
      text.indexOf("#") !== -1 ||
      hasControlCharacter(text)
    ) {
      return "Match the page's path only, without ? or #.";
    }

    return null;
  }

  if (trigger === "event") {
    if (text.length === 0 || text.length > maxLength) {
      return `Enter the event name your code passes to track(), at most ${maxLength} characters.`;
    }

    return hasControlCharacter(text)
      ? "An event name cannot contain line breaks or control characters."
      : null;
  }

  if (text.length === 0 || text.length > maxLength) {
    return `Enter the text the error contains, at most ${maxLength} characters.`;
  }

  return hasControlCharacter(text)
    ? "The error text cannot contain line breaks or control characters."
    : null;
}

/* What is wrong with one signal's name, or null. */
export function getSessionReplayCustomSignalNameProblem(
  name: string,
): string | null {
  const text: string = name.trim();

  if (text.length === 0) {
    return "Give the signal a name.";
  }

  if (text.length > SESSION_REPLAY_MAX_CUSTOM_SIGNAL_NAME_LENGTH) {
    return `A name can be at most ${SESSION_REPLAY_MAX_CUSTOM_SIGNAL_NAME_LENGTH} characters.`;
  }

  if (hasControlCharacter(text)) {
    return "A name cannot contain line breaks or control characters.";
  }

  if (BUILT_IN_SIGNAL_NAMES.indexOf(text.toLowerCase()) !== -1) {
    return `"${text}" is a built-in signal. Give yours its own name.`;
  }

  return null;
}

function readCustomSignals(
  value: unknown,
  generateId: () => string,
): Array<SessionReplayCustomSignal> {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    fail("Custom signals must be a list.");
  }

  if (value.length > SESSION_REPLAY_MAX_CUSTOM_SIGNALS) {
    fail(
      `An application can have at most ${SESSION_REPLAY_MAX_CUSTOM_SIGNALS} signals of its own.`,
    );
  }

  const signals: Array<SessionReplayCustomSignal> = [];
  const names: Array<string> = [];
  const ids: Array<string> = [];

  value.forEach((entry: unknown, index: number): void => {
    const record: Record<string, unknown> = readRecord(
      entry,
      `Custom signal ${index + 1}`,
    );

    const name: string =
      typeof record["name"] === "string" ? record["name"].trim() : "";
    const nameProblem: string | null =
      getSessionReplayCustomSignalNameProblem(name);

    if (nameProblem) {
      fail(`Custom signal ${index + 1}: ${nameProblem}`);
    }

    if (names.indexOf(name.toLowerCase()) !== -1) {
      fail(`Two custom signals are named "${name}". Give each its own name.`);
    }

    names.push(name.toLowerCase());

    const trigger: unknown = record["trigger"];

    if (!isSessionReplayCustomSignalTrigger(trigger)) {
      fail(
        `Custom signal "${name}": choose what it reacts to (click, page, event or error).`,
      );
    }

    if (typeof record["match"] !== "string") {
      fail(`Custom signal "${name}": enter what it matches.`);
    }

    const match: string = record["match"].trim();
    const matchProblem: string | null =
      getSessionReplayCustomSignalMatchProblem(trigger, match);

    if (matchProblem) {
      fail(`Custom signal "${name}": ${matchProblem}`);
    }

    let id: string =
      typeof record["id"] === "string" ? record["id"].trim() : "";

    if (id.length === 0 || id.length > 64 || ids.indexOf(id) !== -1) {
      id = generateId();
    }

    ids.push(id);

    signals.push({
      id: id,
      name: name,
      trigger: trigger,
      match: match,
      isFrustration: readSwitch(
        record["isFrustration"],
        `Custom signal "${name}": Counts as frustration`,
      ),
      isEnabled: readSwitch(record["isEnabled"], `Custom signal "${name}": On`),
    });
  });

  return signals;
}

/*
 * Check settings on their way to the database. null (or undefined) clears
 * the column, which means the defaults; anything else must be the settings
 * object, where a rule left out is the default rule and a number left out
 * is the default number. generateId names a custom signal that came
 * without an id (an API write); the settings page always sends one.
 */
export function checkSessionReplayFrustrationSettings(
  value: unknown,
  generateId: () => string,
): SessionReplayFrustrationSettingsCheck {
  if (value === undefined || value === null) {
    return { settings: null, problem: null };
  }

  try {
    const record: Record<string, unknown> = readRecord(
      value,
      "Frustration signals",
    );
    const limits: SessionReplayFrustrationNumberLimits =
      SESSION_REPLAY_FRUSTRATION_LIMITS;

    const rage: Record<string, unknown> = readRecord(
      record["rageClick"],
      "Rage clicks",
    );
    const dead: Record<string, unknown> = readRecord(
      record["deadClick"],
      "Dead clicks",
    );
    const errorClick: Record<string, unknown> = readRecord(
      record["errorClick"],
      "Error clicks",
    );
    const refresh: Record<string, unknown> = readRecord(
      record["refreshRage"],
      "Refresh rage",
    );

    const settings: SessionReplayFrustrationSettings = {
      rageClick: {
        isEnabled: readSwitch(rage["isEnabled"], "Rage clicks: On"),
        clickCount: readWholeNumber(
          rage["clickCount"],
          limits.rageClickCount,
          "Rage clicks: the number of clicks",
        ),
        windowMs: readWholeNumber(
          rage["windowMs"],
          limits.rageClickWindowMs,
          "Rage clicks: the time between clicks in milliseconds",
        ),
        radiusPx: readWholeNumber(
          rage["radiusPx"],
          limits.rageClickRadiusPx,
          "Rage clicks: the distance in pixels",
        ),
        ignoreSelectors: readSelectorList(
          rage["ignoreSelectors"],
          "Rage clicks: elements to ignore",
        ),
      },
      deadClick: {
        isEnabled: readSwitch(dead["isEnabled"], "Dead clicks: On"),
        timeoutMs: readWholeNumber(
          dead["timeoutMs"],
          limits.deadClickTimeoutMs,
          "Dead clicks: the wait in milliseconds",
        ),
        ignoreSelectors: readSelectorList(
          dead["ignoreSelectors"],
          "Dead clicks: elements to ignore",
        ),
      },
      errorClick: {
        isEnabled: readSwitch(errorClick["isEnabled"], "Error clicks: On"),
        windowMs: readWholeNumber(
          errorClick["windowMs"],
          limits.errorClickWindowMs,
          "Error clicks: the time after a click in milliseconds",
        ),
      },
      refreshRage: {
        isEnabled: readSwitch(refresh["isEnabled"], "Refresh rage: On"),
        reloadCount: readWholeNumber(
          refresh["reloadCount"],
          limits.refreshRageReloadCount,
          "Refresh rage: the number of loads",
        ),
        windowSeconds: readWholeNumber(
          refresh["windowSeconds"],
          limits.refreshRageWindowSeconds,
          "Refresh rage: the time in seconds",
        ),
      },
      customSignals: readCustomSignals(record["customSignals"], generateId),
    };

    return { settings: settings, problem: null };
  } catch (error) {
    if (error instanceof SettingsProblem) {
      return { settings: null, problem: error.message };
    }

    throw error;
  }
}
