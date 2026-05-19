import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/TelemetryException";
import TelemetryServiceModel from "../../Models/DatabaseModels/Service";
import AIAgentTask from "../../Models/DatabaseModels/AIAgentTask";
import AIAgentTaskTelemetryException from "../../Models/DatabaseModels/AIAgentTaskTelemetryException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../Types/Exception/BadDataException";
import AIAgentTaskType from "../../Types/AI/AIAgentTaskType";
import AIAgentTaskStatus from "../../Types/AI/AIAgentTaskStatus";
import { FixExceptionTaskMetadata } from "../../Types/AI/AIAgentTaskMetadata";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import AIAgentTaskService from "./AIAgentTaskService";
import AIAgentTaskTelemetryExceptionService from "./AIAgentTaskTelemetryExceptionService";
import ServiceService from "./ServiceService";
import QueryHelper from "../Types/Database/QueryHelper";
import ModelPermission from "../Types/Database/Permissions/Index";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export interface CreateAIAgentTaskForExceptionParams {
  telemetryExceptionId: ObjectID;
  props: DatabaseCommonInteractionProps;
}

export interface DashboardServiceSummary {
  service: TelemetryServiceModel;
  unresolvedCount: number;
  totalOccurrences: number;
}

export interface DashboardSummaryResult {
  unresolvedCount: number;
  resolvedCount: number;
  archivedCount: number;
  topExceptions: Array<Model>;
  recentExceptions: Array<Model>;
  serviceSummaries: Array<DashboardServiceSummary>;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  public async createAIAgentTaskForException(
    params: CreateAIAgentTaskForExceptionParams,
  ): Promise<AIAgentTask> {
    const { telemetryExceptionId, props } = params;

    // Get the telemetry exception
    const telemetryException: Model | null = await this.findOneById({
      id: telemetryExceptionId,
      select: {
        _id: true,
        projectId: true,
        message: true,
        stackTrace: true,
        serviceId: true,
        exceptionType: true,
      },
      props,
    });

    if (!telemetryException || !telemetryException.projectId) {
      throw new BadDataException("Telemetry Exception not found");
    }

    // Check if an active AI agent task already exists for this exception
    await this.validateNoActiveTaskExists(telemetryExceptionId);

    // Create the AI Agent Task
    const createdTask: AIAgentTask = await this.createFixExceptionTask({
      telemetryException,
      telemetryExceptionId,
      props,
    });

    // Link the task to the telemetry exception
    await AIAgentTaskTelemetryExceptionService.linkTaskToTelemetryException({
      projectId: telemetryException.projectId,
      aiAgentTaskId: createdTask.id!,
      telemetryExceptionId,
      props,
    });

    return createdTask;
  }

  @CaptureSpan()
  private async validateNoActiveTaskExists(
    telemetryExceptionId: ObjectID,
  ): Promise<void> {
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
  }

