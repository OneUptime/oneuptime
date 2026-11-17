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
  USED_BY_BULK_MAX_RECORDS,
  UsedByBulkSummary,
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
 *   POST /used-by/:recordKind  { recordIds: [...] }
 *     -> UsedByBulkSummary: what refers to any of a list's selection,
 *        each relation counted once for all of them, counts only - for a
 *        bulk Delete or Archive (at most USED_BY_BULK_MAX_RECORDS ids)
 *
 * A signed-in member of the project (or a key of it) who may read the
 * record; everything is read with their permissions (UsedByService), and
 * what they may not read is counted, never named. Reads only: the POST
 * carries a selection too long for an address, and changes nothing.
 *
 * A bare router, as WhoIsToldAPI is: it reads no single model's CRUD routes.
 */

export const USED_BY_API_PATH: string = "/used-by";

const router: ExpressRouter = Express.getRouter();

export function readRecordKindParam(req: ExpressRequest): UsedByRecordKind {
  const raw: string = ((req.params["recordKind"] as string) || "").trim();

  if (!isUsedByRecordKind(raw)) {
    throw new BadDataException(
      "This kind of record does not show what uses it. Ask about a monitor, an on-call schedule, an on-call policy, a service, a status page, a team, a label, a monitor group or an SLO.",
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

/*
 * The ids of a bulk summary's records: a list of IDs, at least one and at
 * most USED_BY_BULK_MAX_RECORDS, each once.
 */
export function readRecordIdsBody(req: ExpressRequest): Array<ObjectID> {
  const body: unknown = req.body;
  const raw: unknown =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)["recordIds"]
      : undefined;

  if (!Array.isArray(raw) || raw.length === 0) {
    throw new BadDataException(
      "Send the IDs of the selected records as recordIds, a list of at least one ID.",
    );
  }

  if (raw.length > USED_BY_BULK_MAX_RECORDS) {
    throw new BadDataException(
      `At most ${USED_BY_BULK_MAX_RECORDS} records can be counted at once. Select fewer, then try again.`,
    );
  }

  const seen: Set<string> = new Set<string>();
  const ids: Array<ObjectID> = [];

  for (const value of raw) {
    const text: string = typeof value === "string" ? value.trim() : "";

    if (!text || !ObjectID.isValidUUID(text)) {
      throw new BadDataException(
        "One of the selected records' IDs is not an ID. Reload the list, select the records again and retry.",
      );
    }

    if (!seen.has(text.toLowerCase())) {
      seen.add(text.toLowerCase());
      ids.push(new ObjectID(text));
    }
  }

  return ids;
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

router.post(
  `${USED_BY_API_PATH}/:recordKind`,
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

      const recordKind: UsedByRecordKind = readRecordKindParam(req);

      const summary: UsedByBulkSummary = await UsedByService.getSummaries({
        recordKind: recordKind,
        recordIds: readRecordIdsBody(req),
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

export default router;
