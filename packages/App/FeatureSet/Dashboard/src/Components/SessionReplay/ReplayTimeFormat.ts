/*
 * The one place replay offsets become text.
 *
 * The scrubber used to round and the rail used to floor, so the same
 * 2,500ms event read "0:03" on a marker tooltip and "0:02" in the rail -
 * two clocks disagreeing on a page whose whole promise is "one clock".
 * Neither rendered hours, so a 65-minute session read "65:00". Every
 * component that prints a session-clock offset (controls, timeline,
 * rail rows, the header's wall clock, "copy link at this moment") goes
 * through these helpers, and every one of them FLOORS: a viewer looking
 * at 0:02.9 is still inside second two, and a link to "?t=2" must land
 * before the event, never after it.
 *
 * WHAT IS DRAWN IS IN THE READER'S DIGITS (#7318). Each helper has an
 * InLanguage twin that writes the same figure in the digits the reader's
 * language writes, through DateLanguage's writeDigitsInLocale: "۱:۰۲" in
 * Persian, Latin in every other language (Arabic among them, as OneUptime
 * writes Arabic). Only the digits change - and, in a language whose zero is
 * a dot, the decimal point, which beside a Persian zero would read as one
 * more: "۱:۰۲٫۳". What is copied or put in a URL (the ?t= value, a copied
 * timestamp) is never written in them: it is read by machines and pasted
 * into other tools, so it keeps ASCII digits.
 */

import {
  getNumberLocale,
  writeDigitsInLocale,
} from "Common/Types/DateLanguage";
import {
  ComposedValue,
  composedValue,
  Translator,
  writesZeroAsADot,
} from "Common/Types/Translator";

const MS_PER_SECOND: number = 1000;
const SECONDS_PER_MINUTE: number = 60;
const SECONDS_PER_HOUR: number = 3600;

