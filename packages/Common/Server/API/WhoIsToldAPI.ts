import UserMiddleware from "../Middleware/UserAuthorization";
import WhoIsToldService from "../Services/WhoIsToldService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import { WhoIsToldResult } from "../../Types/Monitor/WhoIsTold";
import ObjectID from "../../Types/ObjectID";

/*
 * WHO IS TOLD WHEN A MONITOR GOES DOWN (Types/Monitor/WhoIsTold), for the
 * monitor's overview and whatever else shows the chain:
 *
 *   GET /who-is-told/monitor/:monitorId[?refresh=true]
 *
 * A signed-in member of the project (or a key of it) who may read the
 * monitor; what they may not read of its policies and rules is taken out by
 * the service (WhoIsToldService.getForMonitor). Reads only. `refresh` works
 * the answer out again instead of using the minute-old one, as Readiness's
 * Recheck does.
 *
 * A bare router, as OnCallReadinessAPI is: it reads no single model's CRUD
 * routes.
 */

export const WHO_IS_TOLD_API_PATH: string = "/who-is-told";

const router: ExpressRouter = Express.getRouter();

export function readMonitorIdParam(req: ExpressRequest): ObjectID {
  const raw: string = ((req.params["monitorId"] as string) || "").trim();

  if (!raw || !ObjectID.isValidUUID(raw)) {
    throw new BadDataException("monitorId is required.");
  }

  return new ObjectID(raw);
}

export function isRefreshRequested(req: ExpressRequest): boolean {
  const raw: unknown = (req.query as Record<string, unknown>)["refresh"];

  if (raw === undefined || raw === null) {
    return false;
  }

  const normalized: string = String(raw).trim().toLowerCase();

  return normalized === "true" || normalized === "1";
}

router.get(
  `${WHO_IS_TOLD_API_PATH}/monitor/:monitorId`,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);

      const monitorId: ObjectID = readMonitorIdParam(req);

      const result: WhoIsToldResult = await WhoIsToldService.getForMonitor({
        projectId: projectId,
        monitorId: monitorId,
        props: props,
        refresh: isRefreshRequested(req),
      });

      return Response.sendJsonObjectResponse(
        req,
        res,
        result as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

export default router;
