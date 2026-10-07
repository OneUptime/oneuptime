import BadDataException from "Common/Types/Exception/BadDataException";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import ObjectID from "Common/Types/ObjectID";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import PartialEntity from "Common/Types/Database/PartialEntity";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import CommonAPI from "Common/Server/API/CommonAPI";
import {
  assertCanAdvanceRunbookExecutions,
  assertCanExecuteRunbooks,
} from "Common/Server/Utils/Runbook/RunbookExecutePermission";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import logger from "Common/Server/Utils/Logger";
import RunbookService from "Common/Server/Services/RunbookService";
import RunbookExecutionService from "Common/Server/Services/RunbookExecutionService";
import RunnerJobService from "Common/Server/Services/RunnerJobService";
import IncidentService from "Common/Server/Services/IncidentService";
import AlertService from "Common/Server/Services/AlertService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import RunbookExecutionStatus from "Common/Types/Runbook/RunbookExecutionStatus";
import RunbookStepExecutionStatus from "Common/Types/Runbook/RunbookStepExecutionStatus";
import { RunbookStep } from "Common/Types/Runbook/RunbookStep";
import { RunbookStepExecutionState } from "Common/Types/Runbook/RunbookStepExecution";
import {
  decideRunbookStepAction,
  RunbookStepAction,
  RunbookStepActionDecision,
} from "Common/Types/Runbook/RunbookStepAction";
import RunRunbook from "../Services/RunRunbook";
import RunbookRunAccess from "Common/Server/Utils/Runbook/RunbookRunAccess";

export default class RunbookAPI {
  public router!: ExpressRouter;

  public constructor() {
    this.router = Express.getRouter();

    this.router.post(
      `/run/:runbookId`,
      UserMiddleware.getUserMiddleware,
      this.runRunbook,
    );

    this.router.post(
      `/execution/:executionId/step/:stepId/complete`,
      UserMiddleware.getUserMiddleware,
      this.completeManualStep,
    );

    this.router.post(
      `/execution/:executionId/step/:stepId/skip`,
      UserMiddleware.getUserMiddleware,
      this.skipStep,
    );

    this.router.post(
      `/execution/:executionId/cancel`,
      UserMiddleware.getUserMiddleware,
      this.cancelExecution,
    );
  }

  public async runRunbook(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const runbookId: string | undefined = req.params["runbookId"];

      if (!runbookId) {
        throw new BadDataException("runbookId not found in URL");
      }

      /*
       * Starting a runbook runs the project's own scripts on its
       * infrastructure, so the caller must be an authenticated member of the
       * project holding a runbook-execute permission. getUserMiddleware alone
       * is not a gate: it lets an unauthenticated request through as "public"
       * and takes the project from a caller-supplied header.
       */
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);
      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectPrincipal(props);
      assertCanExecuteRunbooks(props, projectId);

      const runbook: Runbook | null = await RunbookService.findOneById({
        id: new ObjectID(runbookId),
        select: {
          _id: true,
          projectId: true,
          name: true,
          steps: true,
          isEnabled: true,
        },
        props: { isRoot: true },
      });

      if (!runbook) {
        throw new NotFoundException("Runbook not found");
      }

      CommonAPI.assertResourceBelongsToProject({
        resourceProjectId: runbook.projectId,
        projectId,
      });

      // The runbooks the grant that lets them run reaches (labels, owned).
      await RunbookRunAccess.assertMayStart({
        databaseProps: props,
        projectId,
        runbookId: new ObjectID(runbook._id!),
      });

      if (runbook.isEnabled === false) {
        throw new BadDataException("Runbook is disabled");
      }

      const steps: RunbookStep[] =
        (runbook.steps as unknown as RunbookStep[]) || [];

      if (steps.length === 0) {
        throw new BadDataException("Runbook has no steps to run");
      }

      const stepExecutions: RunbookStepExecutionState[] = steps
        .slice()
        .sort((a: RunbookStep, b: RunbookStep) => {
          return a.order - b.order;
        })
        .map((step: RunbookStep) => {
          return {
            step,
            status: RunbookStepExecutionStatus.Pending,
          };
        });

      const execution: RunbookExecution = new RunbookExecution();
      // Asserted equal to runbook.projectId above.
      execution.projectId = projectId;
      execution.runbookId = new ObjectID(runbook._id!);
      execution.runbookNameSnapshot = runbook.name || "Runbook";
      execution.status = RunbookExecutionStatus.Scheduled;
      execution.stepExecutions = stepExecutions as unknown as JSONArray;

      // Absent for an API key — there is no user behind the request.
      if (props.userId) {
        execution.triggeredByUserId = props.userId;
      }

