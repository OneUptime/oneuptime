import RuleCriteriaMatcher from "../../Rules/RuleCriteriaMatcher";
import RulePatternMatchUtil from "../../Rules/RulePatternMatchUtil";
import ScanTargetUtil from "../../NetworkDiscovery/ScanTargetUtil";
import { getStoppedPatternQuestions } from "../../LinearRegExp/PatternWork";
import {
  RuleCriteriaFilter,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import { readMacAddressDigits } from "./NamePattern";

/*
 * WHICH DEVICES A NAMING RULE NAMES (OneUptime issue #6619).
 *
 * A rule's conditions are the product's own rule conditions - the builder
 * every network rule uses, "All network devices" or "Only network devices
 * that match conditions" - on five things about a device:
 *
 *   IP Address       is in a range: a CIDR (10.48.145.0/24) or octet ranges
 *                    (10.0-255.0-255.150-159), where "*" is any number
 *                    (10.*.*.51), the auto-import rules' syntax;
 *   Discovered Name  the name discovery found;
 *   MAC Address      in any spelling (00:05:0b..., 00-05-0B..., 00050b...);
 *   Vendor           who made it;
 *   Site             its site or any site above it, so a rule for a region
 *                    names the devices of every store in it.
 *
 * A rule with no conditions names every device. The conditions are combined
 * by RuleCriteriaMatcher.matchesSync, like every rule kind's, and each one is
 * answered here - as the site assignment and auto import rules' matchers do,
 * because an address range is a syntax of its own, not text a regular
 * expression may be made of. A rule written to its columns through the API
 * matches by the same answers. Text is compared without case, and a pattern
 * is a regular expression or a "*" wildcard (RulePatternMatchUtil), as in
 * label and owner rules.
 *
 * Pure, so the server's engine (NetworkDeviceNamingRuleEngineService) and
 * every test read one matcher.
 */

/*
 * What is known about a device when it is named. Every field is optional,
 * and read defensively: these come out of scan results, discovered devices
 * and device rows.
 */
export interface DeviceNamingFacts {
  ipAddress?: string | undefined;
  macAddress?: string | undefined;
  vendor?: string | undefined;
  // The name discovery found: what the device is called without the rules.
  discoveredName?: string | undefined;
  siteId?: string | undefined;
  // The site and every site above it, for the Site condition.
  siteIds?: Array<string> | undefined;
  siteName?: string | undefined;
  siteCode?: string | undefined;
}

// The rule columns matching reads. NetworkDeviceNamingRule rows satisfy this.
export interface NamingRuleConditionColumns {
  criteria?: unknown;
  ipMatchTarget?: string | null | undefined;
  discoveredNamePattern?: string | null | undefined;
  macAddressPattern?: string | null | undefined;
  vendorPattern?: string | null | undefined;
  sites?: Array<unknown> | null | undefined;
}

/*
 * The longest text a pattern is matched against. Names and vendors are far
 * shorter; a longer one came from a payload nobody checked, and patterns run
 * on the linear-time matcher anyway.
 */
const MAX_PATTERN_SUBJECT_LENGTH: number = 500;

function clampSubject(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  return value.length > MAX_PATTERN_SUBJECT_LENGTH
    ? value.substring(0, MAX_PATTERN_SUBJECT_LENGTH)
    : value;
}

/*
 * An IP condition as ScanTargetUtil reads it: each "*" octet is 0-255, so
 * "10.*.*.51" is "10.0-255.0-255.51". A CIDR is left as written.
 */
export function normalizeNamingAddressRange(value: string): string {
  const trimmed: string = value.trim();

  if (trimmed.includes("/")) {
    return trimmed;
  }

  return trimmed
    .split(".")
    .map((octet: string): string => {
      return octet.trim() === "*" ? "0-255" : octet.trim();
    })
    .join(".");
}

// True when the value is an IP condition a naming rule can match with.
export function isValidNamingAddressRange(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    ScanTargetUtil.isValid(normalizeNamingAddressRange(value))
  );
}

export function addressIsInNamingRange(
  address: string | undefined,
  range: string,
): boolean {
  if (!address) {
    return false;
  }

  return ScanTargetUtil.contains(normalizeNamingAddressRange(range), address);
}

/*
 * Every spelling of a MAC a condition may be written against: with colons,
 * with dashes, Cisco's dotted groups and bare digits, all lower case. A
 * condition matches when it matches any of them; a negated one, when it
 * matches none.
 */
