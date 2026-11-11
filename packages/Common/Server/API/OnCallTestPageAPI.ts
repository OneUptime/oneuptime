import UserMiddleware from "../Middleware/UserAuthorization";
import OnCallDutyPolicyService from "../Services/OnCallDutyPolicyService";
import { OnCallDirectPageRun } from "../Services/OnCallDutyPolicyExecutionLogService";
import OnCallTestPageService from "../Services/OnCallTestPageService";
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
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
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
  "You can test an on-call policy you can edit. Ask a project admin, or an owner of the policy.";

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
