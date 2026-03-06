import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import logger from "../Utils/Logger";
import { JSONObject } from "../../Types/JSON";
import {
  DashboardClientUrl,
  GitHubAppName,
  HomeClientUrl,
} from "../EnvironmentConfig";
import ObjectID from "../../Types/ObjectID";
import GitHubUtil, {
  GitHubRepository,
  GitHubInstallationNotFoundError,
} from "../Utils/CodeRepository/GitHub/GitHub";
import CodeRepositoryService from "../Services/CodeRepositoryService";
import ProjectService from "../Services/ProjectService";
import AccessTokenService from "../Services/AccessTokenService";
import CodeRepository from "../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryType from "../../Types/CodeRepository/CodeRepositoryType";
import URL from "../../Types/API/URL";
import UserMiddleware from "../Middleware/UserAuthorization";
import JSONWebToken from "../Utils/JsonWebToken";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { UserTenantAccessPermission } from "../../Types/Permission";

export default class GitHubAPI {
  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    /*
     * GitHub App installation callback
     * This is called after a user installs the GitHub App
     * The state parameter contains base64 encoded JSON with projectId and userId
     */
    router.get(
      "/github/auth/callback",
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          // GitHub sends state parameter back which contains projectId and userId
          const state: string | undefined = req.query["state"]?.toString();

          if (!state) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("State parameter is required"),
            );
          }

          // Verify and decode the signed state token
          let projectId: string | undefined;
          let userId: string | undefined;

          try {
            const decodedState: JSONObject =
              JSONWebToken.decodeJsonPayload(state);
            projectId = decodedState["projectId"] as string | undefined;
            userId = decodedState["userId"] as string | undefined;
          } catch {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "Invalid or expired state parameter. Please restart the GitHub App installation.",
              ),
            );
          }

          if (!projectId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Project ID is required in state"),
            );
          }

          if (!userId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("User ID is required in state"),
            );
          }

          // Verify the user is a member of this project
          const userTenantAccessPermission: UserTenantAccessPermission | null =
            await AccessTokenService.getUserTenantAccessPermission(
              new ObjectID(userId),
              new ObjectID(projectId),
            );

          if (!userTenantAccessPermission) {
            return Response.sendErrorResponse(
              req,
              res,
              new NotAuthorizedException(
                "You do not have access to this project.",
              ),
            );
          }

          // GitHub sends installation_id in query params after app installation
          const installationId: string | undefined =
            req.query["installation_id"]?.toString();

          if (!installationId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "Installation ID is required. Please install the GitHub App first.",
              ),
            );
          }

          /*
           * Store the installation ID in the project
           * This allows reuse when connecting additional repositories
           */
          await ProjectService.updateOneById({
            id: new ObjectID(projectId),
            data: {
              gitHubAppInstallationId: installationId,
            },
            props: {
              isRoot: true,
            },
          });

          // Redirect back to dashboard with installation ID
          const redirectUrl: string = `${DashboardClientUrl.toString()}/${projectId}/code-repository?installation_id=${installationId}`;

          return Response.redirect(req, res, URL.fromString(redirectUrl));
        } catch (error) {
          logger.error("GitHub Auth Callback Error:");
          logger.error(error);
          return Response.sendErrorResponse(
            req,
            res,
            error instanceof Error
              ? new BadDataException(error.message)
              : new BadDataException("An error occurred"),
          );
        }
      },
    );

    // Initiate GitHub App installation
    router.get(
      "/github/auth/install",
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          if (!GitHubAppName) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "GitHub App is not configured. Please set GITHUB_APP_NAME.",
              ),
            );
          }

          const projectId: string | undefined =
            req.query["projectId"]?.toString();
          const userId: string | undefined = req.query["userId"]?.toString();

          if (!projectId || !userId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Project ID and User ID are required"),
            );
          }

          /*
           * Redirect to GitHub App installation page
           * The state parameter is a signed JWT to prevent tampering
           * It expires in 1 hour to limit the window for replay attacks
           */
          const state: string = JSONWebToken.signJsonPayload(
            { projectId, userId },
            3600, // 1 hour expiry
          );

          const callbackUrl: string = `${HomeClientUrl.toString()}api/github/auth/callback`;
          const installUrl: string = `https://github.com/apps/${GitHubAppName}/installations/new?state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(callbackUrl)}`;

          return Response.redirect(req, res, URL.fromString(installUrl));
        } catch (error) {
          logger.error("GitHub Install Redirect Error:");
          logger.error(error);
          return Response.sendErrorResponse(
            req,
            res,
            error instanceof Error
              ? new BadDataException(error.message)
              : new BadDataException("An error occurred"),
          );
        }
      },
    );

    // List repositories for an installation
    router.get(
      "/github/repositories/:projectId/:installationId",
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;

          // Require authentication
          if (!oneuptimeRequest.userAuthorization) {
            return Response.sendErrorResponse(
              req,
              res,
              new NotAuthenticatedException(
                "Authentication is required to list repositories.",
              ),
            );
          }

          const projectId: string | undefined =
            req.params["projectId"]?.toString();
          const installationId: string | undefined =
            req.params["installationId"]?.toString();

          if (!projectId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Project ID is required"),
            );
          }

          if (!installationId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Installation ID is required"),
            );
          }

          // Verify user has access to this project
          const userTenantAccessPermission: UserTenantAccessPermission | null =
            await AccessTokenService.getUserTenantAccessPermission(
              oneuptimeRequest.userAuthorization.userId,
              new ObjectID(projectId),
            );

          if (!userTenantAccessPermission) {
            return Response.sendErrorResponse(
              req,
              res,
              new NotAuthorizedException(
                "You do not have access to this project.",
              ),
            );
          }

          const repositories: Array<GitHubRepository> =
            await GitHubUtil.listRepositoriesForInstallation(installationId);

          return Response.sendJsonObjectResponse(req, res, {
            repositories: repositories as unknown,
          } as JSONObject);
        } catch (error) {
          logger.error("GitHub List Repositories Error:");
          logger.error(error);

          // Handle stale installation ID - clear it from the project and return specific error
          if (error instanceof GitHubInstallationNotFoundError) {
            const projectId: string | undefined =
              req.params["projectId"]?.toString();

            if (projectId) {
              try {
                // Clear the stale installation ID from the project
                await ProjectService.updateOneById({
                  id: new ObjectID(projectId),
                  data: {
                    gitHubAppInstallationId: null as unknown as string,
                  },
                  props: {
                    isRoot: true,
                  },
                });

                logger.info(
                  `Cleared stale GitHub App installation ID from project ${projectId}`,
                );
              } catch (clearError) {
                logger.error(
                  "Failed to clear stale installation ID from project:",
                );
                logger.error(clearError);
              }
            }

            // Return the specific error so the frontend knows to prompt reinstallation
            return Response.sendErrorResponse(req, res, error);
          }

          return Response.sendErrorResponse(
            req,
            res,
            error instanceof Error
              ? new BadDataException(error.message)
              : new BadDataException("An error occurred"),
          );
        }
      },
    );

    // Connect a repository to a project
    router.post(
      "/github/repository/connect",
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;

          // Require authentication
          if (!oneuptimeRequest.userAuthorization) {
            return Response.sendErrorResponse(
              req,
              res,
              new NotAuthenticatedException(
                "Authentication is required to connect a repository.",
              ),
            );
          }

          const body: JSONObject = req.body;

          const projectId: string | undefined = body["projectId"]?.toString();
          const installationId: string | undefined =
            body["installationId"]?.toString();
          const repositoryName: string | undefined =
            body["repositoryName"]?.toString();
          const organizationName: string | undefined =
            body["organizationName"]?.toString();
          const name: string | undefined = body["name"]?.toString();
          const defaultBranch: string | undefined =
            body["defaultBranch"]?.toString();
          const repositoryUrl: string | undefined =
            body["repositoryUrl"]?.toString();
          const description: string | undefined =
            body["description"]?.toString();

          if (!projectId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Project ID is required"),
            );
          }

          if (!installationId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Installation ID is required"),
            );
          }

          // Verify user has access to this project
          const userTenantAccessPermission: UserTenantAccessPermission | null =
            await AccessTokenService.getUserTenantAccessPermission(
              oneuptimeRequest.userAuthorization.userId,
              new ObjectID(projectId),
            );

          if (!userTenantAccessPermission) {
            return Response.sendErrorResponse(
              req,
              res,
              new NotAuthorizedException(
                "You do not have access to this project.",
              ),
            );
          }

          if (!repositoryName) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Repository name is required"),
            );
          }

          if (!organizationName) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Organization name is required"),
            );
          }

          // Create the code repository record
          const codeRepository: CodeRepository = new CodeRepository();
          codeRepository.projectId = new ObjectID(projectId);
          codeRepository.name = name || `${organizationName}/${repositoryName}`;
          codeRepository.repositoryHostedAt = CodeRepositoryType.GitHub;
          codeRepository.organizationName = organizationName;
          codeRepository.repositoryName = repositoryName;
          codeRepository.mainBranchName = defaultBranch || "main";
          codeRepository.gitHubAppInstallationId = installationId;

          if (repositoryUrl) {
            codeRepository.repositoryUrl = URL.fromString(repositoryUrl);
          }

          if (description) {
            codeRepository.description = description;
          }

          const createdRepository: CodeRepository =
            await CodeRepositoryService.create({
              data: codeRepository,
              props: {
                isRoot: true,
              },
            });

          return Response.sendJsonObjectResponse(req, res, {
            repository: BaseModel.toJSON(createdRepository, CodeRepository),
          } as JSONObject);
        } catch (error) {
          logger.error("GitHub Connect Repository Error:");
          logger.error(error);
          return Response.sendErrorResponse(
            req,
            res,
            error instanceof Error
              ? new BadDataException(error.message)
              : new BadDataException("An error occurred"),
          );
        }
      },
    );

    // GitHub webhook handler
    router.post(
      "/github/webhook",
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const signature: string | undefined = req.headers[
            "x-hub-signature-256"
          ] as string | undefined;
          const event: string | undefined = req.headers["x-github-event"] as
            | string
            | undefined;

          if (!signature) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Missing webhook signature"),
            );
          }

          // Get raw body for signature verification
          const rawBody: string = JSON.stringify(req.body);

          // Verify webhook signature
          const isValid: boolean = GitHubUtil.verifyWebhookSignature(
            rawBody,
            signature,
          );

          if (!isValid) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid webhook signature"),
            );
          }

          logger.debug(`Received GitHub webhook event: ${event}`);

          // Handle installation events - specifically when the app is uninstalled
          if (event === "installation") {
            const action: string | undefined = (req.body as JSONObject)?.[
              "action"
            ]?.toString();
            const installationId: string | undefined = (
              (req.body as JSONObject)?.["installation"] as JSONObject
            )?.["id"]?.toString();

            if (action === "deleted" && installationId) {
              logger.info(
                `GitHub App installation ${installationId} was deleted. Clearing from database...`,
              );

              try {
                // Clear the installation ID from any projects that have it
                await ProjectService.updateBy({
                  query: {
                    gitHubAppInstallationId: installationId,
                  },
                  data: {
                    gitHubAppInstallationId: null as unknown as string,
                  },
                  limit: 1000,
                  skip: 0,
                  props: {
                    isRoot: true,
                  },
                });

                // Also clear from any code repositories that have this installation ID
                await CodeRepositoryService.updateBy({
                  query: {
                    gitHubAppInstallationId: installationId,
                  },
                  data: {
                    gitHubAppInstallationId: null as unknown as string,
                  },
                  limit: 10000,
                  skip: 0,
                  props: {
                    isRoot: true,
                  },
                });

                logger.info(
                  `Successfully cleared GitHub App installation ${installationId} from database`,
                );
              } catch (clearError) {
                logger.error(
                  `Failed to clear GitHub App installation ${installationId} from database:`,
                );
                logger.error(clearError);
              }
            }
          }

          /*
           * Handle different webhook events here
           * For now, just acknowledge receipt
           * Future: Handle push, pull_request, check_run events
           */

          return Response.sendJsonObjectResponse(req, res, {
            success: true,
            message: "Webhook received",
          } as JSONObject);
        } catch (error) {
          logger.error("GitHub Webhook Error:");
          logger.error(error);
          return Response.sendErrorResponse(
            req,
            res,
            error instanceof Error
              ? new BadDataException(error.message)
              : new BadDataException("An error occurred"),
          );
        }
      },
    );

    return router;
  }
}
