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
 */

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
 * "current / total" for the controls row. Tenths only while paused: at
 * 1x the decimal would flicker ten times a second and read as noise.
 */
export function formatReplayClock(
  currentTimeMs: number,
  durationMs: number,
  isPaused: boolean,
): string {
  const current: string = isPaused
    ? formatReplayOffsetPrecise(currentTimeMs)
    : formatReplayOffset(currentTimeMs);

  return `${current} / ${formatReplayOffset(durationMs)}`;
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
 * The ?t= value for "copy link at this moment": whole seconds, floored,
 * so the link lands at or before the moment the viewer was looking at.
 * Decimals are READ by the URL parser (ReplayPlayerUrlState) but never
 * written, so every link a human sees is short.
 */
export function toReplayUrlSeconds(offsetMs: number): number {
  return toWholeSeconds(offsetMs);
}
