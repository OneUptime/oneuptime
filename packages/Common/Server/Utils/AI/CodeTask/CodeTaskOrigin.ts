import AIInsightService from "../../../Services/AIInsightService";
import AlertService from "../../../Services/AlertService";
import IncidentService from "../../../Services/IncidentService";
import TelemetryExceptionService from "../../../Services/TelemetryExceptionService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import { sanitizeExceptionMessage } from "../../Telemetry/ExceptionSanitizer";
import AIInsight from "../../../../Models/DatabaseModels/AIInsight";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import CodeFixTaskContext, {
  getGitHubTaskContext,
  GitHubTaskContext,
} from "../../../../Types/AI/CodeFixTaskContext";
import CodeFixTaskType, {
  CodeFixTaskTypeHelper,
} from "../../../../Types/AI/CodeFixTaskType";
import {
  CodeTaskOriginJSON,
  CodeTaskOriginType,
} from "../../../../Types/AI/CodeTask";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";

/*
 * WHAT STARTED A TASK NOBODY ASKED FOR IN CODE.
 *
 * Code fixes start from an exception, an incident or alert investigation, a
 * slow trace, a service's logs or traces, or a GitHub comment. Their task's
 * first turn shows that origin instead of a request, by the name a person
 * knows it by: the exception's message, the incident's number and title,
 * the GitHub issue's number. The names are read for a whole page of tasks
 * at once (loadSubjects), under the reader's own permissions: a person who
 * may read a repository's tasks but not the incident one was started from
 * reads "started from an incident", not its title.
 *
 * A request OneUptime wrote itself - from slow code it found in a service's
 * profiles (Types/AI/TelemetryAi) - is a Code request nobody asked for: its
 * origin is the insight that holds the problem, named by the insight's
 * title, and its first turn shows both that origin and the request.
 */

const LABEL_LENGTH: number = 120;

export interface CodeTaskOriginSubjects {
  exceptions: Map<string, TelemetryException>;
  incidents: Map<string, Incident>;
  alerts: Map<string, Alert>;
  // Read only for the requests OneUptime started itself.
  insights?: Map<string, AIInsight> | undefined;
}

export default class CodeTaskOrigin {
  // The names of every subject the runs name, in three reads.
  public static async loadSubjects(data: {
    projectId: ObjectID;
    runs: Array<AIRun>;
    // The reader's: a name they may not read is left out.
    props: DatabaseCommonInteractionProps;
  }): Promise<CodeTaskOriginSubjects> {
    const exceptionIds: Set<string> = new Set<string>();
    const incidentIds: Set<string> = new Set<string>();
    const alertIds: Set<string> = new Set<string>();
    const insightIds: Set<string> = new Set<string>();

    for (const run of data.runs) {
      if (CodeTaskOrigin.isStartedByOneUptime(run)) {
        insightIds.add(run.triggeredByAiInsightId!.toString());
      }

      if (run.triggeredByTelemetryExceptionId) {
        exceptionIds.add(run.triggeredByTelemetryExceptionId.toString());
      }

      if (run.triggeredByIncidentId) {
        incidentIds.add(run.triggeredByIncidentId.toString());
      }

      if (run.triggeredByAlertId) {
        alertIds.add(run.triggeredByAlertId.toString());
      }
    }

    const [exceptions, incidents, alerts, insights]: [
      Array<TelemetryException>,
      Array<Incident>,
      Array<Alert>,
      Array<AIInsight>,
    ] = await Promise.all([
      exceptionIds.size > 0
        ? CodeTaskOrigin.readable(
            TelemetryExceptionService.findBy({
              query: {
                _id: QueryHelper.any(Array.from(exceptionIds)),
                projectId: data.projectId,
              },
              select: { _id: true, message: true, exceptionType: true },
              limit: exceptionIds.size,
              skip: 0,
              props: data.props,
            }),
          )
        : Promise.resolve([]),
      incidentIds.size > 0
        ? CodeTaskOrigin.readable(
            IncidentService.findBy({
              query: {
                _id: QueryHelper.any(Array.from(incidentIds)),
                projectId: data.projectId,
              },
              select: {
                _id: true,
                title: true,
                incidentNumber: true,
                incidentNumberWithPrefix: true,
              },
              limit: incidentIds.size,
              skip: 0,
              props: data.props,
            }),
          )
        : Promise.resolve([]),
      alertIds.size > 0
        ? CodeTaskOrigin.readable(
            AlertService.findBy({
              query: {
                _id: QueryHelper.any(Array.from(alertIds)),
                projectId: data.projectId,
              },
              select: {
                _id: true,
                title: true,
                alertNumber: true,
                alertNumberWithPrefix: true,
              },
              limit: alertIds.size,
              skip: 0,
              props: data.props,
            }),
          )
        : Promise.resolve([]),
      insightIds.size > 0
        ? CodeTaskOrigin.readable(
            AIInsightService.findBy({
              query: {
                _id: QueryHelper.any(Array.from(insightIds)),
                projectId: data.projectId,
              },
              select: { _id: true, title: true, insightType: true },
              limit: insightIds.size,
              skip: 0,
              props: data.props,
            }),
          )
        : Promise.resolve([]),
    ]);

    return {
      exceptions: CodeTaskOrigin.byId(exceptions),
      incidents: CodeTaskOrigin.byId(incidents),
      alerts: CodeTaskOrigin.byId(alerts),
      insights: CodeTaskOrigin.byId(insights),
    };
  }

