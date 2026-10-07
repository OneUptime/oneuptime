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
       * The manual run's gates, in the same order and for the same reasons -
       * see App/FeatureSet/Workflow/API/Manual.ts - with the permission an
       * edit takes. getUserMiddleware is a context loader rather than a gate,
       * so an unauthenticated request reaches here tagged Public; this route
       * runs component code, so it has to prove the caller itself.
       */
      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(databaseProps);

      /*
       * Running one step on its own skips every step and condition before
       * it, so it can do what the workflow as built never would: a builder's
       * test, which takes permission to edit this workflow - Workflow
       * Members, who may run the whole workflow, may not run one step of it.
       * The tenant above is only the project the caller claimed in the
       * header, so the workflow's own project must match it, and the
       * workflow must be one the caller may change (WorkflowRunAccess).
       */
      await WorkflowRunAccess.assertMayRunStep({
        databaseProps: databaseProps,
        projectId: projectId,
        workflowId: workflowId,
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
}
