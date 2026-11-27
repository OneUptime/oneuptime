import {
  CloudCostAllocationGroupResult,
  getCloudCostAllocationChange,
} from "Common/Types/Cloud/CloudCostAllocation";
import { formatReaderFigure } from "Common/Types/DateLanguage";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  VS_PREVIOUS_DOWN,
  VS_PREVIOUS_SAME,
  VS_PREVIOUS_UP,
} from "./CloudCostGroupWords";

// A view's figures as a CSV, for the month's chargeback (#11009).
export { toCloudCostAllocationCsv } from "Common/Types/Cloud/CloudCostCsv";

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
