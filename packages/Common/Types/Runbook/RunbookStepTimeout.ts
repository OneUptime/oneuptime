/*
 * Timeouts are configured per step and stored on the step config in
 * milliseconds. Both the dashboard (which edits them) and the Worker (which
 * enforces them) resolve values through this module so a step never runs with
 * a bound the author could not see, and never with one that would pin a
 * Worker slot open indefinitely.
 */

// How long the step itself may run before it is killed.
export const DEFAULT_STEP_EXECUTION_TIMEOUT_IN_MS: number = 30 * 1000;
export const MIN_STEP_EXECUTION_TIMEOUT_IN_MS: number = 1000;
export const MAX_STEP_EXECUTION_TIMEOUT_IN_MS: number = 60 * 60 * 1000;

/*
 * How long the Worker waits for the selected agent to claim the job. Only
 * meaningful for Bash and JavaScript steps, which never run on the Worker.
 */
export const DEFAULT_AGENT_CLAIM_TIMEOUT_IN_MS: number = 2 * 60 * 1000;
export const MIN_AGENT_CLAIM_TIMEOUT_IN_MS: number = 1000;
export const MAX_AGENT_CLAIM_TIMEOUT_IN_MS: number = 60 * 60 * 1000;

export interface TimeoutBounds {
  defaultInMs: number;
  minInMs: number;
  maxInMs: number;
}

export const STEP_EXECUTION_TIMEOUT_BOUNDS: TimeoutBounds = {
  defaultInMs: DEFAULT_STEP_EXECUTION_TIMEOUT_IN_MS,
  minInMs: MIN_STEP_EXECUTION_TIMEOUT_IN_MS,
  maxInMs: MAX_STEP_EXECUTION_TIMEOUT_IN_MS,
};

export const AGENT_CLAIM_TIMEOUT_BOUNDS: TimeoutBounds = {
  defaultInMs: DEFAULT_AGENT_CLAIM_TIMEOUT_IN_MS,
  minInMs: MIN_AGENT_CLAIM_TIMEOUT_IN_MS,
  maxInMs: MAX_AGENT_CLAIM_TIMEOUT_IN_MS,
};

/*
 * Resolve a configured timeout to the value execution should actually use.
 *
 * Anything unusable — unset, blank, non-numeric, zero or negative — falls back
 * to the default rather than failing the step, because a runbook that runs
 * with the documented default is more useful during an incident than one that
 * refuses to run at all. Usable values are rounded to whole milliseconds and
 * clamped into range.
 */
export function resolveTimeoutInMs(
  value: number | string | null | undefined,
  bounds: TimeoutBounds,
): number {
  if (value === null || value === undefined || value === "") {
    return bounds.defaultInMs;
  }

  const parsed: number = typeof value === "number" ? value : Number(value);

  if (!isFinite(parsed) || parsed <= 0) {
    return bounds.defaultInMs;
  }

  return Math.min(Math.max(Math.round(parsed), bounds.minInMs), bounds.maxInMs);
}

export function resolveStepExecutionTimeoutInMs(
  value: number | string | null | undefined,
): number {
  return resolveTimeoutInMs(value, STEP_EXECUTION_TIMEOUT_BOUNDS);
}

export function resolveAgentClaimTimeoutInMs(
  value: number | string | null | undefined,
): number {
  return resolveTimeoutInMs(value, AGENT_CLAIM_TIMEOUT_BOUNDS);
}

/*
 * Milliseconds are the storage unit; seconds are what people think in. The
 * two helpers below bridge the step editor's seconds input and the stored
 * value. An empty input means "unset" — the step then uses the default — so
 * it round-trips to undefined rather than to zero.
 */
export function timeoutInMsToSecondsInputValue(
  value: number | null | undefined,
): string {
  if (value === null || value === undefined || !isFinite(Number(value))) {
    return "";
  }

  const seconds: number = Number(value) / 1000;

  if (seconds <= 0) {
    return "";
  }

  // Sub-second values would render as "0" and read as "no timeout"; keep the decimal.
  return String(Math.round(seconds * 1000) / 1000);
}

export function secondsInputValueToTimeoutInMs(
  value: string,
): number | undefined {
  const trimmed: string = (value || "").trim();

  if (!trimmed) {
    return undefined;
  }

  const seconds: number = Number(trimmed);

  if (!isFinite(seconds) || seconds <= 0) {
    return undefined;
  }

  const inMs: number = Math.round(seconds * 1000);

  /*
   * Sub-half-millisecond input rounds to zero. Zero is not a timeout, so it
   * reports as unset like any other unusable value — storing a literal 0 would
   * put a number in the step config that means nothing.
   */
  if (inMs <= 0) {
    return undefined;
  }

  return inMs;
}

/*
 * Shown when the field holds something that is not a number at all. Lives here
 * rather than in the editor so the message the browser's own parse failure
 * produces is the same one this validator produces.
 */
export const NON_NUMERIC_TIMEOUT_MESSAGE: string = "Enter a number of seconds.";

/*
 * Validation message for the step editor. Returns null when the input is
 * acceptable — including when it is blank, which simply means "use the
 * default". Out-of-range values are still saved and then clamped at run time;
 * the message is what tells the author that will happen.
 */
export function getTimeoutValidationError(
  value: string,
  bounds: TimeoutBounds,
): string | null {
  const trimmed: string = (value || "").trim();

  if (!trimmed) {
    return null;
  }

  const seconds: number = Number(trimmed);

  if (!isFinite(seconds)) {
    return NON_NUMERIC_TIMEOUT_MESSAGE;
  }

  const inMs: number = Math.round(seconds * 1000);

  /*
   * Zero, negatives, and anything that rounds down to zero milliseconds are
   * not timeouts. They fall back to the default rather than being clamped up,
   * so they get the same message.
   */
  if (seconds <= 0 || inMs <= 0) {
    return "Timeout must be greater than 0 seconds.";
  }

  if (inMs < bounds.minInMs) {
    return `Minimum is ${bounds.minInMs / 1000} second${
      bounds.minInMs === 1000 ? "" : "s"
    }.`;
  }

  if (inMs > bounds.maxInMs) {
    return `Maximum is ${bounds.maxInMs / 1000} seconds (${
      bounds.maxInMs / 60000
    } minutes).`;
  }

  return null;
}

/*
 * True when the input is a usable number that sits outside the bounds — the
 * only case where run time will clamp it. Unusable input (blank, zero, junk)
 * falls back to the default instead, which is the opposite end of the range,
 * so the editor must not promise clamping there.
 */
export function willTimeoutBeClamped(
  value: string,
  bounds: TimeoutBounds,
): boolean {
  const inMs: number | undefined = secondsInputValueToTimeoutInMs(value);

  if (inMs === undefined) {
    return false;
  }

  return inMs < bounds.minInMs || inMs > bounds.maxInMs;
}
