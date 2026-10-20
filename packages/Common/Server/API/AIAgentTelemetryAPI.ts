import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import CodeFixAgentAuth, {
  CodeFixAgentIdentity,
} from "../Utils/AI/CodeFix/CodeFixAgentAuth";
import CodeAgentTelemetry, {
  CodeAgentTelemetryCallResult,
  CodeAgentTelemetryToolList,
} from "../Utils/AI/CodeFix/CodeAgentTelemetry";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";

/*
 * The agent worker's protocol for production telemetry: the read-only tools
 * the in-house code agent queries its repository's traces, logs, metrics,
 * exceptions, incidents and deploys with while it reviews or fixes code.
 *
 * As everywhere in the worker's protocol, the worker names only its run
 * (`taskId`): the project, the repository and the services a tool may read
 * follow from the run (CodeAgentTelemetryScope), and the server executes
 * every call (CodeAgentTelemetry) - the Runner holds no credential that
 * reads telemetry.
 *
 * Routes live under /ai-agent-data so the worker has one base path for the
 * whole protocol.
 */
export default class AIAgentTelemetryAPI {
  public router!: ExpressRouter;

  public constructor() {
    this.router = Express.getRouter();

    /*
     * The tools the run is offered, with the repository and services they
     * read and the run's budget - or none, and why.
     *
     * Request:  { aiAgentId, aiAgentKey, taskId }
     * Response: { tools, repository, services, reason, budget }
     */
    this.router.post(
      "/ai-agent-data/get-telemetry-tools",
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          // Answered there when it proves no agent (400), or after too many wrong keys (429).
          const aiAgent: CodeFixAgentIdentity | null =
            await CodeFixAgentAuth.authenticate(req, res);

          if (!aiAgent) {
            return;
          }

          const taskId: ObjectID | null = AIAgentTelemetryAPI.readTaskId(
            req.body,
          );

          if (!taskId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("taskId is required"),
            );
          }

          const list: CodeAgentTelemetryToolList =
            await CodeAgentTelemetry.listTools({
              aiAgent: aiAgent,
              aiRunId: taskId,
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            list as unknown as JSONObject,
          );
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * One tool call. A refusal (the run, the tool, the arguments or the
     * budget) is a 4xx whose message the worker hands the model.
     *
     * Request:  { aiAgentId, aiAgentKey, taskId, toolName, arguments }
     * Response: { output, rowCount, citationLabel, isTruncated, budget }
     */
    this.router.post(
      "/ai-agent-data/run-telemetry-tool",
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const aiAgent: CodeFixAgentIdentity | null =
            await CodeFixAgentAuth.authenticate(req, res);

          if (!aiAgent) {
            return;
          }

          const data: JSONObject = req.body || {};
          const taskId: ObjectID | null = AIAgentTelemetryAPI.readTaskId(data);

          if (!taskId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("taskId is required"),
            );
          }

          const toolName: unknown = data["toolName"];

          if (typeof toolName !== "string" || !toolName.trim()) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("toolName is required"),
            );
          }

          const args: unknown = data["arguments"] ?? {};

          const result: CodeAgentTelemetryCallResult =
            await CodeAgentTelemetry.runTool({
              aiAgent: aiAgent,
              aiRunId: taskId,
              toolName: toolName.trim(),
              args: args as JSONObject,
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            result as unknown as JSONObject,
          );
        } catch (err) {
          next(err);
        }
      },
    );
  }

  // The run a request names, or null when it names none that can be one.
  private static readTaskId(data: JSONObject | undefined): ObjectID | null {
    const taskId: unknown = data?.["taskId"];

    if (typeof taskId !== "string" || !taskId.trim()) {
      return null;
    }

    try {
      return new ObjectID(taskId.trim());
    } catch {
      return null;
    }
  }

  public getRouter(): ExpressRouter {
    return this.router;
  }
}
