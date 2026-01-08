import AIAgentService from "../Services/AIAgentService";
import LlmProviderService from "../Services/LlmProviderService";
import TelemetryExceptionService from "../Services/TelemetryExceptionService";
import ServiceCatalogTelemetryServiceService from "../Services/ServiceCatalogTelemetryServiceService";
import ServiceCatalogCodeRepositoryService from "../Services/ServiceCatalogCodeRepositoryService";
import CodeRepositoryService from "../Services/CodeRepositoryService";
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
import ServiceCatalogTelemetryService from "../../Models/DatabaseModels/ServiceCatalogTelemetryService";
import ServiceCatalogCodeRepository from "../../Models/DatabaseModels/ServiceCatalogCodeRepository";
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
import LIMIT_MAX from "../../Types/Database/LimitMax";
import URL from "../../Types/API/URL";
import PullRequestState from "../../Types/CodeRepository/PullRequestState";
import logger from "../Utils/Logger";

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

          // Check if this is a Project AI Agent (has a projectId)
          const isProjectAIAgent: boolean =
            aiAgent.projectId !== null && aiAgent.projectId !== undefined;

          // Get LLM provider for the project
          const llmProvider: LlmProvider | null =
            await LlmProviderService.getLLMProviderForProject(projectId);

          if (!llmProvider) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "No LLM provider configured for this project",
              ),
            );
          }

          /*
           * Security check: Project AI Agents cannot access Global LLM Providers
           * Only Global AI Agents (projectId is null) can access Global LLM Providers
           */
          const isGlobalLLMProvider: boolean = llmProvider.isGlobalLlm === true;

          if (isProjectAIAgent && isGlobalLLMProvider) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "Project AI Agents cannot access Global LLM Providers. Please configure a project-specific LLM Provider.",
              ),
            );
          }

          logger.debug(
            `LLM config fetched for project ${projectId.toString()}: ${llmProvider.llmType}`,
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

          // Get exception with telemetry service
          const exception: TelemetryException | null =
            await TelemetryExceptionService.findOneById({
              id: exceptionId,
              select: {
                _id: true,
                message: true,
                stackTrace: true,
                exceptionType: true,
                fingerprint: true,
                telemetryServiceId: true,
                telemetryService: {
                  _id: true,
                  name: true,
                  description: true,
                },
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
          );

          return Response.sendJsonObjectResponse(req, res, {
            exception: {
              id: exception._id?.toString(),
              message: exception.message,
              stackTrace: exception.stackTrace,
              exceptionType: exception.exceptionType,
              fingerprint: exception.fingerprint,
            },
            telemetryService: exception.telemetryServiceId
              ? {
                  id: exception.telemetryServiceId.toString(),
                  name: exception.telemetryService?.name,
                  description: exception.telemetryService?.description,
                }
              : null,
          });
        } catch (err) {
          next(err);
        }
      },
    );

    // Get code repositories linked to a telemetry service via ServiceCatalog
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

          // Get telemetry service ID
          if (!data["telemetryServiceId"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("telemetryServiceId is required"),
            );
          }

          const telemetryServiceId: ObjectID = new ObjectID(
            data["telemetryServiceId"] as string,
          );

          // Step 1: Find ServiceCatalogs linked to this TelemetryService
          const serviceCatalogTelemetryServices: Array<ServiceCatalogTelemetryService> =
            await ServiceCatalogTelemetryServiceService.findBy({
              query: {
                telemetryServiceId: telemetryServiceId,
              },
              select: {
                serviceCatalogId: true,
              },
              skip: 0,
              limit: LIMIT_MAX,
              props: {
                isRoot: true,
              },
            });

          if (serviceCatalogTelemetryServices.length === 0) {
            logger.debug(
              `No service catalogs found for telemetry service ${telemetryServiceId.toString()}`,
            );
            return Response.sendJsonObjectResponse(req, res, {
              repositories: [],
            });
          }

          // Extract service catalog IDs
          const serviceCatalogIds: Array<ObjectID> =
            serviceCatalogTelemetryServices
              .filter((s: ServiceCatalogTelemetryService) => {
                return s.serviceCatalogId;
              })
              .map((s: ServiceCatalogTelemetryService) => {
                return s.serviceCatalogId as ObjectID;
              });

          // Step 2: Find CodeRepositories linked to these ServiceCatalogs
          const repositories: Array<{
            id: string;
            name: string;
            repositoryHostedAt: string;
            organizationName: string;
            repositoryName: string;
            mainBranchName: string;
            servicePathInRepository: string | null;
            gitHubAppInstallationId: string | null;
          }> = [];

          for (const serviceCatalogId of serviceCatalogIds) {
            const serviceCatalogCodeRepositories: Array<ServiceCatalogCodeRepository> =
              await ServiceCatalogCodeRepositoryService.findBy({
                query: {
                  serviceCatalogId: serviceCatalogId,
                },
                select: {
                  codeRepositoryId: true,
                  servicePathInRepository: true,
                  codeRepository: {
                    _id: true,
                    name: true,
                    repositoryHostedAt: true,
                    organizationName: true,
                    repositoryName: true,
                    mainBranchName: true,
                    gitHubAppInstallationId: true,
                  },
                },
                skip: 0,
                limit: LIMIT_MAX,
                props: {
                  isRoot: true,
                },
              });

            for (const scr of serviceCatalogCodeRepositories) {
              if (scr.codeRepository) {
                // Check if we already have this repository
                const existingRepo: boolean = repositories.some(
                  (r: {
                    id: string;
                    name: string;
                    repositoryHostedAt: string;
                    organizationName: string;
                    repositoryName: string;
                    mainBranchName: string;
                    servicePathInRepository: string | null;
                    gitHubAppInstallationId: string | null;
                  }) => {
                    return r.id === scr.codeRepository?._id?.toString();
                  },
                );
                if (!existingRepo) {
                  repositories.push({
                    id: scr.codeRepository._id?.toString() || "",
                    name: scr.codeRepository.name || "",
                    repositoryHostedAt:
                      scr.codeRepository.repositoryHostedAt || "",
                    organizationName: scr.codeRepository.organizationName || "",
                    repositoryName: scr.codeRepository.repositoryName || "",
                    mainBranchName: scr.codeRepository.mainBranchName || "main",
                    servicePathInRepository:
                      scr.servicePathInRepository || null,
                    gitHubAppInstallationId:
                      scr.codeRepository.gitHubAppInstallationId || null,
                  });
                }
              }
            }
          }

          logger.debug(
            `Found ${repositories.length} code repositories for telemetry service ${telemetryServiceId.toString()}`,
          );

          return Response.sendJsonObjectResponse(req, res, {
            repositories: repositories,
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
