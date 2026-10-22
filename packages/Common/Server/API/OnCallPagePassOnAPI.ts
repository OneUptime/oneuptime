import UserMiddleware from "../Middleware/UserAuthorization";
import UserService from "../Services/UserService";
import logger from "../Utils/Logger";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import OnCallPagePassOn from "../Utils/OnCall/OnCallPagePassOn";
import OnCallAcknowledgementTimeout from "../Utils/OnCall/OnCallAcknowledgementTimeout";
import {
  ON_CALL_PAGE_AGAIN_ACKNOWLEDGE_ROUTE,
  OnCallPageAgainAcknowledgeAnswer,
} from "../../Types/OnCallDutyPolicy/OnCallAcknowledgementTimeout";
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
  getOnCallPassOnRefusalSentence,
  getOnCallPassOnSentence,
  isOnCallPageRecordType,
} from "../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import User from "../../Models/DatabaseModels/User";

/*
 * "CAN'T TAKE IT? ESCALATE" FROM THE DASHBOARD AND THE MOBILE APP
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
 *
 * Each page and each answer also carries `sentence`: what it does or did,
 * as the server words it everywhere else (the confirm page, a call), with
 * times in the caller's own time zone. The mobile app shows it as it is, so
 * a level's place ("Level 2 of 3") and a time ("5:28 AM UTC") are written
 * to stay on one line of a phone screen, as on the confirm page
 * (keepTogether).
 */
const router: ExpressRouter = Express.getRouter();

/*
 * The caller's own time zone, for "If nobody acknowledges by 5:28 AM ...".
 * Without one - or when it cannot be read - times are the server's, as in
 * the messages that paged them.
 */
const getCallerTimezone: (
  userId: ObjectID,
) => Promise<string | undefined> = async (
  userId: ObjectID,
): Promise<string | undefined> => {
  try {
    const user: User | null = await UserService.findOneById({
      id: userId,
      select: { timezone: true },
      props: { isRoot: true },
    });

    return user?.timezone?.toString() || undefined;
  } catch (err) {
    logger.error(err);
    return undefined;
  }
};

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
const readCaller: (props: DatabaseCommonInteractionProps) => {
  userId: ObjectID;
  projectId: ObjectID;
} = (
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

      const timezone: string | undefined =
        pages.length > 0 ? await getCallerTimezone(caller.userId) : undefined;

      const answer: OnCallOpenPagesAnswer = {
        pages: pages.map((page: OnCallOpenPage): OnCallOpenPage => {
          return {
            ...page,
            // Shown on a phone: "Level 2 of 3" and a time stay on one line.
            sentence: getOnCallPassOnSentence(page.preview, {
              timezone: timezone,
              keepTogether: true,
            }),
          };
        }),
      };

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

      const timezone: string | undefined =
        answers.length > 0 ? await getCallerTimezone(caller.userId) : undefined;

      const answer: OnCallPassOnRecordAnswer = {
        answers: answers.map(
          (passOnAnswer: OnCallPassOnAnswer): OnCallPassOnAnswer => {
            return {
              ...passOnAnswer,
              sentence:
                passOnAnswer.passedOn && passOnAnswer.result
                  ? getOnCallPassOnSentence(passOnAnswer.result, {
                      timezone: timezone,
                      keepTogether: true,
                    })
                  : getOnCallPassOnRefusalSentence(passOnAnswer),
            };
          },
        ),
      };

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

/*
 * POST /on-call-page/acknowledge/<record type>/<record id>
 *   Acknowledges the signed-in person's pages again about the record
 *   (OnCallAcknowledgementTimeout): a page again's record was acknowledged
 *   all along, so its own Acknowledge is not offered, and the person answers
 *   their page instead, as its link, a call's 1 or a text would. Only their
 *   own pages again, in the project they are signed in to: { acknowledged:
 *   N }, 0 when there was none to answer.
 */
router.post(
  `${ON_CALL_PAGE_AGAIN_ACKNOWLEDGE_ROUTE}/:recordType/:recordId`,
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

      const answer: OnCallPageAgainAcknowledgeAnswer = {
        acknowledged:
          await OnCallAcknowledgementTimeout.acknowledgePagesAgainForRecord({
            userId: caller.userId,
            projectId: caller.projectId,
            recordType: record.recordType,
            recordId: record.recordId,
          }),
      };

      Response.setNoCacheHeaders(res);

      return Response.sendJsonObjectResponse(
        req,
        res,
        answer as unknown as JSONObject,
      );
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
