import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import {
  getGlobalTranslator,
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The Logs Insights panels' words for the window they describe and how often
 * an error happened in it, in the reader's language. They go into the
 * panels' sentences ("No errors in {{range}}", "Distinct error messages in
 * {{range}}.") as values.
 */

// "the past 1 day", or "the selected time range" for a custom window.
export function describeLogsTimeRange(
  timeRange: RangeStartAndEndDateTime,
  translator: Translator = getGlobalTranslator(),
): string {
  const range: TimeRange | undefined = timeRange?.range;

  if (!range || range === TimeRange.CUSTOM) {
    return translator.translateText("the selected time range") as string;
  }

  return translator.translateTemplate("the {{range}}", {
    range: translatableTerm(range, { inSentence: true }),
  });
}

// "30 times in the past 2 days".
export function describeLogsOccurrenceCount(
  count: number,
  timeRange: RangeStartAndEndDateTime,
  translator: Translator = getGlobalTranslator(),
): string {
  const safeCount: number = Number.isFinite(count) ? Math.max(0, count) : 0;

  return translator.translatePlural(
    {
      one: "{{count}} time in {{range}}",
      other: "{{count}} times in {{range}}",
    },
    safeCount,
    { range: describeLogsTimeRange(timeRange, translator) },
  );
}
