/**
 * Compact duration rendering for error budgets.
 *
 * Error budgets span four orders of magnitude — a 99.99% / 7-day SLO gets
 * 60 seconds, a 99% / 90-day SLO gets 21.6 hours — so the "minutes only"
 * rendering the SLO pages started with reads badly at both ends: a
 * one-minute budget shows as "1 min", and a 90-day budget shows as
 * "1296 min of 1296 min". The docs quote budgets the way an SRE says them
 * out loud ("43m 12s", "2h 9m"), and this is the helper that produces
 * exactly that.
 *
 * Kept free of React (and of the database models) so the SLO pages, the
 * dashboard SLO widget and any future status-page surface can all share
 * one rendering, and so every rounding edge is unit-testable without a
 * DOM.
 */

/** U+2212 MINUS SIGN — reads as a minus rather than a hyphen at tile sizes. */
const MINUS_SIGN: string = "−";

/**
 * Seconds per unit, largest first. Only the two most significant non-zero
 * units are rendered: "2d 5h" is what an on-call engineer needs, "2d 5h
 * 13m 7s" is noise, and truncating rather than rounding up keeps the
 * remaining budget from ever reading larger than it is.
 */
const UNITS: Array<{ suffix: string; seconds: number }> = [
  { suffix: "d", seconds: 86400 },
  { suffix: "h", seconds: 3600 },
  { suffix: "m", seconds: 60 },
  { suffix: "s", seconds: 1 },
];

const MAX_UNITS_SHOWN: number = 2;

/**
 * `null` for anything that is not a real, finite number. The
 * worker-owned budget columns are NULL until the SLO is first evaluated,
 * and a Postgres decimal can arrive as a string over JSON, so the guard
 * has to reject non-numbers rather than coerce them.
 */
type ToFiniteNumberFunction = (
  value: number | undefined | null,
) => number | null;

const toFiniteNumber: ToFiniteNumberFunction = (
  value: number | undefined | null,
): number | null => {
  if (typeof value !== "number" || !isFinite(value)) {
    return null;
  }

  return value;
};

/**
 * An unsigned duration as "2d 5h" / "43m 12s" / "45s". Fractional seconds
 * are floored, so a 59.9-second budget renders "59s" rather than rounding
 * up to a minute the SLO does not actually have.
 *
 * A duration that floors to zero renders "0s" — a real, sayable state —
 * instead of an empty string.
 */
export type FormatDurationCompactFunction = (seconds: number) => string;

export const formatDurationCompact: FormatDurationCompactFunction = (
  seconds: number,
): string => {
  let remainingSeconds: number = Math.floor(Math.abs(seconds));

  const parts: Array<string> = [];

  for (const unit of UNITS) {
    if (parts.length >= MAX_UNITS_SHOWN) {
      break;
    }

    const count: number = Math.floor(remainingSeconds / unit.seconds);

    /*
     * Skip leading zero units ("0d 5h"), but once a larger unit has been
     * emitted a zero is still skipped rather than padded — "2d" is
     * correct for exactly 48 hours, "2d 0h" is not how anyone says it.
     */
    if (count <= 0) {
      continue;
    }

    parts.push(`${count}${unit.suffix}`);
    remainingSeconds -= count * unit.seconds;
  }

  if (parts.length === 0) {
    return "0s";
  }

  return parts.join(" ");
};

/**
 * `errorBudgetRemainingSeconds` is SIGNED: negative means the budget is
 * overspent, and that overage is the single most useful number during a
 * bad month. Render it plainly rather than clamping to zero, which would
 * hide a breach.
 *
 * Returns `null` (not a placeholder string) when the SLO has not been
 * evaluated, so callers decide how to phrase "no data yet" in their own
 * context.
 */
export type FormatErrorBudgetRemainingFunction = (
  seconds: number | undefined | null,
) => string | null;

export const formatErrorBudgetRemaining: FormatErrorBudgetRemainingFunction = (
  seconds: number | undefined | null,
): string | null => {
  const numericSeconds: number | null = toFiniteNumber(seconds);

  if (numericSeconds === null) {
    return null;
  }

  if (numericSeconds < 0) {
    return `${MINUS_SIGN}${formatDurationCompact(numericSeconds)} over budget`;
  }

  return `${formatDurationCompact(numericSeconds)} left`;
};

/**
 * "12m 30s left of 43m 12s" — the phrasing the error-budget docs use.
 * Falls back to the bare remaining string when the total is not known
 * (the two columns are written together by the worker, but a partially
 * evaluated row must not render "of null").
 */
export type FormatErrorBudgetRemainingOfTotalFunction = (data: {
  remainingSeconds: number | undefined | null;
  totalSeconds: number | undefined | null;
}) => string | null;

export const formatErrorBudgetRemainingOfTotal: FormatErrorBudgetRemainingOfTotalFunction =
  (data: {
    remainingSeconds: number | undefined | null;
    totalSeconds: number | undefined | null;
  }): string | null => {
    const remainingText: string | null = formatErrorBudgetRemaining(
      data.remainingSeconds,
    );

    if (remainingText === null) {
      return null;
    }

    const totalSeconds: number | null = toFiniteNumber(data.totalSeconds);

    /*
     * A zero total is a real state for a brand-new SLO (no elapsed window
     * yet). "of 0s" adds nothing, so drop the suffix rather than print it.
     */
    if (totalSeconds === null || totalSeconds <= 0) {
      return remainingText;
    }

    return `${remainingText} of ${formatDurationCompact(totalSeconds)}`;
  };
