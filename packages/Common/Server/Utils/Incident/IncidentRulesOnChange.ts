import Incident from "../../../Models/DatabaseModels/Incident";
import ObjectID from "../../../Types/ObjectID";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
import IncidentOnCallRuleEngineService from "../../Services/IncidentOnCallRuleEngineService";
import IncidentOwnerRuleEngineService from "../../Services/IncidentOwnerRuleEngineService";
import IncidentService from "../../Services/IncidentService";
import OnCallDutyPolicyService from "../../Services/OnCallDutyPolicyService";
import Select from "../../Types/Database/Select";
import logger, { LogAttributes } from "../Logger";
import OnCallObserverPaging from "../OnCall/OnCallObserverPaging";
import { OnCallRulesPaging } from "../OnCall/OnCallRulePageAs";
import { OnCallRulePagingHold } from "../OnCall/OnCallRulePagingHold";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * AN INCIDENT'S RULES RUN AGAIN WHEN ITS SEVERITY OR LABELS CHANGE.
 *
 * An incident's owner and on-call rules run when it is declared. Incidents
 * change while they go on: one declared Sev 3 is raised to Sev 1 once its
 * reach is known, or labelled org-wide. A rule written for Sev 1, or for
 * org-wide incidents, then does what it says - assigns its owners, pages its
 * policies - as it would have had the incident been declared that way. That
 * is how a response is tiered: an oversight team is told about every Sev 1,
 * and takes an incident over once it is org-wide.
 *
 * So when an incident that is still going on changes severity or labels,
 * its rules run again, and what they newly do is done:
 *
 *   - an owner rule it now matches adds those of its owners the incident
 *     does not have, notified as the rule says;
 *
 *   - an on-call rule it now matches pages its policies: a responder policy
 *     the incident does not have is added to it and pages responders - also
 *     one that paged about it as observers before, since being asked to
 *     respond is new; an observer policy that has not paged about the
 *     incident at all pages as observers (OnCallRulePageAs). A rule set to
 *     After OneUptime AI pages right away: OneUptime AI responds first to new
 *     incidents only.
 *
 * Each says so in the incident's feed: the rule now matches it, and why.
 *
 * Nothing is undone. An owner stays, and a run goes on, when the incident
 * stops matching - a page is not taken back because the severity was
 * lowered. Title, description and monitor changes do not run the rules
 * again: people fix a title as they learn more, and that is not a reason to
 * page anybody. A resolved incident runs nothing.
 *
 * Rules run for one change of an incident at a time, under a lock, so two
 * changes in a row page a newly matched policy once: the second reads the
 * incident as the first left it. Never throws: a run that fails is logged,
 * and the change stands.
 */

const LOCK_NAMESPACE: string = "incident-rules-on-change";

/*
 * The incident as the rules read it: every column either engine matches on,
 * and the on-call policies it has, which the on-call rules leave alone. Read
 * when asked, not when this file loads: the services load after it.
 */
const getIncidentSelect: () => Select<Incident> = (): Select<Incident> => {
  return {
    ...IncidentOwnerRuleEngineService.resourceSelectForRuleRun,
    onCallDutyPolicies: { _id: true },
  };
};

export interface IncidentRuleInputChange {
  isSeverityChanged: boolean;
  isLabelsChanged: boolean;
}

export default class IncidentRulesOnChange {
  /*
   * Why the rules ran again, as the feed says it after "The incident now
   * matches it:" - "its severity changed", "its labels changed", "its
   * severity and labels changed". Empty when neither changed.
   */
  public static describeChange(change: IncidentRuleInputChange): string {
    if (change.isSeverityChanged && change.isLabelsChanged) {
      return "its severity and labels changed";
    }

    if (change.isSeverityChanged) {
      return "its severity changed";
    }

    if (change.isLabelsChanged) {
      return "its labels changed";
    }

    return "";
  }

