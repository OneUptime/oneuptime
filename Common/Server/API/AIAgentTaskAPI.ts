import AIAgentService from "../Services/AIAgentService";
import AIRunService from "../Services/AIRunService";
import AIRunEventService from "../Services/AIRunEventService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import AIAgent from "../../Models/DatabaseModels/AIAgent";
import AIRun from "../../Models/DatabaseModels/AIRun";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import AIAgentTaskStatus from "../../Types/AI/AIAgentTaskStatus";
import AIRunStatus from "../../Types/AI/AIRunStatus";
import AIRunType from "../../Types/AI/AIRunType";
import AIRunEventType from "../../Types/AI/AIRunEventType";
import { CodeFixTaskTypeHelper } from "../../Types/AI/CodeFixTaskType";
import PositiveNumber from "../../Types/PositiveNumber";

/*
 * The agent worker's task protocol. The route names and request shapes are
 * unchanged from the legacy AIAgentTask days (the wire keeps the
 * AIAgentTaskStatus strings), but the substrate underneath is the unified
 * AIRun table: `taskId` carries an AIRun id, claims are CAS status
 * transitions, and progress reports touch the run heartbeat that the
 * stale-run sweeper watches. The legacy AIAgentTask MODEL is gone — this is
 * a plain protocol router, not a CRUD API.
 */

const API_BASE_PATH: string = "/ai-agent-task";

export default class AIAgentTaskAPI {
  public router!: ExpressRouter;

  public constructor() {
    this.router = Express.getRouter();

    /*
     * Claim the next pending code-fix run for processing.
     * Validates aiAgentId and aiAgentKey before claiming. The run is
     * atomically transitioned Queued -> Running before it is returned, so
     * concurrent workers can never receive the same run.
     */
    this.router.post(
      `${API_BASE_PATH}/get-pending-task`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const data: JSONObject = req.body;

          /* Validate AI Agent credentials */
          const aiAgent: AIAgent | null = await this.validateAIAgent(data);

          if (!aiAgent || !aiAgent.id) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid AI Agent ID or AI Agent Key"),
            );
          }

          const run: AIRun | null =
            await AIRunService.claimNextQueuedCodeFixRun({
              aiAgentId: aiAgent.id,
            });

          if (!run) {
            return Response.sendJsonObjectResponse(req, res, {
              task: null,
              message: "No pending tasks available",
            });
          }

