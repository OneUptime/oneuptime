import { JSONObject, JSONValue } from "../../Types/JSON";
import SloWindowType from "../../Types/ServiceLevelObjective/SloWindowType";
import { DEFAULT_ROLLING_WINDOW_DAYS } from "./SloHealth";

/*
 * THE BURN RATE RULES ONEUPTIME RECOMMENDS FOR AN SLO.
 *
 * The three tiers of the Google SRE Workbook's multi-window, multi-burn-rate
 * alerting (chapter 5, "Alerting on SLOs"), each a share of the error budget
 * spent within a look-back window:
 *
 *   Fast burn   2% of the budget in 1 hour, confirmed over 5 minutes   (page)
 *   Slow burn   5% of the budget in 6 hours, confirmed over 30 minutes (page)
 *   Slow leak  10% of the budget in 3 days, confirmed over 6 hours  (ticket)
 *
 * A rule's threshold is the burn rate that spends that share in its long
 * window: threshold = share x windowHours / longWindowHours. A 30-day window
 * gives the Workbook's own 14.4x, 6x and 1x; any other window stays
 * calibrated to the same share.
 *
 * Slow leak is the one that needs more than the formula. Kept at 3 days on a
 * window shorter than 30 days, its threshold falls below 1x (0.93x at 28
 * days, 0.23x at 7) - and a rule below 1x fires on an SLO that is on track to
 * meet its objective, which is noise. So its long window is a tenth of the
 * compliance window, capped at 3 days: on a window shorter than 30 days the
 * threshold stays at exactly 1x (16.8 hours at 7 days, 2.8 days at 28), and
 * from 30 days up it keeps the Workbook's 3 days, so its threshold grows with
 * the window (3x at 90 days). The short window keeps the Workbook's 12:1.
 * Both are whole minutes for every window an SLO can have (144 and 12
 * minutes per day of window below 30 days), as the integer columns require.
 *
 * Slow leak is a ticket, not a page: it raises its alert at the project's
 * least severe alert severity (Fast burn and Slow burn use the most severe),
 * and like the other two it declares no incident - every rule OneUptime adds
 * leaves the output flags at their defaults (alert on, incident off), so an
 * upgrade never starts declaring incidents. And it waits 24 hours, rather
 * than its 3-day long window, before it raises another alert after one
 * resolves (SLO_SLOW_LEAK_REFIRE_SUPPRESSION_MINUTES says why).
 *
 * New SLOs are created with all three (ServiceLevelObjectiveService). An SLO
 * that is missing any of them - one created before Slow leak existed, or one
 * whose rule somebody deleted - is offered the missing ones by "Add
 * recommended rules" on its Burn Rate Rules page
 * (ServiceLevelObjectiveBurnRateRuleService.addMissingRecommendedRules); what
 * counts as missing is getMissingSloRecommendedBurnRateRules.
 *
 * Pure, so the server that adds the rules, the Dashboard that describes them,
 * the AI toolbox that reports them and the docs tests all read one source.
 */

export const SLO_FAST_BURN_RULE_NAME: string = "Fast burn";
export const SLO_SLOW_BURN_RULE_NAME: string = "Slow burn";
export const SLO_SLOW_LEAK_RULE_NAME: string = "Slow leak";

/*
 * Which of the project's alert severities a recommended rule raises its alert
 * at. "Most severe" is the lowest order, the default OneUptime has always
 * picked; "least severe" is the highest.
 */
export enum SloRecommendedAlertSeverity {
  MostSevere = "MostSevere",
  LeastSevere = "LeastSevere",
}

export interface SloRecommendedBurnRateRule {
  name: string;
  // The share of the error budget the rule's long window stands for: 2, 5 or 10.
  budgetPercentage: number;
  burnRateThreshold: number;
  longWindowInMinutes: number;
  shortWindowInMinutes: number;
  /*
   * Minutes after an alert resolves before the rule may raise another. Null
   * leaves the column empty, which the worker reads as one long window - what
   * Fast burn and Slow burn have always had.
   */
  refireSuppressionMinutes: number | null;
  alertSeverity: SloRecommendedAlertSeverity;
}

// The SLO columns the recommended rules are scaled from.
export interface SloRecommendedBurnRateRulesWindow {
  windowType?: SloWindowType | string | undefined | null;
  windowDays?: number | string | undefined | null;
}

