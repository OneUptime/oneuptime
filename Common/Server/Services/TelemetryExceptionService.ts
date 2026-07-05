import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/TelemetryException";
import ServiceType from "../../Types/Telemetry/ServiceType";
import AIAgentTask from "../../Models/DatabaseModels/AIAgentTask";
import AIAgentTaskTelemetryException from "../../Models/DatabaseModels/AIAgentTaskTelemetryException";
import ObjectID from "../../Types/ObjectID";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../Types/Exception/BadDataException";
import AIAgentTaskType from "../../Types/AI/AIAgentTaskType";
import AIAgentTaskStatus from "../../Types/AI/AIAgentTaskStatus";
import { FixExceptionTaskMetadata } from "../../Types/AI/AIAgentTaskMetadata";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import AIAgentTaskService from "./AIAgentTaskService";
import AIAgentTaskTelemetryExceptionService from "./AIAgentTaskTelemetryExceptionService";
import QueryHelper from "../Types/Database/QueryHelper";
import ModelPermission from "../Types/Database/Permissions/Index";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Query from "../Types/Database/Query";
import Includes from "../../Types/BaseDatabase/Includes";
import logger from "../Utils/Logger";

/*
 * Hard cap on the fingerprint NOT IN list handed to the ClickHouse count
 * query. ClickHouse receives query params via the request URI (default
 * http_max_uri_size 1 MiB ≈ 14k sha256 fingerprints); 5k keeps a wide
 * safety margin while covering all realistic projects.
 */
export const EXCLUDED_FINGERPRINT_LIMIT: number = 5000;

export interface CreateAIAgentTaskForExceptionParams {
  telemetryExceptionId: ObjectID;
  props: DatabaseCommonInteractionProps;
}

export interface DashboardServiceSummary {
  /*
   * Polymorphic: a real Service, a Host/DockerHost/KubernetesCluster id, or
   * the projectId for unattributed telemetry. The client resolves the
   * display name per primaryEntityType.
   */
  primaryEntityId: string;
  primaryEntityType: ServiceType | null;
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
        primaryEntityId: true,
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
      // primaryEntityId is polymorphic; the client resolves it per primaryEntityType.
      primaryEntityId: true,
      primaryEntityType: true,
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

