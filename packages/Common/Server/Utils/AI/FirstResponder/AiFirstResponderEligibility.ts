import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import Project from "../../../../Models/DatabaseModels/Project";
import { InvestigationNotStartedCode } from "../../../../Types/AI/InvestigationNotStartedReason";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import {
  KubernetesClusterAiAccessStatus,
  isUnattendedRemediationMode,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../../Types/ObjectID";
import {
  AI_HOLD_OUTAGE_RECORD_COUNT,
  AI_HOLD_OUTAGE_WINDOW_IN_MINUTES,
  AI_HOLD_RECURRENCE_WINDOW_IN_HOURS,
  AiHoldRecordKind,
  OnCallPolicyAiHoldOutcome,
} from "../../../../Types/OnCallDutyPolicy/OnCallPolicyAiHold";
import { isAiResourceType } from "../../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessStatus,
  isUnattendedResourceRemediationMode,
} from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import AlertService from "../../../Services/AlertService";
import AlertSeverityService from "../../../Services/AlertSeverityService";
import IncidentService from "../../../Services/IncidentService";
import IncidentSeverityService from "../../../Services/IncidentSeverityService";
import KubernetesClusterAiAccessService from "../../../Services/KubernetesClusterAiAccessService";
import OnCallDutyPolicyExecutionLogService from "../../../Services/OnCallDutyPolicyExecutionLogService";
import ProjectService, { CurrentPlan } from "../../../Services/ProjectService";
import ResourceAiAccessService from "../../../Services/ResourceAiAccessService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../../Logger";
import AIInvestigationEngine from "../SRE/AIInvestigationEngine";
import { getAllEnvVars, IsBillingEnabled } from "../../../EnvironmentConfig";
import SubscriptionPlan, {
  PlanType,
} from "../../../../Types/Billing/SubscriptionPlan";
import { canReadPlanGatedTableBelowPlan } from "../../../../Types/Billing/PlanGatedTable";

/*
 * MAY ONEUPTIME AI RESPOND FIRST TO THIS RECORD?
 *
 * An alert or incident on-call rule set to After OneUptime AI holds a page
 * only where AI can actually fix something (OnCallPolicyAiHold): a page held
 * for AI that cannot act is only a later page. So the rule engine asks here,
 * once per record, as soon as a rule set to After OneUptime AI matches it -
 * and the rule pages right away, saying why in the record's feed, when any
 * of these holds:
 *
 *   - a person created the record: someone is on it already;
 *   - it has the project's highest severity: people take those at once;
 *   - other alerts and incidents opened in the project just before it, enough
 *     to look like an outage (AI_HOLD_OUTAGE_RECORD_COUNT within
 *     AI_HOLD_OUTAGE_WINDOW_IN_MINUTES) - every page AI holds starts then too;
 *   - the project's plan is below the one its on-call runs need: a held page
 *     is a run (OnCallDutyPolicyExecutionLog, a Growth table), and below its
 *     plan nobody could read it - no "OneUptime AI is on it", no Page now,
 *     no execution log - so the page would wait where nobody can see it or
 *     end it (getAiHoldPlanShortfall; never so where billing is off);
 *   - OneUptime AI may not investigate it: AI is off, automatic investigation
 *     of the record's kind is off, no LLM provider, no AI credits, or the
 *     project's daily AI limit (AIInvestigationEngine.getDisabledReason);
 *   - fixing new records of its kind automatically is off;
 *   - no monitor is linked, so no fix could be checked;
 *   - no linked Kubernetes cluster or infrastructure resource has an AI agent
 *     that fixes on its own (Automatic or Bypass approval) and is ready;
 *   - OneUptime AI resolved another record of the same monitor within
 *     AI_HOLD_RECURRENCE_WINDOW_IN_HOURS, and it is back: the last fix did not
 *     hold.
 *
 * What this cannot tell before the investigation runs - an AI rule that asks
 * before fixing, an investigation that finds no fix, a fix that needs
 * approval - hands the page off as soon as it is known (AiFirstResponder).
 *
 * Fails toward paging: a check that cannot be read holds nothing.
 */

