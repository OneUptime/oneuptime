import Alert from "../../../../Models/DatabaseModels/Alert";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Incident from "../../../../Models/DatabaseModels/Incident";
import {
  AIRunEventResultSummary,
  FollowUpCheckActivity,
} from "../../../../Types/AI/AIChatTypes";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import { InvestigationNotStartedCode } from "../../../../Types/AI/InvestigationNotStartedReason";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import PromptText from "../../../../Utils/AI/PromptText";
import {
  MarkdownText,
  mdText,
} from "../../../../Utils/Markdown/FeedMarkdown";
import AIRunService from "../../../Services/AIRunService";
import AlertService from "../../../Services/AlertService";
import IncidentService from "../../../Services/IncidentService";
import IncidentStateService from "../../../Services/IncidentStateService";
import Query from "../../../Types/Database/Query";
import QueryHelper from "../../../Types/Database/QueryHelper";
import LinkedAffectedResources, {
  LINKED_AFFECTED_RESOURCE_RELATIONS,
  LinkedAffectedResourceRelation,
} from "../../AffectedResources/LinkedAffectedResources";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import AIInvestigationEngine from "./AIInvestigationEngine";
import AIInvestigationQueue from "./InvestigationQueue";
import LinkedInfrastructureContext, {
  LinkedInfrastructureResource,
  describeAlertNumber,
  describeLinkedResource,
  describeLinkedResourceKind,
  describeOpenedAfterDeclared,
  describeRelativeTime,
} from "./LinkedInfrastructureContext";

/*
 * AI SRE - an incident is checked again, once, when an alert opens on its
 * linked infrastructure after its first investigation (issue #4787).
 *
 * An automatic investigation starts the moment the incident is declared. A
 * fast synthetic monitor declares it minutes before the slower signals that
 * explain it exist: a host's CPU alert needs a few minutes of metrics
 * before it fires. So the first analysis ran without that alert and never
 * looked again.
 *
 * Now, when an alert opens on a host, container host, cluster, database or
 * service an open incident is linked to, within FOLLOW_UP_WINDOW_MINUTES of
 * the incident, and the incident's investigation finished without it,
 * OneUptime AI checks the incident once more with that alert in hand
 * (an Investigation run whose followUpForAlertId names the alert). The
 * report it posts says why, on its first line.
 *
 * Bounded, never a loop:
 *   - once per incident: a run with followUpForAlertId is never followed up,
 *     and an incident that has one gets no other (checked inside the subject
 *     lock, so two alerts at once add one run);
 *   - only after a completed investigation, never beside a queued or running
 *     one: an alert that opens while the first run is still going is picked
 *     up when that run settles (onInvestigationSettled);
 *   - only while the incident is open, and only for an alert that opened
 *     within the window after it;
 *   - through the same queue, gates and limits as a new incident: Enable AI,
 *     automatic incident investigation, a provider, AI credits, the project's
 *     daily limits, the incident lane's daily token limit and concurrency
 *     cap. The monitor cooldown does not apply: it is the same incident, not
 *     a repeat one.
 *   - a private alert never triggers one: its title would reach the report.
 *
 * Every entry point is best-effort and never throws: a follow-up that cannot
 * be decided is not started, and nothing else depends on it.
 */

// How long after an incident a new alert on its infrastructure is checked.
export const FOLLOW_UP_WINDOW_MINUTES: number = 30;

// The most incidents one alert checks again.
export const MAX_INCIDENTS_PER_ALERT: number = 5;

// What the follow-up run is told, and says, about why it runs.
export interface FollowUpCheckContext {
  incidentCreatedAt: Date;
  alertId: string;
  alertNumber?: number | undefined;
  alertNumberWithPrefix?: string | undefined;
  alertTitle: string;
  alertOpenedAt: Date;
  alertSeverityName?: string | undefined;
  alertRootCause?: string | undefined;
  // The incident's linked resources the alert is on.
  resources: Array<LinkedInfrastructureResource>;
  // When the previous analysis finished, if one did.
  previousAnalysisAt?: Date | undefined;
}

