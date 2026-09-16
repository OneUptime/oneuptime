/*
 * One rule for "should this failed attempt be retried?", shared by every
 * probe monitor type.
 *
 * A retry value counts retries AFTER the first attempt, not total attempts:
 * 0 runs the check once, 2 runs it up to three times. That is what "Retries on
 * Failure" on the monitor step, the per-type "Retries" fields,
 * PROBE_MONITOR_RETRY_LIMIT and the Terraform retry_count all promise.
 *
 * The monitor utils used to compare their 1-based attempt number against the
 * value with `<`, which quietly made it a total-attempt count (0 and 1 both ran
 * once, 3 ran three times), and several read it with `||`, which turned an
 * explicit 0 into three or five attempts.
 */
export default class MonitorRetry {
  public static canRetry(data: {
    /*
     * 1-based number of the attempt that just failed. Callers that track it
     * from zero are read as the first attempt, so "0 retries" can never be
     * talked into a second one.
     */
    attemptNumber: number;
    // Retries the caller asked for. undefined means "use defaultRetries".
    retries: number | undefined | null;
    /*
     * Retries when the caller passed none. Callers without a configured value
     * (the probe's own online checks, background polling) pick this so their
     * attempt count is unchanged by the switch to retry semantics.
     */
    defaultRetries: number;
  }): boolean {
    const attemptNumber: number = Number.isFinite(data.attemptNumber)
      ? Math.max(1, Math.floor(data.attemptNumber))
      : 1;

    return attemptNumber <= MonitorRetry.resolveRetries(data);
  }

  public static resolveRetries(data: {
    retries: number | undefined | null;
    defaultRetries: number;
  }): number {
    const retries: number | undefined | null = data.retries;

    /*
     * ?? semantics, not ||: zero retries is a real answer and must not fall
     * back to the default. Anything that is not a usable count does.
     */
    if (
      retries === undefined ||
      retries === null ||
      !Number.isFinite(retries) ||
      retries < 0
    ) {
      return data.defaultRetries;
    }

    return Math.floor(retries);
  }
}
