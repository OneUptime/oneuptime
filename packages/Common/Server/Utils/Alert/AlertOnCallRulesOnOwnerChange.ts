import Alert from "../../../Models/DatabaseModels/Alert";
import ObjectID from "../../../Types/ObjectID";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
import AlertOnCallRuleEngineService from "../../Services/AlertOnCallRuleEngineService";
import AlertService from "../../Services/AlertService";
import OnCallDutyPolicyService from "../../Services/OnCallDutyPolicyService";
import Select from "../../Types/Database/Select";
import logger, { LogAttributes } from "../Logger";
import OnCallObserverPaging from "../OnCall/OnCallObserverPaging";
import { OnCallRulesPaging } from "../OnCall/OnCallRulePageAs";
import { OnCallRulePagingHold } from "../OnCall/OnCallRulePagingHold";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * AN ALERT'S ON-CALL RULES RUN AGAIN WHEN ITS OWNERS CHANGE (#9353).
 *
 * An alert on-call rule can match on who owns the alert: "Alert Owner has
 * any of Platform". Owners are often added after an alert is created - by
 * hand a minute later, by a workflow, from Slack - and an owner removed can
 * make "has none of" hold. So when a person or a team is added to, or taken
 * off, the owners of an alert that is still going on, the on-call rules
 * with an Alert Owner condition run again, and a rule the alert now matches
 * pages its policies as it would have had the alert been created that way:
 *
 *   - a responder policy the alert does not have is added to it and pages
 *     responders; an observer policy that has not paged about the alert
 *     pages as observers (OnCallRulePageAs);
 *   - a rule set to After OneUptime AI pages right away: OneUptime AI
 *     responds first to new alerts only;
 *   - the alert's feed says the rule now matches it, and why.
 *
 * A workspace rule's Alert Owner condition does the same for channels: an
 * owner's arrival is posted, and the post checks the rules again (#7583).
 *
 * Only rules with an Alert Owner condition run: nothing else they match on
 * changed. Nothing is undone - a page is not taken back because an owner
 * left. A resolved alert runs nothing.
 *
 * The owners an alert is created with - picked on its form, or added by its
 * owner rules - are in before its on-call rules first run, so those rules
 * see them already: while this process creates the alert, an owner it adds
 * runs nothing here (startCreating / finishCreating). An owner added from
 * elsewhere in that moment is safe too: a policy is attached to the alert
 * once, and only the run that attached it pages it.
 *
 * Rules run for one change of an alert at a time, under a lock, so two
 * owners added in a row page a newly matched policy once: the second reads
 * the alert as the first left it. Never throws: a run that fails is logged,
 * and the owner change stands.
 */

const LOCK_NAMESPACE: string = "alert-on-call-rules-on-owner-change";

// What the feed says after "The alert now matches it:".
export const OWNERS_CHANGED_REASON: string = "its owners changed";

/*
 * How long an alert counts as being created, at most: its create chain says
 * when it is done, and this only keeps a chain that never did from holding
 * the alert's owner changes back for good.
 */
const CREATING_AT_MOST_MS: number = 10 * 60 * 1000;

// The alerts this process is creating, by id, until when.
const alertsBeingCreated: Map<string, number> = new Map();

// The alert as the rules read it, with the on-call policies it has.
const getAlertSelect: () => Select<Alert> = (): Select<Alert> => {
  return {
    _id: true,
    projectId: true,
    title: true,
    description: true,
    alertSeverityId: true,
    monitorId: true,
    labels: { _id: true },
    onCallDutyPolicies: { _id: true },
  };
};

export default class AlertOnCallRulesOnOwnerChange {
  // The alert's create chain begins: the owners it adds run nothing here.
  public static startCreating(alertId: ObjectID | null | undefined): void {
    if (!alertId) {
      return;
    }

    alertsBeingCreated.set(
      alertId.toString().toLowerCase(),
      Date.now() + CREATING_AT_MOST_MS,
    );
  }

  // Its on-call rules have run: owner changes from now on run them again.
  public static finishCreating(alertId: ObjectID | null | undefined): void {
    if (!alertId) {
      return;
    }

    alertsBeingCreated.delete(alertId.toString().toLowerCase());
  }

  public static isBeingCreated(alertId: ObjectID): boolean {
    const key: string = alertId.toString().toLowerCase();
    const until: number | undefined = alertsBeingCreated.get(key);

    if (until === undefined) {
      return false;
    }

    if (until < Date.now()) {
      alertsBeingCreated.delete(key);
      return false;
    }

    return true;
  }

