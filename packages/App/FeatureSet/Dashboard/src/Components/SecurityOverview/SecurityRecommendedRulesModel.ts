import { SecuritySetupStatus } from "./SecuritySetupModel";
import {
  LibraryStatusFilter,
  RECOMMENDED_FILTER,
  RULE_LIBRARY_QUERY_KEYS,
} from "../SecurityEvents/RuleLibraryUtil";
import { JSONValue } from "Common/Types/JSON";
import {
  DetectionRuleLibraryEntry,
  getDetectionRuleLibraryEntry,
} from "Common/Types/SecurityEvent/DetectionRuleLibrary";
import Dictionary from "Common/Types/Dictionary";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import { SecurityRuleAddedByOneUptime } from "Common/Utils/SecurityEvent/RecommendedDetectionRules";

/*
 * THE RECOMMENDED RULES A PROJECT DOES NOT HAVE, AND THOSE ONEUPTIME
 * TURNED ON FOR IT (#11037), as the Overview's card says them at its foot.
 *
 * The Detections cell reads "26 of 27 recommended" with a bulb; under the
 * pipeline the card names each recommended rule the project has no rule of
 * - what it is called, how severe its findings are, what it catches - with
 * Turn On, which adds it as the Rule Library's Add does. A project that
 * took the whole set before a rule became recommended learns of the new
 * one here, whichever rule is next. One that chose its own set dismisses
 * the line, and it comes back only for a rule it was not shown.
 *
 * A rule OneUptime added itself, on upgrade (AddSensitiveFileServedTo
 * RecommendedRules), is said for a month above it: what was turned on,
 * when and why, with Turn Off.
 *
 * React-free, so every case is pinned in a plain test. The words are
 * English translation keys, looked up where they are drawn; a rule's name
 * and what it catches are the library's, drawn as the Rule Library draws
 * them.
 */

// How many rules the card names; the Rule Library lists the rest.
export const RECOMMENDED_RULES_SHOWN: number = 3;

export const RECOMMENDED_RULES_NOT_ADDED: PluralTemplate = {
  one: "{{count}} recommended rule is not in this project yet",
  other: "{{count}} recommended rules are not in this project yet",
};

export const MORE_RECOMMENDED_RULES: PluralTemplate = {
  one: "{{count}} more in the Rule Library",
  other: "{{count}} more in the Rule Library",
};

export const TURN_ON_RULE: string = translationKey("Turn On");
export const TURN_OFF_RULE: string = translationKey("Turn Off");
export const DISMISS: string = translationKey("Dismiss");

// What a click said, in a toast that goes by itself.
export const RULE_TURNED_ON: string = translationKey("{{rule}} is on.");
export const RULE_TURNED_OFF: string = translationKey("{{rule}} is off.");

// The Rule Library's own words for an add that did not go through.
export const RULES_NOT_ADDED: PluralTemplate = {
  one: "{{count}} rule could not be added",
  other: "{{count}} rules could not be added",
};

export const RULE_NOT_TURNED_OFF: string = translationKey(
  "{{rule}} could not be turned off",
);

// A rule OneUptime added: what, when, and why.
export const RULE_ADDED_BY_ONEUPTIME: string = translationKey(
  "OneUptime turned on {{rule}} on {{date}}",
);

export const RULE_ADDED_BY_ONEUPTIME_WHY: string = translationKey(
  "Every other recommended rule was on in this project, so OneUptime added this one when it became recommended.",
);

// The card's lines, for a screen reader.
export const RECOMMENDED_RULES_LIST_LABEL: string = translationKey(
  "Recommended rules not in this project",
);

export interface RecommendedRulesNotAddedView {
  // The rules named, each with Turn On.
  shown: Array<DetectionRuleLibraryEntry>;
  // How many the line counts: those not dismissed.
  total: number;
  // How many more the Rule Library lists.
  more: number;
  // Every rule the line stands for, the shown ones and the rest: what Dismiss puts away.
  ids: Array<string>;
}

