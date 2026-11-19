import {
  SESSION_REPLAY_MAX_PAGE_RULES,
  readSessionReplayPagePatterns,
} from "../../Types/Rum/SessionReplayPageRules";
import { normalizeSessionReplayReadablePropertyKeys } from "../../Types/Rum/SessionReplayReadableProperties";
import {
  SESSION_REPLAY_MAX_TRAIT_KEY_LENGTH,
  SESSION_REPLAY_MAX_TRAIT_KEYS,
} from "../../Types/Rum/SessionReplay";
import { getSessionReplayCustomSignalMatchProblem } from "./SessionReplayFrustrationSettingsValidation";

/*
 * The strict check of a replay policy's page rules and readable event
 * properties on every write (RumApplicationService), API writes as well as
 * the Replay Policy page's.
 *
 * Where the recorders read leniently - a pattern that cannot match matches
 * nothing - this says what is wrong, naming the setting and the entry, so
 * what the page shows is what the recorders will do. A pattern that names
 * no path ("checkout", "/search?q=*") is refused rather than stored and
 * quietly never matched: in Never record that would be a page someone
 * meant to keep out of every recording, recorded.
 *
 * Not bundled into the recorder: it is the messages that make it heavy.
 */

export interface SessionReplayListCheck {
  // The list to store: trimmed, each entry once. Empty when cleared.
  values: Array<string>;
  // What is wrong, a sentence naming the setting, or null.
  problem: string | null;
}

// The two lists of page paths, by the names the Replay Policy page gives them.
export const SESSION_REPLAY_RECORD_ONLY_PAGES_TITLE: string =
  "Record only these pages";
export const SESSION_REPLAY_NEVER_RECORD_PAGES_TITLE: string =
  "Never record these pages";
export const SESSION_REPLAY_READABLE_EVENT_PROPERTIES_TITLE: string =
  "Readable event properties";

/*
 * One list of page paths: a list of strings, each a path pattern the page
 * signals would accept, at most SESSION_REPLAY_MAX_PAGE_RULES of them.
 * null clears it.
 */
export function checkSessionReplayPagePatterns(
  value: unknown,
  title: string,
): SessionReplayListCheck {
  if (value === null || value === undefined) {
    return { values: [], problem: null };
  }

  if (
    !Array.isArray(value) ||
    value.some((entry: unknown): boolean => {
      return typeof entry !== "string";
    })
  ) {
    return {
      values: [],
      problem: `${title} must be a list of page paths, such as ["/checkout*"].`,
    };
  }

  for (const entry of value as Array<string>) {
    const problem: string | null = getSessionReplayCustomSignalMatchProblem(
      "page",
      entry,
    );

    if (problem) {
      return {
        values: [],
        problem: `${title}: "${entry.trim()}" is not a page path. ${problem}`,
      };
    }
  }

  const patterns: Array<string> = readSessionReplayPagePatterns(value) || [];

  if (patterns.length > SESSION_REPLAY_MAX_PAGE_RULES) {
    return {
      values: [],
      problem: `${title} can name at most ${SESSION_REPLAY_MAX_PAGE_RULES} page paths. Use a * to name many pages with one path.`,
    };
  }

  return { values: patterns, problem: null };
}

/*
 * The readable event property keys: a list of strings, at most the number
 * of keys a property map can carry. Stored as the recorders read them.
 */
export function checkSessionReplayReadablePropertyKeys(
  value: unknown,
): SessionReplayListCheck {
  if (value === null || value === undefined) {
    return { values: [], problem: null };
  }

  if (
    !Array.isArray(value) ||
    value.some((entry: unknown): boolean => {
      return typeof entry !== "string";
    })
  ) {
    return {
      values: [],
      problem: `${SESSION_REPLAY_READABLE_EVENT_PROPERTIES_TITLE} must be a list of property keys, such as ["plan", "step"].`,
    };
  }

  const keys: Array<string> = (value as Array<string>)
    .map((entry: string): string => {
      return entry.trim();
    })
    .filter((entry: string): boolean => {
      return entry.length > 0;
    });

  /*
   * Refused, not cut short: a property's key is cut at this length before
   * it leaves the page, so a longer one would quietly name another key.
   */
  const tooLong: string | undefined = keys.find((key: string): boolean => {
    return key.length > SESSION_REPLAY_MAX_TRAIT_KEY_LENGTH;
  });

  if (tooLong !== undefined) {
    return {
      values: [],
      problem: `${SESSION_REPLAY_READABLE_EVENT_PROPERTIES_TITLE}: a property key can be at most ${SESSION_REPLAY_MAX_TRAIT_KEY_LENGTH} characters, and "${tooLong.slice(0, 60)}" is longer.`,
    };
  }

  if (new Set(keys).size > SESSION_REPLAY_MAX_TRAIT_KEYS) {
    return {
      values: [],
      problem: `${SESSION_REPLAY_READABLE_EVENT_PROPERTIES_TITLE} can name at most ${SESSION_REPLAY_MAX_TRAIT_KEYS} property keys.`,
    };
  }

  return {
    values: normalizeSessionReplayReadablePropertyKeys(keys),
    problem: null,
  };
}
