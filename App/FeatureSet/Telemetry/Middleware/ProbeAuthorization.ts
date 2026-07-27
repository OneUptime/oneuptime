import { ProbeExpressRequest } from "../Types/Request";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ProbeService from "Common/Server/Services/ProbeService";
import { ExpressResponse, NextFunction } from "Common/Server/Utils/Express";
import logger, {
  getLogAttributesFromRequest,
} from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import Probe from "Common/Models/DatabaseModels/Probe";

export default class ProbeAuthorization {
  public static async isAuthorizedServiceMiddleware(
    req: ProbeExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    /*
     * The whole body is wrapped in try/catch because this is an ASYNC
     * middleware on Express 4, which ignores the promise a middleware
     * returns: a rejection here (pool-acquire timeout, statement timeout,
     * Redis failure) would otherwise be swallowed by the process-level
     * unhandledRejection logger and the HTTP request would NEVER be
     * answered — the probe client sees a connection that accepts the
     * request and then goes silent until its own timeout. That silent-hang
     * mode is exactly how a briefly-starved database turned into probes
     * being flagged Disconnected in the field.
     */
    try {
      const data: JSONObject = req.body;

      if (!data["probeId"] || !data["probeKey"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("ProbeId or ProbeKey is missing"),
        );
      }

      const probeId: ObjectID = new ObjectID(data["probeId"] as string);

      const probeKey: string = data["probeKey"] as string;

      /*
       * Cache-backed verification: repeat requests from a probe skip the
       * per-request Probe SELECT, so authentication stays fast even while
       * the Postgres pool is busy. Falls back to the database on any cache
       * miss or cache failure.
       */
      const isValidProbe: boolean = await ProbeService.verifyProbeKey({
        probeId: probeId,
        probeKey: probeKey,
      });

      if (!isValidProbe) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Probe ID or Probe Key"),
        );
      }

      /*
       * Every authenticated request proves the probe is alive, so the
       * liveness stamp rides along here — but deliberately WITHOUT being
       * awaited. The write is throttled (one single-statement UPDATE per
       * probe per 30s) and self-heals (a failed write clears the throttle
       * so the next request retries), and nothing downstream reads its
       * result. Awaiting it would chain every probe request's latency —
       * including the /alive heartbeat itself — to Postgres write latency,
       * which is precisely the coupling that let a slow database mark
       * healthy probes Disconnected.
       */
      ProbeService.updateLastAlive(probeId).catch((err: Error) => {
        logger.error(
          `Failed to update lastAlive for probe ${probeId.toString()}`,
          getLogAttributesFromRequest(req as any),
        );
        logger.error(err, getLogAttributesFromRequest(req as any));
      });

      /*
       * Handlers only ever read req.probe.id (verified: DiscoveryScan,
       * NetworkDevicePoll, Monitor routes), so hand them exactly that
       * instead of a fetched row.
       */
      const probe: Probe = new Probe();
      probe.id = probeId;
      req.probe = probe;

      return next();
    } catch (err) {
      return next(err);
    }
  }
}
