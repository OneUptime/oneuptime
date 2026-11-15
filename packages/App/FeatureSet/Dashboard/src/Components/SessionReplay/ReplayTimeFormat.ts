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
 * WHAT IS DRAWN IS IN THE READER'S DIGITS (#7098, #7318). Each helper that
 * writes a figure the player draws has an InLanguage twin that writes the
 * same text in the digits the reader's language writes, through
 * DateLanguage's writeDigitsInLocale: "۱:۰۲" in Persian, Latin digits in
 * every other language (Arabic among them: OneUptime writes Arabic in Latin
 * digits, DateLanguage's LATIN_DIGIT_LANGUAGES). Only the digits change,
 * and - in a language that writes digits of its own - the decimal point,
 * which beside Persian's zero ("۰", a dot) read as one more digit:
 * "۱:۰۲٫۳". The shape (m:ss, h:mm:ss, HH:MM:SS) and the floor are the
 * English helper's. What is copied or put in a URL (the ?t= value, a
 * copied timestamp) is never written in them: machines read it and other
 * tools take it pasted, so it keeps ASCII digits.
 */

import {
  getDigitsOf,
  getNumberLocale,
  writeDigitsInLocale,
} from "Common/Types/DateLanguage";

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

const decimalSignCache: Map<string, string> = new Map<string, string>();

/*
 * The decimal sign a figure the player wrote takes in `language`: the
 * point it has always written wherever the digits are Latin, and the
 * language's own sign (Intl's) where the digits are the language's own -
 * Persian's "٫", since a point beside Persian's "۰" reads as a zero.
 */
function getDecimalSignOf(language: string): string {
  const cached: string | undefined = decimalSignCache.get(language);

  if (cached !== undefined) {
    return cached;
  }

  let sign: string = ".";

  if (getDigitsOf(language)[0] !== "0") {
    try {
      sign =
        new Intl.NumberFormat(getNumberLocale(language))
          .formatToParts(0.5)
          .find((part: Intl.NumberFormatPart): boolean => {
            return part.type === "decimal";
          })?.value || ".";
    } catch {
      sign = ".";
    }
  }

  decimalSignCache.set(language, sign);

  return sign;
}

/*
 * A figure the player wrote itself - a clock, a size - in the digits
 * `language` writes, its decimal point as getDecimalSignOf says: "۱:۰۲٫۳"
 * and "۱۲۰۰x۷۶۰" in Persian, unchanged in a language that writes Latin
 * digits, and unchanged with no language. Never for text someone else
 * wrote (a page's address, a log line): its digits are theirs.
 */
export function writeReplayFigureInLanguage(
  figure: string,
  language: string | undefined,
): string {
  if (!language) {
    return figure;
  }

  const written: string = writeDigitsInLocale(figure, language);

  if (written === figure) {
    return figure;
  }

  const sign: string = getDecimalSignOf(language);

  return sign === "." ? written : written.split(".").join(sign);
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
 * The same, in the digits `language` writes: "۱:۰۲٫۳" in Persian, "1:02.3"
 * in every language that writes Latin digits and with no language.
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

/*
 * The two halves in the digits `language` writes: "۰:۰۰٫۷" and "۰:۳۰" in
 * Persian. The tenths rule is splitReplayClock's.
 */
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
 * The joined clock in the digits `language` writes: "۰:۰۰٫۷ / ۰:۳۰" in
 * Persian. Drawn left to right on every page (ReplayClock), or its halves
 * swap places on a page read from the right.
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
 * A signed delta for the -10s / +10s buttons and their tooltips: "+10s",
 * "-30s", "+1m". Zero reads "0s" so a misconfigured button is visible
 * rather than blank.
 */
export function formatReplayDelta(deltaMs: number): string {
  if (!Number.isFinite(deltaMs) || deltaMs === 0) {
    return "0s";
  }

  const sign: string = deltaMs < 0 ? "-" : "+";

  return `${sign}${formatReplayDuration(Math.abs(deltaMs))}`;
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
 * The wall clock in the digits `language` writes: "۱۳:۴۷:۵۳" in Persian.
 * Still 24-hour HH:MM:SS in every language, so it matches the logs and
 * traces pages by eye. Null where formatReplayWallClock is.
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
