import AIRunService from "../../../Services/AIRunService";
import AlertService from "../../../Services/AlertService";
import AutoRemediationSuggestionService from "../../../Services/AutoRemediationSuggestionService";
import IncidentService from "../../../Services/IncidentService";
import MonitorService from "../../../Services/MonitorService";
import RunnerJobService from "../../../Services/RunnerJobService";
import ServiceService from "../../../Services/ServiceService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import AiActivityInsightsBuilder, {
  AiActivityCommandStats,
} from "../ActivityInsights/AiActivityInsightsBuilder";
import InvestigationReportSummary, {
  InvestigationReportConclusion,
  InvestigationReportSummaryRun,
} from "../SRE/InvestigationReportSummary";
import IncidentAlertAiInsightsBuilder, {
  IncidentAlertAiFixInput,
  IncidentAlertAiFixTaskInput,
  IncidentAlertAiInsightsInput,
  IncidentAlertAiInvestigationInput,
  IncidentAlertAiSubjectInput,
} from "./IncidentAlertAiInsightsBuilder";
import IncidentAlertAiLogsReader from "./IncidentAlertAiLogsReader";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import Service from "../../../../Models/DatabaseModels/Service";
import AIRunType from "../../../../Types/AI/AIRunType";
import { AI_ACTIVITY_INSIGHTS_WINDOW_IN_DAYS } from "../../../../Types/AI/AiActivityInsights";
import {
  INCIDENT_ALERT_AI_INSIGHTS_MAX_FIXES,
  INCIDENT_ALERT_AI_INSIGHTS_MAX_FIX_TASKS,
  INCIDENT_ALERT_AI_INSIGHTS_MAX_INVESTIGATIONS,
  INCIDENT_ALERT_AI_INSIGHTS_OCCURRENCE_SCAN_LIMIT,
  IncidentAlertAiInsights,
} from "../../../../Types/AI/IncidentAlertAiInsights";
import { IncidentAlertAiSubjectKind } from "../../../../Types/AI/IncidentAlertAiLogs";
import InvestigationNotStartedReason, {
  InvestigationNotStartedCode,
} from "../../../../Types/AI/InvestigationNotStartedReason";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import RunnerJobStatus from "../../../../Types/Runbook/RunnerJobStatus";

/*
 * Reads what the AI Insights page of the Incidents (or Alerts) menu sums up
 * and hands it to IncidentAlertAiInsightsBuilder.
 *
 * Who sees what, the way the AI Logs page decides it
 * (IncidentAlertAiLogsReader):
 *
 *   - the caller must be able to read incidents (or alerts) at all;
 *   - every incident (or alert) counted - the window's, for how often each
 *     problem came up, and the ones AI investigated, fixed or opened a fix
 *     pull request for - is read under the caller's props, labels and
 *     private incidents included, and the rest are left out, from the
 *     totals too;
 *   - AI runs are read as root (an investigation run is private to its
 *     author in the AI run table), and only statuses, dates, verdicts and
 *     the one-line finding leave, next to an incident the caller may read;
 *     what each shown problem's newest completed investigation concluded -
 *     the step its report suggests, and its report's Summary when it has no
 *     TL;DR (InvestigationReportSummary) - is read as root for those runs
 *     only;
 *   - fixes are read under the caller's props: a role that may not read
 *     auto-remediation suggestions gets no fix numbers (null), not zeros;
 *   - which monitors and services the incidents were raised for or affected
 *     is read as root for the readable incidents, and only the ones the
 *     caller may read are named;
 *   - why an incident was not investigated (its recorded decision) is read
 *     as root and counted only for incidents the caller may read; the
 *     incident's own AI panel shows the same reason to the same people;
 *   - command counts are read as root: only counts leave.
 *
 * Bounded: the window's newest INCIDENT_ALERT_AI_INSIGHTS_MAX_* rows of each
 * kind, and its newest INCIDENT_ALERT_AI_INSIGHTS_OCCURRENCE_SCAN_LIMIT
 * incidents (or alerts); reaching a bound marks the insights partial.
 */

