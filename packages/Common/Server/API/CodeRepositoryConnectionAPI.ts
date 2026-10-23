import UserMiddleware from "../Middleware/UserAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import GitHubConnectAccess, { GitHubConnectCaller } from "./GitHubConnectAccess";
import CodeRepositoryConnector, {
  CodeHostConnectionSource,
} from "../Utils/CodeRepository/CodeHost/CodeRepositoryConnector";
import { CODE_REPOSITORY_CONNECTION_API_PATH } from "../../Types/CodeRepository/CodeHostConnect";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";

/*
 * CODE: CONNECTING REPOSITORIES THAT ARE NOT ON GITHUB.
 *
 *   POST /code-repository-connection/repositories   the repositories a token
 *                                                   reaches on a GitLab,
 *                                                   Forgejo or Gitea server
 *                                                   (or an existing
 *                                                   connection), a page at a
 *                                                   time
 *   POST /code-repository-connection/connect        connect the ones picked
 *   POST /code-repository-connection/connect-git    connect a Git repository
 *                                                   by its HTTPS address
 *   POST /code-repository-connection/list           the project's connections,
 *                                                   to pick one again
 *   POST /code-repository-connection/:id/token      replace a connection's
 *                                                   token
 *
 * Every route acts as a signed-in person, in the project of the request,
 * who may add code repositories to it - what connecting GitHub asks
 * (GitHubConnectAccess: a member, a credential that may make changes, the
 * plan code repositories are sold on, and permission to create code
 * repositories). What each does is CodeRepositoryConnector's: it checks the
 * token with the Git server through the guarded transport, and keeps it
 * encrypted. No route ever answers with a token.
 */
export default class CodeRepositoryConnectionAPI {
  public router!: ExpressRouter;

  public constructor() {
    this.router = Express.getRouter();
    this.initRoutes();
  }

  public getRouter(): ExpressRouter {
    return this.router;
  }

  private initRoutes(): void {
    this.route("/repositories", async (body: JSONObject, caller: GitHubConnectCaller): Promise<JSONObject> => {
      const source: CodeHostConnectionSource =
        CodeRepositoryConnector.readSource(body);

      return (await CodeRepositoryConnector.listRepositories({
        projectId: caller.projectId,
        source,
        search: typeof body["search"] === "string" ? body["search"] : "",
        page: typeof body["page"] === "number" ? body["page"] : 1,
      })) as unknown as JSONObject;
    });

    this.route("/connect", async (body: JSONObject, caller: GitHubConnectCaller): Promise<JSONObject> => {
      const source: CodeHostConnectionSource =
        CodeRepositoryConnector.readSource(body);
      const repositoryIds: unknown = body["repositoryIds"];

      if (!Array.isArray(repositoryIds)) {
        throw new BadDataException("Pick at least one repository to connect.");
      }

      return (await CodeRepositoryConnector.connect({
        projectId: caller.projectId,
        userId: caller.userId,
        source,
        repositoryIds: repositoryIds.filter((id: unknown): id is string => {
          return typeof id === "string";
        }),
      })) as unknown as JSONObject;
    });

    this.route("/connect-git", async (body: JSONObject, caller: GitHubConnectCaller): Promise<JSONObject> => {
      return (await CodeRepositoryConnector.connectGitRepository({
        projectId: caller.projectId,
        userId: caller.userId,
        url: body["url"],
        username: body["username"],
        password: body["password"],
        connectWithoutCheck: body["connectWithoutCheck"] === true,
      })) as unknown as JSONObject;
    });

    this.route("/list", async (_body: JSONObject, caller: GitHubConnectCaller): Promise<JSONObject> => {
      return {
        connections: (await CodeRepositoryConnector.listConnections(
          caller.projectId,
        )) as unknown as Array<JSONObject>,
      };
    });

    this.route(
      "/:connectionId/token",
      async (body: JSONObject, caller: GitHubConnectCaller, req: ExpressRequest): Promise<JSONObject> => {
        return (await CodeRepositoryConnector.replaceToken({
          projectId: caller.projectId,
          connectionId: String(req.params["connectionId"] || ""),
          token: body["token"],
          username: body["username"],
        })) as unknown as JSONObject;
      },
    );
  }

  private route(
    path: string,
    handler: (
      body: JSONObject,
      caller: GitHubConnectCaller,
      req: ExpressRequest,
    ) => Promise<JSONObject>,
  ): void {
    this.router.post(
      `${CODE_REPOSITORY_CONNECTION_API_PATH}${path}`,
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const caller: GitHubConnectCaller =
            await GitHubConnectAccess.assertMayStart(req);

          const body: JSONObject =
            req.body && typeof req.body === "object" && !Array.isArray(req.body)
              ? (req.body as JSONObject)
              : {};

          Response.sendJsonObjectResponse(
            req,
            res,
            await handler(body, caller, req),
          );
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
