import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import ProductKey from "../../Types/Product/ProductKey";
import {
  DISCOVERY_SCAN_RUN_PATH,
  DiscoveryScanRunResult,
} from "../../Utils/NetworkDiscovery/DiscoveryScanRun";
import UserMiddleware from "../Middleware/UserAuthorization";
import NetworkDeviceDiscoveryScanService from "../Services/NetworkDeviceDiscoveryScanService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import ServerProductRoutes from "../Utils/ServerProducts/ServerProductRoutes";
import CommonAPI from "./CommonAPI";

/*
 * RUNNING A DISCOVERY SCAN AGAIN, OVER HTTP (OneUptime issue #10334).
 *
 *   POST /network-device-discovery-scan/:scanId/run    queue the scan's
 *                                                      next run, now
 *
 * Network > Discovery's Run Again asks this, and so may an API key: a scan
 * re-run after new devices are installed is worth automating. It runs the
 * scan it names - the same row, with its own target, probe, method and
 * credentials - and answers with the scan queued (DiscoveryScanRunResult),
 * or refuses with why (Common/Utils/NetworkDiscovery/DiscoveryScanRun).
 *
 * A bare router beside the scan's CRUD API, mounted in BaseAPI: BaseAPI
 * claims no `/:id/run` path, so this one is reached. The run is written as
 * root, so who may ask is the gate, in two halves:
 *
 *  - here, an authenticated principal of the project - a person, or one of
 *    the project's API keys;
 *  - in NetworkDeviceDiscoveryScanService.runAgain, whoever may EDIT this
 *    scan, asked exactly as the CRUD API asks an update of it by id: a run
 *    replaces a scan's results and queues it, which is a change to the
 *    scan. Asked there, so every caller of the run is held to it.
 *
 * The request carries no body: the scan is run as it is saved.
 */
const router: ExpressRouter = Express.getRouter();

/*
 * ":scanId" as an ObjectID. Checked here: ObjectID's constructor takes any
 * string, and an id that is not one would reach the query layer as a
 * Postgres syntax error instead of a bad request.
 */
function readScanId(req: ExpressRequest): ObjectID {
  const scanId: string | undefined = req.params["scanId"];

  if (!scanId || !ObjectID.isValidUUID(scanId)) {
    throw new BadDataException("Invalid discovery scan ID.");
  }

  return new ObjectID(scanId);
}

router.post(
  DISCOVERY_SCAN_RUN_PATH,
  UserMiddleware.getUserMiddleware,
  ServerProductRoutes.refuseWhileOff(ProductKey.Network),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectPrincipal(props);

      const result: DiscoveryScanRunResult =
        await NetworkDeviceDiscoveryScanService.runAgain({
          scanId: readScanId(req),
          projectId: projectId,
          // Who asked: held to the edit check, and named on the scan's row.
          props: props,
        });

      return Response.sendJsonObjectResponse(
        req,
        res,
        result as unknown as JSONObject,
      );
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