  /**
   * Fingerprints of exception groups marked resolved and/or archived —
   * used by the exception monitor to exclude occurrences of those groups
   * from the exception count. Resolution state lives on this Postgres
   * model per (projectId, primaryEntityId, fingerprint) group, while
   * occurrences live in ClickHouse; fingerprints are the join key.
   * Fingerprints hash projectId + primaryEntityId into the digest, so a
   * fingerprint never collides across services and excluding by
   * fingerprint alone is exact.
   *
   * The result is capped at EXCLUDED_FINGERPRINT_LIMIT, keeping the most
   * recently seen groups: the ClickHouse client ships query params in the
   * request URI, so an unbounded NOT IN list would blow past ClickHouse's
   * http_max_uri_size (~1 MiB, roughly 14k fingerprints) and hard-fail the
   * monitor's count query. Overflow groups simply stay counted (fail-open:
   * better a stale incident than a silently swallowed one), and the
   * lastSeenAt-descending order means what gets dropped is the groups
   * least likely to have occurrences in the monitor window.
   *
   * Deliberately NO lastSeenAt lower bound: ExceptionInstance.time is the
   * client-reported occurrence timestamp while lastSeenAt is server-side
   * ingest time, so any window-derived cutoff breaks under client clock
   * skew (and under monitor configs with no time window at all).
   */
  @CaptureSpan()
  public async getResolvedOrArchivedFingerprints(data: {
    projectId: ObjectID;
    telemetryServiceIds?: Array<ObjectID> | undefined;
    resolved: boolean;
    archived: boolean;
  }): Promise<Array<string>> {
    const statusFilters: Array<Query<Model>> = [];

    if (data.resolved) {
      statusFilters.push({ isResolved: true });
    }

    if (data.archived) {
      statusFilters.push({ isArchived: true });
    }

    if (statusFilters.length === 0) {
      return [];
    }

    // resolved-OR-archived needs two indexed lookups — findBy has no OR.
    const resultsPerStatus: Array<Array<Model>> = await Promise.all(
      statusFilters.map(
        async (statusFilter: Query<Model>): Promise<Array<Model>> => {
          const query: Query<Model> = {
            projectId: data.projectId,
            ...statusFilter,
          };

          if (data.telemetryServiceIds && data.telemetryServiceIds.length > 0) {
            query.primaryEntityId = new Includes(data.telemetryServiceIds);
          }

          /*
           * Per-status limit equals the final cap: the merged most-recent
           * EXCLUDED_FINGERPRINT_LIMIT groups are necessarily within the
           * top EXCLUDED_FINGERPRINT_LIMIT of their own status query.
           */
          return this.findBy({
            query: query,
            select: {
              fingerprint: true,
              lastSeenAt: true,
            },
            sort: {
              lastSeenAt: SortOrder.Descending,
            },
            limit: EXCLUDED_FINGERPRINT_LIMIT,
            skip: 0,
            props: {
              isRoot: true,
            },
          });
        },
      ),
    );

    // Merge the status lists most-recently-seen first, dedupe, then cap.
    const merged: Array<Model> = resultsPerStatus
      .flat()
      .sort((a: Model, b: Model): number => {
        return (b.lastSeenAt?.getTime() || 0) - (a.lastSeenAt?.getTime() || 0);
      });

    const fingerprints: Set<string> = new Set<string>();
    let truncated: boolean = false;

    for (const exception of merged) {
      if (!exception.fingerprint) {
        continue;
      }
      if (fingerprints.size >= EXCLUDED_FINGERPRINT_LIMIT) {
        truncated = true;
        break;
      }
      fingerprints.add(exception.fingerprint);
    }

    if (truncated) {
      logger.warn(
        `TelemetryException fingerprint exclusion list for project ${data.projectId.toString()} exceeds ${EXCLUDED_FINGERPRINT_LIMIT}; least recently seen resolved/archived exception groups will still be counted by exception monitors.`,
      );
    }

    return Array.from(fingerprints);
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
      primaryEntityId: string | null;
      primaryEntityType: string | null;
      unresolvedCount: string;
      totalOccurrences: string | null;
    }

    const rows: Array<AggregateRow> = (await this.getQueryBuilder(
      "TelemetryException",
    )
      .select(`"TelemetryException"."primaryEntityId"`, "primaryEntityId")
      .addSelect(
        `"TelemetryException"."primaryEntityType"`,
        "primaryEntityType",
      )
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
      .andWhere(`"TelemetryException"."primaryEntityId" IS NOT NULL`)
      .groupBy(`"TelemetryException"."primaryEntityId"`)
      .addGroupBy(`"TelemetryException"."primaryEntityType"`)
      .orderBy(`"unresolvedCount"`, "DESC")
      .getRawMany()) as Array<AggregateRow>;

    if (rows.length === 0) {
      return [];
    }

    /*
     * primaryEntityId is polymorphic — do NOT resolve it to a Service here. The
     * old code looked each primaryEntityId up in the Service table and dropped
     * any that didn't match, which silently excluded Host / DockerHost /
     * KubernetesCluster and unattributed (Unknown) telemetry. Return the
     * raw (primaryEntityId, primaryEntityType) + counts; the client resolves the
     * display name per primaryEntityType.
     */
    const summaries: Array<DashboardServiceSummary> = [];
    for (const row of rows) {
      if (!row.primaryEntityId) {
        continue;
      }
      summaries.push({
        primaryEntityId: row.primaryEntityId,
        primaryEntityType:
          (row.primaryEntityType as ServiceType | null) ?? null,
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

    if (telemetryException.primaryEntityId) {
      metadata.serviceId = telemetryException.primaryEntityId.toString();
    }

    return metadata;
  }
}

export default new Service();
