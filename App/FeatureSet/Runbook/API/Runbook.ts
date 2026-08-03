import BadDataException from "Common/Types/Exception/BadDataException";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import ObjectID from "Common/Types/ObjectID";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import CommonAPI from "Common/Server/API/CommonAPI";
import { assertCanExecuteRunbooks } from "Common/Server/Utils/Runbook/RunbookExecutePermission";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import RunbookService from "Common/Server/Services/RunbookService";
import RunbookExecutionService from "Common/Server/Services/RunbookExecutionService";
import RunbookAgentJobService from "Common/Server/Services/RunbookAgentJobService";
import IncidentService from "Common/Server/Services/IncidentService";
import AlertService from "Common/Server/Services/AlertService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import RunbookExecutionStatus from "Common/Types/Runbook/RunbookExecutionStatus";
import RunbookStepExecutionStatus from "Common/Types/Runbook/RunbookStepExecutionStatus";
import { RunbookStep } from "Common/Types/Runbook/RunbookStep";
import { RunbookStepExecutionState } from "Common/Types/Runbook/RunbookStepExecution";
import RunRunbook from "../Services/RunRunbook";

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
        CommonAPI.assertAuthenticatedProjectMember(props);
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
      execution.triggeredByUserId = props.userId!;

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
       * it needs the same authority as starting a runbook.
       */
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);
      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);
      assertCanExecuteRunbooks(props, projectId);

      const updated: RunbookStepExecutionState | null = await updateStepStatus({
        executionId,
        stepId,
        projectId,
        newStatus: RunbookStepExecutionStatus.Completed,
        notes: typeof req.body?.notes === "string" ? req.body.notes : undefined,
        userId: props.userId!.toString(),
      });

      if (!updated) {
        throw new NotFoundException("Step or execution not found");
      }

      await RunRunbook.startExecution({
        runbookExecutionId: new ObjectID(executionId),
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
       * Skipping a step advances the execution past it, so it needs the same
       * authority as starting a runbook.
       */
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);
      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);
      assertCanExecuteRunbooks(props, projectId);

      const updated: RunbookStepExecutionState | null = await updateStepStatus({
        executionId,
        stepId,
        projectId,
        newStatus: RunbookStepExecutionStatus.Skipped,
        notes:
          typeof req.body?.reason === "string" ? req.body.reason : undefined,
        userId: props.userId!.toString(),
      });

      if (!updated) {
        throw new NotFoundException("Step or execution not found");
      }

      await RunRunbook.startExecution({
        runbookExecutionId: new ObjectID(executionId),
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
       * Cancelling stops in-flight infrastructure work — same authority as
       * starting it, and never available to an unauthenticated caller.
       */
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);
      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);
      assertCanExecuteRunbooks(props, projectId);

      const execution: RunbookExecution | null =
        await RunbookExecutionService.findOneById({
          id: new ObjectID(executionId),
          select: {
            _id: true,
            projectId: true,
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

      await RunbookAgentJobService.cancelJobsForExecution({
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

async function updateStepStatus(args: {
  executionId: string;
  stepId: string;
  projectId: ObjectID;
  newStatus: RunbookStepExecutionStatus;
  notes?: string | undefined;
  userId?: string | undefined;
}): Promise<RunbookStepExecutionState | null> {
  const execution: RunbookExecution | null =
    await RunbookExecutionService.findOneById({
      id: new ObjectID(args.executionId),
      select: {
        _id: true,
        projectId: true,
        status: true,
        stepExecutions: true,
      },
      props: { isRoot: true },
    });

  if (!execution) {
    return null;
  }

  CommonAPI.assertResourceBelongsToProject({
    resourceProjectId: execution.projectId,
    projectId: args.projectId,
  });

  if (
    execution.status === RunbookExecutionStatus.Completed ||
    execution.status === RunbookExecutionStatus.Failed ||
    execution.status === RunbookExecutionStatus.Cancelled
  ) {
    throw new BadDataException(
      `Cannot update step on a ${execution.status} execution`,
    );
  }

  const stepExecutions: RunbookStepExecutionState[] =
    (execution.stepExecutions as unknown as RunbookStepExecutionState[]) || [];

  const stepExec: RunbookStepExecutionState | undefined = stepExecutions.find(
    (s: RunbookStepExecutionState) => {
      return s.step.id === args.stepId;
    },
  );

  if (!stepExec) {
    return null;
  }

  stepExec.status = args.newStatus;
  stepExec.completedAt = new Date().toISOString();
  if (args.notes) {
    stepExec.notes = args.notes;
  }
  if (args.userId) {
    stepExec.completedByUserId = args.userId;
  }

  await RunbookExecutionService.updateOneById({
    id: new ObjectID(args.executionId),
    data: {
      stepExecutions: stepExecutions as unknown as JSONArray,
    } as unknown as JSONObject,
    props: { isRoot: true },
  });

  return stepExec;
}
