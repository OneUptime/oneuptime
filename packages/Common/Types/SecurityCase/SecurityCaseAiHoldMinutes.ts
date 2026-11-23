/*
 * HOW LONG ONEUPTIME AI HOLDS A NEW SECURITY CASE'S ALERTS (#10353), alone:
 * the project's model reads the default for its column, and every page that
 * draws a project loads the model - so these import nothing, and the rest of
 * the hold's rules (SecurityCaseAiHold, which re-exports these) stay out of
 * those pages.
 */

// How long a case is held when the project picked none, and the bounds of any.
export const SECURITY_CASE_AI_HOLD_MINUTES_DEFAULT: number = 10;
export const SECURITY_CASE_AI_HOLD_MINUTES_MIN: number = 1;
export const SECURITY_CASE_AI_HOLD_MINUTES_MAX: number = 30;

// The hold times the settings page offers.
export const SECURITY_CASE_AI_HOLD_MINUTES_CHOICES: ReadonlyArray<number> = [
  5, 10, 15, 20, 30,
];

/*
 * The hold time a project's column gives: whole minutes within the bounds,
 * the default for none - a value written through the API never holds a
 * case longer than the most.
 */
export function getSecurityCaseAiHoldMinutes(
  value: number | null | undefined,
): number {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return SECURITY_CASE_AI_HOLD_MINUTES_DEFAULT;
  }

  return Math.min(
    SECURITY_CASE_AI_HOLD_MINUTES_MAX,
    Math.max(SECURITY_CASE_AI_HOLD_MINUTES_MIN, Math.round(value)),
  );
}
