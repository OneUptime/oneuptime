import NetworkDeviceDiscoveryScan from "../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import ProductKey from "../../Types/Product/ProductKey";
import {
  DISCOVERY_SCAN_RUN_NOT_ALLOWED_REFUSAL,
  DISCOVERY_SCAN_RUN_PATH,
  DiscoveryScanRunResult,
} from "../../Utils/NetworkDiscovery/DiscoveryScanRun";
import UserMiddleware from "../Middleware/UserAuthorization";
import NetworkDeviceDiscoveryScanService from "../Services/NetworkDeviceDiscoveryScanService";
import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
import TablePermission from "../Types/Database/Permissions/TablePermission";
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
 * claims no `/:id/run` path, so this one is reached. Who may ask is the
 * whole gate here, because the run itself is written as root
 * (NetworkDeviceDiscoveryScanService.runAgain):
 *
 *  - an authenticated principal of the project - a person, or one of the
 *    project's API keys;
 *  - holding the permission to EDIT discovery scans, checked as the CRUD
 *    API checks an edit of one (TablePermission: the grant, the team's
 *    block list, the plan). A run replaces a scan's results and puts it
 *    back in the queue, which is a change to that scan, as an edit of its
 *    target is: who may create a scan but not edit one gets no way to
 *    change an existing one through this. Scans carry no labels and no
 *    owners, so a grant reaches every scan of the project or none;
 *  - for a scan of the project the principal is in: runAgain looks the scan
 *    up within it, and another project's id reads as no scan at all.
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

/*
 * Refused unless the principal may edit the project's discovery scans, in
 * words that say what they cannot do and why.
 */
export function assertCanRunDiscoveryScans(
  props: DatabaseCommonInteractionProps,
): void {
  try {
    TablePermission.checkTableLevelPermissions(
      NetworkDeviceDiscoveryScan,
      props,
      DatabaseRequestType.Update,
    );
  } catch (error) {
    if (
      error instanceof NotAuthorizedException ||
      error instanceof PaymentRequiredException
    ) {
      throw new NotAuthorizedException(DISCOVERY_SCAN_RUN_NOT_ALLOWED_REFUSAL);
    }

    throw error;
  }
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

      assertCanRunDiscoveryScans(props);

      const result: DiscoveryScanRunResult =
        await NetworkDeviceDiscoveryScanService.runAgain({
          scanId: readScanId(req),
          projectId: projectId,
          // Who asked: named on the scan's row and in the audit log.
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