/*
 * The hours the error budget is spread over. A calendar month is budgeted as
 * 30 days, as it always was for the default rules: the seeded thresholds do
 * not move from month to month. A rolling window with no length is measured
 * as 30 days (EvaluateSlos), so it is scaled as 30 days too.
 */
export const SLO_CALENDAR_MONTH_WINDOW_HOURS: number = 720;

export const SLO_FAST_BURN_BUDGET_PERCENTAGE: number = 2;
export const SLO_FAST_BURN_LONG_WINDOW_MINUTES: number = 60;
export const SLO_FAST_BURN_SHORT_WINDOW_MINUTES: number = 5;

export const SLO_SLOW_BURN_BUDGET_PERCENTAGE: number = 5;
export const SLO_SLOW_BURN_LONG_WINDOW_MINUTES: number = 360;
export const SLO_SLOW_BURN_SHORT_WINDOW_MINUTES: number = 30;

export const SLO_SLOW_LEAK_BUDGET_PERCENTAGE: number = 10;

// The Workbook's 3 days: Slow leak's long window on a window of 30 days or more.
export const SLO_SLOW_LEAK_MAX_LONG_WINDOW_MINUTES: number = 3 * 24 * 60;

// Below 30 days: a tenth of the compliance window, so the threshold stays at 1x.
export const SLO_SLOW_LEAK_LONG_WINDOW_SHARE_OF_COMPLIANCE_WINDOW: number = 0.1;

// The Workbook's long-to-short ratio, for every one of its tiers (1h/5m, 6h/30m, 3d/6h).
export const SLO_LONG_TO_SHORT_WINDOW_RATIO: number = 12;

/*
 * 24 hours: at most one Slow leak alert a day for an SLO, the pace a ticket
 * queue is worked at.
 *
 * The column's default, one long window, would be 3 days here: after a leak's
 * alert resolved, a leak that resumed the next day would go unreported for
 * two more days, while another tenth of the budget drained - the very case
 * the rule exists for. Shorter than a day and a burn hovering around 1x,
 * whose 3-day average crosses the threshold back and forth, would open a new
 * ticket every time it crossed.
 *
 * On a compliance window under 10 days the long window is shorter than a
 * day; there the rule waits one long window, as the other rules do, so a
 * 1-day SLO is not left without a ticket for a whole window after one.
 */
export const SLO_SLOW_LEAK_REFIRE_SUPPRESSION_MINUTES: number = 24 * 60;

type RoundToTwoDecimalsFunction = (value: number) => number;

// The precision the seeded thresholds have always been stored with.
const roundToTwoDecimals: RoundToTwoDecimalsFunction = (
  value: number,
): number => {
  return Math.round(value * 100) / 100;
};

type ToPositiveNumberFunction = (value: unknown) => number | null;

const toPositiveNumber: ToPositiveNumberFunction = (
  value: unknown,
): number | null => {
  const numeric: number =
    typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : typeof value === "number"
        ? value
        : Number.NaN;

  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
};

export type GetSloComplianceWindowHoursFunction = (
  window: SloRecommendedBurnRateRulesWindow,
) => number;

export const getSloComplianceWindowHours: GetSloComplianceWindowHoursFunction =
  (window: SloRecommendedBurnRateRulesWindow): number => {
    if (window.windowType === SloWindowType.CalendarMonth) {
      return SLO_CALENDAR_MONTH_WINDOW_HOURS;
    }

    return (
      (toPositiveNumber(window.windowDays) ?? DEFAULT_ROLLING_WINDOW_DAYS) * 24
    );
  };

type GetThresholdFunction = (data: {
  budgetPercentage: number;
  windowHours: number;
  longWindowInMinutes: number;
}) => number;

// The burn rate that spends the share of the budget within the long window.
const getThreshold: GetThresholdFunction = (data: {
  budgetPercentage: number;
  windowHours: number;
  longWindowInMinutes: number;
}): number => {
  return roundToTwoDecimals(
    ((data.budgetPercentage / 100) * data.windowHours) /
      (data.longWindowInMinutes / 60),
  );
};

