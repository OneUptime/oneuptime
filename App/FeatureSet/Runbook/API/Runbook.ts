import BadDataException from "Common/Types/Exception/BadDataException";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import CommonAPI from "Common/Server/API/CommonAPI";
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
import Incident from "Common/Models/DatabaseModels/Incident";
import Alert from "Common/Models/DatabaseModels/Alert";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import RunbookExecutionStatus from "Common/Types/Runbook/RunbookExecutionStatus";
import RunbookStepExecutionStatus from "Common/Types/Runbook/RunbookStepExecutionStatus";
import { RunbookStep } from "Common/Types/Runbook/RunbookStep";
import { RunbookStepExecutionState } from "Common/Types/Runbook/RunbookStepExecution";
import RunRunbook from "../Services/RunRunbook";

/*
 * These endpoints start and steer code execution on customer hosts, so every
 * one of them requires a real logged-in session (getUserMiddleware admits
 * unauthenticated callers as UserType.Public — it authenticates but does not
 * gate) and then loads the runbook/execution under the CALLER's permissions,
 * never isRoot with a caller-supplied tenantid comparison. Same idiom as
 * AIInvestigationAPI.
 */
async function getLoggedInProps(
  req: ExpressRequest,
): Promise<DatabaseCommonInteractionProps> {
  const props: DatabaseCommonInteractionProps =
    await CommonAPI.getDatabaseCommonInteractionProps(req);

  if (!props.userId) {
    throw new NotAuthorizedException("A logged-in user session is required.");
  }

  return props;
}

/*
 * Loads the execution under the caller's permissions (null for a
 * cross-tenant id AND for an execution the caller has no read access to),
 * so knowledge of an executionId is never sufficient to touch it.
 */
async function findExecutionForCaller(
  executionId: string,
  props: DatabaseCommonInteractionProps,
): Promise<RunbookExecution | null> {
  return RunbookExecutionService.findOneById({
    id: new ObjectID(executionId),
    select: {
      _id: true,
      projectId: true,
      status: true,
      stepExecutions: true,
    },
    props,
  });
}

export default class RunbookAPI {
  public router!: ExpressRouter;

  public constructor() {
    this.router = Express.getRouter();

    /*
     * Running is a WRITE against customer infrastructure, so the read-based
     * access checks inside the handlers are not enough on their own: the
     * caller must also hold an execute-capable permission. The sets mirror
     * RunbookExecution's own table ACLs — create for starting a run,
     * update for steering one (complete/skip/cancel) — so this HTTP surface
     * can never grant more than direct model access would.
     */
    this.router.post(
      `/run/:runbookId`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requirePermission({
        permissions: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.RunbookAdmin,
          Permission.RunbookMember,
          Permission.CreateRunbookExecution,
        ],
      }),
      this.runRunbook,
    );

