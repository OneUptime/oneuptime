import TestSendAccess, {
  TestSendCaller,
  TEST_NOTIFICATION_PERMISSION_MESSAGE,
} from "../../../Server/API/TestSendAccess";
import WorkspaceNotificationSummaryService, {
  WorkspaceSummaryTestNotPostedException,
} from "../../../Server/Services/WorkspaceNotificationSummaryService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  getWorkspaceSummaryTestChannels,
  WorkspaceSummaryTestChannel,
} from "../../../Types/Workspace/NotificationSummary/WorkspaceSummaryTestChannel";
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
import type { SpyInstance } from "jest-mock";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Logger");

/*
 * #6920: what a summary's Send Test Now route answers. A test that every
 * channel got: 200. A test that a channel did not get: a 400 whose
 * `message` says it in English, as every refusal does, and whose
 * `channels` say what became of the test in each channel - for the
 * Dashboard to list them in the reader's language. Every other refusal
 * (not allowed, no channels to post in) goes to the error handler as
 * before, which answers its message alone.
 *
 * Who may send a test is TestSendRoutesMatrix.test.ts; how a summary is
 * sent, WorkspaceNotificationSummaryChannelErrors.test.ts. Here both are
 * stood in for, and the real Response answers.
 */

const ROUTE: string =
  "/workspace-notification-summary/test/:workspaceNotificationSummaryId";

const PROJECT_ID: ObjectID = new ObjectID(
  "69200000-0000-4000-8000-0000000000e1",
);
const USER_ID: ObjectID = new ObjectID("69200000-0000-4000-8000-0000000000e2");
const SUMMARY_ID: ObjectID = new ObjectID(
  "69200000-0000-4000-8000-0000000000e3",
);

const NOT_FOUND: string =
  "The Slack channel #gone was not found. If it is a private channel, invite OneUptime's bot to it in Slack.";

const NOT_POSTED: string = `The test summary was not posted in 1 of its 2 channels. #gone: ${NOT_FOUND}`;

const CHANNELS: Array<WorkspaceSummaryTestChannel> = [
  { channelName: "#ops", isPosted: true },
  { channelName: "#gone", isPosted: false, reason: NOT_FOUND },
];

interface Answer {
  status: number | undefined;
  body: unknown;
  // What the route handed to the error handler, if it did.
  passedOn: unknown;
}

let testSummary: SpyInstance<
  typeof WorkspaceNotificationSummaryService.testSummary
>;

async function sendTest(): Promise<Answer> {
  const answer: Answer = {
    status: undefined,
    body: undefined,
    passedOn: undefined,
  };

  const req: ExpressRequest = {
    params: { workspaceNotificationSummaryId: SUMMARY_ID.toString() },
    headers: {},
    query: {},
    body: {},
  } as unknown as ExpressRequest;

  const res: Record<string, unknown> = {};
  res["status"] = jest.fn((status: number) => {
    answer.status = status;
    return res;
  });
  res["send"] = jest.fn((body: unknown) => {
    answer.body = body;
    return res;
  });
  res["json"] = res["send"];

  let passedOnCount: number = 0;
  const next: NextFunction = ((err?: unknown): void => {
    passedOnCount++;
    answer.passedOn = err;
  }) as NextFunction;

  await mockRouter
    .match("POST", ROUTE)
    .handlerFunction(req, res as unknown as ExpressResponse, next);

  // Answered, or handed on: never both, never neither.
  expect(Number(answer.status !== undefined) + passedOnCount).toBe(1);

  return answer;
}

beforeAll(async () => {
  mockRouter.routes.length = 0;
  const module: { default: new () => unknown } = await import(
    "../../../Server/API/WorkspaceNotificationSummaryAPI"
  );
  new module.default();
});

beforeEach(() => {
  jest.spyOn(TestSendAccess, "assertMaySendTest").mockResolvedValue({
    props: { tenantId: PROJECT_ID, userId: USER_ID },
    projectId: PROJECT_ID,
    userId: USER_ID,
  } as TestSendCaller);

  testSummary = jest
    .spyOn(WorkspaceNotificationSummaryService, "testSummary")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Send Test Now's answer", () => {
  test("a test every channel got: 200, nothing more", async () => {
    const answer: Answer = await sendTest();

    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({});
    expect(testSummary).toHaveBeenCalledTimes(1);
    expect(testSummary.mock.calls[0]![0].summaryId.toString()).toBe(
      SUMMARY_ID.toString(),
    );
  });

  test("a test a channel did not get: 400, its message in English and each channel with what became of the test there", async () => {
    testSummary.mockRejectedValue(
      new WorkspaceSummaryTestNotPostedException({
        message: NOT_POSTED,
        channels: CHANNELS,
      }),
    );

    const answer: Answer = await sendTest();

    expect(answer.passedOn).toBeUndefined();
    expect(answer.status).toBe(400);
    expect(answer.body).toStrictEqual({
      message: NOT_POSTED,
      channels: CHANNELS,
    });
  });

  test("what the Dashboard reads of it, once the browser has it as JSON: the message, and the channels as the route answered them", async () => {
    testSummary.mockRejectedValue(
      new WorkspaceSummaryTestNotPostedException({
        message: NOT_POSTED,
        channels: CHANNELS,
      }),
    );

    const answer: Answer = await sendTest();

    // As the Dashboard's API hands a 400 to Send Test Now (API.post).
    const received: HTTPErrorResponse = new HTTPErrorResponse(
      answer.status!,
      JSON.parse(JSON.stringify(answer.body)) as JSONObject,
      {},
    );

    expect(received.message).toBe(NOT_POSTED);
    expect(getWorkspaceSummaryTestChannels(received.jsonData)).toEqual(
      CHANNELS,
    );
  });

  test("a refusal that is not about channels - a summary with none - goes to the error handler, as before: its message alone", async () => {
    const noChannels: BadDataException = new BadDataException(
      "The summary has no channel to post in.",
    );
    testSummary.mockRejectedValue(noChannels);

    const answer: Answer = await sendTest();

    expect(answer.status).toBeUndefined();
    expect(answer.passedOn).toBe(noChannels);
  });

  test("a caller who may not send a test is refused before anything is sent, through the error handler", async () => {
    const refusal: NotAuthorizedException = new NotAuthorizedException(
      TEST_NOTIFICATION_PERMISSION_MESSAGE,
    );
    jest.spyOn(TestSendAccess, "assertMaySendTest").mockRejectedValue(refusal);

    const answer: Answer = await sendTest();

    expect(answer.passedOn).toBe(refusal);
    expect(answer.status).toBeUndefined();
    expect(testSummary).not.toHaveBeenCalled();
  });

  test("anything else thrown goes to the error handler too", async () => {
    const thrown: Error = new Error("Connection terminated unexpectedly");
    testSummary.mockRejectedValue(thrown);

    const answer: Answer = await sendTest();

    expect(answer.passedOn).toBe(thrown);
    expect(answer.status).toBeUndefined();
  });
});

describe("WorkspaceSummaryTestNotPostedException", () => {
  test("is a refusal of bad data, its message as given: anything that handles one as a BadDataException still does", () => {
    const refusal: WorkspaceSummaryTestNotPostedException =
      new WorkspaceSummaryTestNotPostedException({
        message: NOT_POSTED,
        channels: CHANNELS,
      });

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.code).toBe(400);
    expect(refusal.message).toBe(NOT_POSTED);
    expect(refusal.channels).toBe(CHANNELS);
  });
});
