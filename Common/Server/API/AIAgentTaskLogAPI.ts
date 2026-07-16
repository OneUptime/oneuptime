import AIAgentService from "../Services/AIAgentService";
import AIRunService from "../Services/AIRunService";
import AIRunEventService from "../Services/AIRunEventService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import AIAgent from "../../Models/DatabaseModels/AIAgent";
import AIRun from "../../Models/DatabaseModels/AIRun";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import AIRunStatus from "../../Types/AI/AIRunStatus";
import AIRunEventType from "../../Types/AI/AIRunEventType";
import LogSeverity from "../../Types/Log/LogSeverity";

/*
 * The agent worker's progress-log protocol. The route name predates the
 * AIRun substrate (the legacy AIAgentTaskLog MODEL is gone — this is a
 * plain protocol router, not a CRUD API); log lines land as ProgressLog
 * AIRunEvents on the run's glass-box trail.
 */

const API_BASE_PATH: string = "/ai-agent-task-log";

export default class AIAgentTaskLogAPI {
  public router!: ExpressRouter;

  public constructor() {
    this.router = Express.getRouter();

    /*
     * Record a progress log line for a code-fix run. The route name and
     * request shape are unchanged from the legacy AIAgentTaskLog days, but
     * `taskId` now carries an AIRun id and the line lands as a ProgressLog
     * AIRunEvent in the run's glass-box trail (message + severity in
     * resultSummary). Each log also touches the run heartbeat so a chatty
     * agent is never swept as stale. Validates aiAgentId and aiAgentKey.
     */
    this.router.post(
      `${API_BASE_PATH}/create-log`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const data: JSONObject = req.body;

          /* Validate AI Agent credentials */
          const aiAgent: AIAgent | null = await this.validateAIAgent(data);

          if (!aiAgent) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid AI Agent ID or AI Agent Key"),
            );
          }

          /* Validate required fields */
          if (!data["taskId"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("taskId is required"),
            );
          }

          if (!data["severity"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("severity is required"),
            );
          }

          if (!data["message"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("message is required"),
            );
          }

          const runId: ObjectID = new ObjectID(data["taskId"] as string);
          const severity: LogSeverity = data["severity"] as LogSeverity;
          const message: string = data["message"] as string;

          /* Validate severity value */
          const validSeverities: Array<LogSeverity> =
            Object.values(LogSeverity);
          if (!validSeverities.includes(severity)) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                `Invalid severity. Must be one of: ${validSeverities.join(", ")}`,
              ),
            );
          }

          /* Check if the run exists and get its project ID */
          const existingRun: AIRun | null = await AIRunService.findOneById({
            id: runId,
            select: {
              _id: true,
              projectId: true,
            },
            props: {
              isRoot: true,
            },
          });

          if (!existingRun || !existingRun.projectId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Task not found"),
            );
          }

          /*
           * Optional verbatim tool detail (see TaskLogger.toolCall): the
           * arguments as executed and the full output the model saw, recorded
           * on the run's transcript for the Logs page. Absent it — an older
           * agent — behaviour is exactly as before.
           *
           * The event type stays ProgressLog even when the detail is present.
           * That is deliberate, not laziness: the Overview's ChatActivityFeed
           * renders a ProgressLog by printing resultSummary.message, but
           * renders a ToolCallCompleted by trying to COMPLETE a matching
           * running step from an earlier ToolCallStarted — an event the
           * code-fix path never emits. Typing these as ToolCallCompleted
           * therefore matched nothing and silently erased every tool line from
           * the Overview feed. The payload rides on the same event instead.
           */
          const toolName: string | undefined = data["toolName"] as
            | string
            | undefined;
          const toolArguments: JSONObject | undefined = data[
            "toolArguments"
          ] as JSONObject | undefined;
          const toolResult: string | undefined = data["toolResult"] as
            | string
            | undefined;

          await AIRunEventService.appendEventToRun({
            projectId: existingRun.projectId,
            aiRunId: runId,
            eventType: AIRunEventType.ProgressLog,
            resultSummary: {
              message: message,
              severity: severity,
            },
            ...(toolName ? { toolName: toolName } : {}),
            /*
             * toolArguments (the column) is deliberately NOT written: its read
             * ACL is project-member-wide, and a write_file call's arguments are
             * the file's full new content. The same arguments go onto
             * contentPayload below, whose read ACL is empty and which only the
             * owner/admin-gated logs endpoint returns.
             */
            ...(toolName
              ? {
                  contentPayload: {
                    ...(toolResult !== undefined
                      ? { toolResult: toolResult }
                      : {}),
                    ...(toolArguments
                      ? {
                          responseToolCalls: [
                            { name: toolName, arguments: toolArguments },
                          ],
                        }
                      : {}),
                  },
                }
              : {}),
          });

          /* A progress report proves the agent is alive — refresh the heartbeat. */
          await AIRunService.updateOneBy({
            query: {
              _id: runId.toString(),
              status: AIRunStatus.Running,
            },
            data: {
              lastHeartbeatAt: OneUptimeDate.getCurrentDate(),
            } as never,
            props: {
              isRoot: true,
            },
          });

          return Response.sendJsonObjectResponse(req, res, {
            taskId: runId.toString(),
            message: "Log entry created successfully",
          });
        } catch (err) {
          next(err);
        }
      },
    );
  }

  public getRouter(): ExpressRouter {
    return this.router;
  }

  /*
   * Validate AI Agent credentials from request body
   * Returns AIAgent if valid, null otherwise
   */
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
      },
      props: {
        isRoot: true,
      },
    });

    return aiAgent;
  }
}
