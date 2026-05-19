import TelemetryException from "../../Models/DatabaseModels/TelemetryException";
import TelemetryServiceModel from "../../Models/DatabaseModels/Service";
import AIAgentTask from "../../Models/DatabaseModels/AIAgentTask";
import AIAgentTaskTelemetryException from "../../Models/DatabaseModels/AIAgentTaskTelemetryException";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import TelemetryExceptionService, {
  DashboardServiceSummary,
  DashboardSummaryResult,
  Service as TelemetryExceptionServiceType,
} from "../Services/TelemetryExceptionService";
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
import AIAgentTaskStatus, {
  AIAgentTaskStatusHelper,
} from "../../Types/AI/AIAgentTaskStatus";
import QueryHelper from "../Types/Database/QueryHelper";
import { JSONArray, JSONObject } from "../../Types/JSON";

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

    // Create the AI Agent Task using the service
    const createdTask: AIAgentTask =
      await this.service.createAIAgentTaskForException({
        telemetryExceptionId,
        props,
      });

    return Response.sendJsonObjectResponse(req, res, {
      aiAgentTaskId: createdTask.id!.toString(),
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

    // Find the most recent AI agent task for this exception that is not completed or errored
    const taskLink: AIAgentTaskTelemetryException | null =
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
          aiAgentTask: {
            _id: true,
            status: true,
            statusMessage: true,
            createdAt: true,
          },
        },
        props,
      });

    if (!taskLink || !taskLink.aiAgentTask) {
      return Response.sendJsonObjectResponse(req, res, {
        hasActiveTask: false,
        aiAgentTask: null,
      });
    }

    const task: AIAgentTask = taskLink.aiAgentTask;

    return Response.sendJsonObjectResponse(req, res, {
      hasActiveTask: true,
      aiAgentTask: {
        _id: task.id?.toString(),
        status: task.status,
        statusMessage: task.statusMessage,
        statusTitle: task.status
          ? AIAgentTaskStatusHelper.getTitle(task.status)
          : undefined,
        statusDescription: task.status
          ? AIAgentTaskStatusHelper.getDescription(task.status)
          : undefined,
        createdAt: task.createdAt,
      },
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
        return {
          service: BaseModel.toJSON(entry.service, TelemetryServiceModel),
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
