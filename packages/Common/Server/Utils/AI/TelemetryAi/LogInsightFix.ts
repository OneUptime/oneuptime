import AIInsightService from "../../../Services/AIInsightService";
import AIService from "../../../Services/AIService";
import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import ProjectService, { CurrentPlan } from "../../../Services/ProjectService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import SourceLocator, {
  LocatableRepository,
} from "../../CodeRepository/SourceLocator";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import OpenPullRequestCap, {
  OpenPullRequestCapDecision,
} from "../CodeFix/OpenPullRequestCap";
import CodeTaskAccess from "../CodeTask/CodeTaskAccess";
import CodeTaskContextBuilder from "../CodeTask/CodeTaskContextBuilder";
import CodeTaskGate from "../CodeTask/CodeTaskGate";
import CodeTaskRuns from "../CodeTask/CodeTaskRuns";
import SubjectCodeFixRun from "../SRE/SubjectCodeFixRun";
import TelemetryAiFix, { TelemetryAiFixResult } from "./TelemetryAiFix";
import AIInsight from "../../../../Models/DatabaseModels/AIInsight";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import { LogInsightEvidence } from "../../../../Types/AI/AIInsightEvidence";
import AIInsightStatus, {
  AIInsightStatusHelper,
} from "../../../../Types/AI/AIInsightStatus";
import {
  CODE_TASK_LIMITS,
  CodeTaskBlocker,
  CodeTaskContextItem,
  CodeTaskContextType,
} from "../../../../Types/AI/CodeTask";
import {
  TELEMETRY_AI_LANES,
  TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY,
  TelemetryAiLane,
  TelemetryAiWork,
} from "../../../../Types/AI/TelemetryAi";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { CodeRepositoryAllowance } from "../../../../Types/CodeRepository/CodeRepositoryAllowance";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import SuggestionOffer from "../../../../Utils/Suggestions/SuggestionOffer";
import {
  NO_TELEMETRY_AI_FIX_SUGGESTION,
  TelemetryAiFixOffer,
  TelemetryAiFixRepository,
  TelemetryAiFixSuggestion,
  getTelemetryAiFixOffer,
} from "../../../../Utils/Suggestions/TelemetryAiFixSuggestion";
import {
  buildLogFixEvidenceNote,
  buildLogFixRequestMessage,
  getLogInsightStackTrace,
  isLogInsightKind,
} from "../../../../Utils/Logs/LogInsight";

/*
 * THE PULL REQUEST FOR A PROBLEM ONEUPTIME FOUND IN A SERVICE'S LOGS - a
 * Code task in the repository that holds the code (Types/AI/TelemetryAi):
 * one that fixes what makes the code log an error, adds the logging a
 * service lacks (a failure it does not log, logs with no trace context), or
 * logs a noisy line less (Utils/Logs/LogInsight).
 *
 * Two ways in, one request:
 *
 *   - OneUptime starts it on its own (start), when the log AI rules fix
 *     without asking - written as OneUptime's own request, with leave to
 *     change nothing, stamped with the insight (CodeTaskRuns
 *     .startForOneUptime), on the repository's own Runner;
 *   - a person asks for it on the insight (getSuggestion, createFixTask) -
 *     what a rule that asks before fixing leaves to them - under their own
 *     permissions, in a repository they may ask AI to work in.
 *
 * The request is the finding said plainly, with a request it was found in
 * as a Trace context (read now: spans expire) and what OneUptime found as a
 * note - the message's pattern, never a log line as it was logged, the
 * counts and where the code logged it - so the task keeps its evidence
 * whatever happens to the logs. The repository is the one the lines' code
 * locations (or a silent failure's stack trace) are found in, else the one
 * named like the service, else the only one there is
 * (CodeRepositoryService.resolveRepositoryForException).
 *
 * OneUptime's own start is held to what every lane's is (TelemetryAiFix):
 * the day's share, one task per problem, Code's own gate (plan, bill,
 * Enable AI, an LLM provider with credits, the daily limits, a Runner
 * online) and the repository's cap on open AI pull requests. Never throws:
 * the routing reads a missing task as "not yet".
 */

// Why a fix was not started, in the words a debug log line ends with.
export enum LogInsightFixSkip {
  NoEvidence = "the insight holds no log evidence",
  DailyLimit = "OneUptime already opened its daily share of pull requests for this project",
  NoRepository = "no repository the rules allow is connected in Code",
  RepositoryNotFound = "no repository the rules allow could be told to hold the code",
  Blocked = "Code cannot start a task in the repository",
  AtPullRequestCap = "the repository is at its cap of open AI pull requests",
  Failed = "the task could not be created",
}

