import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/AIAgentTaskTelemetryException";
import ObjectID from "../../Types/ObjectID";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export interface LinkTaskToTelemetryExceptionParams {
  projectId: ObjectID;
  aiAgentTaskId: ObjectID;
  telemetryExceptionId: ObjectID;
  props: DatabaseCommonInteractionProps;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  public async linkTaskToTelemetryException(
    params: LinkTaskToTelemetryExceptionParams,
  ): Promise<Model> {
    const { projectId, aiAgentTaskId, telemetryExceptionId, props } = params;

    const taskExceptionLink: Model = new Model();
    taskExceptionLink.projectId = projectId;
    taskExceptionLink.aiAgentTaskId = aiAgentTaskId;
    taskExceptionLink.telemetryExceptionId = telemetryExceptionId;

    return await this.create({
      data: taskExceptionLink,
      props: {
        ...props,
      },
    });
  }
}

export default new Service();
