import { matchesSessionReplayPagePattern } from "./SessionReplayFrustrationSignals";

/*
 * WHICH PAGES OF A WEBSITE A RECORDING MAY HOLD (issue #7502).
 *
 * An application's replay policy can name pages by path: "Record only these
 * pages" (record checkout, nothing else) and "Never record these pages"
 * (never /admin, never the account pages). Without them the only way to
 * keep a page out of a recording was code - pause() on the way in,
 * resume() on the way out, from the page's router - which every customer
 * had to write and could get wrong: a pause one frame late has already
 * recorded the start of the page it meant to skip.
 *
 * A pattern is a path, matched the way the application's page signals
 * match one (matchesSessionReplayPagePattern): a star for any run of
 * characters, case and the slashes at the end ignored, the query and the
 * fragment never part of it. A page is its path, and for a hash-routed app
 * also the route after the # (CustomSignalDetector.pagePathsOf), and a
 * pattern that matches either names the page.
 *
 * Never record wins over Record only. Both empty (the default) records
 * every page, as a policy without them always did.
 *
 * Read by the browser recorder (bundled: keep it dependency-free) and by
 * the server, which sends the rules in the replay config. The strict check
 * of a write lives in Utils/Rum/SessionReplayPolicyValidation, which says
 * what is wrong with a pattern rather than reading past it.
 */

// The most patterns either list may hold.
export const SESSION_REPLAY_MAX_PAGE_RULES: number = 50;

export interface SessionReplayPageRules {
  // Empty: every page may be recorded. Otherwise only a page one of these names.
  recordOnly: Array<string>;
  // A page one of these names is never recorded, whatever recordOnly says.
  neverRecord: Array<string>;
}

/*
 * What rules that cannot be read mean: no page is recorded. A privacy
 * setting a recorder cannot read must never record more than it would
 * have; a pattern that names every page ("*") in Never record says so.
 */
export const SESSION_REPLAY_NO_PAGE_RECORDED: SessionReplayPageRules = {
  recordOnly: [],
  neverRecord: ["*"],
};

/*
 * One list, trimmed, each pattern once - or null when it is there but is
 * not a list of patterns at all. Every pattern is kept as it was written:
 * one that cannot match (no slash at its start) simply matches no page, so
 * a Record only list of them records nothing, never everything.
 */
export function readSessionReplayPagePatterns(
  value: unknown,
): Array<string> | null {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const patterns: Array<string> = [];

  for (const entry of value) {
    if (typeof entry !== "string") {
      return null;
    }

    const pattern: string = entry.trim();

    if (pattern && patterns.indexOf(pattern) === -1) {
      patterns.push(pattern);
    }
  }

  return patterns;
}

/*
 * The rules from anything: the config's `pageRules` field, or the two
 * stored columns put together. Absent, there are none and every page is
 * recorded. There but unreadable - not an object, a list that is not a
 * list of patterns - no page is (SESSION_REPLAY_NO_PAGE_RECORDED).
 */
export function readSessionReplayPageRules(
  value: unknown,
): SessionReplayPageRules {
  if (value === undefined || value === null) {
    return { recordOnly: [], neverRecord: [] };
  }

  const record: Record<string, unknown> | null =
    typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const recordOnly: Array<string> | null = record
    ? readSessionReplayPagePatterns(record["recordOnly"])
    : null;
  const neverRecord: Array<string> | null = record
    ? readSessionReplayPagePatterns(record["neverRecord"])
    : null;

  // SESSION_REPLAY_NO_PAGE_RECORDED, a list of its own each time.
  if (!recordOnly || !neverRecord) {
    return { recordOnly: [], neverRecord: ["*"] };
  }

  return { recordOnly: recordOnly, neverRecord: neverRecord };
}

// Whether the rules name any page at all.
export function hasSessionReplayPageRules(
  rules: SessionReplayPageRules,
): boolean {
  return rules.recordOnly.length > 0 || rules.neverRecord.length > 0;
}

/*
 * May a recording hold the page whose paths these are (its path, and a
 * hash router's route)? Not when Never record names it; otherwise yes when
 * Record only is empty or names it.
 */
export function isSessionReplayPageRecorded(
  rules: SessionReplayPageRules,
  paths: Array<string>,
): boolean {
  const names: (patterns: Array<string>) => boolean = (
    patterns: Array<string>,
  ): boolean => {
    return patterns.some((pattern: string): boolean => {
      return paths.some((path: string): boolean => {
        return matchesSessionReplayPagePattern(pattern, path);
      });
    });
  };

  return (
    !names(rules.neverRecord) &&
    (rules.recordOnly.length === 0 || names(rules.recordOnly))
  );
}
