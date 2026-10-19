import { ProbeExpressRequest } from "../Types/Request";
import ObjectID from "Common/Types/ObjectID";

/*
 * Which probe a probe ingest request is from.
 *
 * ProbeAuthorization.isAuthorizedServiceMiddleware checks the probe's id and
 * key and sets req.probe; from then on the request is that probe's. A route
 * reads its probe here and never from the body: the body's top-level
 * probeId is read only by the middleware, to authenticate it, and an id
 * inside what the probe reports names nobody on its own account
 * (ProbeReportIdentity, in Common).
 */
export default class ProbeRequest {
  // Null on a request the middleware did not authenticate.
  public static getProbeId(req: ProbeExpressRequest): ObjectID | null {
    return req.probe?.id || null;
  }
}