export interface AiHoldFacts {
  recordKind: AiHoldRecordKind;
  isCreatedByPerson: boolean;
  isHighestSeverity: boolean;
  // Other alerts and incidents opened in the project within the outage window.
  otherRecordsOpenedRecently: number;
  /*
   * The plan the project needs for a held page to be seen (the on-call
   * runs' read plan), when its own plan is below it; null when it is not
   * (or billing is off).
   */
  planNeededToHold: PlanType | null;
  investigationNotStartedCode: InvestigationNotStartedCode | null;
  isAutomaticFixingOn: boolean;
  hasMonitor: boolean;
  // Linked clusters and resources whose AI agent fixes on its own, and is ready.
  unattendedFixTargetCount: number;
  hasRecentAiResolvedRecurrence: boolean;
}

export interface AiHoldDecision {
  canHold: boolean;
  // Why AI may not respond first, in plain words: empty when it may.
  reason?: string | undefined;
  // It looks like an outage: every page AI holds in the project starts too.
  isOutage?: boolean | undefined;
}

export const AI_HOLD_CHECK_FAILED_REASON: string =
  "OneUptime AI could not check whether it may respond first.";

// Why a project below the runs' plan pages right away, in the feed's words.
export function getAiHoldPlanReason(plan: PlanType): string {
  return `OneUptime AI responds first on the ${plan} plan and above.`;
}

// Why the investigation would not start, in the words the feed says.
export function getInvestigationNotStartedWords(
  code: InvestigationNotStartedCode,
  recordKind: AiHoldRecordKind,
): string {
  switch (code) {
    case "ai_disabled":
      return "OneUptime AI is off for this project.";
    case "automatic_investigation_disabled":
      return `OneUptime AI does not investigate new ${recordKind}s in this project.`;
    case "provider_missing":
      return "There is no LLM provider OneUptime AI can use.";
    case "insufficient_ai_balance":
      return "The project has no AI credits left.";
    case "project_daily_limit_reached":
      return "The project reached its daily AI limit.";
    default:
      return "OneUptime AI may not investigate it now.";
  }
}

/*
 * The decision, from what was read about the record: the first reason not
 * to hold, in the order above, or a hold.
 */
export function decideAiHold(facts: AiHoldFacts): AiHoldDecision {
  const kind: AiHoldRecordKind = facts.recordKind;

  if (facts.isCreatedByPerson) {
    return {
      canHold: false,
      reason:
        kind === "incident"
          ? "A person declared this incident."
          : "A person created this alert.",
    };
  }

  if (facts.isHighestSeverity) {
    return {
      canHold: false,
      reason: `This ${kind} has the project's highest severity.`,
    };
  }

  if (facts.otherRecordsOpenedRecently >= AI_HOLD_OUTAGE_RECORD_COUNT) {
    return {
      canHold: false,
      reason: `${facts.otherRecordsOpenedRecently} other alerts and incidents opened within ${AI_HOLD_OUTAGE_WINDOW_IN_MINUTES} minutes, which looks like an outage.`,
      isOutage: true,
    };
  }

  if (facts.planNeededToHold) {
    return {
      canHold: false,
      reason: getAiHoldPlanReason(facts.planNeededToHold),
    };
  }

  if (facts.investigationNotStartedCode) {
    return {
      canHold: false,
      reason: getInvestigationNotStartedWords(
        facts.investigationNotStartedCode,
        kind,
      ),
    };
  }

  if (!facts.isAutomaticFixingOn) {
    return {
      canHold: false,
      reason: `Fixing new ${kind}s automatically is off.`,
    };
  }

  if (!facts.hasMonitor) {
    return {
      canHold: false,
      reason: "No monitor is linked to check a fix against.",
    };
  }

  if (facts.unattendedFixTargetCount <= 0) {
    return {
      canHold: false,
      reason:
        "No linked cluster or resource has an AI agent that fixes on its own (Automatic or Bypass approval).",
    };
  }

  if (facts.hasRecentAiResolvedRecurrence) {
    return {
      canHold: false,
      reason: `OneUptime AI resolved this monitor's last ${kind} within ${AI_HOLD_RECURRENCE_WINDOW_IN_HOURS} hours, and it is back.`,
    };
  }

  return { canHold: true };
}

// How many recent runs AI resolved are read to find a recurrence.
const RECURRENCE_RUNS_READ_LIMIT: number = 100;

