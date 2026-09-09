import GitHubWebhookQueue, {
  GitHubWebhookDelivery,
} from "../Utils/CodeRepository/GitHub/GitHubWebhookQueue";
import ServerException from "../../Types/Exception/ServerException";
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
import logger, { getLogAttributesFromRequest } from "../Utils/Logger";
import { JSONObject } from "../../Types/JSON";
import {
  DashboardClientUrl,
  GitHubAppName,
  HomeClientUrl,
} from "../EnvironmentConfig";
import ObjectID from "../../Types/ObjectID";
import GitHubUtil from "../Utils/CodeRepository/GitHub/GitHub";
import CodeRepositoryService, {
  ImportReposFromInstallationResult,
} from "../Services/CodeRepositoryService";
import ProjectService from "../Services/ProjectService";
import AccessTokenService from "../Services/AccessTokenService";
import URL from "../../Types/API/URL";
import UserMiddleware from "../Middleware/UserAuthorization";
import JSONWebToken from "../Utils/JsonWebToken";
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
           * Prove the installation actually belongs to the person completing
           * this redirect, before writing the binding everything downstream
           * trusts.
           *
           * A valid `state` only says "this OneUptime user asked to install
           * something for this project" — it says nothing about WHICH
           * installation, and `installation_id` is an unauthenticated integer
           * in a query string. Without this step anyone could start an install
           * for their own project, then hand-edit the callback URL to a victim's
           * installation ID: OneUptime would record their project as the owner
           * of that installation, import the victim's private repositories into
           * it, and mint write-scoped tokens for them on demand.
           *
           * The OAuth `code` is the missing proof. GitHub mints it for one
           * GitHub account, it is single-use, and trading it in tells us which
           * installations that account can actually administer.
           */
          const oauthCode: string | undefined = req.query["code"]?.toString();

          if (!oauthCode) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                'GitHub did not return an authorization code, so this installation could not be verified. Please enable "Request user authorization (OAuth) during installation" in the GitHub App settings and install again.',
              ),
            );
          }

          try {
            await GitHubUtil.assertUserControlsInstallation({
              oauthCode: oauthCode,
              installationId: installationId,
            });
          } catch (verificationError) {
            logger.error(
              `GitHub Auth Callback: refusing to bind installation ${installationId} to project ${projectId} — could not verify the installing user controls it.`,
              getLogAttributesFromRequest(req as OneUptimeRequest),
            );
            logger.error(
              verificationError,
              getLogAttributesFromRequest(req as OneUptimeRequest),
            );

            return Response.sendErrorResponse(
              req,
              res,
              verificationError instanceof Error
                ? new BadDataException(verificationError.message)
                : new BadDataException(
                    "Could not verify this GitHub App installation.",
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

          /*
           * Import all repositories in the installation automatically so the
           * user does not have to pick them one at a time. Failures are
           * logged but do not fail the callback — the import is retried via
           * the installation_repositories webhook or on reinstall.
           */
          try {
            const importResult: ImportReposFromInstallationResult =
              await CodeRepositoryService.importReposFromInstallation({
                projectId: new ObjectID(projectId),
                installationId: installationId,
              });

            logger.info(
              `GitHub App installation ${installationId}: imported ${importResult.imported} repositories (${importResult.skipped} skipped) into project ${projectId}`,
              getLogAttributesFromRequest(req as OneUptimeRequest),
            );
          } catch (importError) {
            logger.error(
              `GitHub Auth Callback: Failed to import repositories from installation ${installationId} into project ${projectId}:`,
              getLogAttributesFromRequest(req as OneUptimeRequest),
            );
            logger.error(
              importError,
              getLogAttributesFromRequest(req as OneUptimeRequest),
            );
          }

          // Redirect back to dashboard with installation ID
          const redirectUrl: string = `${DashboardClientUrl.toString()}/${projectId}/code-repository?installation_id=${installationId}`;

          return Response.redirect(req, res, URL.fromString(redirectUrl));
        } catch (error) {
          logger.error(
            "GitHub Auth Callback Error:",
            getLogAttributesFromRequest(req as OneUptimeRequest),
          );
          logger.error(
            error,
            getLogAttributesFromRequest(req as OneUptimeRequest),
          );
          return Response.sendErrorResponse(
            req,
            res,
            error instanceof ServerException
              ? error
              : error instanceof Error
                ? new BadDataException(error.message)
                : new BadDataException("An error occurred"),
          );
        }
      },
    );

    // Initiate GitHub App installation
    router.get(
      "/github/auth/install",
      UserMiddleware.getUserMiddleware,
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

          const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;

          /*
           * The state this route signs is what the callback trusts to decide
           * which project gets the installation, so it must only ever be
           * issued to the logged-in user for a project they belong to. Taking
           * the user id from a query parameter — as this route used to — let
           * anyone mint a valid state for any (project, user) pair without
           * even holding a session.
           */
          if (!oneuptimeRequest.userAuthorization) {
            return Response.sendErrorResponse(
              req,
              res,
              new NotAuthenticatedException(
                "Authentication is required to install the GitHub App.",
              ),
            );
          }

          const projectId: string | undefined =
            req.query["projectId"]?.toString();

          if (!projectId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Project ID is required"),
            );
          }

          const userId: string =
            oneuptimeRequest.userAuthorization.userId.toString();

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
          logger.error(
            "GitHub Install Redirect Error:",
            getLogAttributesFromRequest(req as OneUptimeRequest),
          );
          logger.error(
            error,
            getLogAttributesFromRequest(req as OneUptimeRequest),
          );
          return Response.sendErrorResponse(
            req,
            res,
            error instanceof ServerException
              ? error
              : error instanceof Error
                ? new BadDataException(error.message)
                : new BadDataException("An error occurred"),
          );
        }
      },
    );

    /*
     * GET /github/repositories/:projectId/:installationId and
     * POST /github/repository/connect used to live here. Both are gone.
     *
     * Both took an installation ID straight from the caller and checked only
     * that the caller could access the project THEY had named — a comparison
     * the caller controls both sides of, since anyone can create a project and
     * own it. The listing route would then return any installation's private
     * repository list (an enumeration oracle over a small integer space), and
     * the connect route would persist the caller's installation ID onto a
     * CodeRepository row, which is exactly the self-asserted binding the
     * repository-token endpoint later minted a `ghs_` token from.
     *
     * Nothing called them: repositories are imported automatically by the
     * install callback below and kept in sync by the installation webhooks, so
     * the binding is always established by GitHub rather than asserted by a
     * client. There is no supported way to name an installation ID over the
     * API any more, and that is deliberate — see GitHubInstallationBinding.
     */

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

          if (typeof signature !== "string" || !signature) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Missing webhook signature"),
            );
          }

          // Get raw body for signature verification
          const rawBody: string | undefined = (req as OneUptimeRequest).rawBody;
          if (typeof rawBody !== "string") {
            throw new BadDataException(
              "The original GitHub request body is required.",
            );
          }
          if (Buffer.byteLength(rawBody, "utf8") > 25 * 1024 * 1024) {
            throw new BadDataException("GitHub webhook payload exceeds 25 MB.");
          }

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

          logger.debug(
            `Received GitHub webhook event: ${event}`,
            getLogAttributesFromRequest(req as OneUptimeRequest),
          );

          if (event === "ping") {
            return Response.sendJsonObjectResponse(req, res, { success: true });
          }

          const eventHeaderPattern: RegExp = /^[a-z_]+$/;
          if (typeof event !== "string" || !eventHeaderPattern.test(event)) {
            throw new BadDataException(
              "A valid X-GitHub-Event header is required.",
            );
          }

          if (!GitHubWebhookQueue.isSupportedEvent(event)) {
            return Response.sendJsonObjectResponse(req, res, {
              success: true,
              message: "Event is not subscribed to by OneUptime",
            });
          }

          if (
            !req.body ||
            typeof req.body !== "object" ||
            Array.isArray(req.body)
          ) {
            throw new BadDataException("A GitHub webhook object is required.");
          }

          const deliveryId: unknown = req.headers["x-github-delivery"];
          if (typeof deliveryId !== "string") {
            throw new BadDataException("X-GitHub-Delivery is required.");
          }

          const delivery: GitHubWebhookDelivery = {
            event,
            deliveryId,
            payload: req.body as JSONObject,
          };
          GitHubWebhookQueue.validate(delivery);
          try {
            await GitHubWebhookQueue.enqueue(delivery);
          } catch {
            throw new ServerException(
              "GitHub delivery could not be queued. Please redeliver it.",
            );
          }

          return Response.sendJsonObjectResponse(req, res, {
            success: true,
            message: "Webhook queued",
          } as JSONObject);
        } catch (error) {
          logger.error(
            "GitHub Webhook Error:",
            getLogAttributesFromRequest(req as OneUptimeRequest),
          );
          logger.error(
            error,
            getLogAttributesFromRequest(req as OneUptimeRequest),
          );
          return Response.sendErrorResponse(
            req,
            res,
            error instanceof ServerException
              ? error
              : error instanceof Error
                ? new BadDataException(error.message)
                : new BadDataException("An error occurred"),
          );
        }
      },
    );

    return router;
  }
}
