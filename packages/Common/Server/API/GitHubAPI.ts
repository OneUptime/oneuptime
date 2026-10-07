import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BadDataException from "../../Types/Exception/BadDataException";
import Exception from "../../Types/Exception/Exception";
import logger, { getLogAttributesFromRequest } from "../Utils/Logger";
import { JSONArray, JSONObject } from "../../Types/JSON";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import {
  GitHubAppClientId,
  GitHubAppClientSecret,
  GitHubAppName,
  HomeClientUrl,
} from "../EnvironmentConfig";
import ObjectID from "../../Types/ObjectID";
import GitHubUtil from "../Utils/CodeRepository/GitHub/GitHub";
import GitHubWebhookHandler, {
  GitHubWebhookHandlingResult,
} from "../Utils/CodeRepository/GitHub/GitHubWebhookHandler";
import CodeRepositoryService, {
  ImportReposFromInstallationResult,
} from "../Services/CodeRepositoryService";
import ProjectService from "../Services/ProjectService";
import Project from "../../Models/DatabaseModels/Project";
import UserMiddleware from "../Middleware/UserAuthorization";
import WorkspaceOAuthState, {
  WorkspaceOAuthFlow,
  WorkspaceOAuthStateRecord,
} from "../Utils/Workspace/WorkspaceOAuthState";
import GitHubConnectAccess, { GitHubConnectCaller } from "./GitHubConnectAccess";
import ConnectCallback, {
  ConnectCallbackFinish,
  ConnectCallbackRefusal,
} from "./ConnectCallback";
import {
  ConnectCallbackError,
  ConnectProvider,
} from "../../Types/Workspace/ConnectCallback";

