import {
  Green500,
  Orange700,
  Red900,
  Yellow300,
} from "../../Types/BrandColors";
import Color, { RGB } from "../../Types/Color";
import { parseColor } from "../ColorContrast";

/*
 * The colours of a status page's uptime history, where every bar is one day.
 *
 * A page with no bar color rules paints a day in the colour of the most
 * severe monitor status it had, for however short a time: two minutes
 * Offline turn the whole day red, the same red as a day spent offline (issue
 * #486). A page's rules paint a day by its uptime instead, checked from the
 * top of the list down, the first rule the day's uptime reaches winning; a
 * day no rule matches takes the page's default bar colour.
 *
 * The recommended rules grade a day by how long it was down, and are what a
 * status page created in the dashboard starts with. Their colours are told
 * apart by lightness as well as by hue - light green, pale yellow, dark
 * orange, very dark red - because lightness is what people with red-green
 * colour blindness tell them apart by: the green and red the monitor
 * statuses start with are one colour to them (Utils/ColorVision). The
 * history's no-data grey is told apart by its hatching (DayUptimeGraph).
 *
 * Pure and React-free: the status page draws its bars with the same matching
 * the dashboard previews them with, and the server seeds a new page's rules
 * from the same list.
 */

// A rule's two values, as the bars are drawn from them.
export interface HistoryChartBarColorRuleValues {
  uptimePercentGreaterThanOrEqualTo: number;
  barColor: Color;
}

/*
 * A rule as it arrives: its percentage can be the decimal column's text
 * ("99.00"), its colour a Color or the hex it was typed as.
 */
export interface HistoryChartBarColorRuleInput {
  uptimePercentGreaterThanOrEqualTo?: number | string | null | undefined;
  barColor?: Color | string | null | undefined;
}

/*
 * A day's uptime, and on a full day the downtime it allows: 100% is no
 * downtime at all, 99% up to 14 minutes 24 seconds, 95% up to 72 minutes.
 */
export const RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES: ReadonlyArray<HistoryChartBarColorRuleValues> =
  [
    { uptimePercentGreaterThanOrEqualTo: 100, barColor: Green500 },
    { uptimePercentGreaterThanOrEqualTo: 99, barColor: Yellow300 },
    { uptimePercentGreaterThanOrEqualTo: 95, barColor: Orange700 },
    { uptimePercentGreaterThanOrEqualTo: 0, barColor: Red900 },
  ];

/*
 * Sent with a status page's create (`miscDataProps`) to have the page start
 * with the recommended rules. The dashboard always sends it. It is not done
 * for every create: a page made from Terraform or a script declares its own
 * rules, and rules seeded before them would sit above them and win.
 */
export const ADD_RECOMMENDED_BAR_COLOR_RULES_MISC_DATA_KEY: string =
  "addRecommendedBarColorRules";

/*
 * A day nobody measured: a fixed neutral grey that no rule and no default
 * colour reaches, drawn hatched (NO_DATA_BAR_CLASS_NAME). The grey alone is
 * as light as a green bar, and to someone with red-green colour blindness
 * that green is grey too (Utils/ColorVision), so a day nobody measured
 * looked like a good one to them; stripes are not a colour. Here rather
 * than in DayUptimeGraph so what is not React can draw a no-data swatch.
 */
export const NO_DATA_BAR_COLOR: Color = new Color("#9CA3AF");

// The hatch, drawn over that grey by DayUptimeGraph.css.
export const NO_DATA_BAR_CLASS_NAME: string = "uptime-bar-no-data";

/*
 * A day with scheduled maintenance: a blue band across the top of its bar
 * (DayUptimeGraph.css), whatever colour the day itself is drawn in. Blue is
 * what status pages use for planned work, and it is a colour none of the
 * recommended rules or monitor statuses start with, so a day of planned work
 * reads apart from an outage at a glance - in greyscale too, by where the
 * band sits. The colour is here so a legend can draw the same swatch.
 */
export const MAINTENANCE_MARK_COLOR: Color = new Color("#3B82F6");

// The band, drawn over the bar's own colour by DayUptimeGraph.css.
export const MAINTENANCE_BAR_CLASS_NAME: string = "uptime-bar-maintenance";

/*
 * A rule's percentage as a number, or null when it has none. Read the way
 * the strip has always compared it - `uptime >= threshold` - so a percentage
 * stored as text matches as the number it spells.
 */
export function getRuleUptimePercent(
  rule: HistoryChartBarColorRuleInput,
): number | null {
  const value: number | string | null | undefined =
    rule.uptimePercentGreaterThanOrEqualTo;

  if (value === null || value === undefined || value === "") {
    return null;
  }

  const percent: number = Number(value);

  return Number.isFinite(percent) ? percent : null;
}