      const linkageBody: Record<string, unknown> = (req.body || {}) as Record<
        string,
        unknown
      >;
      const incidentIdRaw: unknown = linkageBody["incidentId"];
      const alertIdRaw: unknown = linkageBody["alertId"];
      const smIdRaw: unknown = linkageBody["scheduledMaintenanceId"];

      /*
       * The linked event must live in the caller's project. Without this an
       * execution in project A could carry project B's incidentId, and any
       * server-side consumer that dereferences it with isRoot (the AI step's
       * trigger context does) would surface another tenant's data.
       */
      if (typeof incidentIdRaw === "string" && incidentIdRaw.length > 0) {
        const incidentId: ObjectID = new ObjectID(incidentIdRaw);
        await assertBelongsToProject({
          entityName: "Incident",
          projectId,
          findProjectId: async (): Promise<ObjectID | undefined> => {
            return (
              await IncidentService.findOneById({
                id: incidentId,
                select: { projectId: true },
                props: { isRoot: true },
              })
            )?.projectId;
          },
        });
        execution.incidentId = incidentId;
      }
      if (typeof alertIdRaw === "string" && alertIdRaw.length > 0) {
        const alertId: ObjectID = new ObjectID(alertIdRaw);
        await assertBelongsToProject({
          entityName: "Alert",
          projectId,
          findProjectId: async (): Promise<ObjectID | undefined> => {
            return (
              await AlertService.findOneById({
                id: alertId,
                select: { projectId: true },
                props: { isRoot: true },
              })
            )?.projectId;
          },
        });
        execution.alertId = alertId;
      }
      if (typeof smIdRaw === "string" && smIdRaw.length > 0) {
        const scheduledMaintenanceId: ObjectID = new ObjectID(smIdRaw);
        await assertBelongsToProject({
          entityName: "Scheduled Maintenance",
          projectId,
          findProjectId: async (): Promise<ObjectID | undefined> => {
            return (
              await ScheduledMaintenanceService.findOneById({
                id: scheduledMaintenanceId,
                select: { projectId: true },
                props: { isRoot: true },
              })
            )?.projectId;
          },
        });
        execution.scheduledMaintenanceId = scheduledMaintenanceId;
      }

      const created: RunbookExecution = await RunbookExecutionService.create({
        data: execution,
        props: { isRoot: true },
      });

      await RunRunbook.startExecution({
        runbookExecutionId: new ObjectID(created._id!),
      });

