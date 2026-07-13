import AIAgentService from "../Services/AIAgentService";
import LlmProviderService from "../Services/LlmProviderService";
import TelemetryExceptionService from "../Services/TelemetryExceptionService";
import ServiceService from "../Services/ServiceService";
import CodeRepositoryService from "../Services/CodeRepositoryService";
import { RepoResolution } from "../Utils/CodeRepository/StackTraceRepoResolver";
import AIAgentTaskPullRequestService from "../Services/AIAgentTaskPullRequestService";
import AIAgentTaskService from "../Services/AIAgentTaskService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import AIAgent from "../../Models/DatabaseModels/AIAgent";
import LlmProvider from "../../Models/DatabaseModels/LlmProvider";
import TelemetryException from "../../Models/DatabaseModels/TelemetryException";
import Service from "../../Models/DatabaseModels/Service";
import CodeRepository from "../../Models/DatabaseModels/CodeRepository";
import AIAgentTaskPullRequest from "../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIAgentTask from "../../Models/DatabaseModels/AIAgentTask";
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
    // Get LLM configuration for a project
    this.router.post(
      "/ai-agent-data/get-llm-config",
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

          // Get project ID
          if (!data["projectId"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("projectId is required"),
            );
          }

          const projectId: ObjectID = new ObjectID(data["projectId"] as string);

          /*
           * AI Agent tasks require a provider the project OWNS. This endpoint
           * hands the raw apiKey to the agent process, whose LLM calls are
           * made directly by the code agent and are NOT metered through
           * AIService/LlmLog — so the shared global (OneUptime-billed)
           * provider must never be returned to ANY agent, global or
           * project-scoped: its usage would be unbilled, unlogged, and
           * exempt from the daily token budget.
           */
          const llmProvider: LlmProvider | null =
            await LlmProviderService.getProjectOwnedLlmProvider(projectId);

          if (!llmProvider) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "AI Agent tasks require a project-owned LLM provider (the shared global provider is not supported on this path because agent usage is not metered). Add one in Project Settings > AI > LLM Providers.",
              ),
            );
          }

          logger.debug(
            `LLM config fetched for project ${projectId.toString()}: ${llmProvider.llmType}`,
            getLogAttributesFromRequest(req as any),
          );

          return Response.sendJsonObjectResponse(req, res, {
            llmType: llmProvider.llmType,
            apiKey: llmProvider.apiKey,
            baseUrl: llmProvider.baseUrl,
            modelName: llmProvider.modelName,
          });
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
            `Exception details fetched: ${exception._id} - ${exception.message?.substring(0, 100)}`,
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

          return Response.sendJsonObjectResponse(req, res, {
            exception: {
              id: exception._id?.toString(),
              message: exception.message,
              stackTrace: exception.stackTrace,
              exceptionType: exception.exceptionType,
              fingerprint: exception.fingerprint,
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

          // Get the task to get the project ID
          const task: AIAgentTask | null = await AIAgentTaskService.findOneById(
            {
              id: taskId,
              select: {
                _id: true,
                projectId: true,
              },
              props: {
                isRoot: true,
              },
            },
          );

          if (!task) {
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

          if (task.projectId) {
            pullRequest.projectId = task.projectId;
          }

          pullRequest.aiAgentTaskId = taskId;
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

          logger.debug(
            `Recorded pull request ${pullRequestUrl} for task ${taskId.toString()}`,
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
