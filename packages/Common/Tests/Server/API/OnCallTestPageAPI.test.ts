import { mockRouter } from "./Helpers";
import CommonAPI from "../../../Server/API/CommonAPI";
import {
  ON_CALL_TEST_PAGE_API_PATH,
  ON_CALL_TEST_POLICY_NOT_ALLOWED_MESSAGE,
  readObjectId,
  readTestedSeverity,
} from "../../../Server/API/OnCallTestPageAPI";
import TestSendAccess, {
  TestSendCaller,
} from "../../../Server/API/TestSendAccess";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallTestPageService, {
  ON_CALL_TEST_PAGE_NOT_AUTHORIZED_MESSAGE,
} from "../../../Server/Services/OnCallTestPageService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { OnCallTestPageRecordKind } from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE TEST PAGE ROUTES (OnCallTestPageAPI).
 *
 * Every one is for a signed-in member, as a person (TestSendAccess.getCaller):
 * a test is sent by someone and credited to them. A test to yourself needs
 * nothing more; to a member, what a setup reminder needs; a policy's test,
 * what editing the policy needs. The project is the caller's, never the
 * body's; the person, severity and policy are checked to be ids.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
  };
});

const PROJECT: ObjectID = new ObjectID("7e5af000-0000-4000-8000-000000000001");
const POLICY: ObjectID = new ObjectID("7e5af000-0000-4000-8000-000000000002");
const RUN: ObjectID = new ObjectID("7e5af000-0000-4000-8000-000000000003");
const SEVERITY: ObjectID = new ObjectID("7e5af000-0000-4000-8000-000000000004");
const ANA: ObjectID = new ObjectID("7e5af000-0000-4000-8000-0000000000a1");
const BOB: ObjectID = new ObjectID("7e5af000-0000-4000-8000-0000000000b1");
const OTHER_PROJECT: ObjectID = new ObjectID(
  "7e5af000-0000-4000-8000-0000000000ff",
);

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

const CALLER: TestSendCaller = {
  projectId: PROJECT,
  userId: ANA,
  props: { userId: ANA, tenantId: PROJECT } as DatabaseCommonInteractionProps,
};

async function call(
  method: "GET" | "POST",
  path: string,
  data: { body?: JSONObject; params?: JSONObject } = {},
): Promise<{ thrown: unknown; sent: unknown }> {
  const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
    method,
    `${ON_CALL_TEST_PAGE_API_PATH}${path}`,
  );

  let thrown: unknown = undefined;

  await (route.handlerFunction as RouterFunction)(
    {
      body: data.body || {},
      params: data.params || {},
      headers: {},
    } as unknown as ExpressRequest,
    {} as ExpressResponse,
    ((err: unknown) => {
      thrown = err;
    }) as NextFunction,
  );

  const sendJson: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;

  return {
    thrown: thrown,
    sent: sendJson.mock.calls[0]?.[2],
  };
}

const BODY: JSONObject = {
  recordKind: OnCallTestPageRecordKind.Incident,
  severityId: SEVERITY.toString(),
};

let getCaller: jest.SpyInstance;
let mayTestPolicy: jest.SpyInstance;
let sendToPerson: jest.SpyInstance;
let testPolicy: jest.SpyInstance;
let preview: jest.SpyInstance;

beforeEach(() => {
  jest.restoreAllMocks();
  (Response.sendJsonObjectResponse as unknown as jest.Mock).mockClear();

  getCaller = jest
    .spyOn(TestSendAccess, "getCaller")
    .mockResolvedValue(CALLER as never);
  mayTestPolicy = jest
    .spyOn(TestSendAccess, "assertMaySendTestOfSetting")
    .mockResolvedValue(CALLER as never);

  sendToPerson = jest
    .spyOn(OnCallTestPageService, "sendToPerson")
    .mockResolvedValue({
      executionLogId: RUN,
      outcome: {
        paged: [
          {
            userId: ANA,
            coveringForUserId: null,
            teamId: null,
            scheduleId: null,
          },
        ],
        notPaged: [],
        hadScheduleGap: false,
      },
    } as never);
  testPolicy = jest
    .spyOn(OnCallTestPageService, "testPolicy")
    .mockResolvedValue(RUN as never);
  preview = jest
    .spyOn(OnCallTestPageService, "getPreview")
    .mockResolvedValue({ kind: "Self", people: [] } as never);
  jest
    .spyOn(OnCallTestPageService, "assertIsProjectMember")
    .mockResolvedValue(undefined as never);
});

