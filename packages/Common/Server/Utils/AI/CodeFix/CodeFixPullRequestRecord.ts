import AIAgentTaskPullRequestService from "../../../Services/AIAgentTaskPullRequestService";
import AIRunEventService from "../../../Services/AIRunEventService";
import AIRunService from "../../../Services/AIRunService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import Semaphore, { SemaphoreMutex } from "../../../Infrastructure/Semaphore";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import { CodeFixAgentIdentity, CodeFixAgentSource } from "./CodeFixAgentAuth";
import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import URL from "../../../../Types/API/URL";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import FixVerificationStatus from "../../../../Types/AI/FixVerificationStatus";
import PullRequestState from "../../../../Types/CodeRepository/PullRequestState";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * A worker reports one pull request per repository it fixed, so a run opens
 * a handful at most. Only this many reported with a status are read, so a
 * worker that sends more cannot make that report do work without limit.
 */
const MAX_REPORTED_PULL_REQUESTS: number = 10;

const RUN_LOCK_NAMESPACE: string = "CodeFixPullRequestRecord.record";

// A pull request a code-fix worker opened, as it reports it.
export interface OpenedPullRequestFields {
  codeRepositoryId: ObjectID;
  pullRequestUrl: string;
  pullRequestNumber?: number | undefined;
  pullRequestId?: number | undefined;
  title: string;
  description?: string | undefined;
  headRefName?: string | undefined;
  baseRefName?: string | undefined;
  // Outcome of the worker's build/test verification before it opened the PR.
  runnerVerificationStatus?: FixVerificationStatus | undefined;
  runnerVerificationSummary?: string | undefined;
}

export interface RecordedPullRequest {
  pullRequest: AIAgentTaskPullRequest;
  // False when the run had already recorded this pull request.
  created: boolean;
}

/*
 * How a pull request a code-fix run opened becomes an AIAgentTaskPullRequest
 * row: the row the open-PR cap counts (OpenPullRequestCap), the
 * AIAgent:SyncPullRequestStates worker keeps current, and the run and
 * exception pages list.
 *
 * A worker records each pull request as soon as GitHub has opened it
 * (/ai-agent-data/record-pull-request), retrying a record whose answer it
 * did not get. One that still could not be recorded goes with the run's
 * Completed status (/ai-agent-task/update-task-status), which records it
 * here too. So the same pull request can arrive more than once — even while
 * the first record is still being written — and is recorded once.
 */
export default class CodeFixPullRequestRecord {
  /*
   * A reported pull request's fields. The repository, the URL and the title
   * are required; any other value that is missing or of the wrong type is
   * left out of the record rather than refusing it. A verification status
   * this server does not know is dropped too: the column is a typed enum and
   * the worker may be older or newer than this server.
   */
  public static readFields(data: JSONObject): OpenedPullRequestFields {
    const codeRepositoryId: unknown = data["codeRepositoryId"];

    if (typeof codeRepositoryId !== "string" || !codeRepositoryId) {
      throw new BadDataException("codeRepositoryId is required");
    }

    const pullRequestUrl: unknown = data["pullRequestUrl"];

    if (typeof pullRequestUrl !== "string" || !pullRequestUrl) {
      throw new BadDataException("pullRequestUrl is required");
    }

    const title: unknown = data["title"];

    if (typeof title !== "string" || !title) {
      throw new BadDataException("title is required");
    }

    const runnerVerificationStatus: unknown = data["runnerVerificationStatus"];

    return {
      codeRepositoryId: new ObjectID(codeRepositoryId),
      pullRequestUrl: pullRequestUrl,
      pullRequestNumber: CodeFixPullRequestRecord.readPositiveInteger(
        data["pullRequestNumber"],
      ),
      pullRequestId: CodeFixPullRequestRecord.readPositiveInteger(
        data["pullRequestId"],
      ),
      title: title,
      description: CodeFixPullRequestRecord.readText(data["description"]),
      headRefName: CodeFixPullRequestRecord.readText(data["headRefName"]),
      baseRefName: CodeFixPullRequestRecord.readText(data["baseRefName"]),
      runnerVerificationStatus: Object.values(FixVerificationStatus).includes(
        runnerVerificationStatus as FixVerificationStatus,
      )
        ? (runnerVerificationStatus as FixVerificationStatus)
        : undefined,
      runnerVerificationSummary: CodeFixPullRequestRecord.readText(
        data["runnerVerificationSummary"],
      ),
    };
  }

