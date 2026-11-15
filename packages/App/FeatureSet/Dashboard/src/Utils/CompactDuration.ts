import { formatDurationUnit } from "Common/Types/DateLanguage";
import { EventDurationPart } from "./EventDuration";
import { formatDurationInMinutes } from "Common/Utils/SecurityCase/SecurityOverviewMetrics";

/*
 * A duration in whole minutes, compact, for a figure on a stat tile: at most
 * its two largest units, as formatDurationInMinutes says it. English keeps
 * that text word for word ("51 min", "4 h 24 min", "3 d 5 h"); every other
 * language uses its own short unit names ("4 ч 24 мин", "4 Std. 24 Min.",
 * "4 時間 24 分"), which Intl knows and the locale files need not, each
 * number held to its unit by a no-break space (formatDurationUnit, #8456)
 * as the English holds its own. An engine without Intl's unit style, or no
 * value at all, gets the English text.
 */

// The two largest units of a duration in minutes, the way the English says.
export function getCompactDurationParts(
  minutes: number,
): Array<EventDurationPart> {
  const total: number = Math.max(0, Math.round(minutes));

  if (total < 60) {
    return [{ count: total, unit: "minute" }];
  }

  const hours: number = Math.floor(total / 60);
  const restMinutes: number = total % 60;

  if (hours < 24) {
    return restMinutes > 0
      ? [
          { count: hours, unit: "hour" },
          { count: restMinutes, unit: "minute" },
        ]
      : [{ count: hours, unit: "hour" }];
  }

  const days: number = Math.floor(hours / 24);
  const restHours: number = hours % 24;

  return restHours > 0
    ? [
        { count: days, unit: "day" },
        { count: restHours, unit: "hour" },
      ]
    : [{ count: days, unit: "day" }];
}

export function formatCompactDurationInMinutes(
  minutes: number | null,
  language: string | undefined,
): string {
  const english: string = formatDurationInMinutes(minutes);

  if (
    minutes === null ||
    !Number.isFinite(minutes) ||
    !language ||
    language === "en" ||
    language.startsWith("en-")
  ) {
    return english;
  }

  const words: Array<string> = [];

  for (const part of getCompactDurationParts(minutes)) {
    const word: string | null = formatDurationUnit({
      part: part,
      locale: language,
      unitDisplay: "short",
    });

    // An engine without the unit style: the English, never a bare number.
    if (word === null) {
      return english;
    }

    words.push(word);
  }

  return words.join(" ");
}
