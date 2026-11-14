import UserMiddleware from "../Middleware/UserAuthorization";
import UsedByService from "../Services/UsedByService";
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
import ObjectID from "../../Types/ObjectID";
import {
  UsedByPage,
  UsedByRecordKind,
  UsedByRelation,
  UsedBySummary,
  isUsedByRecordKind,
  isUsedByRelation,
} from "../../Types/UsedBy/UsedBy";

/*
 * WHAT REFERS TO A RECORD (#6813; Types/UsedBy/UsedBy), for its page's
 * "Used by" card and its Delete and Archive dialogs:
 *
 *   GET /used-by/:recordKind/:recordId
 *     -> UsedBySummary: every relation of the kind, its counts (seen and
 *        hidden) and its first few rows
 *
 *   GET /used-by/:recordKind/:recordId/:relation[?skip=&limit=]
 *     -> UsedByPage: one relation's rows, a page at a time ("See all")
 *
 * A signed-in member of the project (or a key of it) who may read the
 * record; everything is read with their permissions (UsedByService), and
 * what they may not read is counted, never named. Reads only.
 *
 * A bare router, as WhoIsToldAPI is: it reads no single model's CRUD routes.
 */

export const USED_BY_API_PATH: string = "/used-by";

const router: ExpressRouter = Express.getRouter();

export function readRecordKindParam(req: ExpressRequest): UsedByRecordKind {
  const raw: string = ((req.params["recordKind"] as string) || "").trim();

  if (!isUsedByRecordKind(raw)) {
    throw new BadDataException(
      "This kind of record does not show what uses it. Ask about a monitor, an on-call schedule, a service, a status page, a team or a label.",
    );
  }

  return raw;
}

export function readRecordIdParam(req: ExpressRequest): ObjectID {
  const raw: string = ((req.params["recordId"] as string) || "").trim();

  if (!raw || !ObjectID.isValidUUID(raw)) {
    throw new BadDataException(
      "The record's ID is missing or is not an ID. Open the record's page again and retry.",
    );
  }

  return new ObjectID(raw);
}

export function readRelationParam(req: ExpressRequest): UsedByRelation {
  const raw: string = ((req.params["relation"] as string) || "").trim();

  if (!isUsedByRelation(raw)) {
    throw new BadDataException(
      "This is not something that can refer to a record. Ask for one of the relations the record's summary lists.",
    );
  }

  return raw;
}

router.get(
  `${USED_BY_API_PATH}/:recordKind/:recordId`,
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

      const summary: UsedBySummary = await UsedByService.getSummary({
        recordKind: readRecordKindParam(req),
        recordId: readRecordIdParam(req),
        projectId: projectId,
        props: props,
      });

      Response.setNoCacheHeaders(res);
      return Response.sendJsonObjectResponse(
        req,
        res,
        summary as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  `${USED_BY_API_PATH}/:recordKind/:recordId/:relation`,
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

      const query: Record<string, unknown> = (req.query || {}) as Record<
        string,
        unknown
      >;

      const page: UsedByPage = await UsedByService.getPage({
        recordKind: readRecordKindParam(req),
        recordId: readRecordIdParam(req),
        relation: readRelationParam(req),
        projectId: projectId,
        props: props,
        skip: query["skip"],
        limit: query["limit"],
      });

      Response.setNoCacheHeaders(res);
      return Response.sendJsonObjectResponse(
        req,
        res,
        page as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

export default router;