/*
 * The recommended rules not in the project to name, or null: each one the
 * reader did not dismiss, in the library's order, the first
 * RECOMMENDED_RULES_SHOWN of them named.
 */
export function getRecommendedRulesNotAddedView(data: {
  status: SecuritySetupStatus;
  dismissedIds: ReadonlyArray<string>;
}): RecommendedRulesNotAddedView | null {
  const entries: Array<DetectionRuleLibraryEntry> = (
    data.status.recommendedRulesNotAdded || []
  ).filter((entry: DetectionRuleLibraryEntry): boolean => {
    return !data.dismissedIds.includes(entry.id);
  });

  if (entries.length === 0) {
    return null;
  }

  return {
    shown: entries.slice(0, RECOMMENDED_RULES_SHOWN),
    total: entries.length,
    more: Math.max(0, entries.length - RECOMMENDED_RULES_SHOWN),
    ids: entries.map((entry: DetectionRuleLibraryEntry): string => {
      return entry.id;
    }),
  };
}

export interface RuleAddedByOneUptimeView {
  rule: SecurityRuleAddedByOneUptime;
  entry: DetectionRuleLibraryEntry;
}

// The rules OneUptime added to say, the latest first: each one not dismissed.
export function getRulesAddedByOneUptimeViews(data: {
  status: SecuritySetupStatus;
  dismissedIds: ReadonlyArray<string>;
}): Array<RuleAddedByOneUptimeView> {
  const views: Array<RuleAddedByOneUptimeView> = [];

  for (const rule of data.status.rulesAddedByOneUptime || []) {
    const entry: DetectionRuleLibraryEntry | undefined =
      getDetectionRuleLibraryEntry(rule.libraryRuleId);

    if (entry && !data.dismissedIds.includes(rule.ruleId)) {
      views.push({ rule, entry });
    }
  }

  return views;
}

/*
 * The Rule Library, opened on the recommended rules the project has not
 * added: "N more in the Rule Library".
 */
export function getRecommendedRulesNotAddedQuery(): Dictionary<string> {
  return {
    [RULE_LIBRARY_QUERY_KEYS.category]: RECOMMENDED_FILTER,
    [RULE_LIBRARY_QUERY_KEYS.status]: LibraryStatusFilter.NotAdded,
  };
}

/*
 * ---------------------------------------------------------------------------
 * What the reader dismissed, per project, in the browser
 * ---------------------------------------------------------------------------
 */

export enum SecurityRecommendedRulesDismissal {
  // The recommended rules not in the project, by library id.
  NotAdded = "security-recommended-rules-dismissed",
  // The rules OneUptime added, by rule id.
  AddedByOneUptime = "security-rules-added-by-oneuptime-dismissed",
}

// What one browser keeps of a dismissal at most: the line's rules and a few more.
export const MAX_DISMISSED_IDS: number = 200;

// Where a dismissal is kept for a project; none without a project.
export function getDismissalKey(
  dismissal: SecurityRecommendedRulesDismissal,
  projectId: string | null | undefined,
): string | null {
  return projectId ? `${dismissal}-${projectId}` : null;
}

// A dismissal as it was kept, read defensively: ids, each once, at most the cap.
export function readDismissedIdsFrom(value: JSONValue): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      (value as Array<unknown>).filter((id: unknown): id is string => {
        return typeof id === "string" && id.length > 0;
      }),
    ),
  ).slice(0, MAX_DISMISSED_IDS);
}

// These dismissed too, beside what was before - the latest first, within the cap.
export function mergeDismissedIds(
  dismissed: ReadonlyArray<string>,
  ids: ReadonlyArray<string>,
): Array<string> {
  return Array.from(new Set([...ids, ...dismissed])).slice(
    0,
    MAX_DISMISSED_IDS,
  );
}
