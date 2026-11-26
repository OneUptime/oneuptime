import {
  CloudCostAllocationGroupResult,
  CloudCostAllocationResult,
  getCloudCostAllocationChange,
} from "Common/Types/Cloud/CloudCostAllocation";
import { formatReaderFigure } from "Common/Types/DateLanguage";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  VS_PREVIOUS_DOWN,
  VS_PREVIOUS_SAME,
  VS_PREVIOUS_UP,
} from "./CloudCostGroupWords";

/*
 * What a cost group's figures say, in the reader's words: the change on
 * the period before, and a view's figures as a CSV for finance. React-free.
 */

// "Up 12% on the period before", or nothing when there is nothing to compare.
export function getGroupChangeHint(data: {
  group: Pick<CloudCostAllocationGroupResult, "total" | "previousTotal">;
  translator: Translator;
}): string | null {
  const change: number | null = getCloudCostAllocationChange({
    current: data.group.total,
    previous: data.group.previousTotal,
  });

  if (change === null) {
    return null;
  }

  if (Math.abs(change) < 0.5) {
    return data.translator.translateText(VS_PREVIOUS_SAME) || VS_PREVIOUS_SAME;
  }

  // In the reader's digits and percent sign: "12%", "12 %", "۱۲٪".
  const percent: string = formatReaderFigure(Math.abs(change), {
    decimals: 0,
    isPercent: true,
    language: data.translator.language,
  });

  return data.translator.translateTemplate(
    change > 0 ? VS_PREVIOUS_UP : VS_PREVIOUS_DOWN,
    { percent },
  );
}

// What starts a spreadsheet formula, which a CSV field must never.
const FORMULA_LEAD: RegExp = /^[=+\-@\t\r]/;

// A CSV field: quoted, its quotes doubled, a formula's lead character defused.
function csvField(value: string | number): string {
  const text: string = typeof value === "number" ? String(value) : value;
  // A figure is a figure: a credit's "-60" is no formula.
  const safe: string =
    typeof value === "string" && FORMULA_LEAD.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/*
 * A view's figures as a CSV: one row per group and bucket, then the
 * unallocated - what finance pulls the month's chargeback from. Figures in
 * the read's currency, plain numbers (a CSV is read by a program).
 */
export function toCloudCostAllocationCsv(
  allocation: CloudCostAllocationResult,
): string {
  const lines: Array<string> = [
    [
      "group",
      "group_id",
      "period_start",
      "currency",
      "total",
      "cloud",
      "line_items",
      "shared_in",
      "shared_out",
    ]
      .map(csvField)
      .join(","),
  ];

  for (const group of allocation.groups) {
    lines.push(
      [
        group.name,
        group.id,
        allocation.start,
        allocation.currency,
        group.total,
        group.cloud,
        group.lineItems,
        group.sharedIn,
        group.sharedOut,
      ]
        .map(csvField)
        .join(","),
    );
  }

  lines.push(
    [
      "Unallocated",
      "",
      allocation.start,
      allocation.currency,
      allocation.unallocated.total,
      allocation.unallocated.cloud,
      allocation.unallocated.lineItems,
      0,
      0,
    ]
      .map(csvField)
      .join(","),
  );

  return `${lines.join("\n")}\n`;
}
