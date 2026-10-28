import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import { SecurityCaseFeedEventType } from "../../../Models/DatabaseModels/SecurityCaseFeed";
import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseFeedService from "../../Services/SecurityCaseFeedService";
import SecurityCaseService from "../../Services/SecurityCaseService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import SecurityCaseNotifications, {
  isSetupTestCase,
} from "./SecurityCaseNotifications";
import SecurityCaseValues, {
  ProjectSecurityCaseValues,
} from "./SecurityCaseValues";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { Red500, Yellow500 } from "../../../Types/BrandColors";
import PartialEntity from "../../../Types/Database/PartialEntity";
import OneUptimeDate from "../../../Types/Date";
import SecurityCasePriorities from "../../../Utils/SecurityCase/SecurityCasePriorities";
import SecurityCaseStatuses from "../../../Utils/SecurityCase/SecurityCaseStatuses";
import {
  SecurityCaseTargetAlert,
  SecurityCaseTargetAlertKind,
  SecurityCaseTargetMoments,
  SecurityCaseTargetWrite,
  describeTargetDuration,
  getAlertStamps,
  getTargetAlertsDue,
  getTargetBookkeeping,
  getTargetVerb,
} from "../../../Utils/SecurityCase/SecurityCaseTargets";
import {
  targetAtRiskMarkdown,
  targetMissedMarkdown,
} from "../../../Utils/SecurityCase/SecurityCaseMarkdown";

/*
 * THE EVERY-MINUTE CHECK OF SECURITY CASES' RESPONSE TARGETS.
 *
 * A case keeps when the check must next look at it
 * (SecurityCase.nextTargetCheckAt: the moment its next target is about to
 * be missed, or is missed - SecurityCaseTargets), so the check reads only
 * the cases whose moment has come, by that column's index, the oldest
 * first. For each it works out what is due now (getTargetAlertsDue), and
 * records it in one compare-and-set with the case's next check time: of two
 * workers handed the same case, one says it and the other finds the moment
 * moved. Then the case's timeline says it, and the people are told
 * (SecurityCaseNotifications.targetAlert, queued: the worker sends it).
 *
 * A closed case has nothing left to say: its check time is cleared. So is
 * the setup test's case, which nobody is ever told about.
 */

// Cases read at once, and the most read in one run: 2,000 a minute.
export const SECURITY_CASE_TARGET_CHECK_BATCH_SIZE: number = 100;
export const SECURITY_CASE_TARGET_CHECK_MAX_BATCHES: number = 20;

// What the check reads of a case.
const CASE_SELECT: {
  _id: true;
  projectId: true;
  groupingKey: true;
  securityCaseStatusId: true;
  securityCasePriorityId: true;
  createdAt: true;
  acknowledgedAt: true;
  containedAt: true;
  closedAt: true;
  acknowledgeDueAt: true;
  containDueAt: true;
  acknowledgeWarnedAt: true;
  acknowledgeMissedAt: true;
  containWarnedAt: true;
  containMissedAt: true;
  nextDueAt: true;
  nextTargetCheckAt: true;
} = {
  _id: true,
  projectId: true,
  groupingKey: true,
  securityCaseStatusId: true,
  securityCasePriorityId: true,
  createdAt: true,
  acknowledgedAt: true,
  containedAt: true,
  closedAt: true,
  acknowledgeDueAt: true,
  containDueAt: true,
  acknowledgeWarnedAt: true,
  acknowledgeMissedAt: true,
  containWarnedAt: true,
  containMissedAt: true,
  nextDueAt: true,
  nextTargetCheckAt: true,
};

const MINUTE_IN_MS: number = 60 * 1000;