export type GetSloSlowLeakLongWindowInMinutesFunction = (
  window: SloRecommendedBurnRateRulesWindow,
) => number;

// A tenth of the compliance window, capped at the Workbook's 3 days.
export const getSloSlowLeakLongWindowInMinutes: GetSloSlowLeakLongWindowInMinutesFunction =
  (window: SloRecommendedBurnRateRulesWindow): number => {
    const windowHours: number = getSloComplianceWindowHours(window);

    return Math.min(
      SLO_SLOW_LEAK_MAX_LONG_WINDOW_MINUTES,
      Math.round(
        windowHours * 60 * SLO_SLOW_LEAK_LONG_WINDOW_SHARE_OF_COMPLIANCE_WINDOW,
      ),
    );
  };

export type GetSloRecommendedBurnRateRulesFunction = (
  window: SloRecommendedBurnRateRulesWindow,
) => Array<SloRecommendedBurnRateRule>;

/*
 * The three rules, scaled to the SLO's window, in the order they are created
 * and listed: fastest burn first.
 */
export const getSloRecommendedBurnRateRules: GetSloRecommendedBurnRateRulesFunction =
  (
    window: SloRecommendedBurnRateRulesWindow,
  ): Array<SloRecommendedBurnRateRule> => {
    const windowHours: number = getSloComplianceWindowHours(window);

    const slowLeakLongWindowInMinutes: number =
      getSloSlowLeakLongWindowInMinutes(window);

    return [
      {
        name: SLO_FAST_BURN_RULE_NAME,
        budgetPercentage: SLO_FAST_BURN_BUDGET_PERCENTAGE,
        burnRateThreshold: getThreshold({
          budgetPercentage: SLO_FAST_BURN_BUDGET_PERCENTAGE,
          windowHours: windowHours,
          longWindowInMinutes: SLO_FAST_BURN_LONG_WINDOW_MINUTES,
        }),
        longWindowInMinutes: SLO_FAST_BURN_LONG_WINDOW_MINUTES,
        shortWindowInMinutes: SLO_FAST_BURN_SHORT_WINDOW_MINUTES,
        refireSuppressionMinutes: null,
        alertSeverity: SloRecommendedAlertSeverity.MostSevere,
      },
      {
        name: SLO_SLOW_BURN_RULE_NAME,
        budgetPercentage: SLO_SLOW_BURN_BUDGET_PERCENTAGE,
        burnRateThreshold: getThreshold({
          budgetPercentage: SLO_SLOW_BURN_BUDGET_PERCENTAGE,
          windowHours: windowHours,
          longWindowInMinutes: SLO_SLOW_BURN_LONG_WINDOW_MINUTES,
        }),
        longWindowInMinutes: SLO_SLOW_BURN_LONG_WINDOW_MINUTES,
        shortWindowInMinutes: SLO_SLOW_BURN_SHORT_WINDOW_MINUTES,
        refireSuppressionMinutes: null,
        alertSeverity: SloRecommendedAlertSeverity.MostSevere,
      },
      {
        name: SLO_SLOW_LEAK_RULE_NAME,
        budgetPercentage: SLO_SLOW_LEAK_BUDGET_PERCENTAGE,
        burnRateThreshold: getThreshold({
          budgetPercentage: SLO_SLOW_LEAK_BUDGET_PERCENTAGE,
          windowHours: windowHours,
          longWindowInMinutes: slowLeakLongWindowInMinutes,
        }),
        longWindowInMinutes: slowLeakLongWindowInMinutes,
        shortWindowInMinutes: Math.round(
          slowLeakLongWindowInMinutes / SLO_LONG_TO_SHORT_WINDOW_RATIO,
        ),
        refireSuppressionMinutes: Math.min(
          SLO_SLOW_LEAK_REFIRE_SUPPRESSION_MINUTES,
          slowLeakLongWindowInMinutes,
        ),
        alertSeverity: SloRecommendedAlertSeverity.LeastSevere,
      },
    ];
  };

// What an existing rule is compared by.
export interface SloExistingBurnRateRule {
  name?: string | undefined | null;
  longWindowInMinutes?: number | string | undefined | null;
}

type NormalizeNameFunction = (name: string | undefined | null) => string;

