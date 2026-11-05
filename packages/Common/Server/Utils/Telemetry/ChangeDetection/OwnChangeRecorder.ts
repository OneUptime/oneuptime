import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import { OpenStackCloudFeedEventType } from "../../../../Models/DatabaseModels/OpenStackCloudFeed";
import OpenStackCloud from "../../../../Models/DatabaseModels/OpenStackCloud";
import RunbookExecution from "../../../../Models/DatabaseModels/RunbookExecution";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import { ROLLBACK_COMMAND_STEP_ID_PREFIX } from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import { Red500 } from "../../../../Types/BrandColors";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import RunbookExecutionStatus from "../../../../Types/Runbook/RunbookExecutionStatus";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import RunnerJobOrigin from "../../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../../Types/Runbook/RunnerJobStatus";
import { readOpenStackChangeReach } from "../../../../Utils/AiRemediation/Resource/OpenStackChangeReach";
import {
  OpenStackChange,
  OpenStackCommandParseResult,
  parseOpenStackCommand,
} from "../../../../Utils/AiRemediation/Resource/OpenStackCommandPolicy";
import { tokenizeResourceCommand } from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicyCore";
import { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import GlobalCache from "../../../Infrastructure/GlobalCache";
import AIRunService from "../../../Services/AIRunService";
import AutoRemediationSuggestionService from "../../../Services/AutoRemediationSuggestionService";
import ChangeEventService from "../../../Services/ChangeEventService";
import OpenStackCloudFeedService from "../../../Services/OpenStackCloudFeedService";
import OpenStackCloudService from "../../../Services/OpenStackCloudService";
import RunbookExecutionService from "../../../Services/RunbookExecutionService";
import RunnerJobService from "../../../Services/RunnerJobService";
import logger from "../../Logger";
import {
  OpenStackFix,
  OpenStackFixApproval,
  OpenStackFixOutcome,
  buildOpenStackFixChangeEntries,
  describeOpenStackFixForFeed,
  getOpenStackFixTime,
} from "../../OpenStack/OpenStackFixChangeEntries";
import {
  DEFAULT_CHANGE_EVENT_RETENTION_IN_DAYS,
  ParsedChangeEventEntry,
  buildChangeEventDbRow,
} from "../ChangeEventRow";
import TelemetryFanInWriter from "../TelemetryFanInWriter";
import {
  RunbookChangeOutcome,
  buildAiCommandChangeEntry,
  buildRunbookChangeEntry,
} from "./OwnChangeEntries";

/*
 * Records what OneUptime itself changed as change events (OwnChangeEntries
 * says why): every write command OneUptime AI ran on a cluster or a host -
 * a restart, a scale, a rollback - when its agent reports the result, and
 * every runbook OneUptime ran, when it finishes.
 *
 * Best effort: the callers start it and move on (recordAiCommandResult,
 * recordRunbookExecutions), and every failure is logged, never thrown.
 */

// How long a runbook execution is remembered as recorded.
export const RECORDED_RUNBOOK_TTL_IN_DAYS: number = 7;
export const OWN_CHANGE_RECORDED_NAMESPACE: string = "own-change-recorded";

const TERMINAL_RUNBOOK_STATUSES: Array<RunbookExecutionStatus> = [
  RunbookExecutionStatus.Completed,
  RunbookExecutionStatus.Failed,
  RunbookExecutionStatus.Cancelled,
];

export default class OwnChangeRecorder {
  /*
   * After an agent's result for a job was stored (RunnerJobService
   * .submitResult). Starts the check and returns at once.
   */
  public static recordAiCommandResult(jobId: ObjectID): void {
    OwnChangeRecorder.recordAiCommand(jobId).catch((error: unknown) => {
      logger.warn(
        `Could not record the change of AI command job ${jobId.toString()}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  /*
   * After an update that may have finished runbook executions
   * (RunbookExecutionService.onUpdateSuccess). Starts the check and
   * returns at once.
   */
  public static recordRunbookExecutions(executionIds: Array<ObjectID>): void {
    for (const executionId of executionIds) {
      OwnChangeRecorder.recordRunbookExecution(executionId).catch(
        (error: unknown) => {
          logger.warn(
            `Could not record the change of runbook execution ${executionId.toString()}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        },
      );
    }
  }

  // The job's change, when it was a write OneUptime AI ran. Awaitable for tests.
  public static async recordAiCommand(jobId: ObjectID): Promise<void> {
    const job: RunnerJob | null = await RunnerJobService.findOneById({
      id: jobId,
      select: {
        _id: true,
        projectId: true,
        origin: true,
        stepType: true,
        status: true,
        payload: true,
        script: true,
        aiRunId: true,
        kubernetesClusterId: true,
        resourceType: true,
        resourceId: true,
        autoRemediationSuggestionId: true,
        stepId: true,
        output: true,
        exitCode: true,
        errorMessage: true,
        claimedAt: true,
        startedAt: true,
        completedAt: true,
      },
      props: { isRoot: true },
    });

    if (!job?.projectId || job.origin !== RunnerJobOrigin.AiRemediation) {
      return;
    }

    if (
      job.status !== RunnerJobStatus.Succeeded &&
      job.status !== RunnerJobStatus.Failed
    ) {
      return;
    }

    const payload: JSONObject = (job.payload as JSONObject) || {};

    // A read changes nothing; only kubectl and resource jobs carry a tier.
    if (payload["tier"] === "Read") {
      return;
    }

    const command: string =
      (typeof payload["displayCommand"] === "string"
        ? (payload["displayCommand"] as string)
        : "") ||
      (typeof payload["command"] === "string"
        ? (payload["command"] as string)
        : "") ||
      job.script ||
      "";

    let incidentId: ObjectID | undefined = undefined;
    let alertId: ObjectID | undefined = undefined;

    if (job.aiRunId) {
      const run: AIRun | null = await AIRunService.findOneById({
        id: job.aiRunId,
        select: { triggeredByIncidentId: true, triggeredByAlertId: true },
        props: { isRoot: true },
      });

      incidentId = run?.triggeredByIncidentId || undefined;
      alertId = run?.triggeredByAlertId || undefined;
    }

    /*
     * A change to an OpenStack cloud is one of each part it touched, and says who
     * approved it: what a person looking at that part wants to know.
     */
    if (
      job.resourceType === AiResourceType.OpenStackCloud &&
      job.resourceId &&
      (await OwnChangeRecorder.recordOpenStackFix({
        jobId,
        job,
        command,
        incidentId,
        alertId,
      }))
    ) {
      return;
    }

    const entry: ParsedChangeEventEntry = buildAiCommandChangeEntry({
      jobId,
      command,
      succeeded: job.status === RunnerJobStatus.Succeeded,
      time:
        job.startedAt ||
        job.claimedAt ||
        job.completedAt ||
        OneUptimeDate.getCurrentDate(),
      kubectlArgs:
        job.stepType === RunbookStepType.Kubectl &&
        Array.isArray(payload["args"])
          ? (payload["args"] as Array<unknown>)
          : undefined,
      kubernetesClusterId: job.kubernetesClusterId || undefined,
      resourceType: job.resourceType || undefined,
      resourceId: job.resourceId || undefined,
      aiRunId: job.aiRunId || undefined,
      incidentId,
      alertId,
    });

    await OwnChangeRecorder.write({
      entry,
      projectId: job.projectId,
      dedupKey: `job:${jobId.toString()}`,
    });
  }

  /*
   * The change events of a fix on an OpenStack cloud, and its line on the cloud's
   * feed. False when the job's words are none of the changes the policy allows,
   * which the plain entry then records as what it says it was.
   */
  private static async recordOpenStackFix(data: {
    jobId: ObjectID;
    job: RunnerJob;
    command: string;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
  }): Promise<boolean> {
    const { job, jobId } = data;
    const projectId: ObjectID = job.projectId!;
    const cloudId: ObjectID = job.resourceId!;
    const argv: Array<string> | undefined = tokenizeResourceCommand(
      data.command,
    ).argv;
    const parsed: OpenStackCommandParseResult | null = argv
      ? parseOpenStackCommand(argv)
      : null;
    const change: OpenStackChange | undefined = parsed?.request?.change;

    if (!change) {
      return false;
    }

    const cloud: OpenStackCloud | null = await OpenStackCloudService.findOneById(
      {
        id: cloudId,
        select: { name: true },
        props: { isRoot: true },
      },
    );

    const fix: OpenStackFix = {
      jobId,
      cloudId,
      cloudName: cloud?.name || "",
      command: data.command,
      change,
      reach: readOpenStackChangeReach(job.output),
      outcome:
        job.status === RunnerJobStatus.Succeeded
          ? OpenStackFixOutcome.Accepted
          : (job.exitCode === undefined || job.exitCode === null) &&
              !(job.output || "").trim()
            ? OpenStackFixOutcome.DidNotRun
            : OpenStackFixOutcome.Failed,
      failure: job.errorMessage || null,
      time: getOpenStackFixTime(job),
      approval: await OwnChangeRecorder.getOpenStackFixApproval(job),
      isRollback: (job.stepId || "").startsWith(ROLLBACK_COMMAND_STEP_ID_PREFIX),
      regionName: parsed?.request?.regionName || null,
      suggestionId: job.autoRemediationSuggestionId || undefined,
      aiRunId: job.aiRunId || undefined,
      incidentId: data.incidentId,
      alertId: data.alertId,
    };

    const rows: Array<JSONObject> = buildOpenStackFixChangeEntries(fix).map(
      (entry: ParsedChangeEventEntry): JSONObject => {
        return buildChangeEventDbRow({
          parsed: entry,
          projectId,
          serviceMetadata: null,
          retentionDays: DEFAULT_CHANGE_EVENT_RETENTION_IN_DAYS,
        });
      },
    );

    const submission: { flushed: Promise<void> } =
      await TelemetryFanInWriter.submit(ChangeEventService, rows, {
        dedupToken: `own-change:job:${jobId.toString()}`,
      });

    await submission.flushed;

    /*
     * The feed has no insert token: a job whose result arrives twice is said once.
     */
    const isFirst: boolean = await GlobalCache.setStringIfNotExists(
      OWN_CHANGE_RECORDED_NAMESPACE,
      `openstack-fix-feed:${jobId.toString()}`,
      "1",
      {
        expiresInSeconds: OneUptimeDate.getSecondsInDays(
          RECORDED_RUNBOOK_TTL_IN_DAYS,
        ),
      },
    );

    if (isFirst) {
      await OpenStackCloudFeedService.createOpenStackCloudFeedItem({
        openStackCloudId: cloudId,
        projectId,
        openStackCloudFeedEventType: OpenStackCloudFeedEventType.AiFix,
        feedInfoInMarkdown: mdText`${describeOpenStackFixForFeed(
          fix,
        )} \`${data.command}\``.toString(),
        displayColor:
          fix.outcome === OpenStackFixOutcome.Accepted ? undefined : Red500,
        postedAt: fix.time,
      });
    }

    return true;
  }

  /*
   * Who said yes to this job, or null when nobody was asked: a change a run made
   * while it planned has no approval, and an approved plan's commands and the
   * rollback that goes with them carry the one its person gave.
   */
  private static async getOpenStackFixApproval(
    job: RunnerJob,
  ): Promise<OpenStackFixApproval | null> {
    if (!job.autoRemediationSuggestionId) {
      return null;
    }

    const suggestion: AutoRemediationSuggestion | null =
      await AutoRemediationSuggestionService.findOneById({
        id: job.autoRemediationSuggestionId,
        select: {
          approvedByUserId: true,
          approvedFrom: true,
          approvedByUser: { name: true, email: true },
        },
        props: { isRoot: true },
      });

    if (!suggestion?.approvedByUserId) {
      return null;
    }

    return {
      userId: suggestion.approvedByUserId,
      name:
        suggestion.approvedByUser?.name?.toString() ||
        suggestion.approvedByUser?.email?.toString() ||
        null,
      from: suggestion.approvedFrom || null,
    };
  }

  // The execution's change, once it finished. Awaitable for tests.
  public static async recordRunbookExecution(
    executionId: ObjectID,
  ): Promise<void> {
    const execution: RunbookExecution | null =
      await RunbookExecutionService.findOneById({
        id: executionId,
        select: {
          _id: true,
          projectId: true,
          runbookId: true,
          runbookNameSnapshot: true,
          status: true,
          startedAt: true,
          completedAt: true,
          failureReason: true,
          incidentId: true,
          alertId: true,
        },
        props: { isRoot: true },
      });

    if (
      !execution?.projectId ||
      !execution.status ||
      !TERMINAL_RUNBOOK_STATUSES.includes(execution.status)
    ) {
      return;
    }

    // A runbook cancelled before it started changed nothing.
    if (
      execution.status === RunbookExecutionStatus.Cancelled &&
      !execution.startedAt
    ) {
      return;
    }

    /*
     * An execution is updated more than once after it finishes (its steps,
     * a late sweep), and each update runs the hook: record it once.
     */
    const isFirst: boolean = await GlobalCache.setStringIfNotExists(
      OWN_CHANGE_RECORDED_NAMESPACE,
      `runbook-execution:${executionId.toString()}`,
      "1",
      {
        expiresInSeconds: OneUptimeDate.getSecondsInDays(
          RECORDED_RUNBOOK_TTL_IN_DAYS,
        ),
      },
    );

    if (!isFirst) {
      return;
    }

    const entry: ParsedChangeEventEntry = buildRunbookChangeEntry({
      executionId,
      runbookId: execution.runbookId || undefined,
      runbookName: execution.runbookNameSnapshot || "",
      outcome:
        execution.status === RunbookExecutionStatus.Completed
          ? RunbookChangeOutcome.Completed
          : execution.status === RunbookExecutionStatus.Failed
            ? RunbookChangeOutcome.Failed
            : RunbookChangeOutcome.Cancelled,
      time:
        execution.startedAt ||
        execution.completedAt ||
        OneUptimeDate.getCurrentDate(),
      failureReason: execution.failureReason || undefined,
      incidentId: execution.incidentId || undefined,
      alertId: execution.alertId || undefined,
    });

    await OwnChangeRecorder.write({
      entry,
      projectId: execution.projectId,
      dedupKey: `runbook-execution:${executionId.toString()}`,
    });
  }

  // Whether an update's data may have finished a runbook execution.
  public static isTerminalRunbookStatus(status: unknown): boolean {
    return TERMINAL_RUNBOOK_STATUSES.includes(status as RunbookExecutionStatus);
  }

  private static async write(data: {
    entry: ParsedChangeEventEntry;
    projectId: ObjectID;
    dedupKey: string;
  }): Promise<void> {
    /*
     * Project-wide: a command names a cluster or a host, not a service.
     * Investigations match it to an incident by its attributes.
     */
    const row: JSONObject = buildChangeEventDbRow({
      parsed: data.entry,
      projectId: data.projectId,
      serviceMetadata: null,
      retentionDays: DEFAULT_CHANGE_EVENT_RETENTION_IN_DAYS,
    });

    const submission: { flushed: Promise<void> } =
      await TelemetryFanInWriter.submit(ChangeEventService, [row], {
        dedupToken: `own-change:${data.dedupKey}`,
      });

    await submission.flushed;
  }
}
