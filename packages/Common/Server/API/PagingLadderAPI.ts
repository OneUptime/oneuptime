import UserMiddleware from "../Middleware/UserAuthorization";
import PagingLadderService, {
  PagingLadderSaveResult,
} from "../Services/PagingLadderService";
import {
  MAX_PAGING_LADDER_DEFAULT_MEMBERS,
  PAGING_LADDER_APPLY_DEFAULT_ROUTE,
  PagingLadderDefaultMemberResult,
} from "../../Types/NotificationRule/PagingLadderDefault";
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
import { JSONArray, JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  PAGING_LADDER_API_PATH,
  PAGING_LADDER_APPLY_ROUTE,
} from "../../Types/NotificationRule/PagingLadder";

/*
 * HOW TO REACH ME: SAVE A PAGING LADDER (#6820, PagingLadderService).
 *
 *   POST /paging-ladder/apply   { userId?, steps: [...], keepCards?: [...] }
 *   POST /paging-ladder/apply-default   { userIds: [...] }
 *
 * Saves the ladder as the person's on-call rules, in every live card of
 * the grid but those `keepCards` names ({ ruleType, severityId }), which
 * keep their own rules (#8890). `userId` names a member; left out, the ladder is the caller's
 * own. A signed-in member of the project, as a person, on a credential
 * that may make changes - a ladder is somebody's, so a project API key
 * saves none. Who may change whose ladder is the service's to say.
 *
 * apply-default (#7450) gives each member named the project's default
 * ladder, as far as their verified methods go, through the same save
 * (PagingLadderService.applyDefaultLadderToMembers): admins only, never a
 * non-member, and it answers for every member - what was applied, what was
 * left out and why, or why nothing was. On-Call > Readiness names one
 * member a request, so its progress can be shown and stopped.
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

/*
 * The members a request applies the default to: one at least, at most
 * MAX_PAGING_LADDER_DEFAULT_MEMBERS, each a member's id, each once, in the
 * order sent.
 */
export function readDefaultLadderUserIds(value: unknown): Array<ObjectID> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BadDataException(
      "Choose at least one member to apply the default ladder to, then try again.",
    );
  }

  if (value.length > MAX_PAGING_LADDER_DEFAULT_MEMBERS) {
    throw new BadDataException(
      `Apply the default ladder to at most ${MAX_PAGING_LADDER_DEFAULT_MEMBERS} members at a time. Choose fewer, then try again.`,
    );
  }

  const seen: Set<string> = new Set<string>();
  const userIds: Array<ObjectID> = [];

  for (const entry of value) {
    const text: string = typeof entry === "string" ? entry.trim() : "";

    if (!text || !ObjectID.isValidUUID(text)) {
      throw new BadDataException(
        "A member to apply the default ladder to is not one OneUptime knows. Reload the page, then try again.",
      );
    }

    if (!seen.has(text)) {
      seen.add(text);
      userIds.push(new ObjectID(text));
    }
  }

  return userIds;
}

router.post(
  PAGING_LADDER_APPLY_DEFAULT_ROUTE,
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

      const userIds: Array<ObjectID> = readDefaultLadderUserIds(
        body["userIds"],
      );

      const results: Array<PagingLadderDefaultMemberResult> =
        await PagingLadderService.applyDefaultLadderToMembers({
          projectId: projectId,
          userIds: userIds,
          props: props,
        });

      return Response.sendJsonObjectResponse(req, res, {
        results: results as unknown as JSONArray,
      });
    } catch (err) {
      next(err);
    }
  },
);

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
          keepCards: body["keepCards"],
          props: props,
        });

      return Response.sendJsonObjectResponse(req, res, result);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
