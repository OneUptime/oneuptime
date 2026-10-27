import QueueWorkflow from "../Services/QueueWorkflow";
import { resolveRunRecordValues } from "../Utils/RunRecordValues";
import WorkflowRunAccess from "../Utils/WorkflowRunAccess";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
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

    /*
     * POST only. A run executes the workflow as the person who asks, as a
     * test run that goes ahead while the workflow is off. The session
     * cookie is SameSite=Lax, which a link on another site still carries on
     * a GET, and the project can be named in the query string - so as a
     * GET, a link a member followed ran the workflow as them.
     */
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
       * runs the workflow - its record steps as a Project Admin of the
       * project, and its JavaScript / custom-code and notification
       * components - so it has to prove the caller itself.
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
       * `tenantid` header, so the workflow's own project must match it - a
       * workflow of project B and one that does not exist are refused
       * alike, so the route cannot be used to confirm which workflow ids
       * exist - and the grant that lets the caller run it must reach it:
       * its labels and owned scope count (WorkflowRunAccess).
       */
      await WorkflowRunAccess.assertMayRunWorkflow({
        databaseProps: databaseProps,
        projectId: projectId,
        workflowId: workflowId,
      });

      /*
       * A record trigger runs with a record. Someone can name it by its
       * number - INC-8 - rather than its ID; that is looked up in this
       * project, with their own permissions, before the run is queued
       * (Utils/RunRecordValues).
       */
      const runValues: JSONObject = await resolveRunRecordValues({
        workflowId: workflowId,
        projectId: projectId,
        props: databaseProps,
        values: (req.body?.data as JSONObject) || {},
      });

      /*
       * The run is recorded as this person's. That is also what lets it go
       * ahead while the workflow is turned off, as a test run: off pauses
       * the workflow's trigger, not a person testing it from its Builder
       * (QueueWorkflow, Types/Workflow/WorkflowEnabled). The caller was
       * checked above, so the id is a signed-in member's, never one a
       * request names.
       */
      await QueueWorkflow.addWorkflowToQueue({
        workflowId: workflowId,
        returnValues: runValues,
        startedByUserId: databaseProps.userId,
      });

      return Response.sendJsonObjectResponse(req, res, {
        status: "Scheduled",
      });
    } catch (err) {
      next(err);
    }
  }
}