const normalizeName: NormalizeNameFunction = (
  name: string | undefined | null,
): string => {
  return typeof name === "string" ? name.trim().toLowerCase() : "";
};

export type IsSloRecommendedBurnRateRulePresentFunction = (data: {
  recommended: SloRecommendedBurnRateRule;
  existingRules: ReadonlyArray<SloExistingBurnRateRule>;
}) => boolean;

/*
 * Whether the SLO already has this recommended rule: a rule of the same name,
 * whatever its numbers, or a rule over the same long window, whatever its
 * name. Enabled or not - a rule somebody switched off was switched off on
 * purpose.
 *
 * Either one is enough, so the rules people have made their own are never
 * added a second time: a default rule renamed ("Page: fast burn") keeps its
 * window, one whose threshold or windows were tuned keeps its name, and a
 * rule written by hand over the same window ("Ticket", 3 days at 1x) already
 * covers that tier. Only a rule that was both renamed and moved to another
 * window - or deleted - reads as missing, and adding the recommended one back
 * is what the confirmation asks about.
 */
export const isSloRecommendedBurnRateRulePresent: IsSloRecommendedBurnRateRulePresentFunction =
  (data: {
    recommended: SloRecommendedBurnRateRule;
    existingRules: ReadonlyArray<SloExistingBurnRateRule>;
  }): boolean => {
    const recommendedName: string = normalizeName(data.recommended.name);

    return data.existingRules.some(
      (existing: SloExistingBurnRateRule): boolean => {
        if (
          recommendedName &&
          normalizeName(existing.name) === recommendedName
        ) {
          return true;
        }

        return (
          toPositiveNumber(existing.longWindowInMinutes) ===
          data.recommended.longWindowInMinutes
        );
      },
    );
  };

export type GetMissingSloRecommendedBurnRateRulesFunction = (data: {
  window: SloRecommendedBurnRateRulesWindow;
  existingRules: ReadonlyArray<SloExistingBurnRateRule>;
}) => Array<SloRecommendedBurnRateRule>;

// The recommended rules the SLO does not have yet, scaled to its window.
export const getMissingSloRecommendedBurnRateRules: GetMissingSloRecommendedBurnRateRulesFunction =
  (data: {
    window: SloRecommendedBurnRateRulesWindow;
    existingRules: ReadonlyArray<SloExistingBurnRateRule>;
  }): Array<SloRecommendedBurnRateRule> => {
    return getSloRecommendedBurnRateRules(data.window).filter(
      (recommended: SloRecommendedBurnRateRule): boolean => {
        return !isSloRecommendedBurnRateRulePresent({
          recommended: recommended,
          existingRules: data.existingRules,
        });
      },
    );
  };

// An alert severity as the choice below reads it.
export interface SloAlertSeverityCandidate {
  order?: number | undefined | null;
}

export interface SloRecommendedAlertSeverities<T> {
  mostSevere: T | null;
  leastSevere: T | null;
}

/*
 * The project's most and least severe alert severities, from its severities
 * that are not archived - a default OneUptime picks itself is never archived.
 *
 * Most severe is the lowest order, exactly the row the old "sort by order,
 * take the first" lookup gave, so Fast burn and Slow burn keep the severity
 * they always had. Least severe is the HIGHEST order among the severities
 * that have one: a severity with no order has no place on the scale, and
 * reading it as the least severe would be a guess. With no ordered severity
 * at all, both are the most severe one, so nothing is guessed either way.
 */
export function pickSloRecommendedAlertSeverities<
  T extends SloAlertSeverityCandidate,
>(severities: ReadonlyArray<T>): SloRecommendedAlertSeverities<T> {
  const orderOf: (severity: T) => number | null = (
    severity: T,
  ): number | null => {
    return typeof severity.order === "number" &&
      Number.isFinite(severity.order)
      ? severity.order
      : null;
  };

  // Ordered first, by order; the unordered after them, as Postgres sorts NULLs.
  const sorted: Array<T> = [...severities].sort((a: T, b: T): number => {
    const orderA: number | null = orderOf(a);
    const orderB: number | null = orderOf(b);

    if (orderA === null && orderB === null) {
      return 0;
    }

    if (orderA === null) {
      return 1;
    }

    if (orderB === null) {
      return -1;
    }

    return orderA - orderB;
  });

  const mostSevere: T | null = sorted[0] ?? null;

  const ordered: Array<T> = sorted.filter((severity: T): boolean => {
    return orderOf(severity) !== null;
  });

  return {
    mostSevere: mostSevere,
    leastSevere: ordered[ordered.length - 1] ?? mostSevere,
  };
}

