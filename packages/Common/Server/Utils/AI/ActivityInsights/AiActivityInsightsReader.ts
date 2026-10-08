import AIInsightService from "../../../Services/AIInsightService";
import AIRunService from "../../../Services/AIRunService";
import AlertService from "../../../Services/AlertService";
import AutoRemediationSuggestionService from "../../../Services/AutoRemediationSuggestionService";
import IncidentService from "../../../Services/IncidentService";
import RunnerJobService from "../../../Services/RunnerJobService";
import TelemetryExceptionService from "../../../Services/TelemetryExceptionService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import InvestigationReportSummary, {
  InvestigationReportConclusion,
  InvestigationReportSummaryRun,
} from "../SRE/InvestigationReportSummary";
import AiActivityInsightsBuilder, {
  AiActivityCommandStats,
  AiActivityFixInput,
  AiActivityInsightsInput,
  AiActivityInvestigationInput,
  AiActivitySubjectInput,
} from "./AiActivityInsightsBuilder";
import AIInsight from "../../../../Models/DatabaseModels/AIInsight";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import AIInsightStatus from "../../../../Types/AI/AIInsightStatus";
import AIInsightType from "../../../../Types/AI/AIInsightType";
import AIRunType from "../../../../Types/AI/AIRunType";
import {
  AI_ACTIVITY_INSIGHTS_MAX_FIXES,
  AI_ACTIVITY_INSIGHTS_MAX_INVESTIGATIONS,
  AI_ACTIVITY_INSIGHTS_WINDOW_IN_DAYS,
  AiActivityInsights,
  AiActivityPreventiveInsight,
} from "../../../../Types/AI/AiActivityInsights";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import RunnerJobOrigin from "../../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../../Types/Runbook/RunnerJobStatus";

/*
 * Reads what an AI Insights page summarises for one scope — a Kubernetes
 * cluster or a resource served by a resource AI agent — and hands it to
 * AiActivityInsightsBuilder. The caller (KubernetesClusterAiAccessAPI,
 * ResourceAiAccessAPI) has already checked that the user may read the
 * scope itself; this decides what the insights may say about everything
 * else, the way the scope's AI Logs page does:
 *
 *   - incidents and alerts are read under the caller's own props (tenant,
 *     labels, private incidents) — the window's ones linked to the scope,
 *     with what raised them, for how often each problem came up and where,
 *     and each investigated subject's title, number and series identity —
 *     and an investigation whose incident or alert the caller cannot read
 *     is left out altogether, from the totals too;
 *   - an investigation's finding (TL;DR, or its report's own Summary) and
 *     the first step its report suggests are only ever read next to such a
 *     readable subject — its incident's or alert's own AI panel shows the
 *     same report to the same people;
 *   - preventive AIInsight findings are read under the caller's props
 *     (their table is narrower than the scope's: no Viewer);
 *   - AI runs, suggestions, Runner jobs, report feed items, the incidents'
 *     monitor ids and the exceptions' owners are read as root: they have
 *     narrower read ACLs of their own (an investigation run is private to
 *     its author), reading them under the caller's props would empty the
 *     page for exactly the people it is for, and nothing from them leaves
 *     except statuses, dates, counts, opaque groupings and — next to an
 *     incident or alert the caller may read — the report's own words.
 *
 * Bounded: the window's newest AI_ACTIVITY_INSIGHTS_MAX_INVESTIGATIONS
 * investigations and AI_ACTIVITY_INSIGHTS_MAX_FIXES fixes, its newest
 * JOB_SCAN_LIMIT commands and LINKED_SUBJECT_LIMIT incidents and alerts;
 * reaching a bound marks the insights partial.
 */