          return Response.sendJsonObjectResponse(req, res, {
            task: {
              id: run.id!.toString(),
              projectId: run.projectId?.toString(),
              /*
               * exceptionId is present only for exception-based recipes.
               * ImproveInstrumentation / FixFromIncident runs carry an
               * incident/alert subject instead — the worker fetches their
               * context via /ai-agent-data/get-instrumentation-task-details
               * with the run id, so this field is optional on the wire.
               */
              exceptionId: run.triggeredByTelemetryExceptionId?.toString(),
              /*
               * The worker dispatches its task handler on this. The claim
               * already normalized legacy null to FixException; normalize
               * again here so the wire contract can never regress.
               */
              taskType: CodeFixTaskTypeHelper.fromDatabaseValue(
                run.codeFixTaskType,
              ),
            },
            message: "Task claimed successfully",
          });
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Get the count of pending (queued) code-fix runs for KEDA autoscaling
     * Validates aiAgentId and aiAgentKey before returning count
     */
    this.router.post(
      `${API_BASE_PATH}/get-pending-task-count`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const data: JSONObject = req.body;

          /* Validate AI Agent credentials */
          const aiAgent: AIAgent | null = await this.validateAIAgent(data);

          if (!aiAgent) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid AI Agent ID or AI Agent Key"),
            );
          }

          /* Count queued code-fix runs */
          const count: PositiveNumber = await AIRunService.countBy({
            query: {
              runType: AIRunType.CodeFix,
              status: AIRunStatus.Queued,
            },
            props: {
              isRoot: true,
            },
          });

          return Response.sendJsonObjectResponse(req, res, {
            count: count,
            message: "Pending task count fetched successfully",
          });
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Update task status (InProgress, Completed, Error).
     * `taskId` is an AIRun id. InProgress is a heartbeat touch (the run is
     * already Running from the claim); Completed/Error are CAS transitions
     * Running -> Completed/Error that also write the terminal
     * RunCompleted/RunFailed event to the run's glass-box trail.
     */
    this.router.post(
      `${API_BASE_PATH}/update-task-status`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const data: JSONObject = req.body;

          /* Validate AI Agent credentials */
          const aiAgent: AIAgent | null = await this.validateAIAgent(data);

          if (!aiAgent) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid AI Agent ID or AI Agent Key"),
            );
          }

          /* Validate required fields */
          if (!data["taskId"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("taskId is required"),
            );
          }

          if (!data["status"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("status is required"),
            );
          }

          const runId: ObjectID = new ObjectID(data["taskId"] as string);
          const status: AIAgentTaskStatus = data["status"] as AIAgentTaskStatus;
          const statusMessage: string | undefined = data["statusMessage"] as
            | string
            | undefined;

          /* Validate status value */
          const validStatuses: Array<AIAgentTaskStatus> = [
            AIAgentTaskStatus.InProgress,
            AIAgentTaskStatus.Completed,
            AIAgentTaskStatus.Error,
          ];

          if (!validStatuses.includes(status)) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
              ),
            );
          }

          /* Check if the run exists */
          const existingRun: AIRun | null = await AIRunService.findOneById({
            id: runId,
            select: {
              _id: true,
              projectId: true,
              status: true,
            },
            props: {
              isRoot: true,
            },
          });

          if (!existingRun) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Task not found"),
            );
          }

          if (status === AIAgentTaskStatus.InProgress) {
            /*
             * Back-compat no-op refresh: the run went Running at claim time,
             * so an InProgress report only keeps it visibly alive for the
             * stale-run sweeper.
             */
            await AIRunService.updateOneBy({
              query: {
                _id: runId.toString(),
                status: AIRunStatus.Running,
              },
              data: {
                lastHeartbeatAt: OneUptimeDate.getCurrentDate(),
              } as never,
              props: {
                isRoot: true,
              },
            });
          } else {
            const toStatus: AIRunStatus =
              status === AIAgentTaskStatus.Completed
                ? AIRunStatus.Completed
                : AIRunStatus.Error;

            /*
             * CAS Running -> Completed/Error. Losing the race (0 rows) means
             * another actor already finalized the run — e.g. the sweeper
             * marked it Error after a heartbeat gap — and that outcome wins;
             * we do not clobber it or write a duplicate terminal event.
             */
            const transitionedCount: number =
              await AIRunService.attemptStatusTransition({
                aiRunId: runId,
                fromStatus: AIRunStatus.Running,
                set: {
                  status: toStatus,
                  completedAt: OneUptimeDate.getCurrentDate(),
                  lastHeartbeatAt: OneUptimeDate.getCurrentDate(),
                  ...(toStatus === AIRunStatus.Error && statusMessage
                    ? { errorMessage: statusMessage }
                    : {}),
                },
              });

            if (transitionedCount > 0 && existingRun.projectId) {
              await AIRunEventService.appendEventToRun({
                projectId: existingRun.projectId,
                aiRunId: runId,
                eventType:
                  toStatus === AIRunStatus.Completed
                    ? AIRunEventType.RunCompleted
                    : AIRunEventType.RunFailed,
                ...(statusMessage
                  ? { resultSummary: { message: statusMessage } }
                  : {}),
              });
            }
          }

          return Response.sendJsonObjectResponse(req, res, {
            taskId: runId.toString(),
            status: status,
            message: "Task status updated successfully",
          });
        } catch (err) {
          next(err);
        }
      },
    );
  }

  public getRouter(): ExpressRouter {
    return this.router;
  }

  /*
   * Validate AI Agent credentials from request body
   * Returns AIAgent if valid, null otherwise
   */
  private async validateAIAgent(data: JSONObject): Promise<AIAgent | null> {
    if (!data["aiAgentId"] || !data["aiAgentKey"]) {
      return null;
    }

    const aiAgentId: ObjectID = new ObjectID(data["aiAgentId"] as string);
    const aiAgentKey: string = data["aiAgentKey"] as string;

    const aiAgent: AIAgent | null = await AIAgentService.findOneBy({
      query: {
        _id: aiAgentId.toString(),
        key: aiAgentKey,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    return aiAgent;
  }
}
