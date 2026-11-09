import {
  getSessionReplayCustomSignalMatchMaxLength,
  isSessionReplayPagePatternAnchored,
  SESSION_REPLAY_FRUSTRATION_LIMITS,
  SESSION_REPLAY_MAX_CUSTOM_SIGNAL_NAME_LENGTH,
  SESSION_REPLAY_MAX_CUSTOM_SIGNALS,
  SESSION_REPLAY_MAX_IGNORED_SELECTOR_LENGTH,
  SESSION_REPLAY_MAX_IGNORED_SELECTORS,
  SessionReplayCustomSignal,
  SessionReplayCustomSignalTrigger,
  SessionReplayFrustrationNumberLimit,
  SessionReplayFrustrationSettings,
} from "Common/Types/Rum/SessionReplayFrustrationSignals";
import { isPlausibleCssSelector } from "Common/Utils/Rum/SessionReplayFrustrationSettingsValidation";
import {
  PluralTemplate,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * Everything the Frustration Signals page says, and every decision it makes
 * about what a person typed, without React - so a test can hold each
 * sentence and each check to the numbers it describes, in any language.
 *
 * The page edits RumApplication.sessionReplayFrustrationSignals: the four
 * built-in signals, each with its numbers or switched off, and up to twenty
 * signals of the application's own (issue #6443). The recorders read it on
 * their next page load, so nothing here changes a recording already made:
 * the page says so once, at the top.
 *
 * Every sentence is an English key looked up whole with the reader's
 * Translator, numbers included, so a sentence is wholly in the reader's
 * language or wholly in English.
 */

export type BuiltInSignalKey =
  | "rageClick"
  | "deadClick"
  | "errorClick"
  | "refreshRage";

export const BUILT_IN_SIGNAL_KEYS: ReadonlyArray<BuiltInSignalKey> = [
  "rageClick",
  "deadClick",
  "errorClick",
  "refreshRage",
];

export const CHANGES_APPLY_COPY: string = translationKey(
  "Changes apply to sessions recorded from now on. Sessions already recorded keep the signals they were recorded with.",
);

// The page's name, as the side menu and the breadcrumbs say it.
export const FRUSTRATION_SIGNALS_TITLE: string = translationKey(
  "Frustration Signals",
);

export const BUILT_IN_CARD_TITLE: string = translationKey("Built-in signals");

/*
 * The page's first words: what a frustration signal does, and what these
 * four are. The card's second line is CHANGES_APPLY_COPY.
 */
export const BUILT_IN_CARD_DESCRIPTION: string = translationKey(
  "Frustration signals flag sessions in the list, mark the replay timeline, and count toward the Frustration filter, sort and totals. The browser recorder detects these four. Switch one off, or change its rule, if it flags things that are not frustration in your product.",
);

export const CUSTOM_CARD_TITLE: string = translationKey("Your own signals");

export const CUSTOM_CARD_DESCRIPTION: string = translationKey(
  "Name the moments that matter in your product, such as a payment error page, a support chat opened or an error you know. Each one shows on the session list and the replay timeline, and you choose whether it counts as frustration.",
);

export const MOBILE_NOTE_COPY: string = translationKey(
  "The React Native recorder detects your page, event and error signals. Click signals and the built-in rules are for the browser recorder.",
);

export const CHANGE_RULE_TITLE: string = translationKey("Change the rule");

export const USE_DEFAULTS_TEXT: string = translationKey("Use the defaults");

export const SAVE_RULE_TEXT: string = translationKey("Save rule");

export const NO_CUSTOM_SIGNALS_COPY: string = translationKey(
  "No signals of your own yet. Add one to mark a moment that matters to you.",
);

export const ADD_SIGNAL_TEXT: string = translationKey("Add signal");

export const TOO_MANY_SIGNALS_COPY: string = translationKey(
  "An application can have at most 20 signals of its own. Delete one to add another.",
);

export const READ_ONLY_COPY: string = translationKey(
  "You can see these settings, but changing them needs permission to edit this RUM application.",
);

export const LOAD_FAILED_COPY: string = translationKey(
  "The frustration settings could not be loaded.",
);

export const SAVED_COPY: string = translationKey("Saved");

export const SAVING_COPY: string = translationKey("Saving…");

export const FRUSTRATION_PILL_TEXT: string = translationKey("Frustration");

export const MARKER_PILL_TEXT: string = translationKey("Marker");

/* The four built-in signals' names, as the list's badges and the rail call them. */
export const BUILT_IN_SIGNAL_TITLES: Record<BuiltInSignalKey, string> = {
  rageClick: translationKey("Rage clicks"),
  deadClick: translationKey("Dead clicks"),
  errorClick: translationKey("Error clicks"),
  refreshRage: translationKey("Refresh rage"),
};

/* One example each: what the rule is for, in a person's terms. */
export const BUILT_IN_SIGNAL_EXAMPLES: Record<BuiltInSignalKey, string> = {
  rageClick: translationKey(
    "For example, someone clicks Pay again and again because nothing seems to happen.",
  ),
  deadClick: translationKey(
    "For example, someone clicks a heading that looks like a link.",
  ),
  errorClick: translationKey(
    "For example, someone clicks Save and the page throws an error.",
  ),
  refreshRage: translationKey(
    "For example, someone keeps reloading a page that never finishes loading.",
  ),
};

/*
 * The definitions, built from the rule's own numbers. Each is a plural on
 * the seconds, so "1 second" and "1.5 seconds" read right in every
 * language that words them.
 */
const RAGE_CLICK_DEFINITION: PluralTemplate = {
  one: translationKey(
    "{{clicks}} or more clicks within {{radius}} px of each other, each within {{count}} second of the one before.",
  ),
  other: translationKey(
    "{{clicks}} or more clicks within {{radius}} px of each other, each within {{count}} seconds of the one before.",
  ),
};

const DEAD_CLICK_DEFINITION: PluralTemplate = {
  one: translationKey(
    "A click on something that looks clickable, after which nothing on the page changes for {{count}} second.",
  ),
  other: translationKey(
    "A click on something that looks clickable, after which nothing on the page changes for {{count}} seconds.",
  ),
};

const ERROR_CLICK_DEFINITION: PluralTemplate = {
  one: translationKey("An error within {{count}} second of a click."),
  other: translationKey("An error within {{count}} seconds of a click."),
};

const REFRESH_RAGE_DEFINITION: PluralTemplate = {
  one: translationKey(
    "The same page loaded {{reloads}} times within {{count}} second.",
  ),
  other: translationKey(
    "The same page loaded {{reloads}} times within {{count}} seconds.",
  ),
};

const IGNORED_SELECTORS_LINE: PluralTemplate = {
  one: translationKey("Clicks on {{count}} element you listed never count."),
  other: translationKey("Clicks on {{count}} elements you listed never count."),
};

/*
 * Milliseconds as seconds with at most two decimals: 1500 -> 1.5, 250 ->
 * 0.25. Two, so an error click's quarter of a second reads as it was set.
 */
export function toSeconds(milliseconds: number): number {
  return Math.round(milliseconds / 10) / 100;
}

/*
 * The one-line definition of a built-in signal, from its numbers. The
 * sentence is the same whether the signal is on or off: it says what it
 * would flag.
 */
export function describeBuiltInSignal(
  key: BuiltInSignalKey,
  settings: SessionReplayFrustrationSettings,
  translator: Translator,
): string {
  switch (key) {
    case "rageClick":
      return translator.translatePlural(
        RAGE_CLICK_DEFINITION,
        toSeconds(settings.rageClick.windowMs),
        {
          clicks: translator.formatNumber(settings.rageClick.clickCount),
          radius: translator.formatNumber(settings.rageClick.radiusPx),
        },
      );
    case "deadClick":
      return translator.translatePlural(
        DEAD_CLICK_DEFINITION,
        toSeconds(settings.deadClick.timeoutMs),
      );
    case "errorClick":
      return translator.translatePlural(
        ERROR_CLICK_DEFINITION,
        toSeconds(settings.errorClick.windowMs),
      );
    case "refreshRage":
    default:
      return translator.translatePlural(
        REFRESH_RAGE_DEFINITION,
        settings.refreshRage.windowSeconds,
        {
          reloads: translator.formatNumber(settings.refreshRage.reloadCount),
        },
      );
  }
}

/* "Clicks on 2 elements you listed never count.", or "" with none. */
export function describeIgnoredSelectors(
  selectors: Array<string>,
  translator: Translator,
): string {
  if (selectors.length === 0) {
    return "";
  }

  return translator.translatePlural(IGNORED_SELECTORS_LINE, selectors.length);
}

export function isBuiltInSignalEnabled(
  key: BuiltInSignalKey,
  settings: SessionReplayFrustrationSettings,
): boolean {
  return settings[key].isEnabled;
}

/* The settings with one built-in signal switched on or off. */
export function withBuiltInSignalEnabled(
  settings: SessionReplayFrustrationSettings,
  key: BuiltInSignalKey,
  isEnabled: boolean,
): SessionReplayFrustrationSettings {
  return {
    ...settings,
    [key]: { ...settings[key], isEnabled: isEnabled },
  };
}

/* ---- The rule editor ---- */

export type RuleFieldUnit = "count" | "seconds" | "milliseconds" | "pixels";

/*
 * One number in a rule, as the editor shows it. Times kept in milliseconds
 * are edited in seconds, which is how people think about them; the editor
 * converts on the way in and out.
 */
export interface RuleNumberField {
  id: string;
  label: string;
  // What the number counts, in the reader's terms; shown after the input.
  unitLabel: string;
  unit: RuleFieldUnit;
  limit: SessionReplayFrustrationNumberLimit;
  read: (settings: SessionReplayFrustrationSettings) => number;
  write: (
    settings: SessionReplayFrustrationSettings,
    value: number,
  ) => SessionReplayFrustrationSettings;
}

const LIMITS: typeof SESSION_REPLAY_FRUSTRATION_LIMITS =
  SESSION_REPLAY_FRUSTRATION_LIMITS;

export const RULE_NUMBER_FIELDS: Record<
  BuiltInSignalKey,
  Array<RuleNumberField>
> = {
  rageClick: [
    {
      id: "clickCount",
      label: translationKey("Clicks"),
      unitLabel: translationKey("clicks or more"),
      unit: "count",
      limit: LIMITS.rageClickCount,
      read: (settings: SessionReplayFrustrationSettings): number => {
        return settings.rageClick.clickCount;
      },
      write: (
        settings: SessionReplayFrustrationSettings,
        value: number,
      ): SessionReplayFrustrationSettings => {
        return {
          ...settings,
          rageClick: { ...settings.rageClick, clickCount: value },
        };
      },
    },
    {
      id: "windowMs",
      label: translationKey("Time between clicks"),
      unitLabel: translationKey("seconds at most"),
      unit: "milliseconds",
      limit: LIMITS.rageClickWindowMs,
      read: (settings: SessionReplayFrustrationSettings): number => {
        return settings.rageClick.windowMs;
      },
      write: (
        settings: SessionReplayFrustrationSettings,
        value: number,
      ): SessionReplayFrustrationSettings => {
        return {
          ...settings,
          rageClick: { ...settings.rageClick, windowMs: value },
        };
      },
    },
    {
      id: "radiusPx",
      label: translationKey("Distance between clicks"),
      unitLabel: translationKey("px at most"),
      unit: "pixels",
      limit: LIMITS.rageClickRadiusPx,
      read: (settings: SessionReplayFrustrationSettings): number => {
        return settings.rageClick.radiusPx;
      },
      write: (
        settings: SessionReplayFrustrationSettings,
        value: number,
      ): SessionReplayFrustrationSettings => {
        return {
          ...settings,
          rageClick: { ...settings.rageClick, radiusPx: value },
        };
      },
    },
  ],
  deadClick: [
    {
      id: "timeoutMs",
      label: translationKey("Wait after the click"),
      unitLabel: translationKey("seconds"),
      unit: "milliseconds",
      limit: LIMITS.deadClickTimeoutMs,
      read: (settings: SessionReplayFrustrationSettings): number => {
        return settings.deadClick.timeoutMs;
      },
      write: (
        settings: SessionReplayFrustrationSettings,
        value: number,
      ): SessionReplayFrustrationSettings => {
        return {
          ...settings,
          deadClick: { ...settings.deadClick, timeoutMs: value },
        };
      },
    },
  ],
  errorClick: [
    {
      id: "windowMs",
      label: translationKey("Time from the click to the error"),
      unitLabel: translationKey("seconds at most"),
      unit: "milliseconds",
      limit: LIMITS.errorClickWindowMs,
      read: (settings: SessionReplayFrustrationSettings): number => {
        return settings.errorClick.windowMs;
      },
      write: (
        settings: SessionReplayFrustrationSettings,
        value: number,
      ): SessionReplayFrustrationSettings => {
        return {
          ...settings,
          errorClick: { ...settings.errorClick, windowMs: value },
        };
      },
    },
  ],
  refreshRage: [
    {
      id: "reloadCount",
      label: translationKey("Loads of the same page"),
      unitLabel: translationKey("loads"),
      unit: "count",
      limit: LIMITS.refreshRageReloadCount,
      read: (settings: SessionReplayFrustrationSettings): number => {
        return settings.refreshRage.reloadCount;
      },
      write: (
        settings: SessionReplayFrustrationSettings,
        value: number,
      ): SessionReplayFrustrationSettings => {
        return {
          ...settings,
          refreshRage: { ...settings.refreshRage, reloadCount: value },
        };
      },
    },
    {
      id: "windowSeconds",
      /*
       * Not "Within": the locales already hold that key as a forecast's
       * horizon ("Prognosezeitraum"), which is not what this number is.
       */
      label: translationKey("Time window"),
      unitLabel: translationKey("seconds"),
      unit: "seconds",
      limit: LIMITS.refreshRageWindowSeconds,
      read: (settings: SessionReplayFrustrationSettings): number => {
        return settings.refreshRage.windowSeconds;
      },
      write: (
        settings: SessionReplayFrustrationSettings,
        value: number,
      ): SessionReplayFrustrationSettings => {
        return {
          ...settings,
          refreshRage: { ...settings.refreshRage, windowSeconds: value },
        };
      },
    },
  ],
};

/* Rage and dead clicks can ignore elements; the other two have no click to ignore. */
export function hasIgnoredSelectors(key: BuiltInSignalKey): boolean {
  return key === "rageClick" || key === "deadClick";
}

export const IGNORE_SELECTORS_LABEL: string = translationKey(
  "Never count clicks on",
);

export const IGNORE_SELECTORS_HINT: string = translationKey(
  "One CSS selector a line, such as .quantity-stepper. A click on a matching element, or inside one, never counts.",
);

/* What the input shows for a stored number: seconds for the millisecond fields. */
export function toFieldText(field: RuleNumberField, value: number): string {
  return field.unit === "milliseconds"
    ? String(toSeconds(value))
    : String(value);
}

const FIELD_RANGE_PROBLEM: string = translationKey(
  "Enter a number from {{min}} to {{max}}.",
);

const FIELD_WHOLE_NUMBER_PROBLEM: string = translationKey(
  "Enter a whole number from {{min}} to {{max}}.",
);

/*
 * The stored value for what was typed, or why it cannot be: a number in
 * the rule's range, whole where the rule counts things. Seconds are read
 * with a comma as well as a point, since half the readers write one.
 */
export function readFieldText(
  field: RuleNumberField,
  text: string,
  translator: Translator,
): { value: number | null; problem: string | null } {
  const normalized: string = text.trim().replace(",", ".");
  const parsed: number = normalized.length > 0 ? Number(normalized) : NaN;
  const isMilliseconds: boolean = field.unit === "milliseconds";
  const min: number = isMilliseconds
    ? toSeconds(field.limit.min)
    : field.limit.min;
  const max: number = isMilliseconds
    ? toSeconds(field.limit.max)
    : field.limit.max;
  const values: Record<string, string> = {
    min: translator.formatNumber(min),
    max: translator.formatNumber(max),
  };

  if (!Number.isFinite(parsed)) {
    return {
      value: null,
      problem: translator.translateTemplate(
        isMilliseconds ? FIELD_RANGE_PROBLEM : FIELD_WHOLE_NUMBER_PROBLEM,
        values,
      ),
    };
  }

  if (isMilliseconds) {
    const milliseconds: number = Math.round(parsed * 1000);

    if (milliseconds < field.limit.min || milliseconds > field.limit.max) {
      return {
        value: null,
        problem: translator.translateTemplate(FIELD_RANGE_PROBLEM, values),
      };
    }

    return { value: milliseconds, problem: null };
  }

  if (
    !Number.isInteger(parsed) ||
    parsed < field.limit.min ||
    parsed > field.limit.max
  ) {
    return {
      value: null,
      problem: translator.translateTemplate(FIELD_WHOLE_NUMBER_PROBLEM, values),
    };
  }

  return { value: parsed, problem: null };
}

export type SelectorCheck = (selector: string) => boolean;

/*
 * Whether this browser can read a selector. The server has no DOM and only
 * checks its shape; the page asks the browser itself before it sends one.
 */
export const browserAcceptsSelector: SelectorCheck = (
  selector: string,
): boolean => {
  if (typeof document === "undefined") {
    return true;
  }

  try {
    document.createDocumentFragment().querySelector(selector);
    return true;
  } catch {
    return false;
  }
};

const SELECTOR_LIST_TOO_LONG: string = translationKey(
  "List at most {{max}} selectors.",
);

const SELECTOR_TOO_LONG: string = translationKey(
  "A selector can be at most {{max}} characters.",
);

const SELECTOR_NOT_READ: string = translationKey(
  "Your browser cannot read {{selector}} as a CSS selector.",
);

/* The selectors on separate lines, trimmed, blank lines dropped, each once. */
export function readSelectorLines(text: string): Array<string> {
  const selectors: Array<string> = [];

  for (const line of text.split("\n")) {
    const selector: string = line.trim();

    if (selector.length > 0 && selectors.indexOf(selector) === -1) {
      selectors.push(selector);
    }
  }

  return selectors;
}

/* What is wrong with a list of ignored selectors, or null. */
export function getIgnoredSelectorsProblem(
  selectors: Array<string>,
  translator: Translator,
  acceptsSelector: SelectorCheck = browserAcceptsSelector,
): string | null {
  if (selectors.length > SESSION_REPLAY_MAX_IGNORED_SELECTORS) {
    return translator.translateTemplate(SELECTOR_LIST_TOO_LONG, {
      max: translator.formatNumber(SESSION_REPLAY_MAX_IGNORED_SELECTORS),
    });
  }

  for (const selector of selectors) {
    if (selector.length > SESSION_REPLAY_MAX_IGNORED_SELECTOR_LENGTH) {
      return translator.translateTemplate(SELECTOR_TOO_LONG, {
        max: translator.formatNumber(
          SESSION_REPLAY_MAX_IGNORED_SELECTOR_LENGTH,
        ),
      });
    }

    if (!isPlausibleCssSelector(selector) || !acceptsSelector(selector)) {
      return translator.translateTemplate(SELECTOR_NOT_READ, {
        selector: selector,
      });
    }
  }

  return null;
}

/* The settings with one built-in signal's rule put back to its defaults. */
export function getDefaultRuleFieldTexts(
  key: BuiltInSignalKey,
  defaults: SessionReplayFrustrationSettings,
): Record<string, string> {
  const texts: Record<string, string> = {};

  for (const field of RULE_NUMBER_FIELDS[key]) {
    texts[field.id] = toFieldText(field, field.read(defaults));
  }

  return texts;
}

/* ---- Signals of the application's own ---- */

export interface CustomSignalTriggerCopy {
  // The choice in the dialog.
  title: string;
  description: string;
  // The field the dialog asks for.
  matchLabel: string;
  matchPlaceholder: string;
  matchHint: string;
  // "Click on #pay-button": how a row in the list says what sets it off.
  rowTemplate: string;
}

export const CUSTOM_SIGNAL_TRIGGER_COPY: Record<
  SessionReplayCustomSignalTrigger,
  CustomSignalTriggerCopy
> = {
  click: {
    title: translationKey("A click on an element"),
    description: translationKey(
      "Someone clicks a button or link you name with a CSS selector. Browser recorder only.",
    ),
    matchLabel: translationKey("CSS selector"),
    matchPlaceholder: "#contact-support",
    matchHint: translationKey(
      "A click on a matching element, or anything inside it, sets the signal off.",
    ),
    rowTemplate: translationKey("A click on {{match}}"),
  },
  page: {
    title: translationKey("A page"),
    description: translationKey(
      "Someone reaches a page, such as an error or a cancellation page.",
    ),
    matchLabel: translationKey("Page path"),
    matchPlaceholder: "/checkout/error",
    matchHint: translationKey(
      "The path only, without the domain, ? or #. Use * for any part of it, such as /orders/*/failed. Case and a slash at the end are ignored.",
    ),
    rowTemplate: translationKey("The page {{match}}"),
  },
  event: {
    title: translationKey("An event from your code"),
    description: translationKey(
      "Your page calls OneUptimeReplay.track() with a name you choose.",
    ),
    matchLabel: translationKey("Event name"),
    matchPlaceholder: "payment_failed",
    matchHint: translationKey(
      "The name your code passes to OneUptimeReplay.track(). Case is ignored.",
    ),
    rowTemplate: translationKey("The event {{match}}"),
  },
  error: {
    title: translationKey("An error"),
    description: translationKey(
      "An error whose message contains text you know, such as card declined.",
    ),
    matchLabel: translationKey("Text the error contains"),
    matchPlaceholder: "card declined",
    matchHint: translationKey(
      "Case is ignored. The error's text is matched in the visitor's browser and never sent because of this signal.",
    ),
    rowTemplate: translationKey("An error containing {{match}}"),
  },
};

export const CUSTOM_SIGNAL_TRIGGERS: ReadonlyArray<SessionReplayCustomSignalTrigger> =
  ["click", "page", "event", "error"];

export const COUNTS_AS_FRUSTRATION_TITLE: string = translationKey(
  "Counts as frustration",
);

export const COUNTS_AS_FRUSTRATION_ON_COPY: string = translationKey(
  "Joins rage and dead clicks in the Frustration filter, sort and totals, and can start a recording when the capture trigger is On error or frustration.",
);

export const COUNTS_AS_FRUSTRATION_OFF_COPY: string = translationKey(
  "A marker on the replay timeline and a badge on the session list, without calling the session frustrated.",
);

export function describeCustomSignalTrigger(
  signal: Pick<SessionReplayCustomSignal, "trigger" | "match">,
  translator: Translator,
): string {
  return translator.translateTemplate(
    CUSTOM_SIGNAL_TRIGGER_COPY[signal.trigger].rowTemplate,
    { match: signal.match },
  );
}

const NAME_EMPTY: string = translationKey("Give the signal a name.");

const NAME_TOO_LONG: string = translationKey(
  "A name can be at most {{max}} characters.",
);

const NAME_CONTROL: string = translationKey(
  "A name cannot contain line breaks.",
);

const NAME_BUILT_IN: string = translationKey(
  "{{name}} is a built-in signal. Give yours its own name.",
);

const NAME_TAKEN: string = translationKey(
  "Another signal is already called {{name}}.",
);

const MATCH_EMPTY: Record<SessionReplayCustomSignalTrigger, string> = {
  click: translationKey(
    "Enter the CSS selector of the element, such as #pay-button.",
  ),
  page: translationKey("Enter the page's path, such as /checkout/error."),
  event: translationKey("Enter the event name your code passes to track()."),
  error: translationKey("Enter the text the error contains."),
};

const MATCH_TOO_LONG: string = translationKey(
  "This can be at most {{max}} characters.",
);

const MATCH_CONTROL: string = translationKey(
  "This cannot contain line breaks.",
);

const PAGE_NOT_ANCHORED: string = translationKey(
  "A page path starts with / (or with * to match the end of any path), such as /checkout/error.",
);

const PAGE_HAS_QUERY: string = translationKey(
  "Match the page's path only, without ? or #.",
);

/* Names a signal of the application's own may not take. */
const BUILT_IN_NAMES: ReadonlyArray<string> = [
  "rage click",
  "rage clicks",
  "dead click",
  "dead clicks",
  "error click",
  "error clicks",
  "refresh rage",
];

function hasControlCharacter(text: string): boolean {
  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }

  return false;
}