// What the reader needs to know about the scope.
export interface AiActivityInsightsScope {
  projectId: ObjectID;
  // The caller's own, tenant-pinned props.
  props: DatabaseCommonInteractionProps;
  // The scope's row: the target of subjectRelation, and the telemetry entity its preventive insights are filed against.
  scopeId: ObjectID;
  // The RunnerJob filter naming the scope's AI commands (projectId is added).
  commandJobQuery: Record<string, unknown>;
  // The Incident/Alert relation that links a subject to the scope.
  subjectRelation: string;
  // The suggestions the scope's own fixes setting produced (projectId is added).
  ownFixQuery: Record<string, unknown>;
  // Series label keys, and values, that name the scope itself.
  scopeLabelKeys: ReadonlyArray<string>;
  scopeNames: ReadonlyArray<string>;
}

/*
 * How many of the window's newest commands are read: for the runs and
 * suggestions that ran commands on the scope, and for the command counts.
 */
export const AI_ACTIVITY_INSIGHTS_JOB_SCAN_LIMIT: number = 2000;

// How many incidents, and how many alerts, linked to the scope are read.
export const AI_ACTIVITY_INSIGHTS_LINKED_SUBJECT_LIMIT: number = 500;

// How many open exception findings are matched against the scope.
export const AI_ACTIVITY_INSIGHTS_EXCEPTION_INSIGHT_SCAN_LIMIT: number = 200;

const OPEN_INSIGHT_STATUSES: Array<AIInsightStatus> = [
  AIInsightStatus.Detected,
  AIInsightStatus.ActionRequired,
  AIInsightStatus.FixOpened,
];

const EXCEPTION_INSIGHT_TYPES: Array<AIInsightType> = [
  AIInsightType.NewException,
  AIInsightType.ExceptionSpike,
];

// What an incident is read with, wherever the page names one.
const INCIDENT_SELECT: Record<string, boolean> = {
  _id: true,
  createdAt: true,
  title: true,
  incidentNumber: true,
  incidentNumberWithPrefix: true,
  seriesLabels: true,
};

// What an alert is read with: its monitor is a column of its own.
const ALERT_SELECT: Record<string, boolean> = {
  _id: true,
  createdAt: true,
  title: true,
  alertNumber: true,
  alertNumberWithPrefix: true,
  monitorId: true,
  seriesLabels: true,
};

// What a merge of several reads needs from every row.
interface BaseRow {
  id?: ObjectID | null | undefined;
  createdAt?: Date | undefined;
}

/*
 * A read made under the caller's own props, which the permission layer
 * refuses outright for a role that cannot read the table at all: that
 * caller gets nothing from it, as one whose labels reach no row does.
 */
async function readIfPermitted<T>(
  read: () => Promise<Array<T>>,
): Promise<Array<T>> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof NotAuthorizedException) {
      return [];
    }

    throw error;
  }
}

// The union of several reads: one row per id, newest first.
function mergeNewest<T extends BaseRow>(groups: Array<Array<T>>): Array<T> {
  const byId: Map<string, T> = new Map<string, T>();

  for (const rows of groups) {
    for (const row of rows) {
      const id: string | undefined = row.id?.toString();

      if (id && !byId.has(id)) {
        byId.set(id, row);
      }
    }
  }

  return Array.from(byId.values()).sort((a: T, b: T): number => {
    return (
      (b.createdAt ? new Date(b.createdAt).getTime() : 0) -
      (a.createdAt ? new Date(a.createdAt).getTime() : 0)
    );
  });
}

function getUniqueIds(
  ids: Array<ObjectID | null | undefined>,
): Array<ObjectID> {
  const byId: Map<string, ObjectID> = new Map<string, ObjectID>();

  for (const id of ids) {
    if (id) {
      byId.set(id.toString(), id);
    }
  }

  return Array.from(byId.values());
}

// An incident as the builder takes it, with the monitors that raised it.
function toIncidentSubject(
  incident: Incident,
  monitorIds: Array<string>,
): AiActivitySubjectInput {
  return {
    kind: "incident",
    id: incident.id!.toString(),
    title: incident.title || undefined,
    number:
      typeof incident.incidentNumber === "number"
        ? incident.incidentNumber
        : undefined,
    numberWithPrefix: incident.incidentNumberWithPrefix || undefined,
    monitorIds,
    seriesLabels: incident.seriesLabels || undefined,
    createdAt: incident.createdAt ? new Date(incident.createdAt) : undefined,
  };
}

