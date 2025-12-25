import TelemetryException from "../../Models/DatabaseModels/TelemetryException";
import AIAgentTask from "../../Models/DatabaseModels/AIAgentTask";
import AIAgentTaskTelemetryException from "../../Models/DatabaseModels/AIAgentTaskTelemetryException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import TelemetryExceptionService, {
  Service as TelemetryExceptionServiceType,
} from "../Services/TelemetryExceptionService";
import AIAgentTaskService from "../Services/AIAgentTaskService";
import AIAgentTaskTelemetryExceptionService from "../Services/AIAgentTaskTelemetryExceptionService";
import UserMiddleware from "../Middleware/UserAuthorization";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import AIAgentTaskType from "../../Types/AI/AIAgentTaskType";
import AIAgentTaskStatus from "../../Types/AI/AIAgentTaskStatus";
import { FixExceptionTaskMetadata } from "../../Types/AI/AIAgentTaskMetadata";

export default class TelemetryExceptionAPI extends BaseAPI<
  TelemetryException,
  TelemetryExceptionServiceType
> {
  public constructor() {
    super(TelemetryException, TelemetryExceptionService);

    // Create AI Agent Task for an exception
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/create-ai-agent-task/:telemetryExceptionId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.createAIAgentTask(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  private async createAIAgentTask(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const telemetryExceptionIdParam: string | undefined =
      req.params["telemetryExceptionId"];

    if (!telemetryExceptionIdParam) {
      throw new BadDataException("Telemetry Exception ID is required");
    }

    let telemetryExceptionId: ObjectID;

    try {
      telemetryExceptionId = new ObjectID(telemetryExceptionIdParam);
    } catch {
      throw new BadDataException("Invalid Telemetry Exception ID");
    }

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    // Get the telemetry exception to verify it exists and get the details
    const telemetryException: TelemetryException | null =
      await this.service.findOneById({
        id: telemetryExceptionId,
        select: {
          _id: true,
          projectId: true,
          message: true,
          stackTrace: true,
          telemetryServiceId: true,
        },
        props,
      });

    if (!telemetryException || !telemetryException.projectId) {
      throw new NotFoundException("Telemetry Exception not found");
    }

    // Create the AI Agent Task
    const aiAgentTask: AIAgentTask = new AIAgentTask();
    aiAgentTask.projectId = telemetryException.projectId;
    aiAgentTask.taskType = AIAgentTaskType.FixException;
    aiAgentTask.status = AIAgentTaskStatus.Scheduled;

    // Build metadata
    const metadata: FixExceptionTaskMetadata = {
      taskType: AIAgentTaskType.FixException,
      exceptionId: telemetryExceptionId.toString(),
    };

    if (telemetryException.stackTrace) {
      metadata.stackTrace = telemetryException.stackTrace;
    }

    if (telemetryException.message) {
      metadata.errorMessage = telemetryException.message;
    }

    if (telemetryException.telemetryServiceId) {
      metadata.telemetryServiceId =
        telemetryException.telemetryServiceId.toString();
    }

    aiAgentTask.metadata = metadata;

    // Create the task
    const createdTask: AIAgentTask = await AIAgentTaskService.create({
      data: aiAgentTask,
      props: {
        ...props,
      },
    });

    if (!createdTask.id) {
      throw new BadDataException("Failed to create AI Agent Task");
    }

    // Create the link between the task and exception
    const taskExceptionLink: AIAgentTaskTelemetryException =
      new AIAgentTaskTelemetryException();
    taskExceptionLink.projectId = telemetryException.projectId;
    taskExceptionLink.aiAgentTaskId = createdTask.id;
    taskExceptionLink.telemetryExceptionId = telemetryExceptionId;

    await AIAgentTaskTelemetryExceptionService.create({
      data: taskExceptionLink,
      props: {
        ...props,
      },
    });

    return Response.sendJsonObjectResponse(req, res, {
      aiAgentTaskId: createdTask.id.toString(),
    });
  }
}
