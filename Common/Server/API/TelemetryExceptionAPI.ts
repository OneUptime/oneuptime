import TelemetryException from "../../Models/DatabaseModels/TelemetryException";
import AIRun from "../../Models/DatabaseModels/AIRun";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import TelemetryExceptionService, {
  AIFixReadiness,
  DashboardServiceSummary,
  DashboardSummaryResult,
  Service as TelemetryExceptionServiceType,
} from "../Services/TelemetryExceptionService";
import AIRunService from "../Services/AIRunService";
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
import AIRunStatus, { AIRunStatusHelper } from "../../Types/AI/AIRunStatus";
import CodeFixTaskType, {
  CodeFixTaskTypeHelper,
} from "../../Types/AI/CodeFixTaskType";
import { JSONArray, JSONObject } from "../../Types/JSON";

/*
 * User-facing wording for a code-fix run's status on the exception page —
 * the AIRun analogue of the old AIAgentTaskStatusHelper titles.
 */
const CODE_FIX_STATUS_TEXT: {
  [key in AIRunStatus]: { title: string; description: string };
} = {
  [AIRunStatus.Queued]: {
    title: "Queued",
    description:
      "The fix task is queued and waiting to be picked up by an AI agent.",
  },
  [AIRunStatus.Running]: {
    title: "In Progress",
    description: "An AI agent is working on a fix for this exception.",
  },
  [AIRunStatus.WaitingForApproval]: {
    title: "Waiting for Approval",
    description: "The run is paused waiting for an approval.",
  },
  [AIRunStatus.Completed]: {
    title: "Completed",
    description:
      "The AI agent finished. Review the pull request it opened for the proposed fix.",
  },
  [AIRunStatus.Error]: {
    title: "Error",
    description: "The AI agent could not complete the fix.",
  },
  [AIRunStatus.Cancelled]: {
    title: "Cancelled",
    description: "The fix task was cancelled before an agent completed it.",
  },
  [AIRunStatus.Stale]: {
    title: "Stale",
    description:
      "The AI agent stopped reporting progress and the run was marked as stale. You can retry the fix.",
  },
};

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

    // Get AI Agent Task for an exception
    this.router.get(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/get-ai-agent-task/:telemetryExceptionId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getAIAgentTaskForException(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Everything "Fix with AI Agent" needs, checked up front so the
     * dashboard can render a setup checklist instead of a button that
     * fails minutes later inside the agent container.
     */
    this.router.get(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/ai-fix-readiness/:telemetryExceptionId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getAIFixReadiness(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Aggregated dashboard summary for the Exceptions overview page.
     * Returns counts, top/recent exceptions, and per-service summaries
     * in a single round-trip with one SQL GROUP BY for service aggregation.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/dashboard-summary`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getDashboardSummary(req, res);
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

    /*
     * Optional body: { taskType?: "FixException" | "WriteRegressionTest" }.
     * Unknown strings are rejected here; known-but-not-yet-triggerable
     * recipes (ImproveInstrumentation, ...) are rejected by the service.
     */
    const body: JSONObject = (req.body as JSONObject) || {};

    let taskType: CodeFixTaskType = CodeFixTaskType.FixException;

    if (body["taskType"] !== undefined && body["taskType"] !== null) {
      const rawTaskType: unknown = body["taskType"];

      if (
        typeof rawTaskType !== "string" ||
        !CodeFixTaskTypeHelper.isValidTaskType(rawTaskType)
      ) {
        throw new BadDataException(
          `Invalid taskType. Valid values: ${Object.values(
            CodeFixTaskType,
          ).join(", ")}.`,
        );
      }

      taskType = rawTaskType;
    }

    // Create the code-fix AIRun using the service
    const createdRun: AIRun = await this.service.createCodeFixRunForException({
      telemetryExceptionId,
      props,
      taskType,
    });

    /*
     * `aiAgentTaskId` is the legacy JSON key the dashboard still navigates
     * with — it now carries the AIRun id. `aiRunId` is the honest name.
     */
    return Response.sendJsonObjectResponse(req, res, {
      aiAgentTaskId: createdRun.id!.toString(),
      aiRunId: createdRun.id!.toString(),
      taskType: taskType,
    });
  }

  private async getAIAgentTaskForException(
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

    /*
     * Access check under the USER's permissions: code-fix runs are
     * system-written AIRuns (hidden from the caller by the per-user privacy
     * pin on the generic CRUD), so confirm the caller can read the
     * exception first and then read the run as root — the same pattern as
     * AIInvestigationAPI.
     */
    const telemetryException: TelemetryException | null =
      await this.service.findOneById({
        id: telemetryExceptionId,
        select: {
          _id: true,
        },
        props,
      });

    if (!telemetryException) {
      throw new BadDataException(
        "Telemetry Exception not found (or you do not have access to it).",
      );
    }

    /*
     * Return the LATEST run PER TASK TYPE (at most one per CodeFixTaskType,
     * newest first) so the exception page can show a FixException run and a
     * WriteRegressionTest run side by side. Runs are returned regardless of
     * status: errored runs must stay visible (a failed fix must not silently
     * vanish with the button just reappearing).
     *
     * Back-compat: `hasActiveTask` / `aiAgentTask` still reflect the latest
     * run OVERALL, for clients that predate task recipes.
     */
    const runs: Array<AIRun> =
      await AIRunService.getLatestCodeFixRunPerTaskType({
        telemetryExceptionId,
      });

    if (runs.length === 0) {
      return Response.sendJsonObjectResponse(req, res, {
        hasActiveTask: false,
        aiAgentTask: null,
        aiAgentTasks: [],
      });
    }

    const toTaskJson: (run: AIRun) => JSONObject = (run: AIRun): JSONObject => {
      const status: AIRunStatus = run.status || AIRunStatus.Queued;

      return {
        _id: run.id?.toString(),
        status: status,
        statusMessage: run.errorMessage,
        statusTitle: CODE_FIX_STATUS_TEXT[status]?.title,
        statusDescription: CODE_FIX_STATUS_TEXT[status]?.description,
        createdAt: run.createdAt,
        // Normalized by the service: legacy null rows read as FixException.
        taskType: CodeFixTaskTypeHelper.fromDatabaseValue(run.codeFixTaskType),
      };
    };

    // Newest first — the first element is the latest run overall.
    const latestRunOverall: AIRun = runs[0]!;
    const latestStatus: AIRunStatus =
      latestRunOverall.status || AIRunStatus.Queued;

    return Response.sendJsonObjectResponse(req, res, {
      hasActiveTask: !AIRunStatusHelper.isTerminalStatus(latestStatus),
      aiAgentTask: toTaskJson(latestRunOverall),
      aiAgentTasks: runs.map(toTaskJson),
    });
  }

  private async getAIFixReadiness(
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

    const readiness: AIFixReadiness = await this.service.getAIFixReadiness({
      telemetryExceptionId,
      props,
    });

    return Response.sendJsonObjectResponse(req, res, {
      ready: readiness.ready,
      checks: readiness.checks as unknown as JSONArray,
    });
  }

  private async getDashboardSummary(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const summary: DashboardSummaryResult =
      await this.service.getDashboardSummary(props);

    const topExceptionsJson: JSONArray = BaseModel.toJSONArray(
      summary.topExceptions,
      TelemetryException,
    );

    const recentExceptionsJson: JSONArray = BaseModel.toJSONArray(
      summary.recentExceptions,
      TelemetryException,
    );

    const serviceSummariesJson: JSONArray = summary.serviceSummaries.map(
      (entry: DashboardServiceSummary): JSONObject => {
        /*
         * serviceId is polymorphic; the client resolves the display name
         * per serviceType (no Service relation to serialize anymore).
         */
        return {
          primaryEntityId: entry.primaryEntityId,
          primaryEntityType: entry.primaryEntityType,
          unresolvedCount: entry.unresolvedCount,
          totalOccurrences: entry.totalOccurrences,
        };
      },
    );

    return Response.sendJsonObjectResponse(req, res, {
      unresolvedCount: summary.unresolvedCount,
      resolvedCount: summary.resolvedCount,
      archivedCount: summary.archivedCount,
      topExceptions: topExceptionsJson,
      recentExceptions: recentExceptionsJson,
      serviceSummaries: serviceSummariesJson,
    });
  }
}