// An alert as the builder takes it: its monitor raised it.
function toAlertSubject(alert: Alert): AiActivitySubjectInput {
  return {
    kind: "alert",
    id: alert.id!.toString(),
    title: alert.title || undefined,
    number:
      typeof alert.alertNumber === "number" ? alert.alertNumber : undefined,
    numberWithPrefix: alert.alertNumberWithPrefix || undefined,
    monitorIds: alert.monitorId ? [alert.monitorId.toString()] : [],
    seriesLabels: alert.seriesLabels || undefined,
    createdAt: alert.createdAt ? new Date(alert.createdAt) : undefined,
  };
}

/*
 * Whether an open preventive finding is about the scope's own telemetry:
 * the detectors embed the entity a finding is about in its fingerprint
 * (ErrorLogSpikeDetector, MetricDriftDetector, TraceLatencyRegressionDetector),
 * and an exception finding's exception belongs to it (exceptionOwners).
 */
export function isPreventiveInsightAboutScope(data: {
  insight: Pick<
    AIInsight,
    "insightType" | "fingerprint" | "telemetryExceptionId"
  >;
  scopeId: string;
  exceptionOwners: Map<string, string>;
}): boolean {
  const scopeId: string = data.scopeId.toLowerCase();
  const fingerprint: string = (data.insight.fingerprint || "").toLowerCase();

  switch (data.insight.insightType) {
    case AIInsightType.ErrorLogSpike:
      return fingerprint === `error-log-spike:${scopeId}`;
    case AIInsightType.MetricDrift:
      return (
        fingerprint.startsWith("metric-drift:") &&
        fingerprint.endsWith(`:${scopeId}`)
      );
    case AIInsightType.TraceLatencyRegression:
      return fingerprint.startsWith(`latency:${scopeId}:`);
    case AIInsightType.NewException:
    case AIInsightType.ExceptionSpike: {
      const exceptionId: string | undefined =
        data.insight.telemetryExceptionId?.toString();
      return Boolean(
        exceptionId &&
          (data.exceptionOwners.get(exceptionId) || "").toLowerCase() ===
            scopeId,
      );
    }
    default:
      return false;
  }
}

