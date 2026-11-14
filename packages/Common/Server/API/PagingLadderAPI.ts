import UserMiddleware from "../Middleware/UserAuthorization";
import PagingLadderService, {
  PagingLadderSaveResult,
} from "../Services/PagingLadderService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  PAGING_LADDER_API_PATH,
  PAGING_LADDER_APPLY_ROUTE,
} from "../../Types/NotificationRule/PagingLadder";

/*
 * HOW TO REACH ME: SAVE A PAGING LADDER (#6820, PagingLadderService).
 *
 *   POST /paging-ladder/apply   { userId?, steps: [...] }
 *
 * Saves the ladder as the person's on-call rules, in every live card of
 * the grid. `userId` names a member; left out, the ladder is the caller's
 * own. A signed-in member of the project, as a person, on a credential
 * that may make changes - a ladder is somebody's, so a project API key
 * saves none. Who may change whose ladder is the service's to say.
 *
 * A bare router, as OnCallTestPageAPI is: it writes rows of a model, but
 * not through that model's CRUD routes.
 */

export { PAGING_LADDER_API_PATH };

const router: ExpressRouter = Express.getRouter();

// The member a request names, or null for the caller's own ladder.
export function readLadderUserId(value: unknown): ObjectID | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const text: string = typeof value === "string" ? value.trim() : "";

  if (!text || !ObjectID.isValidUUID(text)) {
    throw new BadDataException(
      "The member to save a ladder for is not one OneUptime knows. Open their page under Users, then save again.",
    );
  }

  return new ObjectID(text);
}

router.post(
  PAGING_LADDER_APPLY_ROUTE,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = {
        ...(await CommonAPI.getDatabaseCommonInteractionProps(req)),
        isMultiTenantRequest: false,
      };

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);

      DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(props);

      const body: JSONObject = (req.body || {}) as JSONObject;

      const targetUserId: ObjectID =
        readLadderUserId(body["userId"]) || props.userId!;

      const result: PagingLadderSaveResult =
        await PagingLadderService.applyLadder({
          projectId: projectId,
          targetUserId: targetUserId,
          steps: body["steps"],
          props: props,
        });

      return Response.sendJsonObjectResponse(req, res, result);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