// A case as SecurityCaseTargets reads it.
function toMoments(securityCase: SecurityCase): SecurityCaseTargetMoments {
  return {
    createdAt: securityCase.createdAt || null,
    acknowledgedAt: securityCase.acknowledgedAt || null,
    containedAt: securityCase.containedAt || null,
    closedAt: securityCase.closedAt || null,
    acknowledgeDueAt: securityCase.acknowledgeDueAt || null,
    containDueAt: securityCase.containDueAt || null,
    acknowledgeWarnedAt: securityCase.acknowledgeWarnedAt || null,
    acknowledgeMissedAt: securityCase.acknowledgeMissedAt || null,
    containWarnedAt: securityCase.containWarnedAt || null,
    containMissedAt: securityCase.containMissedAt || null,
  };
}

// What one look at a case found: what to say, and what to write.
export interface SecurityCaseTargetCheckResult {
  alerts: Array<SecurityCaseTargetAlert>;
  write: SecurityCaseTargetWrite;
}

/*
 * One case at `now`, worked out without touching anything: the alerts due,
 * their stamps, and the case's next due time and check time after them. A
 * closed case, and the setup test's, say nothing and are checked no more.
 * A check time that would not move past `now` is put a minute on, so a case
 * the rules cannot settle is never read again and again in one run.
 */
export function getTargetCheckResult(data: {
  securityCase: SecurityCase;
  priority: SecurityCasePriority | null;
  isClosed: boolean;
  now: Date;
}): SecurityCaseTargetCheckResult {
  const moments: SecurityCaseTargetMoments = toMoments(data.securityCase);

  if (data.isClosed || isSetupTestCase(data.securityCase)) {
    return {
      alerts: [],
      write: {
        nextDueAt: null,
        nextTargetCheckAt: null,
      },
    };
  }

  const alerts: Array<SecurityCaseTargetAlert> = getTargetAlertsDue({
    securityCase: moments,
    priority: data.priority,
    now: data.now,
  });
  const stamps: SecurityCaseTargetWrite = getAlertStamps(alerts, data.now);
  const bookkeeping: {
    nextDueAt: Date | null;
    nextTargetCheckAt: Date | null;
  } = getTargetBookkeeping({
    securityCase: { ...moments, ...stamps },
    priority: data.priority,
  });

  let nextTargetCheckAt: Date | null = bookkeeping.nextTargetCheckAt;

  if (nextTargetCheckAt && nextTargetCheckAt.getTime() <= data.now.getTime()) {
    nextTargetCheckAt = new Date(data.now.getTime() + MINUTE_IN_MS);
  }

  return {
    alerts,
    write: {
      ...stamps,
      nextDueAt: bookkeeping.nextDueAt,
      nextTargetCheckAt,
    },
  };
}

export default class SecurityCaseTargetCheck {
  /*
   * Every case whose moment has come, at most a run's worth, the oldest
   * first. Returns how many cases were looked at.
   */
  @CaptureSpan()
  public static async checkDueCases(
    now: Date = OneUptimeDate.getCurrentDate(),
  ): Promise<number> {
    const valuesByProject: Map<string, ProjectSecurityCaseValues> = new Map();
    const seen: Set<string> = new Set();
    let checked: number = 0;

    for (
      let batch: number = 0;
      batch < SECURITY_CASE_TARGET_CHECK_MAX_BATCHES;
      batch++
    ) {
      const cases: Array<SecurityCase> = await SecurityCaseService.findBy({
        query: {
          nextTargetCheckAt: QueryHelper.lessThanEqualTo(now),
        },
        select: CASE_SELECT,
        sort: {
          nextTargetCheckAt: SortOrder.Ascending,
        },
        skip: 0,
        limit: SECURITY_CASE_TARGET_CHECK_BATCH_SIZE,
        props: {
          isRoot: true,
        },
      });

      // A case another worker holds may come back: each is looked at once a run.
      const fresh: Array<SecurityCase> = cases.filter(
        (securityCase: SecurityCase): boolean => {
          return Boolean(
            securityCase.id && !seen.has(securityCase.id.toString()),
          );
        },
      );

      if (fresh.length === 0) {
        break;
      }

      for (const securityCase of fresh) {
        seen.add(securityCase.id!.toString());

        try {
          await this.checkCase({ securityCase, now, valuesByProject });
        } catch (error) {
          logger.error(
            `SecurityCaseTargetCheck: could not check the targets of case ${securityCase.id!.toString()}:`,
          );
          logger.error(error);
        }

        checked++;
      }

      if (cases.length < SECURITY_CASE_TARGET_CHECK_BATCH_SIZE) {
        break;
      }
    }

    return checked;
  }