export interface CustomSignalDraft {
  name: string;
  trigger: SessionReplayCustomSignalTrigger;
  match: string;
  isFrustration: boolean;
}

export interface CustomSignalDraftProblems {
  name: string | null;
  match: string | null;
}

/*
 * What is wrong with a signal in the dialog, field by field, in the
 * reader's language. The same rules the server holds every write to
 * (Common/Utils/Rum/SessionReplayFrustrationSettingsValidation), plus the
 * browser's own reading of a selector, which the server cannot do.
 */
export function getCustomSignalDraftProblems(
  draft: CustomSignalDraft,
  otherNames: Array<string>,
  translator: Translator,
  acceptsSelector: SelectorCheck = browserAcceptsSelector,
): CustomSignalDraftProblems {
  const name: string = draft.name.trim();
  const match: string = draft.match.trim();
  let nameProblem: string | null = null;
  let matchProblem: string | null = null;

  if (name.length === 0) {
    nameProblem = translator.translateText(NAME_EMPTY) || NAME_EMPTY;
  } else if (name.length > SESSION_REPLAY_MAX_CUSTOM_SIGNAL_NAME_LENGTH) {
    nameProblem = translator.translateTemplate(NAME_TOO_LONG, {
      max: translator.formatNumber(
        SESSION_REPLAY_MAX_CUSTOM_SIGNAL_NAME_LENGTH,
      ),
    });
  } else if (hasControlCharacter(name)) {
    nameProblem = translator.translateText(NAME_CONTROL) || NAME_CONTROL;
  } else if (BUILT_IN_NAMES.indexOf(name.toLowerCase()) !== -1) {
    nameProblem = translator.translateTemplate(NAME_BUILT_IN, { name: name });
  } else if (
    otherNames.some((other: string): boolean => {
      return other.trim().toLowerCase() === name.toLowerCase();
    })
  ) {
    nameProblem = translator.translateTemplate(NAME_TAKEN, { name: name });
  }

  const maxLength: number = getSessionReplayCustomSignalMatchMaxLength(
    draft.trigger,
  );

  if (match.length === 0) {
    const empty: string = MATCH_EMPTY[draft.trigger];
    matchProblem = translator.translateText(empty) || empty;
  } else if (match.length > maxLength) {
    matchProblem = translator.translateTemplate(MATCH_TOO_LONG, {
      max: translator.formatNumber(maxLength),
    });
  } else if (hasControlCharacter(match)) {
    matchProblem = translator.translateText(MATCH_CONTROL) || MATCH_CONTROL;
  } else if (draft.trigger === "click") {
    if (!isPlausibleCssSelector(match) || !acceptsSelector(match)) {
      matchProblem = translator.translateTemplate(SELECTOR_NOT_READ, {
        selector: match,
      });
    }
  } else if (draft.trigger === "page") {
    if (!isSessionReplayPagePatternAnchored(match)) {
      matchProblem =
        translator.translateText(PAGE_NOT_ANCHORED) || PAGE_NOT_ANCHORED;
    } else if (match.indexOf("?") !== -1 || match.indexOf("#") !== -1) {
      matchProblem = translator.translateText(PAGE_HAS_QUERY) || PAGE_HAS_QUERY;
    }
  }

  return { name: nameProblem, match: matchProblem };
}

