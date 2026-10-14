import ProbeAuthorization from "../../Middleware/ProbeAuthorization";
import ProbeSyslogIngestService from "../../Services/ProbeSyslogIngestService";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import logger from "Common/Server/Utils/Logger";

const router: ExpressRouter = Express.getRouter();

/*
 * The syslog a probe's receiver heard, a batch at a time. The probe is
 * answered as soon as the batch is read; what happens to each message -
 * whose format it is, whether it is a network event, whose device it is
 * from - is ProbeSyslogIngestService's.
 */
router.post(
  "/probe/syslog",
  TelemetryIngestionDisabled.middleware,
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const rawMessages: unknown = req.body["syslogMessages"];

      if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("syslogMessages not found in request body"),
        );
      }

      const probeIdAsString: string | undefined = req.body["probeId"] as
        | string
        | undefined;

      if (!probeIdAsString) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe ID not found on syslog request"),
        );
      }

      // Return response immediately — correlation and log writes happen after.
      Response.sendJsonObjectResponse(req, res, {
        result: "processing",
      });

      try {
        await ProbeSyslogIngestService.processSyslogMessages(
          new ObjectID(probeIdAsString),
          rawMessages as Array<JSONObject>,
        );
      } catch (err) {
        // The response is already sent — log instead of next(err).
        logger.error("Probe syslog ingest: error processing batch:");
        logger.error(err);
      }

      return;
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
