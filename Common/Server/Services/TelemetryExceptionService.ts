import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/TelemetryException";
import ServiceType from "../../Types/Telemetry/ServiceType";
import AIRun from "../../Models/DatabaseModels/AIRun";
import ObjectID from "../../Types/ObjectID";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../Types/Exception/BadDataException";
import AIRunType from "../../Types/AI/AIRunType";
import AIRunStatus from "../../Types/AI/AIRunStatus";
import CodeFixTaskType, {
  CodeFixTaskTypeHelper,
} from "../../Types/AI/CodeFixTaskType";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import AIRunService from "./AIRunService";
import FixRunBudget from "../Utils/AI/CodeFix/FixRunBudget";
import CodeFixReadiness from "../Utils/AI/CodeFix/CodeFixReadiness";
import ServiceService from "./ServiceService";
import CodeRepositoryService from "./CodeRepositoryService";
import { RepoResolution } from "../Utils/CodeRepository/StackTraceRepoResolver";
import {
  AIFixReadiness,
  AIFixReadinessCheck,
} from "../../Types/AI/AIFixReadiness";
import TelemetryService from "../../Models/DatabaseModels/Service";
import QueryHelper from "../Types/Database/QueryHelper";
import ModelPermission from "../Types/Database/Permissions/Index";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Query from "../Types/Database/Query";
import Includes from "../../Types/BaseDatabase/Includes";
import logger from "../Utils/Logger";
import AIAgentTaskPullRequest from "../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIAgentTaskPullRequestService from "./AIAgentTaskPullRequestService";
import PullRequestState from "../../Types/CodeRepository/PullRequestState";
import { normalizeExceptionText } from "../Utils/Telemetry/ExceptionSanitizer";

/*
 * Hard cap on the fingerprint NOT IN list handed to the ClickHouse count
 * query. ClickHouse receives query params via the request URI (default
 * http_max_uri_size 1 MiB ≈ 14k sha256 fingerprints); 5k keeps a wide
 * safety margin while covering all realistic projects.
 */
export const EXCLUDED_FINGERPRINT_LIMIT: number = 5000;

export interface CreateCodeFixRunForExceptionParams {
  telemetryExceptionId: ObjectID;
  props: DatabaseCommonInteractionProps;
  // Which task recipe to run. Defaults to FixException.
  taskType?: CodeFixTaskType | undefined;
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

