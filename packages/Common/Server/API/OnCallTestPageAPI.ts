import UserMiddleware from "../Middleware/UserAuthorization";
import OnCallDutyPolicyService from "../Services/OnCallDutyPolicyService";
import { OnCallDirectPageRun } from "../Services/OnCallDutyPolicyExecutionLogService";
import OnCallFireDrillHistoryService from "../Services/OnCallFireDrillHistoryService";
import OnCallFireDrillService from "../Services/OnCallFireDrillService";
import OnCallTestPageService, {
  ON_CALL_TEST_PAGE_MESSAGE_NOT_FOUND_MESSAGE,
} from "../Services/OnCallTestPageService";
import { OnCallTestPageAnswer } from "../Utils/OnCall/OnCallTestPageAcknowledge";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import CommonAPI from "./CommonAPI";
import TestSendAccess, { TestSendCaller } from "./TestSendAccess";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  ON_CALL_FIRE_DRILL_NOT_ALLOWED_MESSAGE,
  OnCallFireDrillLast,
  OnCallFireDrillPreview,
  OnCallFireDrillStarted,
} from "../../Types/OnCallDutyPolicy/OnCallFireDrill";
import {
  OnCallTestPagePreview,
  OnCallTestPageRecordKind,
  OnCallTestPageResult,
  isOnCallTestPageRecordKind,
} from "../../Types/OnCallDutyPolicy/OnCallTestPage";

/*
 * TEST PAGES (Types/OnCallDutyPolicy/OnCallTestPage), for the Dashboard and
 * for a guided setup that ends with one:
 *
 *   POST /on-call-test-page/preview      what a test will send, and its cost
 *   POST /on-call-test-page/page-person  a test page to yourself, or a member
 *   POST /on-call-test-page/page-policy  a test of an on-call policy
 *   GET  /on-call-test-page/result/:id   what became of it, as it happens
 *   GET  /on-call-test-page/acknowledge/:id  whether you acknowledged one
 *   POST /on-call-test-page/acknowledge/:id  acknowledge one, from the app
 *                                        (its push's message: #7014)
 *   POST /on-call-test-page/fire-drill/preview  what a monitor's fire drill
 *                                        pages (#7012)
 *   POST /on-call-test-page/fire-drill/start    run it: a test of each policy
 *   GET  /on-call-test-page/fire-drill/last/:monitorId  how its last drill
 *                                        went (#9386)
 *
 * Every one asks the test-send rule's first two steps (TestSendAccess
 * .getCaller): a signed-in member of the project, as a person - a test is
 * sent by someone and credited to them, so a project API key sends none -
 * on a credential that may make changes. Then who may send what
 * (OnCallTestPageService): anyone to themselves; whoever may send a member
 * a setup reminder to a member; whoever may edit a policy to its levels -
 * asked as an edit of the policy is asked (TestSendAccess
 * .assertMaySendTestOfSetting), team blocks, labels and owned scope
 * counted. How often is limited by the service.
 *
 * A bare router, as OnCallReadinessAPI is: it reads and writes no single
 * model's CRUD routes.
 */

export const ON_CALL_TEST_PAGE_API_PATH: string = "/on-call-test-page";

// What a caller who may not test a policy is told, whichever check refused them.
export const ON_CALL_TEST_POLICY_NOT_ALLOWED_MESSAGE: string =
  "You can test an on-call policy you can edit. Ask a Project Admin, or an owner of the policy.";

const router: ExpressRouter = Express.getRouter();

// The kind and severity a test stands in for, from the request's body.
export function readTestedSeverity(body: JSONObject | undefined): {
  recordKind: OnCallTestPageRecordKind;
  severityId: ObjectID;
} {
  const recordKind: unknown = body?.["recordKind"];

  if (!isOnCallTestPageRecordKind(recordKind)) {
    throw new BadDataException(
      "Say which kind of page to test: an Incident or an Alert.",
    );
  }

  return {
    recordKind: recordKind,
    severityId: readObjectId(body?.["severityId"], "severityId"),
  };
}