export interface LogInsightFixResult extends TelemetryAiFixResult {
  skip?: LogInsightFixSkip | undefined;
}

export const LOG_FIX_INSIGHT_NOT_FOUND_MESSAGE: string =
  "That finding is not one of this project's log findings, or you cannot see it.";

export const LOG_FIX_INSIGHT_CLOSED_MESSAGE: string =
  "That finding is closed. Reopen it to ask for a fix.";

export const LOG_FIX_INSIGHT_HAS_FIX_MESSAGE: string =
  "A pull request was already asked for this finding. Follow it from the finding.";

export const LOG_FIX_ALREADY_RUNNING_MESSAGE: string =
  "OneUptime AI is already working on this finding. Follow it in Code.";

export const LOG_FIX_PICK_REPOSITORY_MESSAGE: string =
  "Pick the repository that holds this code.";

export const LOG_FIX_REPOSITORY_NOT_AVAILABLE_MESSAGE: string =
  "That repository is not connected, or you cannot ask AI to work in it.";

// What a log finding is read with.
const INSIGHT_SELECT: {
  _id: true;
  projectId: true;
  insightType: true;
  status: true;
  serviceName: true;
  evidence: true;
  fixAiRunId: true;
} = {
  _id: true,
  projectId: true,
  insightType: true,
  status: true,
  serviceName: true,
  evidence: true,
  fixAiRunId: true,
};

const LOG_INSIGHT_TYPES: ReadonlyArray<string> =
  TELEMETRY_AI_LANES[TelemetryAiLane.Log].insightTypes;

export default class LogInsightFix {
  // The log evidence of a finding, when it holds any to fix by.
  public static getEvidence(
    insight: AIInsight | null | undefined,
  ): LogInsightEvidence | null {
    const evidence: LogInsightEvidence | undefined = insight?.evidence?.log;

    if (
      !evidence ||
      !isLogInsightKind(evidence.kind) ||
      !evidence.serviceId ||
      !LOG_INSIGHT_TYPES.includes(insight?.insightType || "")
    ) {
      return null;
    }

    return evidence;
  }

  // A request the finding was read in: its failed one, or one that logged it.
  public static getSampleTraceId(evidence: LogInsightEvidence): string | null {
    return evidence.sampleTraceId || evidence.sampleTraceIds?.[0] || null;
  }

