import UserMiddleware from "../Middleware/UserAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import OnCallPagePassOn from "../Utils/OnCall/OnCallPagePassOn";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  ON_CALL_PAGE_PASS_ON_ROUTE,
  OnCallOpenPage,
  OnCallOpenPagesAnswer,
  OnCallPageRecordType,
  OnCallPassOnAnswer,
  OnCallPassOnRecordAnswer,
  isOnCallPageRecordType,
} from "../../Types/OnCallDutyPolicy/OnCallPagePassOn";

/*
 * "CAN'T TAKE IT? PASS IT ON" FROM THE DASHBOARD AND THE MOBILE APP
 * (OnCallPagePassOn).
 *
 * GET  /on-call-page/pass-on/<record type>/<record id>
 *   The signed-in person's own pages about the record that they can pass
 *   on, each with what passing it on would do: { pages: [...] }. Empty when
 *   they are not being paged about it - which is every visit of a record's
 *   page by anybody else, so it is cheap.
 *
 * POST /on-call-page/pass-on/<record type>/<record id>
 *   Passes them on, and says what came of each: { answers: [...] }.
 *
 * Only ever the caller's own pages, in the project they are signed in to:
 * there is nothing to send but the record, and nobody can pass on anybody
 * else's page.
 */
const router: ExpressRouter = Express.getRouter();

// The record type and id in the path, checked before anything is read.
const readRecord: (req: ExpressRequest) => {
  recordType: OnCallPageRecordType;
  recordId: ObjectID;
} = (
  req: ExpressRequest,
): { recordType: OnCallPageRecordType; recordId: ObjectID } => {
  const recordType: unknown = req.params["recordType"];

  if (!isOnCallPageRecordType(recordType)) {
    throw new BadDataException(
      `Unknown record type. Use one of: ${Object.values(
        OnCallPageRecordType,
      ).join(", ")}.`,
    );
  }

  const recordIdText: string = String(req.params["recordId"] || "");

  if (!ObjectID.isValidUUID(recordIdText)) {
    throw new BadDataException("The record id is not a valid id.");
  }

  return { recordType: recordType, recordId: new ObjectID(recordIdText) };
};

// The signed-in person and their project, or a refusal.
const readCaller: (
  props: DatabaseCommonInteractionProps,
) => { userId: ObjectID; projectId: ObjectID } = (
  props: DatabaseCommonInteractionProps,
): { userId: ObjectID; projectId: ObjectID } => {
  const projectId: ObjectID = CommonAPI.assertAuthenticatedProjectMember(props);

  return { userId: props.userId!, projectId: projectId };
};

router.get(
  `${ON_CALL_PAGE_PASS_ON_ROUTE}/:recordType/:recordId`,
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const caller: { userId: ObjectID; projectId: ObjectID } =
        readCaller(props);

      const record: {
        recordType: OnCallPageRecordType;
        recordId: ObjectID;
      } = readRecord(req);

      const pages: Array<OnCallOpenPage> =
        await OnCallPagePassOn.getOpenPagesForRecord({
          userId: caller.userId,
          projectId: caller.projectId,
          recordType: record.recordType,
          recordId: record.recordId,
        });

      const answer: OnCallOpenPagesAnswer = { pages: pages };

      Response.setNoCacheHeaders(res);

      return Response.sendJsonObjectResponse(
        req,
        res,
        // Plain JSON: its times are ISO strings (readOnCallPassOnResult).
        answer as unknown as JSONObject,
      );
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  `${ON_CALL_PAGE_PASS_ON_ROUTE}/:recordType/:recordId`,
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const caller: { userId: ObjectID; projectId: ObjectID } =
        readCaller(props);

      const record: {
        recordType: OnCallPageRecordType;
        recordId: ObjectID;
      } = readRecord(req);

      const answers: Array<OnCallPassOnAnswer> =
        await OnCallPagePassOn.passOnForRecord({
          userId: caller.userId,
          projectId: caller.projectId,
          recordType: record.recordType,
          recordId: record.recordId,
        });

      const answer: OnCallPassOnRecordAnswer = { answers: answers };

      Response.setNoCacheHeaders(res);

      return Response.sendJsonObjectResponse(
        req,
        res,
        // Plain JSON: its times are ISO strings (readOnCallPassOnResult).
        answer as unknown as JSONObject,
      );
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
