import { ProbeExpressRequest } from "../Types/Request";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ProbeService from "Common/Server/Services/ProbeService";
import { ExpressResponse, NextFunction } from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import Probe from "Common/Models/DatabaseModels/Probe";

export default class ProbeAuthorization {
  public static async isAuthorizedServiceMiddleware(
    req: ProbeExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
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
     * Cached in-process (60s positive / 10s negative), invalidated on probe
     * update and delete. This runs on every probe ingest request, and
     * /probe/response/ingest does no other Postgres work — it enqueues to
     * Redis — so resolving this from cache takes the highest-volume endpoint
     * in the product off Postgres entirely.
     */
    const authorizedProbeId: ObjectID | null =
      await ProbeService.getProbeIdByKey(probeId, probeKey);

    if (!authorizedProbeId) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Probe ID or Probe Key"),
      );
    }

    await ProbeService.updateLastAlive(authorizedProbeId);

    /*
     * The previous lookup selected only _id, so every downstream consumer
     * already reads nothing but `.id` off this object.
     */
    const probe: Probe = new Probe();
    probe.id = authorizedProbeId;

    req.probe = probe;

    return next();
  }
}