  // Whether a change is one the rules run again for.
  public static isRuleRerunChange(change: IncidentRuleInputChange): boolean {
    return change.isSeverityChanged || change.isLabelsChanged;
  }

  @CaptureSpan()
  public static async onIncidentChanged(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
    change: IncidentRuleInputChange;
  }): Promise<void> {
    if (!this.isRuleRerunChange(data.change)) {
      return;
    }

    const logAttributes: LogAttributes = {
      projectId: data.projectId.toString(),
      incidentId: data.incidentId.toString(),
    } as LogAttributes;

    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: data.incidentId.toString(),
        namespace: LOCK_NAMESPACE,
        lockTimeout: 2 * 60 * 1000,
        acquireTimeout: 60 * 1000,
      });
    } catch (err) {
      logger.warn(
        `Could not take the lock to run incident ${data.incidentId.toString()}'s rules again after it changed; running them without it: ${err}`,
        logAttributes,
      );
    }

    try {
      await this.runRulesAgain({
        incidentId: data.incidentId,
        ruleChange: this.describeChange(data.change),
        logAttributes: logAttributes,
      });
    } catch (err) {
      logger.error(
        `Could not run incident ${data.incidentId.toString()}'s rules again after it changed.`,
        logAttributes,
      );
      logger.error(err as Error, logAttributes);
    } finally {
      if (mutex) {
        try {
          await Semaphore.release(mutex);
        } catch (err) {
          logger.error(
            `Could not release the lock of incident ${data.incidentId.toString()}'s rules: ${err}`,
            logAttributes,
          );
        }
      }
    }
  }

  private static async runRulesAgain(data: {
    incidentId: ObjectID;
    ruleChange: string;
    logAttributes: LogAttributes;
  }): Promise<void> {
    if (
      await IncidentService.isIncidentResolved({
        incidentId: data.incidentId,
      })
    ) {
      return;
    }

    // Read after the lock: as the change before this one left it.
    const incident: Incident | null = await IncidentService.findOneById({
      id: data.incidentId,
      select: getIncidentSelect(),
      props: {
        isRoot: true,
      },
    });

    if (!incident || !incident.id || !incident.projectId) {
      return;
    }

    await IncidentOwnerRuleEngineService.applyRulesToIncident(
      incident,
      data.ruleChange,
    );

    const paging: OnCallRulesPaging =
      await IncidentOnCallRuleEngineService.applyRulesToIncident(
        incident,
        data.ruleChange,
      );

    await this.pageAddedPolicies({
      incident: incident,
      paging: paging,
      logAttributes: data.logAttributes,
    });

    if (paging.observerPolicyIds.length > 0) {
      await OnCallObserverPaging.pagePolicies({
        projectId: incident.projectId,
        policyIds: paging.observerPolicyIds,
        holds: paging.holds,
        record: {
          triggeredByIncidentId: incident.id,
          userNotificationEventType: UserNotificationEventType.IncidentCreated,
        },
        // People who were paged about the incident know about it.
        skipPoliciesPagedBefore: true,
      });
    }
  }

  // The responder policies the rules added to the incident page now.
  private static async pageAddedPolicies(data: {
    incident: Incident;
    paging: OnCallRulesPaging;
    logAttributes: LogAttributes;
  }): Promise<void> {
    await Promise.allSettled(
      data.paging.addedPolicyIds.map(async (policyId: string) => {
        const hold: OnCallRulePagingHold | undefined =
          data.paging.holds.get(policyId);

        try {
          await OnCallDutyPolicyService.executePolicy(new ObjectID(policyId), {
            triggeredByIncidentId: data.incident.id!,
            userNotificationEventType:
              UserNotificationEventType.IncidentCreated,
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
            `Could not page on-call policy ${policyId}, which incident ${data.incident.id!.toString()} now matches a rule for.`,
            data.logAttributes,
          );
          logger.error(err as Error, data.logAttributes);
        }
      }),
    );
  }
}
