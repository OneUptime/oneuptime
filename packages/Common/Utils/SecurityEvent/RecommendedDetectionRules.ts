import DetectionRule from "../../Models/DatabaseModels/DetectionRule";
import { JSONObject, JSONValue } from "../../Types/JSON";
import {
  DetectionRuleLibraryEntry,
  getDetectionRuleLibraryEntry,
  getRecommendedDetectionRules,
  isRecommendedDetectionRule,
} from "../../Types/SecurityEvent/DetectionRuleLibrary";
import {
  findRuleOfLibraryEntry,
  isRuleFromLibraryEntry,
} from "./SecurityTemplateRecords";

/*
 * WHICH RECOMMENDED RULES A PROJECT DOES NOT HAVE (#11037).
 *
 * Turn on recommended adds the library's recommended rules a project has
 * not got. A rule that becomes recommended later - Sensitive file served
 * (#10912), say - reaches the projects that clicked before only when they
 * click again, and the Overview read one fewer than all of them without
 * saying which. One place decides it for every place that asks: the
 * Overview, which names each one with what it catches and Turn On; the
 * Rule Library's Add Recommended Rules; and the upgrade that adds a new
 * recommended rule to the projects that run every other one
 * (AddSensitiveFileServedToRecommendedRules).
 *
 * A project has a library rule when one of its rules carries the rule's
 * id or its name (SecurityTemplateRecords), however it was renamed. Pure,
 * so the server, the Dashboard and the upgrade read it alike.
 */

// A project's rule, as much of it as these read.
export type ProjectRuleState = Pick<
  DetectionRule,
  "name" | "sigmaRuleYaml" | "isEnabled"
>;

// The recommended rules the project has no rule of, in the library's order.
export function getRecommendedRulesNotAdded(
  rules: ReadonlyArray<ProjectRuleState>,
): Array<DetectionRuleLibraryEntry> {
  return getRecommendedDetectionRules().filter(
    (entry: DetectionRuleLibraryEntry): boolean => {
      return !findRuleOfLibraryEntry(rules, entry);
    },
  );
}

/*
 * Whether the project runs every recommended rule but these: each one is a
 * rule of the project, and on. One someone turned off, or deleted, says the
 * project chose its own set. With no other recommended rule, it does not.
 */
export function hasEveryOtherRecommendedRuleOn(
  rules: ReadonlyArray<ProjectRuleState>,
  exceptIds: ReadonlyArray<string>,
): boolean {
  const others: Array<DetectionRuleLibraryEntry> =
    getRecommendedDetectionRules().filter(
      (entry: DetectionRuleLibraryEntry): boolean => {
        return !exceptIds.includes(entry.id);
      },
    );

  if (others.length === 0) {
    return false;
  }

  return others.every((entry: DetectionRuleLibraryEntry): boolean => {
    const rule: ProjectRuleState | undefined = findRuleOfLibraryEntry(
      rules,
      entry,
    );

    return Boolean(rule) && rule!.isEnabled === true;
  });
}

/*
 * ---------------------------------------------------------------------------
 * The rules OneUptime added itself (#11037)
 * ---------------------------------------------------------------------------
 */

/*
 * How long the Overview says OneUptime added a rule: long enough for a team
 * that opens it once a month to be told, short enough that it is news.
 */
export const RULES_ADDED_BY_ONEUPTIME_SHOWN_FOR_IN_DAYS: number = 30;

// A recommended rule OneUptime added itself, as the Overview names it.
export interface SecurityRuleAddedByOneUptime {
  // The project's rule.
  ruleId: string;
  // The library rule it is, for what it catches.
  libraryRuleId: string;
  // The name the project's lists show.
  name: string;
  // When OneUptime added it, as an ISO time.
  addedAt: string;
}

export type RuleAddedByOneUptimeState = Pick<
  DetectionRule,
  "id" | "name" | "sigmaRuleYaml" | "isEnabled" | "addedByOneUptimeAt"