      return Response.sendJsonObjectResponse(req, res, {
        runbookExecutionId: created._id,
        status: created.status,
      });
    } catch (err) {
      next(err);
    }
  }

  public async completeManualStep(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const executionId: string | undefined = req.params["executionId"];
      const stepId: string | undefined = req.params["stepId"];

      if (!executionId || !stepId) {
        throw new BadDataException(
          "executionId and stepId are required in URL",
        );
      }

      /*
       * Completing a gated step resumes execution of the remaining steps, so
       * it needs authority over the execution, not merely over the runbook.
       */
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);
      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectPrincipal(props);
      assertCanAdvanceRunbookExecutions(props, projectId);

      await advanceStep({
        action: RunbookStepAction.Complete,
        executionId,
        stepId,
        projectId,
        databaseProps: props,
        notes: typeof req.body?.notes === "string" ? req.body.notes : undefined,
        userId: props.userId ? props.userId.toString() : undefined,
      });

      return Response.sendJsonObjectResponse(req, res, { status: "ok" });
    } catch (err) {
      next(err);
    }
  }

  public async skipStep(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const executionId: string | undefined = req.params["executionId"];
      const stepId: string | undefined = req.params["stepId"];

      if (!executionId || !stepId) {
        throw new BadDataException(
          "executionId and stepId are required in URL",
        );
      }

      /*
       * Skipping a step advances the execution past it, so it needs authority
       * over the execution, not merely over the runbook.
       */
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);
      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectPrincipal(props);
      assertCanAdvanceRunbookExecutions(props, projectId);

      await advanceStep({
        action: RunbookStepAction.Skip,
        executionId,
        stepId,
        projectId,
        databaseProps: props,
        notes:
          typeof req.body?.reason === "string" ? req.body.reason : undefined,
        userId: props.userId ? props.userId.toString() : undefined,
      });

      return Response.sendJsonObjectResponse(req, res, { status: "ok" });
    } catch (err) {
      next(err);
    }
  }

  public async cancelExecution(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const executionId: string | undefined = req.params["executionId"];

      if (!executionId) {
        throw new BadDataException("executionId is required in URL");
      }

      /*
       * Cancelling stops in-flight infrastructure work, and is never
       * available to an unauthenticated caller.
       */
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);
      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectPrincipal(props);
      assertCanAdvanceRunbookExecutions(props, projectId);

      const execution: RunbookExecution | null =
        await RunbookExecutionService.findOneById({
          id: new ObjectID(executionId),
          select: {
            _id: true,
            projectId: true,
            runbookId: true,
            status: true,
            stepExecutions: true,
          },
          props: { isRoot: true },
        });

      if (!execution) {
        throw new NotFoundException("Runbook execution not found");
      }

      CommonAPI.assertResourceBelongsToProject({
        resourceProjectId: execution.projectId,
        projectId,
      });

      await assertMayAdvanceRunOf({
        databaseProps: props,
        projectId,
        runbookId: execution.runbookId,
      });

      if (
        execution.status === RunbookExecutionStatus.Completed ||
        execution.status === RunbookExecutionStatus.Failed ||
        execution.status === RunbookExecutionStatus.Cancelled
      ) {
        return Response.sendJsonObjectResponse(req, res, {
          status: execution.status,
        });
      }

      const stepExecutions: RunbookStepExecutionState[] =
        (execution.stepExecutions as unknown as RunbookStepExecutionState[]) ||
        [];

      const nowIso: string = new Date().toISOString();
      for (const stepExec of stepExecutions) {
        if (
          stepExec.status === RunbookStepExecutionStatus.Pending ||
          stepExec.status === RunbookStepExecutionStatus.Running ||
          stepExec.status === RunbookStepExecutionStatus.WaitingForUser
        ) {
          stepExec.status = RunbookStepExecutionStatus.Cancelled;
          stepExec.completedAt = nowIso;
        }
      }

      await RunbookExecutionService.updateOneById({
        id: new ObjectID(executionId),
        data: {
          status: RunbookExecutionStatus.Cancelled,
          completedAt: new Date(),
          stepExecutions: stepExecutions as unknown as JSONArray,
        } as unknown as JSONObject,
        props: { isRoot: true },
      });

      await RunnerJobService.cancelJobsForExecution({
        runbookExecutionId: new ObjectID(executionId),
      });

      return Response.sendJsonObjectResponse(req, res, {
        status: RunbookExecutionStatus.Cancelled,
      });
    } catch (err) {
      next(err);
    }
  }
}

/*
 * A run is moved along - a step completed or skipped, the run cancelled - by
 * whoever may run its runbook (RunbookRunAccess). A run whose runbook is
 * gone is left to the run permissions alone: there are no labels left to
 * weigh.
 */
async function assertMayAdvanceRunOf(data: {
  databaseProps: DatabaseCommonInteractionProps;
  projectId: ObjectID;
  runbookId: ObjectID | undefined;
}): Promise<void> {
  if (!data.runbookId) {
    return;
  }

  await RunbookRunAccess.assertMayAdvance({
    databaseProps: data.databaseProps,
    projectId: data.projectId,
    runbookId: data.runbookId,
  });
}

/*
 * Throws unless the referenced event exists AND belongs to the caller's
 * project. Looks the row up with isRoot deliberately: a tenant-scoped read
 * would report "not found" for a cross-tenant ID, which is the same answer
 * we want, but we also want to reject rather than silently drop the link.
 *
 * Module scope, not a method: the route handlers are registered unbound, so
 * `this` is undefined by the time Express calls them.
 */
async function assertBelongsToProject(data: {
  entityName: string;
  projectId: ObjectID;
  findProjectId: () => Promise<ObjectID | undefined>;
}): Promise<void> {
  const entityProjectId: ObjectID | undefined = await data.findProjectId();

  if (
    !entityProjectId ||
    entityProjectId.toString() !== data.projectId.toString()
  ) {
    throw new BadDataException(
      `${data.entityName} does not belong to this project`,
    );
  }
}

/*
 * Completes or skips one step of an execution, under the rules in
 * RunbookStepAction (only the step the execution is paused on, or a later
 * plain automated step skipped ahead of time), and resumes the execution when
 * the step was the one it was paused on.
 *
 * The write is a compare-and-set on the status and version the rules were
 * checked against. Two responders approving the same step at once must not
 * both resume it: every resume enqueues a run of the execution loop, and two
 * loops over one execution would run every later step twice. Only the request
 * whose write lands moves the execution out of WaitingForManualStep, and only
 * that request enqueues it. The version stops a skip and an approval made at
 * the same moment from silently overwriting each other's step list.
 *
 * A resumed execution goes back to Scheduled — queued, not yet picked up —
 * until a Worker takes it and marks it Running. Scheduled is what the
 * stuck-execution sweep leaves alone, so a resume waiting behind a busy queue
 * is not failed for making no progress.
 */
