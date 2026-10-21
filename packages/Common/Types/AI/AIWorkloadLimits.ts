/*
 * The limits a project may put on how much autonomous AI work runs, and what
 * each one means when it is left unset.
 *
 * Every one of them is opt-in, and unset means no limit, so AI works out of
 * the box: every incident and alert is investigated whatever its severity, a
 * repeat signal from the same monitor is investigated again, an investigation
 * starts as soon as it is queued however many are already running, and fix
 * tasks and their pull requests are opened as often as the work calls for. A
 * project that wants a ceiling sets one — per lane under Incidents or Alerts →
 * AI → Settings, and per repository for open AI pull requests. The
 * investigation time limit (AIAgentRunLimits) and the daily token limits
 * follow the same rule.
 */

// The longest re-investigation cooldown a project may set.
export const MAX_AI_INVESTIGATION_COOLDOWN_IN_MINUTES: number = 24 * 60;

/*
 * The fewest concurrent investigations a set cap allows. Pausing has its own
 * switches (the automatic investigation toggles, a daily token limit of 0),
 * so a cap of 0 reads as 1 rather than as "never run".
 */
export const MIN_AI_MAX_CONCURRENT_INVESTIGATIONS: number = 1;

export default class AIWorkloadLimits {
  /*
   * How many investigations one lane may run at once, from the project's
   * stored value. Null means no cap. A set value is floored at
   * MIN_AI_MAX_CONCURRENT_INVESTIGATIONS and otherwise kept: there is no
   * ceiling on a cap a project asks for.
   */
  public static getMaxConcurrentInvestigations(
    value: number | string | null | undefined,
  ): number | null {
    const configured: number | null = this.toNumber(value);

    if (configured === null) {
      return null;
    }

    return Math.max(
      MIN_AI_MAX_CONCURRENT_INVESTIGATIONS,
      Math.floor(configured),
    );
  }

  /*
   * How long, in minutes, a monitor that was just investigated is left alone
   * before a repeat signal is investigated again. 0 means no cooldown, which
   * is what unset, zero and negative values all read as; a set value is
   * clamped to MAX_AI_INVESTIGATION_COOLDOWN_IN_MINUTES.
   */
  public static getCooldownInMinutes(
    value: number | string | null | undefined,
  ): number {
    const configured: number | null = this.toNumber(value);

    if (configured === null || configured <= 0) {
      return 0;
    }

    return Math.min(
      MAX_AI_INVESTIGATION_COOLDOWN_IN_MINUTES,
      Math.floor(configured),
    );
  }

  // A stored value as a usable number, or null when there is none.
  private static toNumber(
    value: number | string | null | undefined,
  ): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    const parsed: number =
      typeof value === "number" ? value : Number.parseFloat(value);

    return Number.isFinite(parsed) ? parsed : null;
  }
}