  /*
   * A Code request OneUptime wrote itself, from a problem it found: no
   * person asked it, and it names the insight it came from.
   */
  public static isStartedByOneUptime(run: {
    codeFixTaskType?: CodeFixTaskType | string | null | undefined;
    userId?: ObjectID | null | undefined;
    triggeredByAiInsightId?: ObjectID | null | undefined;
  }): boolean {
    return (
      CodeFixTaskTypeHelper.isCodeRequest(run.codeFixTaskType) &&
      !run.userId &&
      Boolean(run.triggeredByAiInsightId)
    );
  }

  /*
   * What started the run. `taskContext` is the run's own, when it was read:
   * GitHub, trace and service recipes name their subject there.
   */
  public static describe(data: {
    run: AIRun;
    subjects: CodeTaskOriginSubjects;
    taskContext?: CodeFixTaskContext | null | undefined;
    requesterName?: string | undefined;
  }): CodeTaskOriginJSON {
    const run: AIRun = data.run;
    const taskType: CodeFixTaskType = CodeFixTaskTypeHelper.fromDatabaseValue(
      run.codeFixTaskType,
    );

    if (CodeTaskOrigin.isStartedByOneUptime(run)) {
      const insight: AIInsight | undefined = data.subjects.insights?.get(
        run.triggeredByAiInsightId!.toString(),
      );

      return {
        type: CodeTaskOriginType.Insight,
        label: insight ? CodeTaskOrigin.shorten(insight.title || "") : "",
        recordId: run.triggeredByAiInsightId!.toString(),
      };
    }

    if (CodeFixTaskTypeHelper.isCodeRequest(taskType)) {
      return {
        type: CodeTaskOriginType.Request,
        label: data.requesterName || "",
      };
    }

    const github: GitHubTaskContext | null = getGitHubTaskContext(
      data.taskContext,
    );

    if (github) {
      const isPullRequest: boolean = github.pullRequestNumber !== undefined;
      const number: number = (github.pullRequestNumber ??
        github.issueNumber) as number;

      return {
        type: isPullRequest
          ? CodeTaskOriginType.GitHubPullRequest
          : CodeTaskOriginType.GitHubIssue,
        label: `#${number}`,
        url: `https://github.com/${encodeURIComponent(github.organizationName)}/${encodeURIComponent(github.repositoryName)}/${isPullRequest ? "pull" : "issues"}/${number}`,
      };
    }

    if (run.triggeredByTelemetryExceptionId) {
      const exception: TelemetryException | undefined =
        data.subjects.exceptions.get(
          run.triggeredByTelemetryExceptionId.toString(),
        );

      return {
        type: CodeTaskOriginType.Exception,
        label: exception
          ? CodeTaskOrigin.shorten(CodeTaskOrigin.describeException(exception))
          : "",
        recordId: run.triggeredByTelemetryExceptionId.toString(),
      };
    }

    if (run.triggeredByIncidentId) {
      const incident: Incident | undefined = data.subjects.incidents.get(
        run.triggeredByIncidentId.toString(),
      );

      return {
        type: CodeTaskOriginType.Incident,
        label: incident
          ? CodeTaskOrigin.shorten(
              CodeTaskOrigin.numbered(
                incident.incidentNumberWithPrefix,
                incident.incidentNumber,
                incident.title,
              ),
            )
          : "",
        recordId: run.triggeredByIncidentId.toString(),
      };
    }

    if (run.triggeredByAlertId) {
      const alert: Alert | undefined = data.subjects.alerts.get(
        run.triggeredByAlertId.toString(),
      );

      return {
        type: CodeTaskOriginType.Alert,
        label: alert
          ? CodeTaskOrigin.shorten(
              CodeTaskOrigin.numbered(
                alert.alertNumberWithPrefix,
                alert.alertNumber,
                alert.title,
              ),
            )
          : "",
        recordId: run.triggeredByAlertId.toString(),
      };
    }

    if (data.taskContext?.traceId) {
      return {
        type: CodeTaskOriginType.Trace,
        label: CodeTaskOrigin.shorten(
          data.taskContext.serviceName || data.taskContext.traceId,
        ),
        recordId: data.taskContext.traceId,
      };
    }

    if (data.taskContext?.telemetryServiceId) {
      return {
        type: CodeTaskOriginType.Service,
        label: CodeTaskOrigin.shorten(data.taskContext.serviceName || ""),
        recordId: data.taskContext.telemetryServiceId,
      };
    }

    if (run.triggeredByAiInsightId) {
      return {
        type: CodeTaskOriginType.Insight,
        label: "",
        recordId: run.triggeredByAiInsightId.toString(),
      };
    }

    return { type: CodeTaskOriginType.Unknown, label: "" };
  }