  /*
   * What the task is given: a request the evidence was read in, as a Trace
   * context read now - left out when it cannot be read any more (its spans
   * expired, or the person may not read traces) - and what OneUptime found,
   * as a note. No log line is attached: a line may hold whatever the code
   * put in it, so the note carries the message's pattern instead.
   */
  public static async buildContext(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    evidence: LogInsightEvidence;
  }): Promise<Array<CodeTaskContextItem>> {
    const items: Array<CodeTaskContextItem> = [];
    const traceId: string | null = LogInsightFix.getSampleTraceId(
      data.evidence,
    );

    if (traceId) {
      try {
        items.push(
          await CodeTaskContextBuilder.buildItem(
            {
              type: CodeTaskContextType.Trace,
              traceId,
            },
            { projectId: data.projectId, props: data.props },
          ),
        );
      } catch (error) {
        logger.debug(
          `AI: the trace ${traceId} of a log finding could not be read for its fix; the note carries the evidence: ${error}`,
        );
      }
    }

    const note: string = buildLogFixEvidenceNote(data.evidence);

    items.push(
      await CodeTaskContextBuilder.buildItem(
        {
          type: CodeTaskContextType.Note,
          text:
            note.length > CODE_TASK_LIMITS.maxNoteLength
              ? note.substring(0, CODE_TASK_LIMITS.maxNoteLength)
              : note,
        },
        { projectId: data.projectId, props: data.props },
      ),
    );

    return items;
  }

  /*
   * The repository the finding's code is in, of the ones allowed: where the
   * lines' code locations (or a silent failure's stack trace) are found,
   * else the one named like the service, else the only one. Null when there
   * is no telling.
   */
  public static async resolveRepository(data: {
    projectId: ObjectID;
    evidence: LogInsightEvidence;
    serviceName: string | null;
    allowance: CodeRepositoryAllowance;
  }): Promise<string | null> {
    try {
      const resolution: { codeRepositoryId: string } | null =
        await CodeRepositoryService.resolveRepositoryForException({
          projectId: data.projectId,
          stackTrace: getLogInsightStackTrace(data.evidence),
          serviceName: data.serviceName,
          allowance: data.allowance,
        });

      return resolution?.codeRepositoryId?.toLowerCase() || null;
    } catch (error) {
      logger.debug(
        `AI: could not tell which repository holds a log finding's code: ${error}`,
      );
      return null;
    }
  }

  @CaptureSpan()
  public static async start(data: {
    insight: AIInsight;
    work: TelemetryAiWork;
  }): Promise<LogInsightFixResult> {
    try {
      return await LogInsightFix.startOrSkip(data);
    } catch (error) {
      logger.error(
        `AI: could not start a fix for insight ${data.insight.id?.toString()}: ${error}`,
      );
      return { skip: LogInsightFixSkip.Failed };
    }
  }

  private static async startOrSkip(data: {
    insight: AIInsight;
    work: TelemetryAiWork;
  }): Promise<LogInsightFixResult> {
    const insight: AIInsight = data.insight;
    const evidence: LogInsightEvidence | null =
      LogInsightFix.getEvidence(insight);

    if (!insight.id || !insight.projectId || !evidence) {
      return { skip: LogInsightFixSkip.NoEvidence };
    }

    const projectId: ObjectID = insight.projectId;

    if (
      (await TelemetryAiFix.countStartedToday(projectId)) >=
      TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY
    ) {
      return { skip: LogInsightFixSkip.DailyLimit };
    }

    // A task about this finding already on its way is its fix.
    const activeTaskId: string | null =
      await TelemetryAiFix.findActiveTaskIdForInsight({
        projectId,
        insightId: insight.id,
      });

    if (activeTaskId) {
      return { taskId: new ObjectID(activeTaskId) };
    }

    if (
      !(await SubjectCodeFixRun.hasConnectedRepository(
        projectId,
        data.work.repositories,
      ))
    ) {
      return { skip: LogInsightFixSkip.NoRepository };
    }

    const repositoryId: string | null = await LogInsightFix.resolveRepository({
      projectId,
      evidence,
      serviceName: insight.serviceName || null,
      allowance: data.work.repositories,
    });

    if (!repositoryId) {
      return { skip: LogInsightFixSkip.RepositoryNotFound };
    }

    const repository: CodeRepository | null =
      await CodeRepositoryService.findOneBy({
        query: { _id: repositoryId, projectId },
        select: {
          _id: true,
          name: true,
          organizationName: true,
          repositoryName: true,
          maxOpenFixPullRequests: true,
        },
        props: { isRoot: true },
      });

    if (!repository || !repository.id) {
      return { skip: LogInsightFixSkip.NoRepository };
    }

    /*
     * Code's gate, as a person asking in the repository would meet it - the
     * plan and the bill included, read for the project, since nobody here
     * carries them.
     */
    const plan: CurrentPlan = await ProjectService.getCurrentPlan(projectId);
    const props: DatabaseCommonInteractionProps = {
      isRoot: true,
      ...(plan.plan ? { currentPlan: plan.plan } : {}),
      isSubscriptionUnpaid: plan.isSubscriptionUnpaid,
    };

    const blocker: CodeTaskBlocker | null = await CodeTaskGate.getBlocker({
      props,
      projectId,
      repository,
      canAsk: true,
    });

    if (blocker) {
      return { skip: LogInsightFixSkip.Blocked, detail: blocker.message };
    }

    const cap: OpenPullRequestCapDecision =
      await OpenPullRequestCap.checkForRepository({
        codeRepositoryId: repository.id,
        configuredLimit: repository.maxOpenFixPullRequests ?? null,
      });

    if (!cap.allowed) {
      return { skip: LogInsightFixSkip.AtPullRequestCap };
    }

    const run: AIRun = await CodeTaskRuns.startForOneUptime({
      projectId,
      repository,
      message: buildLogFixRequestMessage({
        evidence,
        serviceName: insight.serviceName || "",
        isStartedByOneUptime: true,
      }),
      context: await LogInsightFix.buildContext({
        projectId,
        props: { isRoot: true },
        evidence,
      }),
      triggeredByAiInsightId: insight.id,
      ...(data.work.llmProviderId
        ? { llmProviderId: new ObjectID(data.work.llmProviderId) }
        : {}),
    });

    return { taskId: run.id! };
  }

  /*
   * A log finding the person may read, of this project. Null when there is
   * none they may read.
   */
  private static async readInsight(data: {
    projectId: ObjectID;
    insightId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<AIInsight | null> {
    return await AIInsightService.findOneBy({
      query: {
        _id: data.insightId.toString(),
        projectId: data.projectId,
        insightType: QueryHelper.any([...LOG_INSIGHT_TYPES]),
      },
      select: INSIGHT_SELECT,
      props: data.props,
    });
  }

  // The repositories, of the ones the person may read, they may ask in.
  private static async getAskableRepositories(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<LocatableRepository>> {
    const readable: Array<LocatableRepository> =
      await SourceLocator.getLocatableRepositories({
        projectId: data.projectId,
        props: data.props,
      });

    const askable: Array<LocatableRepository> = [];

    for (const repository of readable) {
      if (
        await CodeTaskAccess.canAskInRepository({
          props: data.props,
          projectId: data.projectId,
          repositoryId: new ObjectID(repository.id),
        })
      ) {
        askable.push(repository);
      }
    }

    return askable;
  }

  private static toRepository(
    repository: LocatableRepository,
  ): TelemetryAiFixRepository {
    return { id: repository.id, name: repository.name };
  }

  /*
   * What a log finding offers for "Fix with AI", decided by the gates the
   * create route enforces, in the same order. Never throws for a finding the
   * person may not read: there is simply nothing to suggest.
   */
  @CaptureSpan()
  public static async getSuggestion(data: {
    projectId: ObjectID;
    insightId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<TelemetryAiFixSuggestion> {
    if (!(await AIService.isProjectAIEnabled(data.projectId))) {
      return NO_TELEMETRY_AI_FIX_SUGGESTION;
    }

    const insight: AIInsight | null = await LogInsightFix.readInsight(data);
    const evidence: LogInsightEvidence | null =
      LogInsightFix.getEvidence(insight);

    if (
      !insight ||
      !evidence ||
      insight.fixAiRunId ||
      !insight.status ||
      AIInsightStatusHelper.isTerminalStatus(insight.status)
    ) {
      return NO_TELEMETRY_AI_FIX_SUGGESTION;
    }

    const activeTaskId: string | null =
      await TelemetryAiFix.findActiveTaskIdForInsight({
        projectId: data.projectId,
        insightId: data.insightId,
      });

    if (activeTaskId) {
      return {
        ...NO_TELEMETRY_AI_FIX_SUGGESTION,
        offer: SuggestionOffer.InProgress,
        taskId: activeTaskId,
      };
    }

    const askable: Array<LocatableRepository> =
      await LogInsightFix.getAskableRepositories(data);

    if (askable.length === 0) {
      /*
       * Repositories are connected, but none the person may ask in: nothing
       * they could do here would start the fix.
       */
      if (await SubjectCodeFixRun.hasConnectedRepository(data.projectId)) {
        return NO_TELEMETRY_AI_FIX_SUGGESTION;
      }

      const offer: TelemetryAiFixOffer = getTelemetryAiFixOffer({
        isAiEnabled: true,
        isFixable: true,
        hasActiveFix: false,
        hasConnectedRepository: false,
      });

      return { ...NO_TELEMETRY_AI_FIX_SUGGESTION, ...offer };
    }

    const resolvedId: string | null = await LogInsightFix.resolveRepository({
      projectId: data.projectId,
      evidence,
      serviceName: insight.serviceName || null,
      allowance: {
        isEveryRepository: false,
        repositoryIds: askable.map((repository: LocatableRepository) => {
          return repository.id.toLowerCase();
        }),
      },
    });

    const resolved: LocatableRepository | undefined = askable.find(
      (repository: LocatableRepository): boolean => {
        return repository.id.toLowerCase() === resolvedId;
      },
    );

    const gateRepository: CodeRepository = new CodeRepository();
    gateRepository.id = new ObjectID((resolved || askable[0]!).id);

    const blocker: CodeTaskBlocker | null = await CodeTaskGate.getBlocker({
      props: data.props,
      projectId: data.projectId,
      repository: gateRepository,
      canAsk: true,
    });

    const offer: TelemetryAiFixOffer = getTelemetryAiFixOffer({
      isAiEnabled: true,
      isFixable: true,
      hasActiveFix: false,
      hasConnectedRepository: true,
      blocker: blocker
        ? {
            type: blocker.type,
            message: blocker.message,
            ...(blocker.runnerName ? { runnerName: blocker.runnerName } : {}),
            repositoryId: gateRepository.id.toString(),
          }
        : null,
    });

    if (offer.offer === SuggestionOffer.None) {
      return NO_TELEMETRY_AI_FIX_SUGGESTION;
    }

    if (offer.offer === SuggestionOffer.SetUp) {
      return { ...NO_TELEMETRY_AI_FIX_SUGGESTION, ...offer };
    }

    return {
      ...offer,
      repository: resolved ? LogInsightFix.toRepository(resolved) : null,
      repositories: resolved ? [] : askable.map(LogInsightFix.toRepository),
      taskId: null,
    };
  }

  /*
   * Start the fix a person asked for on a log finding: a Code task in the
   * repository that holds its code, under their own permissions. Every gate
   * of getSuggestion is checked again; each refusal says which.
   */
  @CaptureSpan()
  public static async createFixTask(data: {
    projectId: ObjectID;
    insightId: ObjectID;
    userId: ObjectID;
    props: DatabaseCommonInteractionProps;
    // The repository the person picked, when none was found for certain.
    repositoryId?: ObjectID | undefined;
  }): Promise<{ taskId: string }> {
    // The project's one AI switch, before anything else is read.
    await AIService.assertProjectAIEnabled(data.projectId);

    const insight: AIInsight | null = await LogInsightFix.readInsight(data);
    const evidence: LogInsightEvidence | null =
      LogInsightFix.getEvidence(insight);

    if (!insight || !evidence || !insight.id) {
      throw new BadDataException(LOG_FIX_INSIGHT_NOT_FOUND_MESSAGE);
    }

    if (
      !insight.status ||
      AIInsightStatusHelper.isTerminalStatus(insight.status)
    ) {
      throw new BadDataException(LOG_FIX_INSIGHT_CLOSED_MESSAGE);
    }

    if (insight.fixAiRunId) {
      throw new BadDataException(LOG_FIX_INSIGHT_HAS_FIX_MESSAGE);
    }

    if (
      await TelemetryAiFix.findActiveTaskIdForInsight({
        projectId: data.projectId,
        insightId: insight.id,
      })
    ) {
      throw new BadDataException(LOG_FIX_ALREADY_RUNNING_MESSAGE);
    }

    const askable: Array<LocatableRepository> =
      await LogInsightFix.getAskableRepositories(data);

    let repositoryId: string | null = null;

    if (data.repositoryId) {
      const picked: string = data.repositoryId.toString().toLowerCase();

      if (
        !askable.some((repository: LocatableRepository): boolean => {
          return repository.id.toLowerCase() === picked;
        })
      ) {
        throw new BadDataException(LOG_FIX_REPOSITORY_NOT_AVAILABLE_MESSAGE);
      }

      repositoryId = picked;
    } else if (askable.length > 0) {
      repositoryId = await LogInsightFix.resolveRepository({
        projectId: data.projectId,
        evidence,
        serviceName: insight.serviceName || null,
        allowance: {
          isEveryRepository: false,
          repositoryIds: askable.map((repository: LocatableRepository) => {
            return repository.id.toLowerCase();
          }),
        },
      });
    }

    if (!repositoryId) {
      throw new BadDataException(
        askable.length > 0
          ? LOG_FIX_PICK_REPOSITORY_MESSAGE
          : LOG_FIX_REPOSITORY_NOT_AVAILABLE_MESSAGE,
      );
    }

    const repository: CodeRepository | null =
      await CodeRepositoryService.findOneBy({
        query: { _id: repositoryId, projectId: data.projectId },
        select: {
          _id: true,
          name: true,
          organizationName: true,
          repositoryName: true,
        },
        props: { isRoot: true },
      });

    if (!repository || !repository.id) {
      throw new BadDataException(LOG_FIX_REPOSITORY_NOT_AVAILABLE_MESSAGE);
    }

    const blocker: CodeTaskBlocker | null = await CodeTaskGate.getBlocker({
      props: data.props,
      projectId: data.projectId,
      repository,
      canAsk: true,
    });

    if (blocker) {
      throw new BadDataException(blocker.message);
    }

    const run: AIRun = await CodeTaskRuns.start({
      projectId: data.projectId,
      userId: data.userId,
      repository,
      message: buildLogFixRequestMessage({
        evidence,
        serviceName: insight.serviceName || "",
        isStartedByOneUptime: false,
      }),
      context: await LogInsightFix.buildContext({
        projectId: data.projectId,
        props: data.props,
        evidence,
      }),
      triggeredByAiInsightId: insight.id,
    });

    /*
     * The finding links its fix, once: a fix linked meanwhile (OneUptime
     * opened one on its own, or someone else asked) keeps its link, and a
     * closed finding stays closed.
     */
    await AIInsightService.updateOneBy({
      query: {
        _id: insight.id.toString(),
        projectId: data.projectId,
        fixAiRunId: QueryHelper.isNull(),
        status: QueryHelper.any([
          AIInsightStatus.Detected,
          AIInsightStatus.ActionRequired,
        ]),
      },
      data: {
        status: AIInsightStatus.FixOpened,
        fixAiRunId: run.id!,
      },
      props: { isRoot: true },
    });

    return { taskId: run.id!.toString() };
  }
}
