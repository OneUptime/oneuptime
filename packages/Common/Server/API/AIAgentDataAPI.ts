import TelemetryExceptionService from "../Services/TelemetryExceptionService";
import ServiceService from "../Services/ServiceService";
import CodeRepositoryService from "../Services/CodeRepositoryService";
import { RepoResolution } from "../Utils/CodeRepository/StackTraceRepoResolver";
import AIRunService from "../Services/AIRunService";
import IncidentService from "../Services/IncidentService";
import AlertService from "../Services/AlertService";
import PostedRootCause from "../Utils/AI/SRE/PostedRootCause";
import ExceptionFixStartedBy, {
  ExceptionFixStartedByJSON,
} from "../Utils/AI/CodeFix/ExceptionFixStartedBy";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import CodeFixAgentAuth, {
  CODE_FIX_RUN_HOLD_SELECT,
  CodeFixAgentIdentity,
  CodeFixRunAccess,
} from "../Utils/AI/CodeFix/CodeFixAgentAuth";
import CodeFixPullRequestRecord, {
  OpenedPullRequestFields,
  RecordedPullRequest,
} from "../Utils/AI/CodeFix/CodeFixPullRequestRecord";
import TelemetryException from "../../Models/DatabaseModels/TelemetryException";
import Service from "../../Models/DatabaseModels/Service";
import CodeRepository from "../../Models/DatabaseModels/CodeRepository";
import AIRun from "../../Models/DatabaseModels/AIRun";
import Incident from "../../Models/DatabaseModels/Incident";
import Alert from "../../Models/DatabaseModels/Alert";
import AIRunStatus from "../../Types/AI/AIRunStatus";
import AIRunType from "../../Types/AI/AIRunType";
import CodeFixTaskType, {
  CodeFixContextKind,
  CodeFixTaskTypeHelper,
} from "../../Types/AI/CodeFixTaskType";
import CodeFixTaskContext, {
  getInfrastructureFixFolder,
  getInfrastructureFixTaskContext,
  getInvestigationCodeFixTaskSnapshot,
  ImplicatedSpan,
  InfrastructureFixTaskContext,
  InvestigationCodeFixTaskSnapshot,
  PerformanceFinding,
} from "../../Types/AI/CodeFixTaskContext";
import SpanTreeAnalyzer from "../../Utils/Traces/SpanTreeAnalyzer";
import {
  sanitizeExceptionMessage,
  sanitizeStackTrace,
} from "../Utils/Telemetry/ExceptionSanitizer";
import ToolResultSerializer from "../Utils/AI/Toolbox/Serializer";
import OpenPullRequestCap, {
  OpenPullRequestCapDecision,
} from "../Utils/AI/CodeFix/OpenPullRequestCap";
import CodeFixAgentCompletion, {
  AgentCompletionResult,
} from "../Utils/AI/CodeFix/CodeFixAgentCompletion";
import {
  LLMMessage,
  LLMToolCall,
  LLMToolDefinition,
} from "../Utils/LLM/LLMService";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import GitHubUtil, {
  GitHubInstallationToken,
} from "../Utils/CodeRepository/GitHub/GitHub";
import GitHubInstallationBinding from "../Utils/CodeRepository/GitHub/GitHubInstallationBinding";
import CodeRepositoryType from "../../Types/CodeRepository/CodeRepositoryType";
import {
  CodeHost,
  RUNNER_SUPPORTED_CODE_HOSTS_FIELD,
} from "../../Types/CodeRepository/CodeHost";
import CodeHostRunnerToken, {
  CodeHostRunnerDecision,
  CodeHostRunnerGrant,
} from "../Utils/CodeRepository/CodeHost/CodeHostRunnerToken";
import logger, { getLogAttributesFromRequest } from "../Utils/Logger";
import QueryHelper from "../Types/Database/QueryHelper";
import CodeTaskThread from "../Utils/AI/CodeTask/CodeTaskThread";
import CodeRepositoryRunnerChoice, {
  getCodeRepositoryRunnerFactsRow,
} from "../Utils/AI/CodeFix/CodeRepositoryRunnerChoice";
import {
  getFirstMonitorName,
  getPerformanceStackTrace,
  getRunRepositoryAllowance,
} from "../Utils/AI/CodeFix/CodeFixRunRepository";
import { CODE_REPOSITORY_RUNNER_TOKEN_REFUSAL } from "../../Types/Runner/CodeRepositoryRunner";
import RunnerCodeFixCapability, {
  RunnerCodeFixCapabilityUtil,
  SERVER_OPENS_PULL_REQUEST_FIELD,
  SUBJECT_IS_PRIVATE_FIELD,
} from "../../Types/Runner/RunnerCodeFixCapability";
import CodeFixPullRequestOpener, {
  FixPullRequestRequest,
  OpenedFixPullRequest,
} from "../Utils/AI/CodeFix/CodeFixPullRequestOpener";
import AIAgentTaskPullRequest from "../../Models/DatabaseModels/AIAgentTaskPullRequest";
import { CODE_HOST_REPOSITORY_SELECT } from "../Utils/CodeRepository/CodeHost/CodeHostAccess";

/*
 * Why a Runner older than KeepsPrivateRecordsOutOfPullRequests is not handed
 * a private incident's or alert's fix (#9165): the run fails with this, in
 * its log and on the incident's or alert's AI card.
 */
export function getPrivateSubjectNeedsNewerRunnerMessage(
  subjectType: "incident" | "alert",
): string {
  return `This ${subjectType} is private, and this Runner would write its title and the investigation's analysis into the pull request, which everyone with access to the repository can read. Update the Runner to the latest version, then ask for the fix again.`;
}

/*
 * What a GitHub repository's token handed to a Runner may do
 * (AIAgentDataAPI.getGitHubRunnerTokenScope), and whether OneUptime opens
 * the run's pull request.
 */
export interface GitHubRunnerTokenScope {
  permissions: {
    contents: "read" | "write";
    pull_requests?: "write";
    metadata: "read";
  };
  serverOpensPullRequest: boolean;
}

export default class AIAgentDataAPI {
  public router!: ExpressRouter;

  public constructor() {
    this.router = Express.getRouter();
    this.initRoutes();
  }

  public getRouter(): ExpressRouter {
    return this.router;
  }

  /*
   * The run a repository-token request names, when it is a code-fix run of
   * the repository's project the agent may act on - otherwise null. Every
   * worker acts only for the run it claimed and still holds
   * (CodeFixAgentAuth.deniesAccessToRun), so this is the run it is working
   * on, or null - and the route then refuses the token.
   *
   * `taskId` names a task; it does not assert anything about it, and a task
   * in another project answers null exactly as a missing one does. A request
   * that names no run is not asked here: the route looks for a run the
   * worker holds in the repository's project instead (holdsRunOfProject).
   */
  private static async findTokenRun(data: {
    aiAgent: CodeFixAgentIdentity;
    runId: ObjectID;
    projectId: ObjectID | undefined;
  }): Promise<AIRun | null> {
    if (!data.projectId) {
      return null;
    }

    const run: AIRun | null = await AIRunService.findOneById({
      id: data.runId,
      select: {
        ...CODE_FIX_RUN_HOLD_SELECT,
        runType: true,
        codeFixTaskType: true,
        codeRepositoryId: true,
        codeTaskId: true,
      },
      props: { isRoot: true },
    });

    if (
      !run ||
      !run.projectId ||
      run.runType !== AIRunType.CodeFix ||
      run.projectId.toString() !== data.projectId.toString() ||
      CodeFixAgentAuth.deniesAccessToRun(
        data.aiAgent,
        run,
        CodeFixRunAccess.Work,
      )
    ) {
      return null;
    }

    return run;
  }

  /*
   * Whether a request from a worker that names no run (an older Runner, or
   * an AI agent a project created before 12.0) may be told what it asks:
   * a project's own worker that holds a code-fix run of the project now -
   * one it claimed (its id on the run) that is still Running - matching
   * what it asks about. That run is what it is working on: the server finds
   * it rather than being told, so such a worker keeps working, and a key
   * whose worker holds nothing is told nothing. A global Runner always
   * names its run, so it is never served this way.
   */
  private static async holdsRunOfProject(data: {
    aiAgent: CodeFixAgentIdentity;
    projectId: ObjectID | undefined;
    // What the held run must also be: a fix of this exception.
    exceptionId?: ObjectID | undefined;
    // ...or a run in this repository, or one that has not found its own yet.
    codeRepositoryId?: ObjectID | undefined;
  }): Promise<boolean> {
    /*
     * The project is the exception's or the repository's, which the route
     * has already held to the worker's own (deniesAccessToProject), and a
     * project's worker claims runs of its own project alone.
     */
    if (CodeFixAgentAuth.isGlobalIdentity(data.aiAgent) || !data.projectId) {
      return false;
    }

    const run: AIRun | null = await AIRunService.findOneBy({
      query: {
        projectId: data.projectId,
        runType: AIRunType.CodeFix,
        status: AIRunStatus.Running,
        aiAgentId: data.aiAgent.id,
        ...(data.exceptionId
          ? { triggeredByTelemetryExceptionId: data.exceptionId }
          : {}),
        ...(data.codeRepositoryId
          ? {
              codeRepositoryId: QueryHelper.equalToOrNull(
                data.codeRepositoryId,
              ),
            }
          : {}),
      },
      select: { _id: true },
      props: { isRoot: true },
    });

    return Boolean(run);
  }

