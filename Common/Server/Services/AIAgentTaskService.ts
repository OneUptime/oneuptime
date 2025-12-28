import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/AIAgentTask";
import AIAgent from "../../Models/DatabaseModels/AIAgent";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import BadDataException from "../../Types/Exception/BadDataException";
import AIAgentService from "./AIAgentService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ObjectID from "../../Types/ObjectID";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    // If no aiAgentId is provided, assign one automatically
    if (!createBy.data.aiAgentId) {
      createBy.data.aiAgentId = await this.getDefaultAgentId(createBy);
    } else {
      // Validate the provided aiAgentId
      await this.validateAgentBelongsToProject(createBy);
    }

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  private async getDefaultAgentId(
    createBy: CreateBy<Model>,
  ): Promise<ObjectID> {
    if (!createBy.data.projectId) {
      throw new BadDataException(
        "Project ID is required to assign an AI Agent",
      );
    }

    // Try to get the default agent for the project (or global fallback)
    const agent: AIAgent | null = await AIAgentService.getAIAgentForProject(
      createBy.data.projectId,
    );

    if (!agent || !agent.id) {
      throw new BadDataException(
        "No AI Agent available. Please configure an AI Agent for this project or ensure a global AI Agent is available.",
      );
    }

    return agent.id!;
  }

  @CaptureSpan()
  private async validateAgentBelongsToProject(
    createBy: CreateBy<Model>,
  ): Promise<void> {
    if (!createBy.data.aiAgentId || !createBy.data.projectId) {
      return;
    }

    const agent: AIAgent | null = await AIAgentService.findOneById({
      id: createBy.data.aiAgentId,
      select: {
        _id: true,
        projectId: true,
        isGlobalAIAgent: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!agent) {
      throw new BadDataException("AI Agent not found");
    }

    // Allow if it's a global agent
    if (agent.isGlobalAIAgent) {
      return;
    }

    // Allow if the agent belongs to the same project
    if (
      agent.projectId &&
      agent.projectId.toString() === createBy.data.projectId.toString()
    ) {
      return;
    }

    // Reject if the agent belongs to a different project
    throw new BadDataException(
      "The specified AI Agent does not belong to this project. Please use an AI Agent from your project or a global AI Agent.",
    );
  }
}

export default new Service();
