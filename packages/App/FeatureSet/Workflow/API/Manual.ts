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

export default class ManualAPI {
  public router!: ExpressRouter;

  public constructor() {
    this.router = Express.getRouter();

    this.router.get(
      `/run/:workflowId`,
      UserMiddleware.getUserMiddleware,
      this.manuallyRunWorkflow,
    );

    this.router.post(
      `/run/:workflowId`,
      UserMiddleware.getUserMiddleware,
      this.manuallyRunWorkflow,
    );
  }

  public async manuallyRunWorkflow(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      // add this workflow to the run queue and return the 200 response.

      if (!req.params["workflowId"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("workflowId not found in URL"),
        );
      }

      const workflowId: ObjectID = new ObjectID(
        req.params["workflowId"] as string,
      );

      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      /*
       * getUserMiddleware is a context loader, not a gate: a request with no
       * cookie, no bearer token and no apikey header is tagged
       * UserType.Public and passed straight through to here. This route then
       * runs the workflow as root — including its JavaScript / custom-code
       * and notification components — so it has to prove the caller itself.
       *
       * Programmatic callers trigger a workflow through its own API/webhook
       * trigger (`/workflow/trigger/:secretkey`), which authenticates with
       * the workflow's secret key. This route backs the dashboard's "Run"
       * button, so it requires a logged-in member of the project.
       */
      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(databaseProps);

      /*
       * The tenant above is only the project the caller *claimed* in the
       * `tenantid` header. Take the owning project off the workflow row
       * itself and require the two to match, otherwise a member of project A
       * reaches project B's workflow id just by sending their own header.
       * A workflow that does not exist is rejected the same way, so the route
       * cannot be used to confirm which workflow ids exist in other projects.
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

      ManualAPI.assertCallerCanRunWorkflow({
        databaseProps: databaseProps,
        projectId: projectId,
      });

      await QueueWorkflow.addWorkflowToQueue({
        workflowId: workflowId,
        returnValues: req.body.data || {},
      });

      return Response.sendJsonObjectResponse(req, res, {
        status: "Scheduled",
      });
    } catch (err) {
      next(err);
    }
  }

  /*
   * Membership alone is not enough. Running a workflow executes its
   * components inside the project — arbitrary JavaScript, notification sends,
   * resource create/delete — so it is a write-level action, not a read. Gate
   * it on the same permissions that govern updating the Workflow model
   * itself: the dashboard's Run button lives on the builder page, which
   * already needs those permissions to save the graph, so no caller who can
   * legitimately reach the button loses access. Reading the list off the
   * model keeps this in step with the CRUD route if the model's access
   * control changes.
   */
  private static assertCallerCanRunWorkflow(data: {
    databaseProps: DatabaseCommonInteractionProps;
    projectId: ObjectID;
  }): void {
    // Master admins bypass permission checks, as they do in requirePermission.
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