describe("every route is for a signed-in member, as a person", () => {
  test.each([
    ["POST", "/preview"],
    ["POST", "/page-person"],
    ["POST", "/page-policy"],
    ["GET", "/result/:executionLogId"],
  ])(
    "%s %s runs behind the user middleware",
    (method: string, path: string) => {
      const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
        method,
        `${ON_CALL_TEST_PAGE_API_PATH}${path}`,
      );

      expect(route.middleware).toBe(UserMiddleware.getUserMiddleware);
    },
  );

  test("a caller the test-send rule refuses sends nothing", async () => {
    getCaller.mockRejectedValue(
      new NotAuthorizedException(
        ON_CALL_TEST_PAGE_NOT_AUTHORIZED_MESSAGE,
      ) as never,
    );

    const { thrown } = await call("POST", "/page-person", { body: BODY });

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect(sendToPerson).not.toHaveBeenCalled();
  });
});

describe("POST /page-person", () => {
  test("with no one named, pages the caller, in the caller's project", async () => {
    const { thrown, sent } = await call("POST", "/page-person", {
      body: { ...BODY, projectId: OTHER_PROJECT.toString() },
    });

    expect(thrown).toBeUndefined();
    expect(sendToPerson).toHaveBeenCalledWith({
      projectId: PROJECT,
      targetUserId: ANA,
      sentByUserId: ANA,
      recordKind: OnCallTestPageRecordKind.Incident,
      severityId: SEVERITY,
    });
    expect(sent).toEqual({ executionLogId: RUN.toString(), pagedCount: 1 });
  });

  test("a member named needs what a setup reminder needs", async () => {
    const mayMember: jest.SpyInstance = jest
      .spyOn(OnCallTestPageService, "assertMaySendToMember")
      .mockImplementation(() => {
        throw new NotAuthorizedException(
          ON_CALL_TEST_PAGE_NOT_AUTHORIZED_MESSAGE,
        );
      });

    const { thrown } = await call("POST", "/page-person", {
      body: { ...BODY, userId: BOB.toString() },
    });

    expect(mayMember).toHaveBeenCalledWith(CALLER.props);
    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect(sendToPerson).not.toHaveBeenCalled();
  });

  test("a member named by somebody who may, is paged", async () => {
    jest
      .spyOn(OnCallTestPageService, "assertMaySendToMember")
      .mockImplementation(() => {
        return undefined;
      });

    await call("POST", "/page-person", {
      body: { ...BODY, userId: BOB.toString() },
    });

    expect(sendToPerson.mock.calls[0]![0]).toMatchObject({
      targetUserId: BOB,
      sentByUserId: ANA,
    });
  });

  test("naming yourself asks for nothing more", async () => {
    const mayMember: jest.SpyInstance = jest.spyOn(
      OnCallTestPageService,
      "assertMaySendToMember",
    );

    await call("POST", "/page-person", {
      body: { ...BODY, userId: ANA.toString() },
    });

    expect(mayMember).not.toHaveBeenCalled();
    expect(sendToPerson).toHaveBeenCalledTimes(1);
  });

  test("a person that is not an id is refused", async () => {
    const { thrown } = await call("POST", "/page-person", {
      body: { ...BODY, userId: "everyone" },
    });

    expect(thrown).toEqual(new BadDataException("userId is required."));
    expect(sendToPerson).not.toHaveBeenCalled();
  });
});