  /*
   * The run a request names (its taskId), when that is a run id at all;
   * null for a request that names none, or names something that is not one.
   */
  public static getNamedRunId(taskId: unknown): ObjectID | null {
    return typeof taskId === "string" && ObjectID.isValidUUID(taskId)
      ? new ObjectID(taskId)
      : null;
  }

  /*
   * Whether a worker is refused a route that names an exception (its
   * details, the repository its code lives in): it reads only the exception
   * of a run it holds (CodeFixAgentAuth.deniesAccessToRun). A request that
   * names its run (taskId) - every Runner since global Runners took code
   * fixes sends it - must name a code fix of this exception that it holds.
   * One that names none is served while the worker holds a code fix of this
   * exception (holdsRunOfProject); a global Runner always names its run, so
   * it is refused. The route's project check comes first, so the exception
   * is the worker's project's.
   */
  private static async deniesAccessToException(data: {
    aiAgent: CodeFixAgentIdentity;
    taskId: unknown;
    exceptionId: ObjectID;
    projectId: ObjectID | undefined;
  }): Promise<boolean> {
    const namedRunId: ObjectID | null = AIAgentDataAPI.getNamedRunId(
      data.taskId,
    );

    if (!namedRunId) {
      return !(await AIAgentDataAPI.holdsRunOfProject({
        aiAgent: data.aiAgent,
        projectId: data.projectId,
        exceptionId: data.exceptionId,
      }));
    }

    const run: AIRun | null = await AIRunService.findOneById({
      id: namedRunId,
      select: {
        ...CODE_FIX_RUN_HOLD_SELECT,
        runType: true,
        triggeredByTelemetryExceptionId: true,
      },
      props: { isRoot: true },
    });

    return (
      !run ||
      run.runType !== AIRunType.CodeFix ||
      !run.triggeredByTelemetryExceptionId ||
      run.triggeredByTelemetryExceptionId.toString() !==
        data.exceptionId.toString() ||
      CodeFixAgentAuth.deniesAccessToRun(
        data.aiAgent,
        run,
        CodeFixRunAccess.Work,
      )
    );
  }

  /*
   * Whether the run is exempt from the per-repository open-PR cap. Derived
   * from the run, never from the request.
   *
   * Exempt: work that cannot ADD to the review queue - a GitHub revision
   * (pushes to a pull request already open and counted), a review (writes
   * nothing), and a request from Code whose task already has an open pull
   * request in this repository, which the turn pushes to (see
   * CodeTaskThread.getWorkingPullRequest).
   */
  private static async isCapExempt(data: {
    run: AIRun | null;
    codeRepositoryId: ObjectID;
  }): Promise<boolean> {
    if (!data.run || !data.run.projectId) {
      return false;
    }

    const taskType: CodeFixTaskType = CodeFixTaskTypeHelper.fromDatabaseValue(
      data.run.codeFixTaskType,
    );

    if (!CodeFixTaskTypeHelper.opensNewPullRequest(taskType)) {
      return true;
    }

    if (
      !CodeFixTaskTypeHelper.isCodeRequest(taskType) ||
      data.run.codeRepositoryId?.toString() !== data.codeRepositoryId.toString()
    ) {
      return false;
    }

    const task: AIRun | null = await CodeTaskThread.findTask({
      projectId: data.run.projectId,
      taskId: data.run.codeTaskId || data.run.id!,
      select: { _id: true, codeRepositoryId: true, codeTaskId: true },
    });

    if (!task) {
      return false;
    }

    return Boolean(
      await CodeTaskThread.findWorkingPullRequest({
        projectId: data.run.projectId,
        task: task,
      }),
    );
  }

  /*
   * What a GitHub repository's token for a Runner may do - for the one
   * repository it is minted for (GitHubUtil.getRepositoryAccessToken), and
   * never more than the run needs:
   *
   *   - a review (GitHubPullRequestReview) changes nothing: it clones the
   *     repository and posts its review through OneUptime, so it reads;
   *   - a Runner that has OneUptime open its pull requests
   *     (RunnerCodeFixCapability.ServerOpensPullRequests) pushes its branch
   *     and nothing more: no pull_requests (issue #8916);
   *   - an older Runner opens its pull request with the token, as it always
   *     did: contents and pull_requests.
   *
   * metadata: read for every one: GitHub requires it of an installation
   * token.
   */
  public static getGitHubRunnerTokenScope(data: {
    run: AIRun | null;
    capabilities: ReadonlyArray<RunnerCodeFixCapability>;
  }): GitHubRunnerTokenScope {
    if (
      data.run &&
      CodeFixTaskTypeHelper.fromDatabaseValue(data.run.codeFixTaskType) ===
        CodeFixTaskType.GitHubPullRequestReview
    ) {
      return {
        permissions: { contents: "read", metadata: "read" },
        serverOpensPullRequest: false,
      };
    }

    if (
      RunnerCodeFixCapabilityUtil.has(
        data.capabilities,
        RunnerCodeFixCapability.ServerOpensPullRequests,
      )
    ) {
      return {
        permissions: { contents: "write", metadata: "read" },
        serverOpensPullRequest: true,
      };
    }

    return {
      permissions: {
        contents: "write",
        pull_requests: "write",
        metadata: "read",
      },
      serverOpensPullRequest: false,
    };
  }

  /*
   * A run that is handed a token for a repository works in it: a recipe
   * that finds its repository as it goes (an exception fix, a fix from an
   * investigation) is linked to it here, so it appears on that repository's
   * page in Code even if it never opens a pull request. Only a run with no
   * repository yet is linked.
   */
  private static async linkRunToRepository(data: {
    run: AIRun | null;
    codeRepositoryId: ObjectID;
  }): Promise<void> {
    if (!data.run || data.run.codeRepositoryId || !data.run.id) {
      return;
    }

    try {
      await AIRunService.updateOneBy({
        query: {
          _id: data.run.id.toString(),
          codeRepositoryId: QueryHelper.isNull(),
        },
        data: { codeRepositoryId: data.codeRepositoryId } as never,
        props: { isRoot: true },
      });
    } catch (error) {
      // A display link: never fail the token over it.
      logger.error(
        `Could not link run ${data.run.id.toString()} to repository ${data.codeRepositoryId.toString()}: ${error}`,
      );
    }
  }

  private initRoutes(): void {
    /*
     * Server-mediated LLM completion for the in-house code-fix agent (B4
     * Tier 0, Docs/Internal/Roadmap/CodeFixSandboxDesign.md). One call = one
     * completion of the worker's tool loop, executed through
     * AIService.executeWithLogging: metered, LlmLog-linked to the run,
     * inside the project's daily limits, and held server-side to the run's
     * own limits - the project's model calls and tokens per run, when it set
     * them, and the run's time limit (CodeFixAgentCompletion). The worker
     * never receives a provider secret on this path.
     *
     * Request:  { aiAgentId, aiAgentKey, taskId, messages, tools?, maxTokens? }
     * Response: { message: { role: "assistant", content, toolCalls },
     *             stopReason: "stop" | "tool_use",
     *             limits: { maxModelCalls, maxToolCalls, maxTokens,
     *                       timeLimitInMinutes, timeLimitSource, deadlineAt,
     *                       modelCallsUsed, toolCallsUsed, tokensUsed },
     *             budget: { completionCallsUsed, maxCompletionCalls,
     *                       outputTokensUsed, maxOutputTokens,
     *                       toolCallsUsed, maxToolCalls },
     *             contextWindowTokens: number | null }
     *
     * `budget` is what a Runner from before #6440 winds down on
     * (CodeFixAgentCompletion.buildLegacyBudget); a current one reads
     * `limits`. `contextWindowTokens` is how many tokens one request to the
     * model may hold (issue #6530), null when the server cannot tell: the
     * Runner sizes its conversation to it, and an older one ignores it.
     */
    this.router.post(
      "/ai-agent-data/llm-completion",
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const data: JSONObject = req.body;

          /*
           * Validate agent credentials (AIAgent fleet or a Runner). A request
           * that proves none is answered there: 400, or 429 for a client
           * that sent too many different wrong keys for that agent.
           */
          const aiAgent: CodeFixAgentIdentity | null =
            await CodeFixAgentAuth.authenticate(req, res);

          if (!aiAgent) {
            return;
          }

          if (!data["taskId"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("taskId is required"),
            );
          }

          const taskId: ObjectID = new ObjectID(data["taskId"] as string);

          /*
           * A project-scoped Runner may only spend a run of its own project,
           * and a global Runner only the run it holds (deniesAccessToRun;
           * CodeFixAgentCompletion holds every worker to the run it claimed
           * too). Without this, one tenant's Runner key could burn another
           * tenant's LLM budget and read back the completions.
           */
          const completionRun: AIRun | null = await AIRunService.findOneById({
            id: taskId,
            select: CODE_FIX_RUN_HOLD_SELECT,
            props: {
              isRoot: true,
            },
          });

          if (
            !completionRun ||
            CodeFixAgentAuth.deniesAccessToRun(
              aiAgent,
              completionRun,
              CodeFixRunAccess.Work,
            )
          ) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Task not found"),
            );
          }

