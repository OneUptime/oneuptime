import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import logger from "../Utils/Logger";
import AIRunService from "../Services/AIRunService";
import CodeRepositoryService from "../Services/CodeRepositoryService";
import CodeFixAgentAuth, {
  CodeFixAgentIdentity,
} from "../Utils/AI/CodeFix/CodeFixAgentAuth";
import CodeTaskAgentBrief from "../Utils/AI/CodeTask/CodeTaskAgentBrief";
import { getRepositoryNotReachableMessage } from "../Utils/AI/CodeTask/CodeTaskGate";
import CodeHostAccess, {
  CodeHostConnectionState,
  CodeHostConnectionSummary,
} from "../Utils/CodeRepository/CodeHost/CodeHostAccess";
import AIRun from "../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../Models/DatabaseModels/CodeRepository";
import AIRunType from "../../Types/AI/AIRunType";
import { CodeTaskAgentDetails } from "../../Types/AI/CodeTask";
import { getCodeTaskRequest } from "../../Types/AI/CodeFixTaskContext";
import { CodeFixTaskTypeHelper } from "../../Types/AI/CodeFixTaskType";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";

/*
 * The agent worker's protocol for requests from Code: everything one turn
 * needs - the repository, the branch to work on, what was asked now and the
 * conversation before it (CodeTaskAgentBrief).
 *
 * As for GitHub runs, the worker names only the run (`taskId`); the
 * repository, the branch and the text all come from the run's own record.
 * A worker that could name a repository could be pointed at any repository
 * the project's installation reaches.
 */
export default class AIAgentCodeTaskAPI {
  public router!: ExpressRouter;

  public constructor() {
    this.router = Express.getRouter();

    this.router.post(
      "/ai-agent-data/get-code-task-details",
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

          let taskId: ObjectID;

          try {
            taskId = new ObjectID(data["taskId"] as string);
          } catch {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Task not found"),
            );
          }

          const run: AIRun | null = await AIRunService.findOneById({
            id: taskId,
            select: {
              _id: true,
              projectId: true,
              runType: true,
              codeFixTaskType: true,
              codeRepositoryId: true,
              codeTaskId: true,
              userId: true,
              taskContext: true,
            },
            props: { isRoot: true },
          });

          /*
           * A denial answers exactly like a missing run, so a probing key
           * cannot tell another tenant's run from no run.
           */
          if (
            !run ||
            !run.projectId ||
            run.runType !== AIRunType.CodeFix ||
            CodeFixAgentAuth.deniesAccessToProject(aiAgent, run.projectId)
          ) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Task not found"),
            );
          }

          if (
            !CodeFixTaskTypeHelper.isCodeRequest(run.codeFixTaskType) ||
            !getCodeTaskRequest(run.taskContext)
          ) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("This task is not a request from Code."),
            );
          }

          const repository: CodeRepository | null = run.codeRepositoryId
            ? await CodeRepositoryService.findOneById({
                id: run.codeRepositoryId,
                select: {
                  _id: true,
                  projectId: true,
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

          if (
            !repository ||
            repository.projectId?.toString() !== run.projectId.toString()
          ) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "The repository this request was made in is no longer connected to the project.",
              ),
            );
          }

          /*
           * Reachability is checked again here, as for every token: a
           * request can wait in the queue while the GitHub App is
           * uninstalled, or the repository's access token is refused.
           */
          const connection: CodeHostConnectionSummary | undefined = (
            await CodeHostAccess.getConnectionSummaries({
              projectId: run.projectId,
              repositoryIds: [repository.id!],
            })
          ).get(repository.id!.toString());

          if (
            !connection ||
            connection.state !== CodeHostConnectionState.Connected
          ) {
            logger.error(
              `Refusing code task details for run ${run.id?.toString()}: repository ${repository.id?.toString()} is not reachable (${connection?.state || "unknown"}).`,
            );

            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                getRepositoryNotReachableMessage(connection),
              ),
            );
          }

          const details: CodeTaskAgentDetails = await CodeTaskAgentBrief.build({
            run,
            repository,
          });

          return Response.sendJsonObjectResponse(
            req,
            res,
            details as unknown as JSONObject,
          );
        } catch (err) {
          next(err);
        }
      },
    );
  }

  public getRouter(): ExpressRouter {
    return this.router;
  }
}
