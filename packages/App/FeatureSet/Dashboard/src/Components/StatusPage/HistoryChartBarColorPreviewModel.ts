import StatusPageHistoryChartBarColorRule from "Common/Models/DatabaseModels/StatusPageHistoryChartBarColorRule";
import { Green } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { looksAlikeWithRedGreenColorBlindness } from "Common/Utils/ColorVision";
import {
  HistoryChartBarColorRuleInput,
  NO_DATA_BAR_COLOR,
  RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES,
  getRuleBarColor,
  getRuleUptimePercent,
  getUptimePercentBelowWhichNoRuleMatches,
  isRuleShadowed,
} from "Common/Utils/StatusPage/HistoryChartBarColors";

/*
 * What the Branding page's bar color preview draws, worked out without
 * React: the colours a status page's uptime history can take, each named,
 * and what is wrong with them.
 *
 * With rules, a day takes the colour of the first rule its uptime reaches,
 * and a day below every rule the page's default bar colour. Without rules,
 * a day takes the colour of the most severe monitor status it had, so the
 * statuses' own colours are the ones to look at. A day nobody measured is
 * always the hatched no-data grey (DayUptimeGraph).
 *
 * The warnings are the ones the page cannot show an operator who sees every
 * colour: two colours that look alike to people with red-green colour
 * blindness (Utils/ColorVision), and a rule that never colours a day because
 * a rule above it reaches every day it would.
 */

export enum BarColorPreviewEntryKind {
  // A rule: days whose uptime reaches its percentage, and no rule above it.
  Rule = "Rule",
  // Days below every rule: the page's default bar color.
  NoRuleMatches = "NoRuleMatches",
  // Without rules: days whose most severe status was this one.
  Status = "Status",
  // Days nobody measured.
  NoData = "NoData",
}

export interface BarColorPreviewEntry {
  key: string;
  kind: BarColorPreviewEntryKind;
  color: Color;
  // A rule's percentage, or the one days under NoRuleMatches are below.
  uptimePercent?: number | undefined;
  // A status's name.
  statusName?: string | undefined;
  // A rule a rule above it shadows: it never colours a day.
  isShadowed?: boolean | undefined;
}

// A monitor status, as the preview needs it.
export interface BarColorPreviewStatus {
  name?: string | undefined;
  color?: Color | string | undefined;
  priority?: number | undefined;
}

export const NO_DATA_ENTRY: BarColorPreviewEntry = {
  key: "no-data",
  kind: BarColorPreviewEntryKind.NoData,
  color: NO_DATA_BAR_COLOR,
};

/*
 * The colours a page with these rules draws its days in: one per rule, in
 * the rules' order, then the default bar colour when some days are below
 * every rule, then no data.
 */
export function getRulePreviewEntries(data: {
  rules: ReadonlyArray<HistoryChartBarColorRuleInput>;
  fallbackColor?: Color | string | null | undefined;
}): Array<BarColorPreviewEntry> {
  const entries: Array<BarColorPreviewEntry> = [];

  data.rules.forEach((rule: HistoryChartBarColorRuleInput, index: number) => {
    const uptimePercent: number | null = getRuleUptimePercent(rule);
    const color: Color | null = getRuleBarColor(rule);

    if (uptimePercent === null || !color) {
      return;
    }

    entries.push({
      key: `rule-${index}`,
      kind: BarColorPreviewEntryKind.Rule,
      color: color,
      uptimePercent: uptimePercent,
      isShadowed: isRuleShadowed(data.rules, index),
    });
  });

  const lowest: number | null = getUptimePercentBelowWhichNoRuleMatches(
    data.rules,
  );

  if (lowest !== null) {
    /*
     * As the status page draws it: a page without a default colour is drawn
     * green (Overview: statusPage.defaultBarColor || Green).
     */
    const fallback: Color =
      data.fallbackColor && data.fallbackColor.toString().trim()
        ? new Color(data.fallbackColor.toString())
        : Green;

    entries.push({
      key: "no-rule-matches",
      kind: BarColorPreviewEntryKind.NoRuleMatches,
      color: fallback,
      uptimePercent: lowest,
    });
  }

  entries.push(NO_DATA_ENTRY);

  return entries;
}

