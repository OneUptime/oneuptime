import AIAgentService from "../Services/AIAgentService";
import TelemetryExceptionService from "../Services/TelemetryExceptionService";
import ServiceService from "../Services/ServiceService";
import CodeRepositoryService from "../Services/CodeRepositoryService";
import { RepoResolution } from "../Utils/CodeRepository/StackTraceRepoResolver";
import AIAgentTaskPullRequestService from "../Services/AIAgentTaskPullRequestService";
import AIRunService from "../Services/AIRunService";
import AIRunEventService from "../Services/AIRunEventService";
import IncidentService from "../Services/IncidentService";
import AlertService from "../Services/AlertService";
import IncidentFeedService from "../Services/IncidentFeedService";
import AlertFeedService from "../Services/AlertFeedService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import AIAgent from "../../Models/DatabaseModels/AIAgent";
import TelemetryException from "../../Models/DatabaseModels/TelemetryException";
import Service from "../../Models/DatabaseModels/Service";
import CodeRepository from "../../Models/DatabaseModels/CodeRepository";
import AIAgentTaskPullRequest from "../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRun from "../../Models/DatabaseModels/AIRun";
import Incident from "../../Models/DatabaseModels/Incident";
import Alert from "../../Models/DatabaseModels/Alert";
import IncidentFeed, {
  IncidentFeedEventType,
} from "../../Models/DatabaseModels/IncidentFeed";
import AlertFeed, {
  AlertFeedEventType,
} from "../../Models/DatabaseModels/AlertFeed";
import AIRunEventType from "../../Types/AI/AIRunEventType";
import AIRunType from "../../Types/AI/AIRunType";
import CodeFixTaskType, {
  CodeFixContextKind,
  CodeFixTaskTypeHelper,
} from "../../Types/AI/CodeFixTaskType";
import CodeFixTaskContext, {
  ImplicatedSpan,
  PerformanceCodeLocation,
  PerformanceFinding,
} from "../../Types/AI/CodeFixTaskContext";
import SpanTreeAnalyzer from "../Utils/AI/PerfEvidence/SpanTreeAnalyzer";
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
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import GitHubUtil, {
  GitHubInstallationToken,
} from "../Utils/CodeRepository/GitHub/GitHub";
import CodeRepositoryType from "../../Types/CodeRepository/CodeRepositoryType";
import URL from "../../Types/API/URL";
import PullRequestState from "../../Types/CodeRepository/PullRequestState";
import logger, { getLogAttributesFromRequest } from "../Utils/Logger";

export default class AIAgentDataAPI {
  public router!: ExpressRouter;

  public constructor() {
    this.router = Express.getRouter();
    this.initRoutes();
  }

  public getRouter(): ExpressRouter {
    return this.router;
  }