// An id from the request's body, refused when it is not one.
export function readObjectId(value: unknown, name: string): ObjectID {
  const text: string = typeof value === "string" ? value.trim() : "";

  if (!text || !ObjectID.isValidUUID(text)) {
    throw new BadDataException(`${name} is required.`);
  }

  return new ObjectID(text);
}

// An id from the request's body when there is one.
function readOptionalObjectId(value: unknown, name: string): ObjectID | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return readObjectId(value, name);
}

/*
 * Who a test to a person is for: the caller, or a member they may send one
 * to. Returns the person.
 */
async function readPersonTarget(data: {
  caller: TestSendCaller;
  body: JSONObject | undefined;
}): Promise<ObjectID> {
  const userId: ObjectID | null = readOptionalObjectId(
    data.body?.["userId"],
    "userId",
  );

  if (!userId || userId.toString() === data.caller.userId.toString()) {
    return data.caller.userId;
  }

  OnCallTestPageService.assertMaySendToMember(data.caller.props);

  return userId;
}

/*
 * Whether the caller may test the policy: as editing it is asked. Returns
 * the caller.
 */
async function assertMayTestPolicy(data: {
  req: ExpressRequest;
  policyId: ObjectID;
}): Promise<TestSendCaller> {
  return await TestSendAccess.assertMaySendTestOfSetting<OnCallDutyPolicy>({
    req: data.req,
    record: {
      service: OnCallDutyPolicyService,
      id: data.policyId,
    },
    switchOn: {
      name: "",
    },
    errorMessage: ON_CALL_TEST_POLICY_NOT_ALLOWED_MESSAGE,
  });
}