export default class IncidentFollowUpCheck {
  /*
   * An alert opened (AlertService.onCreateSuccess): check again, once, each
   * open incident linked to the same infrastructure that was investigated
   * without it. Returns the follow-up runs it queued.
   */
  @CaptureSpan()
  public static async onAlertOpened(data: {
    projectId: ObjectID;
    alertId: ObjectID;
  }): Promise<Array<ObjectID>> {
    try {
      const alert: Alert | null = await AlertService.findOneBy({
        query: { _id: data.alertId.toString(), projectId: data.projectId },
        select: { _id: true, createdAt: true, isPrivate: true },
        props: { isRoot: true },
      });

      if (!alert?.createdAt || alert.isPrivate === true) {
        return [];
      }

      const resources: Array<LinkedInfrastructureResource> =
        LinkedInfrastructureContext.keepInfrastructure(
          await LinkedAffectedResources.readForAlert({
            service: AlertService,
            projectId: data.projectId,
            alertId: data.alertId,
          }),
        );

      if (resources.length === 0) {
        return [];
      }

      // What stops automatic investigation for the project stops this too.
      if (!(await IncidentFollowUpCheck.isLaneOpen(data.projectId))) {
        return [];
      }

      const incidentIds: Array<ObjectID> =
        await IncidentFollowUpCheck.findOpenIncidentsLinkedTo({
          projectId: data.projectId,
          resources,
          alertOpenedAt: alert.createdAt,
        });

      const queued: Array<ObjectID> = [];

      for (const incidentId of incidentIds) {
        const runId: ObjectID | null =
          await IncidentFollowUpCheck.enqueueIfDue({
            projectId: data.projectId,
            incidentId,
            alertId: data.alertId,
            alertOpenedAt: alert.createdAt,
          });

        if (runId) {
          queued.push(runId);
        }
      }

      return queued;
    } catch (error) {
      logger.error(
        `AI: could not decide whether alert ${data.alertId.toString()} needs an incident checked again: ${error}`,
      );
      return [];
    }
  }