// A rule's colour, or null when it has none that can be drawn.
export function getRuleBarColor(
  rule: HistoryChartBarColorRuleInput,
): Color | null {
  if (!rule.barColor || !parseColor(rule.barColor)) {
    return null;
  }

  return rule.barColor instanceof Color
    ? rule.barColor
    : new Color(rule.barColor);
}

/**
 * The rule that colours a day with this uptime: the first one, from the top
 * of the list, whose percentage the day reaches. Null when none does, and
 * the day takes the default bar colour. A rule without a percentage or a
 * colour never matches.
 */
export function getMatchingRuleIndex(
  rules: ReadonlyArray<HistoryChartBarColorRuleInput>,
  uptimePercent: number,
): number | null {
  for (let index: number = 0; index < rules.length; index++) {
    const rule: HistoryChartBarColorRuleInput = rules[index]!;
    const threshold: number | null = getRuleUptimePercent(rule);

    if (threshold === null || !getRuleBarColor(rule)) {
      continue;
    }

    if (uptimePercent >= threshold) {
      return index;
    }
  }

  return null;
}

/**
 * The colour the rules give a day with this uptime, or null when no rule
 * matches it.
 */
export function getBarColorForUptimePercent(
  rules: ReadonlyArray<HistoryChartBarColorRuleInput>,
  uptimePercent: number,
): Color | null {
  const index: number | null = getMatchingRuleIndex(rules, uptimePercent);

  return index === null ? null : getRuleBarColor(rules[index]!);
}

/**
 * The uptime below which a day matches no rule, and is drawn in the default
 * bar colour: the lowest percentage of any rule, when it is above 0. Null
 * when every day matches one (or there are no rules, and the monitor
 * statuses colour the days).
 */
export function getUptimePercentBelowWhichNoRuleMatches(
  rules: ReadonlyArray<HistoryChartBarColorRuleInput>,
): number | null {
  let lowest: number | null = null;

  for (const rule of rules) {
    const threshold: number | null = getRuleUptimePercent(rule);

    if (threshold === null || !getRuleBarColor(rule)) {
      continue;
    }

    if (lowest === null || threshold < lowest) {
      lowest = threshold;
    }
  }

  return lowest !== null && lowest > 0 ? lowest : null;
}

/**
 * Whether a rule can never colour a day: a rule above it already matches
 * every day it would (its percentage is the same or lower). A new rule goes
 * to the end of the list, under the recommended rules' 0% one, so it is
 * dead until it is dragged above it.
 */
export function isRuleShadowed(
  rules: ReadonlyArray<HistoryChartBarColorRuleInput>,
  index: number,
): boolean {
  const rule: HistoryChartBarColorRuleInput | undefined = rules[index];

  if (!rule) {
    return false;
  }

  const threshold: number | null = getRuleUptimePercent(rule);

  if (threshold === null || !getRuleBarColor(rule)) {
    return false;
  }

  for (let above: number = 0; above < index; above++) {
    const aboveThreshold: number | null = getRuleUptimePercent(rules[above]!);

    if (
      aboveThreshold !== null &&
      getRuleBarColor(rules[above]!) &&
      aboveThreshold <= threshold
    ) {
      return true;
    }
  }

  return false;
}

type SameColorFunction = (
  first: Color | string | null | undefined,
  second: Color | string | null | undefined,
) => boolean;

// Whether two colours are the same, however each was written.
const isSameColor: SameColorFunction = (
  first: Color | string | null | undefined,
  second: Color | string | null | undefined,
): boolean => {
  const a: RGB | null = parseColor(first);
  const b: RGB | null = parseColor(second);

  return Boolean(
    a && b && a.red === b.red && a.green === b.green && a.blue === b.blue,
  );
};

/**
 * Whether these are the recommended rules, as a page starts with them: the
 * same percentages and colours, in the same order, and nothing else.
 */
export function isRecommendedHistoryChartBarColorRuleSet(
  rules: ReadonlyArray<HistoryChartBarColorRuleInput>,
): boolean {
  if (rules.length !== RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES.length) {
    return false;
  }

  return RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES.every(
    (recommended: HistoryChartBarColorRuleValues, index: number): boolean => {
      const rule: HistoryChartBarColorRuleInput = rules[index]!;

      return (
        getRuleUptimePercent(rule) ===
          recommended.uptimePercentGreaterThanOrEqualTo &&
        isSameColor(rule.barColor, recommended.barColor)
      );
    },
  );
}
