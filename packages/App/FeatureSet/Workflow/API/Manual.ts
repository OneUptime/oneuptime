import QueueWorkflow from "../Services/QueueWorkflow";
import { resolveRunRecordValues } from "../Utils/RunRecordValues";
import WorkflowRunAccess from "../Utils/WorkflowRunAccess";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  WORKFLOW_RUN_CANNOT_RUN_AGAIN_MESSAGE,
  readTriggerValues,
} from "Common/Types/Workflow/WorkflowRunAgain";
import WorkflowLog from "Common/Models/DatabaseModels/WorkflowLog";
import CommonAPI from "Common/Server/API/CommonAPI";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import WorkflowLogService from "Common/Server/Services/WorkflowLogService";
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

    /*
     * Run again: a new run with what an earlier run started with. POST for the
     * same reason as above.
     */
    this.router.post(
      `/run-again/:workflowLogId`,
      UserMiddleware.getUserMiddleware,
      this.runAgain,
    );
  }

  /*
   * A new run of the workflow as it is now, with what an earlier run's trigger
   * started with (Types/Workflow/WorkflowRunAgain). The gates are Run Workflow's,
   * for the reasons given there: this runs the workflow's steps just the same.
   */
  public async runAgain(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.params["workflowLogId"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("workflowLogId not found in URL"),
        );
      }

      const workflowLogId: ObjectID = new ObjectID(
        req.params["workflowLogId"] as string,
      );

      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(databaseProps);

      /*
       * Read as OneUptime: nobody may read triggerValues through the API. So
       * the project is checked first and nothing of the row is answered with -
       * a run of another project and one that does not exist are refused alike.
       */
      const run: WorkflowLog | null = await WorkflowLogService.findOneById({
        id: workflowLogId,
        select: {
          projectId: true,
          workflowId: true,
          triggerValues: true,
        },
        props: {
          isRoot: true,
        },
      });

      CommonAPI.assertResourceBelongsToProject({
        resourceProjectId: run?.projectId,
        projectId: projectId,
      });

      if (!run?.workflowId) {
        throw new BadDataException(WORKFLOW_RUN_CANNOT_RUN_AGAIN_MESSAGE);
      }

      await WorkflowRunAccess.assertMayRunWorkflow({
        databaseProps: databaseProps,
        projectId: projectId,
        workflowId: run.workflowId,
      });

      const values: JSONObject | null = readTriggerValues(run.triggerValues);

      if (!values) {
        throw new BadDataException(WORKFLOW_RUN_CANNOT_RUN_AGAIN_MESSAGE);
      }

      // This person's run, so it goes ahead as a test run while the workflow is off.
      await QueueWorkflow.addWorkflowToQueue({
        workflowId: run.workflowId,
        returnValues: values,
        startedByUserId: databaseProps.userId,
      });

      return Response.sendJsonObjectResponse(req, res, {
        status: "Scheduled",
      });
    } catch (err) {
      next(err);
    }
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
