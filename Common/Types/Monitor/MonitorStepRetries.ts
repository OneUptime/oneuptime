/*
 * One rule for reading the per-type "Retries" value that DNS, DNSSEC, Domain,
 * External Status Page and SNMP monitor steps keep in their own config.
 *
 * Retries count attempts AFTER the first one: 0 runs the check once and does
 * not retry, 2 runs it up to three times. That makes 0 a real answer, not an
 * absent one. Both the JSON parsers and the dashboard forms used to read the
 * value with `||`, which quietly turned a saved or typed 0 back into 3 — so
 * "no retries" could not be expressed at all.
 *
 * These helpers keep 0 and fall back only for values that are not a usable
 * count, which is how MonitorRetry.resolveRetries resolves the same value on
 * the probe.
 */

/*
 * Reads a stored retries value out of a monitor step's JSON. Missing, null,
 * non-numeric, NaN and negative values are not counts a user could have meant,
 * so they take the type's default; everything else is kept, 0 included.
 */
export const parseMonitorStepRetries: (
  value: unknown,
  defaultRetries: number,
) => number = (value: unknown, defaultRetries: number): number => {
  /*
   * Older rows (and Terraform or API callers) can carry the count as a string.
   * `||` used to pass those straight through as a fake number, so read them as
   * the number they spell instead.
   */
  const parsed: unknown =
    typeof value === "string" && value.trim().length > 0
      ? Number(value.trim())
      : value;

  // Number.isFinite is false for NaN and for both infinities.
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed < 0) {
    return defaultRetries;
  }

  return Math.floor(parsed);
};

/*
 * Reads what a user typed into a "Retries" number input. An empty or
 * non-numeric box means "I did not choose", so it takes the type's default; a
 * negative number is read as no retries rather than thrown away.
 */
export const parseMonitorStepRetriesInput: (
  value: string,
  defaultRetries: number,
) => number = (value: string, defaultRetries: number): number => {
  const parsed: number = parseInt(value, 10);

  if (isNaN(parsed)) {
    return defaultRetries;
  }

  return parsed < 0 ? 0 : parsed;
};