function toWholeSeconds(offsetMs: number): number {
  if (!Number.isFinite(offsetMs) || offsetMs <= 0) {
    return 0;
  }

  return Math.floor(offsetMs / MS_PER_SECOND);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

const decimalMarkCache: Map<string, string> = new Map<string, string>();

/*
 * The decimal sign a figure takes beside `language`'s digits: the point
 * the player has always written, except in a language whose zero is a dot
 * (Persian's "۰"), where a point between two digits reads as a zero and
 * the language's own sign stands instead: "۱:۰۲٫۳", "۱٫۵x".
 */
function getDecimalMarkOf(language: string): string {
  const cached: string | undefined = decimalMarkCache.get(language);

  if (cached !== undefined) {
    return cached;
  }

  let mark: string = ".";

  if (writesZeroAsADot(language)) {
    try {
      mark =
        new Intl.NumberFormat(getNumberLocale(language))
          .formatToParts(0.5)
          .find((part: Intl.NumberFormatPart): boolean => {
            return part.type === "decimal";
          })?.value || ".";
    } catch {
      mark = ".";
    }
  }

  decimalMarkCache.set(language, mark);

  return mark;
}

/*
 * A figure the player wrote itself - a clock, a speed, a size - in the
 * digits `language` writes, with its decimal point as getDecimalMarkOf
 * says. Unchanged with no language. Never for text someone else wrote (a
 * page's URL, a browser's version): its digits are theirs.
 */
export function writeReplayFigureInLanguage(
  figure: string,
  language: string | undefined,
): string {
  if (!language) {
    return figure;
  }

  const written: string = writeDigitsInLocale(figure, language);
  const mark: string = getDecimalMarkOf(language);

  return mark === "." ? written : written.split(".").join(mark);
}

/*
 * m:ss below one hour, h:mm:ss at or above it. "0:00" for anything
 * non-positive or non-finite so a NaN from a bad manifest never reaches
 * the screen as "NaN:NaN".
 */
export function formatReplayOffset(offsetMs: number): string {
  const totalSeconds: number = toWholeSeconds(offsetMs);
  const hours: number = Math.floor(totalSeconds / SECONDS_PER_HOUR);
  const minutes: number = Math.floor(
    (totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE,
  );
  const seconds: number = totalSeconds % SECONDS_PER_MINUTE;

  if (hours > 0) {
    return `${hours}:${pad2(minutes)}:${pad2(seconds)}`;
  }

  return `${minutes}:${pad2(seconds)}`;
}

/*
 * The same offset in the digits `language` writes: "۲:۱۴" in Persian, "2:14"
 * in every language that writes Latin digits (Arabic among them,
 * DateLanguage's LATIN_DIGIT_LANGUAGES), and as formatReplayOffset writes it
 * with no language. Only the digits change: the m:ss shape, and the floor,
 * are formatReplayOffset's.
 */
export function formatReplayOffsetInLanguage(
  offsetMs: number,
  language: string | undefined,
): string {
  return writeReplayFigureInLanguage(formatReplayOffset(offsetMs), language);
}

/*
 * An offset as a value of a sentence ("Seeking to {{time}}"), written in
 * the digits of the language the sentence comes out in: Persian digits in
 * a Persian sentence, Latin ones in the English a language has no words
 * for yet.
 */
export function replayOffsetValue(offsetMs: number): ComposedValue {
  return composedValue((sentence: Translator): string => {
    return formatReplayOffsetInLanguage(offsetMs, sentence.language);
  });
}

/*
 * The same clock with a tenth of a second: "1:02.3". Shown while paused,
 * where a viewer is stepping frame by frame and a whole-second readout
 * would not move for ten presses of "." in a row.
 */
export function formatReplayOffsetPrecise(offsetMs: number): string {
  const safeMs: number =
    Number.isFinite(offsetMs) && offsetMs > 0 ? offsetMs : 0;
  const tenths: number = Math.floor((safeMs % MS_PER_SECOND) / 100);

  return `${formatReplayOffset(safeMs)}.${tenths}`;
}

/*
 * The paused clock's "1:02.3" in the digits `language` writes: "۱:۰۲٫۳"
 * in Persian, as formatReplayOffsetPrecise writes it elsewhere.
 */
export function formatReplayOffsetPreciseInLanguage(
  offsetMs: number,
  language: string | undefined,
): string {
  return writeReplayFigureInLanguage(
    formatReplayOffsetPrecise(offsetMs),
    language,
  );
}

// The same, with its tenth, as a value of a sentence.
export function replayOffsetPreciseValue(offsetMs: number): ComposedValue {
  return composedValue((sentence: Translator): string => {
    return formatReplayOffsetPreciseInLanguage(offsetMs, sentence.language);
  });
}

/*
 * "current / total" for the controls row. Tenths only while paused: at
 * 1x the decimal would flicker ten times a second and read as noise.
 */
export function formatReplayClock(
  currentTimeMs: number,
  durationMs: number,
  isPaused: boolean,
): string {
  const parts: ReplayClockParts = splitReplayClock(
    currentTimeMs,
    durationMs,
    isPaused,
  );

  return `${parts.current} / ${parts.total}`;
}

export interface ReplayClockParts {
  current: string;
  total: string;
}

/*
 * The controls row's clock in the digits `language` writes: "۰:۰۰٫۷ /
 * ۰:۳۰" in Persian, as formatReplayClock writes it with no language.
 */
export function formatReplayClockInLanguage(
  currentTimeMs: number,
  durationMs: number,
  isPaused: boolean,
  language: string | undefined,
): string {
  const parts: ReplayClockParts = splitReplayClockInLanguage(
    currentTimeMs,
    durationMs,
    isPaused,
    language,
  );

  return `${parts.current} / ${parts.total}`;
}

/*
 * The same clock the controls row prints, as its two halves, so the
 * readout can weight the elapsed time and mute the total without either
 * component re-deriving the "tenths only while paused" rule.
 * formatReplayClock stays the single definition of the joined string.
 */
export function splitReplayClock(
  currentTimeMs: number,
  durationMs: number,
  isPaused: boolean,
): ReplayClockParts {
  return {
    current: isPaused
      ? formatReplayOffsetPrecise(currentTimeMs)
      : formatReplayOffset(currentTimeMs),
    total: formatReplayOffset(durationMs),
  };
}

// The two halves, each in the digits `language` writes.
export function splitReplayClockInLanguage(
  currentTimeMs: number,
  durationMs: number,
  isPaused: boolean,
  language: string | undefined,
): ReplayClockParts {
  const parts: ReplayClockParts = splitReplayClock(
    currentTimeMs,
    durationMs,
    isPaused,
  );

  return {
    current: writeReplayFigureInLanguage(parts.current, language),
    total: writeReplayFigureInLanguage(parts.total, language),
  };
}

/*
 * A length of time in words for band labels and toasts: "18s", "1m 12s",
 * "2h 5m". Rounds to the nearest second because "17.6s missing" claims a
 * precision the chunk boundaries do not have. Below one second says
 * "<1s" rather than "0s": a gap that exists is never labelled as nothing.
 */
export function formatReplayDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return "0s";
  }

  const totalSeconds: number = Math.round(durationMs / MS_PER_SECOND);

  if (totalSeconds < 1) {
    return "<1s";
  }

  const hours: number = Math.floor(totalSeconds / SECONDS_PER_HOUR);
  const minutes: number = Math.floor(
    (totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE,
  );
  const seconds: number = totalSeconds % SECONDS_PER_MINUTE;

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  return `${seconds}s`;
}

/*
 * The wall-clock time of an offset, for the header's "at 14:32:07" and
 * the hover bubble on long sessions. Local time, 24-hour, with seconds -
 * the same shape the logs and traces pages print, so a viewer can match
 * the two by eye. Null when the session start is unknown rather than
 * "Invalid Date".
 */
export function formatReplayWallClock(
  startTimeUnixMs: number | null | undefined,
  offsetMs: number,
): string | null {
  if (
    startTimeUnixMs === null ||
    startTimeUnixMs === undefined ||
    !Number.isFinite(startTimeUnixMs) ||
    !Number.isFinite(offsetMs)
  ) {
    return null;
  }

  const date: Date = new Date(startTimeUnixMs + Math.max(0, offsetMs));

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(
    date.getSeconds(),
  )}`;
}

/*
 * The header's wall clock in the digits `language` writes: "۱۳:۴۷:۵۳" in
 * Persian. Still 24-hour HH:MM:SS, so it matches the logs and traces
 * pages by eye in every language.
 */
export function formatReplayWallClockInLanguage(
  startTimeUnixMs: number | null | undefined,
  offsetMs: number,
  language: string | undefined,
): string | null {
  const wallClock: string | null = formatReplayWallClock(
    startTimeUnixMs,
    offsetMs,
  );

  return wallClock === null
    ? null
    : writeReplayFigureInLanguage(wallClock, language);
}

/*
 * The ?t= value for "copy link at this moment": whole seconds, floored,
 * so the link lands at or before the moment the viewer was looking at.
 * Decimals are READ by the URL parser (ReplayPlayerUrlState) but never
 * written, so every link a human sees is short.
 */
export function toReplayUrlSeconds(offsetMs: number): number {
  return toWholeSeconds(offsetMs);
}
