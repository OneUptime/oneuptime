import FixProductionStatus from "../../../../Types/AI/FixProductionStatus";
import { IncidentAlertAiSubjectKind } from "../../../../Types/AI/IncidentAlertAiLogs";
import {
  FIX_PRODUCTION_THRESHOLDS,
  FixProductionVerdict,
  HOUR_IN_MS,
  capitalize,
  describeDuration,
  fitVerdict,
  formatCount,
  watchedMilliseconds,
} from "./FixProductionVerdict";

/*
 * Whether a merged AI fix of an incident's or an alert's root cause stopped
 * it in production - the pure decisions behind RecurrenceFixWatch, so every
 * threshold is pinned by tests.
 *
 * A fix opened from an investigation (FixFromIncident) is for something a
 * monitor raised. Once a recorded deploy ships it, the monitor's incidents
 * (or alerts) are counted - created after the rollout grace - against how
 * often it raised them in the month before the merge, the exception rule
 * with incidents for occurrences:
 *
 *   - any new one is Regressed: the fix did not stop it, however long it
 *     was quiet before;
 *   - quiet for a day, and long enough that at its rate before it would
 *     have raised minExpectedRecurrences, is Verified;
 *   - quiet for maxWatchDays without that - a monitor that rarely fires - is
 *     Unverifiable.
 *
 * A monitor does not raise another incident while one of its own is still
 * open, so quiet then says nothing: nothing is Verified while one is open,
 * quiet time counts from the last check that found one open, and a watch
 * that ends with one open is Unverifiable.
 */

export const RECURRENCE_FIX_THRESHOLDS: {
  readonly rolloutGraceMinutes: number;
  readonly minWatchHours: number;
  readonly maxWatchDays: number;
  /*
   * How many incidents the monitor's rate before the fix must predict for
   * the watched time before their absence shows the fix works.
   */
  readonly minExpectedRecurrences: number;
  /*
   * The window before the merge that measures how often the monitor raised
   * them: a month, since monitors raise incidents far less often than code
   * throws exceptions.
   */
  readonly baselineDays: number;
} = {
  rolloutGraceMinutes: FIX_PRODUCTION_THRESHOLDS.rolloutGraceMinutes,
  minWatchHours: FIX_PRODUCTION_THRESHOLDS.minWatchHours,
  maxWatchDays: 14,
  minExpectedRecurrences: FIX_PRODUCTION_THRESHOLDS.minExpectedOccurrences,
  baselineDays: 30,
};

// "incident" / "incidents", "alert" / "alerts".
function describeSubjects(
  count: number,
  kind: IncidentAlertAiSubjectKind,
): string {
  return count === 1 ? `1 ${kind}` : `${formatCount(count)} ${kind}s`;
}

export function decideRecurrenceVerdict(data: {
  deployedAt: Date;
  now: Date;
  subjectKind: IncidentAlertAiSubjectKind;
  // Incidents (or alerts) the monitors raised since the rollout grace.
  recurrences: number;
  // How the first of them is named ("INC-57", "#57"), when there is one.
  firstRecurrenceLabel?: string | undefined;
  // Incidents (or alerts) the monitors raised in the baselineDays before the merge.
  baselineCount: number;
  // Whether one of the monitors' incidents (or alerts) is still open.
  hasOpenSubject: boolean;
  /*
   * The last check that found one open after the deploy: the monitor could
   * raise none before it, so quiet time counts from then.
   */
  openSeenAt?: Date | undefined;
  // describeDeploy's words for the deploy.
  deployLabel: string;
  // Who raises them: 'monitor "API health"', or "its monitors".
  monitorLabel: string;
}): FixProductionVerdict {
  const thresholds: typeof RECURRENCE_FIX_THRESHOLDS =
    RECURRENCE_FIX_THRESHOLDS;
  const kind: IncidentAlertAiSubjectKind = data.subjectKind;
  const monitor: string = capitalize(data.monitorLabel);

  if (data.recurrences > 0) {
    const which: string =
      data.recurrences === 1
        ? `${kind}${data.firstRecurrenceLabel ? ` ${data.firstRecurrenceLabel}` : ""}`
        : `${describeSubjects(data.recurrences, kind)}${
            data.firstRecurrenceLabel
              ? `, the first ${data.firstRecurrenceLabel},`
              : ""
          }`;

    return fitVerdict({
      status: FixProductionStatus.Regressed,
      summary: `${monitor} raised ${which} after ${data.deployLabel} shipped the fix, so the fix did not stop it.`,
    });
  }

  const watched: number = watchedMilliseconds({
    deployedAt: data.deployedAt,
    now: data.now,
    rolloutGraceMinutes: thresholds.rolloutGraceMinutes,
  });
  const isOver: boolean = watched >= thresholds.maxWatchDays * 24 * HOUR_IN_MS;
  // Quiet time: since the rollout grace, or since one was last seen open.
  const quiet: number = data.openSeenAt
    ? Math.min(watched, Math.max(0, data.now.getTime() - data.openSeenAt.getTime()))
    : watched;
  const quietHours: number = quiet / HOUR_IN_MS;
  const expected: number =
    (data.baselineCount / (thresholds.baselineDays * 24)) * quietHours;
  const before: string = `it raised ${describeSubjects(
    data.baselineCount,
    kind,
  )} in the ${thresholds.baselineDays} days before the fix`;

  if (data.hasOpenSubject) {
    if (isOver) {
      return fitVerdict({
        status: FixProductionStatus.Unverifiable,
        summary: `An ${kind} of ${data.monitorLabel} stayed open through the ${describeDuration(
          watched,
        )} since ${data.deployLabel} shipped the fix, and a monitor raises no other while one is open: whether the fix stopped it cannot be told.`,
      });
    }

    return fitVerdict({
      status: FixProductionStatus.Watching,
      summary: `${capitalize(data.deployLabel)} shipped the fix. ${monitor} has raised no ${kind} since, but one of its ${kind}s is still open, and it raises no other while one is; ${before}.`,
    });
  }

  // How long it has been quiet, and since what.
  const quietWords: string = `in the ${describeDuration(quiet)} since ${
    quiet < watched ? `its last ${kind} closed` : `${data.deployLabel} shipped the fix`
  }`;

  if (
    quietHours >= thresholds.minWatchHours &&
    expected >= thresholds.minExpectedRecurrences
  ) {
    return fitVerdict({
      status: FixProductionStatus.Verified,
      summary: `${monitor} raised no ${kind} ${quietWords}; ${before}.`,
    });
  }

  if (isOver) {
    return fitVerdict({
      status: FixProductionStatus.Unverifiable,
      summary: `${monitor} raised no ${kind} ${quietWords}, but ${before}: too rare for its absence to show the fix works.`,
    });
  }

  // Worded the same on every check, so a check that learns nothing writes nothing.
  return fitVerdict({
    status: FixProductionStatus.Watching,
    summary: `${capitalize(data.deployLabel)} shipped the fix, and ${data.monitorLabel} has raised no ${kind} since; ${before}.`,
  });
}