  /*
   * A person or a team was added to, or taken off, the owners of an alert.
   * Waited for by the owner tables' hooks, which run after the change is
   * written; never throws.
   */
  @CaptureSpan()
  public static async onOwnersChanged(data: {
    alertId: ObjectID | null | undefined;
    projectId: ObjectID | null | undefined;
  }): Promise<void> {
    if (!data.alertId || !data.projectId) {
      return;
    }

    if (this.isBeingCreated(data.alertId)) {
      return;
    }

    const alertId: ObjectID = data.alertId;

    const logAttributes: LogAttributes = {
      projectId: data.projectId.toString(),
      alertId: alertId.toString(),
    } as LogAttributes;

    try {
      // A project with no rule that asks who owns an alert runs nothing.
      if (
        !(await AlertOnCallRuleEngineService.hasRulesWithOwnerCondition(
          data.projectId,
        ))
      ) {
        return;
      }
    } catch (err) {
      logger.error(
        `Could not read the on-call rules of alert ${alertId.toString()}'s project after its owners changed.`,
        logAttributes,
      );
      logger.error(err as Error, logAttributes);
      return;
    }

    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: alertId.toString(),
        namespace: LOCK_NAMESPACE,
        lockTimeout: 2 * 60 * 1000,
        acquireTimeout: 60 * 1000,
      });
    } catch (err) {
      logger.warn(
        `Could not take the lock to run alert ${alertId.toString()}'s on-call rules again after its owners changed; running them without it: ${err}`,
        logAttributes,
      );
    }

    try {
      await this.runRulesAgain({
        alertId: alertId,
        logAttributes: logAttributes,
      });
    } catch (err) {
      logger.error(
        `Could not run alert ${alertId.toString()}'s on-call rules again after its owners changed.`,
        logAttributes,
      );
      logger.error(err as Error, logAttributes);
    } finally {
      if (mutex) {
        try {
          await Semaphore.release(mutex);
        } catch (err) {
          logger.error(
            `Could not release the lock of alert ${alertId.toString()}'s on-call rules: ${err}`,
            logAttributes,
          );
        }
      }
    }
  }

  private static async runRulesAgain(data: {
    alertId: ObjectID;
    logAttributes: LogAttributes;
  }): Promise<void> {
    if (await AlertService.isAlertResolved({ alertId: data.alertId })) {
      return;
    }

    // Read after the lock: as the change before this one left it.
    const alert: Alert | null = await AlertService.findOneById({
      id: data.alertId,
      select: getAlertSelect(),
      props: {
        isRoot: true,
      },
    });

    if (!alert || !alert.id || !alert.projectId) {
      return;
    }

    const paging: OnCallRulesPaging =
      await AlertOnCallRuleEngineService.applyRulesToAlert(alert, {
        reason: OWNERS_CHANGED_REASON,
        onlyOwnerRules: true,
      });

    await this.pageAddedPolicies({
      alert: alert,
      paging: paging,
      logAttributes: data.logAttributes,
    });

    if (paging.observerPolicyIds.length > 0) {
      await OnCallObserverPaging.pagePolicies({
        projectId: alert.projectId,
        policyIds: paging.observerPolicyIds,
        holds: paging.holds,
        record: {
          triggeredByAlertId: alert.id,
          userNotificationEventType: UserNotificationEventType.AlertCreated,
        },
        // People who were paged about the alert know about it.
        skipPoliciesPagedBefore: true,
      });
    }
  }

  // The responder policies the rules added to the alert page now.
  private static async pageAddedPolicies(data: {
    alert: Alert;
    paging: OnCallRulesPaging;
    logAttributes: LogAttributes;
  }): Promise<void> {
    await Promise.allSettled(
      data.paging.addedPolicyIds.map(async (policyId: string) => {
        const hold: OnCallRulePagingHold | undefined =
          data.paging.holds.get(policyId);

        try {
          await OnCallDutyPolicyService.executePolicy(new ObjectID(policyId), {
            triggeredByAlertId: data.alert.id!,
            userNotificationEventType: UserNotificationEventType.AlertCreated,
            ...(hold
              ? {
                  pagingStartsAt: hold.pagingStartsAt,
                  waitingStatusMessage: hold.waitingStatusMessage,
                  isAiHold: hold.isAiHold,
                }
              : {}),
          });
        } catch (err) {
          logger.error(
            `Could not page on-call policy ${policyId}, which alert ${data.alert.id!.toString()} now matches a rule for.`,
            data.logAttributes,
          );
          logger.error(err as Error, data.logAttributes);
        }
      }),
    );
  }
}
