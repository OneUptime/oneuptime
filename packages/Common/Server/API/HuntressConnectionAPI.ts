import HuntressConnection from "../../Models/DatabaseModels/HuntressConnection";
import { HUNTRESS_WEBHOOK_ROUTE } from "../../Types/Huntress/HuntressWebhook";
import HuntressConnectionService, {
  Service as HuntressConnectionServiceType,
} from "../Services/HuntressConnectionService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import HuntressWebhookHandler, {
  HuntressWebhookAnswer,
} from "../Utils/Huntress/HuntressWebhookHandler";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";

/*
 * Huntress connections: the usual list, create, update and delete
 * (/huntress-connection), and the address Huntress posts its signed
 * webhooks to, POST /huntress/webhook/<connection id>.
 *
 * The webhook needs no OneUptime credential: the request is accepted only
 * when it is signed with the connection's signing secret
 * (HuntressWebhookHandler). It reads the raw body the JSON parser keeps for
 * signature checks (StartServer's jsonBodyParserOptions), so the bytes it
 * verifies are the bytes it acts on.
 */
export default class HuntressConnectionAPI extends BaseAPI<
  HuntressConnection,
  HuntressConnectionServiceType
> {
  public constructor() {
    super(HuntressConnection, HuntressConnectionService);

    this.router.post(
      `${HUNTRESS_WEBHOOK_ROUTE}/:connectionId`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const result: HuntressWebhookAnswer =
            await HuntressWebhookHandler.handle({
              connectionId: req.params["connectionId"],
              headers: req.headers,
              rawBody: (req as OneUptimeRequest).rawBody,
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