    this.router.post(
      `/execution/:executionId/step/:stepId/complete`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requirePermission({
        permissions: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.RunbookAdmin,
          Permission.EditRunbookExecution,
        ],
      }),
      this.completeManualStep,
    );

    this.router.post(
      `/execution/:executionId/step/:stepId/skip`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requirePermission({
        permissions: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.RunbookAdmin,
          Permission.EditRunbookExecution,
        ],
      }),
      this.skipStep,
    );

    this.router.post(
      `/execution/:executionId/cancel`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requirePermission({
        permissions: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.RunbookAdmin,
          Permission.EditRunbookExecution,
        ],
      }),
      this.cancelExecution,
    );
  }

  public async runRunbook(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);

      const runbookId: string | undefined = req.params["runbookId"];

      if (!runbookId) {
        throw new BadDataException("runbookId not found in URL");
      }

      if (!props.tenantId) {
        throw new BadDataException("Project not found in request");
      }

      /*
       * Load the runbook under the caller's permissions. The tenant-scoped
       * read returns null for both a cross-tenant id and a runbook the
       * caller has no read access to — the caller's REAL membership in the
       * tenant is resolved server-side by the middleware, so a forged
       * tenantid header yields no permissions and therefore no runbook.
       */
      const runbook: Runbook | null = await RunbookService.findOneById({
        id: new ObjectID(runbookId),
        select: {
          _id: true,
          projectId: true,
          name: true,
          steps: true,
          isEnabled: true,
        },
        props,
      });

      if (!runbook || !runbook.projectId) {
        throw new NotFoundException(
          "Runbook not found (or you do not have access to it).",
        );
      }

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
      execution.projectId = runbook.projectId;
      execution.runbookId = new ObjectID(runbook._id!);
      execution.runbookNameSnapshot = runbook.name || "Runbook";
      execution.status = RunbookExecutionStatus.Scheduled;
      execution.stepExecutions = stepExecutions as unknown as JSONArray;
      // getLoggedInProps guarantees a userId — every run is attributed.
      execution.triggeredByUserId = props.userId!;

      const linkageBody: Record<string, unknown> = (req.body || {}) as Record<
        string,
        unknown
      >;
      const incidentIdRaw: unknown = linkageBody["incidentId"];
      const alertIdRaw: unknown = linkageBody["alertId"];
      const smIdRaw: unknown = linkageBody["scheduledMaintenanceId"];

      /*
       * Only link an event the caller can actually read. Looking it up under
       * the caller's permissions (not isRoot) rejects both a cross-tenant id
       * and one the caller has no access to — so this endpoint cannot be
       * used to staple another project's incident onto an execution, and any
       * server-side consumer that later dereferences the link with isRoot
       * (the AI step's trigger context does) never surfaces foreign data.
       */
      if (typeof incidentIdRaw === "string" && incidentIdRaw.length > 0) {
        const incidentId: ObjectID = new ObjectID(incidentIdRaw);
        const incident: Incident | null = await IncidentService.findOneById({
          id: incidentId,
          select: { _id: true },
          props,
        });
        if (!incident) {
          throw new BadDataException(
            "Incident not found (or you do not have access to it).",
          );
        }
        execution.incidentId = incidentId;
      }
      if (typeof alertIdRaw === "string" && alertIdRaw.length > 0) {
        const alertId: ObjectID = new ObjectID(alertIdRaw);
        const alert: Alert | null = await AlertService.findOneById({
          id: alertId,
          select: { _id: true },
          props,
        });
        if (!alert) {
          throw new BadDataException(
            "Alert not found (or you do not have access to it).",
          );
        }
        execution.alertId = alertId;
      }
      if (typeof smIdRaw === "string" && smIdRaw.length > 0) {
        const scheduledMaintenanceId: ObjectID = new ObjectID(smIdRaw);
        const scheduledMaintenance: ScheduledMaintenance | null =
          await ScheduledMaintenanceService.findOneById({
            id: scheduledMaintenanceId,
            select: { _id: true },
            props,
          });
        if (!scheduledMaintenance) {
          throw new BadDataException(
            "Scheduled Maintenance not found (or you do not have access to it).",
          );
        }
        execution.scheduledMaintenanceId = scheduledMaintenanceId;
      }

      /*
       * The write itself is a controlled server-side state transition — the
       * caller was access-checked above, so create as root (same idiom as
       * AIInvestigationAPI: access-check under user permissions, act as
       * root).
       */
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
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);

      const executionId: string | undefined = req.params["executionId"];
      const stepId: string | undefined = req.params["stepId"];

      if (!executionId || !stepId) {
        throw new BadDataException(
          "executionId and stepId are required in URL",
        );
      }

      const updated: RunbookStepExecutionState | null = await updateStepStatus({
        executionId,
        stepId,
        props,
        newStatus: RunbookStepExecutionStatus.Completed,
        notes: typeof req.body?.notes === "string" ? req.body.notes : undefined,
        userId: props.userId?.toString(),
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
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);

      const executionId: string | undefined = req.params["executionId"];
      const stepId: string | undefined = req.params["stepId"];

      if (!executionId || !stepId) {
        throw new BadDataException(
          "executionId and stepId are required in URL",
        );
      }

      const updated: RunbookStepExecutionState | null = await updateStepStatus({
        executionId,
        stepId,
        props,
        newStatus: RunbookStepExecutionStatus.Skipped,
        notes:
          typeof req.body?.reason === "string" ? req.body.reason : undefined,
        userId: props.userId?.toString(),
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
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);

      const executionId: string | undefined = req.params["executionId"];

      if (!executionId) {
        throw new BadDataException("executionId is required in URL");
      }

      const execution: RunbookExecution | null = await findExecutionForCaller(
        executionId,
        props,
      );

      if (!execution) {
        throw new NotFoundException(
          "Runbook execution not found (or you do not have access to it).",
        );
      }

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

async function updateStepStatus(args: {
  executionId: string;
  stepId: string;
  props: DatabaseCommonInteractionProps;
  newStatus: RunbookStepExecutionStatus;
  notes?: string | undefined;
  userId?: string | undefined;
}): Promise<RunbookStepExecutionState | null> {
  /*
   * Access check: the execution is loaded under the caller's permissions —
   * a cross-tenant id and an execution the caller cannot read both come
   * back null (-> 404 upstream). The subsequent write is a controlled
   * server-side state transition, so it runs as root.
   */
  const execution: RunbookExecution | null = await findExecutionForCaller(
    args.executionId,
    args.props,
  );

  if (!execution) {
    return null;
  }

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
