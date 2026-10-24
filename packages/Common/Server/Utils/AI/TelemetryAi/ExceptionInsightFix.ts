import AIInsightService from "../../../Services/AIInsightService";
import AIRunService from "../../../Services/AIRunService";
import AIService from "../../../Services/AIService";
import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import ProjectService, { CurrentPlan } from "../../../Services/ProjectService";
import TelemetryExceptionService from "../../../Services/TelemetryExceptionService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import { LocatableRepository } from "../../CodeRepository/SourceLocator";
import { RepoResolution } from "../../CodeRepository/StackTraceRepoResolver";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import OpenPullRequestCap, {
  OpenPullRequestCapDecision,
} from "../CodeFix/OpenPullRequestCap";
import CodeTaskContextBuilder from "../CodeTask/CodeTaskContextBuilder";
import CodeTaskGate from "../CodeTask/CodeTaskGate";
import CodeTaskRuns from "../CodeTask/CodeTaskRuns";
import ExceptionOwnCode from "../SRE/Insights/Detectors/ExceptionOwnCode";
import SubjectCodeFixRun from "../SRE/SubjectCodeFixRun";
import TelemetryAiFix, { TelemetryAiFixResult } from "./TelemetryAiFix";
import TraceInsightFix from "./TraceInsightFix";
import AIInsight from "../../../../Models/DatabaseModels/AIInsight";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import {
  AIFixReadiness,
  AIFixReadinessCheck,
} from "../../../../Types/AI/AIFixReadiness";
import { ExceptionStackTraceInsightEvidence } from "../../../../Types/AI/AIInsightEvidence";
import AIInsightStatus, {
  AIInsightStatusHelper,
} from "../../../../Types/AI/AIInsightStatus";
import { AIRunStatusHelper } from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
import {
  CODE_TASK_LIMITS,
  CodeTaskBlocker,
  CodeTaskBlockerType,
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
import {
  EXCEPTION_FIX_TASK_TYPE_BY_KIND,
  ExceptionFixKind,
  ExceptionInsightKind,
  buildExceptionStackTraceEvidenceNote,
  buildExceptionStackTraceRequestMessage,
  getAutomaticExceptionFixKind,
  getExceptionInsightKind,
  getPersonExceptionFixKind,
} from "../../../../Utils/Exceptions/ExceptionInsight";
import SuggestionOffer from "../../../../Utils/Suggestions/SuggestionOffer";
import {
  NO_TELEMETRY_AI_FIX_SUGGESTION,
  TelemetryAiFixBlocker,
  TelemetryAiFixOffer,
  TelemetryAiFixSuggestion,
  getTelemetryAiFixOffer,
} from "../../../../Utils/Suggestions/TelemetryAiFixSuggestion";

/*
 * THE PULL REQUEST FOR AN EXCEPTION PROBLEM ONEUPTIME FOUND - the
 * Exceptions product's AI section (Types/AI/TelemetryAi, Utils/Exceptions/
 * ExceptionInsight):
 *
 *   - for a new or rising exception, the exception's own AI task - the one
 *     its AI Assistance page starts (TelemetryExceptionService
 *     .createCodeFixRunForException): a fix (FixException) when the
 *     investigation found the code at fault, better handling
 *     (ImproveExceptionHandling) when it found an expected error. So the
 *     exception's page shows it, Code lists it with the exception as what
 *     started it, its pull request says why it was opened, and once it is
 *     merged production is watched to tell whether it fixed the exception
 *     (FixProductionVerifier) - every guard of that path coming with it:
 *     one task per exception and recipe, one per root cause across
 *     exceptions whose messages differ only by their values, none for a
 *     resolved or archived exception, and none on its own for one whose
 *     last AI pull request a person closed without merging;
 *   - for a service's missing stack traces, a request in Code
 *     (CodeTaskRuns), as Traces' missing tracing is: what to change is the
 *     service's, not one exception's.
 *
 * Two ways in, as every lane has:
 *
 *   - OneUptime starts it on its own (start) when the exception AI rules fix
 *     without asking - once the investigation's verdict lets a new or
 *     rising exception's open, and only for one raised in the application's
 *     own code (a frame of it in its stack trace): one raised in library
 *     and runtime frames only, or with no stack trace, says nothing about
 *     which code to change. It is held to what every lane's is
 *     (TelemetryAiFix): the day's share, one task per problem, the
 *     repositories the rules allow and the repository's cap on open AI pull
 *     requests; and a request in Code to Code's own gate too;
 *   - a person asks for it on the finding (getSuggestion, createFixTask) -
 *     what a rule that asks before fixing leaves to them - under their own
 *     permissions: a fix, or better handling once the investigation found
 *     an expected error. The person decides: no verdict and no frame of
 *     their own code are needed.
 *
 * Never throws from start: the routing reads a missing task as "not yet".
 */

// Why a fix was not started, in the words a debug log line ends with.
export enum ExceptionInsightFixSkip {
  NoEvidence = "the insight holds no exception evidence",
  DailyLimit = "OneUptime already opened its daily share of pull requests for this project",
  ExceptionClosed = "the exception is gone, resolved or archived",
  Declined = "a person closed the last AI pull request for this exception without merging it",
  NoVerdict = "the investigation's verdict opens no pull request on its own",
  NotOwnCode = "the exception's stack trace shows none of the application's own code",
  NoRepository = "no repository the rules allow is connected in Code",
  RepositoryNotFound = "no repository the rules allow could be told to hold the code",
  Blocked = "Code cannot start a task in the repository",
  AtPullRequestCap = "the repository is at its cap of open AI pull requests",
  Refused = "the exception's AI task was refused",
  Failed = "the task could not be created",
}

export interface ExceptionInsightFixResult extends TelemetryAiFixResult {
  skip?: ExceptionInsightFixSkip | undefined;
}

export const EXCEPTION_FIX_INSIGHT_NOT_FOUND_MESSAGE: string =
  "That finding is not one of this project's exception findings, or you cannot see it.";

export const EXCEPTION_FIX_INSIGHT_CLOSED_MESSAGE: string =
  "That finding is closed. Reopen it to ask for a fix.";

export const EXCEPTION_FIX_INSIGHT_HAS_FIX_MESSAGE: string =
  "A pull request was already asked for this finding. Follow it from the finding.";

export const EXCEPTION_FIX_ALREADY_RUNNING_MESSAGE: string =
  "OneUptime AI is already working on this. Follow it in Code.";

export const EXCEPTION_FIX_EXCEPTION_CLOSED_MESSAGE: string =
  "The exception is resolved or archived. Reopen it to ask for a fix.";

export const EXCEPTION_FIX_PICK_REPOSITORY_MESSAGE: string =
  "Pick the repository that holds this code.";

export const EXCEPTION_FIX_REPOSITORY_NOT_AVAILABLE_MESSAGE: string =
  "That repository is not connected, or you cannot ask AI to work in it.";

// What an exception finding is read with.
const INSIGHT_SELECT: {
  _id: true;
  projectId: true;
  insightType: true;
  status: true;
  serviceName: true;
  telemetryServiceId: true;
  telemetryExceptionId: true;
  evidence: true;
  fixAiRunId: true;
  classification: true;
} = {
  _id: true,
  projectId: true,
  insightType: true,
  status: true,
  serviceName: true,
  telemetryServiceId: true,
  telemetryExceptionId: true,
  evidence: true,
  fixAiRunId: true,
  classification: true,
};

const EXCEPTION_INSIGHT_TYPES: ReadonlyArray<string> =
  TELEMETRY_AI_LANES[TelemetryAiLane.Exception].insightTypes;

// The exception's own AI tasks a finding's fix may be.
const EXCEPTION_FIX_TASK_TYPES: Array<CodeFixTaskType> = Object.values(
  EXCEPTION_FIX_TASK_TYPE_BY_KIND,
);

export default class ExceptionInsightFix {
  // A service's missing stack traces, when the finding holds them.
  public static getStackTraceEvidence(
    insight: AIInsight | null | undefined,
  ): ExceptionStackTraceInsightEvidence | null {
    const evidence: ExceptionStackTraceInsightEvidence | undefined =
      insight?.evidence?.exceptionStackTrace;

    if (
      !evidence ||
      !evidence.serviceId ||
      getExceptionInsightKind(insight?.insightType) !==
        ExceptionInsightKind.MissingStackTrace
    ) {
      return null;
    }

    return evidence;
  }

  @CaptureSpan()
  public static async start(data: {
    insight: AIInsight;
    work: TelemetryAiWork;
  }): Promise<ExceptionInsightFixResult> {
    try {
      return await ExceptionInsightFix.startOrSkip(data);
    } catch (error) {
      logger.error(
        `AI: could not start a fix for insight ${data.insight.id?.toString()}: ${error}`,
      );
      return { skip: ExceptionInsightFixSkip.Failed };
    }
  }

  private static async startOrSkip(data: {
    insight: AIInsight;
    work: TelemetryAiWork;
  }): Promise<ExceptionInsightFixResult> {
    const insight: AIInsight = data.insight;
    const kind: ExceptionInsightKind | null = getExceptionInsightKind(
      insight.insightType,
    );

    if (!insight.id || !insight.projectId || !kind) {
      return { skip: ExceptionInsightFixSkip.NoEvidence };
    }

    const projectId: ObjectID = insight.projectId;

    if (
      (await TelemetryAiFix.countStartedToday(projectId)) >=
      TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY
    ) {
      return { skip: ExceptionInsightFixSkip.DailyLimit };
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

    return kind === ExceptionInsightKind.MissingStackTrace
      ? await ExceptionInsightFix.startStackTraceFix({
          insight,
          projectId,
          work: data.work,
        })
      : await ExceptionInsightFix.startExceptionFix({
          insight,
          projectId,
          work: data.work,
        });
  }

  /*
   * A new or rising exception's: the exception's own AI task, by the
   * investigation's verdict - its every gate checked again as it is made.
   */
  private static async startExceptionFix(data: {
    insight: AIInsight;
    projectId: ObjectID;
    work: TelemetryAiWork;
  }): Promise<ExceptionInsightFixResult> {
    const insight: AIInsight = data.insight;

    if (!insight.telemetryExceptionId) {
      return { skip: ExceptionInsightFixSkip.NoEvidence };
    }

    const exception: TelemetryException | null =
      await TelemetryExceptionService.findOneBy({
        query: {
          _id: insight.telemetryExceptionId.toString(),
          projectId: data.projectId,
        },
        select: {
          _id: true,
          stackTrace: true,
          isResolved: true,
          isArchived: true,
          aiFixDeclinedAt: true,
        },
        props: { isRoot: true },
      });

    if (!exception || exception.isResolved || exception.isArchived) {
      return { skip: ExceptionInsightFixSkip.ExceptionClosed };
    }

    if (exception.aiFixDeclinedAt) {
      return { skip: ExceptionInsightFixSkip.Declined };
    }

    const fixKind: ExceptionFixKind | null = getAutomaticExceptionFixKind(
      insight.classification,
    );

    if (!fixKind) {
      return { skip: ExceptionInsightFixSkip.NoVerdict };
    }

    if (ExceptionOwnCode.read(exception.stackTrace).ownCodeFrames.length === 0) {
      return { skip: ExceptionInsightFixSkip.NotOwnCode };
    }

    if (
      !(await SubjectCodeFixRun.hasConnectedRepository(
        data.projectId,
        data.work.repositories,
      ))
    ) {
      return { skip: ExceptionInsightFixSkip.NoRepository };
    }

    const resolution: RepoResolution | null =
      await CodeRepositoryService.resolveRepositoryForException({
        projectId: data.projectId,
        stackTrace: exception.stackTrace || null,
        serviceName: insight.serviceName || null,
        allowance: data.work.repositories,
      });

    if (!resolution) {
      return { skip: ExceptionInsightFixSkip.RepositoryNotFound };
    }

    const repository: CodeRepository | null =
      await CodeRepositoryService.findOneBy({
        query: { _id: resolution.codeRepositoryId, projectId: data.projectId },
        select: {
          _id: true,
          maxOpenFixPullRequests: true,
        },
        props: { isRoot: true },
      });

    if (!repository || !repository.id) {
      return { skip: ExceptionInsightFixSkip.NoRepository };
    }

    const cap: OpenPullRequestCapDecision =
      await OpenPullRequestCap.checkForRepository({
        codeRepositoryId: repository.id,
        configuredLimit: repository.maxOpenFixPullRequests ?? null,
      });

    if (!cap.allowed) {
      return { skip: ExceptionInsightFixSkip.AtPullRequestCap };
    }

    let run: AIRun;

    try {
      /*
       * As the system: no person asked, so a pull request a person closed
       * without merging keeps it paused, and the run is OneUptime's own.
       */
      run = await TelemetryExceptionService.createCodeFixRunForException({
        telemetryExceptionId: insight.telemetryExceptionId,
        props: { isRoot: true },
        taskType: EXCEPTION_FIX_TASK_TYPE_BY_KIND[fixKind],
        triggeredByAiInsightId: insight.id!,
        codeRepositoryId: repository.id,
        ...(data.work.llmProviderId
          ? { llmProviderId: new ObjectID(data.work.llmProviderId) }
          : {}),
      });
    } catch (error) {
      /*
       * The exception's own gates said no - its readiness (an LLM provider,
       * a Runner online), the day's fix budget, a task for it or for an
       * exception like it already on its way: looked at again next time.
       */
      if (error instanceof BadDataException) {
        return {
          skip: ExceptionInsightFixSkip.Refused,
          detail: error.message,
        };
      }

      throw error;
    }

    return { taskId: run.id! };
  }

  // A service's missing stack traces: a request in Code.
  private static async startStackTraceFix(data: {
    insight: AIInsight;
    projectId: ObjectID;
    work: TelemetryAiWork;
  }): Promise<ExceptionInsightFixResult> {
    const insight: AIInsight = data.insight;
    const evidence: ExceptionStackTraceInsightEvidence | null =
      ExceptionInsightFix.getStackTraceEvidence(insight);

    if (!evidence) {
      return { skip: ExceptionInsightFixSkip.NoEvidence };
    }

    if (
      !(await SubjectCodeFixRun.hasConnectedRepository(
        data.projectId,
        data.work.repositories,
      ))
    ) {
      return { skip: ExceptionInsightFixSkip.NoRepository };
    }

    const repositoryId: string | null =
      await ExceptionInsightFix.resolveServiceRepository({
        projectId: data.projectId,
        serviceName: insight.serviceName || null,
        allowance: data.work.repositories,
      });

    if (!repositoryId) {
      return { skip: ExceptionInsightFixSkip.RepositoryNotFound };
    }

    const repository: CodeRepository | null =
      await CodeRepositoryService.findOneBy({
        query: { _id: repositoryId, projectId: data.projectId },
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
      return { skip: ExceptionInsightFixSkip.NoRepository };
    }

    /*
     * Code's gate, as a person asking in the repository would meet it - the
     * plan and the bill included, read for the project, since nobody here
     * carries them.
     */
    const plan: CurrentPlan = await ProjectService.getCurrentPlan(
      data.projectId,
    );
    const props: DatabaseCommonInteractionProps = {
      isRoot: true,
      ...(plan.plan ? { currentPlan: plan.plan } : {}),
      isSubscriptionUnpaid: plan.isSubscriptionUnpaid,
    };

    const blocker: CodeTaskBlocker | null = await CodeTaskGate.getBlocker({
      props,
      projectId: data.projectId,
      repository,
      canAsk: true,
    });

    if (blocker) {
      return { skip: ExceptionInsightFixSkip.Blocked, detail: blocker.message };
    }

    const cap: OpenPullRequestCapDecision =
      await OpenPullRequestCap.checkForRepository({
        codeRepositoryId: repository.id,
        configuredLimit: repository.maxOpenFixPullRequests ?? null,
      });

    if (!cap.allowed) {
      return { skip: ExceptionInsightFixSkip.AtPullRequestCap };
    }

    const run: AIRun = await CodeTaskRuns.startForOneUptime({
      projectId: data.projectId,
      repository,
      message: buildExceptionStackTraceRequestMessage({
        evidence,
        serviceName: insight.serviceName || "",
        isStartedByOneUptime: true,
      }),
      context: await ExceptionInsightFix.buildStackTraceContext({
        projectId: data.projectId,
        props: { isRoot: true },
        evidence,
      }),
      triggeredByAiInsightId: insight.id!,
      ...(data.work.llmProviderId
        ? { llmProviderId: new ObjectID(data.work.llmProviderId) }
        : {}),
    });

    return { taskId: run.id! };
  }

  /*
   * What a missing-stack-trace task is given: the loudest of the exceptions
   * as OneUptime keeps it, read now - left out when it cannot be read any
   * more, or the person may not read it - and what OneUptime found, as a
   * note.
   */
  public static async buildStackTraceContext(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    evidence: ExceptionStackTraceInsightEvidence;
  }): Promise<Array<CodeTaskContextItem>> {
    const items: Array<CodeTaskContextItem> = [];
    const loudest: string | undefined =
      data.evidence.exceptions[0]?.telemetryExceptionId;

    if (loudest && ObjectID.isValidUUID(loudest)) {
      try {
        items.push(
          await CodeTaskContextBuilder.buildItem(
            { type: CodeTaskContextType.Exception, id: loudest },
            { projectId: data.projectId, props: data.props },
          ),
        );
      } catch (error) {
        logger.debug(
          `AI: the exception ${loudest} of a missing-stack-trace finding could not be read for its fix; the note carries the evidence: ${error}`,
        );
      }
    }

    const note: string = buildExceptionStackTraceEvidenceNote(data.evidence);

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
   * The repository a service's code is in, of the ones allowed: the one
   * named like the service, else the only one. Null when there is no
   * telling.
   */
  public static async resolveServiceRepository(data: {
    projectId: ObjectID;
    serviceName: string | null;
    allowance: CodeRepositoryAllowance;
  }): Promise<string | null> {
    try {
      const resolution: RepoResolution | null =
        await CodeRepositoryService.resolveRepositoryForException({
          projectId: data.projectId,
          stackTrace: null,
          serviceName: data.serviceName,
          allowance: data.allowance,
        });

      return resolution?.codeRepositoryId?.toLowerCase() || null;
    } catch (error) {
      logger.debug(
        `AI: could not tell which repository holds a service's code: ${error}`,
      );
      return null;
    }
  }

  /*
   * An exception finding the person may read, of this project. Null when
   * there is none they may read.
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
        insightType: QueryHelper.any([...EXCEPTION_INSIGHT_TYPES]),
      },
      select: INSIGHT_SELECT,
      props: data.props,
    });
  }

  /*
   * The exception a new or rising exception finding is about, when the
   * person may read it - with what decides whether it can be fixed, and
   * where its code is.
   */
  private static async readException(data: {
    projectId: ObjectID;
    telemetryExceptionId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<TelemetryException | null> {
    try {
      return await TelemetryExceptionService.findOneBy({
        query: {
          _id: data.telemetryExceptionId.toString(),
          projectId: data.projectId,
        },
        select: {
          _id: true,
          isResolved: true,
          isArchived: true,
          stackTrace: true,
        },
        props: data.props,
      });
    } catch {
      // A table the person may not read at all names nothing.
      return null;
    }
  }

  /*
   * The exception's own AI task already on its way - for this finding, or
   * one a person started on the exception's page - or null.
   */
  private static async findActiveExceptionTaskId(data: {
    projectId: ObjectID;
    telemetryExceptionId: ObjectID;
  }): Promise<string | null> {
    const run: AIRun | null = await AIRunService.findOneBy({
      query: {
        projectId: data.projectId,
        runType: AIRunType.CodeFix,
        triggeredByTelemetryExceptionId: data.telemetryExceptionId,
        codeFixTaskType: QueryHelper.any(EXCEPTION_FIX_TASK_TYPES),
        status: QueryHelper.notIn(AIRunStatusHelper.terminalStatuses()),
      },
      select: { _id: true, codeTaskId: true },
      props: { isRoot: true },
    });

    return run ? (run.codeTaskId || run.id)?.toString() || null : null;
  }

  /*
   * What stands between a new or rising exception and its pull request,
   * from the exception's own readiness (Fix with AI on its page asks the
   * same): its first check that fails, in Code's words.
   */
  public static getReadinessBlocker(
    readiness: AIFixReadiness,
  ): TelemetryAiFixBlocker | null {
    const failed: AIFixReadinessCheck | undefined = readiness.checks.find(
      (check: AIFixReadinessCheck): boolean => {
        return !check.ok;
      },
    );

    if (!failed) {
      return null;
    }

    const message: string = failed.detail || failed.title;

    switch (failed.id) {
      case "llmProvider":
        return { type: CodeTaskBlockerType.NoLlmProvider, message };
      case "agentAvailable":
        return { type: CodeTaskBlockerType.NoAgent, message };
      case "repositoryResolved":
      case "repositoryConnected":
      default:
        return { type: CodeTaskBlockerType.RepositoryNotConnected, message };
    }
  }

  /*
   * What "Fix with AI" offers on an exception finding, decided by the gates
   * the create route enforces, in the same order. Never throws for a
   * finding the person may not read: there is simply nothing to suggest.
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

    const insight: AIInsight | null =
      await ExceptionInsightFix.readInsight(data);
    const kind: ExceptionInsightKind | null = getExceptionInsightKind(
      insight?.insightType,
    );

    if (
      !insight ||
      !kind ||
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

    return kind === ExceptionInsightKind.MissingStackTrace
      ? await ExceptionInsightFix.getStackTraceSuggestion({ ...data, insight })
      : await ExceptionInsightFix.getExceptionSuggestion({ ...data, insight });
  }

  private static async getExceptionSuggestion(data: {
    projectId: ObjectID;
    insightId: ObjectID;
    props: DatabaseCommonInteractionProps;
    insight: AIInsight;
  }): Promise<TelemetryAiFixSuggestion> {
    const exceptionId: ObjectID | undefined =
      data.insight.telemetryExceptionId || undefined;

    if (!exceptionId) {
      return NO_TELEMETRY_AI_FIX_SUGGESTION;
    }

    const exception: TelemetryException | null =
      await ExceptionInsightFix.readException({
        projectId: data.projectId,
        telemetryExceptionId: exceptionId,
        props: data.props,
      });

    if (!exception || exception.isResolved || exception.isArchived) {
      return NO_TELEMETRY_AI_FIX_SUGGESTION;
    }

    // One the person (or OneUptime) started on the exception's own page.
    const activeTaskId: string | null =
      await ExceptionInsightFix.findActiveExceptionTaskId({
        projectId: data.projectId,
        telemetryExceptionId: exceptionId,
      });

    if (activeTaskId) {
      return {
        ...NO_TELEMETRY_AI_FIX_SUGGESTION,
        offer: SuggestionOffer.InProgress,
        taskId: activeTaskId,
      };
    }

    const recipe: CodeFixTaskType =
      EXCEPTION_FIX_TASK_TYPE_BY_KIND[
        getPersonExceptionFixKind(data.insight.classification)
      ];

    if (!(await SubjectCodeFixRun.hasConnectedRepository(data.projectId))) {
      const offer: TelemetryAiFixOffer = getTelemetryAiFixOffer({
        isAiEnabled: true,
        isFixable: true,
        hasActiveFix: false,
        hasConnectedRepository: false,
      });

      return { ...NO_TELEMETRY_AI_FIX_SUGGESTION, ...offer };
    }

    // The exception page's own checklist: a provider, the code, a Runner.
    const readiness: AIFixReadiness =
      await TelemetryExceptionService.getAIFixReadiness({
        telemetryExceptionId: exceptionId,
        props: data.props,
      });

    const blocker: TelemetryAiFixBlocker | null =
      ExceptionInsightFix.getReadinessBlocker({
        ready: readiness.ready,
        checks: readiness.checks.filter(
          (check: AIFixReadinessCheck): boolean => {
            return !ExceptionInsightFix.isRepositoryCheck(check);
          },
        ),
      });

    if (blocker) {
      return {
        ...NO_TELEMETRY_AI_FIX_SUGGESTION,
        offer: SuggestionOffer.SetUp,
        blocker,
      };
    }

    const resolution: RepoResolution | null =
      await CodeRepositoryService.resolveRepositoryForException({
        projectId: data.projectId,
        stackTrace: exception.stackTrace || null,
        serviceName: data.insight.serviceName || null,
      });

    if (resolution) {
      return {
        offer: SuggestionOffer.Act,
        blocker: null,
        repository: {
          id: resolution.codeRepositoryId,
          name: `${resolution.organizationName}/${resolution.repositoryName}`,
        },
        repositories: [],
        taskId: null,
        recipe,
      };
    }

    // Connected, but none could be told to hold the code: the person picks.
    const askable: Array<LocatableRepository> =
      await TraceInsightFix.getAskableRepositories(data);

    if (askable.length === 0) {
      return NO_TELEMETRY_AI_FIX_SUGGESTION;
    }

    return {
      offer: SuggestionOffer.Act,
      blocker: null,
      repository: null,
      repositories: askable.map(TraceInsightFix.toRepository),
      taskId: null,
      recipe,
    };
  }

  // A readiness check about the repository, which the strip asks itself.
  private static isRepositoryCheck(check: AIFixReadinessCheck): boolean {
    return (
      check.id === "repositoryResolved" || check.id === "repositoryConnected"
    );
  }

  private static async getStackTraceSuggestion(data: {
    projectId: ObjectID;
    insightId: ObjectID;
    props: DatabaseCommonInteractionProps;
    insight: AIInsight;
  }): Promise<TelemetryAiFixSuggestion> {
    if (!ExceptionInsightFix.getStackTraceEvidence(data.insight)) {
      return NO_TELEMETRY_AI_FIX_SUGGESTION;
    }

    const askable: Array<LocatableRepository> =
      await TraceInsightFix.getAskableRepositories(data);

    if (askable.length === 0) {
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

    const resolvedId: string | null =
      await ExceptionInsightFix.resolveServiceRepository({
        projectId: data.projectId,
        serviceName: data.insight.serviceName || null,
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
      repository: resolved ? TraceInsightFix.toRepository(resolved) : null,
      repositories: resolved ? [] : askable.map(TraceInsightFix.toRepository),
      taskId: null,
      recipe: CodeFixTaskType.CodeRequest,
    };
  }

  /*
   * Start the fix a person asked for on an exception finding, under their
   * own permissions. Every gate of getSuggestion is checked again; each
   * refusal says which.
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

    const insight: AIInsight | null =
      await ExceptionInsightFix.readInsight(data);
    const kind: ExceptionInsightKind | null = getExceptionInsightKind(
      insight?.insightType,
    );

    if (!insight || !insight.id || !kind) {
      throw new BadDataException(EXCEPTION_FIX_INSIGHT_NOT_FOUND_MESSAGE);
    }

    if (
      !insight.status ||
      AIInsightStatusHelper.isTerminalStatus(insight.status)
    ) {
      throw new BadDataException(EXCEPTION_FIX_INSIGHT_CLOSED_MESSAGE);
    }

    if (insight.fixAiRunId) {
      throw new BadDataException(EXCEPTION_FIX_INSIGHT_HAS_FIX_MESSAGE);
    }

    if (
      await TelemetryAiFix.findActiveTaskIdForInsight({
        projectId: data.projectId,
        insightId: insight.id,
      })
    ) {
      throw new BadDataException(EXCEPTION_FIX_ALREADY_RUNNING_MESSAGE);
    }

    const askable: Array<LocatableRepository> =
      await TraceInsightFix.getAskableRepositories(data);

    let pickedRepositoryId: ObjectID | undefined = undefined;

    if (data.repositoryId) {
      const picked: string = data.repositoryId.toString().toLowerCase();

      if (
        !askable.some((repository: LocatableRepository): boolean => {
          return repository.id.toLowerCase() === picked;
        })
      ) {
        throw new BadDataException(
          EXCEPTION_FIX_REPOSITORY_NOT_AVAILABLE_MESSAGE,
        );
      }

      pickedRepositoryId = new ObjectID(picked);
    }

    const run: AIRun =
      kind === ExceptionInsightKind.MissingStackTrace
        ? await ExceptionInsightFix.createStackTraceTask({
            ...data,
            insight,
            askable,
            pickedRepositoryId,
          })
        : await ExceptionInsightFix.createExceptionTask({
            ...data,
            insight,
            pickedRepositoryId,
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

  // A person's fix of a new or rising exception: its own AI task.
  private static async createExceptionTask(data: {
    projectId: ObjectID;
    userId: ObjectID;
    props: DatabaseCommonInteractionProps;
    insight: AIInsight;
    pickedRepositoryId: ObjectID | undefined;
  }): Promise<AIRun> {
    const exceptionId: ObjectID | undefined =
      data.insight.telemetryExceptionId || undefined;

    if (!exceptionId) {
      throw new BadDataException(EXCEPTION_FIX_INSIGHT_NOT_FOUND_MESSAGE);
    }

    const exception: TelemetryException | null =
      await ExceptionInsightFix.readException({
        projectId: data.projectId,
        telemetryExceptionId: exceptionId,
        props: data.props,
      });

    if (!exception) {
      throw new BadDataException(EXCEPTION_FIX_INSIGHT_NOT_FOUND_MESSAGE);
    }

    if (exception.isResolved || exception.isArchived) {
      throw new BadDataException(EXCEPTION_FIX_EXCEPTION_CLOSED_MESSAGE);
    }

    /*
     * The exception page's own path, as the person: it reads the exception
     * under their permissions again, and checks the readiness, the day's
     * fix budget and the tasks already on their way. A person's ask clears
     * a pull request a person closed before.
     */
    return await TelemetryExceptionService.createCodeFixRunForException({
      telemetryExceptionId: exceptionId,
      props: { ...data.props, userId: data.userId },
      taskType:
        EXCEPTION_FIX_TASK_TYPE_BY_KIND[
          getPersonExceptionFixKind(data.insight.classification)
        ],
      triggeredByAiInsightId: data.insight.id!,
      ...(data.pickedRepositoryId
        ? { codeRepositoryId: data.pickedRepositoryId }
        : {}),
    });
  }

  // A person's fix of a service's missing stack traces: a request in Code.
  private static async createStackTraceTask(data: {
    projectId: ObjectID;
    userId: ObjectID;
    props: DatabaseCommonInteractionProps;
    insight: AIInsight;
    askable: Array<LocatableRepository>;
    pickedRepositoryId: ObjectID | undefined;
  }): Promise<AIRun> {
    const evidence: ExceptionStackTraceInsightEvidence | null =
      ExceptionInsightFix.getStackTraceEvidence(data.insight);

    if (!evidence) {
      throw new BadDataException(EXCEPTION_FIX_INSIGHT_NOT_FOUND_MESSAGE);
    }

    let repositoryId: string | null =
      data.pickedRepositoryId?.toString().toLowerCase() || null;

    if (!repositoryId && data.askable.length > 0) {
      repositoryId = await ExceptionInsightFix.resolveServiceRepository({
        projectId: data.projectId,
        serviceName: data.insight.serviceName || null,
        allowance: {
          isEveryRepository: false,
          repositoryIds: data.askable.map(
            (repository: LocatableRepository): string => {
              return repository.id.toLowerCase();
            },
          ),
        },
      });
    }

    if (!repositoryId) {
      throw new BadDataException(
        data.askable.length > 0
          ? EXCEPTION_FIX_PICK_REPOSITORY_MESSAGE
          : EXCEPTION_FIX_REPOSITORY_NOT_AVAILABLE_MESSAGE,
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
      throw new BadDataException(EXCEPTION_FIX_REPOSITORY_NOT_AVAILABLE_MESSAGE);
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

    return await CodeTaskRuns.start({
      projectId: data.projectId,
      userId: data.userId,
      repository,
      message: buildExceptionStackTraceRequestMessage({
        evidence,
        serviceName: data.insight.serviceName || "",
        isStartedByOneUptime: false,
      }),
      context: await ExceptionInsightFix.buildStackTraceContext({
        projectId: data.projectId,
        props: data.props,
        evidence,
      }),
      triggeredByAiInsightId: data.insight.id!,
    });
  }
}
