import QueueWorkflow from "../Services/QueueWorkflow";
import WorkflowRunAccess from "../Utils/WorkflowRunAccess";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import CommonAPI from "Common/Server/API/CommonAPI";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
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
       * Membership alone is not enough. A run executes the workflow's steps
       * inside the project - arbitrary JavaScript, notification sends,
       * resource create/delete - so it takes a run permission: the
       * workflow's editors, or a Workflow Member, whose role is to run
       * workflows without changing them (WorkflowRunPermissions).
       *
       * The tenant above is only the project the caller *claimed* in the
       * `tenantid` header, so the workflow is then read with the caller's
       * own permissions, in that project: one of project B, one their labels
       * or owned scope leave out, and one that does not exist are refused
       * alike, so the route cannot be used to confirm which workflow ids
       * exist (WorkflowRunAccess).
       */
      await WorkflowRunAccess.assertMayRunWorkflow({
        databaseProps: databaseProps,
        projectId: projectId,
        workflowId: workflowId,
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

}
