import QueueWorkflow from "../Services/QueueWorkflow";
import { HUNTRESS_WEBHOOK_ROUTE } from "Common/Types/Huntress/HuntressWebhook";
import { ExecuteWorkflowType } from "Common/Server/Types/Workflow/TriggerCode";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  OneUptimeRequest,
} from "Common/Server/Utils/Express";
import HuntressWebhookHandler, {
  HuntressWebhookAnswer,
} from "Common/Server/Utils/Huntress/HuntressWebhookHandler";
import Response from "Common/Server/Utils/Response";

/*
 * THE ADDRESS HUNTRESS CONNECTIONS HAD: POST /api/huntress/webhook/<key>.
 *
 * Before Huntress became a workflow trigger, each Huntress connection was
 * given this address, and Huntress endpoints still post to it. Every
 * connection became a workflow whose webhook secret key is the
 * connection's id (Workers' MoveHuntressConnectionsToWorkflows), so the
 * address keeps starting what the connection did, with nothing to change
 * in Huntress: it is answered exactly as the trigger's own URL
 * (<workflow service>/huntress/<key>) is, by the same handler - the
 * signature checked with the workflow's signing secret, and a run started
 * for each event.
 *
 * Mounted under /api by the workflow feature set, which owns the queue
 * runs are started through.
 */
export default class HuntressLegacyWebhookAPI {
  public router: ExpressRouter;

  public constructor() {
    this.router = Express.getRouter();

    this.router.post(
      `${HUNTRESS_WEBHOOK_ROUTE}/:secretkey`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const result: HuntressWebhookAnswer =
            await HuntressWebhookHandler.handle({
              secretKey: req.params["secretkey"],
              headers: req.headers,
              rawBody: (req as OneUptimeRequest).rawBody,
              executeWorkflow: async (
                executeWorkflow: ExecuteWorkflowType,
              ): Promise<void> => {
                await QueueWorkflow.addWorkflowToQueue(executeWorkflow);
              },
            });

          return Response.sendCustomResponse(
            req,
            res,
            result.statusCode,
            result.body,
            {},
          );
        } catch (err) {
          return next(err);
        }
      },
    );
  }
}