// How many of the commands of the window's investigations and fixes are counted.
export const INCIDENT_ALERT_AI_INSIGHTS_COMMAND_SCAN_LIMIT: number = 5000;

// How many skipped incidents (or alerts) of the window are read.
export const INCIDENT_ALERT_AI_INSIGHTS_DECISION_SCAN_LIMIT: number = 2000;

// How many monitors, and services, are looked up by name at most.
export const INCIDENT_ALERT_AI_INSIGHTS_NAME_LOOKUP_LIMIT: number = 200;

export interface IncidentAlertAiInsightsReadOptions {
  subjectKind: IncidentAlertAiSubjectKind;
  projectId: ObjectID;
  // The caller's own, tenant-pinned props.
  props: DatabaseCommonInteractionProps;
  now?: Date | undefined;
}

// What an incident is read with, under the caller's props.
const INCIDENT_SELECT: Record<string, boolean> = {
  _id: true,
  createdAt: true,
  title: true,
  incidentNumber: true,
  incidentNumberWithPrefix: true,
  seriesLabels: true,
};

// What an alert is read with, under the caller's props.
const ALERT_SELECT: Record<string, boolean> = {
  _id: true,
  createdAt: true,
  title: true,
  alertNumber: true,
  alertNumberWithPrefix: true,
  seriesLabels: true,
};