export default class AiFirstResponderEligibility {
  public static async decideForIncident(
    incident: Incident,
  ): Promise<AiHoldDecision> {
    if (!incident.id || !incident.projectId) {
      return { canHold: false, reason: AI_HOLD_CHECK_FAILED_REASON };
    }

    try {
      return decideAiHold(
        await this.readIncidentFacts({
          incidentId: incident.id,
          projectId: incident.projectId,
        }),
      );
    } catch (error) {
      logger.error(
        `OneUptime AI could not check whether it may respond first to incident ${incident.id.toString()}; paging right away: ${error}`,
        { projectId: incident.projectId.toString() } as LogAttributes,
      );

      return { canHold: false, reason: AI_HOLD_CHECK_FAILED_REASON };
    }
  }

  public static async decideForAlert(alert: Alert): Promise<AiHoldDecision> {
    if (!alert.id || !alert.projectId) {
      return { canHold: false, reason: AI_HOLD_CHECK_FAILED_REASON };
    }

    try {
      return decideAiHold(
        await this.readAlertFacts({
          alertId: alert.id,
          projectId: alert.projectId,
        }),
      );
    } catch (error) {
      logger.error(
        `OneUptime AI could not check whether it may respond first to alert ${alert.id.toString()}; paging right away: ${error}`,
        { projectId: alert.projectId.toString() } as LogAttributes,
      );

      return { canHold: false, reason: AI_HOLD_CHECK_FAILED_REASON };
    }
  }

