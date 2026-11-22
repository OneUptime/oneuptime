import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import ObjectID from "../../../Types/ObjectID";
import MetricSeriesFingerprint from "../../../Utils/Metrics/MetricSeriesFingerprint";

/**
 * WHEN A GROUPED MONITOR COMES BACK (issue #10061).
 *
 * A monitor that judges each series on its own - a query with a Group By, a
 * PromQL expression, a criteria that names "*" for every disk or port - still
 * has one status. Every criteria is judged for every series, and a criteria
 * matches when one series meets it. That is right for a criteria that reports
 * a problem: one full disk is enough to take a host's monitor offline. It was
 * wrong for the criteria that brings the monitor back. A disk that was never
 * near full meets "at or below 81%" on every check, so as soon as the full
 * disk dropped under the 90% that fired - to 89% - the healthy disks brought
 * the monitor back online, and a disk hovering at the line flipped the status
 * at every crossing. The margin the templates put between firing and
 * recovering (DefaultRecoveryMarginFraction) did not hold.
 *
 * THE RULE
 *
 *   1. A recovery criteria only brings the monitor back: it is on, it changes
 *      the monitor's status to the monitor's Default Monitor Status, and it
 *      opens no incident or alert. A problem criteria changes the status to
 *      any other status. Both are read off the criteria alone (getRole), so
 *      the rule holds for the templates' pairs (RecommendationCriteriaBuilder),
 *      for criteria written by hand and for monitors made before it, whatever
 *      their thresholds.
 *   2. A series that meets a problem criteria is behind the monitor's status.
 *      It stays behind it, check after check, until it meets a recovery
 *      criteria - a disk at 89% after 96% is still behind it - or until a
 *      check that read other series no longer has it: an unmounted disk, a
 *      pod that is gone. Its incidents and alerts resolve then too, as no
 *      criteria finds it any more.
 *   3. A recovery criteria matches only when every series behind the status
 *      that it judges meets it. The other series - a disk that was never near
 *      full, a pod that only just appeared - count neither way.
 *   4. While a recovery criteria waits and no other criteria matches, the
 *      monitor keeps its status. It does not go to its Default Monitor Status
 *      either, which would bring it back all the same.
 *   5. A check that read no series at all says nothing of any of them: what is
 *      behind the status stays as it was. Silence is not recovery.
 *
 * Incidents and alerts are not affected: each one still resolves when its
 * series stops meeting the criteria that opened it, whatever the other series
 * do. A monitor that does not judge series on its own is not affected at all,
 * and neither is a criteria that judges a grouped monitor as a whole (a
 * Server or Network Device criteria that names no "*").
 *
 * WHY THESE SERIES, AND NOT EVERY SERIES
 *
 * "A recovery criteria matches only when every series meets it" keeps the
 * margin too, but lets a series that never breached hold the monitor down: on
 * a host whose root disk sits at 85% for months, a second disk that filled up
 * and was cleaned would leave the monitor offline for as long as the root disk
 * stays there, with no incident open and nothing to fix. The series behind the
 * status are the ones the status is about.
 *
 * WHY THEY ARE KEPT
 *
 * Which series are behind the status cannot be read off one check, nor off the
 * open incidents: a series' incident resolves as soon as the series stops
 * meeting the criteria that opened it, before the series is back past the
 * margin. So MonitorResource keeps them between checks (SeriesBehindStatus),
 * and this rule is told them. When that memory is lost - Redis was flushed,
 * the monitor was not checked for a week - a recovery criteria matches on any
 * series, as it did before this rule.
 *
 * EXTENDING IT
 *
 * judge() is the one place a series is let go (isLetGo): a criteria with a
 * recovery condition of its own would let its series go when they meet that
 * condition, next to the recovery criteria here.
 */

export enum GroupedCriteriaRole {
  // Changes the monitor's status to a status other than its default.
  Problem = "Problem",
  // Only brings the monitor back: its default status, and nothing opened.
  Recovery = "Recovery",
  // Changes no status, or brings the monitor back and opens records too.
  Other = "Other",
}

/*
 * How far the series behind a status are kept: a grouped monitor's 16,000
 * series could all breach at once. Past this, the rest are not remembered, and
 * a recovery criteria does not wait for them.
 */
export const MAX_SERIES_BEHIND_STATUS: number = 10_000;

// What one recovery criteria made of the series of one check.
export interface RecoveryCriteriaCheck {
  criteriaId: string;
  // The series it judged, by fingerprint: those the check read.
  judgedSeries: ReadonlySet<string>;
  // The series that met it.
  metSeries: ReadonlySet<string>;
}

// The series behind a grouped monitor's status before a check.
export interface SeriesBehindStatusReader {
  // Never throws: none when nothing is known.
  getSeries(): Promise<ReadonlySet<string>>;
}