export function getMacAddressSpellings(value: string | undefined): Array<string> {
  const digits: string | null = readMacAddressDigits(value);

  if (!digits) {
    return [];
  }

  const lower: string = digits.toLowerCase();
  const pairs: Array<string> = [];

  for (let index: number = 0; index < lower.length; index += 2) {
    pairs.push(lower.substring(index, index + 2));
  }

  return [
    pairs.join(":"),
    pairs.join("-"),
    `${lower.substring(0, 4)}.${lower.substring(4, 8)}.${lower.substring(8)}`,
    lower,
  ];
}

// The ids of a relation column: model rows, id stubs or plain ids.
function readRelationIds(values: Array<unknown>): Array<string> {
  const ids: Array<string> = [];

  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      ids.push(value.trim());
      continue;
    }

    if (!value || typeof value !== "object") {
      continue;
    }

    const record: Record<string, unknown> = value as Record<string, unknown>;

    for (const key of ["_id", "id"]) {
      const candidate: unknown = record[key];

      if (typeof candidate === "string" && candidate.trim()) {
        ids.push(candidate.trim());
        break;
      }

      if (
        candidate &&
        typeof (candidate as { toString?: () => string }).toString ===
          "function"
      ) {
        const text: string = String(candidate);

        if (text && text !== "[object Object]") {
          ids.push(text);
          break;
        }
      }
    }
  }

  return ids;
}

/*
 * The rule's columns against the device, for a rule an API client wrote
 * without conditions: every column that is set must match - an address
 * range, a pattern for each text column, any one of the sites - and a rule
 * with none set matches every device.
 */
function matchesColumns(
  rule: NamingRuleConditionColumns,
  facts: DeviceNamingFacts,
): boolean {
  const ipMatchTarget: string = (rule.ipMatchTarget || "").trim();

  if (ipMatchTarget && !addressIsInNamingRange(facts.ipAddress, ipMatchTarget)) {
    return false;
  }

  const discoveredNamePattern: string = (
    rule.discoveredNamePattern || ""
  ).trim();

  if (
    discoveredNamePattern &&
    !RulePatternMatchUtil.matches(
      clampSubject(facts.discoveredName),
      discoveredNamePattern,
    )
  ) {
    return false;
  }

  const macAddressPattern: string = (rule.macAddressPattern || "").trim();

  if (macAddressPattern) {
    const spellings: Array<string> = getMacAddressSpellings(facts.macAddress);
    const matchesAny: boolean = spellings.some((spelling: string): boolean => {
      return RulePatternMatchUtil.matches(spelling, macAddressPattern);
    });

    if (!matchesAny) {
      return false;
    }
  }

  const vendorPattern: string = (rule.vendorPattern || "").trim();

  if (
    vendorPattern &&
    !RulePatternMatchUtil.matches(clampSubject(facts.vendor), vendorPattern)
  ) {
    return false;
  }

  const siteIds: Array<string> = Array.isArray(rule.sites)
    ? readRelationIds(rule.sites)
    : [];

  if (siteIds.length > 0) {
    const deviceSiteIds: Array<string> = facts.siteIds?.length
      ? facts.siteIds
      : facts.siteId
        ? [facts.siteId]
        : [];

    if (
      !siteIds.some((siteId: string): boolean => {
        return deviceSiteIds.includes(siteId);
      })
    ) {
      return false;
    }
  }

  return true;
}

/*
 * A text condition over the values a device has for its field - one name, or
 * every spelling of its MAC. A positive operator holds when any value
 * satisfies it; a negated one when none does ("does not contain 00-05-0b"
 * is false for a MAC that contains it in any spelling). Compared without
 * case, as every rule kind compares text.
 */
function matchesTextCondition(data: {
  values: Array<string>;
  operator: RuleCriteriaOperator;
  expected: string;
  matchesPattern: (value: string, pattern: string) => boolean;
}): boolean {
  const expectedLower: string = data.expected.toLocaleLowerCase();
  const anyValue: (test: (value: string) => boolean) => boolean = (
    test: (value: string) => boolean,
  ): boolean => {
    return data.values.some((value: string): boolean => {
      return test(value);
    });
  };

  switch (data.operator) {
    case RuleCriteriaOperator.Equals:
      return anyValue((value: string): boolean => {
        return value.toLocaleLowerCase() === expectedLower;
      });
    case RuleCriteriaOperator.NotEquals:
      return !anyValue((value: string): boolean => {
        return value.toLocaleLowerCase() === expectedLower;
      });
    case RuleCriteriaOperator.Contains:
      return anyValue((value: string): boolean => {
        return value.toLocaleLowerCase().includes(expectedLower);
      });
    case RuleCriteriaOperator.DoesNotContain:
      return !anyValue((value: string): boolean => {
        return value.toLocaleLowerCase().includes(expectedLower);
      });
    case RuleCriteriaOperator.StartsWith:
      return anyValue((value: string): boolean => {
        return value.toLocaleLowerCase().startsWith(expectedLower);
      });
    case RuleCriteriaOperator.EndsWith:
      return anyValue((value: string): boolean => {
        return value.toLocaleLowerCase().endsWith(expectedLower);
      });
    case RuleCriteriaOperator.MatchesPattern:
      return anyValue((value: string): boolean => {
        return data.matchesPattern(value, data.expected);
      });
    case RuleCriteriaOperator.DoesNotMatchPattern: {
      const stoppedBefore: number = getStoppedPatternQuestions();
      const matches: boolean = anyValue((value: string): boolean => {
        return data.matchesPattern(value, data.expected);
      });

      /*
       * A pattern question with no answer - it needed more work than the
       * evaluation may take (LinearRegExp/PatternWork.ts) - may have
       * matched: "matches none" is not known, so the condition does not
       * hold.
       */
      if (!matches && getStoppedPatternQuestions() > stoppedBefore) {
        return false;
      }

      return !matches;
    }
    default:
      return false;
  }
}

