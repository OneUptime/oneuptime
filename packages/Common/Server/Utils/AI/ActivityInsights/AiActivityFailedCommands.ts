import RunnerJobService from "../../../Services/RunnerJobService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import Select from "../../../Types/Database/Select";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import {
  clipText,
  getJobCommand,
} from "../IncidentAlertActivity/IncidentAlertAiLogsReader";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import {
  AI_ACTIVITY_INSIGHTS_MAX_FAILED_COMMANDS,
  AiActivityFailedCommand,
  AiActivitySubject,
} from "../../../../Types/AI/AiActivityInsights";
import { INCIDENT_ALERT_AI_LOGS_TEXT_MAX_LENGTH } from "../../../../Types/AI/IncidentAlertAiLogs";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import RunnerJobStatus from "../../../../Types/Runbook/RunnerJobStatus";

/*
 * WHICH OF AI'S COMMANDS FAILED, AND WHY (#9749).
 *
 * An AI Insights page counts the commands OneUptime AI ran on its scope in
 * the window, as root, and said how many failed - a count nobody could
 * open. Its "N failed" now opens them: each command, how it ended (its exit
 * code, the agent's own words), when, why AI ran it, and the incident or
 * alert it was for.
 *
 * The count and the list are one read, of the failed commands the page
 * counted that the reader may read as Runner jobs - RunnerJobService's read
 * access and privacy filters: not a command of another person's AI chat,
 * nor one about a private incident or alert they do not see - so "N
 * failed" says exactly what it opens. A reader who may not read Runner jobs
 * at all reads none. What a command ran (its payload or script) is read
 * for those who may read it: a Viewer reads that it failed, and why, as a
 * resource's AI Logs page shows them its commands.
 */

export interface AiActivityFailedCommandsRead {
  // How many of the page's failed commands the reader may read.
  count: number;
  // The newest of them: at most AI_ACTIVITY_INSIGHTS_MAX_FAILED_COMMANDS.
  commands: Array<AiActivityFailedCommand>;
}

// How a failed command ended, why AI ran it, and what for: every reader's.
export const FAILED_COMMAND_SELECT: Select<RunnerJob> = {
  _id: true,
  createdAt: true,
  completedAt: true,
  status: true,
  origin: true,
  aiRunId: true,
  autoRemediationSuggestionId: true,
  exitCode: true,
  errorMessage: true,
};

// What it ran: read by fewer people than the job (not a Viewer).
export const FAILED_COMMAND_TEXT_SELECT: Select<RunnerJob> = {
  payload: true,
  script: true,
};

export default class AiActivityFailedCommands {
  // The ids of the jobs that failed, of the ones a page counted.
  public static getFailedJobIds(
    jobs: Array<Pick<RunnerJob, "id" | "status">>,
  ): Array<ObjectID> {
    const ids: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const job of jobs) {
      if (job.id && job.status === RunnerJobStatus.Failed) {
        ids.set(job.id.toString(), job.id);
      }
    }

    return Array.from(ids.values());
  }

  /*
   * The failed commands of `jobIds` - the ones a page counted, read as
   * root - that the reader may read: how many, and the newest of them,
   * each with the incident or alert `getSubject` names for it (one the
   * reader may read).
   */
  @CaptureSpan()
  public static async read(data: {
    projectId: ObjectID;
    jobIds: Array<ObjectID>;
    // The reader's own, tenant-pinned props.
    props: DatabaseCommonInteractionProps;
    getSubject?:
      | ((job: RunnerJob) => AiActivitySubject | undefined)
      | undefined;
  }): Promise<AiActivityFailedCommandsRead> {
    if (data.jobIds.length === 0) {
      return { count: 0, commands: [] };
    }

    const query: Record<string, unknown> = {
      projectId: data.projectId,
      _id: QueryHelper.any(data.jobIds),
      // Failed when counted; a job never fails twice, nor stops having failed.
      status: RunnerJobStatus.Failed,
    };

    try {
      const [count, jobs]: [number, Array<RunnerJob>] = await Promise.all([
        RunnerJobService.countBy({
          query: query as never,
          props: data.props,
        }).then((value: { toNumber: () => number }): number => {
          return value.toNumber();
        }),
        AiActivityFailedCommands.readNewest({ query, props: data.props }),
      ]);

      return {
        count,
        commands: jobs
          .filter((job: RunnerJob): boolean => {
            return Boolean(job.id);
          })
          .map((job: RunnerJob): AiActivityFailedCommand => {
            return AiActivityFailedCommands.toFailedCommand({
              job,
              subject: data.getSubject?.(job),
            });
          }),
      };
    } catch (error) {
      // A role that may not read Runner jobs at all: none of them is theirs.
      if (error instanceof NotAuthorizedException) {
        return { count: 0, commands: [] };
      }

      throw error;
    }
  }

  // One row. Pure.
  public static toFailedCommand(data: {
    job: RunnerJob;
    subject?: AiActivitySubject | undefined;
  }): AiActivityFailedCommand {
    const job: RunnerJob = data.job;
    const at: Date = new Date(job.completedAt || job.createdAt || Date.now());
    const command: string | undefined = getJobCommand(job);
    const errorMessage: string | undefined = clipText(
      job.errorMessage,
      INCIDENT_ALERT_AI_LOGS_TEXT_MAX_LENGTH,
    );

    return {
      id: job.id!.toString(),
      at: Number.isNaN(at.getTime())
        ? new Date().toISOString()
        : at.toISOString(),
      ...(command ? { command } : {}),
      ...(typeof job.exitCode === "number" ? { exitCode: job.exitCode } : {}),
      ...(errorMessage ? { errorMessage } : {}),
      ...(job.origin ? { origin: job.origin } : {}),
      ...(data.subject ? { subject: data.subject } : {}),
    };
  }

  /*
   * The newest failed commands the reader may read, with what they ran
   * when the reader may read that too - else without it.
   */
  private static async readNewest(data: {
    query: Record<string, unknown>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<RunnerJob>> {
    const read: (select: Select<RunnerJob>) => Promise<Array<RunnerJob>> = (
      select: Select<RunnerJob>,
    ): Promise<Array<RunnerJob>> => {
      return RunnerJobService.findBy({
        query: data.query as never,
        select,
        sort: { createdAt: SortOrder.Descending },
        limit: AI_ACTIVITY_INSIGHTS_MAX_FAILED_COMMANDS,
        skip: 0,
        props: data.props,
      });
    };

    try {
      return await read({
        ...FAILED_COMMAND_SELECT,
        ...FAILED_COMMAND_TEXT_SELECT,
      });
    } catch (error) {
      if (!(error instanceof NotAuthorizedException)) {
        throw error;
      }

      // Not what it ran: the reader may read the job, not its command.
      return await read(FAILED_COMMAND_SELECT);
    }
  }
}