/*
 * ---------------------------------------------------------------------------
 * What "Add recommended rules" is told, as JSON
 * ---------------------------------------------------------------------------
 */

// A recommended rule as the API sends it: the rule, and the severity it raises at.
export interface SloRecommendedBurnRateRuleToAdd
  extends SloRecommendedBurnRateRule {
  // The severity's name, or null when the project has no alert severity.
  alertSeverityName: string | null;
  // Set on a rule the request just created.
  id?: string | undefined;
}

export type SloRecommendedBurnRateRuleToJSONFunction = (
  rule: SloRecommendedBurnRateRuleToAdd,
) => JSONObject;

export const sloRecommendedBurnRateRuleToJSON: SloRecommendedBurnRateRuleToJSONFunction =
  (rule: SloRecommendedBurnRateRuleToAdd): JSONObject => {
    const json: JSONObject = {
      name: rule.name,
      budgetPercentage: rule.budgetPercentage,
      burnRateThreshold: rule.burnRateThreshold,
      longWindowInMinutes: rule.longWindowInMinutes,
      shortWindowInMinutes: rule.shortWindowInMinutes,
      refireSuppressionMinutes: rule.refireSuppressionMinutes,
      alertSeverity: rule.alertSeverity,
      alertSeverityName: rule.alertSeverityName,
    };

    if (rule.id) {
      json["id"] = rule.id;
    }

    return json;
  };

type ReadNumberFunction = (value: JSONValue | undefined) => number | null;

const readNumber: ReadNumberFunction = (
  value: JSONValue | undefined,
): number | null => {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

export type ParseSloRecommendedBurnRateRulesFunction = (
  value: JSONValue | undefined,
) => Array<SloRecommendedBurnRateRuleToAdd>;

/*
 * The rules of a response, read defensively: an entry without a name, a
 * threshold or windows is left out rather than drawn as a rule that says
 * nothing, and anything that is not a list reads as none.
 */
export const parseSloRecommendedBurnRateRules: ParseSloRecommendedBurnRateRulesFunction =
  (value: JSONValue | undefined): Array<SloRecommendedBurnRateRuleToAdd> => {
    if (!Array.isArray(value)) {
      return [];
    }

    const rules: Array<SloRecommendedBurnRateRuleToAdd> = [];

    for (const entry of value) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }

      const json: JSONObject = entry as JSONObject;
      const name: JSONValue | undefined = json["name"];
      const burnRateThreshold: number | null = readNumber(
        json["burnRateThreshold"],
      );
      const longWindowInMinutes: number | null = readNumber(
        json["longWindowInMinutes"],
      );
      const shortWindowInMinutes: number | null = readNumber(
        json["shortWindowInMinutes"],
      );

      if (
        typeof name !== "string" ||
        !name.trim() ||
        burnRateThreshold === null ||
        longWindowInMinutes === null ||
        shortWindowInMinutes === null
      ) {
        continue;
      }

      const severityName: JSONValue | undefined = json["alertSeverityName"];
      const id: JSONValue | undefined = json["id"];

      const rule: SloRecommendedBurnRateRuleToAdd = {
        name: name,
        budgetPercentage: readNumber(json["budgetPercentage"]) ?? 0,
        burnRateThreshold: burnRateThreshold,
        longWindowInMinutes: longWindowInMinutes,
        shortWindowInMinutes: shortWindowInMinutes,
        refireSuppressionMinutes: readNumber(json["refireSuppressionMinutes"]),
        alertSeverity:
          json["alertSeverity"] === SloRecommendedAlertSeverity.LeastSevere
            ? SloRecommendedAlertSeverity.LeastSevere
            : SloRecommendedAlertSeverity.MostSevere,
        alertSeverityName:
          typeof severityName === "string" && severityName.trim()
            ? severityName
            : null,
      };

      if (typeof id === "string" && id) {
        rule.id = id;
      }

      rules.push(rule);
    }

    return rules;
  };
