import AIAgentTaskLogService, {
  Service as AIAgentTaskLogServiceType,
} from "../Services/AIAgentTaskLogService";
import AIAgentService from "../Services/AIAgentService";
import AIAgentTaskService from "../Services/AIAgentTaskService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import AIAgentTaskLog from "../../Models/DatabaseModels/AIAgentTaskLog";
import AIAgent from "../../Models/DatabaseModels/AIAgent";
import AIAgentTask from "../../Models/DatabaseModels/AIAgentTask";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import LogSeverity from "../../Types/Log/LogSeverity";

export default class AIAgentTaskLogAPI extends BaseAPI<
  AIAgentTaskLog,
  AIAgentTaskLogServiceType
> {
  public constructor() {
    super(AIAgentTaskLog, AIAgentTaskLogService);

    /*
     * Create a log entry for an AI Agent task
     * Validates aiAgentId and aiAgentKey before creating log
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

          const taskId: ObjectID = new ObjectID(data["taskId"] as string);
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

          /* Check if task exists and get project ID */
          const existingTask: AIAgentTask | null =
            await AIAgentTaskService.findOneById({
              id: taskId,
              select: {
                _id: true,
                projectId: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!existingTask) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Task not found"),
            );
          }

          /* Create the log entry */
          const logEntry: AIAgentTaskLog = new AIAgentTaskLog();
          logEntry.projectId = existingTask.projectId!;
          logEntry.aiAgentTaskId = taskId;
          logEntry.aiAgentId = aiAgent.id!;
          logEntry.severity = severity;
          logEntry.message = message;

          await AIAgentTaskLogService.create({
            data: logEntry,
            props: {
              isRoot: true,
            },
          });

          return Response.sendJsonObjectResponse(req, res, {
            taskId: taskId.toString(),
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