          const messages: Array<LLMMessage> = this.parseCompletionMessages(
            data["messages"],
          );
          /*
           * The tools the model is offered: what the worker sent, never the
           * code agent's command tool on a global Runner, which runs no
           * command a model composes (CodeFixAgentAuth.getOfferedTools).
           */
          const tools: Array<LLMToolDefinition> | undefined =
            CodeFixAgentAuth.getOfferedTools(
              aiAgent,
              this.parseCompletionTools(data["tools"]),
            );
          const maxTokens: number | undefined =
            typeof data["maxTokens"] === "number" && data["maxTokens"] > 0
              ? data["maxTokens"]
              : undefined;

          const result: AgentCompletionResult =
            await CodeFixAgentCompletion.execute({
              aiAgentId: aiAgent.id,
              aiRunId: taskId,
              messages,
              tools,
              maxTokens,
            });

          return Response.sendJsonObjectResponse(req, res, {
            message: {
              role: "assistant",
              content: result.content,
              toolCalls: result.toolCalls,
            },
            stopReason: result.stopReason,
            limits: result.limits,
            budget: result.budget,
            contextWindowTokens: result.contextWindowTokens,
          } as unknown as JSONObject);
        } catch (err) {
          next(err);
        }
      },
    );

    // Get exception details with telemetry service info
    this.router.post(
      "/ai-agent-data/get-exception-details",
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const data: JSONObject = req.body;

          /*
           * Validate agent credentials (AIAgent fleet or a Runner). A request
           * that proves none is answered there: 400, or 429 for a client
           * that sent too many different wrong keys for that agent.
           */
          const aiAgent: CodeFixAgentIdentity | null =
            await CodeFixAgentAuth.authenticate(req, res);

          if (!aiAgent) {
            return;
          }

          // Get exception ID
          if (!data["exceptionId"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("exceptionId is required"),
            );
          }

          const exceptionId: ObjectID = new ObjectID(
            data["exceptionId"] as string,
          );

          // Get exception with service
          const exception: TelemetryException | null =
            await TelemetryExceptionService.findOneById({
              id: exceptionId,
              select: {
                _id: true,
                projectId: true,
                message: true,
                stackTrace: true,
                exceptionType: true,
                fingerprint: true,
                aiClassification: true,
                primaryEntityId: true,
                primaryEntityType: true,
              },
              props: {
                isRoot: true,
              },
            });

          /*
           * A project-scoped Runner only sees its own project's exceptions,
           * and every worker only the exception of a run it holds — this
           * response carries stack traces and messages.
           */
          if (
            !exception ||
            CodeFixAgentAuth.deniesAccessToProject(
              aiAgent,
              exception.projectId,
            ) ||
            (await AIAgentDataAPI.deniesAccessToException({
              aiAgent,
              taskId: data["taskId"],
              exceptionId,
              projectId: exception.projectId,
            }))
          ) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Exception not found"),
            );
          }

          logger.debug(
            `Exception details fetched: ${exception._id}`,
            getLogAttributesFromRequest(req as any),
          );

          /*
           * Why the task the Runner claimed was started, for its pull request
           * to say (ExceptionFixStartedBy): only for that task, a code fix of
           * this exception. Older Runners send no taskId, and older pull
           * requests say nothing of it.
           */
          const taskIdValue: unknown = data["taskId"];
          const startedBy: ExceptionFixStartedByJSON | null =
            typeof taskIdValue === "string" &&
            ObjectID.isValidUUID(taskIdValue) &&
            exception.projectId &&
            exception.id
              ? await ExceptionFixStartedBy.read({
                  taskId: new ObjectID(taskIdValue),
                  exceptionId: exception.id,
                  projectId: exception.projectId,
                })
              : null;

          /*
           * primaryEntityId is polymorphic — resolve the Service only when it is
           * a real Service. findOneById returns null for Host / DockerHost /
           * KubernetesCluster / unattributed serviceIds (they aren't
           * Services), preserving the previous "name only for real
           * services" behaviour without the dropped ORM relation.
           */
          const exceptionService: Service | null = exception.primaryEntityId
            ? await ServiceService.findOneById({
                id: exception.primaryEntityId,
                select: {
                  name: true,
                  description: true,
                },
                props: {
                  isRoot: true,
                },
              })
            : null;

          /*
           * Sanitize at the choke point: everything the AI agent worker
           * sees — and therefore everything that can end up in an LLM
           * prompt, a public pull-request title/body, or a commit
           * message — flows through this response. The message gets
           * dynamic-token normalization + secret redaction; the stack
           * trace gets redaction only, so file:line frames stay intact
           * for the code agent.
           */
          return Response.sendJsonObjectResponse(req, res, {
            exception: {
              id: exception._id?.toString(),
              message: sanitizeExceptionMessage(exception.message || ""),
              stackTrace: sanitizeStackTrace(exception.stackTrace || ""),
              // Legacy pre-batch-upsert rows can carry NULL here.
              exceptionType: exception.exceptionType || "",
              fingerprint: exception.fingerprint,
              aiClassification: exception.aiClassification || null,
              ...(exception.projectId && exception.id
                ? {
                    url: ExceptionFixStartedBy.getExceptionUrl({
                      projectId: exception.projectId,
                      exceptionId: exception.id,
                    }),
                  }
                : {}),
            },
            service: exception.primaryEntityId
              ? {
                  id: exception.primaryEntityId.toString(),
                  name: exceptionService?.name,
                  description: exceptionService?.description,
                }
              : null,
            startedBy: startedBy as unknown as JSONObject | null,
          });
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Resolve the repository the exception's code lives in — AT RUNTIME
     * (stack-trace path matching over the project's connected repos, with
     * name-match and only-repository fallbacks). Replaces the old
     * ServiceCodeRepository mapping-table lookup; the response keeps the
     * `repositories` array shape the agent already consumes.
     */
    this.router.post(
      "/ai-agent-data/get-code-repositories",
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const data: JSONObject = req.body;

          /*
           * Validate agent credentials (AIAgent fleet or a Runner). A request
           * that proves none is answered there: 400, or 429 for a client
           * that sent too many different wrong keys for that agent.
           */
          const aiAgent: CodeFixAgentIdentity | null =
            await CodeFixAgentAuth.authenticate(req, res);

          if (!aiAgent) {
            return;
          }

          if (!data["exceptionId"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "exceptionId is required (agents older than the runtime-resolution change must be upgraded)",
              ),
            );
          }

          const exceptionId: ObjectID = new ObjectID(
            data["exceptionId"] as string,
          );

          const exception: TelemetryException | null =
            await TelemetryExceptionService.findOneById({
              id: exceptionId,
              select: {
                _id: true,
                projectId: true,
                stackTrace: true,
                primaryEntityId: true,
              },
              props: {
                isRoot: true,
              },
            });

          /*
           * A project-scoped Runner resolves only its own project's
           * exceptions, and every worker only the exception of a run it
           * holds (the run it names, taskId, or - from a worker that names
           * none - one it holds of this exception).
           */
          if (
            !exception ||
            !exception.projectId ||
            CodeFixAgentAuth.deniesAccessToProject(
              aiAgent,
              exception.projectId,
            ) ||
            (await AIAgentDataAPI.deniesAccessToException({
              aiAgent,
              taskId: data["taskId"],
              exceptionId,
              projectId: exception.projectId,
            }))
          ) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Exception not found"),
            );
          }

          // Service name feeds the name-match fallback when there is one.
          const service: Service | null = exception.primaryEntityId
            ? await ServiceService.findOneById({
                id: exception.primaryEntityId,
                select: {
                  name: true,
                },
                props: {
                  isRoot: true,
                },
              })
            : null;

          const resolution: RepoResolution | null =
            await CodeRepositoryService.resolveRepositoryForException({
              projectId: exception.projectId,
              stackTrace: exception.stackTrace || null,
              serviceName: service?.name || null,
            });

          if (!resolution) {
            logger.debug(
              `No repository resolved for exception ${exceptionId.toString()}`,
              getLogAttributesFromRequest(req as any),
            );

            return Response.sendJsonObjectResponse(req, res, {
              repositories: [],
              resolutionError:
                "Could not resolve a repository for this exception: no connected repository contains the files in its stack trace, no repository name matches the service, and the project has more than one repository. Connect the right repository in Code.",
            });
          }

          const repository: CodeRepository | null =
            await CodeRepositoryService.findOneById({
              id: new ObjectID(resolution.codeRepositoryId),
              select: {
                _id: true,
                name: true,
                repositoryHostedAt: true,
                organizationName: true,
                repositoryName: true,
                mainBranchName: true,
                setupCommand: true,
                buildCommand: true,
                testCommand: true,
                gitHubAppInstallationId: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!repository) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Resolved repository no longer exists"),
            );
          }

          logger.debug(
            `Resolved repository ${resolution.organizationName}/${resolution.repositoryName} for exception ${exceptionId.toString()} via ${resolution.method}: ${resolution.evidence}`,
            getLogAttributesFromRequest(req as any),
          );

          return Response.sendJsonObjectResponse(req, res, {
            repositories: [
              {
                id: repository.id!.toString(),
                name: repository.name || "",
                repositoryHostedAt: repository.repositoryHostedAt || "",
                organizationName: repository.organizationName || "",
                repositoryName: repository.repositoryName || "",
                mainBranchName: repository.mainBranchName || "main",
                // None for a global Runner, which runs no repository command.
                ...CodeFixAgentAuth.getRepositoryCommands(aiAgent, repository),
                servicePathInRepository: resolution.servicePathInRepository,
                gitHubAppInstallationId:
                  repository.gitHubAppInstallationId || null,
                resolutionMethod: resolution.method,
                resolutionEvidence: resolution.evidence,
              },
            ],
          });
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Context for every non-exception recipe, keyed by the run id `taskId`
     * (the id get-pending-task returned) — these runs have NO telemetry
     * exception, so the exception-shaped endpoints above cannot serve them.
     * The route name predates the newer recipes and is kept for agent
     * compatibility. Two context kinds are served:
     *
     *  - Incident/alert-subject recipes: subject metadata + the repository
     *    resolved without a stack trace. ImproveInstrumentation reads the
     *    subject's latest RootCause feed item. FixFromIncident instead reads
     *    the immutable investigation snapshot captured in AIRun.taskContext;
     *    a later re-investigation must never replace the Recommended analysis
     *    that authorized a code-fix task.
     *
     *  - Trace-evidence recipes (FixPerformance): the deterministic
     *    span-tree findings stored on AIRun.taskContext at trigger time
     *    (subjectType "trace"; the rendered evidence rides in
     *    analysisMarkdown so the worker pipeline stays shared). Repository
     *    resolution here TRIES the stack-trace path matcher first, fed by a
     *    synthetic trace built from the implicated spans' code.*
     *    attributes, before the name-match / only-repository fallbacks.
     */
    this.router.post(
      "/ai-agent-data/get-instrumentation-task-details",
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const data: JSONObject = req.body;

          /*
           * Validate agent credentials (AIAgent fleet or a Runner). A request
           * that proves none is answered there: 400, or 429 for a client
           * that sent too many different wrong keys for that agent.
           */
          const aiAgent: CodeFixAgentIdentity | null =
            await CodeFixAgentAuth.authenticate(req, res);

          if (!aiAgent) {
            return;
          }

          if (!data["taskId"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("taskId is required"),
            );
          }

          const taskId: ObjectID = new ObjectID(data["taskId"] as string);

          const run: AIRun | null = await AIRunService.findOneById({
            id: taskId,
            select: {
              ...CODE_FIX_RUN_HOLD_SELECT,
              runType: true,
              codeFixTaskType: true,
              triggeredByIncidentId: true,
              triggeredByAlertId: true,
              taskContext: true,
            },
            props: {
              isRoot: true,
            },
          });

          // A global Runner is served only the run it holds (deniesAccessToRun).
          if (
            !run ||
            !run.projectId ||
            CodeFixAgentAuth.deniesAccessToRun(
              aiAgent,
              run,
              CodeFixRunAccess.Work,
            )
          ) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Task not found"),
            );
          }

          /*
           * Any non-exception recipe is served here — the same context-kind
           * grouping the claim guard uses.
           */
          const taskType: CodeFixTaskType =
            CodeFixTaskTypeHelper.fromDatabaseValue(run.codeFixTaskType);
          const contextKind: CodeFixContextKind =
            CodeFixTaskTypeHelper.getContextKind(taskType);
          const investigationSnapshot: InvestigationCodeFixTaskSnapshot | null =
            taskType === CodeFixTaskType.FixFromIncident
              ? getInvestigationCodeFixTaskSnapshot(run.taskContext)
              : null;

          if (
            run.runType !== AIRunType.CodeFix ||
            contextKind === CodeFixContextKind.TelemetryException
          ) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "Task is not an incident/alert-subject or trace-evidence code-fix run (ImproveInstrumentation, FixFromIncident or FixPerformance)",
              ),
            );
          }

          /*
           * FixFromIncident authorization covered one exact Recommended
           * investigation. Never substitute the subject's current RootCause:
           * a re-investigation may have posted a different, non-code analysis
           * while this task waited in the queue.
           */
          if (
            taskType === CodeFixTaskType.FixFromIncident &&
            !investigationSnapshot
          ) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "This fix-from-incident task has no complete pinned investigation analysis snapshot — it cannot be executed safely.",
              ),
            );
          }

          /*
           * Service-scoped instrumentation recipes (ImproveLogging /
           * ImproveTracing): the context is just the service — resolve the
           * repository by service name (no stack trace) and hand the
           * worker a short brief; the recipe's checklist lives in the
           * worker's prompt.
           */
          if (
            taskType === CodeFixTaskType.ImproveLogging ||
            taskType === CodeFixTaskType.ImproveTracing
          ) {
            const taskContext: CodeFixTaskContext | undefined = run.taskContext;
            const improvementServiceName: string =
              taskContext?.serviceName || "";

            if (!taskContext?.telemetryServiceId) {
              return Response.sendErrorResponse(
                req,
                res,
                new BadDataException(
                  "This telemetry-improvement task has no stored service context — the task has nothing to work from.",
                ),
              );
            }

            const pillar: string =
              taskType === CodeFixTaskType.ImproveLogging
                ? "logging"
                : "tracing";
            const subjectTitle: string = improvementServiceName
              ? `Improve ${pillar} for ${improvementServiceName}`
              : `Improve ${pillar}`;

            const resolution: RepoResolution | null =
              await CodeRepositoryService.resolveRepositoryForException({
                projectId: run.projectId,
                stackTrace: null,
                serviceName: improvementServiceName || null,
              });

            const repository: CodeRepository | null = resolution
              ? await CodeRepositoryService.findOneById({
                  id: new ObjectID(resolution.codeRepositoryId),
                  select: {
                    _id: true,
                    name: true,
                    repositoryHostedAt: true,
                    organizationName: true,
                    repositoryName: true,
                    mainBranchName: true,
                    setupCommand: true,
                    buildCommand: true,
                    testCommand: true,
                    gitHubAppInstallationId: true,
                  },
                  props: { isRoot: true },
                })
              : null;

            const basePayload: JSONObject = {
              subjectType: "service",
              subjectTitle,
              analysisMarkdown: `OneUptime observes the telemetry of the service ${
                improvementServiceName
                  ? `"${improvementServiceName}"`
                  : "in this repository"
              }. A user asked for its ${pillar} instrumentation to be improved — follow the task checklist in your instructions.`,
              serviceName: improvementServiceName,
              projectId: run.projectId.toString(),
            };

            if (!resolution || !repository) {
              return Response.sendJsonObjectResponse(req, res, {
                ...basePayload,
                repositories: [],
                resolutionError:
                  "Could not resolve a repository for this task: no connected repository name matches the service and the project has more than one repository. Connect the right repository via the GitHub App, or rename one to match the service.",
              });
            }

            return Response.sendJsonObjectResponse(req, res, {
              ...basePayload,
              repositories: [
                {
                  id: repository.id!.toString(),
                  name: repository.name || "",
                  repositoryHostedAt: repository.repositoryHostedAt || "",
                  organizationName: repository.organizationName || "",
                  repositoryName: repository.repositoryName || "",
                  mainBranchName: repository.mainBranchName || "main",
                  // None for a global Runner, which runs no repository command.
                  ...CodeFixAgentAuth.getRepositoryCommands(
                    aiAgent,
                    repository,
                  ),
                  servicePathInRepository: resolution.servicePathInRepository,
                  gitHubAppInstallationId:
                    repository.gitHubAppInstallationId || null,
                  resolutionMethod: resolution.method,
                  resolutionEvidence: resolution.evidence,
                },
              ],
            });
          }

          /*
           * The fix of a group of Data Security issues' cause, once
           * (FixInfrastructureCode, #10370): the request, the cause and the
           * stores it fixes were captured at trigger time, and it works in
           * the repository a person confirmed (the run's own), never one
           * resolved here. The files that declare the stores, when known,
           * are where the worker starts.
           */
          if (taskType === CodeFixTaskType.FixInfrastructureCode) {
            const fix: InfrastructureFixTaskContext | null =
              getInfrastructureFixTaskContext(
                run.taskContext?.infrastructureFix,
              );

            if (!fix) {
              return Response.sendErrorResponse(
                req,
                res,
                new BadDataException(
                  "This infrastructure fix has no stored request: the task has nothing to work from.",
                ),
              );
            }

            const repository: CodeRepository | null = run.codeRepositoryId
              ? await CodeRepositoryService.findOneBy({
                  query: {
                    _id: run.codeRepositoryId.toString(),
                    projectId: run.projectId,
                  },
                  select: {
                    _id: true,
                    name: true,
                    repositoryHostedAt: true,
                    organizationName: true,
                    repositoryName: true,
                    mainBranchName: true,
                    setupCommand: true,
                    buildCommand: true,
                    testCommand: true,
                    gitHubAppInstallationId: true,
                  },
                  props: { isRoot: true },
                })
              : null;
            const folder: string | null = getInfrastructureFixFolder(fix.paths);
            const basePayload: JSONObject = {
              subjectType: "infrastructure",
              subjectTitle: fix.title,
              // The request as Data Security's input builder wrote it: redacted there.
              analysisMarkdown: fix.request,
              serviceName: null,
              projectId: run.projectId.toString(),
              infrastructureFix: fix as unknown as JSONObject,
            };

            if (!repository) {
              return Response.sendJsonObjectResponse(req, res, {
                ...basePayload,
                repositories: [],
                resolutionError:
                  "The repository this fix was asked in is no longer connected to the project. Connect it again in Code, then ask for the fix again from the Issues list.",
              });
            }

            return Response.sendJsonObjectResponse(req, res, {
              ...basePayload,
              repositories: [
                {
                  id: repository.id!.toString(),
                  name: repository.name || "",
                  repositoryHostedAt: repository.repositoryHostedAt || "",
                  organizationName: repository.organizationName || "",
                  repositoryName: repository.repositoryName || "",
                  mainBranchName: repository.mainBranchName || "main",
                  // None for a global Runner, which runs no repository command.
                  ...CodeFixAgentAuth.getRepositoryCommands(
                    aiAgent,
                    repository,
                  ),
                  servicePathInRepository: folder,
                  gitHubAppInstallationId:
                    repository.gitHubAppInstallationId || null,
                  resolutionMethod: "only-repository",
                  resolutionEvidence: `The repository a person confirmed for the fix of ${fix.cause || "these issues"}.`,
                },
              ],
            });
          }

          /*
           * Trace-evidence recipes (FixPerformance): everything the worker
           * needs was captured into taskContext at trigger time — the spans
           * themselves may already be past ClickHouse retention.
           */
          if (contextKind === CodeFixContextKind.TaskContext) {
            const taskContext: CodeFixTaskContext | undefined = run.taskContext;
            const findings: Array<PerformanceFinding> =
              taskContext?.performanceFindings || [];

            if (!taskContext?.traceId || findings.length === 0) {
              return Response.sendErrorResponse(
                req,
                res,
                new BadDataException(
                  "This performance-fix task has no stored trace evidence — the task has nothing to work from.",
                ),
              );
            }

            // Deduped name+duration summary of every implicated span.
            const spanSummaries: Array<ImplicatedSpan> = [];
            const seenSpanIds: Set<string> = new Set();
            for (const finding of findings) {
              for (const implicated of finding.implicatedSpans) {
                if (!seenSpanIds.has(implicated.spanId)) {
                  seenSpanIds.add(implicated.spanId);
                  spanSummaries.push(implicated);
                }
              }
            }

            /*
             * Repository resolution: the implicated spans' code.*
             * attributes (when the instrumentation stamps them) become a
             * synthetic stack trace for the path matcher — each line is
             * shaped so extractCandidatePathsFromStackTrace parses it.
             * Without code attributes this degrades to the name-match /
             * only-repository fallbacks, exactly like the subject recipes.
             * The run was queued on the repository the same facts resolved
             * to then (CodeFixRunRepository), read with the same helper.
             */
            const syntheticStackTrace: string | null = getPerformanceStackTrace(
              taskContext.codeLocations,
            );

            const serviceName: string | null = taskContext.serviceName || null;

            /*
             * Among the repository the person picked when none was found
             * for certain, as when the run was queued
             * (getRunRepositoryAllowance); every connected one otherwise.
             */
            const resolution: RepoResolution | null =
              await CodeRepositoryService.resolveRepositoryForException({
                projectId: run.projectId,
                stackTrace: syntheticStackTrace,
                serviceName,
                allowance: getRunRepositoryAllowance(run.taskContext),
              });

            const repository: CodeRepository | null = resolution
              ? await CodeRepositoryService.findOneById({
                  id: new ObjectID(resolution.codeRepositoryId),
                  select: {
                    _id: true,
                    name: true,
                    repositoryHostedAt: true,
                    organizationName: true,
                    repositoryName: true,
                    mainBranchName: true,
                    setupCommand: true,
                    buildCommand: true,
                    testCommand: true,
                    gitHubAppInstallationId: true,
                  },
                  props: {
                    isRoot: true,
                  },
                })
              : null;

            /*
             * The rendered evidence rides in analysisMarkdown and the top
             * finding's headline in subjectTitle, so the shared
             * SubjectPullRequestTaskHandler pipeline needs no special
             * casing — the structured findings travel alongside.
             */
            const basePayload: JSONObject = {
              subjectType: "trace",
              subjectTitle: findings[0]!.headline,
              // Redact before it can reach a prompt or PR body.
              analysisMarkdown: ToolResultSerializer.redact(
                SpanTreeAnalyzer.renderFindingsMarkdown(findings),
              ).text,
              serviceName,
              projectId: run.projectId.toString(),
              traceId: taskContext.traceId,
              findings: findings as never,
              spanSummaries: spanSummaries as never,
            };

            if (!resolution || !repository) {
              logger.debug(
                `No repository resolved for ${taskType} task ${taskId.toString()}`,
                getLogAttributesFromRequest(req as any),
              );

              return Response.sendJsonObjectResponse(req, res, {
                ...basePayload,
                repositories: [],
                resolutionError:
                  "Could not resolve a repository for this performance-fix task: the trace's spans carried no matching code file paths, no connected repository name matches the affected service, and the project has more than one repository. Connect the right repository via the GitHub App, or rename one to match the service.",
              });
            }

            logger.debug(
              `Resolved repository ${resolution.organizationName}/${resolution.repositoryName} for ${taskType} task ${taskId.toString()} via ${resolution.method}: ${resolution.evidence}`,
              getLogAttributesFromRequest(req as any),
            );

            return Response.sendJsonObjectResponse(req, res, {
              ...basePayload,
              repositories: [
                {
                  id: repository.id!.toString(),
                  name: repository.name || "",
                  repositoryHostedAt: repository.repositoryHostedAt || "",
                  organizationName: repository.organizationName || "",
                  repositoryName: repository.repositoryName || "",
                  mainBranchName: repository.mainBranchName || "main",
                  // None for a global Runner, which runs no repository command.
                  ...CodeFixAgentAuth.getRepositoryCommands(
                    aiAgent,
                    repository,
                  ),
                  servicePathInRepository: resolution.servicePathInRepository,
                  gitHubAppInstallationId:
                    repository.gitHubAppInstallationId || null,
                  resolutionMethod: resolution.method,
                  resolutionEvidence: resolution.evidence,
                },
              ],
            });
          }

          if (!run.triggeredByIncidentId && !run.triggeredByAlertId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "This task has no incident or alert subject",
              ),
            );
          }

          const subjectType: "incident" | "alert" = run.triggeredByIncidentId
            ? "incident"
            : "alert";

          let subjectTitle: string = "";
          /*
           * Best-effort service attribution from the subject's monitors —
           * it only feeds the repository name-match fallback, so null is
           * fine when the subject has no monitor.
           */
          let serviceName: string | null = null;
          let analysisMarkdown: string | null =
            investigationSnapshot?.investigationAnalysisMarkdown || null;
          // Whether the subject is a private incident or alert (#9165).
          let subjectIsPrivate: boolean = false;

          if (run.triggeredByIncidentId) {
            const incident: Incident | null = await IncidentService.findOneById(
              {
                id: run.triggeredByIncidentId,
                select: {
                  title: true,
                  isPrivate: true,
                  monitors: {
                    name: true,
                  },
                },
                props: {
                  isRoot: true,
                },
              },
            );

            if (!incident) {
              return Response.sendErrorResponse(
                req,
                res,
                new BadDataException(
                  "The incident this task was created for no longer exists",
                ),
              );
            }

            subjectTitle = incident.title || "Untitled incident";
            subjectIsPrivate = incident.isPrivate === true;
            serviceName = getFirstMonitorName(incident.monitors);

            if (taskType !== CodeFixTaskType.FixFromIncident) {
              analysisMarkdown = await PostedRootCause.getForIncident(
                run.triggeredByIncidentId,
              );
            }
          } else {
            const alert: Alert | null = await AlertService.findOneById({
              id: run.triggeredByAlertId!,
              select: {
                title: true,
                isPrivate: true,
                monitor: {
                  name: true,
                },
              },
              props: {
                isRoot: true,
              },
            });

            if (!alert) {
              return Response.sendErrorResponse(
                req,
                res,
                new BadDataException(
                  "The alert this task was created for no longer exists",
                ),
              );
            }

            subjectTitle = alert.title || "Untitled alert";
            subjectIsPrivate = alert.isPrivate === true;
            serviceName = alert.monitor?.name || null;

            if (taskType !== CodeFixTaskType.FixFromIncident) {
              analysisMarkdown = await PostedRootCause.getForAlert(
                run.triggeredByAlertId!,
              );
            }
          }

          if (!analysisMarkdown) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                `No posted investigation analysis found for this ${subjectType} — the task has nothing to work from (the analysis feed item may have been deleted).`,
              ),
            );
          }

          /*
           * A private incident's or alert's fix is handed only to a Runner
           * that keeps the record out of what it writes on the code host
           * (RunnerCodeFixCapability.KeepsPrivateRecordsOutOfPullRequests,
           * #9165): an older one writes the record's title and this analysis
           * into the pull request, read by everyone with access to the
           * repository. Such a Runner fails the run with this, rather than
           * opening that pull request.
           */
          if (
            subjectIsPrivate &&
            !RunnerCodeFixCapabilityUtil.has(
              RunnerCodeFixCapabilityUtil.readFromBody(data),
              RunnerCodeFixCapability.KeepsPrivateRecordsOutOfPullRequests,
            )
          ) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                getPrivateSubjectNeedsNewerRunnerMessage(subjectType),
              ),
            );
          }

          /*
           * The analysis was written by the investigation LLM over
           * redacted tool results, but quoted exception text can still
           * carry secrets — sweep it again before it reaches the worker's
           * prompt and the pull-request body.
           */
          analysisMarkdown = ToolResultSerializer.redact(analysisMarkdown).text;

          /*
           * Resolve the repository WITHOUT a stack trace — these tasks have
           * no exception, so only the name-match (against the subject's
           * monitor/service name) and only-repository fallbacks apply - among
           * the repositories the auto remediation rules that opened the run
           * allow (every connected one when they named none, as when it was
           * queued: CodeFixRunRepository). When nothing resolves the worker
           * fails the run with this guidance.
           */
          const resolution: RepoResolution | null =
            await CodeRepositoryService.resolveRepositoryForException({
              projectId: run.projectId,
              stackTrace: null,
              serviceName,
              allowance: getRunRepositoryAllowance(run.taskContext),
            });

          const repository: CodeRepository | null = resolution
            ? await CodeRepositoryService.findOneById({
                id: new ObjectID(resolution.codeRepositoryId),
                select: {
                  _id: true,
                  name: true,
                  repositoryHostedAt: true,
                  organizationName: true,
                  repositoryName: true,
                  mainBranchName: true,
                  setupCommand: true,
                  buildCommand: true,
                  testCommand: true,
                  gitHubAppInstallationId: true,
                },
                props: {
                  isRoot: true,
                },
              })
            : null;

          if (!resolution || !repository) {
            logger.debug(
              `No repository resolved for ${taskType} task ${taskId.toString()}`,
              getLogAttributesFromRequest(req as any),
            );

            return Response.sendJsonObjectResponse(req, res, {
              subjectType,
              subjectTitle,
              analysisMarkdown,
              serviceName,
              [SUBJECT_IS_PRIVATE_FIELD]: subjectIsPrivate,
              projectId: run.projectId.toString(),
              repositories: [],
              resolutionError:
                "Could not resolve a repository for this task: no connected repository name matches the affected monitor/service and the project has more than one repository. Connect the right repository via the GitHub App, or rename one to match the service.",
            });
          }

          logger.debug(
            `Resolved repository ${resolution.organizationName}/${resolution.repositoryName} for ${taskType} task ${taskId.toString()} via ${resolution.method}: ${resolution.evidence}`,
            getLogAttributesFromRequest(req as any),
          );

          return Response.sendJsonObjectResponse(req, res, {
            subjectType,
            subjectTitle,
            analysisMarkdown,
            serviceName,
            // The Runner keeps a private record out of the pull request.
            [SUBJECT_IS_PRIVATE_FIELD]: subjectIsPrivate,
            projectId: run.projectId.toString(),
            repositories: [
              {
                id: repository.id!.toString(),
                name: repository.name || "",
                repositoryHostedAt: repository.repositoryHostedAt || "",
                organizationName: repository.organizationName || "",
                repositoryName: repository.repositoryName || "",
                mainBranchName: repository.mainBranchName || "main",
                // None for a global Runner, which runs no repository command.
                ...CodeFixAgentAuth.getRepositoryCommands(aiAgent, repository),
                servicePathInRepository: resolution.servicePathInRepository,
                gitHubAppInstallationId:
                  repository.gitHubAppInstallationId || null,
                resolutionMethod: resolution.method,
                resolutionEvidence: resolution.evidence,
              },
            ],
          });
        } catch (err) {
          next(err);
        }
      },
    );

    // Get access token for a code repository
    this.router.post(
      "/ai-agent-data/get-repository-token",
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const data: JSONObject = req.body;

          /*
           * Validate agent credentials (AIAgent fleet or a Runner). A request
           * that proves none is answered there: 400, or 429 for a client
           * that sent too many different wrong keys for that agent.
           */
          const aiAgent: CodeFixAgentIdentity | null =
            await CodeFixAgentAuth.authenticate(req, res);

          if (!aiAgent) {
            return;
          }

          // Get code repository ID
          if (!data["codeRepositoryId"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("codeRepositoryId is required"),
            );
          }

          const codeRepositoryId: ObjectID = new ObjectID(
            data["codeRepositoryId"] as string,
          );

          /*
           * What the Runner can do: one that has OneUptime open its pull
           * requests is handed a token that can push and nothing more
           * (RunnerCodeFixCapability). An older Runner declares nothing and
           * is handed what it always was.
           */
          const codeFixCapabilities: Array<RunnerCodeFixCapability> =
            RunnerCodeFixCapabilityUtil.readFromBody(data);

          // Get code repository
          const codeRepository: CodeRepository | null =
            await CodeRepositoryService.findOneById({
              id: codeRepositoryId,
              select: {
                _id: true,
                projectId: true,
                repositoryHostedAt: true,
                organizationName: true,
                repositoryName: true,
                repositoryUrl: true,
                gitLabProjectId: true,
                gitHubAppInstallationId: true,
                codeRepositoryConnectionId: true,
                maxOpenFixPullRequests: true,
                runnerId: true,
                isGlobalRunnerPicked: true,
                mintedTokenRefusedAt: true,
              },
              props: {
                isRoot: true,
              },
            });

          /*
           * This route hands out a token that can push to the repository
           * and open pull requests in it, so a project-scoped Runner must
           * never reach another tenant's repository with it.
           */
          if (
            !codeRepository ||
            CodeFixAgentAuth.deniesAccessToProject(
              aiAgent,
              codeRepository.projectId,
            )
          ) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Code repository not found"),
            );
          }

          /*
           * The run the token is for, when the request names one the agent
           * may act for (findTokenRun). Every worker is handed a token only
           * for a repository of a run it holds
           * (CodeFixAgentAuth.deniesAccessToRun): a key never opens every
           * repository its worker may work in at will, only the one its work
           * is in. A worker that names no run - a Runner of a release before
           * it sent one, or an AI agent a project created before 12.0 - is
           * handed one while it holds a run in the repository's project
           * (holdsRunOfProject), as its fix needs; a global Runner always
           * names its run. Without such a run the repository reads as
           * missing, as it does for another project's repository.
           */
          const namedRunId: ObjectID | null = AIAgentDataAPI.getNamedRunId(
            data["taskId"],
          );

          const tokenRun: AIRun | null = namedRunId
            ? await AIAgentDataAPI.findTokenRun({
                aiAgent,
                runId: namedRunId,
                projectId: codeRepository.projectId,
              })
            : null;

          const isHeldWithoutNamingIt: boolean =
            !namedRunId &&
            (await AIAgentDataAPI.holdsRunOfProject({
              aiAgent,
              projectId: codeRepository.projectId,
              codeRepositoryId: codeRepositoryId,
            }));

          if (!tokenRun && !isHeldWithoutNamingIt) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Code repository not found"),
            );
          }

          /*
           * Only the worker the repository picks works in it (its Runner
           * setting in Code, Types/Runner/CodeRepositoryRunner): the Runner
           * it picked, or - for one that picks none - the project's default
           * Runner, else a global Runner while its project uses them. The
           * token is the only way into the repository, so this holds
           * whatever handed the worker its run.
           */
          if (
            !(await CodeRepositoryRunnerChoice.mayWorkInRepository({
              worker: CodeFixAgentAuth.getCodeWorker(aiAgent),
              repository: getCodeRepositoryRunnerFactsRow(codeRepository),
            }))
          ) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(CODE_REPOSITORY_RUNNER_TOKEN_REFUSAL),
            );
          }

          const isGitHub: boolean =
            CodeHost.readType(codeRepository.repositoryHostedAt) ===
            CodeRepositoryType.GitHub;

          /*
           * A repository that is not on GitHub - GitLab, Forgejo, Gitea or a
           * Git server - is reached with its connection's token, which goes
           * only to a Runner that can work there (CodeHostRunnerToken): one
           * that supports the host, that can reach the server, and only
           * while the server takes the token.
           */
          let codeHostGrant: CodeHostRunnerGrant | null = null;

          if (!isGitHub) {
            const decision: CodeHostRunnerDecision =
              await CodeHostRunnerToken.decide({
                repository: codeRepository,
                worker: CodeFixAgentAuth.getCodeWorker(aiAgent),
                supportedCodeHosts: CodeHostRunnerToken.readSupportedCodeHosts(
                  data[RUNNER_SUPPORTED_CODE_HOSTS_FIELD],
                ),
                capabilities: codeFixCapabilities,
                // A token made for a run is made only for one the worker named and holds.
                runId: tokenRun?.id || null,
              });

            if (!decision.grant) {
              return Response.sendErrorResponse(
                req,
                res,
                new BadDataException(decision.refusal),
              );
            }

            codeHostGrant = decision.grant;
          }

          // Check if we have a GitHub App installation ID
          if (isGitHub && !codeRepository.gitHubAppInstallationId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "No GitHub App installation ID found for this repository",
              ),
            );
          }

          /*
           * The project check above proves the ROW is in the agent's project.
           * It does not prove the INSTALLATION is — and those are different
           * questions, because the row's installation ID is just a number
           * stored on a record. Someone who could get an arbitrary
           * installation ID onto a row in a project they own would otherwise
           * pass every check to this point and be handed a live `ghs_` token
           * for another tenant's repositories. So re-derive the binding from
           * the project itself, right before minting.
           */
          if (
            isGitHub &&
            (!codeRepository.projectId ||
              !(await GitHubInstallationBinding.isInstallationBoundToProject({
                projectId: codeRepository.projectId,
                installationId: codeRepository.gitHubAppInstallationId!,
              })))
          ) {
            logger.error(
              `Refusing to mint a GitHub token for code repository ${codeRepositoryId.toString()}: installation ${codeRepository.gitHubAppInstallationId} is not bound to project ${codeRepository.projectId?.toString()}.`,
            );

            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "This repository's GitHub App installation is not connected to its project. Please reconnect the GitHub App from Project Settings.",
              ),
            );
          }

          /*
           * G11 guardrail: per-repo open-PR cap, enforced HERE because the
           * token is the agent's only way to clone and push — a repo at its
           * cap physically cannot receive another AI branch or PR. The
           * worker records this message as the run's failure guidance.
           *
           * Exempt: recipes that cannot ADD to the review queue. The cap
           * bounds how many unreviewed AI pull requests a human has to wade
           * through, and a GitHub revision pushes to a pull request that is
           * already open and already counted, while a review writes nothing
           * at all. Applying the cap to those would mean a repository at its
           * cap could never have its existing AI pull requests improved or
           * reviewed — the exact work that clears the cap.
           *
           * The exemption is derived from the RUN, never from the request: a
           * caller cannot ask to skip the cap, it can only name a task, and
           * the task must be in the agent's own project. A request from Code
           * whose task already has an open pull request here pushes to it,
           * so it is exempt too (isCapExempt). The task is tokenRun, read
           * above.
           */

          /*
           * A request from Code was asked in one repository, and works in
           * that one only: its run names it, so a token for any other is
           * refused, whichever repository of the project the worker names.
           */
          if (
            tokenRun &&
            CodeFixTaskTypeHelper.isCodeRequest(tokenRun.codeFixTaskType) &&
            tokenRun.codeRepositoryId?.toString() !==
              codeRepositoryId.toString()
          ) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "This task was asked in another repository, and works only there.",
              ),
            );
          }

          /*
           * Linked before the cap answers, so a run the cap stops still
           * shows on its repository's page, with the cap's reason.
           */
          await AIAgentDataAPI.linkRunToRepository({
            run: tokenRun,
            codeRepositoryId: codeRepositoryId,
          });

          const isCapExempt: boolean = await AIAgentDataAPI.isCapExempt({
            run: tokenRun,
            codeRepositoryId: codeRepositoryId,
          });

          const openPrCap: OpenPullRequestCapDecision = isCapExempt
            ? {
                allowed: true,
                limit: null,
                paused: false,
                openCount: 0,
              }
            : await OpenPullRequestCap.checkForRepository({
                codeRepositoryId,
                configuredLimit: codeRepository.maxOpenFixPullRequests ?? null,
              });

          if (!openPrCap.allowed) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                OpenPullRequestCap.describeRejection({
                  decision: openPrCap,
                  repositoryName: `${codeRepository.organizationName}/${codeRepository.repositoryName}`,
                }),
              ),
            );
          }

          /*
           * A repository that is not on GitHub: its connection's token, with
           * where its server is, how Git signs in and where its API opens
           * pull and merge requests (CodeHostRunnerInfo). It does not expire
           * on its own, so the Runner is told to treat it as good for the
           * run's hour, as it treats GitHub's.
           */
          if (codeHostGrant) {
            logger.debug(
              codeHostGrant.isMintedForRun
                ? `Handing a ${codeHostGrant.codeHost.type} token made for this run of repository ${codeHostGrant.organizationName}/${codeHostGrant.repositoryName} to a Runner`
                : `Handing the ${codeHostGrant.codeHost.type} access token of repository ${codeHostGrant.organizationName}/${codeHostGrant.repositoryName} to a Runner`,
              getLogAttributesFromRequest(req as any),
            );

            return Response.sendJsonObjectResponse(req, res, {
              token: codeHostGrant.token,
              expiresAt: codeHostGrant.expiresAt.toISOString(),
              repositoryUrl: codeHostGrant.cloneUrl,
              organizationName: codeHostGrant.organizationName,
              repositoryName: codeHostGrant.repositoryName,
              codeHost: codeHostGrant.codeHost as unknown as JSONObject,
              ...(codeHostGrant.serverOpensPullRequest
                ? { [SERVER_OPENS_PULL_REQUEST_FIELD]: true }
                : {}),
            });
          }

          /*
           * A GitHub installation token for this one repository, which
           * reaches no other repository the installation covers
           * (GitHubUtil.getRepositoryAccessToken), and does no more than the
           * run needs (getGitHubRunnerTokenScope): the Runner pushes the
           * fix's branch with it, and - an older Runner - opens its pull
           * request with it too. It lasts an hour at most, and the Runner
           * revokes it when the fix ends.
           */
          const gitHubToken: GitHubRunnerTokenScope =
            AIAgentDataAPI.getGitHubRunnerTokenScope({
              run: tokenRun,
              capabilities: codeFixCapabilities,
            });

          const tokenData: GitHubInstallationToken =
            await GitHubUtil.getRepositoryAccessToken({
              installationId: codeRepository.gitHubAppInstallationId!,
              organizationName: codeRepository.organizationName || "",
              repositoryName: codeRepository.repositoryName || "",
              permissions: gitHubToken.permissions,
            });

          const repositoryUrl: string = `https://github.com/${codeRepository.organizationName}/${codeRepository.repositoryName}.git`;

          logger.debug(
            `Generated access token for repository ${codeRepository.organizationName}/${codeRepository.repositoryName}`,
            getLogAttributesFromRequest(req as any),
          );

          return Response.sendJsonObjectResponse(req, res, {
            token: tokenData.token,
            expiresAt: tokenData.expiresAt,
            repositoryUrl: repositoryUrl,
            organizationName: codeRepository.organizationName,
            repositoryName: codeRepository.repositoryName,
            ...(gitHubToken.serverOpensPullRequest
              ? { [SERVER_OPENS_PULL_REQUEST_FIELD]: true }
              : {}),
          });
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Record a pull request the worker has opened. Idempotent: a worker
     * retries a record whose answer it did not get, and a pull request the run
     * already recorded answers with its existing row (see
     * CodeFixPullRequestRecord).
     */
    this.router.post(
      "/ai-agent-data/record-pull-request",
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const data: JSONObject = req.body;

          /*
           * Validate agent credentials (AIAgent fleet or a Runner). A request
           * that proves none is answered there: 400, or 429 for a client
           * that sent too many different wrong keys for that agent.
           */
          const aiAgent: CodeFixAgentIdentity | null =
            await CodeFixAgentAuth.authenticate(req, res);

          if (!aiAgent) {
            return;
          }

          // Validate required fields
          if (!data["taskId"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("taskId is required"),
            );
          }

          let fields: OpenedPullRequestFields;

          try {
            fields = CodeFixPullRequestRecord.readFields(data);
          } catch (error) {
            if (error instanceof BadDataException) {
              return Response.sendErrorResponse(req, res, error);
            }

            throw error;
          }

          const taskId: ObjectID = new ObjectID(data["taskId"] as string);

          /*
           * `taskId` carries the AIRun id of the code-fix run — get the run
           * for the project ID and so the PR can be recorded on its trail.
           */
          const run: AIRun | null = await AIRunService.findOneById({
            id: taskId,
            select: CODE_FIX_RUN_HOLD_SELECT,
            props: {
              isRoot: true,
            },
          });

          // A global Runner records only for a run it claimed (deniesAccessToRun).
          if (
            !run ||
            !run.projectId ||
            CodeFixAgentAuth.deniesAccessToRun(
              aiAgent,
              run,
              CodeFixRunAccess.Report,
            )
          ) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Task not found"),
            );
          }

          const recordedPullRequest: RecordedPullRequest | null =
            await CodeFixPullRequestRecord.record({
              aiRunId: taskId,
              projectId: run.projectId,
              aiAgent: aiAgent,
              fields: fields,
            });

          if (!recordedPullRequest) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Code repository not found"),
            );
          }

          logger.debug(
            recordedPullRequest.created
              ? `Recorded pull request ${fields.pullRequestUrl} for run ${taskId.toString()}`
              : `Pull request ${fields.pullRequestUrl} was already recorded for run ${taskId.toString()}`,
            getLogAttributesFromRequest(req as any),
          );

          return Response.sendJsonObjectResponse(req, res, {
            success: true,
            pullRequestId: recordedPullRequest.pullRequest._id?.toString(),
          });
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Open the pull (or merge) request of a fix the worker pushed, as
     * OneUptime (issue #8916): a Runner that declares
     * RunnerCodeFixCapability.ServerOpensPullRequests pushes its branch with
     * a token that can do nothing else, and asks here. OneUptime opens it
     * with what the repository is connected with - the GitHub App's
     * installation, or the connection's token, which never leaves the
     * server - and records it, as record-pull-request does.
     *
     * Every worker opens one only for the run it claimed and still holds
     * (CodeFixAgentAuth.deniesAccessToRun, Work), in a repository of the
     * run's project it may work in (its Runner setting in Code; a request
     * from Code only in the repository it was asked in), from a branch the
     * run made (named after it: CodeFixPullRequestOpener.isBranchOfRun) into
     * another, and at most one per repository: asked again, it answers with
     * the one it opened. Answered exactly like a missing run otherwise, so a
     * probing key cannot tell another worker's run from no run.
     *
     * Request:  { aiAgentId, aiAgentKey, taskId, codeRepositoryId,
     *             headRefName, baseRefName, title, body,
     *             runnerVerificationStatus?, runnerVerificationSummary? }
     * Response: { success, pullRequestId, pullRequestUrl, pullRequestNumber,
     *             hostPullRequestId, title, isNew }
     */
    this.router.post(
      "/ai-agent-data/open-pull-request",
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const data: JSONObject = req.body;

          const aiAgent: CodeFixAgentIdentity | null =
            await CodeFixAgentAuth.authenticate(req, res);

          if (!aiAgent) {
            return;
          }

          const runId: ObjectID | null = AIAgentDataAPI.getNamedRunId(
            data["taskId"],
          );

          if (!runId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "The request names no task. Send the taskId of the run this pull request is for.",
              ),
            );
          }

          let request: FixPullRequestRequest;

          try {
            request = CodeFixPullRequestOpener.readRequest(data);
          } catch (error) {
            if (error instanceof BadDataException) {
              return Response.sendErrorResponse(req, res, error);
            }

            throw error;
          }

          const run: AIRun | null = await AIRunService.findOneById({
            id: runId,
            select: {
              ...CODE_FIX_RUN_HOLD_SELECT,
              runType: true,
              codeFixTaskType: true,
              codeRepositoryId: true,
            },
            props: { isRoot: true },
          });

          if (
            !run ||
            !run.projectId ||
            run.runType !== AIRunType.CodeFix ||
            CodeFixAgentAuth.deniesAccessToRun(
              aiAgent,
              run,
              CodeFixRunAccess.Work,
            )
          ) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "OneUptime could not find this task. It may have finished, or belong to another worker.",
              ),
            );
          }

          const taskType: CodeFixTaskType =
            CodeFixTaskTypeHelper.fromDatabaseValue(run.codeFixTaskType);

          if (!CodeFixTaskTypeHelper.opensNewPullRequest(taskType)) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "This task opens no pull request: it works on one that is open already, or changes nothing.",
              ),
            );
          }

          const codeRepository: CodeRepository | null =
            await CodeRepositoryService.findOneById({
              id: request.codeRepositoryId,
              select: {
                ...CODE_HOST_REPOSITORY_SELECT,
                runnerId: true,
                isGlobalRunnerPicked: true,
                mintedTokenRefusedAt: true,
              },
              props: { isRoot: true },
            });

          if (
            !codeRepository ||
            !codeRepository.projectId ||
            codeRepository.projectId.toString() !== run.projectId.toString()
          ) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "OneUptime could not find this code repository in the task's project. Send the codeRepositoryId of one of its repositories.",
              ),
            );
          }

          if (
            CodeFixTaskTypeHelper.isCodeRequest(taskType) &&
            run.codeRepositoryId?.toString() !==
              request.codeRepositoryId.toString()
          ) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "This task was asked in another repository, and works only there.",
              ),
            );
          }

          // The same rule as the token: only the repository's own worker.
          if (
            !(await CodeRepositoryRunnerChoice.mayWorkInRepository({
              worker: CodeFixAgentAuth.getCodeWorker(aiAgent),
              repository: getCodeRepositoryRunnerFactsRow(codeRepository),
            }))
          ) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(CODE_REPOSITORY_RUNNER_TOKEN_REFUSAL),
            );
          }

          if (
            request.headRefName === request.baseRefName ||
            !CodeFixPullRequestOpener.isBranchOfRun({
              branchName: request.headRefName,
              runId,
            })
          ) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "OneUptime opens a pull request only from the branch this task pushed, whose name ends with the first eight characters of the task's id, into another branch.",
              ),
            );
          }

          /*
           * One per repository: asked again (an answer the worker did not
           * get), it is answered with the one it opened; asked for another
           * branch, it is refused.
           */
          const recorded: AIAgentTaskPullRequest | null =
            await CodeFixPullRequestOpener.findRecordedPullRequest({
              aiRunId: runId,
              codeRepositoryId: request.codeRepositoryId,
            });

          if (recorded) {
            if (recorded.headRefName !== request.headRefName) {
              return Response.sendErrorResponse(
                req,
                res,
                new BadDataException(
                  `This task opened its pull request in this repository already, from another branch. ${recorded.pullRequestUrl?.toString() || ""}`,
                ),
              );
            }

            return Response.sendJsonObjectResponse(req, res, {
              success: true,
              pullRequestId: recorded._id?.toString(),
              pullRequestUrl: recorded.pullRequestUrl?.toString() || "",
              pullRequestNumber: recorded.pullRequestNumber || null,
              hostPullRequestId: recorded.pullRequestId || null,
              title: recorded.title || request.title,
              isNew: false,
            });
          }

          const opened: OpenedFixPullRequest =
            await CodeFixPullRequestOpener.open({
              repository: codeRepository,
              request,
            });

          const recordedPullRequest: RecordedPullRequest | null =
            await CodeFixPullRequestRecord.record({
              aiRunId: runId,
              projectId: run.projectId,
              aiAgent: aiAgent,
              fields: {
                codeRepositoryId: request.codeRepositoryId,
                pullRequestUrl: opened.htmlUrl,
                pullRequestNumber: opened.number,
                pullRequestId: opened.id,
                title: opened.title,
                description: request.body.substring(0, 1000),
                headRefName: request.headRefName,
                baseRefName: request.baseRefName,
                runnerVerificationStatus: request.runnerVerificationStatus,
                runnerVerificationSummary: request.runnerVerificationSummary,
              },
            });

          logger.debug(
            `${opened.isNew ? "Opened" : "Found open"} pull request ${opened.htmlUrl} for run ${runId.toString()}`,
            getLogAttributesFromRequest(req as any),
          );

          return Response.sendJsonObjectResponse(req, res, {
            success: true,
            pullRequestId:
              recordedPullRequest?.pullRequest._id?.toString() || null,
            pullRequestUrl: opened.htmlUrl,
            pullRequestNumber: opened.number,
            hostPullRequestId: opened.id,
            title: opened.title,
            isNew: opened.isNew,
          });
        } catch (err) {
          next(err);
        }
      },
    );
  }

  /*
   * Parse the completion request's messages into the LLMMessage shape —
   * strict on structure (role whitelist, string content) so malformed
   * worker payloads fail with a clear 4xx instead of a provider error.
   */
  private parseCompletionMessages(raw: unknown): Array<LLMMessage> {
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new BadDataException("messages must be a non-empty array");
    }

    const validRoles: Array<string> = ["system", "user", "assistant", "tool"];

    return raw.map((entry: unknown, index: number): LLMMessage => {
      if (!entry || typeof entry !== "object") {
        throw new BadDataException(`messages[${index}] must be an object`);
      }

      const messageObject: JSONObject = entry as JSONObject;
      const role: string = messageObject["role"] as string;

      if (!validRoles.includes(role)) {
        throw new BadDataException(
          `messages[${index}].role must be one of: ${validRoles.join(", ")}`,
        );
      }

      const message: LLMMessage = {
        role: role as LLMMessage["role"],
        content:
          typeof messageObject["content"] === "string"
            ? (messageObject["content"] as string)
            : "",
      };

      if (Array.isArray(messageObject["toolCalls"])) {
        message.toolCalls = (
          messageObject["toolCalls"] as Array<JSONObject>
        ).map((toolCall: JSONObject, toolCallIndex: number): LLMToolCall => {
          if (
            typeof toolCall["id"] !== "string" ||
            typeof toolCall["name"] !== "string"
          ) {
            throw new BadDataException(
              `messages[${index}].toolCalls[${toolCallIndex}] must carry string id and name`,
            );
          }

          return {
            id: toolCall["id"] as string,
            name: toolCall["name"] as string,
            arguments:
              toolCall["arguments"] &&
              typeof toolCall["arguments"] === "object" &&
              !Array.isArray(toolCall["arguments"])
                ? (toolCall["arguments"] as JSONObject)
                : {},
          };
        });
      }

      if (typeof messageObject["toolCallId"] === "string") {
        message.toolCallId = messageObject["toolCallId"] as string;
      }

      return message;
    });
  }

  // Parse the completion request's tool definitions (optional).
  private parseCompletionTools(
    raw: unknown,
  ): Array<LLMToolDefinition> | undefined {
    if (raw === undefined || raw === null) {
      return undefined;
    }

    if (!Array.isArray(raw)) {
      throw new BadDataException("tools must be an array when provided");
    }

    if (raw.length === 0) {
      return undefined;
    }

    return raw.map((entry: unknown, index: number): LLMToolDefinition => {
      if (!entry || typeof entry !== "object") {
        throw new BadDataException(`tools[${index}] must be an object`);
      }

      const toolObject: JSONObject = entry as JSONObject;

      if (
        typeof toolObject["name"] !== "string" ||
        typeof toolObject["description"] !== "string" ||
        !toolObject["inputSchema"] ||
        typeof toolObject["inputSchema"] !== "object"
      ) {
        throw new BadDataException(
          `tools[${index}] must carry string name, string description and an inputSchema object`,
        );
      }

      return {
        name: toolObject["name"] as string,
        description: toolObject["description"] as string,
        inputSchema: toolObject["inputSchema"] as JSONObject,
      };
    });
  }
}
