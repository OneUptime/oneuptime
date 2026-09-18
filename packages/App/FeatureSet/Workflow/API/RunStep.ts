import QueueWorkflow from "../Services/QueueWorkflow";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import ObjectID from "Common/Types/ObjectID";
import Permission, {
  PermissionHelper,
  UserPermission,
  UserTenantAccessPermission,
} from "Common/Types/Permission";
import CommonAPI from "Common/Server/API/CommonAPI";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import WorkflowService from "Common/Server/Services/WorkflowService";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";

/**
 * "Run just this step" from the workflow builder.
 *
 * This runs the step FOR REAL. There is no notion of a safe or read-only
 * component anywhere in the product: roughly half the registry sends messages,
 * calls arbitrary URLs, or creates, updates and deletes rows, and none of that
 * is undone afterwards. The endpoint is named and worded accordingly, and the
 * dashboard confirms before calling it.
 *
 * It deliberately does NOT execute the component itself. It enqueues an
 * ordinary workflow run that happens to be narrowed to one step, so it inherits
 * everything a run already has and adds no new execution path:
 *
 *   - the workflow must be enabled, the subscription paid, and the project's
 *     plan run-limit respected (QueueWorkflow.addWorkflowToQueue)
 *   - a WorkflowLog row is written, so a step that sends a message or deletes
 *     rows leaves an audit trail like any other run
 *   - the component executes on a worker, not inside the API process, which
 *     the deployment topology deliberately separates (DISABLE_QUEUE_WORKERS on
 *     the api role)
 *   - logs and returned values are redacted by the runner's existing rules
 *     rather than being handed back in the HTTP response
 *
 * The caller gets "Scheduled", exactly as the manual run does, and reads the
 * result from the run's step trace.
 */
export default class RunStepAPI {
  public router!: ExpressRouter;

  public constructor() {
    this.router = Express.getRouter();

    this.router.post(
      `/run-step/:workflowId`,
      UserMiddleware.getUserMiddleware,
      this.runSingleStep,
    );
  }

  public async runSingleStep(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.params["workflowId"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("workflowId not found in URL"),
        );
      }

      const componentId: string | undefined = req.body?.componentId;

      if (!componentId || typeof componentId !== "string") {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("componentId is required"),
        );
      }

      const workflowId: ObjectID = new ObjectID(
        req.params["workflowId"] as string,
      );

      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      /*
       * Same four gates as the manual run, in the same order and for the same
       * reasons — see App/FeatureSet/Workflow/API/Manual.ts. getUserMiddleware
       * is a context loader rather than a gate, so an unauthenticated request
       * reaches here tagged Public; this route runs component code, so it has
       * to prove the caller itself.
       */
      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(databaseProps);

      /*
       * The tenant above is only the project the caller claimed in the header.
       * Take the owning project off the workflow row and require the two to
       * match, so a member of project A cannot reach project B's workflow by
       * sending their own header.
       */
      const workflow: Workflow | null = await WorkflowService.findOneById({
        id: workflowId,
        select: {
          projectId: true,
        },
        props: {
          isRoot: true,
        },
      });

      CommonAPI.assertResourceBelongsToProject({
        resourceProjectId: workflow?.projectId,
        projectId: projectId,
      });

      RunStepAPI.assertCallerCanRunWorkflow({
        databaseProps: databaseProps,
        projectId: projectId,
      });

      await QueueWorkflow.addWorkflowToQueue({
        workflowId: workflowId,
        returnValues: {},
        runOnlyComponentId: componentId,
      });

      return Response.sendJsonObjectResponse(req, res, {
        status: "Scheduled",
      });
    } catch (err) {
      next(err);
    }
  }

  /*
   * Running one step executes component code inside the project just as a full
   * run does, so it is gated on the same write-level permissions as updating
   * the Workflow model — identical to the manual run. Anyone who can reach the
   * builder's settings panel already holds these.
   */
  private static assertCallerCanRunWorkflow(data: {
    databaseProps: DatabaseCommonInteractionProps;
    projectId: ObjectID;
  }): void {
    if (data.databaseProps.isMasterAdmin) {
      return;
    }

    const tenantPermission: UserTenantAccessPermission | undefined =
      data.databaseProps.userTenantAccessPermission?.[
        data.projectId.toString()
      ];

    const callerPermissions: Array<Permission> = (
      tenantPermission?.permissions || []
    ).map((userPermission: UserPermission) => {
      return userPermission.permission;
    });

    if (
      !PermissionHelper.doesPermissionsIntersect(
        callerPermissions,
        new Workflow().getUpdatePermissions(),
      )
    ) {
      throw new NotAuthorizedException(
        "You do not have permission to run this workflow.",
      );
    }
  }
}