export default class AiActivityInsightsReader {
  public static async read(
    scope: AiActivityInsightsScope,
    now: Date = new Date(),
  ): Promise<AiActivityInsights> {
    const windowInDays: number = AI_ACTIVITY_INSIGHTS_WINDOW_IN_DAYS;
    const windowStart: Date = AiActivityInsightsBuilder.getWindowStart(
      now,
      windowInDays,
    );
    const { projectId } = scope;

    // 1. The window's AI commands on the scope (root).
    const jobs: Array<RunnerJob> = await RunnerJobService.findBy({
      query: {
        ...scope.commandJobQuery,
        projectId,
        createdAt: QueryHelper.greaterThanEqualTo(windowStart),
      } as never,
      select: {
        _id: true,
        aiRunId: true,
        autoRemediationSuggestionId: true,
        origin: true,
        status: true,
      },
      sort: { createdAt: SortOrder.Descending },
      limit: AI_ACTIVITY_INSIGHTS_JOB_SCAN_LIMIT,
      skip: 0,
      props: { isRoot: true },
    });

    const commands: AiActivityCommandStats = {
      total: 0,
      failed: 0,
      timedOut: 0,
    };

    for (const job of jobs) {
      // The AI agent page's connection tests are the only ones without a run.
      if (job.origin === RunnerJobOrigin.AiInvestigation && !job.aiRunId) {
        continue;
      }

      commands.total++;

      if (job.status === RunnerJobStatus.Failed) {
        commands.failed++;
      } else if (job.status === RunnerJobStatus.TimedOut) {
        commands.timedOut++;
      }
    }

    /*
     * 2. The incidents and alerts of the window linked to the scope
     * (caller), with what raised them: everything that came up here.
     */
    const linkedQuery: Record<string, unknown> = {
      projectId,
      [scope.subjectRelation]: QueryHelper.inRelationArray([scope.scopeId]),
      createdAt: QueryHelper.greaterThanEqualTo(windowStart),
    };

    const [linkedIncidents, linkedAlerts]: [Array<Incident>, Array<Alert>] =
      await Promise.all([
        readIfPermitted<Incident>(() => {
          return IncidentService.findBy({
            query: linkedQuery as never,
            select: INCIDENT_SELECT as never,
            sort: { createdAt: SortOrder.Descending },
            limit: AI_ACTIVITY_INSIGHTS_LINKED_SUBJECT_LIMIT,
            skip: 0,
            props: scope.props,
          });
        }),
        readIfPermitted<Alert>(() => {
          return AlertService.findBy({
            query: linkedQuery as never,
            select: ALERT_SELECT as never,
            sort: { createdAt: SortOrder.Descending },
            limit: AI_ACTIVITY_INSIGHTS_LINKED_SUBJECT_LIMIT,
            skip: 0,
            props: scope.props,
          });
        }),
      ]);

    // 3. The window's investigations that concern the scope (root).
    const runReads: Array<Promise<Array<AIRun>>> = [];
    const readRuns: (
      query: Record<string, unknown>,
    ) => Promise<Array<AIRun>> = (
      query: Record<string, unknown>,
    ): Promise<Array<AIRun>> => {
      return AIRunService.findBy({
        query: {
          ...query,
          projectId,
          runType: AIRunType.Investigation,
          createdAt: QueryHelper.greaterThanEqualTo(windowStart),
        } as never,
        select: {
          _id: true,
          status: true,
          analysisTldr: true,
          createdAt: true,
          completedAt: true,
          triggeredByIncidentId: true,
          triggeredByAlertId: true,
          humanVerdict: true,
          autoGrade: true,
        },
        sort: { createdAt: SortOrder.Descending },
        limit: AI_ACTIVITY_INSIGHTS_MAX_INVESTIGATIONS,
        skip: 0,
        props: { isRoot: true },
      });
    };

    const runIdsFromJobs: Array<ObjectID> = getUniqueIds(
      jobs.map((job: RunnerJob): ObjectID | undefined => {
        return job.aiRunId;
      }),
    );
    const linkedIncidentIds: Array<ObjectID> = getUniqueIds(
      linkedIncidents.map((incident: Incident): ObjectID | null | undefined => {
        return incident.id;
      }),
    );
    const linkedAlertIds: Array<ObjectID> = getUniqueIds(
      linkedAlerts.map((alert: Alert): ObjectID | null | undefined => {
        return alert.id;
      }),
    );

    if (runIdsFromJobs.length > 0) {
      runReads.push(readRuns({ _id: QueryHelper.any(runIdsFromJobs) }));
    }

    if (linkedIncidentIds.length > 0) {
      runReads.push(
        readRuns({ triggeredByIncidentId: QueryHelper.any(linkedIncidentIds) }),
      );
    }

    if (linkedAlertIds.length > 0) {
      runReads.push(
        readRuns({ triggeredByAlertId: QueryHelper.any(linkedAlertIds) }),
      );
    }

    const runGroups: Array<Array<AIRun>> = await Promise.all(runReads);
    const candidateRuns: Array<AIRun> = mergeNewest(runGroups);

    /*
     * 4. The subjects of those runs and the linked ones, as the caller may
     * read them, with what raised them.
     */
    const subjects: Map<string, AiActivitySubjectInput> =
      await this.readSubjects({
        scope,
        runs: candidateRuns,
        linkedIncidents,
        linkedAlerts,
      });

    // A run whose incident or alert the caller cannot read is left out.
    const runs: Array<AIRun> = candidateRuns.filter((run: AIRun): boolean => {
      const subjectId: ObjectID | undefined =
        run.triggeredByIncidentId || run.triggeredByAlertId;
      return (
        Boolean(run.id && run.createdAt) &&
        (!subjectId || subjects.has(subjectId.toString()))
      );
    });

    // Everything that came up here: the linked incidents and alerts.
    const occurrences: Array<AiActivitySubjectInput> = [
      ...linkedIncidentIds,
      ...linkedAlertIds,
    ]
      .map((id: ObjectID): AiActivitySubjectInput | undefined => {
        return subjects.get(id.toString());
      })
      .filter(
        (
          subject: AiActivitySubjectInput | undefined,
        ): subject is AiActivitySubjectInput => {
          return Boolean(subject);
        },
      );

    // 5. The window's fixes on the scope (root).
    const suggestionIdsFromJobs: Array<ObjectID> = getUniqueIds(
      jobs.map((job: RunnerJob): ObjectID | undefined => {
        return job.autoRemediationSuggestionId;
      }),
    );
    const fixReads: Array<Promise<Array<AutoRemediationSuggestion>>> = [
      this.readFixes({ scope, windowStart, query: scope.ownFixQuery }),
    ];

    if (suggestionIdsFromJobs.length > 0) {
      fixReads.push(
        this.readFixes({
          scope,
          windowStart,
          query: { _id: QueryHelper.any(suggestionIdsFromJobs) },
        }),
      );
    }

    const fixGroups: Array<Array<AutoRemediationSuggestion>> =
      await Promise.all(fixReads);
    const suggestions: Array<AutoRemediationSuggestion> = mergeNewest(
      fixGroups,
    ).filter((suggestion: AutoRemediationSuggestion): boolean => {
      return Boolean(suggestion.id && suggestion.createdAt);
    });

    const isPartial: boolean =
      jobs.length >= AI_ACTIVITY_INSIGHTS_JOB_SCAN_LIMIT ||
      linkedIncidents.length >= AI_ACTIVITY_INSIGHTS_LINKED_SUBJECT_LIMIT ||
      linkedAlerts.length >= AI_ACTIVITY_INSIGHTS_LINKED_SUBJECT_LIMIT ||
      runGroups.some((group: Array<AIRun>): boolean => {
        return group.length >= AI_ACTIVITY_INSIGHTS_MAX_INVESTIGATIONS;
      }) ||
      fixGroups.some((group: Array<AutoRemediationSuggestion>): boolean => {
        return group.length >= AI_ACTIVITY_INSIGHTS_MAX_FIXES;
      });

    const input: AiActivityInsightsInput = {
      now,
      windowInDays,
      investigations: runs.map((run: AIRun): AiActivityInvestigationInput => {
        const subjectId: ObjectID | undefined =
          run.triggeredByIncidentId || run.triggeredByAlertId;
        const subject: AiActivitySubjectInput | undefined = subjectId
          ? subjects.get(subjectId.toString())
          : undefined;

        return {
          aiRunId: run.id!.toString(),
          status: run.status,
          createdAt: new Date(run.createdAt!),
          completedAt: run.completedAt ? new Date(run.completedAt) : undefined,
          // A finding only ever travels with a subject the caller may read.
          tldr: subject ? run.analysisTldr || undefined : undefined,
          humanVerdict: subject ? run.humanVerdict : undefined,
          autoGrade: subject ? run.autoGrade : undefined,
          subject,
        };
      }),
      fixes: suggestions.map(
        (suggestion: AutoRemediationSuggestion): AiActivityFixInput => {
          return {
            id: suggestion.id!.toString(),
            status: suggestion.status,
            verificationStatus: suggestion.verificationStatus,
            createdAt: new Date(suggestion.createdAt!),
            approvedAt: suggestion.approvedAt
              ? new Date(suggestion.approvedAt)
              : undefined,
            incidentId: suggestion.incidentId?.toString(),
            alertId: suggestion.alertId?.toString(),
          };
        },
      ),
      commands,
      preventiveInsights: await this.readPreventiveInsights(scope),
      scopeLabelKeys: scope.scopeLabelKeys,
      scopeNames: scope.scopeNames,
      isPartial,
      occurrences,
      subjects,
    };

    /*
     * 6. What each problem's newest completed investigation concluded: the
     * step its report suggests, and — when its TL;DR call failed — the
     * Summary its report opens with.
     */
    await this.readReportConclusions({ projectId, input });

    return AiActivityInsightsBuilder.build(input);
  }

