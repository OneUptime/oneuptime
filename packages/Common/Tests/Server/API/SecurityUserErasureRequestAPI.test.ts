import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * HOW FAR EACH OPEN ERASURE REQUEST HAS GOT, THROUGH ITS ROUTE (#11232):
 *
 *   POST /security-user-erasure-request/progress
 *
 * The worker keeps where a request got to in its `progress`, which no role
 * may read: its cursor holds a finding's _id. The route reads it as the
 * server and answers with the line the page shows - a step, a pass, times,
 * why a run failed - to whoever may read the requests, and to nobody else.
 * Never the cursor, never a finding's id.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

import SecurityUserErasureRequest from "../../../Models/DatabaseModels/SecurityUserErasureRequest";
import CommonAPI from "../../../Server/API/CommonAPI";
import SecurityUserErasureRequestAPI, {
  ERASURE_PROGRESS_REFUSED_MESSAGE,
} from "../../../Server/API/SecurityUserErasureRequestAPI";
import SecurityUserErasureRequestService from "../../../Server/Services/SecurityUserErasureRequestService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { DETECTION_TURN_SETTLE_MS } from "../../../Server/Utils/SecurityEvent/UserVault/SecurityUserErasure";
import { toStoredErasureProgress } from "../../../Server/Utils/SecurityEvent/UserVault/SecurityUserErasureProgress";
import Includes from "../../../Types/BaseDatabase/Includes";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Exception from "../../../Types/Exception/Exception";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { SecurityUserErasureRequestStatus } from "../../../Types/SecurityEvent/SecurityUserErasure";
import {
  SECURITY_USER_ERASURE_PROGRESS_LIMIT,
  SECURITY_USER_ERASURE_PROGRESS_PATH,
  SecurityUserErasureStage,
  readProgressLines,
} from "../../../Types/SecurityEvent/SecurityUserErasureProgressLine";
import { customDomainCaller } from "./CustomDomainCallers";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { everyServerProductIsOn } from "../TestingUtils/ServerProductsOn";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "11232000-0000-4000-8000-0000000000a1",
);
// A finding's random _id, as the worker's cursor keeps it: never in an answer.
const FINDING_ID: string = "6b3e1f40-1c2d-4e8f-9a61-7d0c2b4e6f99";
const CLEAN_SINCE: Date = new Date("2026-11-27T10:00:00.000Z");

const READERS: Array<[string, Permission]> = [
  ["Project Owner", Permission.ProjectOwner],
  ["Project Admin", Permission.ProjectAdmin],
  ["Security Admin", Permission.SecurityAdmin],
  ["Security Member", Permission.SecurityMember],
  ["Security Viewer", Permission.SecurityViewer],
  ["Read Security Erasure Request", Permission.ReadSecurityUserErasureRequest],
];

let props: DatabaseCommonInteractionProps;
let findBy: MockedFn;

const sendJsonObjectResponseMock: MockedFn =
  Response.sendJsonObjectResponse as unknown as MockedFn;

function caller(permission: Permission): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: [permission], projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

function request(
  fields: Partial<Record<string, unknown>>,
): SecurityUserErasureRequest {
  return Object.assign(new SecurityUserErasureRequest(), {
    id: ObjectID.generate(),
    projectId: PROJECT_ID,
    attempts: 0,
    updatedAt: CLEAN_SINCE,
    ...fields,
  });
}

async function read(): Promise<{
  answer: JSONObject | null;
  refusal: Exception | null;
}> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    headers: {},
    body: {},
  } as unknown as ExpressRequest;
  const next: MockedFn = jest.fn();

  await mockRouter
    .match("post", SECURITY_USER_ERASURE_PROGRESS_PATH)
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  return {
    answer: sendJsonObjectResponseMock.mock.calls[0]
      ? (sendJsonObjectResponseMock.mock.calls[0][2] as JSONObject)
      : null,
    refusal: (next.mock.calls[0]?.[0] as Exception | undefined) || null,
  };
}

const READING: SecurityUserErasureRequest = request({
  status: SecurityUserErasureRequestStatus.InProgress,
  progress: toStoredErasureProgress({
    toldAt: "2026-11-27T09:58:00.000Z",
    namedEvents: 3,
    cleanSince: null,
    unnamedFindings: 0,
    findings: {
      number: 1,
      startedAt: "2026-11-27T09:58:00.000Z",
      after: { time: "1764000000123456789", id: FINDING_ID },
      changed: 4,
      unnamed: 4,
      isFinal: false,
      endedAt: null,
    },
  }),
});
const QUEUED: SecurityUserErasureRequest = request({
  status: SecurityUserErasureRequestStatus.Pending,
});

beforeAll(() => {
  mockRouter.routes.length = 0;
  new SecurityUserErasureRequestAPI();
});