  /*
   * Everything "Fix with AI Agent" needs, checked BEFORE a task is created
   * (and consumed by the dashboard to render a setup checklist instead of a
   * button that fails minutes later inside the agent container).
   */
  @CaptureSpan()
  public async getAIFixReadiness(params: {
    telemetryExceptionId: ObjectID;
    props: DatabaseCommonInteractionProps;
    /*
     * Overrides the IsBillingEnabled env flag for the balance check — exists
     * so tests can exercise both modes without mocking the module.
     */
    billingEnabled?: boolean;
  }): Promise<AIFixReadiness> {
    const telemetryException: Model | null = await this.findOneById({
      id: params.telemetryExceptionId,
      select: {
        _id: true,
        projectId: true,
        stackTrace: true,
        primaryEntityId: true,
        primaryEntityType: true,
      },
      props: params.props,
    });

    if (!telemetryException || !telemetryException.projectId) {
      throw new BadDataException("Telemetry Exception not found");
    }

    const projectId: ObjectID = telemetryException.projectId;

    /*
     * 1. An LLM provider the agent may use — the same gate the project-wide
     * AI Tasks page renders, so the two surfaces can never disagree about
     * whether this project has a usable provider.
     */
    const llmCheck: AIFixReadinessCheck =
      await CodeFixReadiness.getLlmProviderCheck({
        projectId,
        billingEnabled: params.billingEnabled,
      });

    /*
     * 2. A repository must RESOLVE for this exception — computed at runtime
     * from the stack trace (path matching over connected repos), falling
     * back to service-name matching and the only-repository rule. No manual
     * mapping table, no Service Catalog prerequisite.
     */
    const service: TelemetryService | null = telemetryException.primaryEntityId
      ? await ServiceService.findOneById({
          id: telemetryException.primaryEntityId,
          select: {
            _id: true,
            name: true,
          },
          props: {
            isRoot: true,
          },
        })
      : null;

    let repoCheck: AIFixReadinessCheck;

    try {
      const resolution: RepoResolution | null =
        await CodeRepositoryService.resolveRepositoryForException({
          projectId,
          stackTrace: telemetryException.stackTrace || null,
          serviceName: service?.name || null,
        });

      repoCheck = {
        id: "repositoryResolved",
        ok: Boolean(resolution),
        title: resolution
          ? `Repository resolved: ${resolution.organizationName}/${resolution.repositoryName}`
          : "Repository resolved",
        detail: resolution
          ? ""
          : "No connected repository could be matched to this exception — its stack-trace files were not found in any connected repository, no repository name matches the service, and the project has more than one repository. Connect the right repository through the GitHub App (installing it imports all its repositories automatically).",
      };
    } catch (err) {
      repoCheck = {
        id: "repositoryResolved",
        ok: false,
        title: "Repository resolved",
        detail: `Could not check the connected repositories: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
      };
    }

    // 3. An agent must be alive to pick the task up.
    const agentCheck: AIFixReadinessCheck =
      await CodeFixReadiness.getAgentCheck({
        projectId,
      });

    const checks: Array<AIFixReadinessCheck> = [
      llmCheck,
      repoCheck,
      agentCheck,
    ];

    return {
      ready: checks.every((check: AIFixReadinessCheck) => {
        return check.ok;
      }),
      checks,
    };
  }

  /*
   * "Fix with AI Agent": record the durable intent as a Queued CodeFix
   * AIRun (the unified run substrate — same enqueue semantics as the
   * investigation queue: attemptCount defaults to 0 and no events are
   * written until a worker claims the run). An external agent container
   * claims it via /ai-agent-task/get-pending-task and dispatches on the
   * run's task recipe (codeFixTaskType).
   */
  @CaptureSpan()
  public async createCodeFixRunForException(
    params: CreateCodeFixRunForExceptionParams,
  ): Promise<AIRun> {
    const { telemetryExceptionId, props } = params;

    const taskType: CodeFixTaskType =
      params.taskType || CodeFixTaskType.FixException;

    /*
     * Recipes beyond FixException / WriteRegressionTest are declared in the
     * enum (so workers and the UI can already dispatch on them) but their
     * recipes have not shipped — creating a run for them would queue work no
     * agent can execute.
     */
    if (!CodeFixTaskTypeHelper.isUserTriggerable(taskType)) {
      throw new BadDataException(
        `Task type "${taskType}" is not user-triggerable yet. Supported task types: ${CodeFixTaskTypeHelper.getUserTriggerableTaskTypes().join(
          ", ",
        )}.`,
      );
    }

    // Get the telemetry exception (also the caller's access check).
    const telemetryException: Model | null = await this.findOneById({
      id: telemetryExceptionId,
      select: {
        _id: true,
        projectId: true,
        message: true,
        exceptionType: true,
        isResolved: true,
        isArchived: true,
        aiFixDeclinedAt: true,
      },
      props,
    });

    if (!telemetryException || !telemetryException.projectId) {
      throw new BadDataException("Telemetry Exception not found");
    }

    /*
     * Server-side lifecycle gate (the dashboard hides the button for
     * resolved exceptions, but the API must enforce it — the automatic
     * insight lane and any direct API caller land here too).
     */
    if (telemetryException.isResolved) {
      throw new BadDataException(
        "This exception is marked as resolved. Unresolve it before starting an AI agent task for it.",
      );
    }

    if (telemetryException.isArchived) {
      throw new BadDataException(
        "This exception is archived. Unarchive it before starting an AI agent task for it.",
      );
    }

    /*
     * Human "closed without merging" feedback: when an AI fix PR for this
     * exception was declined, the automatic lane must not keep re-opening
     * PRs for it. A HUMAN clicking "Fix with AI" is an explicit override —
     * it clears the stamp and retries.
     */
    if (telemetryException.aiFixDeclinedAt) {
      if (!props.userId) {
        throw new BadDataException(
          "A previous AI fix pull request for this exception was closed without merging, so automatic fix attempts are paused for it. A user can retry from the exception page.",
        );
      }

      await this.updateOneById({
        id: telemetryExceptionId,
        data: {
          aiFixDeclinedAt: null,
        },
        props: { isRoot: true },
      });
    }

    /*
     * G11 guardrail: the per-project daily fix-run budget. Checked before
     * the (more expensive) readiness probes — an over-budget project gets
     * the budget message, not a readiness one.
     */
    await FixRunBudget.assertWithinBudget(telemetryException.projectId);

    /*
     * Fail early with everything that's missing, instead of creating a run
     * that dies minutes later inside the agent container.
     */
    const readiness: AIFixReadiness = await this.getAIFixReadiness({
      telemetryExceptionId,
      props,
    });

    if (!readiness.ready) {
      const missing: string = readiness.checks
        .filter((check: AIFixReadinessCheck) => {
          return !check.ok;
        })
        .map((check: AIFixReadinessCheck) => {
          return check.title;
        })
        .join(", ");

      throw new BadDataException(
        `Cannot start the AI fix — missing prerequisites: ${missing}.`,
      );
    }

    /*
     * Duplicate guard is per (exception, taskType): an active FixException
     * run must not block queuing a WriteRegressionTest run and vice versa.
     */
    await this.validateNoActiveCodeFixRunExists(telemetryExceptionId, taskType);

    /*
     * Cross-group duplicate guard: interpolated dynamic values (garbage
     * UUIDs, file paths, request payloads) splinter one root cause into
     * many fingerprints, and the per-exception guard above cannot see
     * that. Compare NORMALIZED messages against exceptions that already
     * have an active run or an open AI pull request, so one root cause
     * yields one PR — not one per interpolated variant.
     */
    await this.validateNoOpenFixForSimilarException({
      projectId: telemetryException.projectId,
      telemetryExceptionId: telemetryExceptionId,
      taskType: taskType,
      message: telemetryException.message || "",
      exceptionType: telemetryException.exceptionType || "",
    });

    const run: AIRun = new AIRun();
    run.projectId = telemetryException.projectId;
    run.runType = AIRunType.CodeFix;
    run.codeFixTaskType = taskType;
    run.status = AIRunStatus.Queued;
    run.triggeredByTelemetryExceptionId = telemetryExceptionId;

    // Attribution: the user who clicked "Fix with AI Agent".
    if (props.userId) {
      run.userId = props.userId;
    }

    /*
     * Created as root: AIRun rows are server-written only (empty create
     * ACL); the user's access was already checked by the exception read.
     */
    const createdRun: AIRun = await AIRunService.create({
      data: run,
      props: {
        isRoot: true,
      },
    });

    if (!createdRun.id) {
      throw new BadDataException("Failed to create the AI fix run");
    }

    return createdRun;
  }

  @CaptureSpan()
  private async validateNoActiveCodeFixRunExists(
    telemetryExceptionId: ObjectID,
    taskType: CodeFixTaskType,
  ): Promise<void> {
    const existingRun: AIRun | null = await AIRunService.findOneBy({
      query: {
        runType: AIRunType.CodeFix,
        triggeredByTelemetryExceptionId: telemetryExceptionId,
        /*
         * A null codeFixTaskType means FixException (rows created before
         * task recipes existed), so the FixException guard must also match
         * legacy null rows.
         */
        codeFixTaskType:
          taskType === CodeFixTaskType.FixException
            ? QueryHelper.equalToOrNull(CodeFixTaskType.FixException)
            : taskType,
        // Every terminal status — see AIRunStatusHelper.isTerminalStatus.
        status: QueryHelper.notIn([
          AIRunStatus.Completed,
          AIRunStatus.NoFixFound,
          AIRunStatus.Error,
          AIRunStatus.Cancelled,
          AIRunStatus.Stale,
        ]),
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (existingRun) {
      throw new BadDataException(
        `An AI agent task (${taskType}) is already in progress for this exception. Please wait for it to complete before creating a new one.`,
      );
    }
  }

  /*
   * Cross-group duplicate guard. Two exception groups are "the same work"
   * for the fix lane when their exceptionType and NORMALIZED message match
   * (normalizeExceptionText replaces UUIDs, IDs, emails, paths' dynamic
   * segments, timestamps...). Candidates are the exceptions behind
   * (a) non-terminal CodeFix runs of the same recipe, and (b) OPEN
   * AI-authored pull requests — a completed run whose PR is still open
   * must keep blocking, or every interpolated variant re-fixes the same
   * root cause (observed: 15 near-identical PRs for one invalid-uuid
   * throw site).
   */
  @CaptureSpan()
  private async validateNoOpenFixForSimilarException(data: {
    projectId: ObjectID;
    telemetryExceptionId: ObjectID;
    taskType: CodeFixTaskType;
    message: string;
    exceptionType: string;
  }): Promise<void> {
    const CANDIDATE_LIMIT: number = 100;

    // (a) Exceptions with a non-terminal run of the same recipe.
    const activeRuns: Array<AIRun> = await AIRunService.findBy({
      query: {
        projectId: data.projectId,
        runType: AIRunType.CodeFix,
        /*
         * A null codeFixTaskType means FixException (rows created before
         * task recipes existed) — same legacy-null matching as
         * validateNoActiveCodeFixRunExists.
         */
        codeFixTaskType:
          data.taskType === CodeFixTaskType.FixException
            ? QueryHelper.equalToOrNull(CodeFixTaskType.FixException)
            : data.taskType,
        status: QueryHelper.notIn([
          AIRunStatus.Completed,
          AIRunStatus.NoFixFound,
          AIRunStatus.Error,
          AIRunStatus.Cancelled,
          AIRunStatus.Stale,
        ]),
      },
      select: {
        triggeredByTelemetryExceptionId: true,
      },
      limit: CANDIDATE_LIMIT,
      skip: 0,
      props: { isRoot: true },
    });

    // (b) Exceptions behind still-open AI pull requests.
    const openPullRequests: Array<AIAgentTaskPullRequest> =
      await AIAgentTaskPullRequestService.findBy({
        query: {
          projectId: data.projectId,
          pullRequestState: PullRequestState.Open,
        },
        select: {
          aiRunId: true,
        },
        limit: CANDIDATE_LIMIT,
        skip: 0,
        props: { isRoot: true },
      });

    const openPrRunIds: Array<ObjectID> = openPullRequests
      .map((pullRequest: AIAgentTaskPullRequest) => {
        return pullRequest.aiRunId;
      })
      .filter((runId: ObjectID | undefined): runId is ObjectID => {
        return Boolean(runId);
      });

    const openPrRuns: Array<AIRun> =
      openPrRunIds.length > 0
        ? await AIRunService.findBy({
            query: {
              _id: new Includes(openPrRunIds),
              projectId: data.projectId,
              runType: AIRunType.CodeFix,
              codeFixTaskType:
                data.taskType === CodeFixTaskType.FixException
                  ? QueryHelper.equalToOrNull(CodeFixTaskType.FixException)
                  : data.taskType,
            },
            select: {
              triggeredByTelemetryExceptionId: true,
            },
            limit: CANDIDATE_LIMIT,
            skip: 0,
            props: { isRoot: true },
          })
        : [];

    const candidateExceptionIds: Array<ObjectID> = [];
    const seenIds: Set<string> = new Set<string>();

    for (const run of [...activeRuns, ...openPrRuns]) {
      const exceptionId: ObjectID | undefined =
        run.triggeredByTelemetryExceptionId;

      if (!exceptionId) {
        continue;
      }

      const idString: string = exceptionId.toString();

      if (
        idString === data.telemetryExceptionId.toString() ||
        seenIds.has(idString)
      ) {
        continue;
      }

      seenIds.add(idString);
      candidateExceptionIds.push(exceptionId);
    }

    if (candidateExceptionIds.length === 0) {
      return;
    }

    const targetSignature: string = `${data.exceptionType}|${normalizeExceptionText(
      data.message,
    )}`;

    const candidates: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        _id: new Includes(candidateExceptionIds),
      },
      select: {
        _id: true,
        message: true,
        exceptionType: true,
      },
      limit: CANDIDATE_LIMIT,
      skip: 0,
      props: { isRoot: true },
    });

    for (const candidate of candidates) {
      const candidateSignature: string = `${candidate.exceptionType || ""}|${normalizeExceptionText(
        candidate.message || "",
      )}`;

      if (candidateSignature === targetSignature) {
        throw new BadDataException(
          `A similar exception (same type and normalized message, exception ${candidate._id?.toString()}) already has an AI agent task in progress or an open AI pull request. Review that pull request instead of opening another one for the same root cause.`,
        );
      }
    }
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
}

export default new Service();