// One value, as the list of values a text condition reads.
function asValues(value: string | undefined): Array<string> {
  const clamped: string | undefined = clampSubject(value);
  return clamped ? [clamped] : [];
}

function matchesSiteCondition(
  filter: RuleCriteriaFilter,
  facts: DeviceNamingFacts,
): boolean {
  const wanted: Array<string> = Array.isArray(filter.value)
    ? readRelationIds(filter.value)
    : [];
  const deviceSiteIds: Array<string> = facts.siteIds?.length
    ? facts.siteIds
    : facts.siteId
      ? [facts.siteId]
      : [];

  switch (filter.operator) {
    case RuleCriteriaOperator.HasAnyOf:
      return wanted.some((siteId: string): boolean => {
        return deviceSiteIds.includes(siteId);
      });
    case RuleCriteriaOperator.HasAllOf:
      return (
        wanted.length > 0 &&
        wanted.every((siteId: string): boolean => {
          return deviceSiteIds.includes(siteId);
        })
      );
    case RuleCriteriaOperator.HasNoneOf:
      return !wanted.some((siteId: string): boolean => {
        return deviceSiteIds.includes(siteId);
      });
    default:
      return false;
  }
}

/*
 * One condition of a rule saved with conditions. The IP field takes only
 * "is in" and "is not in" (an address range is its own syntax, not text),
 * the site field only the list operators, the rest every text operator.
 */
function matchesConfiguredFilter(
  filter: RuleCriteriaFilter,
  facts: DeviceNamingFacts,
): boolean {
  const expected: string = Array.isArray(filter.value)
    ? ""
    : String(filter.value);

  switch (filter.field) {
    case "ipMatchTarget": {
      const isIn: boolean = addressIsInNamingRange(facts.ipAddress, expected);

      if (filter.operator === RuleCriteriaOperator.MatchesPattern) {
        return isIn;
      }

      if (filter.operator === RuleCriteriaOperator.DoesNotMatchPattern) {
        return !isIn;
      }

      return false;
    }
    case "discoveredNamePattern":
      return matchesTextCondition({
        values: asValues(facts.discoveredName),
        operator: filter.operator,
        expected: expected,
        matchesPattern: RulePatternMatchUtil.matches,
      });
    case "macAddressPattern":
      return matchesTextCondition({
        values: getMacAddressSpellings(facts.macAddress),
        operator: filter.operator,
        expected: expected,
        matchesPattern: RulePatternMatchUtil.matches,
      });
    case "vendorPattern":
      return matchesTextCondition({
        values: asValues(facts.vendor),
        operator: filter.operator,
        expected: expected,
        matchesPattern: RulePatternMatchUtil.matches,
      });
    case "sites":
      return matchesSiteCondition(filter, facts);
    default:
      return false;
  }
}

export class NamingRuleMatcher {
  /*
   * True when the rule's conditions match the device: its conditions when
   * it was saved with them, else its columns, as an API client may write
   * them. Conditions win - a rule saved from the form keeps no meaning in a
   * column it left behind.
   */
  public static ruleMatches(
    rule: NamingRuleConditionColumns,
    facts: DeviceNamingFacts,
  ): boolean {
    if (rule.criteria !== undefined && rule.criteria !== null) {
      return RuleCriteriaMatcher.matchesSync({
        criteria: rule.criteria,
        emptyResult: true,
        matchesFilter: (filter: RuleCriteriaFilter): boolean => {
          return matchesConfiguredFilter(filter, facts);
        },
      });
    }

    return matchesColumns(rule, facts);
  }
}

export default NamingRuleMatcher;
