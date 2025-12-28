import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/AIAgentTask";
import TelemetryException from "../../Models/DatabaseModels/TelemetryException";
import AIAgentTaskTelemetryException from "../../Models/DatabaseModels/AIAgentTaskTelemetryException";
import ObjectID from "../../Types/ObjectID";
import BadDataException from "../../Types/Exception/BadDataException";
import AIAgentTaskType from "../../Types/AI/AIAgentTaskType";
import AIAgentTaskStatus from "../../Types/AI/AIAgentTaskStatus";
import { FixExceptionTaskMetadata } from "../../Types/AI/AIAgentTaskMetadata";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import AIAgentTaskTelemetryExceptionService from "./AIAgentTaskTelemetryExceptionService";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export interface CreateTaskForTelemetryExceptionParams {
  telemetryException: TelemetryException;
  telemetryExceptionId: ObjectID;
  props: DatabaseCommonInteractionProps;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  public async createTaskForTelemetryException(
    params: CreateTaskForTelemetryExceptionParams,
  ): Promise<Model> {
    const { telemetryException, telemetryExceptionId, props } = params;

    if (!telemetryException.projectId) {
      throw new BadDataException("Telemetry Exception must have a project ID");
    }

    // Check if an active AI agent task already exists for this exception
    const existingTaskLink: AIAgentTaskTelemetryException | null =
      await AIAgentTaskTelemetryExceptionService.findOneBy({
        query: {
          telemetryExceptionId: telemetryExceptionId,
          aiAgentTask: {
            status: QueryHelper.notIn([
              AIAgentTaskStatus.Completed,
              AIAgentTaskStatus.Error,
            ]),
          },
        },
        select: {
          _id: true,
          aiAgentTaskId: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (existingTaskLink) {
      throw new BadDataException(
        "An AI agent task is already in progress for this exception. Please wait for it to complete before creating a new one.",
      );
    }

    // Create the AI Agent Task
    const aiAgentTask: Model = new Model();
    aiAgentTask.projectId = telemetryException.projectId;
    aiAgentTask.taskType = AIAgentTaskType.FixException;
    aiAgentTask.status = AIAgentTaskStatus.Scheduled;

    // Set name and description based on exception details
    const exceptionType: string =
      telemetryException.exceptionType || "Exception";
    const exceptionMessage: string =
      telemetryException.message || "No message available";

    aiAgentTask.name = `Fix ${exceptionType}: ${exceptionMessage}`;
    aiAgentTask.description = `AI Agent task to fix the exception: ${exceptionMessage}`;

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
    const createdTask: Model = await this.create({
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

    return createdTask;
  }
}

export default new Service();