  /*
   * The report conclusions of the runs the builder will show a finding for
   * (AiActivityInsightsBuilder.getRunsNeedingReport): every one of them is
   * about an incident or alert the caller may read.
   */
  public static async readReportConclusions(data: {
    projectId: ObjectID;
    input: AiActivityInsightsInput;
  }): Promise<void> {
    const needingReport: Set<string> = new Set<string>(
      AiActivityInsightsBuilder.getRunsNeedingReport(data.input),
    );

    if (needingReport.size === 0) {
      return;
    }

    const reportRuns: Array<InvestigationReportSummaryRun> = [];

    for (const investigation of data.input.investigations) {
      if (!needingReport.has(investigation.aiRunId) || !investigation.subject) {
        continue;
      }

      reportRuns.push({
        aiRunId: new ObjectID(investigation.aiRunId),
        ...(investigation.subject.kind === "incident"
          ? { incidentId: new ObjectID(investigation.subject.id) }
          : { alertId: new ObjectID(investigation.subject.id) }),
      });
    }

    if (reportRuns.length === 0) {
      return;
    }

    const conclusions: Map<string, InvestigationReportConclusion> =
      await InvestigationReportSummary.getConclusionsForRuns({
        projectId: data.projectId,
        runs: reportRuns,
      });

    for (const investigation of data.input.investigations) {
      const conclusion: InvestigationReportConclusion | undefined =
        conclusions.get(investigation.aiRunId);

      if (!conclusion) {
        continue;
      }

      if (conclusion.summary) {
        investigation.reportSummary = conclusion.summary;
      }

      if (conclusion.nextStep) {
        investigation.nextStep = conclusion.nextStep;
      }
    }
  }