  /*
   * One case: what is due is stamped together with its next check time, in
   * one compare-and-set on the check time it was read with, then said on
   * its timeline and to its people. Returns the alerts said: none when
   * another worker had it first.
   */
  @CaptureSpan()
  public static async checkCase(data: {
    securityCase: SecurityCase;
    now: Date;
    valuesByProject?: Map<string, ProjectSecurityCaseValues> | undefined;
  }): Promise<Array<SecurityCaseTargetAlert>> {
    const { securityCase, now } = data;

    if (!securityCase.id || !securityCase.projectId) {
      return [];
    }

    const projectKey: string = securityCase.projectId.toString();
    let values: ProjectSecurityCaseValues | undefined =
      data.valuesByProject?.get(projectKey);

    if (!values) {
      values = await SecurityCaseValues.getForProject(securityCase.projectId);
      data.valuesByProject?.set(projectKey, values);
    }

    const priority: SecurityCasePriority | null = SecurityCasePriorities.find(
      values.priorities,
      securityCase.securityCasePriorityId,
    );
    const isClosed: boolean =
      Boolean(securityCase.closedAt) ||
      SecurityCaseStatuses.isClosed(
        values.statuses,
        securityCase.securityCaseStatusId,
      );

    const result: SecurityCaseTargetCheckResult = getTargetCheckResult({
      securityCase,
      priority,
      isClosed,
      now,
    });

    const isClaimed: boolean =
      await SecurityCaseService.compareAndSetColumnsByIdWithoutHooks({
        id: securityCase.id,
        data: result.write as unknown as PartialEntity<SecurityCase>,
        expectedData: {
          nextTargetCheckAt: (securityCase.nextTargetCheckAt ||
            null) as unknown as Date,
        },
        skipUpdateDateColumn: true,
      });

    if (!isClaimed) {
      return [];
    }

    for (const alert of result.alerts) {
      await this.say({
        securityCase,
        alert,
        now,
      });
    }

    return result.alerts;
  }

  // An alert on the case's timeline, and to its people.
  private static async say(data: {
    securityCase: SecurityCase;
    alert: SecurityCaseTargetAlert;
    now: Date;
  }): Promise<void> {
    const { securityCase, alert } = data;
    const verb: string = getTargetVerb(alert.target);
    const targetDuration: string | undefined =
      alert.targetInMinutes !== null
        ? describeTargetDuration(alert.targetInMinutes)
        : undefined;
    const isMissed: boolean = alert.kind === SecurityCaseTargetAlertKind.Missed;

    await SecurityCaseFeedService.createSecurityCaseFeedItem({
      projectId: securityCase.projectId!,
      securityCaseId: securityCase.id!,
      feedInfoInMarkdown: (isMissed
        ? targetMissedMarkdown({ target: verb, targetDuration })
        : targetAtRiskMarkdown({
            target: verb,
            targetDuration,
            timeLeft: describeTargetDuration(
              Math.max(
                1,
                Math.ceil(
                  (alert.dueAt.getTime() - data.now.getTime()) / MINUTE_IN_MS,
                ),
              ),
            ),
          })
      ).toString(),
      eventType: SecurityCaseFeedEventType.ResponseTarget,
      displayColor: isMissed ? Red500 : Yellow500,
      postedAt: data.now,
    });

    await SecurityCaseNotifications.targetAlert({
      projectId: securityCase.projectId!,
      securityCaseId: securityCase.id!,
      target: alert.target,
      alertKind: alert.kind,
    });
  }
}
