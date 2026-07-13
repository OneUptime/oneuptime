import AIAgentTaskLogService, {
  Service as AIAgentTaskLogServiceType,
} from "../Services/AIAgentTaskLogService";
import AIAgentService from "../Services/AIAgentService";
import AIRunService from "../Services/AIRunService";
import AIRunEventService from "../Services/AIRunEventService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import AIAgentTaskLog from "../../Models/DatabaseModels/AIAgentTaskLog";
import AIAgent from "../../Models/DatabaseModels/AIAgent";
import AIRun from "../../Models/DatabaseModels/AIRun";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import AIRunStatus from "../../Types/AI/AIRunStatus";
import AIRunEventType from "../../Types/AI/AIRunEventType";
import LogSeverity from "../../Types/Log/LogSeverity";

export default class AIAgentTaskLogAPI extends BaseAPI<
  AIAgentTaskLog,
  AIAgentTaskLogServiceType
> {
  public constructor() {
    super(AIAgentTaskLog, AIAgentTaskLogService);

    /*
     * Record a progress log line for a code-fix run. The route name and
     * request shape are unchanged from the legacy AIAgentTaskLog days, but
     * `taskId` now carries an AIRun id and the line lands as a ProgressLog
     * AIRunEvent in the run's glass-box trail (message + severity in
     * resultSummary). Each log also touches the run heartbeat so a chatty
     * agent is never swept as stale. Validates aiAgentId and aiAgentKey.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/create-log`,
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

          await AIRunEventService.appendEventToRun({
            projectId: existingRun.projectId,
            aiRunId: runId,
            eventType: AIRunEventType.ProgressLog,
            resultSummary: {
              message: message,
              severity: severity,
            },
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