  /*
   * An incident's investigation settled: when an alert opened on its linked
   * infrastructure while it ran, check the incident again with that alert.
   * Called for every settled incident investigation; only a completed,
   * first (not follow-up) one can lead to a check.
   */
  @CaptureSpan()
  public static async onInvestigationSettled(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    aiRunId: ObjectID;
  }): Promise<ObjectID | null> {
    try {
      const run: AIRun | null = await AIRunService.findOneBy({
        query: { _id: data.aiRunId.toString(), projectId: data.projectId },
        select: {
          _id: true,
          status: true,
          startedAt: true,
          createdAt: true,
          followUpForAlertId: true,
        },
        props: { isRoot: true },
      });

      if (
        !run ||
        run.status !== AIRunStatus.Completed ||
        run.followUpForAlertId
      ) {
        return null;
      }

      const incident: Incident | null = await IncidentService.findOneBy({
        query: { _id: data.incidentId.toString(), projectId: data.projectId },
        select: { _id: true, createdAt: true },
        props: { isRoot: true },
      });

      if (!incident?.createdAt) {
        return null;
      }

      const contextReadAt: Date | undefined = run.startedAt || run.createdAt;

      if (!contextReadAt) {
        return null;
      }

      const windowEnd: Date = OneUptimeDate.addRemoveMinutes(
        incident.createdAt,
        FOLLOW_UP_WINDOW_MINUTES,
      );

      // Nothing opened after the context was read can be inside the window.
      if (contextReadAt.getTime() >= windowEnd.getTime()) {
        return null;
      }

      const resources: Array<LinkedInfrastructureResource> =
        LinkedInfrastructureContext.keepInfrastructure(
          await LinkedAffectedResources.readForIncident({
            service: IncidentService,
            projectId: data.projectId,
            incidentId: data.incidentId,
          }),
        );

      if (resources.length === 0) {
        return null;
      }

      const alert: Alert | null = await IncidentFollowUpCheck.findFirstNewAlert(
        {
          projectId: data.projectId,
          resources,
          after: contextReadAt,
          until: windowEnd,
        },
      );

      if (!alert?.id || !alert.createdAt) {
        return null;
      }

      if (!(await IncidentFollowUpCheck.isLaneOpen(data.projectId))) {
        return null;
      }

      return await IncidentFollowUpCheck.enqueueIfDue({
        projectId: data.projectId,
        incidentId: data.incidentId,
        alertId: alert.id,
        alertOpenedAt: alert.createdAt,
      });
    } catch (error) {
      logger.error(
        `AI: could not decide whether incident ${data.incidentId.toString()} needs checking again: ${error}`,
      );
      return null;
    }
  }

  /*
   * Queue the follow-up of one incident for one alert, when it is due: the
   * incident is still open, the alert opened within the window after it and
   * after its latest investigation read its context, that investigation
   * completed, and no follow-up exists. The last two are checked again
   * inside the subject lock, where the run is created.
   */
  @CaptureSpan()
  public static async enqueueIfDue(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    alertId: ObjectID;
    alertOpenedAt: Date;
  }): Promise<ObjectID | null> {
    const incident: Incident | null = await IncidentService.findOneBy({
      query: { _id: data.incidentId.toString(), projectId: data.projectId },
      select: { _id: true, createdAt: true, currentIncidentStateId: true },
      props: { isRoot: true },
    });

    if (!incident?.createdAt || !incident.currentIncidentStateId) {
      return null;
    }

    const windowEnd: Date = OneUptimeDate.addRemoveMinutes(
      incident.createdAt,
      FOLLOW_UP_WINDOW_MINUTES,
    );

    if (
      data.alertOpenedAt.getTime() < incident.createdAt.getTime() ||
      data.alertOpenedAt.getTime() > windowEnd.getTime()
    ) {
      return null;
    }

    const openStateIds: Array<string> = (
      await IncidentStateService.getUnresolvedIncidentStateIds(data.projectId)
    ).map((id: ObjectID): string => {
      return id.toString();
    });

    if (!openStateIds.includes(incident.currentIncidentStateId.toString())) {
      return null;
    }

    const latest: AIRun | null = await IncidentFollowUpCheck.readLatestRun(
      data,
    );

    if (
      !latest ||
      !IncidentFollowUpCheck.isDue({
        latestRun: latest,
        alertOpenedAt: data.alertOpenedAt,
      })
    ) {
      return null;
    }

    const runId: ObjectID | null = await AIInvestigationQueue.enqueue({
      projectId: data.projectId,
      subjectIncidentId: data.incidentId,
      subjectMonitorId: latest.monitorId,
      followUpForAlertId: data.alertId,
      // Once per incident, and never beside a run that is still going.
      admitInsideSubjectLock: async (): Promise<boolean> => {
        return await IncidentFollowUpCheck.isAdmitted(data);
      },
    });

    if (runId) {
      logger.debug(
        `AI: checking incident ${data.incidentId.toString()} again (run ${runId.toString()}) after alert ${data.alertId.toString()} opened on its linked infrastructure.`,
      );
    }

    return runId;
  }

  /*
   * Whether the latest investigation of the incident is one a follow-up
   * comes after: completed (a queued run will read the alert when it starts;
   * a running one is followed up when it settles), a first investigation
   * rather than a follow-up, and one whose context was read before the alert
   * opened.
   */
  public static isDue(data: {
    latestRun: AIRun;
    alertOpenedAt: Date;
  }): boolean {
    const run: AIRun = data.latestRun;

    if (run.runType && run.runType !== AIRunType.Investigation) {
      return false;
    }

    if (run.status !== AIRunStatus.Completed || run.followUpForAlertId) {
      return false;
    }

    const contextReadAt: Date | undefined = run.startedAt || run.createdAt;

    return Boolean(
      contextReadAt &&
        contextReadAt.getTime() < data.alertOpenedAt.getTime(),
    );
  }

  /*
   * The follow-up's starting context: the alert, the incident's resources
   * it is on, and when the previous analysis finished. Null when the alert
   * cannot be read (it was deleted) or is private.
   */
  @CaptureSpan()
  public static async readContext(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    alertId: ObjectID;
    aiRunId?: ObjectID | undefined;
  }): Promise<FollowUpCheckContext | null> {
    const [incident, alert]: [Incident | null, Alert | null] =
      await Promise.all([
        IncidentService.findOneBy({
          query: {
            _id: data.incidentId.toString(),
            projectId: data.projectId,
          },
          select: { _id: true, createdAt: true },
          props: { isRoot: true },
        }),
        AlertService.findOneBy({
          query: { _id: data.alertId.toString(), projectId: data.projectId },
          select: {
            _id: true,
            alertNumber: true,
            alertNumberWithPrefix: true,
            title: true,
            createdAt: true,
            isPrivate: true,
            rootCause: true,
            alertSeverity: { name: true },
          },
          props: { isRoot: true },
        }),
      ]);

    if (
      !incident?.createdAt ||
      !alert?.createdAt ||
      alert.isPrivate === true
    ) {
      return null;
    }

    const incidentResources: Array<LinkedInfrastructureResource> =
      LinkedInfrastructureContext.keepInfrastructure(
        await LinkedAffectedResources.readForIncident({
          service: IncidentService,
          projectId: data.projectId,
          incidentId: data.incidentId,
        }),
      );
    const alertResourceKeys: Set<string> = new Set<string>(
      LinkedInfrastructureContext.keepInfrastructure(
        await LinkedAffectedResources.readForAlert({
          service: AlertService,
          projectId: data.projectId,
          alertId: data.alertId,
        }),
      ).map((resource: LinkedInfrastructureResource): string => {
        return `${resource.type}:${resource.id}`;
      }),
    );

    const previous: Array<AIRun> = await AIRunService.findBy({
      query: {
        projectId: data.projectId,
        triggeredByIncidentId: data.incidentId,
        runType: AIRunType.Investigation,
        status: AIRunStatus.Completed,
        followUpForAlertId: QueryHelper.isNull(),
      },
      select: { _id: true, completedAt: true },
      sort: { completedAt: SortOrder.Descending },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });

    return {
      incidentCreatedAt: incident.createdAt,
      alertId: data.alertId.toString(),
      alertNumber: alert.alertNumber,
      alertNumberWithPrefix: alert.alertNumberWithPrefix,
      alertTitle: alert.title || "",
      alertOpenedAt: alert.createdAt,
      alertSeverityName: alert.alertSeverity?.name,
      alertRootCause: alert.rootCause,
      resources: incidentResources.filter(
        (resource: LinkedInfrastructureResource): boolean => {
          return alertResourceKeys.has(`${resource.type}:${resource.id}`);
        },
      ),
      previousAnalysisAt: previous[0]?.completedAt,
    };
  }

  /*
   * The "# Why you are checking again" block, which leads the follow-up's
   * starting context.
   */
  public static buildContextSection(context: FollowUpCheckContext): string {
    const on: string = IncidentFollowUpCheck.describeResources(context);
    const title: string = PromptText.field(context.alertTitle, {
      maxLength: 300,
    });
    const rootCause: string = context.alertRootCause
      ? PromptText.field(context.alertRootCause, { maxLength: 500 })
      : "";

    const lines: Array<string> = [
      "# Why you are checking again",
      `OneUptime AI already investigated this incident${
        context.previousAnalysisAt
          ? ` (its analysis finished ${context.previousAnalysisAt.toISOString()} and is in the internal notes below)`
          : ""
      }. Since then, ${describeAlertNumber(context, { midSentence: true })} ${JSON.stringify(title)} opened${
        on ? ` on ${on}` : ""
      } at ${context.alertOpenedAt.toISOString()}, ${describeRelativeTime({
        time: context.alertOpenedAt,
        subjectCreatedAt: context.incidentCreatedAt,
        subjectKind: "incident",
      })}.${context.alertSeverityName ? ` Its severity is ${context.alertSeverityName}.` : ""}${
        rootCause ? ` Root cause recorded on the alert: ${rootCause}` : ""
      }`,
      "Check whether this alert explains the incident: read the alert and the resource's telemetry around it (for a Docker or Podman host, its containers too), then write your report as usual. Begin the Summary by saying whether this alert changes the earlier analysis, and how.",
      "",
    ];

    return lines.join("\n");
  }

  /*
   * The report's first line, under its heading: why it was written. People
   * read it in the feed, the internal note, Slack and Teams, so every value
   * goes in through mdText.
   */
  public static buildReportLead(context: FollowUpCheckContext): MarkdownText {
    const alert: string = describeAlertNumber(context, { midSentence: true });
    const resource: LinkedInfrastructureResource | undefined =
      context.resources[0];
    const when: string = describeOpenedAfterDeclared({
      openedAt: context.alertOpenedAt,
      incidentCreatedAt: context.incidentCreatedAt,
    });
    const title: string = context.alertTitle.trim();

    if (resource) {
      return title
        ? mdText`**Checked again** after ${alert} (${title}) opened on ${describeLinkedResourceKind(resource.type)} ${resource.name}, ${when}.`
        : mdText`**Checked again** after ${alert} opened on ${describeLinkedResourceKind(resource.type)} ${resource.name}, ${when}.`;
    }

    return title
      ? mdText`**Checked again** after ${alert} (${title}) opened on infrastructure linked to this incident, ${when}.`
      : mdText`**Checked again** after ${alert} opened on infrastructure linked to this incident, ${when}.`;
  }

  // The run's first activity line: why it checks again.
  public static buildActivityNote(
    context: FollowUpCheckContext,
  ): AIRunEventResultSummary {
    const resource: LinkedInfrastructureResource | undefined =
      context.resources[0];
    const activity: FollowUpCheckActivity = {
      alertNumber: context.alertNumber,
      alertNumberWithPrefix: context.alertNumberWithPrefix,
      resourceKind: resource?.type || "",
      resourceName: resource?.name || "",
      minutesAfterIncident: Math.max(
        0,
        Math.round(
          (context.alertOpenedAt.getTime() -
            context.incidentCreatedAt.getTime()) /
            60000,
        ),
      ),
    };

    return {
      message: `Checking again: ${describeAlertNumber(context, { midSentence: true })} opened on ${
        resource
          ? describeLinkedResource(resource)
          : "the incident's linked infrastructure"
      } after the first analysis`,
      severity: "Info",
      followUpCheck: activity,
    };
  }

  private static describeResources(context: FollowUpCheckContext): string {
    return context.resources
      .map((resource: LinkedInfrastructureResource): string => {
        return describeLinkedResource(resource);
      })
      .join(", ");
  }

  // Whether automatic incident investigation can run in the project now.
  private static async isLaneOpen(projectId: ObjectID): Promise<boolean> {
    const disabled: InvestigationNotStartedCode | null =
      await AIInvestigationEngine.getDisabledReason(projectId, "Incident");

    return disabled === null;
  }

  // Inside the subject lock: no follow-up yet, and no run still going.
  private static async isAdmitted(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    alertOpenedAt: Date;
  }): Promise<boolean> {
    const followUps: number = (
      await AIRunService.countBy({
        query: {
          projectId: data.projectId,
          triggeredByIncidentId: data.incidentId,
          runType: AIRunType.Investigation,
          followUpForAlertId: QueryHelper.notNull(),
        },
        props: { isRoot: true },
      })
    ).toNumber();

    if (followUps > 0) {
      return false;
    }

    const latest: AIRun | null = await IncidentFollowUpCheck.readLatestRun(
      data,
    );

    return Boolean(
      latest &&
        IncidentFollowUpCheck.isDue({
          latestRun: latest,
          alertOpenedAt: data.alertOpenedAt,
        }),
    );
  }

  private static async readLatestRun(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
  }): Promise<AIRun | null> {
    const runs: Array<AIRun> = await AIRunService.findBy({
      query: {
        projectId: data.projectId,
        triggeredByIncidentId: data.incidentId,
        runType: AIRunType.Investigation,
      },
      select: {
        _id: true,
        runType: true,
        status: true,
        startedAt: true,
        createdAt: true,
        monitorId: true,
        followUpForAlertId: true,
      },
      sort: { createdAt: SortOrder.Descending },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });

    return runs[0] || null;
  }

  /*
   * The open incidents of the project linked to any of `resources` that were
   * declared within the window before the alert opened, newest first, at
   * most MAX_INCIDENTS_PER_ALERT - read per kind of resource, like the
   * linked alerts.
   */
  private static async findOpenIncidentsLinkedTo(data: {
    projectId: ObjectID;
    resources: Array<LinkedInfrastructureResource>;
    alertOpenedAt: Date;
  }): Promise<Array<ObjectID>> {
    const openStateIds: Array<ObjectID> =
      await IncidentStateService.getUnresolvedIncidentStateIds(data.projectId);

    if (openStateIds.length === 0) {
      return [];
    }

    const declaredSince: Date = OneUptimeDate.addRemoveMinutes(
      data.alertOpenedAt,
      -FOLLOW_UP_WINDOW_MINUTES,
    );
    const incidentModel: Incident = new Incident();
    const found: Map<string, { id: ObjectID; createdAt: number }> = new Map<
      string,
      { id: ObjectID; createdAt: number }
    >();

    for (const [column, ids] of IncidentFollowUpCheck.groupIdsByColumn(
      data.resources,
      (candidate: LinkedAffectedResourceRelation): boolean => {
        return incidentModel.hasColumn(candidate.column);
      },
    )) {
      const incidents: Array<Incident> = await IncidentService.findBy({
        query: {
          projectId: data.projectId,
          [column]: QueryHelper.inRelationArray(ids),
          currentIncidentStateId: QueryHelper.any(openStateIds),
          createdAt: QueryHelper.inBetween(declaredSince, data.alertOpenedAt),
        } as Query<Incident>,
        select: { _id: true, createdAt: true },
        sort: { createdAt: SortOrder.Descending },
        limit: MAX_INCIDENTS_PER_ALERT,
        skip: 0,
        props: { isRoot: true },
      });

      for (const incident of incidents) {
        if (incident.id) {
          found.set(incident.id.toString(), {
            id: incident.id,
            createdAt: incident.createdAt?.getTime() || 0,
          });
        }
      }
    }

    return Array.from(found.values())
      .sort(
        (
          a: { id: ObjectID; createdAt: number },
          b: { id: ObjectID; createdAt: number },
        ): number => {
          return b.createdAt - a.createdAt;
        },
      )
      .slice(0, MAX_INCIDENTS_PER_ALERT)
      .map((entry: { id: ObjectID }): ObjectID => {
        return entry.id;
      });
  }

  /*
   * The first alert that opened on `resources` after `after`, up to
   * `until`, that is not private - the one the follow-up is about.
   */
  private static async findFirstNewAlert(data: {
    projectId: ObjectID;
    resources: Array<LinkedInfrastructureResource>;
    after: Date;
    until: Date;
  }): Promise<Alert | null> {
    const alertModel: Alert = new Alert();
    let first: Alert | null = null;

    for (const [column, ids] of IncidentFollowUpCheck.groupIdsByColumn(
      data.resources,
      (candidate: LinkedAffectedResourceRelation): boolean => {
        return alertModel.hasColumn(candidate.column);
      },
    )) {
      const alerts: Array<Alert> = await AlertService.findBy({
        query: {
          projectId: data.projectId,
          [column]: QueryHelper.inRelationArray(ids),
          createdAt: QueryHelper.inBetween(
            new Date(data.after.getTime() + 1),
            data.until,
          ),
        } as Query<Alert>,
        select: { _id: true, createdAt: true, isPrivate: true },
        sort: { createdAt: SortOrder.Ascending },
        // A few: the first may be private.
        limit: MAX_INCIDENTS_PER_ALERT,
        skip: 0,
        props: { isRoot: true },
      });

      for (const alert of alerts) {
        if (alert.isPrivate === true || !alert.createdAt) {
          continue;
        }

        if (
          !first ||
          (first.createdAt &&
            alert.createdAt.getTime() < first.createdAt.getTime())
        ) {
          first = alert;
        }
        break;
      }
    }

    return first;
  }

  private static groupIdsByColumn(
    resources: Array<LinkedInfrastructureResource>,
    hasColumn: (relation: LinkedAffectedResourceRelation) => boolean,
  ): Map<string, Array<ObjectID>> {
    const byColumn: Map<string, Array<ObjectID>> = new Map<
      string,
      Array<ObjectID>
    >();

    for (const resource of resources) {
      const relation: LinkedAffectedResourceRelation | undefined =
        LINKED_AFFECTED_RESOURCE_RELATIONS.find(
          (candidate: LinkedAffectedResourceRelation): boolean => {
            return candidate.type === resource.type && hasColumn(candidate);
          },
        );

      if (!relation || !ObjectID.isValidUUID(resource.id)) {
        continue;
      }

      byColumn.set(relation.column, [
        ...(byColumn.get(relation.column) || []),
        new ObjectID(resource.id),
      ]);
    }

    return byColumn;
  }
}
