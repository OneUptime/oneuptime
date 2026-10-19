import { ProbeExpressRequest } from "../Types/Request";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ProbeService from "Common/Server/Services/ProbeService";
import ProbeReportIdentity from "Common/Server/Utils/Probe/ProbeReportIdentity";
import WrongComponentKeyLimit, {
  ComponentKeyKind,
} from "Common/Server/Utils/RateLimit/WrongComponentKeyLimit";
import { WrongKeyRefusal } from "Common/Server/Utils/RateLimit/WrongKeyLimit";
import { ExpressResponse, NextFunction } from "Common/Server/Utils/Express";
import logger, {
  getLogAttributesFromRequest,
} from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import Probe from "Common/Models/DatabaseModels/Probe";
import NumberUtil from "Common/Utils/Number";

/*
 * Probe-side logs can prove a request left the probe and got no answer, but
 * only this side can say whether the server ever started working on it. Any
 * probe request slower than this is logged with the probe's id, so a
 * "probe is Disconnected" report can be checked against the server's own
 * view instead of guessing.
 */
const SLOW_PROBE_REQUEST_THRESHOLD_IN_MS: number =
  NumberUtil.parseNumberWithDefault({
    value: process.env["PROBE_INGEST_SLOW_REQUEST_THRESHOLD_IN_MS"],
    defaultValue: 10000,
    min: 100,
  });

export default class ProbeAuthorization {
  /*
   * Times the request from this middleware to the response, and reports the
   * two outcomes that matter for a Disconnected probe: a slow answer, and no
   * answer at all because the probe hit its own deadline and hung up first.
   * The latter is the definitive proof that a probe timeout is server-side.
   */
  private static observeRequestDuration(
    req: ProbeExpressRequest,
    res: ExpressResponse,
    probeIdForLogging: string,
  ): void {
    const responseEmitter: {
      on?: (event: string, listener: () => void) => void;
    } = res as unknown as {
      on?: (event: string, listener: () => void) => void;
    };

    // Unit tests hand in a bare object; there is nothing to listen to there.
    if (typeof responseEmitter.on !== "function") {
      return;
    }

    const startedAtInMs: number = Date.now();
    const route: string = req.url || "unknown route";
    let hasSettled: boolean = false;

    responseEmitter.on("finish", (): void => {
      hasSettled = true;

      const durationInMs: number = Date.now() - startedAtInMs;

      if (durationInMs < SLOW_PROBE_REQUEST_THRESHOLD_IN_MS) {
        return;
      }

      logger.warn(
        `Slow probe request: ${route} for probe ${probeIdForLogging} took ${durationInMs}ms to answer. Probes give up on their own deadline (45s by default) and are flagged Disconnected shortly after.`,
      );
    });

    responseEmitter.on("close", (): void => {
      if (hasSettled) {
        return;
      }

      logger.warn(
        `Probe ${probeIdForLogging} gave up on ${route} after ${
          Date.now() - startedAtInMs
        }ms — this server never sent a response. The probe's timeout is server-side, not a network fault on the probe's end.`,
      );
    });
  }

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

      /*
       * One spelling of the probe's id - lower-cased, as Postgres stores a
       * uuid - for everything below: the key check and its cache, the
       * liveness stamp, and req.probe, which every handler names the probe
       * by. Postgres reads a uuid in any case; a cache key or a string
       * comparison does not.
       */
      const probeId: ObjectID = ProbeReportIdentity.normalize(
        new ObjectID(data["probeId"] as string),
      );

      const probeKey: string = data["probeKey"] as string;

      ProbeAuthorization.observeRequestDuration(req, res, probeId.toString());

      /*
       * A client that sent too many different wrong keys for this probe is
       * refused before its key is looked up (WrongComponentKeyLimit).
       */
      const refusedBeforeLookup: WrongKeyRefusal | null =
        await WrongComponentKeyLimit.checkBeforeLookup({
          req: req,
          kind: ComponentKeyKind.Probe,
          componentId: probeId.toString(),
        });

      if (refusedBeforeLookup) {
        return WrongComponentKeyLimit.answerRefusal(
          req,
          res,
          ComponentKeyKind.Probe,
          refusedBeforeLookup,
        );
      }

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

      /*
       * Too many different wrong keys for this probe from this client:
       * refused, whichever key this request carries
       * (WrongComponentKeyLimit). A probe that still holds an old key sends
       * that one key, so it is never refused for it.
       */
      const refusal: WrongKeyRefusal | null =
        await WrongComponentKeyLimit.checkComponentKey({
          req: req,
          kind: ComponentKeyKind.Probe,
          componentId: probeId.toString(),
          presentedKey: probeKey,
          isKeyRight: isValidProbe,
          componentExists: async (): Promise<boolean> => {
            return await ProbeService.hasProbeWithId(probeId);
          },
        });

      if (refusal) {
        return WrongComponentKeyLimit.answerRefusal(
          req,
          res,
          ComponentKeyKind.Probe,
          refusal,
        );
      }

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
       * From here on the request is this probe's, and req.probe is how a
       * handler knows which probe it is (Utils/ProbeRequest). A handler
       * never reads a probe id from the body: what the body says, inside a
       * result especially, names nobody on its own (ProbeReportIdentity).
       * Handlers only ever read req.probe.id, so hand them exactly that
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