  public static async readIncidentFacts(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
  }): Promise<AiHoldFacts> {
    const incident: Incident | null = await IncidentService.findOneById({
      id: data.incidentId,
      select: {
        _id: true,
        createdByUserId: true,
        incidentSeverityId: true,
        monitors: { _id: true },
      },
      props: { isRoot: true },
    });

    if (!incident) {
      throw new Error(`Incident ${data.incidentId.toString()} not found.`);
    }

    const monitorIds: Array<string> = (incident.monitors || [])
      .map((monitor: Monitor): string => {
        return monitor.id?.toString() || "";
      })
      .filter((id: string): boolean => {
        return id !== "";
      });

    const highestSeverity: IncidentSeverity | null =
      await IncidentSeverityService.findOneBy({
        query: { projectId: data.projectId },
        sort: { order: SortOrder.Ascending },
        select: { _id: true },
        props: { isRoot: true },
      });

    return {
      recordKind: "incident",
      isCreatedByPerson: Boolean(incident.createdByUserId),
      isHighestSeverity: Boolean(
        highestSeverity?.id &&
          incident.incidentSeverityId &&
          highestSeverity.id.toString() ===
            incident.incidentSeverityId.toString(),
      ),
      otherRecordsOpenedRecently: await this.countOtherRecordsOpenedRecently({
        projectId: data.projectId,
        incidentId: data.incidentId,
      }),
      planNeededToHold: await this.getAiHoldPlanShortfall(data.projectId),
      investigationNotStartedCode:
        await AIInvestigationEngine.getDisabledReason(
          data.projectId,
          "Incident",
        ),
      isAutomaticFixingOn: await this.isAutomaticFixingOn({
        projectId: data.projectId,
        recordKind: "incident",
      }),
      hasMonitor: monitorIds.length > 0,
      unattendedFixTargetCount: await this.countUnattendedFixTargets({
        projectId: data.projectId,
        incidentId: data.incidentId,
      }),
      hasRecentAiResolvedRecurrence:
        monitorIds.length > 0 &&
        (await this.hasRecentAiResolvedIncidentOfMonitors({
          projectId: data.projectId,
          incidentId: data.incidentId,
          monitorIds: monitorIds,
        })),
    };
  }

  public static async readAlertFacts(data: {
    alertId: ObjectID;
    projectId: ObjectID;
  }): Promise<AiHoldFacts> {
    const alert: Alert | null = await AlertService.findOneById({
      id: data.alertId,
      select: {
        _id: true,
        createdByUserId: true,
        alertSeverityId: true,
        monitorId: true,
      },
      props: { isRoot: true },
    });

    if (!alert) {
      throw new Error(`Alert ${data.alertId.toString()} not found.`);
    }

    const highestSeverity: AlertSeverity | null =
      await AlertSeverityService.findOneBy({
        query: { projectId: data.projectId },
        sort: { order: SortOrder.Ascending },
        select: { _id: true },
        props: { isRoot: true },
      });

    return {
      recordKind: "alert",
      isCreatedByPerson: Boolean(alert.createdByUserId),
      isHighestSeverity: Boolean(
        highestSeverity?.id &&
          alert.alertSeverityId &&
          highestSeverity.id.toString() === alert.alertSeverityId.toString(),
      ),
      otherRecordsOpenedRecently: await this.countOtherRecordsOpenedRecently({
        projectId: data.projectId,
        alertId: data.alertId,
      }),
      planNeededToHold: await this.getAiHoldPlanShortfall(data.projectId),
      investigationNotStartedCode:
        await AIInvestigationEngine.getDisabledReason(data.projectId, "Alert"),
      isAutomaticFixingOn: await this.isAutomaticFixingOn({
        projectId: data.projectId,
        recordKind: "alert",
      }),
      hasMonitor: Boolean(alert.monitorId),
      unattendedFixTargetCount: await this.countUnattendedFixTargets({
        projectId: data.projectId,
        alertId: data.alertId,
      }),
      hasRecentAiResolvedRecurrence: alert.monitorId
        ? await this.hasRecentAiResolvedAlertOfMonitor({
            projectId: data.projectId,
            alertId: data.alertId,
            monitorId: alert.monitorId,
          })
        : false,
    };
  }

  /*
   * The plan a held page needs, when the project's is below it: a held page
   * is an on-call run, read by the AI card's notice and Page now, and below
   * the runs' read plan nobody can read one (unless the table is readable
   * below its plan, readableBelowPlan). Null with billing off, a plan that
   * reaches it, or a table with no plan of its own. A project with no plan
   * yet throws (ProjectService.getCurrentPlan): the check fails toward
   * paging.
   */
  public static async getAiHoldPlanShortfall(
    projectId: ObjectID,
  ): Promise<PlanType | null> {
    if (!IsBillingEnabled) {
      return null;
    }

    const runs: OnCallDutyPolicyExecutionLog =
      new OnCallDutyPolicyExecutionLog();
    const readPlan: PlanType | null = runs.getReadBillingPlan();

    if (!readPlan || canReadPlanGatedTableBelowPlan(runs)) {
      return null;
    }

    const current: CurrentPlan = await ProjectService.getCurrentPlan(projectId);

    if (
      !current.plan ||
      SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
        readPlan,
        current.plan,
        getAllEnvVars(),
      )
    ) {
      return null;
    }

    return readPlan;
  }

  /*
   * Alerts and incidents the project opened within the outage window, but
   * the record itself.
   */
  public static async countOtherRecordsOpenedRecently(data: {
    projectId: ObjectID;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
  }): Promise<number> {
    const since: Date = OneUptimeDate.getSomeMinutesAgo(
      AI_HOLD_OUTAGE_WINDOW_IN_MINUTES,
    );

    const incidents: number = (
      await IncidentService.countBy({
        query: {
          projectId: data.projectId,
          createdAt: QueryHelper.greaterThanEqualTo(since),
          ...(data.incidentId
            ? { _id: QueryHelper.notEquals(data.incidentId.toString()) }
            : {}),
        },
        props: { isRoot: true },
      })
    ).toNumber();

    const alerts: number = (
      await AlertService.countBy({
        query: {
          projectId: data.projectId,
          createdAt: QueryHelper.greaterThanEqualTo(since),
          ...(data.alertId
            ? { _id: QueryHelper.notEquals(data.alertId.toString()) }
            : {}),
        },
        props: { isRoot: true },
      })
    ).toNumber();

    return incidents + alerts;
  }

  // Fix new incidents (alerts) automatically, on the project.
  public static async isAutomaticFixingOn(data: {
    projectId: ObjectID;
    recordKind: AiHoldRecordKind;
  }): Promise<boolean> {
    const project: Project | null = await ProjectService.findOneById({
      id: data.projectId,
      select: {
        enableAi: true,
        enableAutomaticIncidentRemediation: true,
        enableAutomaticAlertRemediation: true,
      },
      props: { isRoot: true },
    });

    if (!project || project.enableAi === false) {
      return false;
    }

    return data.recordKind === "alert"
      ? project.enableAutomaticAlertRemediation === true
      : project.enableAutomaticIncidentRemediation === true;
  }

  /*
   * The record's linked Kubernetes clusters and infrastructure resources
   * whose AI agent fixes on its own and is ready to: the places a fix round
   * could run unattended.
   */
  public static async countUnattendedFixTargets(data: {
    projectId: ObjectID;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
  }): Promise<number> {
    const clusters: Array<KubernetesClusterAiAccessStatus> =
      await KubernetesClusterAiAccessService.getStatusesForSubject(data);

    const resources: Array<ResourceAiAccessStatus> =
      await ResourceAiAccessService.getStatusesForSubject(data);

    return (
      clusters.filter((status: KubernetesClusterAiAccessStatus): boolean => {
        return (
          isUnattendedRemediationMode(status.remediationMode) &&
          status.isRemediationReady
        );
      }).length +
      resources.filter((status: ResourceAiAccessStatus): boolean => {
        return (
          isAiResourceType(status.resourceType) &&
          isUnattendedResourceRemediationMode(status.aiRemediationMode) &&
          status.isRemediationReady
        );
      }).length
    );
  }

  public static async hasRecentAiResolvedIncidentOfMonitors(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    monitorIds: Array<string>;
  }): Promise<boolean> {
    const incidentIds: Array<string> = (
      await this.findRecentAiResolvedRuns({
        projectId: data.projectId,
        runColumn: "triggeredByIncidentId",
      })
    )
      .map((run: OnCallDutyPolicyExecutionLog): string => {
        return run.triggeredByIncidentId?.toString() || "";
      })
      .filter((id: string): boolean => {
        return id !== "" && id !== data.incidentId.toString();
      });

    if (incidentIds.length === 0) {
      return false;
    }

    const incidents: Array<Incident> = await IncidentService.findBy({
      query: {
        projectId: data.projectId,
        _id: QueryHelper.any(Array.from(new Set(incidentIds))),
      },
      select: { _id: true, monitors: { _id: true } },
      limit: RECURRENCE_RUNS_READ_LIMIT,
      skip: 0,
      props: { isRoot: true },
    });

    const monitorIds: Set<string> = new Set<string>(data.monitorIds);

    return incidents.some((incident: Incident): boolean => {
      return (incident.monitors || []).some((monitor: Monitor): boolean => {
        return monitorIds.has(monitor.id?.toString() || "");
      });
    });
  }

  public static async hasRecentAiResolvedAlertOfMonitor(data: {
    projectId: ObjectID;
    alertId: ObjectID;
    monitorId: ObjectID;
  }): Promise<boolean> {
    const alertIds: Array<string> = (
      await this.findRecentAiResolvedRuns({
        projectId: data.projectId,
        runColumn: "triggeredByAlertId",
      })
    )
      .map((run: OnCallDutyPolicyExecutionLog): string => {
        return run.triggeredByAlertId?.toString() || "";
      })
      .filter((id: string): boolean => {
        return id !== "" && id !== data.alertId.toString();
      });

    if (alertIds.length === 0) {
      return false;
    }

    return (
      (
        await AlertService.countBy({
          query: {
            projectId: data.projectId,
            _id: QueryHelper.any(Array.from(new Set(alertIds))),
            monitorId: data.monitorId,
          },
          props: { isRoot: true },
        })
      ).toNumber() > 0
    );
  }

  // Runs whose hold OneUptime AI ended by resolving their record, lately.
  private static async findRecentAiResolvedRuns(data: {
    projectId: ObjectID;
    runColumn: "triggeredByIncidentId" | "triggeredByAlertId";
  }): Promise<Array<OnCallDutyPolicyExecutionLog>> {
    return await OnCallDutyPolicyExecutionLogService.findBy({
      query: {
        projectId: data.projectId,
        aiHoldOutcome: OnCallPolicyAiHoldOutcome.ResolvedByAI,
        createdAt: QueryHelper.greaterThanEqualTo(
          OneUptimeDate.getSomeHoursAgo(AI_HOLD_RECURRENCE_WINDOW_IN_HOURS),
        ),
        [data.runColumn]: QueryHelper.notNull(),
      },
      select: {
        _id: true,
        triggeredByIncidentId: true,
        triggeredByAlertId: true,
      },
      sort: { createdAt: SortOrder.Descending },
      limit: RECURRENCE_RUNS_READ_LIMIT,
      skip: 0,
      props: { isRoot: true },
    });
  }
}