router.post(
  `${ON_CALL_TEST_PAGE_API_PATH}/preview`,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const body: JSONObject | undefined = req.body as JSONObject | undefined;
      const policyId: ObjectID | null = readOptionalObjectId(
        body?.["policyId"],
        "policyId",
      );

      const caller: TestSendCaller = policyId
        ? await assertMayTestPolicy({ req: req, policyId: policyId })
        : await TestSendAccess.getCaller(req);

      const tested: {
        recordKind: OnCallTestPageRecordKind;
        severityId: ObjectID;
      } = readTestedSeverity(body);

      const targetUserId: ObjectID | null = policyId
        ? null
        : await readPersonTarget({
            caller: caller,
            body: body,
          });

      if (targetUserId) {
        await OnCallTestPageService.assertIsProjectMember({
          projectId: caller.projectId,
          userId: targetUserId,
        });
      }

      const preview: OnCallTestPagePreview =
        await OnCallTestPageService.getPreview({
          projectId: caller.projectId,
          callerUserId: caller.userId,
          recordKind: tested.recordKind,
          severityId: tested.severityId,
          ...(policyId ? { policyId: policyId } : {}),
          ...(targetUserId ? { targetUserId: targetUserId } : {}),
        });

      return Response.sendJsonObjectResponse(
        req,
        res,
        preview as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  `${ON_CALL_TEST_PAGE_API_PATH}/page-person`,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const caller: TestSendCaller = await TestSendAccess.getCaller(req);
      const body: JSONObject | undefined = req.body as JSONObject | undefined;

      const targetUserId: ObjectID = await readPersonTarget({
        caller: caller,
        body: body,
      });

      const tested: {
        recordKind: OnCallTestPageRecordKind;
        severityId: ObjectID;
      } = readTestedSeverity(body);

      const run: OnCallDirectPageRun = await OnCallTestPageService.sendToPerson(
        {
          projectId: caller.projectId,
          targetUserId: targetUserId,
          sentByUserId: caller.userId,
          recordKind: tested.recordKind,
          severityId: tested.severityId,
        },
      );

      return Response.sendJsonObjectResponse(req, res, {
        executionLogId: run.executionLogId.toString(),
        pagedCount: run.outcome.paged.length,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  `${ON_CALL_TEST_PAGE_API_PATH}/page-policy`,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const body: JSONObject | undefined = req.body as JSONObject | undefined;
      const policyId: ObjectID = readObjectId(body?.["policyId"], "policyId");

      const caller: TestSendCaller = await assertMayTestPolicy({
        req: req,
        policyId: policyId,
      });

      const tested: {
        recordKind: OnCallTestPageRecordKind;
        severityId: ObjectID;
      } = readTestedSeverity(body);

      const executionLogId: ObjectID = await OnCallTestPageService.testPolicy({
        projectId: caller.projectId,
        policyId: policyId,
        sentByUserId: caller.userId,
        recordKind: tested.recordKind,
        severityId: tested.severityId,
        walksEscalation: body?.["walksEscalation"] === true,
      });

      return Response.sendJsonObjectResponse(req, res, {
        executionLogId: executionLogId.toString(),
      });
    } catch (err) {
      next(err);
    }
  },
);

// A failure's key: two ids, its kind and its place (getOnCallFireDrillEventKey).
const FIRE_DRILL_EVENT_KEY_MAX_LENGTH: number = 200;

// The failure a fire drill is asked for, from the request's body.
export function readFireDrillEventKey(value: unknown): string | undefined {
  const text: string = typeof value === "string" ? value.trim() : "";

  return text && text.length <= FIRE_DRILL_EVENT_KEY_MAX_LENGTH
    ? text
    : undefined;
}

/*
 * Whether the caller may test the policy, for a fire drill: as its own test
 * asks (assertMayTestPolicy). A policy they may not see is one they may not
 * test, however the check refused them.
 */
async function mayTestPolicy(data: {
  req: ExpressRequest;
  policyId: ObjectID;
}): Promise<boolean> {
  try {
    await assertMayTestPolicy(data);
    return true;
  } catch (err) {
    if (
      err instanceof NotAuthorizedException ||
      err instanceof NotFoundException ||
      err instanceof BadDataException
    ) {
      return false;
    }

    throw err;
  }
}

/*
 * A FIRE DRILL OF A MONITOR (#7012, Types/OnCallDutyPolicy/OnCallFireDrill):
 * one policy test for each on-call policy a failure of the monitor pages.
 *
 *   POST /on-call-test-page/fire-drill/preview  { monitorId, eventKey? }
 *     the monitor's failures, and for the one picked, each policy it pages
 *     and who that pages now - what the dialog shows before anything is sent
 *   POST /on-call-test-page/fire-drill/start    { monitorId, eventKey }
 *     starts it: { runs }, each policy's test to read its result by
 *
 * For a signed-in member, as a person, on a credential that may make
 * changes (TestSendAccess.getCaller), who may read the monitor
 * (WhoIsToldService.getForMonitor) - and, to start one, who may test every
 * policy it pages, each asked as that policy's own test asks it. The
 * policies are worked out on the server as the drill starts, never read
 * from the request.
 */
router.post(
  `${ON_CALL_TEST_PAGE_API_PATH}/fire-drill/preview`,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const caller: TestSendCaller = await TestSendAccess.getCaller(req);
      const body: JSONObject | undefined = req.body as JSONObject | undefined;

      const preview: OnCallFireDrillPreview =
        await OnCallFireDrillService.getPreview({
          projectId: caller.projectId,
          monitorId: readObjectId(body?.["monitorId"], "monitorId"),
          callerUserId: caller.userId,
          props: caller.props,
          eventKey: readFireDrillEventKey(body?.["eventKey"]),
          mayTestPolicy: async (policyId: ObjectID): Promise<boolean> => {
            return await mayTestPolicy({ req: req, policyId: policyId });
          },
        });

      return Response.sendJsonObjectResponse(
        req,
        res,
        preview as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  `${ON_CALL_TEST_PAGE_API_PATH}/fire-drill/start`,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const caller: TestSendCaller = await TestSendAccess.getCaller(req);
      const body: JSONObject | undefined = req.body as JSONObject | undefined;
      const monitorId: ObjectID = readObjectId(
        body?.["monitorId"],
        "monitorId",
      );
      const eventKey: string | undefined = readFireDrillEventKey(
        body?.["eventKey"],
      );

      if (!eventKey) {
        throw new BadDataException("Say which failure to drill: eventKey.");
      }

      const started: OnCallFireDrillStarted =
        await OnCallFireDrillService.start({
          projectId: caller.projectId,
          monitorId: monitorId,
          sentByUserId: caller.userId,
          props: caller.props,
          eventKey: eventKey,
          // Each policy's test walks every level only when asked with true (#9385).
          walksEscalation: body?.["walksEscalation"] === true,
          assertMayTestPolicy: async (policyId: ObjectID): Promise<void> => {
            if (!(await mayTestPolicy({ req: req, policyId: policyId }))) {
              throw new NotAuthorizedException(
                ON_CALL_FIRE_DRILL_NOT_ALLOWED_MESSAGE,
              );
            }
          },
        });

      return Response.sendJsonObjectResponse(
        req,
        res,
        started as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

/*
 * A MONITOR'S LAST FIRE DRILL (#9386, OnCallFireDrillHistoryService): when
 * it ran, who ran it, the failure it rehearsed and what became of each
 * policy's test - for its When this goes down card. For a member of the
 * project, as its other reads are, who may read the monitor (else: not
 * found) and every one of the drill's tests in its policy's execution logs
 * (else: none). { fireDrill } - null with none to read.
 */
router.get(
  `${ON_CALL_TEST_PAGE_API_PATH}/fire-drill/last/:monitorId`,
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

      const last: OnCallFireDrillLast = {
        fireDrill: await OnCallFireDrillHistoryService.getLast({
          projectId: projectId,
          monitorId: readObjectId(req.params["monitorId"], "monitorId"),
          props: props,
        }),
      };

      return Response.sendJsonObjectResponse(
        req,
        res,
        last as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

/*
 * A TEST PAGE ANSWERED FROM THE ON-CALL APP (#7014): "Acknowledge test
 * page" under its push, or the button on the screen the push opens. The
 * message is the push's own row of the person's on-call timeline, and only
 * the signed-in person's own message of a test page, in the project the
 * request names, is answered (OnCallTestPageService.readOwnTestPageMessage).
 * GET says whether they acknowledged it already; POST acknowledges it, by
 * the rule every message of a test page answers by
 * (OnCallTestPageAcknowledge).
 */
router.get(
  `${ON_CALL_TEST_PAGE_API_PATH}/acknowledge/:userOnCallLogTimelineId`,
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

      if (!props.userId) {
        throw new BadDataException(ON_CALL_TEST_PAGE_MESSAGE_NOT_FOUND_MESSAGE);
      }

      const isAcknowledged: boolean =
        await OnCallTestPageService.isOwnTestPageAnswered({
          projectId: projectId,
          userId: props.userId,
          userOnCallLogTimelineId: readObjectId(
            req.params["userOnCallLogTimelineId"],
            "userOnCallLogTimelineId",
          ),
        });

      return Response.sendJsonObjectResponse(req, res, {
        isAcknowledged: isAcknowledged,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  `${ON_CALL_TEST_PAGE_API_PATH}/acknowledge/:userOnCallLogTimelineId`,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      // A signed-in member, as a person, on a credential that may make changes.
      const caller: TestSendCaller = await TestSendAccess.getCaller(req);

      const answer: OnCallTestPageAnswer =
        await OnCallTestPageService.acknowledgeOwnTestPage({
          projectId: caller.projectId,
          userId: caller.userId,
          userOnCallLogTimelineId: readObjectId(
            req.params["userOnCallLogTimelineId"],
            "userOnCallLogTimelineId",
          ),
        });

      return Response.sendJsonObjectResponse(req, res, { answer: answer });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  `${ON_CALL_TEST_PAGE_API_PATH}/result/:executionLogId`,
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

      const executionLogId: ObjectID = readObjectId(
        req.params["executionLogId"],
        "executionLogId",
      );

      const result: OnCallTestPageResult =
        await OnCallTestPageService.getResult({
          projectId: projectId,
          executionLogId: executionLogId,
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