export default class GitHubAPI {
  /*
   * Resolves the projects linked to a GitHub App installation.
   *
   * Project.gitHubAppInstallationId is the only source consulted, because it
   * is the only one GitHub has vouched for — the install callback writes it
   * after verifying the installer controls the installation, and the
   * uninstall webhook clears it.
   *
   * This used to fall back to CodeRepository rows carrying the installation
   * ID. That inverted the trust: a row is supposed to derive its right to an
   * installation FROM its project, so letting a row nominate its project as a
   * link target meant anyone who could write an installation ID onto a row in
   * their own project would have that project treated as an owner of the
   * installation — and every webhook would then import the victim's
   * repositories into it.
   */
  private static async getProjectIdsForInstallation(
    installationId: string,
  ): Promise<Array<ObjectID>> {
    const projectIds: Array<ObjectID> = [];

    const projects: Array<Project> = await ProjectService.findBy({
      query: {
        gitHubAppInstallationId: installationId,
      },
      select: {
        _id: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const project of projects) {
      if (project.id) {
        projectIds.push(project.id);
      }
    }

    return projectIds;
  }

  // Imports all repositories in an installation into every project linked to it.
  private static async importInstallationRepositoriesForLinkedProjects(
    installationId: string,
  ): Promise<void> {
    const projectIds: Array<ObjectID> =
      await GitHubAPI.getProjectIdsForInstallation(installationId);

    if (projectIds.length === 0) {
      logger.info(
        `GitHub webhook: no projects linked to installation ${installationId}. Skipping repository import.`,
      );
      return;
    }

    for (const projectId of projectIds) {
      const importResult: ImportReposFromInstallationResult =
        await CodeRepositoryService.importReposFromInstallation({
          projectId: projectId,
          installationId: installationId,
        });

      logger.info(
        `GitHub webhook: imported ${importResult.imported} repositories (${importResult.skipped} skipped) into project ${projectId.toString()} for installation ${installationId}`,
      );
    }
  }

  /*
   * Deletes CodeRepository rows for repositories that were removed from the
   * installation. Once a repository is removed we can no longer mint tokens
   * for it, so keeping the row around is a dead end. Uses the service delete
   * so cascades / SET NULLs apply.
   */
  private static async removeRepositoriesForInstallation(
    installationId: string,
    removedRepositories: JSONArray,
  ): Promise<void> {
    for (const removedRepository of removedRepositories) {
      const fullName: string | undefined = (removedRepository as JSONObject)?.[
        "full_name"
      ]?.toString();

      if (!fullName) {
        continue;
      }

      const slashIndex: number = fullName.indexOf("/");

      if (slashIndex <= 0) {
        continue;
      }

      const organizationName: string = fullName.substring(0, slashIndex);
      const repositoryName: string = fullName.substring(slashIndex + 1);

      const deletedCount: number = await CodeRepositoryService.deleteBy({
        query: {
          gitHubAppInstallationId: installationId,
          organizationName: organizationName,
          repositoryName: repositoryName,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      logger.info(
        `GitHub webhook: removed ${deletedCount} repository record(s) for ${fullName} (installation ${installationId})`,
      );
    }
  }

  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    /*
     * Where GitHub sends the browser back once the app is installed (the
     * app's Callback URL and Setup URL both point here).
     *
     * Nothing in the redirect says which project or person this is for. Both
     * come from the one-use state the start route recorded, spent here
     * (WorkspaceOAuthState): one that is unknown, already used, expired,
     * issued for another flow or brought back by another browser is refused.
     * Then, in order, before anything is written: the person the state names
     * may still add code repositories to that project (GitHubConnectAccess),
     * GitHub returned an installation and an authorization code, and the code
     * proves the GitHub account completing the redirect controls that
     * installation. ConnectCallback.route answers every way this can end on
     * Code Repositories, with a code - never with what GitHub or a failed
     * read said.
     */
    router.get(
      "/github/auth/callback",
      ConnectCallback.route({
        provider: ConnectProvider.GitHub,
        /*
         * "Redirect on update": once an installation is changed on GitHub
         * itself, GitHub sends the browser here with no state of ours. There
         * is nothing to connect - the installation webhooks keep the
         * repositories in sync - so the browser goes to Code Repositories,
         * with nothing to refuse.
         */
        isProviderRedirect: (req: ExpressRequest): boolean => {
          return (
            !req.query["state"] &&
            req.query["setup_action"]?.toString() === "update"
          );
        },
        spendState: (
          req: ExpressRequest,
        ): Promise<WorkspaceOAuthStateRecord | null> => {
          return WorkspaceOAuthState.consume({
            req,
            state: req.query["state"]?.toString(),
            flows: [WorkspaceOAuthFlow.GitHubAppInstall],
          });
        },
        askAgain: (record: WorkspaceOAuthStateRecord): Promise<void> => {
          return GitHubConnectAccess.assertMayFinish(record);
        },
        refusedAs: ConnectCallbackError.NoPermission,
        finish: async (data: ConnectCallbackFinish): Promise<void> => {
          const { req, record } = data;
          const projectId: ObjectID = record.projectId;

          if (!GitHubAppClientId || !GitHubAppClientSecret) {
            throw new ConnectCallbackRefusal(
              ConnectCallbackError.NotConfigured,
              "GITHUB_APP_CLIENT_ID or GITHUB_APP_CLIENT_SECRET is not set, so no installation can be verified.",
            );
          }

          const providerError: ConnectCallbackRefusal | null =
            ConnectCallback.refusalOfProviderError(req);

          if (providerError) {
            throw providerError;
          }

          // GitHub sends installation_id in query params after app installation
          const installationId: string | undefined =
            req.query["installation_id"]?.toString();

          if (!installationId) {
            throw new ConnectCallbackRefusal(
              ConnectCallbackError.GitHubNoInstallation,
              `GitHub sent no installation back (setup_action: ${String(req.query["setup_action"] || "none")}).`,
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
            throw new ConnectCallbackRefusal(
              ConnectCallbackError.GitHubNoAuthorization,
              'GitHub sent no authorization code back: "Request user authorization (OAuth) during installation" must be on in the GitHub App settings.',
            );
          }

          try {
            await GitHubUtil.assertUserControlsInstallation({
              oauthCode: oauthCode,
              installationId: installationId,
            });
          } catch (verificationError) {
            /*
             * Whatever GitHub or the request said is logged here and never
             * shown: the page is told the installation was not verified.
             */
            logger.error(
              `GitHub Auth Callback: refusing to bind installation ${installationId} to project ${projectId.toString()} — could not verify the installing user controls it.`,
              getLogAttributesFromRequest(req as OneUptimeRequest),
            );
            logger.error(
              verificationError,
              getLogAttributesFromRequest(req as OneUptimeRequest),
            );

            throw new ConnectCallbackRefusal(
              ConnectCallbackError.GitHubNotVerified,
              `The GitHub account completing the redirect was not verified to control installation ${installationId}.`,
            );
          }

          /*
           * Store the installation ID in the project
           * This allows reuse when connecting additional repositories
           */
          await ProjectService.updateOneById({
            id: projectId,
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
                projectId: projectId,
                installationId: installationId,
              });

            logger.info(
              `GitHub App installation ${installationId}: imported ${importResult.imported} repositories (${importResult.skipped} skipped) into project ${projectId.toString()}`,
              getLogAttributesFromRequest(req as OneUptimeRequest),
            );
          } catch (importError) {
            logger.error(
              `GitHub Auth Callback: Failed to import repositories from installation ${installationId} into project ${projectId.toString()}:`,
              getLogAttributesFromRequest(req as OneUptimeRequest),
            );
            logger.error(
              importError,
              getLogAttributesFromRequest(req as OneUptimeRequest),
            );
          }

          // Back to Code Repositories, which shows the connection was made.
          data.backToPage({ installation_id: installationId });
        },
      }),
    );

    /*
     * Start connecting a GitHub App installation to the project.
     *
     * Returns the GitHub installation URL for the dashboard to navigate to,
     * for a signed-in member who may add code repositories to the project the
     * request names (GitHubConnectAccess). Its `state` is a one-use token
     * recorded for that person and project and bound to this browser
     * (WorkspaceOAuthState), which is all the callback above trusts.
     */
    router.get(
      "/github/install-url",
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          if (!GitHubAppName) {
            throw new BadDataException(
              "GitHub App is not configured. Please set GITHUB_APP_NAME.",
            );
          }

          const caller: GitHubConnectCaller =
            await GitHubConnectAccess.assertMayStart(req);

          const { state } = await WorkspaceOAuthState.create({
            req,
            res,
            flow: WorkspaceOAuthFlow.GitHubAppInstall,
            projectId: caller.projectId,
            userId: caller.userId,
          });

          const callbackUrl: string = `${HomeClientUrl.toString()}api/github/auth/callback`;
          const installUrl: string = `https://github.com/apps/${encodeURIComponent(
            GitHubAppName,
          )}/installations/new?state=${encodeURIComponent(
            state,
          )}&redirect_uri=${encodeURIComponent(callbackUrl)}`;

          return Response.sendJsonObjectResponse(req, res, {
            installUrl: installUrl,
          });
        } catch (error) {
          return Response.sendErrorResponse(req, res, error as Exception);
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

          if (!signature) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Missing webhook signature"),
            );
          }

          /*
           * The signature covers the bytes GitHub SENT, so it has to be
           * checked against those bytes. This used to re-serialize the parsed
           * body with JSON.stringify, which only verifies when GitHub's
           * payload happens to be a fixed point of parse-then-stringify —
           * every \uXXXX escape, renormalized number and reordered numeric
           * key silently became "Invalid webhook signature" instead. The
           * express json parser already captures the real body for exactly
           * this purpose (see jsonBodyParserOptions in StartServer).
           *
           * A missing rawBody is a misconfiguration (a route mounted without
           * that parser), and it fails closed: verifying a body we did not
           * capture is not something to guess at.
           */
          const rawBody: string | undefined = (req as OneUptimeRequest).rawBody;

          if (!rawBody) {
            logger.error(
              "Rejecting GitHub webhook: the raw request body was not captured, so its signature cannot be verified.",
              getLogAttributesFromRequest(req as OneUptimeRequest),
            );

            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Could not verify webhook signature"),
            );
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

          // Handle installation events - install and uninstall of the app
          if (event === "installation") {
            const action: string | undefined = (req.body as JSONObject)?.[
              "action"
            ]?.toString();
            const installationId: string | undefined = (
              (req.body as JSONObject)?.["installation"] as JSONObject
            )?.["id"]?.toString();

            /*
             * App installed - import all repositories in the installation
             * into any project linked to it. This covers installs done
             * directly from GitHub (marketplace) without our redirect flow.
             */
            if (action === "created" && installationId) {
              try {
                await GitHubAPI.importInstallationRepositoriesForLinkedProjects(
                  installationId,
                );
              } catch (importError) {
                logger.error(
                  `Failed to import repositories for GitHub App installation ${installationId}:`,
                  getLogAttributesFromRequest(req as OneUptimeRequest),
                );
                logger.error(
                  importError,
                  getLogAttributesFromRequest(req as OneUptimeRequest),
                );
              }
            }

            if (action === "deleted" && installationId) {
              logger.info(
                `GitHub App installation ${installationId} was deleted. Clearing from database...`,
                getLogAttributesFromRequest(req as OneUptimeRequest),
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
                  getLogAttributesFromRequest(req as OneUptimeRequest),
                );
              } catch (clearError) {
                logger.error(
                  `Failed to clear GitHub App installation ${installationId} from database:`,
                  getLogAttributesFromRequest(req as OneUptimeRequest),
                );
                logger.error(
                  clearError,
                  getLogAttributesFromRequest(req as OneUptimeRequest),
                );
              }
            }
          }

          /*
           * Handle repositories being added to / removed from the
           * installation so connected repositories stay in sync with GitHub
           * without any manual picking.
           */
          if (event === "installation_repositories") {
            const body: JSONObject = req.body as JSONObject;
            const installationId: string | undefined = (
              body["installation"] as JSONObject
            )?.["id"]?.toString();

            if (installationId) {
              const repositoriesAdded: JSONArray =
                (body["repositories_added"] as JSONArray) || [];
              const repositoriesRemoved: JSONArray =
                (body["repositories_removed"] as JSONArray) || [];

              if (repositoriesAdded.length > 0) {
                try {
                  await GitHubAPI.importInstallationRepositoriesForLinkedProjects(
                    installationId,
                  );
                } catch (importError) {
                  logger.error(
                    `Failed to import added repositories for GitHub App installation ${installationId}:`,
                    getLogAttributesFromRequest(req as OneUptimeRequest),
                  );
                  logger.error(
                    importError,
                    getLogAttributesFromRequest(req as OneUptimeRequest),
                  );
                }
              }

              if (repositoriesRemoved.length > 0) {
                try {
                  await GitHubAPI.removeRepositoriesForInstallation(
                    installationId,
                    repositoriesRemoved,
                  );
                } catch (removeError) {
                  logger.error(
                    `Failed to remove repositories for GitHub App installation ${installationId}:`,
                    getLogAttributesFromRequest(req as OneUptimeRequest),
                  );
                  logger.error(
                    removeError,
                    getLogAttributesFromRequest(req as OneUptimeRequest),
                  );
                }
              }
            }
          }

          /*
           * The interactive surface: mentions, assignments, trigger labels
           * and review requests. It is deliberately the LAST thing this
           * handler does and it never throws — the installation bookkeeping
           * above must not be undone by a comment that could not be posted,
           * and an exception escaping to GitHub becomes a redelivery of the
           * same payload forever.
           */
          const interactiveResult: GitHubWebhookHandlingResult =
            await GitHubWebhookHandler.handleEvent({
              event: event,
              deliveryId: req.headers["x-github-delivery"] as
                | string
                | undefined,
              payload: req.body as JSONObject,
            });

          return Response.sendJsonObjectResponse(req, res, {
            success: true,
            message: "Webhook received",
            handled: interactiveResult.handled,
            outcome: interactiveResult.outcome,
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
