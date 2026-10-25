import AIInsightService from "../../../Services/AIInsightService";
import AIRunService from "../../../Services/AIRunService";
import { DashboardClientUrl } from "../../../EnvironmentConfig";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import ToolResultSerializer from "../Toolbox/Serializer";
import AIInsight from "../../../../Models/DatabaseModels/AIInsight";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunType from "../../../../Types/AI/AIRunType";
import { getAiInsightDashboardPath } from "../../../../Types/AI/TelemetryAi";
import ObjectID from "../../../../Types/ObjectID";

/*
 * WHY AN EXCEPTION'S AI TASK WAS STARTED, FOR ITS PULL REQUEST TO SAY -
 * "Whenever a PR is created it should connect to why it was created" (the
 * maintainer). An exception's own AI task (a fix, a regression test, better
 * handling) started from a finding - a new or rising exception the
 * Exceptions product's AI section found, OneUptime on its own or a person
 * from the finding - says so in its pull request, with the finding's title
 * and a link to where the Dashboard shows it, and with a link to the
 * exception itself. The Runner asks for it with the exception's details
 * (POST /ai-agent-data/get-exception-details, taskId), for the task it
 * claimed: a task id that is not this exception's task says nothing.
 */

// The finding, as its insight's title says it: at most this long.
export const MAX_EXCEPTION_FIX_FINDING_LENGTH: number = 300;

export interface ExceptionFixStartedByJSON {
  // The finding, as its insight's title says it (redacted, cut).
  finding: string;
  // The insight's page in OneUptime.
  findingUrl: string;
  // No person asked: OneUptime started it on its own.
  isStartedByOneUptime: boolean;
}

export default class ExceptionFixStartedBy {
  // The exception's page in OneUptime.
  public static getExceptionUrl(data: {
    projectId: ObjectID;
    exceptionId: ObjectID;
  }): string {
    return `${DashboardClientUrl.toString()}/${data.projectId.toString()}/exceptions/${data.exceptionId.toString()}`;
  }

  /*
   * Why the task was started, when a finding started it: null for one a
   * person started on the exception's page, and for a task that is not a
   * code fix of this exception in this project.
   */
  @CaptureSpan()
  public static async read(data: {
    taskId: ObjectID;
    exceptionId: ObjectID;
    projectId: ObjectID;
  }): Promise<ExceptionFixStartedByJSON | null> {
    const run: AIRun | null = await AIRunService.findOneBy({
      query: {
        _id: data.taskId.toString(),
        projectId: data.projectId,
        runType: AIRunType.CodeFix,
        triggeredByTelemetryExceptionId: data.exceptionId,
      },
      select: {
        _id: true,
        userId: true,
        triggeredByAiInsightId: true,
      },
      props: { isRoot: true },
    });

    if (!run || !run.triggeredByAiInsightId) {
      return null;
    }

    const insight: AIInsight | null = await AIInsightService.findOneBy({
      query: {
        _id: run.triggeredByAiInsightId.toString(),
        projectId: data.projectId,
      },
      select: { _id: true, title: true, insightType: true },
      props: { isRoot: true },
    });

    if (!insight) {
      return null;
    }

    const title: string = ToolResultSerializer.redactAndOmitEmbeddedData(
      insight.title || "",
    ).text;

    return {
      finding:
        title.length > MAX_EXCEPTION_FIX_FINDING_LENGTH
          ? `${title.substring(0, MAX_EXCEPTION_FIX_FINDING_LENGTH - 1)}…`
          : title,
      findingUrl: `${DashboardClientUrl.toString()}${getAiInsightDashboardPath({
        projectId: data.projectId.toString(),
        insightId: run.triggeredByAiInsightId.toString(),
        insightType: insight.insightType,
      })}`,
      isStartedByOneUptime: !run.userId,
    };
  }
}