  private initRoutes(): void {
    /*
     * Server-mediated LLM completion for the in-house code-fix agent (B4
     * Tier 0, Internal/Roadmap/CodeFixSandboxDesign.md). One call = one
     * completion of the worker's tool loop, executed through
     * AIService.executeWithLogging: metered, LlmLog-linked to the run,
     * inside the G4 daily budget, and under per-run loop budgets (max
     * completion calls / output tokens) enforced server-side. The worker
     * never receives a provider secret on this path.
     *
     * Request:  { aiAgentId, aiAgentKey, taskId, messages, tools?, maxTokens? }
     * Response: { message: { role: "assistant", content, toolCalls },
     *             stopReason: "stop" | "tool_use",
     *             budget: { completionCallsUsed, maxCompletionCalls,
     *                       outputTokensUsed, maxOutputTokens } }
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

          // Validate AI Agent credentials
          const aiAgent: AIAgent | null = await this.validateAIAgent(data);

          if (!aiAgent || !aiAgent.id) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid AI Agent ID or AI Agent Key"),
            );
          }

          if (!data["taskId"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("taskId is required"),
            );
          }

          const taskId: ObjectID = new ObjectID(data["taskId"] as string);

          const messages: Array<LLMMessage> = this.parseCompletionMessages(
            data["messages"],
          );
          const tools: Array<LLMToolDefinition> | undefined =
            this.parseCompletionTools(data["tools"]);
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
            budget: result.budget,
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

          // Validate AI Agent credentials
          const aiAgent: AIAgent | null = await this.validateAIAgent(data);

          if (!aiAgent) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid AI Agent ID or AI Agent Key"),
            );
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

          if (!exception) {
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
              exceptionType: exception.exceptionType,
              fingerprint: exception.fingerprint,
              aiClassification: exception.aiClassification || null,
            },
            service: exception.primaryEntityId
              ? {
                  id: exception.primaryEntityId.toString(),
                  name: exceptionService?.name,
                  description: exceptionService?.description,
                }
              : null,
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

          // Validate AI Agent credentials
          const aiAgent: AIAgent | null = await this.validateAIAgent(data);

          if (!aiAgent) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid AI Agent ID or AI Agent Key"),
            );
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

          if (!exception || !exception.projectId) {
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
                "Could not resolve a repository for this exception: no connected repository contains the files in its stack trace, no repository name matches the service, and the project has more than one repository. Connect the right repository via the GitHub App.",
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
     *  - Incident/alert-subject recipes (ImproveInstrumentation,
     *    FixFromIncident): the investigation's posted analysis + subject
     *    metadata + the repository resolved without a stack trace. The
     *    analysis text comes from the subject's latest RootCause feed item:
     *    the AI's postAnalysis is the only writer of RootCause feed
     *    events, it writes them for BOTH subjects and BOTH confidence
     *    outcomes (quiet mode only mutes the workspace ping), so the feed
     *    item IS the investigation run's persisted output.
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

          // Validate AI Agent credentials
          const aiAgent: AIAgent | null = await this.validateAIAgent(data);

          if (!aiAgent) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid AI Agent ID or AI Agent Key"),
            );
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
              _id: true,
              projectId: true,
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

          if (!run || !run.projectId) {
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
             */
            const codeLocations: Array<PerformanceCodeLocation> =
              taskContext.codeLocations || [];
            const syntheticStackTrace: string | null =
              codeLocations.length > 0
                ? codeLocations
                    .map((location: PerformanceCodeLocation): string => {
                      return `    at ${
                        location.functionName ? `${location.functionName} ` : ""
                      }(${location.filePath}:${location.lineNumber ?? 1})`;
                    })
                    .join("\n")
                : null;

            const serviceName: string | null = taskContext.serviceName || null;

            const resolution: RepoResolution | null =
              await CodeRepositoryService.resolveRepositoryForException({
                projectId: run.projectId,
                stackTrace: syntheticStackTrace,
                serviceName,
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
          let analysisMarkdown: string | null = null;

          if (run.triggeredByIncidentId) {
            const incident: Incident | null = await IncidentService.findOneById(
              {
                id: run.triggeredByIncidentId,
                select: {
                  title: true,
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
            serviceName =
              (incident.monitors || [])
                .map((monitor: { name?: string | undefined }) => {
                  return monitor.name || "";
                })
                .filter(Boolean)[0] || null;

            const feedItem: IncidentFeed | null =
              await IncidentFeedService.findOneBy({
                query: {
                  incidentId: run.triggeredByIncidentId,
                  incidentFeedEventType: IncidentFeedEventType.RootCause,
                },
                select: {
                  feedInfoInMarkdown: true,
                },
                sort: {
                  createdAt: SortOrder.Descending,
                },
                props: {
                  isRoot: true,
                },
              });

            analysisMarkdown = feedItem?.feedInfoInMarkdown || null;
          } else {
            const alert: Alert | null = await AlertService.findOneById({
              id: run.triggeredByAlertId!,
              select: {
                title: true,
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
            serviceName = alert.monitor?.name || null;

            const feedItem: AlertFeed | null = await AlertFeedService.findOneBy(
              {
                query: {
                  alertId: run.triggeredByAlertId!,
                  alertFeedEventType: AlertFeedEventType.RootCause,
                },
                select: {
                  feedInfoInMarkdown: true,
                },
                sort: {
                  createdAt: SortOrder.Descending,
                },
                props: {
                  isRoot: true,
                },
              },
            );

            analysisMarkdown = feedItem?.feedInfoInMarkdown || null;
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
           * The analysis was written by the investigation LLM over
           * redacted tool results, but quoted exception text can still
           * carry secrets — sweep it again before it reaches the worker's
           * prompt and the pull-request body.
           */
          analysisMarkdown = ToolResultSerializer.redact(analysisMarkdown).text;

          /*
           * Resolve the repository WITHOUT a stack trace — these tasks have
           * no exception, so only the name-match (against the subject's
           * monitor/service name) and only-repository fallbacks apply. When
           * nothing resolves the worker fails the run with this guidance.
           */
          const resolution: RepoResolution | null =
            await CodeRepositoryService.resolveRepositoryForException({
              projectId: run.projectId,
              stackTrace: null,
              serviceName,
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
            projectId: run.projectId.toString(),
            repositories: [
              {
                id: repository.id!.toString(),
                name: repository.name || "",
                repositoryHostedAt: repository.repositoryHostedAt || "",
                organizationName: repository.organizationName || "",
                repositoryName: repository.repositoryName || "",
                mainBranchName: repository.mainBranchName || "main",
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

          // Validate AI Agent credentials
          const aiAgent: AIAgent | null = await this.validateAIAgent(data);

          if (!aiAgent) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid AI Agent ID or AI Agent Key"),
            );
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

          // Get code repository
          const codeRepository: CodeRepository | null =
            await CodeRepositoryService.findOneById({
              id: codeRepositoryId,
              select: {
                _id: true,
                repositoryHostedAt: true,
                organizationName: true,
                repositoryName: true,
                gitHubAppInstallationId: true,
                maxOpenFixPullRequests: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!codeRepository) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Code repository not found"),
            );
          }

          // Currently only supporting GitHub
          if (codeRepository.repositoryHostedAt !== CodeRepositoryType.GitHub) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                `Repository type ${codeRepository.repositoryHostedAt} is not yet supported`,
              ),
            );
          }

          // Check if we have a GitHub App installation ID
          if (!codeRepository.gitHubAppInstallationId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "No GitHub App installation ID found for this repository",
              ),
            );
          }

          /*
           * G11 guardrail: per-repo open-PR cap, enforced HERE because the
           * token is the agent's only way to clone and push — a repo at its
           * cap physically cannot receive another AI branch or PR. The
           * worker records this message as the run's failure guidance.
           */
          const openPrCap: OpenPullRequestCapDecision =
            await OpenPullRequestCap.checkForRepository({
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
           * Generate GitHub installation access token with write permissions
           * Required for AI Agent to push branches and create pull requests
           */
          const tokenData: GitHubInstallationToken =
            await GitHubUtil.getInstallationAccessToken(
              codeRepository.gitHubAppInstallationId,
              {
                permissions: {
                  contents: "write", // Required for pushing branches
                  pull_requests: "write", // Required for creating PRs
                  metadata: "read", // Required for reading repository metadata
                },
              },
            );

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
          });
        } catch (err) {
          next(err);
        }
      },
    );

    // Record a pull request created by the AI Agent
    this.router.post(
      "/ai-agent-data/record-pull-request",
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const data: JSONObject = req.body;

          // Validate AI Agent credentials
          const aiAgent: AIAgent | null = await this.validateAIAgent(data);

          if (!aiAgent) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid AI Agent ID or AI Agent Key"),
            );
          }

          // Validate required fields
          if (!data["taskId"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("taskId is required"),
            );
          }

          if (!data["codeRepositoryId"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("codeRepositoryId is required"),
            );
          }

          if (!data["pullRequestUrl"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("pullRequestUrl is required"),
            );
          }

          if (!data["title"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("title is required"),
            );
          }

          const taskId: ObjectID = new ObjectID(data["taskId"] as string);
          const codeRepositoryId: ObjectID = new ObjectID(
            data["codeRepositoryId"] as string,
          );
          const pullRequestUrl: string = data["pullRequestUrl"] as string;
          const pullRequestNumber: number | undefined = data[
            "pullRequestNumber"
          ] as number | undefined;
          const pullRequestId: number | undefined = data["pullRequestId"] as
            | number
            | undefined;
          const title: string = data["title"] as string;
          const description: string | undefined = data["description"] as
            | string
            | undefined;
          const headRefName: string | undefined = data["headRefName"] as
            | string
            | undefined;
          const baseRefName: string | undefined = data["baseRefName"] as
            | string
            | undefined;

          /*
           * `taskId` carries the AIRun id of the code-fix run — get the run
           * for the project ID and so the PR can be recorded on its trail.
           */
          const run: AIRun | null = await AIRunService.findOneById({
            id: taskId,
            select: {
              _id: true,
              projectId: true,
            },
            props: {
              isRoot: true,
            },
          });

          if (!run) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Task not found"),
            );
          }

          // Get code repository for organization and repo name
          const codeRepository: CodeRepository | null =
            await CodeRepositoryService.findOneById({
              id: codeRepositoryId,
              select: {
                _id: true,
                organizationName: true,
                repositoryName: true,
              },
              props: {
                isRoot: true,
              },
            });

          // Create the pull request record
          const pullRequest: AIAgentTaskPullRequest =
            new AIAgentTaskPullRequest();

          if (run.projectId) {
            pullRequest.projectId = run.projectId;
          }

          pullRequest.aiRunId = taskId;
          pullRequest.aiAgentId = aiAgent.id!;
          pullRequest.codeRepositoryId = codeRepositoryId;
          pullRequest.pullRequestUrl = URL.fromString(pullRequestUrl);

          if (pullRequestNumber !== undefined) {
            pullRequest.pullRequestNumber = pullRequestNumber;
          }

          if (pullRequestId !== undefined) {
            pullRequest.pullRequestId = pullRequestId;
          }

          pullRequest.title = title;

          if (description) {
            pullRequest.description = description;
          }

          pullRequest.pullRequestState = PullRequestState.Open;

          if (headRefName) {
            pullRequest.headRefName = headRefName;
          }

          if (baseRefName) {
            pullRequest.baseRefName = baseRefName;
          }

          if (codeRepository?.organizationName) {
            pullRequest.repoOrganizationName = codeRepository.organizationName;
          }

          if (codeRepository?.repositoryName) {
            pullRequest.repoName = codeRepository.repositoryName;
          }

          const createdPullRequest: AIAgentTaskPullRequest =
            await AIAgentTaskPullRequestService.create({
              data: pullRequest,
              props: {
                isRoot: true,
              },
            });

          /*
           * The pull request is the run's headline action — record it on
           * the run's glass-box trail so the activity feed shows it.
           */
          if (run.projectId) {
            await AIRunEventService.appendEventToRun({
              projectId: run.projectId,
              aiRunId: taskId,
              eventType: AIRunEventType.ActionExecuted,
              toolName: "open_pull_request",
              resultSummary: {
                message: `Opened pull request: ${title} — ${pullRequestUrl}`,
              },
            });
          }

          logger.debug(
            `Recorded pull request ${pullRequestUrl} for run ${taskId.toString()}`,
            getLogAttributesFromRequest(req as any),
          );

          return Response.sendJsonObjectResponse(req, res, {
            success: true,
            pullRequestId: createdPullRequest._id?.toString(),
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

  // Validate AI Agent credentials from request body
  private async validateAIAgent(data: JSONObject): Promise<AIAgent | null> {
    if (!data["aiAgentId"] || !data["aiAgentKey"]) {
      return null;
    }

    const aiAgentId: ObjectID = new ObjectID(data["aiAgentId"] as string);
    const aiAgentKey: string = data["aiAgentKey"] as string;

    const aiAgent: AIAgent | null = await AIAgentService.findOneBy({
      query: {
        _id: aiAgentId.toString(),
        key: aiAgentKey,
      },
      select: {
        _id: true,
        projectId: true, // Fetch projectId to check if this is a global or project AI agent
      },
      props: {
        isRoot: true,
      },
    });

    return aiAgent;
  }
}
