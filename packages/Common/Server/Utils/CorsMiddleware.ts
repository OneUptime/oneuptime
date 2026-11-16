import CorsOptions from "./CorsOptions";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  RequestHandler,
} from "./Express";
import WebhookVerification from "./WebhookVerification";
import cors from "cors";

/*
 * The shared Express app's CORS middleware: cors, with CorsOptions.
 *
 * cors answers every OPTIONS request itself, as a preflight: 204, and no
 * later middleware or route runs. A CloudEvents webhook validation is an
 * OPTIONS request too - the one Azure Event Grid sends to a CloudEvents 1.0
 * subscription's endpoint, naming itself in WebHook-Request-Origin - and is
 * granted only by an answer carrying WebHook-Allowed-Origin, which cors never
 * writes: such a subscription could not be created (issue #8429). So it goes
 * on to the routes, where an Incoming Request monitor's URL and a workflow's
 * Webhook trigger answer it (WebhookVerification). A browser's preflight
 * always carries Access-Control-Request-Method, and is answered by cors as
 * before.
 */

const corsWithOptions: RequestHandler = cors(CorsOptions);

const CorsMiddleware: RequestHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): void => {
  if (WebhookVerification.isCloudEventsValidation(req)) {
    next();
    return;
  }

  corsWithOptions(req, res, next);
};

export default CorsMiddleware;
