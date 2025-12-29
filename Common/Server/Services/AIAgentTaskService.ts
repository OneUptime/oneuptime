import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/AIAgentTask";
import AIAgent from "../../Models/DatabaseModels/AIAgent";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import BadDataException from "../../Types/Exception/BadDataException";
import AIAgentService from "./AIAgentService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ObjectID from "../../Types/ObjectID";
import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import logger from "../Utils/Logger";
import OneUptimeDate from "../../Types/Date";

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

    // Generate task number
    if (!createBy.data.projectId) {
      throw new BadDataException(
        "Project ID is required to create an AI Agent Task",
      );
    }

    const projectId: ObjectID = createBy.data.projectId;

    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: projectId.toString(),
        namespace: "AIAgentTaskService.task-create",
        lockTimeout: 15000,
        acquireTimeout: 20000,
      });

      logger.debug(
        "Mutex acquired - AIAgentTaskService.task-create " +
          projectId.toString() +
          " at " +
          OneUptimeDate.getCurrentDateAsFormattedString(),
      );
    } catch (err) {
      logger.debug(
        "Mutex acquire failed - AIAgentTaskService.task-create " +
          projectId.toString() +
          " at " +
          OneUptimeDate.getCurrentDateAsFormattedString(),
      );
      logger.error(err);
    }

    try {
      const taskNumberForThisTask: number =
        (await this.getExistingTaskNumberForProject({
          projectId: projectId,
        })) + 1;

      createBy.data.taskNumber = taskNumberForThisTask;
    } finally {
      if (mutex) {
        await Semaphore.release(mutex);
      }
    }

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  public async getExistingTaskNumberForProject(data: {
    projectId: ObjectID;
  }): Promise<number> {
    // get last task number.
    const lastTask: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
      },
      select: {
        taskNumber: true,
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
      props: {
        isRoot: true,
      },
    });

    if (!lastTask) {
      return 0;
    }

    return lastTask.taskNumber ? Number(lastTask.taskNumber) : 0;
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