/*
 * A new id for a signal: only the page reads it, to tell rows apart while
 * one is renamed. The server keeps one it is handed and mints the rest.
 */
export function makeCustomSignalId(): string {
  const random: string = Math.random().toString(36).slice(2, 10);

  return `signal-${Date.now().toString(36)}-${random}`;
}

/* The settings with a signal added, or replaced where its id already is. */
export function withCustomSignal(
  settings: SessionReplayFrustrationSettings,
  signal: SessionReplayCustomSignal,
): SessionReplayFrustrationSettings {
  const index: number = settings.customSignals.findIndex(
    (candidate: SessionReplayCustomSignal): boolean => {
      return candidate.id === signal.id;
    },
  );

  const customSignals: Array<SessionReplayCustomSignal> =
    settings.customSignals.slice();

  if (index === -1) {
    customSignals.push(signal);
  } else {
    customSignals[index] = signal;
  }

  return { ...settings, customSignals: customSignals };
}

export function withoutCustomSignal(
  settings: SessionReplayFrustrationSettings,
  signalId: string,
): SessionReplayFrustrationSettings {
  return {
    ...settings,
    customSignals: settings.customSignals.filter(
      (candidate: SessionReplayCustomSignal): boolean => {
        return candidate.id !== signalId;
      },
    ),
  };
}

export function canAddCustomSignal(
  settings: SessionReplayFrustrationSettings,
): boolean {
  return settings.customSignals.length < SESSION_REPLAY_MAX_CUSTOM_SIGNALS;
}

export const DELETE_SIGNAL_TITLE: string = translationKey("Delete signal");

export const DELETE_SIGNAL_TEXT: string = translationKey("Delete");

export const EDIT_SIGNAL_TEXT: string = translationKey("Edit");

export const DELETE_SIGNAL_DESCRIPTION: string = translationKey(
  "{{name}} stops being detected in sessions recorded from now on. Sessions already recorded keep its markers and badges.",
);

export const ADD_SIGNAL_TITLE: string = translationKey("Add a signal");

export const EDIT_SIGNAL_TITLE: string = translationKey("Edit signal");

export const SIGNAL_NAME_LABEL: string = translationKey("Name");

export const SIGNAL_NAME_PLACEHOLDER: string = translationKey("Payment failed");

export const SIGNAL_NAME_HINT: string = translationKey(
  "Shown on the session list and the replay timeline, and what the list's filter finds it by.",
);

export const SIGNAL_TRIGGER_LABEL: string = translationKey("What sets it off");

export const SAVE_SIGNAL_TEXT: string = translationKey("Save signal");