describe("POST /page-policy", () => {
  test("asks whether the caller may edit the policy, then tests it", async () => {
    const { thrown, sent } = await call("POST", "/page-policy", {
      body: { ...BODY, policyId: POLICY.toString(), walksEscalation: true },
    });

    expect(thrown).toBeUndefined();

    const asked: {
      record: { service: unknown; id: ObjectID };
      errorMessage: string;
    } = mayTestPolicy.mock.calls[0]![0] as {
      record: { service: unknown; id: ObjectID };
      errorMessage: string;
    };

    expect(asked.record.service).toBe(OnCallDutyPolicyService);
    expect(asked.record.id).toEqual(POLICY);
    expect(asked.errorMessage).toBe(ON_CALL_TEST_POLICY_NOT_ALLOWED_MESSAGE);
    expect(testPolicy).toHaveBeenCalledWith({
      projectId: PROJECT,
      policyId: POLICY,
      sentByUserId: ANA,
      recordKind: OnCallTestPageRecordKind.Incident,
      severityId: SEVERITY,
      walksEscalation: true,
    });
    expect(sent).toEqual({ executionLogId: RUN.toString() });
  });

  test("walks every level only when asked to with true", async () => {
    await call("POST", "/page-policy", {
      body: { ...BODY, policyId: POLICY.toString(), walksEscalation: "yes" },
    });

    expect(testPolicy.mock.calls[0]![0]).toMatchObject({
      walksEscalation: false,
    });
  });

  test("a caller who may not edit the policy tests nothing", async () => {
    mayTestPolicy.mockRejectedValue(
      new NotAuthorizedException(
        ON_CALL_TEST_POLICY_NOT_ALLOWED_MESSAGE,
      ) as never,
    );

    const { thrown } = await call("POST", "/page-policy", {
      body: { ...BODY, policyId: POLICY.toString() },
    });

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect(testPolicy).not.toHaveBeenCalled();
  });

  test("needs a policy", async () => {
    const { thrown } = await call("POST", "/page-policy", { body: BODY });

    expect(thrown).toEqual(new BadDataException("policyId is required."));
    expect(mayTestPolicy).not.toHaveBeenCalled();
  });
});

describe("POST /preview", () => {
  test("for a policy, asks as its test does", async () => {
    await call("POST", "/preview", {
      body: { ...BODY, policyId: POLICY.toString() },
    });

    expect(mayTestPolicy).toHaveBeenCalledTimes(1);
    expect(getCaller).not.toHaveBeenCalled();
    expect(preview.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT,
      callerUserId: ANA,
      policyId: POLICY,
    });
  });

  test("for a member, asks as their test does - and that they are a member", async () => {
    jest
      .spyOn(OnCallTestPageService, "assertMaySendToMember")
      .mockImplementation(() => {
        return undefined;
      });

    await call("POST", "/preview", {
      body: { ...BODY, userId: BOB.toString() },
    });

    expect(OnCallTestPageService.assertIsProjectMember).toHaveBeenCalledWith({
      projectId: PROJECT,
      userId: BOB,
    });
    expect(preview.mock.calls[0]![0]).toMatchObject({ targetUserId: BOB });
  });
});

describe("GET /result/:executionLogId", () => {
  test("reads the result in the caller's project, with the caller's own standing", async () => {
    const props: DatabaseCommonInteractionProps = {
      userId: ANA,
      tenantId: PROJECT,
    };

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(props as never);
    jest
      .spyOn(CommonAPI, "assertAuthenticatedProjectMember")
      .mockReturnValue(PROJECT);
    const result: jest.SpyInstance = jest
      .spyOn(OnCallTestPageService, "getResult")
      .mockResolvedValue({ executionLogId: RUN.toString() } as never);

    const { sent } = await call("GET", "/result/:executionLogId", {
      params: { executionLogId: RUN.toString() },
    });

    expect(result).toHaveBeenCalledWith({
      projectId: PROJECT,
      executionLogId: RUN,
      props: props,
    });
    expect(sent).toEqual({ executionLogId: RUN.toString() });
  });
});

describe("what a request names", () => {
  test("the kind of page tested is an Incident or an Alert", () => {
    expect(readTestedSeverity(BODY)).toEqual({
      recordKind: OnCallTestPageRecordKind.Incident,
      severityId: SEVERITY,
    });
    expect(() => {
      return readTestedSeverity({ ...BODY, recordKind: "Monitor" });
    }).toThrow("Say which kind of page to test: an Incident or an Alert.");
    expect(() => {
      return readTestedSeverity({ recordKind: "Alert" });
    }).toThrow("severityId is required.");
  });

  test("an id is an id", () => {
    expect(readObjectId(` ${SEVERITY.toString()} `, "severityId")).toEqual(
      SEVERITY,
    );
    expect(() => {
      return readObjectId("1 OR 1=1", "severityId");
    }).toThrow("severityId is required.");
    expect(() => {
      return readObjectId(42, "severityId");
    }).toThrow("severityId is required.");
  });
});
