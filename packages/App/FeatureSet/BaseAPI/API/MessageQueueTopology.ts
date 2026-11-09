import CommonAPI from "Common/Server/API/CommonAPI";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import MessageQueueTopologyService from "Common/Server/Services/MessageQueueTopologyService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import CallerPermission from "Common/Server/Utils/Permission/CallerPermission";
import Response from "Common/Server/Utils/Response";
import {
  MessageQueueTopologyWindow,
  resolveMessageQueueTopologyWindow,
} from "Common/Server/Utils/Telemetry/MessageQueueTopology";
import TelemetryReadAccess from "Common/Server/Utils/Telemetry/TelemetryReadAccess";
import TelemetryReadScopeUtil, {
  TelemetryReadScope,
  TelemetryServiceFilter,
} from "Common/Server/Utils/Telemetry/TelemetryReadScope";
import Span from "Common/Models/AnalyticsModels/Span";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { MessageQueueTopologyResponse } from "Common/Types/MessageQueue/MessageQueueTopology";

/*
 * The Queues topology (POST /api/telemetry/message-queues/topology): how
 * messages flow between the project's services and its queues over a range
 * (Common/Types/MessageQueue/MessageQueueTopology for the contract,
 * Common/Server/Utils/Telemetry/MessageQueueTopology for the read).
 *
 * Who may ask, and what they get:
 *
 *   - an anonymous caller gets 401 before anything else, so a browser whose
 *     session expired refreshes it and replays the request;
 *   - one project at a time, the one the request is scoped to; anything
 *     project-shaped in the body is ignored;
 *   - the flows are built from spans, so reading the queues' records is not
 *     enough: the caller must hold read on the Span analytics model (the
 *     rule every permission check follows, CallerPermission), and only the
 *     services whose traces they may read are counted (TelemetryReadAccess,
 *     the scope every telemetry read follows);
 *   - the queues are read with the caller's props, so a caller who may not
 *     read queues is refused, and label-limited access shows the queues it
 *     shows on the Queues list.
 */
export default class MessageQueueTopologyAPI {
  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    /*
     * Spelled out (it is MESSAGE_QUEUE_TOPOLOGY_API_PATH, which the
     * Dashboard calls and MessageQueueTopologyAPI.test pins), so the
     * telemetry read-scope guard (TelemetryRoutesReadScope) finds it.
     */
    router.post(
      "/telemetry/message-queues/topology",
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID = CommonAPI.assertTenantScoped(props);

          if (props.isMultiTenantRequest) {
            throw new BadDataException(
              "The queues topology is read one project at a time.",
            );
          }

          if (
            !props.isRoot &&
            !props.isMasterAdmin &&
            !CallerPermission.holdsModelPermission(props, {
              model: new Span(),
              operation: "read",
            })
          ) {
            throw new NotAuthorizedException(
              "You do not have permission to read traces for this project.",
            );
          }

          const body: JSONObject = ((req.body as JSONObject) ||
            {}) as JSONObject;

          const window: MessageQueueTopologyWindow =
            resolveMessageQueueTopologyWindow({
              startTime: body["startTime"],
              endTime: body["endTime"],
              now: OneUptimeDate.getCurrentDate(),
            });

          const scope: TelemetryReadScope = await TelemetryReadAccess.getScope(
            Span,
            props,
          );
          const serviceFilter: TelemetryServiceFilter =
            TelemetryReadScopeUtil.toServiceFilter(scope);

          const topology: MessageQueueTopologyResponse =
            await MessageQueueTopologyService.getTopology({
              projectId: projectId,
              window: window,
              serviceFilter: serviceFilter,
              props: props,
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            topology as unknown as JSONObject,
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    return router;
  }
}