async function readIfPermitted<T>(
  read: () => Promise<T>,
): Promise<{ isPermitted: boolean; value: T | null }> {
  try {
    return { isPermitted: true, value: await read() };
  } catch (error) {
    if (error instanceof NotAuthorizedException) {
      return { isPermitted: false, value: null };
    }

    throw error;
  }
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

function getIdStrings(ids: Array<{ id?: ObjectID | null }>): Array<string> {
  return ids
    .map((row: { id?: ObjectID | null }): string => {
      return row.id?.toString() || "";
    })
    .filter((id: string): boolean => {
      return Boolean(id);
    });
}

export default class IncidentAlertAiInsightsReader {
  public static async read(
    options: IncidentAlertAiInsightsReadOptions,
  ): Promise<IncidentAlertAiInsights> {
    const now: Date = options.now || new Date();
    const windowInDays: number = AI_ACTIVITY_INSIGHTS_WINDOW_IN_DAYS;
    const windowStart: Date = AiActivityInsightsBuilder.getWindowStart(
      now,
      windowInDays,
    );
    const { projectId, subjectKind } = options;

    await IncidentAlertAiLogsReader.assertCanReadSubjects(options);

    const inWindow: Record<string, unknown> = {
      projectId,
      createdAt: QueryHelper.greaterThanEqualTo(windowStart),
    };

    // 1. The window's investigations and fix pull requests (root).
    const readRuns: (
      runType: AIRunType,
      limit: number,
    ) => Promise<Array<AIRun>> = (
      runType: AIRunType,
      limit: number,
    ): Promise<Array<AIRun>> => {
      return AIRunService.findBy({
        query: {
          ...IncidentAlertAiLogsReader.getRunSubjectQuery(subjectKind),
          ...inWindow,
          runType,
        } as never,
        select: {
          _id: true,
          status: true,
          createdAt: true,
          completedAt: true,
          triggeredByIncidentId: true,
          triggeredByAlertId: true,
          ...(runType === AIRunType.Investigation
            ? { analysisTldr: true, humanVerdict: true, autoGrade: true }
            : {}),
        },
        sort: { createdAt: SortOrder.Descending },
        limit,
        skip: 0,
        props: { isRoot: true },
      });
    };

    // 2. The window's fixes (the caller's props).
    const [runs, tasks, fixRead]: [
      Array<AIRun>,
      Array<AIRun>,
      { isPermitted: boolean; value: Array<AutoRemediationSuggestion> | null },
    ] = await Promise.all([
      readRuns(
        AIRunType.Investigation,
        INCIDENT_ALERT_AI_INSIGHTS_MAX_INVESTIGATIONS,
      ),
      readRuns(AIRunType.CodeFix, INCIDENT_ALERT_AI_INSIGHTS_MAX_FIX_TASKS),
      readIfPermitted<Array<AutoRemediationSuggestion>>(() => {
        return AutoRemediationSuggestionService.findBy({
          query: {
            ...(subjectKind === "incident"
              ? { incidentId: QueryHelper.notNull() }
              : {
                  alertId: QueryHelper.notNull(),
                  incidentId: QueryHelper.isNull(),
                }),
            ...inWindow,
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
          limit: INCIDENT_ALERT_AI_INSIGHTS_MAX_FIXES,
          skip: 0,
          props: options.props,
        });
      }),
    ]);

    const suggestions: Array<AutoRemediationSuggestion> | null = fixRead.value;

    /*
     * 3. The incidents (or alerts) all of it was about, and every one of the
     * window, as the caller may read them.
     */
    const subjectIdOfRun: (run: AIRun) => string | undefined = (
      run: AIRun,
    ): string | undefined => {
      return IncidentAlertAiLogsReader.getRunSubjectId(subjectKind, run);
    };
    const subjectIdOfFix: (
      suggestion: AutoRemediationSuggestion,
    ) => string | undefined = (
      suggestion: AutoRemediationSuggestion,
    ): string | undefined => {
      return subjectKind === "incident"
        ? suggestion.incidentId?.toString()
        : suggestion.incidentId
          ? undefined
          : suggestion.alertId?.toString();
    };

    const subjectIds: Array<string> = Array.from(
      new Set<string>(
        [
          ...runs.map(subjectIdOfRun),
          ...tasks.map(subjectIdOfRun),
          ...(suggestions || []).map(subjectIdOfFix),
        ].filter((id: string | undefined): id is string => {
          return Boolean(id);
        }),
      ),
    );

    const read: {
      subjects: Map<string, IncidentAlertAiSubjectInput>;
      occurrenceIds: Array<string>;
      isPartial: boolean;
    } = await this.readSubjects({ options, subjectIds, windowStart });
    const subjects: Map<string, IncidentAlertAiSubjectInput> = read.subjects;

    // 4. Their monitors and services, by the names the caller may read.
    const [monitorNames, serviceNames]: [
      Map<string, string>,
      Map<string, string>,
    ] = await Promise.all([
      this.readNames({
        options,
        ids: this.getMostCommonIds(subjects, "monitorIds"),
        kind: "monitor",
      }),
      this.readNames({
        options,
        ids: this.getMostCommonIds(subjects, "serviceIds"),
        kind: "service",
      }),
    ]);

    // 5. The commands of those investigations and fixes (root, counts only).
    const readableRuns: Array<AIRun> = runs.filter((run: AIRun): boolean => {
      const subjectId: string | undefined = subjectIdOfRun(run);
      return Boolean(
        run.id && run.createdAt && subjectId && subjects.has(subjectId),
      );
    });
    const readableFixes: Array<AutoRemediationSuggestion> | null = suggestions
      ? suggestions.filter((suggestion: AutoRemediationSuggestion): boolean => {
          const subjectId: string | undefined = subjectIdOfFix(suggestion);
          return Boolean(
            suggestion.id &&
              suggestion.createdAt &&
              subjectId &&
              subjects.has(subjectId),
          );
        })
      : null;

    const commands: { stats: AiActivityCommandStats; isPartial: boolean } =
      await this.countCommands({
        projectId,
        runIds: getUniqueIds(
          readableRuns.map((run: AIRun): ObjectID | null | undefined => {
            return run.id;
          }),
        ),
        fixIds: getUniqueIds(
          (readableFixes || []).map(
            (
              suggestion: AutoRemediationSuggestion,
            ): ObjectID | null | undefined => {
              return suggestion.id;
            },
          ),
        ),
      });

    // 6. How many of the window's incidents there are, and why some were skipped.
    const [subjectsInWindow, notInvestigated]: [
      number,
      { reasons: Map<string, InvestigationNotStartedCode>; isPartial: boolean },
    ] = await Promise.all([
      this.countSubjectsInWindow({ options, windowStart }),
      this.readNotInvestigated({ options, windowStart }),
    ]);

    const isPartial: boolean =
      runs.length >= INCIDENT_ALERT_AI_INSIGHTS_MAX_INVESTIGATIONS ||
      tasks.length >= INCIDENT_ALERT_AI_INSIGHTS_MAX_FIX_TASKS ||
      (suggestions || []).length >= INCIDENT_ALERT_AI_INSIGHTS_MAX_FIXES ||
      read.isPartial ||
      commands.isPartial ||
      notInvestigated.isPartial;

    const input: IncidentAlertAiInsightsInput = {
      subjectKind,
      now,
      windowInDays,
      investigations: readableRuns.map(
        (run: AIRun): IncidentAlertAiInvestigationInput => {
          return {
            aiRunId: run.id!.toString(),
            status: run.status,
            createdAt: new Date(run.createdAt!),
            completedAt: run.completedAt
              ? new Date(run.completedAt)
              : undefined,
            tldr: run.analysisTldr || undefined,
            humanVerdict: run.humanVerdict,
            autoGrade: run.autoGrade,
            subjectId: subjectIdOfRun(run)!,
          };
        },
      ),
      fixes: readableFixes
        ? readableFixes.map(
            (
              suggestion: AutoRemediationSuggestion,
            ): IncidentAlertAiFixInput => {
              return {
                id: suggestion.id!.toString(),
                status: suggestion.status,
                verificationStatus: suggestion.verificationStatus,
                createdAt: new Date(suggestion.createdAt!),
                approvedAt: suggestion.approvedAt
                  ? new Date(suggestion.approvedAt)
                  : undefined,
                subjectId: subjectIdOfFix(suggestion)!,
              };
            },
          )
        : null,
      fixTasks: tasks
        .filter((task: AIRun): boolean => {
          const subjectId: string | undefined = subjectIdOfRun(task);
          return Boolean(
            task.id && task.createdAt && subjectId && subjects.has(subjectId),
          );
        })
        .map((task: AIRun): IncidentAlertAiFixTaskInput => {
          return {
            id: task.id!.toString(),
            status: task.status,
            createdAt: new Date(task.createdAt!),
            subjectId: subjectIdOfRun(task)!,
          };
        }),
      subjects,
      occurrenceIds: read.occurrenceIds,
      monitorNames,
      serviceNames,
      commands: commands.stats,
      subjectsInWindow,
      notInvestigatedReasons: notInvestigated.reasons,
      isPartial,
    };

    /*
     * 7. What each shown problem's newest completed investigation concluded:
     * the step its report suggests, and — when its TL;DR call failed — the
     * Summary its report opens with.
     */
    await this.readReportConclusions({ projectId, input });

    return IncidentAlertAiInsightsBuilder.build(input);
  }

  /*
   * The report conclusions of each problem's newest completed investigation
   * (AiActivityInsightsBuilder.getRunsNeedingReport): the step its report
   * suggests, and its Summary when it has no TL;DR. Every run here is about
   * an incident (or alert) the caller may read.
   */
  public static async readReportConclusions(data: {
    projectId: ObjectID;
    input: IncidentAlertAiInsightsInput;
  }): Promise<void> {
    const { input } = data;
    const needingReport: Set<string> = new Set<string>(
      AiActivityInsightsBuilder.getRunsNeedingReport(
        IncidentAlertAiInsightsBuilder.toActivityInput(input),
      ),
    );

    if (needingReport.size === 0) {
      return;
    }

    const runs: Array<InvestigationReportSummaryRun> = input.investigations
      .filter((run: IncidentAlertAiInvestigationInput): boolean => {
        return needingReport.has(run.aiRunId);
      })
      .map(
        (
          run: IncidentAlertAiInvestigationInput,
        ): InvestigationReportSummaryRun => {
          return {
            aiRunId: new ObjectID(run.aiRunId),
            ...(input.subjectKind === "incident"
              ? { incidentId: new ObjectID(run.subjectId) }
              : { alertId: new ObjectID(run.subjectId) }),
          };
        },
      );

    const conclusions: Map<string, InvestigationReportConclusion> =
      await InvestigationReportSummary.getConclusionsForRuns({
        projectId: data.projectId,
        runs,
      });

    for (const run of input.investigations) {
      const conclusion: InvestigationReportConclusion | undefined =
        conclusions.get(run.aiRunId);

      if (!conclusion) {
        continue;
      }

      if (conclusion.summary) {
        run.reportSummary = conclusion.summary;
      }

      if (conclusion.nextStep) {
        run.nextStep = conclusion.nextStep;
      }
    }
  }

  /*
   * The incidents (or alerts) the page names, read under the caller's
   * props: the window's newest ones (everything that came up), and the ones
   * the rows are about that the window's read did not reach. With what
   * raised them and what they affected: an alert's monitor is its own
   * column; an incident's monitors and either's services are relations,
   * read as root for the ones the caller could read - they only ever become
   * counts and, for the ones the caller may read, names.
   */
  private static async readSubjects(data: {
    options: IncidentAlertAiInsightsReadOptions;
    subjectIds: Array<string>;
    windowStart: Date;
  }): Promise<{
    subjects: Map<string, IncidentAlertAiSubjectInput>;
    // The window's ones, newest first.
    occurrenceIds: Array<string>;
    isPartial: boolean;
  }> {
    const { options } = data;
    const subjects: Map<string, IncidentAlertAiSubjectInput> = new Map<
      string,
      IncidentAlertAiSubjectInput
    >();
    const isIncident: boolean = options.subjectKind === "incident";

    const readRows: (
      query: Record<string, unknown>,
      limit: number,
    ) => Promise<Array<Incident | Alert>> = async (
      query: Record<string, unknown>,
      limit: number,
    ): Promise<Array<Incident | Alert>> => {
      const read: {
        isPermitted: boolean;
        value: Array<Incident | Alert> | null;
      } = await readIfPermitted<Array<Incident | Alert>>(() => {
        return isIncident
          ? IncidentService.findBy({
              query: { ...query, projectId: options.projectId } as never,
              select: INCIDENT_SELECT as never,
              sort: { createdAt: SortOrder.Descending },
              limit,
              skip: 0,
              props: options.props,
            })
          : AlertService.findBy({
              query: { ...query, projectId: options.projectId } as never,
              select: ALERT_SELECT as never,
              sort: { createdAt: SortOrder.Descending },
              limit,
              skip: 0,
              props: options.props,
            });
      });

      return read.value || [];
    };

    // Everything that came up in the window.
    const windowRows: Array<Incident | Alert> = await readRows(
      { createdAt: QueryHelper.greaterThanEqualTo(data.windowStart) },
      INCIDENT_ALERT_AI_INSIGHTS_OCCURRENCE_SCAN_LIMIT,
    );
    const occurrenceIds: Array<string> = getIdStrings(windowRows);
    const known: Set<string> = new Set<string>(occurrenceIds);

    // The rows' own subjects the window's read did not reach.
    const missingIds: Array<ObjectID> = data.subjectIds
      .filter((id: string): boolean => {
        return !known.has(id);
      })
      .map((id: string): ObjectID => {
        return new ObjectID(id);
      });

    const otherRows: Array<Incident | Alert> =
      missingIds.length > 0
        ? await readRows(
            { _id: QueryHelper.any(missingIds) },
            missingIds.length,
          )
        : [];

    const rows: Array<Incident | Alert> = [...windowRows, ...otherRows].filter(
      (row: Incident | Alert): boolean => {
        return Boolean(row.id);
      },
    );

    if (rows.length === 0) {
      return { subjects, occurrenceIds: [], isPartial: false };
    }

    const readableIds: Array<ObjectID> = getUniqueIds(
      rows.map((row: Incident | Alert): ObjectID | null | undefined => {
        return row.id;
      }),
    );

    const relationsById: Map<string, Incident | Alert> = new Map<
      string,
      Incident | Alert
    >();

    const relations: Array<Incident | Alert> = isIncident
      ? await IncidentService.findBy({
          query: {
            projectId: options.projectId,
            _id: QueryHelper.any(readableIds),
          },
          select: {
            _id: true,
            monitors: { _id: true },
            services: { _id: true },
          },
          limit: readableIds.length,
          skip: 0,
          props: { isRoot: true },
        })
      : await AlertService.findBy({
          query: {
            projectId: options.projectId,
            _id: QueryHelper.any(readableIds),
          },
          select: { _id: true, monitorId: true, services: { _id: true } },
          limit: readableIds.length,
          skip: 0,
          props: { isRoot: true },
        });

    for (const row of relations) {
      if (row.id) {
        relationsById.set(row.id.toString(), row);
      }
    }

    const getServiceIds: (
      row: Incident | Alert | undefined,
    ) => Array<string> = (row: Incident | Alert | undefined): Array<string> => {
      return (row?.services || [])
        .map((service: Service): string => {
          return service.id?.toString() || "";
        })
        .filter((id: string): boolean => {
          return Boolean(id);
        });
    };

    for (const row of rows) {
      const id: string = row.id!.toString();

      if (subjects.has(id)) {
        continue;
      }

      const related: Incident | Alert | undefined = relationsById.get(id);

      if (isIncident) {
        const incident: Incident = row as Incident;

        subjects.set(id, {
          id,
          createdAt: incident.createdAt
            ? new Date(incident.createdAt)
            : undefined,
          title: incident.title || undefined,
          number:
            typeof incident.incidentNumber === "number"
              ? incident.incidentNumber
              : undefined,
          numberWithPrefix: incident.incidentNumberWithPrefix || undefined,
          seriesLabels: incident.seriesLabels || undefined,
          monitorIds: ((related as Incident | undefined)?.monitors || [])
            .map((monitor: Monitor): string => {
              return monitor.id?.toString() || "";
            })
            .filter((monitorId: string): boolean => {
              return Boolean(monitorId);
            }),
          serviceIds: getServiceIds(related),
        });

        continue;
      }

      const alert: Alert = row as Alert;
      const monitorId: ObjectID | undefined = (related as Alert | undefined)
        ?.monitorId;

      subjects.set(id, {
        id,
        createdAt: alert.createdAt ? new Date(alert.createdAt) : undefined,
        title: alert.title || undefined,
        number:
          typeof alert.alertNumber === "number" ? alert.alertNumber : undefined,
        numberWithPrefix: alert.alertNumberWithPrefix || undefined,
        seriesLabels: alert.seriesLabels || undefined,
        monitorIds: monitorId ? [monitorId.toString()] : [],
        serviceIds: getServiceIds(related),
      });
    }

    return {
      subjects,
      occurrenceIds,
      isPartial:
        windowRows.length >= INCIDENT_ALERT_AI_INSIGHTS_OCCURRENCE_SCAN_LIMIT,
    };
  }

  /*
   * The monitor (or service) ids the most incidents name, the most common
   * first: only those can make the page's lists, so only those are looked
   * up by name.
   */
  public static getMostCommonIds(
    subjects: Map<string, IncidentAlertAiSubjectInput>,
    field: "monitorIds" | "serviceIds",
  ): Array<string> {
    const counts: Map<string, number> = new Map<string, number>();

    for (const subject of subjects.values()) {
      for (const id of new Set<string>(subject[field])) {
        counts.set(id, (counts.get(id) || 0) + 1);
      }
    }

    return Array.from(counts.entries())
      .sort((a: [string, number], b: [string, number]): number => {
        return b[1] - a[1] || a[0].localeCompare(b[0]);
      })
      .slice(0, INCIDENT_ALERT_AI_INSIGHTS_NAME_LOOKUP_LIMIT)
      .map(([id]: [string, number]): string => {
        return id;
      });
  }

  // Names of the monitors (or services) the caller may read, by id.
  private static async readNames(data: {
    options: IncidentAlertAiInsightsReadOptions;
    ids: Array<string>;
    kind: "monitor" | "service";
  }): Promise<Map<string, string>> {
    const names: Map<string, string> = new Map<string, string>();

    if (data.ids.length === 0) {
      return names;
    }

    const query: Record<string, unknown> = {
      projectId: data.options.projectId,
      _id: QueryHelper.any(
        data.ids.map((id: string): ObjectID => {
          return new ObjectID(id);
        }),
      ),
    };

    const read: {
      isPermitted: boolean;
      value: Array<Monitor | Service> | null;
    } = await readIfPermitted<Array<Monitor | Service>>(() => {
      return data.kind === "monitor"
        ? MonitorService.findBy({
            query: query as never,
            select: { _id: true, name: true },
            limit: data.ids.length,
            skip: 0,
            props: data.options.props,
          })
        : ServiceService.findBy({
            query: query as never,
            select: { _id: true, name: true },
            limit: data.ids.length,
            skip: 0,
            props: data.options.props,
          });
    });

    for (const row of read.value || []) {
      if (row.id && row.name) {
        names.set(row.id.toString(), row.name);
      }
    }

    return names;
  }

  // How many commands the investigations and fixes ran, and how they ended.
  private static async countCommands(data: {
    projectId: ObjectID;
    runIds: Array<ObjectID>;
    fixIds: Array<ObjectID>;
  }): Promise<{ stats: AiActivityCommandStats; isPartial: boolean }> {
    const reads: Array<Promise<Array<RunnerJob>>> = [];

    const readJobs: (
      query: Record<string, unknown>,
    ) => Promise<Array<RunnerJob>> = (
      query: Record<string, unknown>,
    ): Promise<Array<RunnerJob>> => {
      return RunnerJobService.findBy({
        query: { ...query, projectId: data.projectId } as never,
        select: { _id: true, status: true },
        sort: { createdAt: SortOrder.Descending },
        limit: INCIDENT_ALERT_AI_INSIGHTS_COMMAND_SCAN_LIMIT,
        skip: 0,
        props: { isRoot: true },
      });
    };

    if (data.runIds.length > 0) {
      reads.push(readJobs({ aiRunId: QueryHelper.any(data.runIds) }));
    }

    if (data.fixIds.length > 0) {
      reads.push(
        readJobs({ autoRemediationSuggestionId: QueryHelper.any(data.fixIds) }),
      );
    }

    const groups: Array<Array<RunnerJob>> = await Promise.all(reads);
    const jobs: Map<string, RunnerJob> = new Map<string, RunnerJob>();

    for (const group of groups) {
      for (const job of group) {
        if (job.id) {
          jobs.set(job.id.toString(), job);
        }
      }
    }

    const stats: AiActivityCommandStats = {
      total: 0,
      failed: 0,
      timedOut: 0,
    };

    for (const job of jobs.values()) {
      stats.total++;

      if (job.status === RunnerJobStatus.Failed) {
        stats.failed++;
      } else if (job.status === RunnerJobStatus.TimedOut) {
        stats.timedOut++;
      }
    }

    return {
      stats,
      isPartial: groups.some((group: Array<RunnerJob>): boolean => {
        return group.length >= INCIDENT_ALERT_AI_INSIGHTS_COMMAND_SCAN_LIMIT;
      }),
    };
  }

  // The window's incidents (or alerts) the caller may read.
  private static async countSubjectsInWindow(data: {
    options: IncidentAlertAiInsightsReadOptions;
    windowStart: Date;
  }): Promise<number> {
    const query: Record<string, unknown> = {
      projectId: data.options.projectId,
      createdAt: QueryHelper.greaterThanEqualTo(data.windowStart),
    };

    const count: PositiveNumber =
      data.options.subjectKind === "incident"
        ? await IncidentService.countBy({
            query: query as never,
            props: data.options.props,
          })
        : await AlertService.countBy({
            query: query as never,
            props: data.options.props,
          });

    return count.toNumber();
  }

  /*
   * Why the window's skipped incidents (or alerts) were not investigated,
   * by id: the decision recorded at creation (read as root - the column is
   * the server's own), kept for the ones the caller may read.
   */
  private static async readNotInvestigated(data: {
    options: IncidentAlertAiInsightsReadOptions;
    windowStart: Date;
  }): Promise<{
    reasons: Map<string, InvestigationNotStartedCode>;
    isPartial: boolean;
  }> {
    const { options } = data;
    const query: Record<string, unknown> = {
      projectId: options.projectId,
      createdAt: QueryHelper.greaterThanEqualTo(data.windowStart),
      aiInvestigationDecision: QueryHelper.notNull(),
    };

    const decided: Array<Incident | Alert> =
      options.subjectKind === "incident"
        ? await IncidentService.findBy({
            query: query as never,
            select: { _id: true, aiInvestigationDecision: true },
            sort: { createdAt: SortOrder.Descending },
            limit: INCIDENT_ALERT_AI_INSIGHTS_DECISION_SCAN_LIMIT,
            skip: 0,
            props: { isRoot: true },
          })
        : await AlertService.findBy({
            query: query as never,
            select: { _id: true, aiInvestigationDecision: true },
            sort: { createdAt: SortOrder.Descending },
            limit: INCIDENT_ALERT_AI_INSIGHTS_DECISION_SCAN_LIMIT,
            skip: 0,
            props: { isRoot: true },
          });

    const codes: Map<string, InvestigationNotStartedCode> = new Map<
      string,
      InvestigationNotStartedCode
    >();

    for (const row of decided) {
      const decision: InvestigationNotStartedReason | undefined =
        row.aiInvestigationDecision;

      if (row.id && decision && typeof decision.code === "string") {
        codes.set(row.id.toString(), decision.code);
      }
    }

    const ids: Array<ObjectID> = Array.from(codes.keys()).map(
      (id: string): ObjectID => {
        return new ObjectID(id);
      },
    );

    const readable: Array<Incident | Alert> =
      ids.length === 0
        ? []
        : options.subjectKind === "incident"
          ? await IncidentService.findBy({
              query: {
                projectId: options.projectId,
                _id: QueryHelper.any(ids),
              },
              select: { _id: true },
              limit: ids.length,
              skip: 0,
              props: options.props,
            })
          : await AlertService.findBy({
              query: {
                projectId: options.projectId,
                _id: QueryHelper.any(ids),
              },
              select: { _id: true },
              limit: ids.length,
              skip: 0,
              props: options.props,
            });

    const reasons: Map<string, InvestigationNotStartedCode> = new Map<
      string,
      InvestigationNotStartedCode
    >();

    for (const row of readable) {
      const id: string | undefined = row.id?.toString();

      if (id && codes.has(id)) {
        reasons.set(id, codes.get(id)!);
      }
    }

    return {
      reasons,
      isPartial:
        decided.length >= INCIDENT_ALERT_AI_INSIGHTS_DECISION_SCAN_LIMIT,
    };
  }
}