async function advanceStep(args: {
  action: RunbookStepAction;
  executionId: string;
  stepId: string;
  projectId: ObjectID;
  databaseProps: DatabaseCommonInteractionProps;
  notes?: string | undefined;
  userId?: string | undefined;
}): Promise<void> {
  const execution: RunbookExecution | null =
    await RunbookExecutionService.findOneById({
      id: new ObjectID(args.executionId),
      select: {
        _id: true,
        projectId: true,
        runbookId: true,
        status: true,
        stepExecutions: true,
        version: true,
      },
      props: { isRoot: true },
    });

  if (!execution) {
    throw new NotFoundException("Step or execution not found");
  }

  CommonAPI.assertResourceBelongsToProject({
    resourceProjectId: execution.projectId,
    projectId: args.projectId,
  });

  await assertMayAdvanceRunOf({
    databaseProps: args.databaseProps,
    projectId: args.projectId,
    runbookId: execution.runbookId,
  });

  const stepExecutions: RunbookStepExecutionState[] =
    (execution.stepExecutions as unknown as RunbookStepExecutionState[]) || [];

  const stepExec: RunbookStepExecutionState | undefined = stepExecutions.find(
    (s: RunbookStepExecutionState) => {
      return s.step.id === args.stepId;
    },
  );

  if (!stepExec) {
    throw new NotFoundException("Step or execution not found");
  }

  const decision: RunbookStepActionDecision = decideRunbookStepAction({
    action: args.action,
    executionStatus: execution.status,
    stepExecutions,
    stepId: args.stepId,
  });

  if (!decision.allowed) {
    throw new BadDataException(decision.reason);
  }

  const stepExecutionsBefore: JSONArray = JSON.parse(
    JSON.stringify(stepExecutions),
  ) as JSONArray;

  stepExec.status =
    args.action === RunbookStepAction.Complete
      ? RunbookStepExecutionStatus.Completed
      : RunbookStepExecutionStatus.Skipped;
  stepExec.completedAt = new Date().toISOString();
  if (args.notes) {
    stepExec.notes = args.notes;
  }
  if (args.userId) {
    stepExec.completedByUserId = args.userId;
  }

  const version: number | undefined =
    typeof execution.version === "number" ? execution.version : undefined;

  const written: boolean =
    await RunbookExecutionService.compareAndSetColumnsByIdWithoutHooks({
      id: new ObjectID(args.executionId),
      data: {
        stepExecutions: stepExecutions as unknown as JSONArray,
        ...(decision.resumesExecution
          ? { status: RunbookExecutionStatus.Scheduled }
          : {}),
        ...(version !== undefined ? { version: version + 1 } : {}),
      } as unknown as PartialEntity<RunbookExecution>,
      expectedData: {
        status: RunbookExecutionStatus.WaitingForManualStep,
        ...(version !== undefined ? { version } : {}),
      } as unknown as PartialEntity<RunbookExecution>,
    });

  if (!written) {
    throw new BadDataException(
      "This execution changed while your request was being handled, so nothing was updated. Someone may have just acted on it — refresh and try again.",
    );
  }

  if (!decision.resumesExecution) {
    return;
  }

  try {
    await RunRunbook.startExecution({
      runbookExecutionId: new ObjectID(args.executionId),
    });
  } catch (err) {
    /*
     * Nothing picks a Scheduled execution up without its queue job, and the
     * step is no longer waiting, so it could not be approved again either.
     * Put the pause back — unless a Worker has taken the run after all — so
     * the request can simply be retried.
     */
    try {
      await RunbookExecutionService.compareAndSetColumnsByIdWithoutHooks({
        id: new ObjectID(args.executionId),
        data: {
          stepExecutions: stepExecutionsBefore,
          status: RunbookExecutionStatus.WaitingForManualStep,
          ...(version !== undefined ? { version: version + 2 } : {}),
        } as unknown as PartialEntity<RunbookExecution>,
        expectedData: {
          status: RunbookExecutionStatus.Scheduled,
          ...(version !== undefined ? { version: version + 1 } : {}),
        } as unknown as PartialEntity<RunbookExecution>,
      });
    } catch (rollbackError) {
      logger.error(
        `Runbook execution ${args.executionId} could not be queued to resume, and its pause could not be restored:`,
        { service: "runbook" },
      );
      logger.error(rollbackError, { service: "runbook" });
    }

    throw err;
  }
}
