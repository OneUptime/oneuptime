import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BadDataException from "../../Types/Exception/BadDataException";
import logger from "../Utils/Logger";
import { JSONObject } from "../../Types/JSON";
import { DashboardClientUrl, GitHubAppName } from "../EnvironmentConfig";
import ObjectID from "../../Types/ObjectID";
import GitHubUtil, {
  GitHubRepository,
} from "../Utils/CodeRepository/GitHub/GitHub";
import CodeRepositoryService from "../Services/CodeRepositoryService";
import CodeRepository from "../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryType from "../../Types/CodeRepository/CodeRepositoryType";
import URL from "../../Types/API/URL";
import UserMiddleware from "../Middleware/UserAuthorization";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

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

          // Decode the state parameter to get projectId and userId
          let projectId: string | undefined;
          let userId: string | undefined;

          try {
            const decodedState: { projectId?: string; userId?: string } =
              JSON.parse(Buffer.from(state, "base64").toString("utf-8"));
            projectId = decodedState.projectId;
            userId = decodedState.userId;
          } catch {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid state parameter"),
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
           * Store the installation ID - we'll create repositories when user selects them
           * For now, redirect back to dashboard with installation ID
           */
          const redirectUrl: string = `${DashboardClientUrl.toString()}/dashboard/${projectId}/code-repository?installation_id=${installationId}`;

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
           * The state parameter helps us track the installation
           */
          const state: string = Buffer.from(
            JSON.stringify({ projectId, userId }),
          ).toString("base64");

          const installUrl: string = `https://github.com/apps/${GitHubAppName}/installations/new?state=${state}`;

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
          const installationId: string | undefined =
            req.params["installationId"]?.toString();

          if (!installationId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Installation ID is required"),
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
