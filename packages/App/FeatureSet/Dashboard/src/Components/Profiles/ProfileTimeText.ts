import OneUptimeDate from "Common/Types/Date";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  EventDurationPart,
  formatEventDurationParts,
  getEventDurationParts,
} from "../../Utils/EventDuration";

/*
 * Times as the Profiler says them, in the reader's language: "3 hours ago"
 * for a deploy, "the last hour" for a window. React-free.
 */

export const JUST_NOW: string = translationKey("just now");
export const AGO: string = translationKey("{{duration}} ago");

export function formatAgo(data: {
  time: Date;
  now: Date;
  translator: Translator;
}): string {
  const parts: Array<EventDurationPart> = getEventDurationParts(
    data.time,
    data.now,
    { maxUnits: 1 },
  );

  if (parts.length === 0) {
    return data.translator.translateText(JUST_NOW) || JUST_NOW;
  }

  return data.translator.translateTemplate(AGO, {
    duration: formatEventDurationParts(parts, data.translator.language),
  });
}

// The preset windows, each as a whole phrase so every language words it.
export const PRESET_WINDOW_PHRASES: Record<number, string> = {
  15: translationKey("the last 15 minutes"),
  60: translationKey("the last hour"),
  360: translationKey("the last 6 hours"),
  1440: translationKey("the last day"),
  10080: translationKey("the last 7 days"),
};

export const LAST_WINDOW: string = translationKey("the last {{duration}}");
export const WINDOW_FROM_TO: string = translationKey("{{start}} to {{end}}");

/*
 * A window as a short phrase: "the last hour" for a preset ending now,
 * otherwise its start and end as local times.
 */
export function formatWindow(data: {
  startTime: Date;
  endTime: Date;
  isCustom: boolean;
  translator: Translator;
}): string {
  if (!data.isCustom) {
    const minutes: number = Math.round(
      (data.endTime.getTime() - data.startTime.getTime()) / (60 * 1000),
    );
    const phrase: string | undefined = PRESET_WINDOW_PHRASES[minutes];

    if (phrase) {
      return data.translator.translateText(phrase) || phrase;
    }

    return data.translator.translateTemplate(LAST_WINDOW, {
      duration: formatEventDurationParts(
        getEventDurationParts(data.startTime, data.endTime, { maxUnits: 2 }),
        data.translator.language,
      ),
    });
  }

  return data.translator.translateTemplate(WINDOW_FROM_TO, {
    start: OneUptimeDate.getDateAsLocalFormattedString(data.startTime),
    end: OneUptimeDate.getDateAsLocalFormattedString(data.endTime),
  });
}
