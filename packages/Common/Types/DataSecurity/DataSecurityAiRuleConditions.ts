import SecuritySeverity from "../SecuritySeverity";
import { ALL_DATA_CATEGORIES } from "./DataCategory";
import {
  ALL_DATA_SECURITY_CHECK_GROUPS,
  DATA_SECURITY_CHECKS,
  DataSecurityCheckInfo,
} from "./DataSecurityCheckCatalog";
import { ALL_DATA_SENSITIVITIES } from "./DataSensitivity";
import { ALL_DATA_STORE_ENVIRONMENTS } from "./DataStoreEnvironment";
import { DataStoreKind } from "./DataStoreKind";

/*
 * WHAT A DATA SECURITY AI RULE'S CONDITIONS MAY HOLD (#10364).
 *
 * A Data Security AI rule's conditions that name a fixed set of values -
 * the checks, their groups, the severities, the stores' sensitivities,
 * kinds and environments, the data categories - are lists of those values,
 * as the catalogs spell them. One that names a value nobody can have (a
 * check that does not exist, "Severe") would make a rule that silently
 * never matches, and since rules narrow what OneUptime AI works on, that
 * would quietly stop it: such a write is refused, with what the list may
 * hold. A provider is the store's own word (aws, azure, gcp, self-managed,
 * oneuptime), held only to a list of short texts.
 *
 * Pure, so the rule form says what the service will refuse.
 */

// The most values one condition list may hold.
export const MAX_DATA_SECURITY_AI_RULE_CONDITION_VALUES: number = 100;

// The longest value of a list of free words (a provider).
export const MAX_DATA_SECURITY_AI_RULE_CONDITION_VALUE_LENGTH: number = 100;

interface ConditionList {
  title: string;
  // The values it may hold, as the catalogs spell them; null for free words.
  values: ReadonlyArray<string> | null;
  // What a refusal says it may hold, where the values are too many to list.
  holds?: string | undefined;
}

export const DATA_SECURITY_AI_RULE_CONDITION_LISTS: Readonly<
  Record<string, ConditionList>
> = {
  dataSecurityChecks: {
    title: "Data Security Checks",
    values: DATA_SECURITY_CHECKS.map((check: DataSecurityCheckInfo): string => {
      return check.id;
    }),
    holds: "the ids of Data Security's checks",
  },
  dataSecurityCheckGroups: {
    title: "Data Security Check Groups",
    values: ALL_DATA_SECURITY_CHECK_GROUPS,
  },
  dataSecuritySeverities: {
    title: "Data Security Severities",
    values: Object.values(SecuritySeverity),
  },
  dataStoreSensitivities: {
    title: "Data Store Sensitivities",
    values: ALL_DATA_SENSITIVITIES,
  },
  dataStoreKinds: {
    title: "Data Store Kinds",
    values: Object.values(DataStoreKind),
    holds: "the kinds of store Data Security finds",
  },
  dataStoreProviders: {
    title: "Data Store Providers",
    values: null,
  },
  dataStoreEnvironments: {
    title: "Data Store Environments",
    values: ALL_DATA_STORE_ENVIRONMENTS,
  },
  dataCategories: {
    title: "Data Categories",
    values: ALL_DATA_CATEGORIES,
  },
};

export const DATA_SECURITY_AI_RULE_CONDITION_LIST_FIELDS: ReadonlyArray<string> =
  Object.keys(DATA_SECURITY_AI_RULE_CONDITION_LISTS);

/*
 * Why one condition list cannot be saved as written, or null when it can.
 * Nothing (undefined or null) and an empty list are no condition at all.
 */
export function getDataSecurityAiRuleConditionListProblem(
  field: string,
  value: unknown,
): string | null {
  const list: ConditionList | undefined =
    DATA_SECURITY_AI_RULE_CONDITION_LISTS[field];

  if (!list || value === undefined || value === null) {
    return null;
  }

  if (!Array.isArray(value)) {
    return `${list.title} must be a list.`;
  }

  if (value.length > MAX_DATA_SECURITY_AI_RULE_CONDITION_VALUES) {
    return `${list.title} can hold at most ${MAX_DATA_SECURITY_AI_RULE_CONDITION_VALUES} values.`;
  }

  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0) {
      return `${list.title} must be a list of names.`;
    }

    if (!list.values) {
      if (item.length > MAX_DATA_SECURITY_AI_RULE_CONDITION_VALUE_LENGTH) {
        return `Each of ${list.title} can be at most ${MAX_DATA_SECURITY_AI_RULE_CONDITION_VALUE_LENGTH} characters.`;
      }

      continue;
    }

    if (!list.values.includes(item)) {
      return `${list.title} can only hold ${list.holds || joinWithOr(list.values)}; "${item.slice(
        0,
        MAX_DATA_SECURITY_AI_RULE_CONDITION_VALUE_LENGTH,
      )}" is not one of them.`;
    }
  }

  return null;
}

// Why any of a write's condition lists cannot be saved, or null.
export function getDataSecurityAiRuleConditionsProblem(
  values: Readonly<Record<string, unknown>>,
): string | null {
  for (const field of DATA_SECURITY_AI_RULE_CONDITION_LIST_FIELDS) {
    const problem: string | null = getDataSecurityAiRuleConditionListProblem(
      field,
      values[field],
    );

    if (problem) {
      return problem;
    }
  }

  return null;
}

// "a or b", and "a, b or c" once there are more than two.
function joinWithOr(items: ReadonlyArray<string>): string {
  if (items.length <= 2) {
    return items.join(" or ");
  }

  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}