>;

function readDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }

  const date: Date = value instanceof Date ? value : new Date(String(value));

  return Number.isNaN(date.getTime()) ? null : date;
}

/*
 * The recommended rules OneUptime added itself in the last
 * RULES_ADDED_BY_ONEUPTIME_SHOWN_FOR_IN_DAYS that are still on - one turned
 * off has been answered - the latest first. A rule OneUptime added that is
 * no recommended rule's is left out: nothing says what it catches.
 */
export function getRulesAddedByOneUptime(data: {
  rules: ReadonlyArray<RuleAddedByOneUptimeState>;
  now: Date;
}): Array<SecurityRuleAddedByOneUptime> {
  const since: number =
    data.now.getTime() -
    RULES_ADDED_BY_ONEUPTIME_SHOWN_FOR_IN_DAYS * 24 * 60 * 60 * 1000;
  const added: Array<SecurityRuleAddedByOneUptime> = [];

  for (const rule of data.rules) {
    const addedAt: Date | null = readDate(rule.addedByOneUptimeAt);

    if (
      !addedAt ||
      addedAt.getTime() < since ||
      rule.isEnabled !== true ||
      !rule.id
    ) {
      continue;
    }

    const entry: DetectionRuleLibraryEntry | undefined =
      getRecommendedDetectionRules().find(
        (candidate: DetectionRuleLibraryEntry): boolean => {
          return isRuleFromLibraryEntry(rule, candidate);
        },
      );

    if (!entry) {
      continue;
    }

    added.push({
      ruleId: rule.id.toString(),
      libraryRuleId: entry.id,
      name: rule.name || entry.title,
      addedAt: addedAt.toISOString(),
    });
  }

  return added.sort(
    (
      a: SecurityRuleAddedByOneUptime,
      b: SecurityRuleAddedByOneUptime,
    ): number => {
      return b.addedAt.localeCompare(a.addedAt);
    },
  );
}

/*
 * The Dashboard's read of them, defensively: an entry with no rule, no
 * recommended library rule it knows or no time it can read is left out.
 */
export function readRulesAddedByOneUptime(
  value: JSONValue | undefined,
): Array<SecurityRuleAddedByOneUptime> {
  if (!Array.isArray(value)) {
    return [];
  }

  const added: Array<SecurityRuleAddedByOneUptime> = [];

  for (const item of value as Array<unknown>) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const body: JSONObject = item as JSONObject;
    const ruleId: unknown = body["ruleId"];
    const libraryRuleId: unknown = body["libraryRuleId"];
    const name: unknown = body["name"];
    const addedAt: Date | null = readDate(body["addedAt"]);
    const entry: DetectionRuleLibraryEntry | undefined =
      typeof libraryRuleId === "string"
        ? getDetectionRuleLibraryEntry(libraryRuleId)
        : undefined;

    if (
      typeof ruleId !== "string" ||
      !ruleId ||
      !entry ||
      !isRecommendedDetectionRule(entry) ||
      !addedAt
    ) {
      continue;
    }

    added.push({
      ruleId,
      libraryRuleId: entry.id,
      name: typeof name === "string" && name.trim() ? name : entry.title,
      addedAt: addedAt.toISOString(),
    });
  }

  return added;
}

/*
 * The Dashboard's read of the recommended rules not added: the ids of
 * recommended rules it knows, each once, in the library's order - an id a
 * newer server knows and this Dashboard does not is left out.
 */
export function readRecommendedRulesNotAdded(
  value: JSONValue | undefined,
): Array<DetectionRuleLibraryEntry> {
  if (!Array.isArray(value)) {
    return [];
  }

  const ids: Set<string> = new Set(
    (value as Array<unknown>).filter((id: unknown): id is string => {
      return typeof id === "string";
    }),
  );

  return getRecommendedDetectionRules().filter(
    (entry: DetectionRuleLibraryEntry): boolean => {
      return ids.has(entry.id);
    },
  );
}
