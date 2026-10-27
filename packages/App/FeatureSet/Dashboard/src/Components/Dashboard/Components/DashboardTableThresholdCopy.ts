import IconProp from "Common/Types/Icon/IconProp";
import {
  TableColumnThresholds,
  TableThresholdDirection,
  TableThresholdLevel,
  TableThresholdStyle,
} from "Common/Types/Dashboard/DashboardComponents/DashboardTableComponent";
import {
  formatTableThreshold,
  readTableThresholdDirection,
} from "Common/Utils/Dashboard/TableThresholds";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * How a metric table draws a value past one of its column's thresholds
 * (issue #5231), and the words that say why: React-free, so the widget's
 * cells, the settings' legend and the tests read the same copy.
 *
 * A level is never told by its color alone:
 *   - a warning is amber, with a triangle;
 *   - a critical value is red, with a circle, and bold.
 * Every class here has a dark-theme rule in Theme.css
 * (TableThresholdColorsDarkMode holds it to that), where the amber and red
 * turn light on the dark card and the backgrounds turn into dark washes.
 */

// The cell's look when it has reached no threshold - as every value cell was.
export const TABLE_VALUE_CELL_CLASS_NAME: string =
  "text-gray-900 font-semibold";

export const TABLE_THRESHOLD_CELL_CLASS_NAMES: Readonly<
  Record<TableThresholdStyle, Readonly<Record<TableThresholdLevel, string>>>
> = {
  [TableThresholdStyle.Text]: {
    [TableThresholdLevel.Warning]: "text-amber-700 font-semibold",
    [TableThresholdLevel.Critical]: "text-red-700 font-bold",
  },
  [TableThresholdStyle.Background]: {
    [TableThresholdLevel.Warning]: "bg-amber-100 text-amber-900 font-semibold",
    [TableThresholdLevel.Critical]: "bg-red-100 text-red-900 font-bold",
  },
};

// The shape beside a value that has reached a level: not the color alone.
export const TABLE_THRESHOLD_ICONS: Readonly<
  Record<TableThresholdLevel, IconProp>
> = {
  [TableThresholdLevel.Warning]: IconProp.Alert,
  [TableThresholdLevel.Critical]: IconProp.ExclaimationCircle,
};

// What a test, or a browser suite, finds a colored cell by.
export const TABLE_THRESHOLD_LEVEL_ATTRIBUTE: string = "data-threshold-level";

/*
 * What a level means, as one sentence with the threshold in it: "Critical:
 * 90% and above", "Warning: 20 GB and below". A cell past a threshold says
 * it to the pointer (title) and to a screen reader (its icon's name), and
 * the settings list the column's levels in the same words. Each sentence is
 * looked up whole: a language words "and above" its own way.
 */
export const getTableThresholdRule: (data: {
  translator: Translator;
  level: TableThresholdLevel;
  threshold: number;
  direction: TableThresholdDirection | undefined;
  unit: string | undefined;
}) => string = (data: {
  translator: Translator;
  level: TableThresholdLevel;
  threshold: number;
  direction: TableThresholdDirection | undefined;
  unit: string | undefined;
}): string => {
  const value: string = formatTableThreshold({
    threshold: data.threshold,
    unit: data.unit,
  });
  const isLowerWorse: boolean =
    readTableThresholdDirection(data.direction) ===
    TableThresholdDirection.LowerIsWorse;

  if (data.level === TableThresholdLevel.Critical) {
    return isLowerWorse
      ? data.translator.translateTemplate("Critical: {{value}} and below", {
          value,
        })
      : data.translator.translateTemplate("Critical: {{value}} and above", {
          value,
        });
  }

  return isLowerWorse
    ? data.translator.translateTemplate("Warning: {{value}} and below", {
        value,
      })
    : data.translator.translateTemplate("Warning: {{value}} and above", {
        value,
      });
};

// A level's threshold among a column's thresholds.
export const getTableThresholdOfLevel: (
  thresholds: TableColumnThresholds,
  level: TableThresholdLevel,
) => number | undefined = (
  thresholds: TableColumnThresholds,
  level: TableThresholdLevel,
): number | undefined => {
  return level === TableThresholdLevel.Critical
    ? thresholds.critical
    : thresholds.warning;
};

/*
 * Every level a column's thresholds set, worst last, each with its
 * sentence: what the settings show under the thresholds as they are typed.
 */
export const getTableThresholdRules: (data: {
  translator: Translator;
  thresholds: TableColumnThresholds | null;
  unit: string | undefined;
}) => Array<{ level: TableThresholdLevel; rule: string }> = (data: {
  translator: Translator;
  thresholds: TableColumnThresholds | null;
  unit: string | undefined;
}): Array<{ level: TableThresholdLevel; rule: string }> => {
  const rules: Array<{ level: TableThresholdLevel; rule: string }> = [];

  if (!data.thresholds) {
    return rules;
  }

  for (const level of [
    TableThresholdLevel.Warning,
    TableThresholdLevel.Critical,
  ]) {
    const threshold: number | undefined = getTableThresholdOfLevel(
      data.thresholds,
      level,
    );

    if (threshold === undefined) {
      continue;
    }

    rules.push({
      level,
      rule: getTableThresholdRule({
        translator: data.translator,
        level,
        threshold,
        direction: data.thresholds.direction,
        unit: data.unit,
      }),
    });
  }

  return rules;
};