  /*
   * The incidents and alerts the page names, read under the caller's props:
   * the window's ones linked to the scope (already read) and the ones the
   * runs investigated, with what raised them — an alert's monitor (its own
   * column), an incident's monitors (a relation, read as root for the
   * incidents the caller could read — they only ever become an opaque
   * grouping).
   */
  private static async readSubjects(data: {
    scope: AiActivityInsightsScope;
    runs: Array<AIRun>;
    linkedIncidents: Array<Incident>;
    linkedAlerts: Array<Alert>;
  }): Promise<Map<string, AiActivitySubjectInput>> {
    const { scope } = data;
    const subjects: Map<string, AiActivitySubjectInput> = new Map<
      string,
      AiActivitySubjectInput
    >();

    const known: Set<string> = new Set<string>(
      [...data.linkedIncidents, ...data.linkedAlerts]
        .map((row: Incident | Alert): string => {
          return row.id?.toString() || "";
        })
        .filter((id: string): boolean => {
          return Boolean(id);
        }),
    );

    // The runs' incidents and alerts not already read as linked ones.
    const incidentIds: Array<ObjectID> = getUniqueIds(
      data.runs.map((run: AIRun): ObjectID | undefined => {
        return run.triggeredByIncidentId &&
          !known.has(run.triggeredByIncidentId.toString())
          ? run.triggeredByIncidentId
          : undefined;
      }),
    );
    const alertIds: Array<ObjectID> = getUniqueIds(
      data.runs.map((run: AIRun): ObjectID | undefined => {
        // A run about both is the incident's.
        return !run.triggeredByIncidentId &&
          run.triggeredByAlertId &&
          !known.has(run.triggeredByAlertId.toString())
          ? run.triggeredByAlertId
          : undefined;
      }),
    );

    const [runIncidents, runAlerts]: [Array<Incident>, Array<Alert>] =
      await Promise.all([
        incidentIds.length > 0
          ? readIfPermitted<Incident>(() => {
              return IncidentService.findBy({
                query: {
                  projectId: scope.projectId,
                  _id: QueryHelper.any(incidentIds),
                },
                select: INCIDENT_SELECT as never,
                limit: incidentIds.length,
                skip: 0,
                props: scope.props,
              });
            })
          : Promise.resolve([]),
        alertIds.length > 0
          ? readIfPermitted<Alert>(() => {
              return AlertService.findBy({
                query: {
                  projectId: scope.projectId,
                  _id: QueryHelper.any(alertIds),
                },
                select: ALERT_SELECT as never,
                limit: alertIds.length,
                skip: 0,
                props: scope.props,
              });
            })
          : Promise.resolve([]),
      ]);

    const incidents: Array<Incident> = [
      ...data.linkedIncidents,
      ...runIncidents,
    ].filter((incident: Incident): boolean => {
      return Boolean(incident.id);
    });
    const alerts: Array<Alert> = [...data.linkedAlerts, ...runAlerts].filter(
      (alert: Alert): boolean => {
        return Boolean(alert.id);
      },
    );

    const readableIncidentIds: Array<ObjectID> = getUniqueIds(
      incidents.map((incident: Incident): ObjectID | null | undefined => {
        return incident.id;
      }),
    );

    const incidentMonitors: Array<Incident> =
      readableIncidentIds.length > 0
        ? await IncidentService.findBy({
            query: {
              projectId: scope.projectId,
              _id: QueryHelper.any(readableIncidentIds),
            },
            select: { _id: true, monitors: { _id: true } },
            limit: readableIncidentIds.length,
            skip: 0,
            props: { isRoot: true },
          })
        : [];

    const monitorsByIncident: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();

    for (const incident of incidentMonitors) {
      if (!incident.id) {
        continue;
      }

      monitorsByIncident.set(
        incident.id.toString(),
        (incident.monitors || [])
          .map((monitor: Monitor): string => {
            return monitor.id?.toString() || "";
          })
          .filter((id: string): boolean => {
            return Boolean(id);
          }),
      );
    }

    for (const incident of incidents) {
      const id: string = incident.id!.toString();

      if (!subjects.has(id)) {
        subjects.set(
          id,
          toIncidentSubject(incident, monitorsByIncident.get(id) || []),
        );
      }
    }

    for (const alert of alerts) {
      const id: string = alert.id!.toString();

      if (!subjects.has(id)) {
        subjects.set(id, toAlertSubject(alert));
      }
    }

    return subjects;
  }