beforeEach(() => {
  jest.clearAllMocks();

  everyServerProductIsOn();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return props;
    });

  findBy = jest
    .spyOn(SecurityUserErasureRequestService, "findBy")
    .mockResolvedValue([READING, QUEUED]) as unknown as MockedFn;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /security-user-erasure-request/progress", () => {
  test.each(READERS)(
    "a %s reads how far the project's open requests have got",
    async (_who: string, permission: Permission) => {
      props = caller(permission);

      const { answer, refusal } = await read();

      expect(refusal).toBeNull();
      expect(readProgressLines(answer)).toEqual([
        {
          requestId: READING.id!.toString(),
          status: SecurityUserErasureRequestStatus.InProgress,
          stage: SecurityUserErasureStage.ReadingFindings,
          pass: 1,
          readUpTo: new Date(1764000000123).toISOString(),
        },
        {
          requestId: QUEUED.id!.toString(),
          status: SecurityUserErasureRequestStatus.Pending,
          stage: null,
        },
      ]);
      expect(Response.setNoCacheHeaders).toHaveBeenCalledTimes(1);
    },
  );

  test("reads the project's open requests alone, as the server, newest first, at most a page of them", async () => {
    props = caller(Permission.SecurityViewer);

    await read();

    expect(findBy).toHaveBeenCalledTimes(1);

    const asked: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      sort: Record<string, unknown>;
      limit: number;
      props: Record<string, unknown>;
    } = findBy.mock.calls[0]![0] as never;

    expect(asked.query["projectId"]).toEqual(PROJECT_ID);
    expect(asked.query["status"]).toEqual(
      new Includes([
        SecurityUserErasureRequestStatus.Pending,
        SecurityUserErasureRequestStatus.InProgress,
      ]),
    );
    expect(asked.select).toEqual(
      expect.objectContaining({ progress: true, status: true }),
    );
    // Nothing of the person is read for it.
    expect(asked.select).not.toHaveProperty("userToErase");
    expect(asked.select).not.toHaveProperty("namesToErase");
    expect(asked.select).not.toHaveProperty("tokens");
    expect(asked.limit).toBe(SECURITY_USER_ERASURE_PROGRESS_LIMIT);
    expect(asked.props).toEqual({ isRoot: true });
  });

  test("never a finding's id: the answer holds the line, not what the worker keeps", async () => {
    props = caller(Permission.SecurityAdmin);

    const { answer } = await read();
    const text: string = JSON.stringify(answer);

    expect(text).not.toContain(FINDING_ID);
    expect(text).not.toContain("1764000000123456789");
    expect(text).not.toContain("namedEvents");
    expect(text).not.toContain("cursor");
  });

  test("a request waiting for its final check says when it starts; one whose run failed, when it tries again and why", async () => {
    const waiting: SecurityUserErasureRequest = request({
      status: SecurityUserErasureRequestStatus.InProgress,
      progress: toStoredErasureProgress({
        toldAt: "2026-11-27T09:58:00.000Z",
        namedEvents: 3,
        cleanSince: CLEAN_SINCE.toISOString(),
        unnamedFindings: 4,
        findings: {
          number: 1,
          startedAt: "2026-11-27T09:58:00.000Z",
          after: { time: "1764000000123456789", id: FINDING_ID },
          changed: 4,
          unnamed: 4,
          isFinal: false,
          endedAt: "2026-11-27T09:59:00.000Z",
        },
      }),
    });
    const failed: SecurityUserErasureRequest = request({
      status: SecurityUserErasureRequestStatus.InProgress,
      attempts: 2,
      failureReason: "ClickHouse did not answer in time.",
      updatedAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    findBy.mockResolvedValue([waiting, failed] as never);
    props = caller(Permission.SecurityMember);

    const lines: ReturnType<typeof readProgressLines> = readProgressLines(
      (await read()).answer,
    );

    expect(lines[0]).toEqual(
      expect.objectContaining({
        stage: SecurityUserErasureStage.WaitingForFinalCheck,
      }),
    );
    expect(new Date(lines[0]!.finalCheckAt!).getTime()).toBeGreaterThanOrEqual(
      CLEAN_SINCE.getTime() + DETECTION_TURN_SETTLE_MS,
    );
    expect(lines[1]).toEqual(
      expect.objectContaining({
        stage: SecurityUserErasureStage.Retrying,
        failureReason: "ClickHouse did not answer in time.",
      }),
    );
  });

  test.each([
    ["Project Member", Permission.ProjectMember],
    ["Project Viewer", Permission.Viewer],
    // Files a request, but reads none of Security Events.
    [
      "Create Security Erasure Request",
      Permission.CreateSecurityUserErasureRequest,
    ],
  ])(
    "a %s, who may not read Erasure Requests, reads nothing of it",
    async (_who: string, permission: Permission) => {
      props = caller(permission);

      const { answer, refusal } = await read();

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect(refusal?.message).toBe(ERASURE_PROGRESS_REFUSED_MESSAGE);
      expect(answer).toBeNull();
      expect(findBy).not.toHaveBeenCalled();
    },
  );

  test("a request that names no project is refused before anything is read", async () => {
    props = { ...caller(Permission.ProjectOwner), tenantId: undefined };

    const { answer, refusal } = await read();

    expect(refusal?.message).toBe("Project ID is required");
    expect(answer).toBeNull();
    expect(findBy).not.toHaveBeenCalled();
  });

  test("goes through sign-in and the product's switch before its handler", () => {
    const route: { middlewares: Array<unknown> } = mockRouter.match(
      "post",
      SECURITY_USER_ERASURE_PROGRESS_PATH,
    ) as unknown as { middlewares: Array<unknown> };

    expect(route.middlewares.length).toBeGreaterThanOrEqual(3);
  });

  test("keeps the CRUD routes of the requests", () => {
    for (const path of [
      "/security-user-erasure-request",
      "/security-user-erasure-request/get-list",
      "/security-user-erasure-request/count",
    ]) {
      expect(mockRouter.match("post", path)).toBeTruthy();
    }
  });
});
