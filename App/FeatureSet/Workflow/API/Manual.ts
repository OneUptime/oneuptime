import QueueWorkflow from "../Services/QueueWorkflow";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import ObjectID from "Common/Types/ObjectID";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
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

/*
 * Manually running a workflow executes its JavaScript and HTTP components on
 * the OneUptime worker, so the trigger requires a real logged-in session
 * (getUserMiddleware admits unauthenticated callers as UserType.Public — it
 * authenticates but does not gate) and the workflow must be readable by the
 * caller under THEIR permissions. Same idiom as AIInvestigationAPI.
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

export default class ManualAPI {
  public router!: ExpressRouter;

  public constructor() {
    this.router = Express.getRouter();

    /*
     * POST only. The dashboard workflow builder is the sole caller and
     * always POSTs; the old GET mount made a code-executing trigger
     * reachable by a plain link.
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
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);

      if (!req.params["workflowId"]) {
        throw new BadDataException("workflowId not found in URL");
      }

      if (!props.tenantId) {
        throw new BadDataException("Project not found in request");
      }

      const workflowId: ObjectID = new ObjectID(
        req.params["workflowId"] as string,
      );

      /*
       * Load the workflow under the caller's permissions. The tenant-scoped
       * read returns null for both a cross-tenant id and a workflow the
       * caller has no read access to — knowledge of a workflowId is never
       * sufficient to run it.
       */
      const workflow: Workflow | null = await WorkflowService.findOneById({
        id: workflowId,
        select: { _id: true },
        props,
      });

      if (!workflow) {
        throw new NotFoundException(
          "Workflow not found (or you do not have access to it).",
        );
      }

      // add this workflow to the run queue and return the 200 response.
      await QueueWorkflow.addWorkflowToQueue({
        workflowId: workflowId,
        returnValues: req.body?.data || {},
      });

      return Response.sendJsonObjectResponse(req, res, {
        status: "Scheduled",
      });
    } catch (err) {
      next(err);
    }
  }
}
