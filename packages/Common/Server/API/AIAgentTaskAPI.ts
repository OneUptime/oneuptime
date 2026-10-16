import AIRunService from "../Services/AIRunService";
import AIRunEventService from "../Services/AIRunEventService";
import CodeFixAgentAuth, {
  CodeFixAgentIdentity,
} from "../Utils/AI/CodeFix/CodeFixAgentAuth";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
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
import CodeFixTaskContext from "../../Types/AI/CodeFixTaskContext";
import PositiveNumber from "../../Types/PositiveNumber";
import GitHubRunReply from "../Utils/CodeRepository/GitHub/GitHubRunReply";

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

          /* Validate agent credentials (AIAgent fleet or a Runner) */
          const aiAgent: CodeFixAgentIdentity | null =
            await CodeFixAgentAuth.resolveAgentIdentity(data);

          if (!aiAgent || !aiAgent.id) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid AI Agent ID or AI Agent Key"),
            );
          }

          /*
           * Scope the claim to the agent's project when it has one. A
           * project-scoped Runner (what customers install) must never
           * claim another tenant's code-fix run; the in-cluster Runner has
           * no projectId and keeps serving every project.
           */
          const run: AIRun | null =
            await AIRunService.claimNextQueuedCodeFixRun({
              aiAgentId: aiAgent.id,
              projectId: aiAgent.projectId,
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

          /* Validate agent credentials (AIAgent fleet or a Runner) */
          const aiAgent: CodeFixAgentIdentity | null =
            await CodeFixAgentAuth.resolveAgentIdentity(data);

          if (!aiAgent) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid AI Agent ID or AI Agent Key"),
            );
          }

          /* Count queued code-fix runs */
          /*
           * Same tenancy scoping as the claim: a project-scoped Runner
           * autoscales on its OWN queue depth, never on other tenants'.
           */
          const count: PositiveNumber = await AIRunService.countBy({
            query: {
              runType: AIRunType.CodeFix,
              status: AIRunStatus.Queued,
              ...(aiAgent.projectId ? { projectId: aiAgent.projectId } : {}),
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
     * RunCompleted/RunFailed event to the run's glass-box trail. A Completed
     * report may carry the pull request URLs the run opened.
     */
    this.router.post(
      `${API_BASE_PATH}/update-task-status`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const data: JSONObject = req.body;

          /* Validate agent credentials (AIAgent fleet or a Runner) */
          const aiAgent: CodeFixAgentIdentity | null =
            await CodeFixAgentAuth.resolveAgentIdentity(data);

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

          /*
           * The pull requests a Completed run opened. Recording one can fail
           * after GitHub has opened it, and the thread a GitHub run came from
           * should still get its link, so Runners send them with the status.
           * Older Runners send none, and the run is stored as it always was.
           */
          const pullRequestUrls: unknown =
            status === AIAgentTaskStatus.Completed
              ? data["pullRequestUrls"]
              : undefined;

          const hasPullRequestUrls: boolean =
            Array.isArray(pullRequestUrls) && pullRequestUrls.length > 0;

          /* Validate status value */
          const validStatuses: Array<AIAgentTaskStatus> = [
            AIAgentTaskStatus.InProgress,
            AIAgentTaskStatus.Completed,
            AIAgentTaskStatus.NoFixFound,
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
              ...(hasPullRequestUrls ? { taskContext: true } : {}),
            },
            props: {
              isRoot: true,
            },
          });

          /*
           * A project-scoped identity may only report on its own project's
           * runs. Denial answers exactly like a missing run so a probing key
           * cannot tell "other tenant's run" from "no such run".
           */
          if (
            !existingRun ||
            CodeFixAgentAuth.deniesAccessToProject(
              aiAgent,
              existingRun.projectId,
            )
          ) {
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
            /*
             * Agents that predate NoFixFound report a fruitless run as Error,
             * so an Error report still maps straight through — those runs keep
             * looking exactly as they do today until the agent is upgraded.
             */
            let toStatus: AIRunStatus = AIRunStatus.Error;

            if (status === AIAgentTaskStatus.Completed) {
              toStatus = AIRunStatus.Completed;
            } else if (status === AIAgentTaskStatus.NoFixFound) {
              toStatus = AIRunStatus.NoFixFound;
            }

            /*
             * Both terminal outcomes that carry a reason store it in
             * errorMessage — the column is the run's only message field, and
             * every reader (the detail page, the exception page's
             * statusMessage) already renders it.
             */
            const shouldStoreMessage: boolean =
              Boolean(statusMessage) &&
              (toStatus === AIRunStatus.Error ||
                toStatus === AIRunStatus.NoFixFound);

            /*
             * The reported pull requests go on the run's GitHub context, in
             * the same UPDATE that makes the run Completed. The outcome
             * sweeper answers the thread as soon as the run is terminal, so a
             * later write could land after the reply had already said no pull
             * request was recorded. A run that did not come from GitHub has no
             * thread to link them in, and its context is left alone.
             */
            const taskContext: CodeFixTaskContext | null = hasPullRequestUrls
              ? GitHubRunReply.withOpenedPullRequestUrls({
                  taskContext: existingRun.taskContext,
                  pullRequestUrls: pullRequestUrls,
                })
              : null;

            /*
             * CAS Running -> Completed/NoFixFound/Error. Losing the race (0
             * rows) means another actor already finalized the run — e.g. the
             * sweeper marked it Error after a heartbeat gap — and that outcome
             * wins; we do not clobber it or write a duplicate terminal event.
             */
            const transitionedCount: number =
              await AIRunService.attemptStatusTransition({
                aiRunId: runId,
                fromStatus: AIRunStatus.Running,
                set: {
                  status: toStatus,
                  completedAt: OneUptimeDate.getCurrentDate(),
                  lastHeartbeatAt: OneUptimeDate.getCurrentDate(),
                  ...(shouldStoreMessage
                    ? { errorMessage: statusMessage }
                    : {}),
                  ...(taskContext ? { taskContext: taskContext } : {}),
                },
              });

            if (transitionedCount > 0 && existingRun.projectId) {
              await AIRunEventService.appendEventToRun({
                projectId: existingRun.projectId,
                aiRunId: runId,
                /*
                 * Only a genuine failure closes the event trail with
                 * RunFailed. A NoFixFound run ran to completion and reported
                 * a conclusion, so it closes with RunCompleted and carries
                 * the "no fix" reason in resultSummary.
                 */
                eventType:
                  toStatus === AIRunStatus.Error
                    ? AIRunEventType.RunFailed
                    : AIRunEventType.RunCompleted,
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
}
