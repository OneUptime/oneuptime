import { mockRouter } from "./Helpers";
import CommonAPI from "../../../Server/API/CommonAPI";
import {
  ON_CALL_TEST_PAGE_API_PATH,
  ON_CALL_TEST_POLICY_NOT_ALLOWED_MESSAGE,
  readFireDrillEventKey,
  readObjectId,
  readTestedSeverity,
} from "../../../Server/API/OnCallTestPageAPI";
import OnCallFireDrillHistoryService from "../../../Server/Services/OnCallFireDrillHistoryService";
import OnCallFireDrillService from "../../../Server/Services/OnCallFireDrillService";
import { ON_CALL_FIRE_DRILL_NOT_ALLOWED_MESSAGE } from "../../../Types/OnCallDutyPolicy/OnCallFireDrill";
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
import { OnCallTestPageAnswer } from "../../../Server/Utils/OnCall/OnCallTestPageAcknowledge";
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

/*
 * A test page answered from the On-Call app (#7014): the push's message,
 * named in the path, answered for the signed-in person in their project -
 * never for anybody the request names.
 */
describe("the On-Call app's Acknowledge test page", () => {
  const MESSAGE: ObjectID = new ObjectID(
    "7e5af000-0000-4000-8000-000000000071",
  );

  test.each([
    ["GET", "/acknowledge/:userOnCallLogTimelineId"],
    ["POST", "/acknowledge/:userOnCallLogTimelineId"],
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

  test("POST acknowledges the caller's own message, in the caller's project, and says what it did", async () => {
    const acknowledge: jest.SpyInstance = jest
      .spyOn(OnCallTestPageService, "acknowledgeOwnTestPage")
      .mockResolvedValue(OnCallTestPageAnswer.Acknowledged as never);

    const { thrown, sent } = await call(
      "POST",
      "/acknowledge/:userOnCallLogTimelineId",
      {
        params: { userOnCallLogTimelineId: MESSAGE.toString() },
        // A body that names another person or project is not read.
        body: { userId: BOB.toString(), projectId: OTHER_PROJECT.toString() },
      },
    );

    expect(thrown).toBeUndefined();
    expect(getCaller).toHaveBeenCalledTimes(1);
    expect(acknowledge).toHaveBeenCalledWith({
      projectId: PROJECT,
      userId: ANA,
      userOnCallLogTimelineId: MESSAGE,
    });
    expect(sent).toEqual({ answer: OnCallTestPageAnswer.Acknowledged });
  });

  test("POST by a caller the test-send rule refuses - a read-only key, no person - acknowledges nothing", async () => {
    const acknowledge: jest.SpyInstance = jest
      .spyOn(OnCallTestPageService, "acknowledgeOwnTestPage")
      .mockResolvedValue(OnCallTestPageAnswer.Acknowledged as never);
    getCaller.mockRejectedValue(
      new NotAuthorizedException(
        ON_CALL_TEST_PAGE_NOT_AUTHORIZED_MESSAGE,
      ) as never,
    );

    const { thrown } = await call(
      "POST",
      "/acknowledge/:userOnCallLogTimelineId",
      { params: { userOnCallLogTimelineId: MESSAGE.toString() } },
    );

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect(acknowledge).not.toHaveBeenCalled();
  });

  test("POST of a message that is not an id is refused before anything is read", async () => {
    const acknowledge: jest.SpyInstance = jest.spyOn(
      OnCallTestPageService,
      "acknowledgeOwnTestPage",
    );

    const { thrown } = await call(
      "POST",
      "/acknowledge/:userOnCallLogTimelineId",
      { params: { userOnCallLogTimelineId: "1 OR 1=1" } },
    );

    expect(thrown).toBeInstanceOf(BadDataException);
    expect(acknowledge).not.toHaveBeenCalled();
  });

  test("GET says whether the caller acknowledged it, with the caller's own ids", async () => {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue({ userId: ANA, tenantId: PROJECT } as never);
    jest
      .spyOn(CommonAPI, "assertAuthenticatedProjectMember")
      .mockReturnValue(PROJECT);
    const isAnswered: jest.SpyInstance = jest
      .spyOn(OnCallTestPageService, "isOwnTestPageAnswered")
      .mockResolvedValue(true as never);

    const { thrown, sent } = await call(
      "GET",
      "/acknowledge/:userOnCallLogTimelineId",
      { params: { userOnCallLogTimelineId: MESSAGE.toString() } },
    );

    expect(thrown).toBeUndefined();
    expect(isAnswered).toHaveBeenCalledWith({
      projectId: PROJECT,
      userId: ANA,
      userOnCallLogTimelineId: MESSAGE,
    });
    expect(sent).toEqual({ isAcknowledged: true });
  });

  test("GET by a project key, with no person, reads nothing", async () => {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue({ tenantId: PROJECT } as never);
    jest
      .spyOn(CommonAPI, "assertAuthenticatedProjectMember")
      .mockReturnValue(PROJECT);
    const isAnswered: jest.SpyInstance = jest.spyOn(
      OnCallTestPageService,
      "isOwnTestPageAnswered",
    );

    const { thrown } = await call(
      "GET",
      "/acknowledge/:userOnCallLogTimelineId",
      { params: { userOnCallLogTimelineId: MESSAGE.toString() } },
    );

    expect(thrown).toBeInstanceOf(BadDataException);
    expect(isAnswered).not.toHaveBeenCalled();
  });
});

/*
 * A monitor's fire drill (#7012): a signed-in member, as a person, who may
 * read the monitor - and, to start it, who may test every policy it pages,
 * each asked as the policy's own test asks it.
 */
describe("a monitor's fire drill", () => {
  const MONITOR: ObjectID = new ObjectID(
    "7e5af000-0000-4000-8000-000000000081",
  );
  const OTHER_POLICY: ObjectID = new ObjectID(
    "7e5af000-0000-4000-8000-000000000082",
  );

  test.each([
    ["POST", "/fire-drill/preview"],
    ["POST", "/fire-drill/start"],
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

  test("the preview is the caller's, in the caller's project, and asks of each policy whether they may test it as its own test asks", async () => {
    const preview: jest.SpyInstance = jest
      .spyOn(OnCallFireDrillService, "getPreview")
      .mockImplementation((async (data: {
        mayTestPolicy: (policyId: ObjectID) => Promise<boolean>;
      }) => {
        return {
          monitorId: MONITOR.toString(),
          mayTestPolicy: await data.mayTestPolicy(POLICY),
          mayTestOther: await data.mayTestPolicy(OTHER_POLICY),
        };
      }) as never);
    mayTestPolicy.mockImplementation((async (data: {
      record: { id: ObjectID };
      errorMessage: string;
    }) => {
      expect(data.errorMessage).toBe(ON_CALL_TEST_POLICY_NOT_ALLOWED_MESSAGE);

      if (data.record.id.toString() === OTHER_POLICY.toString()) {
        throw new NotAuthorizedException(data.errorMessage);
      }

      return CALLER;
    }) as never);

    const { thrown, sent } = await call("POST", "/fire-drill/preview", {
      body: {
        monitorId: MONITOR.toString(),
        eventKey: " criteria-1:Incident:template-1:0 ",
        projectId: OTHER_PROJECT.toString(),
      },
    });

    expect(thrown).toBeUndefined();
    expect(getCaller).toHaveBeenCalled();
    expect(preview).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT,
        monitorId: MONITOR,
        callerUserId: ANA,
        props: CALLER.props,
        eventKey: "criteria-1:Incident:template-1:0",
      }),
    );
    // A policy the check refuses is one they may not test - never an error.
    expect(sent).toEqual({
      monitorId: MONITOR.toString(),
      mayTestPolicy: true,
      mayTestOther: false,
    });
  });

  test("a caller the test-send rule refuses previews nothing", async () => {
    const preview: jest.SpyInstance = jest.spyOn(
      OnCallFireDrillService,
      "getPreview",
    );
    getCaller.mockRejectedValue(
      new NotAuthorizedException(
        ON_CALL_TEST_PAGE_NOT_AUTHORIZED_MESSAGE,
      ) as never,
    );

    const { thrown } = await call("POST", "/fire-drill/preview", {
      body: { monitorId: MONITOR.toString() },
    });

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect(preview).not.toHaveBeenCalled();
  });

  test("starting it hands the service the check that refuses a policy the caller may not test with the drill's own words", async () => {
    const start: jest.SpyInstance = jest
      .spyOn(OnCallFireDrillService, "start")
      .mockImplementation((async (data: {
        assertMayTestPolicy: (policyId: ObjectID) => Promise<void>;
      }) => {
        await data.assertMayTestPolicy(POLICY);
        await data.assertMayTestPolicy(OTHER_POLICY);
        return { runs: [] };
      }) as never);
    mayTestPolicy.mockImplementation((async (data: {
      record: { id: ObjectID };
      errorMessage: string;
    }) => {
      if (data.record.id.toString() === OTHER_POLICY.toString()) {
        throw new NotAuthorizedException(data.errorMessage);
      }

      return CALLER;
    }) as never);

    const { thrown } = await call("POST", "/fire-drill/start", {
      body: {
        monitorId: MONITOR.toString(),
        eventKey: "criteria-1:Incident:template-1:0",
      },
    });

    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT,
        monitorId: MONITOR,
        sentByUserId: ANA,
        eventKey: "criteria-1:Incident:template-1:0",
      }),
    );
    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect((thrown as Error).message).toBe(
      ON_CALL_FIRE_DRILL_NOT_ALLOWED_MESSAGE,
    );
  });

  test("starting it sends what the service started", async () => {
    jest.spyOn(OnCallFireDrillService, "start").mockResolvedValue({
      runs: [
        {
          policyId: POLICY.toString(),
          policyName: "Primary",
          executionLogId: RUN.toString(),
        },
      ],
    } as never);

    const { thrown, sent } = await call("POST", "/fire-drill/start", {
      body: {
        monitorId: MONITOR.toString(),
        eventKey: "criteria-1:Incident:template-1:0",
      },
    });

    expect(thrown).toBeUndefined();
    expect(sent).toEqual({
      runs: [
        {
          policyId: POLICY.toString(),
          policyName: "Primary",
          executionLogId: RUN.toString(),
        },
      ],
    });
  });

  test.each([
    ["no monitor", { eventKey: "criteria-1:Incident:template-1:0" }],
    ["a monitor that is not an id", { monitorId: "1 OR 1=1", eventKey: "k" }],
    ["no failure", { monitorId: "7e5af000-0000-4000-8000-000000000081" }],
    [
      "a failure that is no key",
      {
        monitorId: "7e5af000-0000-4000-8000-000000000081",
        eventKey: "x".repeat(201),
      },
    ],
  ] as Array<[string, JSONObject]>)(
    "starting it with %s is refused, and nothing is started",
    async (_what: string, body: JSONObject) => {
      const start: jest.SpyInstance = jest.spyOn(
        OnCallFireDrillService,
        "start",
      );

      const { thrown } = await call("POST", "/fire-drill/start", {
        body: body,
      });

      expect(thrown).toBeInstanceOf(BadDataException);
      expect(start).not.toHaveBeenCalled();
    },
  );

  test("the failure asked for is text, trimmed, and at most 200 characters", () => {
    expect(readFireDrillEventKey(" a:Incident:b:0 ")).toBe("a:Incident:b:0");
    expect(readFireDrillEventKey("x".repeat(200))).toHaveLength(200);
    expect(readFireDrillEventKey("x".repeat(201))).toBeUndefined();
    expect(readFireDrillEventKey("")).toBeUndefined();
    expect(readFireDrillEventKey(42)).toBeUndefined();
    expect(readFireDrillEventKey({ key: "a" })).toBeUndefined();
    // A declared incident's key (#9397) is well inside the limit.
    expect(
      readFireDrillEventKey(
        `${MONITOR.toString()}:Incident:${OTHER_POLICY.toString()}:12:declared`,
      ),
    ).toBe(
      `${MONITOR.toString()}:Incident:${OTHER_POLICY.toString()}:12:declared`,
    );
  });

  // #9385: each policy's test walks every level only when asked with true.
  test.each([
    [true, true],
    [false, false],
    ["true", false],
    [1, false],
    [undefined, false],
  ] as Array<[unknown, boolean]>)(
    "starting it with walksEscalation %p walks every level: %p",
    async (walksEscalation: unknown, walks: boolean) => {
      const start: jest.SpyInstance = jest
        .spyOn(OnCallFireDrillService, "start")
        .mockResolvedValue({ runs: [] } as never);

      await call("POST", "/fire-drill/start", {
        body: {
          monitorId: MONITOR.toString(),
          eventKey: "criteria-1:Incident:template-1:0",
          ...(walksEscalation === undefined
            ? {}
            : { walksEscalation: walksEscalation as JSONObject[string] }),
        },
      });

      expect(start).toHaveBeenCalledWith(
        expect.objectContaining({ walksEscalation: walks }),
      );
    },
  );

  /*
   * #9386: a monitor's last drill, for its card - read in the caller's
   * project with the caller's own standing (a read like the result's), the
   * monitor named in the path and nothing else read from the request.
   */
  describe("GET /fire-drill/last/:monitorId", () => {
    const props: DatabaseCommonInteractionProps = {
      userId: ANA,
      tenantId: PROJECT,
    };

    beforeEach(() => {
      jest
        .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
        .mockResolvedValue(props as never);
      jest
        .spyOn(CommonAPI, "assertAuthenticatedProjectMember")
        .mockReturnValue(PROJECT);
    });

    test("runs behind the user middleware", () => {
      expect(
        mockRouter.match(
          "GET",
          `${ON_CALL_TEST_PAGE_API_PATH}/fire-drill/last/:monitorId`,
        ).middleware,
      ).toBe(UserMiddleware.getUserMiddleware);
    });

    test("reads the monitor's last drill in the caller's project, as the caller may read it", async () => {
      const getLast: jest.SpyInstance = jest
        .spyOn(OnCallFireDrillHistoryService, "getLast")
        .mockResolvedValue({ fireDrillId: "drill-1", runs: [] } as never);

      const { thrown, sent } = await call(
        "GET",
        "/fire-drill/last/:monitorId",
        {
          params: { monitorId: MONITOR.toString() },
          body: { projectId: OTHER_PROJECT.toString() },
        },
      );

      expect(thrown).toBeUndefined();
      expect(getLast).toHaveBeenCalledWith({
        projectId: PROJECT,
        monitorId: MONITOR,
        props: props,
      });
      expect(sent).toEqual({ fireDrill: { fireDrillId: "drill-1", runs: [] } });
    });

    test("none to read is said as none", async () => {
      jest
        .spyOn(OnCallFireDrillHistoryService, "getLast")
        .mockResolvedValue(null as never);

      const { sent } = await call("GET", "/fire-drill/last/:monitorId", {
        params: { monitorId: MONITOR.toString() },
      });

      expect(sent).toEqual({ fireDrill: null });
    });

    test("a monitor the caller may not read is refused as the history refuses it", async () => {
      jest
        .spyOn(OnCallFireDrillHistoryService, "getLast")
        .mockRejectedValue(new BadDataException("Monitor not found.") as never);

      const { thrown } = await call("GET", "/fire-drill/last/:monitorId", {
        params: { monitorId: MONITOR.toString() },
      });

      expect(thrown).toBeInstanceOf(BadDataException);
    });

    test("a monitor that is not an id is refused before anything is read", async () => {
      const getLast: jest.SpyInstance = jest.spyOn(
        OnCallFireDrillHistoryService,
        "getLast",
      );

      const { thrown } = await call("GET", "/fire-drill/last/:monitorId", {
        params: { monitorId: "1 OR 1=1" },
      });

      expect(thrown).toBeInstanceOf(BadDataException);
      expect(getLast).not.toHaveBeenCalled();
    });

    test("a caller who is not a member of the project reads nothing", async () => {
      jest
        .spyOn(CommonAPI, "assertAuthenticatedProjectMember")
        .mockImplementation(() => {
          throw new NotAuthorizedException(
            ON_CALL_TEST_PAGE_NOT_AUTHORIZED_MESSAGE,
          );
        });
      const getLast: jest.SpyInstance = jest.spyOn(
        OnCallFireDrillHistoryService,
        "getLast",
      );

      const { thrown } = await call("GET", "/fire-drill/last/:monitorId", {
        params: { monitorId: MONITOR.toString() },
      });

      expect(thrown).toBeInstanceOf(NotAuthorizedException);
      expect(getLast).not.toHaveBeenCalled();
    });
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
