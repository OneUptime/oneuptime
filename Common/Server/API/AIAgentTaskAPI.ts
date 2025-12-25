import AIAgentService from "../Services/AIAgentService";
import AIAgentTaskService, {
  Service as AIAgentTaskServiceType,
} from "../Services/AIAgentTaskService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import AIAgentTask from "../../Models/DatabaseModels/AIAgentTask";
import AIAgent from "../../Models/DatabaseModels/AIAgent";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import AIAgentTaskStatus from "../../Types/AI/AIAgentTaskStatus";
import SortOrder from "../../Types/BaseDatabase/SortOrder";

export default class AIAgentTaskAPI extends BaseAPI<
  AIAgentTask,
  AIAgentTaskServiceType
> {
  public constructor() {
    super(AIAgentTask, AIAgentTaskService);

    /*
     * Get the next pending (scheduled) task for processing
     * Validates aiAgentId and aiAgentKey before returning task
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/get-pending-task`,
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

          /* Fetch one scheduled task, sorted by createdAt (oldest first) */
          const task: AIAgentTask | null = await AIAgentTaskService.findOneBy({
            query: {
              status: AIAgentTaskStatus.Scheduled,
            },
            sort: {
              createdAt: SortOrder.Ascending,
            },
            select: {
              _id: true,
              projectId: true,
              taskType: true,
              metadata: true,
              createdAt: true,
            },
            props: {
              isRoot: true,
            },
          });

          if (!task) {
            return Response.sendJsonObjectResponse(req, res, {
              task: null,
              message: "No pending tasks available",
            });
          }

          return Response.sendJsonObjectResponse(req, res, {
            task: {
              _id: task._id?.toString(),
              projectId: task.projectId?.toString(),
              taskType: task.taskType,
              metadata: task.metadata,
              createdAt: task.createdAt,
            },
            message: "Task fetched successfully",
          });
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Update task status (InProgress, Completed, Error)
     * Validates aiAgentId and aiAgentKey before updating
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/update-task-status`,
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

          if (!data["status"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("status is required"),
            );
          }

          const taskId: ObjectID = new ObjectID(data["taskId"] as string);
          const status: AIAgentTaskStatus = data["status"] as AIAgentTaskStatus;
          const statusMessage: string | undefined = data["statusMessage"] as
            | string
            | undefined;

          /* Validate status value */
          const validStatuses: Array<AIAgentTaskStatus> = [
            AIAgentTaskStatus.InProgress,
            AIAgentTaskStatus.Completed,
            AIAgentTaskStatus.Error,
          ];

          if (!validStatuses.includes(status)) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
              ),
            );
          }

          /* Check if task exists */
          const existingTask: AIAgentTask | null =
            await AIAgentTaskService.findOneById({
              id: taskId,
              select: {
                _id: true,
                status: true,
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

          /* Build update data based on status */
          const updateData: Partial<AIAgentTask> = {
            status: status,
            aiAgentId: aiAgent.id,
          };

          if (status === AIAgentTaskStatus.InProgress) {
            updateData.startedAt = OneUptimeDate.getCurrentDate();
          }

          if (
            status === AIAgentTaskStatus.Completed ||
            status === AIAgentTaskStatus.Error
          ) {
            updateData.completedAt = OneUptimeDate.getCurrentDate();
          }

          if (statusMessage) {
            updateData.statusMessage = statusMessage;
          }

          /* Update the task */
          await AIAgentTaskService.updateOneById({
            id: taskId,
            data: updateData,
            props: {
              isRoot: true,
            },
          });

          return Response.sendJsonObjectResponse(req, res, {
            taskId: taskId.toString(),
            status: status,
            message: "Task status updated successfully",
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