export interface GroupedRecoveryJudgement {
  /*
   * Each recovery criteria that waits, with the series behind the status it
   * waits for: they did not meet it. A recovery criteria left out waits for
   * none.
   */
  waitingFor: Map<string, Array<string>>;
  /*
   * The series behind the status that met no recovery criteria on this check:
   * while no other criteria matches, they keep the monitor's status.
   */
  seriesKeepingStatus: Array<string>;
  // What is behind the status after this check, to keep for the next one.
  seriesBehindStatus: Array<string>;
}

export default class GroupedMonitorRecovery {
  /*
   * What a criteria is to this rule, read off the criteria alone. A criteria
   * that is off, or a monitor with no default status, plays no part.
   */
  public static getRole(input: {
    criteriaInstance: MonitorCriteriaInstance;
    defaultMonitorStatusId: ObjectID | undefined;
  }): GroupedCriteriaRole {
    const criteria: MonitorCriteriaInstance["data"] | undefined =
      input.criteriaInstance.data;

    if (
      !criteria ||
      criteria.isEnabled === false ||
      !criteria.changeMonitorStatus ||
      !criteria.monitorStatusId ||
      !input.defaultMonitorStatusId
    ) {
      return GroupedCriteriaRole.Other;
    }

    if (
      criteria.monitorStatusId.toString() !==
      input.defaultMonitorStatusId.toString()
    ) {
      return GroupedCriteriaRole.Problem;
    }

    return MonitorCriteriaInstance.opensRecords(criteria)
      ? GroupedCriteriaRole.Other
      : GroupedCriteriaRole.Recovery;
  }

  /*
   * A fingerprint that names a series. The whole monitor, which a criteria
   * that judges it as a whole matches as an entity of its own, is none: that
   * criteria's own verdict is its recovery.
   */
  public static isSeries(fingerprint: string | undefined): boolean {
    return (
      Boolean(fingerprint) &&
      fingerprint !== MetricSeriesFingerprint.WholeMonitorFingerprint
    );
  }

  /*
   * Which recovery criteria wait, which series keep the status, and what is
   * behind it after this check (THE RULE above). Pure: the caller reads the
   * series behind the status before, and keeps what this returns.
   */
  public static judge(input: {
    // Behind the status before this check: none when nothing is known.
    seriesBehindStatus: ReadonlySet<string>;
    // The series that met a problem criteria on this check.
    problemSeries: ReadonlySet<string>;
    recoveryCriteria: Array<RecoveryCriteriaCheck>;
  }): GroupedRecoveryJudgement {
    const before: Array<string> = Array.from(input.seriesBehindStatus).filter(
      (fingerprint: string): boolean => {
        return GroupedMonitorRecovery.isSeries(fingerprint);
      },
    );

    const problems: Array<string> = Array.from(input.problemSeries).filter(
      (fingerprint: string): boolean => {
        return GroupedMonitorRecovery.isSeries(fingerprint);
      },
    );

    // Every series behind the status on this check, the new ones included.
    const behind: Set<string> = new Set<string>([...before, ...problems]);

    const judged: Set<string> = new Set<string>();
    const met: Set<string> = new Set<string>();

    const waitingFor: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();

    for (const recovery of input.recoveryCriteria) {
      const waiting: Array<string> = [];

      for (const fingerprint of recovery.judgedSeries) {
        judged.add(fingerprint);

        if (behind.has(fingerprint) && !recovery.metSeries.has(fingerprint)) {
          waiting.push(fingerprint);
        }
      }

      for (const fingerprint of recovery.metSeries) {
        met.add(fingerprint);
      }

      if (waiting.length > 0) {
        waitingFor.set(recovery.criteriaId, waiting.sort());
      }
    }

    // A series is let go once it meets a recovery criteria, or is gone.
    const isLetGo: (fingerprint: string) => boolean = (
      fingerprint: string,
    ): boolean => {
      return met.has(fingerprint) || !judged.has(fingerprint);
    };

    const problemSet: Set<string> = new Set<string>(problems);

    const seriesKeepingStatus: Array<string> = Array.from(behind)
      .filter((fingerprint: string): boolean => {
        return !isLetGo(fingerprint);
      })
      .sort();

    /*
     * A check that read no series says nothing of the ones behind the status:
     * they stay, with any that met a problem criteria (rule 5).
     */
    const readAnySeries: boolean = judged.size > 0 || problems.length > 0;

    const after: Set<string> = readAnySeries
      ? new Set<string>([
          ...problems,
          ...before.filter((fingerprint: string): boolean => {
            return !problemSet.has(fingerprint) && !isLetGo(fingerprint);
          }),
        ])
      : behind;

    return {
      waitingFor: waitingFor,
      seriesKeepingStatus: seriesKeepingStatus,
      seriesBehindStatus: Array.from(after)
        .sort()
        .slice(0, MAX_SERIES_BEHIND_STATUS),
    };
  }
}