  private static readFixes(data: {
    scope: AiActivityInsightsScope;
    windowStart: Date;
    query: Record<string, unknown>;
  }): Promise<Array<AutoRemediationSuggestion>> {
    return AutoRemediationSuggestionService.findBy({
      query: {
        ...data.query,
        projectId: data.scope.projectId,
        createdAt: QueryHelper.greaterThanEqualTo(data.windowStart),
      } as never,
      // Statuses and dates only: never a rationale or a command plan.
      select: {
        _id: true,
        status: true,
        verificationStatus: true,
        createdAt: true,
        approvedAt: true,
        incidentId: true,
        alertId: true,
      },
      sort: { createdAt: SortOrder.Descending },
      limit: AI_ACTIVITY_INSIGHTS_MAX_FIXES,
      skip: 0,
      props: { isRoot: true },
    });
  }

  /*
   * The open preventive findings filed against the scope's own telemetry,
   * read under the caller's props, most recently seen first.
   */
  private static async readPreventiveInsights(
    scope: AiActivityInsightsScope,
  ): Promise<Array<AiActivityPreventiveInsight>> {
    const select: Record<string, boolean> = {
      _id: true,
      title: true,
      insightType: true,
      severity: true,
      status: true,
      fingerprint: true,
      telemetryExceptionId: true,
      lastSeenAt: true,
      occurrenceCount: true,
    };

    const [byFingerprint, exceptionInsights]: [
      Array<AIInsight>,
      Array<AIInsight>,
    ] = await Promise.all([
      // Spikes, drift and regressions name their entity in the fingerprint.
      readIfPermitted<AIInsight>(() => {
        return AIInsightService.findBy({
          query: {
            projectId: scope.projectId,
            status: QueryHelper.any(OPEN_INSIGHT_STATUSES),
            fingerprint: QueryHelper.search(scope.scopeId.toString()),
          } as never,
          select: select as never,
          sort: { lastSeenAt: SortOrder.Descending },
          limit: AI_ACTIVITY_INSIGHTS_EXCEPTION_INSIGHT_SCAN_LIMIT,
          skip: 0,
          props: scope.props,
        });
      }),
      // An exception finding is the scope's when its exception is.
      readIfPermitted<AIInsight>(() => {
        return AIInsightService.findBy({
          query: {
            projectId: scope.projectId,
            status: QueryHelper.any(OPEN_INSIGHT_STATUSES),
            insightType: QueryHelper.any(EXCEPTION_INSIGHT_TYPES),
            telemetryExceptionId: QueryHelper.notNull(),
          } as never,
          select: select as never,
          sort: { lastSeenAt: SortOrder.Descending },
          limit: AI_ACTIVITY_INSIGHTS_EXCEPTION_INSIGHT_SCAN_LIMIT,
          skip: 0,
          props: scope.props,
        });
      }),
    ]);

    const exceptionIds: Array<ObjectID> = getUniqueIds(
      exceptionInsights.map((insight: AIInsight): ObjectID | undefined => {
        return insight.telemetryExceptionId;
      }),
    );

    const exceptions: Array<TelemetryException> =
      exceptionIds.length > 0
        ? await TelemetryExceptionService.findBy({
            query: {
              projectId: scope.projectId,
              _id: QueryHelper.any(exceptionIds),
              primaryEntityId: scope.scopeId,
            } as never,
            select: { _id: true, primaryEntityId: true },
            limit: exceptionIds.length,
            skip: 0,
            props: { isRoot: true },
          })
        : [];

    const exceptionOwners: Map<string, string> = new Map<string, string>();

    for (const exception of exceptions) {
      if (exception.id && exception.primaryEntityId) {
        exceptionOwners.set(
          exception.id.toString(),
          exception.primaryEntityId.toString(),
        );
      }
    }

    const insights: Array<AIInsight> = mergeNewest(
      [byFingerprint, exceptionInsights].map(
        (rows: Array<AIInsight>): Array<AIInsight> => {
          return rows.filter((insight: AIInsight): boolean => {
            return isPreventiveInsightAboutScope({
              insight,
              scopeId: scope.scopeId.toString(),
              exceptionOwners,
            });
          });
        },
      ),
    ).sort((a: AIInsight, b: AIInsight): number => {
      return (
        (b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0) -
        (a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0)
      );
    });

    return insights.map((insight: AIInsight): AiActivityPreventiveInsight => {
      return {
        id: insight.id!.toString(),
        title: insight.title || "",
        insightType: insight.insightType || "",
        severity: insight.severity || "",
        status: insight.status || "",
        lastSeenAt: insight.lastSeenAt
          ? new Date(insight.lastSeenAt).toISOString()
          : undefined,
        occurrenceCount:
          typeof insight.occurrenceCount === "number"
            ? insight.occurrenceCount
            : undefined,
      };
    });
  }
}