  /*
   * Record a pull request on the run, once. A run that already recorded a
   * pull request with this number in this repository gets that row back and
   * nothing new: no second row for the cap to count, no second entry on the
   * run's trail. (A run that fixes several repositories can open the same
   * number in each, so the repository is part of the match.)
   *
   * Null when the repository is not one of the run's project, and nothing is
   * recorded. The row is what the open-PR cap counts, so a foreign
   * repository id would let one project's records skew another's guardrail —
   * and a nonexistent one would fail on the codeRepositoryId foreign key.
   *
   * The caller has found the run and checked the agent may act on its
   * project.
   */
  @CaptureSpan()
  public static async record(data: {
    aiRunId: ObjectID;
    projectId: ObjectID;
    aiAgent: CodeFixAgentIdentity;
    fields: OpenedPullRequestFields;
  }): Promise<RecordedPullRequest | null> {
    const fields: OpenedPullRequestFields = data.fields;

    const codeRepository: CodeRepository | null =
      await CodeRepositoryService.findOneById({
        id: fields.codeRepositoryId,
        select: {
          _id: true,
          projectId: true,
          organizationName: true,
          repositoryName: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (
      !codeRepository ||
      codeRepository.projectId?.toString() !== data.projectId.toString()
    ) {
      return null;
    }

    const pullRequest: AIAgentTaskPullRequest = new AIAgentTaskPullRequest();
    pullRequest.projectId = data.projectId;
    pullRequest.aiRunId = data.aiRunId;

    /*
     * aiAgentId is a real foreign key into the AIAgent table, so it can only
     * carry an AIAgent identity. A Runner leaves it null — the same "no
     * AIAgent behind it" case chat-authored pull requests already use, and
     * every consumer tolerates.
     */
    if (data.aiAgent.source === CodeFixAgentSource.AIAgent) {
      pullRequest.aiAgentId = data.aiAgent.id;
    }

    pullRequest.codeRepositoryId = fields.codeRepositoryId;
    pullRequest.pullRequestUrl = URL.fromString(fields.pullRequestUrl);

    if (fields.pullRequestNumber !== undefined) {
      pullRequest.pullRequestNumber = fields.pullRequestNumber;
    }

    if (fields.pullRequestId !== undefined) {
      pullRequest.pullRequestId = fields.pullRequestId;
    }

    // The column is ShortText — DatabaseService rejects over 100 chars.
    pullRequest.title = fields.title.substring(0, 100);

    if (fields.description) {
      /*
       * The column is LongText, which DatabaseService validates at 500
       * characters — truncate, never reject the whole recording.
       */
      pullRequest.description = fields.description.substring(0, 500);
    }

    pullRequest.pullRequestState = PullRequestState.Open;

    if (fields.headRefName) {
      pullRequest.headRefName = fields.headRefName;
    }

    if (fields.baseRefName) {
      pullRequest.baseRefName = fields.baseRefName;
    }

    if (codeRepository.organizationName) {
      pullRequest.repoOrganizationName = codeRepository.organizationName;
    }

    if (codeRepository.repositoryName) {
      pullRequest.repoName = codeRepository.repositoryName;
    }

    if (fields.runnerVerificationStatus) {
      pullRequest.runnerVerificationStatus = fields.runnerVerificationStatus;
    }

    if (fields.runnerVerificationSummary) {
      // The column is varchar(500) — truncate, never reject.
      pullRequest.runnerVerificationSummary =
        fields.runnerVerificationSummary.substring(0, 500);
    }

    let createdPullRequest: AIAgentTaskPullRequest;

    const mutex: SemaphoreMutex | null =
      await CodeFixPullRequestRecord.takeRunLock(data.aiRunId);

    try {
      if (fields.pullRequestNumber !== undefined) {
        const recordedPullRequest: AIAgentTaskPullRequest | null =
          await AIAgentTaskPullRequestService.findOneBy({
            query: {
              aiRunId: data.aiRunId,
              codeRepositoryId: fields.codeRepositoryId,
              pullRequestNumber: fields.pullRequestNumber,
            },
            select: {
              _id: true,
            },
            props: {
              isRoot: true,
            },
          });

        if (recordedPullRequest) {
          return {
            pullRequest: recordedPullRequest,
            created: false,
          };
        }
      }

      createdPullRequest = await AIAgentTaskPullRequestService.create({
        data: pullRequest,
        props: {
          isRoot: true,
        },
      });
    } finally {
      await CodeFixPullRequestRecord.giveBackRunLock(mutex);
    }

    /*
     * A run that opened a pull request in a repository works in it: a recipe
     * that found its repository as it went is linked to it, so the task is
     * on that repository's page in Code. Only a run with no repository yet.
     */
    try {
      await AIRunService.updateOneBy({
        query: {
          _id: data.aiRunId.toString(),
          codeRepositoryId: QueryHelper.isNull(),
        },
        data: { codeRepositoryId: fields.codeRepositoryId } as never,
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(
        `Could not link run ${data.aiRunId.toString()} to repository ${fields.codeRepositoryId.toString()}: ${error}`,
      );
    }

    /*
     * The pull request is the run's headline action — record it on the run's
     * glass-box trail so the activity feed shows it.
     */
    await AIRunEventService.appendEventToRun({
      projectId: data.projectId,
      aiRunId: data.aiRunId,
      eventType: AIRunEventType.ActionExecuted,
      toolName: "open_pull_request",
      resultSummary: {
        message: `Opened pull request: ${fields.title} — ${fields.pullRequestUrl}`,
      },
    });

    return {
      pullRequest: createdPullRequest,
      created: true,
    };
  }

  /*
   * Record the pull requests a worker reported, with a run's Completed
   * status, as opened but not recorded. Each is read and scoped exactly as
   * record-pull-request reads and scopes one, and one the run recorded after
   * all is left as it is.
   *
   * Only a report that carries the pull request's number is recorded: the
   * worker may have failed to hear back from a record the server made, and
   * without the number there is no telling the two apart.
   *
   * Never throws. A pull request that cannot be recorded is logged, and the
   * report goes on to the run's status, which is what it is for.
   */
  public static async recordReportedPullRequests(data: {
    aiRunId: ObjectID;
    projectId: ObjectID;
    aiAgent: CodeFixAgentIdentity;
    pullRequests: unknown;
  }): Promise<void> {
    if (!Array.isArray(data.pullRequests)) {
      return;
    }

    const reportedPullRequests: Array<unknown> = data.pullRequests.slice(
      0,
      MAX_REPORTED_PULL_REQUESTS,
    );

    for (const reportedPullRequest of reportedPullRequests) {
      try {
        if (
          !reportedPullRequest ||
          typeof reportedPullRequest !== "object" ||
          Array.isArray(reportedPullRequest)
        ) {
          throw new BadDataException("a pull request must be an object");
        }

        const fields: OpenedPullRequestFields =
          CodeFixPullRequestRecord.readFields(
            reportedPullRequest as JSONObject,
          );

        if (fields.pullRequestNumber === undefined) {
          throw new BadDataException("pullRequestNumber is required");
        }

        const recordedPullRequest: RecordedPullRequest | null =
          await CodeFixPullRequestRecord.record({
            aiRunId: data.aiRunId,
            projectId: data.projectId,
            aiAgent: data.aiAgent,
            fields: fields,
          });

        if (!recordedPullRequest) {
          throw new BadDataException("Code repository not found");
        }

        if (recordedPullRequest.created) {
          logger.info(
            `Recorded pull request ${fields.pullRequestUrl} for run ${data.aiRunId.toString()} from its Completed report`,
          );
        }
      } catch (error) {
        const errorMessage: string =
          error instanceof Error ? error.message : String(error);

        logger.warn(
          `Could not record a pull request reported with the Completed status of run ${data.aiRunId.toString()}: ${errorMessage}`,
        );
      }
    }
  }

  /*
   * One run's records are made one at a time, so the second of two that
   * arrive together finds the first's row instead of adding its own. Null
   * when the lock cannot be had — Valkey is unreachable, or another record
   * held it for longer than a record waits — and the record goes ahead
   * without it: a duplicate row is a far smaller loss than the record.
   */
  private static async takeRunLock(
    aiRunId: ObjectID,
  ): Promise<SemaphoreMutex | null> {
    try {
      return await Semaphore.lock({
        key: aiRunId.toString(),
        namespace: RUN_LOCK_NAMESPACE,
      });
    } catch (error) {
      logger.error(error);
      return null;
    }
  }

  // Never throws: the lock runs out on its own once it stops being refreshed.
  private static async giveBackRunLock(
    mutex: SemaphoreMutex | null,
  ): Promise<void> {
    if (!mutex) {
      return;
    }

    try {
      await Semaphore.release(mutex);
    } catch (error) {
      logger.error(error);
    }
  }

  private static readPositiveInteger(value: unknown): number | undefined {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0
      ? value
      : undefined;
  }

  private static readText(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
  }
}