/*
 * The colours a page without rules draws its days in: each status's own,
 * from the least severe to the most, then no data.
 */
export function getStatusPreviewEntries(
  statuses: ReadonlyArray<BarColorPreviewStatus>,
): Array<BarColorPreviewEntry> {
  const entries: Array<BarColorPreviewEntry> = [];

  [...statuses]
    .sort((first: BarColorPreviewStatus, second: BarColorPreviewStatus) => {
      return (first.priority ?? 0) - (second.priority ?? 0);
    })
    .forEach((status: BarColorPreviewStatus, index: number) => {
      if (!status.color) {
        return;
      }

      entries.push({
        key: `status-${index}`,
        kind: BarColorPreviewEntryKind.Status,
        color:
          status.color instanceof Color
            ? status.color
            : new Color(status.color),
        statusName: status.name || "",
      });
    });

  entries.push(NO_DATA_ENTRY);

  return entries;
}

/*
 * The pairs of colours people with red-green colour blindness cannot tell
 * apart, in the order the entries are drawn. No data is left out: its hatch
 * tells it apart from any colour. Two entries in the same colour are not a
 * pair: the operator chose that, and can see it.
 */
export function getLookAlikeEntryPairs(
  entries: ReadonlyArray<BarColorPreviewEntry>,
): Array<[BarColorPreviewEntry, BarColorPreviewEntry]> {
  const colored: Array<BarColorPreviewEntry> = entries.filter(
    (entry: BarColorPreviewEntry): boolean => {
      return entry.kind !== BarColorPreviewEntryKind.NoData;
    },
  );

  const pairs: Array<[BarColorPreviewEntry, BarColorPreviewEntry]> = [];

  for (let first: number = 0; first < colored.length; first++) {
    for (let second: number = first + 1; second < colored.length; second++) {
      if (
        looksAlikeWithRedGreenColorBlindness(
          colored[first]!.color,
          colored[second]!.color,
        )
      ) {
        pairs.push([colored[first]!, colored[second]!]);
      }
    }
  }

  return pairs;
}

// A percentage as a person writes it: 99, 99.5, 99.95 - never 99.00.
export function formatUptimePercent(percent: number): string {
  return String(Number(percent.toFixed(4)));
}

/*
 * Makes the recommended rules on a status page that has none, in their
 * order, as the person signed in: the same rules a page created in the
 * dashboard starts with (StatusPageService). All of them or none - a page
 * left with some of them would draw a day below them in its default bar
 * color, green on a new page - so the ones made before a refusal are
 * deleted again before the refusal is handed on.
 */
export async function addRecommendedBarColorRules(data: {
  statusPageId: ObjectID;
  projectId: ObjectID;
}): Promise<void> {
  const made: Array<ObjectID> = [];

  try {
    for (const recommended of RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES) {
      const rule: StatusPageHistoryChartBarColorRule =
        new StatusPageHistoryChartBarColorRule();
      rule.statusPageId = data.statusPageId;
      rule.projectId = data.projectId;
      rule.uptimePercentGreaterThanOrEqualTo =
        recommended.uptimePercentGreaterThanOrEqualTo;
      rule.barColor = new Color(recommended.barColor.toString());

      const created: StatusPageHistoryChartBarColorRule = (
        await ModelAPI.create<StatusPageHistoryChartBarColorRule>({
          model: rule,
          modelType: StatusPageHistoryChartBarColorRule,
        })
      ).data as StatusPageHistoryChartBarColorRule;

      if (created?.id) {
        made.push(created.id);
      }
    }
  } catch (error) {
    for (const id of made) {
      try {
        await ModelAPI.deleteItem<StatusPageHistoryChartBarColorRule>({
          modelType: StatusPageHistoryChartBarColorRule,
          id: id,
        });
      } catch {
        // The refusal handed on below is the one to tell the person about.
      }
    }

    throw error;
  }
}