  /*
   * Whether the run's origin is named in its task context, so a list must
   * read that context to describe it.
   */
  public static needsTaskContext(run: AIRun): boolean {
    if (
      run.triggeredByTelemetryExceptionId ||
      run.triggeredByIncidentId ||
      run.triggeredByAlertId
    ) {
      return false;
    }

    return !CodeFixTaskTypeHelper.isCodeRequest(run.codeFixTaskType);
  }

  public static describeException(exception: TelemetryException): string {
    const message: string = sanitizeExceptionMessage(exception.message || "");
    const exceptionType: string = exception.exceptionType || "";

    if (exceptionType && message) {
      return `${exceptionType}: ${message}`;
    }

    return exceptionType || message;
  }

  private static numbered(
    withPrefix: string | undefined,
    plain: number | undefined,
    title: string | undefined,
  ): string {
    const handle: string =
      withPrefix || (plain !== undefined && plain !== null ? `#${plain}` : "");

    if (!handle) {
      return title || "";
    }

    return title ? `${handle}: ${title}` : handle;
  }

  private static shorten(text: string): string {
    const oneLine: string = text.split(/\s+/).join(" ").trim();

    return oneLine.length > LABEL_LENGTH
      ? `${oneLine.substring(0, LABEL_LENGTH - 1).trimEnd()}…`
      : oneLine;
  }

  /*
   * What the reader may read of a list: a table they may not read at all
   * (no read permission, a plan below it) names nothing, rather than
   * failing the page.
   */
  private static async readable<T>(read: Promise<Array<T>>): Promise<Array<T>> {
    try {
      return await read;
    } catch {
      return [];
    }
  }

  private static byId<T extends { id?: ObjectID | null }>(
    items: Array<T>,
  ): Map<string, T> {
    const map: Map<string, T> = new Map<string, T>();

    for (const item of items) {
      if (item.id) {
        map.set(item.id.toString(), item);
      }
    }

    return map;
  }
}