  @CaptureSpan()
  private async createFixExceptionTask(params: {
    telemetryException: Model;
    telemetryExceptionId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<AIAgentTask> {
    const { telemetryException, telemetryExceptionId, props } = params;

    const aiAgentTask: AIAgentTask = new AIAgentTask();
    aiAgentTask.projectId = telemetryException.projectId!;
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
    aiAgentTask.metadata = this.buildFixExceptionMetadata({
      telemetryException,
      telemetryExceptionId,
    });

    const createdTask: AIAgentTask = await AIAgentTaskService.create({
      data: aiAgentTask,
      props: {
        ...props,
      },
    });

    if (!createdTask.id) {
      throw new BadDataException("Failed to create AI Agent Task");
    }

    return createdTask;
  }

  @CaptureSpan()
  public async getDashboardSummary(
    props: DatabaseCommonInteractionProps,
  ): Promise<DashboardSummaryResult> {
    if (!props.tenantId) {
      throw new BadDataException("Project ID is required");
    }

    const projectId: ObjectID = props.tenantId;

    const exceptionSelect: any = {
      _id: true,
      message: true,
      exceptionType: true,
      fingerprint: true,
      isResolved: true,
      isArchived: true,
      occuranceCount: true,
      lastSeenAt: true,
      firstSeenAt: true,
      environment: true,
      service: {
        _id: true,
        name: true,
        serviceColor: true,
      },
    };

    const [
      unresolvedCount,
      resolvedCount,
      archivedCount,
      topExceptions,
      recentExceptions,
      serviceSummaries,
    ] = await Promise.all([
      this.countBy({
        query: {
          projectId,
          isResolved: false,
          isArchived: false,
        },
        props,
      }),
      this.countBy({
        query: {
          projectId,
          isResolved: true,
          isArchived: false,
        },
        props,
      }),
      this.countBy({
        query: {
          projectId,
          isArchived: true,
        },
        props,
      }),
      this.findBy({
        query: {
          projectId,
          isResolved: false,
          isArchived: false,
        },
        select: exceptionSelect,
        limit: 10,
        skip: 0,
        sort: {
          occuranceCount: SortOrder.Descending,
        },
        props,
      }),
      this.findBy({
        query: {
          projectId,
          isResolved: false,
          isArchived: false,
        },
        select: exceptionSelect,
        limit: 5,
        skip: 0,
        sort: {
          lastSeenAt: SortOrder.Descending,
        },
        props,
      }),
      this.aggregateUnresolvedByService(projectId, props),
    ]);

    return {
      unresolvedCount: unresolvedCount.toNumber(),
      resolvedCount: resolvedCount.toNumber(),
      archivedCount: archivedCount.toNumber(),
      topExceptions,
      recentExceptions,
      serviceSummaries,
    };
  }

  @CaptureSpan()
  private async aggregateUnresolvedByService(
    projectId: ObjectID,
    props: DatabaseCommonInteractionProps,
  ): Promise<Array<DashboardServiceSummary>> {
    /*
     * Assert the caller has read permission on TelemetryException. We don't
     * use the returned filtered query — we run a raw GROUP BY below for
     * efficiency — but this throws if the user lacks read access.
     */
    await ModelPermission.checkReadQueryPermission(
      Model,
      {
        projectId,
        isResolved: false,
        isArchived: false,
      },
      null,
      props,
    );

    interface AggregateRow {
      serviceId: string | null;
      unresolvedCount: string;
      totalOccurrences: string | null;
    }

    const rows: Array<AggregateRow> = (await this.getQueryBuilder(
      "TelemetryException",
    )
      .select(`"TelemetryException"."serviceId"`, "serviceId")
      .addSelect(`COUNT(*)`, "unresolvedCount")
      .addSelect(
        `COALESCE(SUM("TelemetryException"."occuranceCount"), 0)`,
        "totalOccurrences",
      )
      .where(`"TelemetryException"."projectId" = :projectId`, {
        projectId: projectId.toString(),
      })
      .andWhere(`"TelemetryException"."isResolved" = false`)
      .andWhere(`"TelemetryException"."isArchived" = false`)
      .andWhere(`"TelemetryException"."deletedAt" IS NULL`)
      .andWhere(`"TelemetryException"."serviceId" IS NOT NULL`)
      .groupBy(`"TelemetryException"."serviceId"`)
      .orderBy(`"unresolvedCount"`, "DESC")
      .getRawMany()) as Array<AggregateRow>;

    if (rows.length === 0) {
      return [];
    }

    const serviceIds: Array<string> = [];
    for (const row of rows) {
      if (row.serviceId) {
        serviceIds.push(row.serviceId);
      }
    }

    if (serviceIds.length === 0) {
      return [];
    }

    const services: Array<TelemetryServiceModel> = await ServiceService.findBy({
      query: {
        projectId,
        _id: QueryHelper.any(serviceIds),
      },
      select: {
        _id: true,
        name: true,
        serviceColor: true,
      },
      limit: new PositiveNumber(serviceIds.length),
      skip: new PositiveNumber(0),
      props,
    });

    const serviceById: Map<string, TelemetryServiceModel> = new Map();
    for (const service of services) {
      if (service._id) {
        serviceById.set(service._id, service);
      }
    }

    const summaries: Array<DashboardServiceSummary> = [];
    for (const row of rows) {
      if (!row.serviceId) {
        continue;
      }
      const service: TelemetryServiceModel | undefined = serviceById.get(
        row.serviceId,
      );
      if (!service) {
        continue;
      }
      summaries.push({
        service,
        unresolvedCount: parseInt(row.unresolvedCount, 10) || 0,
        totalOccurrences: parseInt(row.totalOccurrences || "0", 10) || 0,
      });
    }

    return summaries;
  }

  private buildFixExceptionMetadata(params: {
    telemetryException: Model;
    telemetryExceptionId: ObjectID;
  }): FixExceptionTaskMetadata {
    const { telemetryException, telemetryExceptionId } = params;

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

    if (telemetryException.serviceId) {
      metadata.serviceId = telemetryException.serviceId.toString();
    }

    return metadata;
  }
}

export default new Service();
