import {
  createTranslator,
  DEFAULT_LANGUAGE,
  Translator,
} from "Common/Types/Translator";
import {
  CompactDuration,
  formatCompactDuration,
} from "../../../Utils/Milliseconds";

/*
 * How long is left before an incident's SLA deadline, or how far past it it
 * is, as its timer ticks: "2d 3h 4m 5s", "4m 5s", "5s". The note reminder's
 * timer counts in hours ("26h 4m 5s"), since its interval can run past a
 * day. A unit shows once it or a larger one is not zero, and seconds always
 * show, so the timer never reads empty.
 *
 * In the reader's short units and digits ("2 T. 3 Std. 4 Min. 5 Sek.", "۴
 * دقیقه ۵ ثانیه"; #8455), English exactly as the timers wrote it by hand.
 * Pure, so the Dashboard's tests pin it without drawing the page.
 */

// English, as a test reads it without a translator.
const ENGLISH: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

const MS_PER_SECOND: number = 1000;
const MS_PER_MINUTE: number = 60 * MS_PER_SECOND;
const MS_PER_HOUR: number = 60 * MS_PER_MINUTE;
const MS_PER_DAY: number = 24 * MS_PER_HOUR;

export function formatSlaCountdown(
  milliseconds: number,
  options?: {
    // Whether whole days are counted ("2d 3h"), or hours run on ("51h").
    countsDays?: boolean | undefined;
    translator?: Translator | undefined;
  },
): string {
  const translator: Translator = options?.translator || ENGLISH;
  const absolute: number = Number.isFinite(milliseconds)
    ? Math.abs(milliseconds)
    : 0;
  const countsDays: boolean = Boolean(options?.countsDays);
  const days: number = countsDays ? Math.floor(absolute / MS_PER_DAY) : 0;
  const hours: number = Math.floor(
    (countsDays ? absolute % MS_PER_DAY : absolute) / MS_PER_HOUR,
  );
  const minutes: number = Math.floor((absolute % MS_PER_HOUR) / MS_PER_MINUTE);
  const seconds: number = Math.floor(
    (absolute % MS_PER_MINUTE) / MS_PER_SECOND,
  );
  const duration: CompactDuration = { seconds };

  if (days > 0) {
    duration.days = days;
  }

  if (days > 0 || hours > 0) {
    duration.hours = hours;
  }

  if (days > 0 || hours > 0 || minutes > 0) {
    duration.minutes = minutes;
  }

  return formatCompactDuration(translator, duration);
}
