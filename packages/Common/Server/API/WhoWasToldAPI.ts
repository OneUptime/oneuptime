import UserMiddleware from "../Middleware/UserAuthorization";
import WhoWasToldService from "../Services/WhoWasToldService";
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
import { WhoWasToldResult } from "../../Types/Notification/WhoWasTold";
import ObjectID from "../../Types/ObjectID";

/*
 * WHO WAS TOLD ABOUT AN INCIDENT OR AN ALERT, AS IT HAPPENED
 * (Types/Notification/WhoWasTold, #7075), for the record's overview:
 *
 *   GET /who-was-told/incident/:incidentId
 *   GET /who-was-told/alert/:alertId
 *
 * A signed-in member of the project (or a key of it) who may read the
 * record; every row is read as them, and what they may not read is counted,
 * never named (WhoWasToldService). Reads only. Read again while the record
 * is open: nothing is cached, so a page that went out a second ago is in
 * the next answer.
 *
 * A bare router, as WhoIsToldAPI is: it reads no single model's CRUD routes.
 */

export const WHO_WAS_TOLD_API_PATH: string = "/who-was-told";

const router: ExpressRouter = Express.getRouter();

// What a request with no record, or one that is no id, is told.
export const WHO_WAS_TOLD_ID_MESSAGES: Readonly<
  Record<"incidentId" | "alertId", string>
> = {
  incidentId:
    "Name the incident by its ID, as the incident's page address has it.",
  alertId: "Name the alert by its ID, as the alert's page address has it.",
};

export function readRecordIdParam(
  req: ExpressRequest,
  param: "incidentId" | "alertId",
): ObjectID {
  const raw: string = ((req.params[param] as string) || "").trim();

  if (!raw || !ObjectID.isValidUUID(raw)) {
    throw new BadDataException(WHO_WAS_TOLD_ID_MESSAGES[param]);
  }

  return new ObjectID(raw);
}

router.get(
  `${WHO_WAS_TOLD_API_PATH}/incident/:incidentId`,
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

      const result: WhoWasToldResult = await WhoWasToldService.getForIncident({
        projectId: projectId,
        incidentId: readRecordIdParam(req, "incidentId"),
        props: props,
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

router.get(
  `${WHO_WAS_TOLD_API_PATH}/alert/:alertId`,
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

      const result: WhoWasToldResult = await WhoWasToldService.getForAlert({
        projectId: projectId,
        alertId: readRecordIdParam(req, "alertId"),
        props: props,
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
