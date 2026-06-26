import BadDataException from "Common/Types/Exception/BadDataException";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import ObjectID from "Common/Types/ObjectID";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  OneUptimeRequest,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import RunbookService from "Common/Server/Services/RunbookService";
import RunbookExecutionService from "Common/Server/Services/RunbookExecutionService";
import RunbookAgentJobService from "Common/Server/Services/RunbookAgentJobService";
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
      const oneUptimeReq: OneUptimeRequest = req as OneUptimeRequest;
      const runbookId: string | undefined = req.params["runbookId"];

      if (!runbookId) {
        throw new BadDataException("runbookId not found in URL");
      }

      if (!oneUptimeReq.tenantId) {
        throw new BadDataException("Project not found in request");
      }

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

      if (runbook.projectId?.toString() !== oneUptimeReq.tenantId.toString()) {
        throw new BadDataException("Runbook does not belong to this project");
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

      const userIdRaw: unknown = oneUptimeReq.userAuthorization?.["userId"];
      const triggeredByUserId: ObjectID | undefined =
        typeof userIdRaw === "string" && userIdRaw.length > 0
          ? new ObjectID(userIdRaw)
          : undefined;

      const execution: RunbookExecution = new RunbookExecution();
      execution.projectId = runbook.projectId;
      execution.runbookId = new ObjectID(runbook._id!);
      execution.runbookNameSnapshot = runbook.name || "Runbook";
      execution.status = RunbookExecutionStatus.Scheduled;
      execution.stepExecutions = stepExecutions as unknown as JSONArray;
      if (triggeredByUserId) {
        execution.triggeredByUserId = triggeredByUserId;
      }

      const linkageBody: Record<string, unknown> = (req.body || {}) as Record<
        string,
        unknown
      >;
      const incidentIdRaw: unknown = linkageBody["incidentId"];
      const alertIdRaw: unknown = linkageBody["alertId"];
      const smIdRaw: unknown = linkageBody["scheduledMaintenanceId"];
      if (typeof incidentIdRaw === "string" && incidentIdRaw.length > 0) {
        execution.incidentId = new ObjectID(incidentIdRaw);
      }
      if (typeof alertIdRaw === "string" && alertIdRaw.length > 0) {
        execution.alertId = new ObjectID(alertIdRaw);
      }
      if (typeof smIdRaw === "string" && smIdRaw.length > 0) {
        execution.scheduledMaintenanceId = new ObjectID(smIdRaw);
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
      const oneUptimeReq: OneUptimeRequest = req as OneUptimeRequest;
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
        tenantId: oneUptimeReq.tenantId,
        newStatus: RunbookStepExecutionStatus.Completed,
        notes: typeof req.body?.notes === "string" ? req.body.notes : undefined,
        userId:
          typeof oneUptimeReq.userAuthorization?.["userId"] === "string"
            ? (oneUptimeReq.userAuthorization["userId"] as string)
            : undefined,
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
      const oneUptimeReq: OneUptimeRequest = req as OneUptimeRequest;
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
        tenantId: oneUptimeReq.tenantId,
        newStatus: RunbookStepExecutionStatus.Skipped,
        notes:
          typeof req.body?.reason === "string" ? req.body.reason : undefined,
        userId:
          typeof oneUptimeReq.userAuthorization?.["userId"] === "string"
            ? (oneUptimeReq.userAuthorization["userId"] as string)
            : undefined,
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
      const oneUptimeReq: OneUptimeRequest = req as OneUptimeRequest;
      const executionId: string | undefined = req.params["executionId"];

      if (!executionId) {
        throw new BadDataException("executionId is required in URL");
      }

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

      if (
        oneUptimeReq.tenantId &&
        execution.projectId?.toString() !== oneUptimeReq.tenantId.toString()
      ) {
        throw new BadDataException(
          "Runbook execution does not belong to this project",
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
  tenantId: ObjectID | undefined;
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

  if (
    args.tenantId &&
    execution.projectId?.toString() !== args.tenantId.toString()
  ) {
    throw new BadDataException(
      "Runbook execution does not belong to this project",
    );
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
