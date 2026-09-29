import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * Wiring for IncidentFormAPI, the router behind every incident form link.
 *
 * The limiter, the service and the real HTTP behaviour each have suites of
 * their own. What this file protects is the part that silently rots:
 *
 *   - the public surface is exactly two routes, and each runs the limiter,
 *     then the ANONYMOUS user middleware, then the handler - so a flood is
 *     refused before it costs anything, and a dead session cookie is
 *     ignored rather than answered with a 401;
 *   - reading uses the read bucket (fails open) and submitting the submit
 *     bucket (fails closed);
 *   - the inherited CRUD routes keep the signed-in user middleware;
 *   - the handlers pass the service exactly the link, the trusted client
 *     address and the answers - never who is calling, never a project - and
 *     check the body's shape before the service sees it.
 */

jest.mock("../../../Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
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

jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEntityArrayResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

import IncidentFormAPI, {
  INCIDENT_FORM_CAPTCHA_TOKEN_MAX_LENGTH,
  INCIDENT_FORM_CAPTCHA_TOKEN_MESSAGE,
  INCIDENT_FORM_CAPTCHA_TOKEN_TOO_LONG_MESSAGE,
  INCIDENT_FORM_SUBMISSION_BODY_MESSAGE,
} from "../../../Server/API/IncidentFormAPI";
import BaseAPI from "../../../Server/API/BaseAPI";
import IncidentForm from "../../../Models/DatabaseModels/IncidentForm";
import Redis from "../../../Server/Infrastructure/Redis";
import { INCIDENT_FORM_RATE_LIMIT_UNAVAILABLE_MESSAGE } from "../../../Server/Middleware/IncidentFormRateLimit";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import IncidentFormService from "../../../Server/Services/IncidentFormService";
import Response from "../../../Server/Utils/Response";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import {
  IncidentFormFieldSetting,
  PublicIncidentForm,
  PublicIncidentFormSubmissionResult,
} from "../../../Types/Incident/IncidentFormPublic";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";

type MockedFn = ReturnType<typeof jest.fn>;

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

interface RegisteredRoute {
  method: string;
  uri: string;
  middlewares: Array<RouterFunction>;
  handlerFunction: RouterFunction;
}

const getClientMock: MockedFn = Redis.getClient as unknown as MockedFn;
const isConnectedMock: MockedFn = Redis.isConnected as unknown as MockedFn;
const sendErrorResponseMock: MockedFn =
  Response.sendErrorResponse as unknown as MockedFn;
const sendJsonObjectResponseMock: MockedFn =
  Response.sendJsonObjectResponse as unknown as MockedFn;
const setNoCacheHeadersMock: MockedFn =
  Response.setNoCacheHeaders as unknown as MockedFn;

const READ_URI: string = "/incident-form/public/:shareKey";
const SUBMIT_URI: string = "/incident-form/public/:shareKey/submit";
const SHARE_KEY: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const TRUSTED_IP: string = "203.0.113.7";

const PUBLIC_FORM: PublicIncidentForm = {
  name: "Report a Problem",
  descriptionSetting: IncidentFormFieldSetting.Optional,
  isReporterDetailsRequired: true,
  customFields: [],
  isCaptchaRequired: false,
};

const SUBMISSION_RESULT: PublicIncidentFormSubmissionResult = {
  incidentNumber: "INC-42",
  successMessage: "Thanks",
};

const answersForToken: Record<string, unknown> = {
  title: "Checkout is down",
  reporterName: "Jane",
  reporterEmail: "jane@example.com",
};

// Same counting fake as the limiter's own tests use.
class FakeRedisClient {
  public counters: Map<string, number> = new Map();

  public pipeline(): FakePipeline {
    return new FakePipeline(this);
  }
}

type QueuedCommand = () => [Error | null, unknown];

class FakePipeline {
  private commands: Array<QueuedCommand> = [];

  public constructor(private client: FakeRedisClient) {}

  public incr(key: string): FakePipeline {
    this.commands.push((): [Error | null, unknown] => {
      const next: number = (this.client.counters.get(key) || 0) + 1;
      this.client.counters.set(key, next);
      return [null, next];
    });

    return this;
  }

  public expire(): FakePipeline {
    this.commands.push((): [Error | null, unknown] => {
      return [null, 1];
    });

    return this;
  }

  public async exec(): Promise<unknown> {
    return this.commands.map((command: QueuedCommand) => {
      return command();
    });
  }
}

function route(method: string, uri: string): RegisteredRoute {
  return mockRouter.match(method, uri) as unknown as RegisteredRoute;
}

function buildRequest(data: {
  body?: unknown;
  params?: Record<string, string>;
  extra?: Record<string, unknown>;
}): ExpressRequest {
  return {
    params: data.params || { shareKey: SHARE_KEY },
    body: data.body,
    query: {},
    cookies: {},
    headers: { "x-forwarded-for": `9.9.9.9, ${TRUSTED_IP}` },
    socket: { remoteAddress: "127.0.0.1" },
    ...(data.extra || {}),
  } as unknown as ExpressRequest;
}

async function runHandler(
  method: string,
  uri: string,
  request: ExpressRequest,
): Promise<{ next: MockedFn; response: ExpressResponse }> {
  const next: MockedFn = jest.fn();
  const response: ExpressResponse = {
    setHeader: jest.fn(),
    status: jest.fn(),
    send: jest.fn(),
  } as unknown as ExpressResponse;

  await route(method, uri).handlerFunction(
    request,
    response,
    next as unknown as NextFunction,
  );

  return { next, response };
}

// What an error handed to next() was.
function nextError(next: MockedFn): Exception {
  expect(next).toHaveBeenCalledTimes(1);
  return next.mock.calls[0]![0] as Exception;
}

describe("IncidentFormAPI", () => {
  let getPublicForm: MockedFn;
  let submitPublicForm: MockedFn;
  let client: FakeRedisClient;

  beforeEach(() => {
    mockRouter.routes.length = 0;
    jest.clearAllMocks();

    new IncidentFormAPI();

    client = new FakeRedisClient();
    getClientMock.mockReturnValue(client);
    isConnectedMock.mockReturnValue(true);

    getPublicForm = jest
      .spyOn(IncidentFormService, "getPublicForm")
      .mockResolvedValue(PUBLIC_FORM as never) as unknown as MockedFn;
    submitPublicForm = jest
      .spyOn(IncidentFormService, "submitPublicForm")
      .mockResolvedValue(SUBMISSION_RESULT as never) as unknown as MockedFn;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("registration", () => {
    /*
     * IncidentFormAPI inherits the model's authenticated CRUD routes from
     * BaseAPI. They are derived by registering a plain BaseAPI for the same
     * model and subtracting, rather than listed here, so the check cannot
     * drift from BaseAPI.
     */
    const splitRoutes: () => {
      custom: Array<RegisteredRoute>;
      inherited: Array<RegisteredRoute>;
    } = () => {
      const declared: Array<RegisteredRoute> = [
        ...(mockRouter.routes as unknown as Array<RegisteredRoute>),
      ];

      mockRouter.routes.length = 0;
      new BaseAPI(IncidentForm, IncidentFormService);

      const inheritedKeys: Set<string> = new Set(
        (mockRouter.routes as unknown as Array<RegisteredRoute>).map(
          (registered: RegisteredRoute) => {
            return `${registered.method} ${registered.uri}`;
          },
        ),
      );

      return {
        custom: declared.filter((registered: RegisteredRoute) => {
          return !inheritedKeys.has(`${registered.method} ${registered.uri}`);
        }),
        inherited: declared.filter((registered: RegisteredRoute) => {
          return inheritedKeys.has(`${registered.method} ${registered.uri}`);
        }),
      };
    };

    it("adds exactly the two public routes to the model's CRUD routes", () => {
      const { custom, inherited } = splitRoutes();

      expect(
        custom
          .map((registered: RegisteredRoute) => {
            return `${registered.method} ${registered.uri}`;
          })
          .sort(),
      ).toEqual([`GET ${READ_URI}`, `POST ${SUBMIT_URI}`]);
      expect(inherited.length).toBeGreaterThan(0);
    });

    /*
     * Order matters. In front of UserMiddleware a flood is refused before it
     * costs a session lookup; the anonymous variant turns a dead session
     * cookie into an anonymous request instead of a 401 that would send the
     * visitor to the login page. Nothing else stands between them and the
     * handler.
     */
    it.each([
      ["GET", READ_URI],
      ["POST", SUBMIT_URI],
    ])(
      "runs %s %s as limiter, anonymous user middleware, handler",
      (method: string, uri: string) => {
        const registered: RegisteredRoute = route(method, uri);

        expect(registered.middlewares).toHaveLength(2);
        expect(registered.middlewares[1]).toBe(
          UserMiddleware.getPublicRouteUserMiddleware,
        );
        expect(registered.middlewares[0]).not.toBe(
          UserMiddleware.getPublicRouteUserMiddleware,
        );
        expect(registered.middlewares).not.toContain(
          UserMiddleware.getUserMiddleware,
        );
        expect(registered.middlewares).not.toContain(
          UserMiddleware.requireUserAuthentication,
        );
      },
    );

    it("leaves every CRUD route behind the signed-in user middleware", () => {
      const { inherited } = splitRoutes();

      for (const registered of inherited) {
        expect([
          `${registered.method} ${registered.uri}`,
          registered.middlewares,
        ]).toEqual([
          `${registered.method} ${registered.uri}`,
          [UserMiddleware.getUserMiddleware],
        ]);
      }
    });
  });

  describe("the limiters", () => {
    const runLimiter: (
      method: string,
      uri: string,
    ) => Promise<boolean> = async (method: string, uri: string) => {
      let reachedNext: boolean = false;

      await route(method, uri).middlewares[0]!(
        buildRequest({}),
        { setHeader: jest.fn() } as unknown as ExpressResponse,
        (() => {
          reachedNext = true;
        }) as unknown as NextFunction,
      );

      return reachedNext;
    };

    it("counts reading the form on the read bucket, for this form and address", async () => {
      await runLimiter("GET", READ_URI);

      expect(Array.from(client.counters.keys()).sort()).toEqual([
        expect.stringMatching(
          new RegExp(`^iform:rl:read:fi:k:${SHARE_KEY}:${TRUSTED_IP}:\\d+$`),
        ),
        expect.stringMatching(
          new RegExp(`^iform:rl:read:i:${TRUSTED_IP}:\\d+$`),
        ),
      ]);
    });

    it("counts a submission on the submit bucket, with the form's own ceiling", async () => {
      await runLimiter("POST", SUBMIT_URI);

      expect(Array.from(client.counters.keys()).sort()).toEqual([
        expect.stringMatching(
          new RegExp(`^iform:rl:submit:f:k:${SHARE_KEY}:\\d+$`),
        ),
        expect.stringMatching(
          new RegExp(`^iform:rl:submit:fi:k:${SHARE_KEY}:${TRUSTED_IP}:\\d+$`),
        ),
        expect.stringMatching(
          new RegExp(`^iform:rl:submit:i:${TRUSTED_IP}:\\d+$`),
        ),
      ]);
    });

    it("refuses the eleventh submission from one address to one form", async () => {
      for (let i: number = 0; i < 10; i++) {
        expect(await runLimiter("POST", SUBMIT_URI)).toBe(true);
      }

      expect(await runLimiter("POST", SUBMIT_URI)).toBe(false);
      expect((sendErrorResponseMock.mock.calls[0]![2] as Exception).code).toBe(
        ExceptionCode.TooManyRequestsException,
      );
    });

    it("keeps showing the form when Redis is gone", async () => {
      isConnectedMock.mockReturnValue(false);

      expect(await runLimiter("GET", READ_URI)).toBe(true);
      expect(sendErrorResponseMock).not.toHaveBeenCalled();
    });

    it("refuses submissions with a 503 when Redis is gone", async () => {
      isConnectedMock.mockReturnValue(false);

      expect(await runLimiter("POST", SUBMIT_URI)).toBe(false);

      const error: Exception = sendErrorResponseMock.mock
        .calls[0]![2] as Exception;

      expect(error.code).toBe(503);
      expect(error.message).toBe(INCIDENT_FORM_RATE_LIMIT_UNAVAILABLE_MESSAGE);
    });
  });

  describe("GET /incident-form/public/:shareKey", () => {
    it("answers with the service's public form, uncached", async () => {
      const request: ExpressRequest = buildRequest({});
      const { next, response } = await runHandler("GET", READ_URI, request);

      expect(next).not.toHaveBeenCalled();
      expect(setNoCacheHeadersMock).toHaveBeenCalledWith(response);
      expect(sendJsonObjectResponseMock).toHaveBeenCalledWith(
        request,
        response,
        PUBLIC_FORM,
      );
    });

    it("asks the service with the link's key and the trusted client address", async () => {
      await runHandler("GET", READ_URI, buildRequest({}));

      expect(getPublicForm).toHaveBeenCalledWith({
        shareKey: SHARE_KEY,
        clientIp: TRUSTED_IP,
      });
    });

    it("passes no address when none can be established", async () => {
      await runHandler(
        "GET",
        READ_URI,
        buildRequest({ extra: { headers: {}, socket: {} } }),
      );

      expect(getPublicForm).toHaveBeenCalledWith({
        shareKey: SHARE_KEY,
        clientIp: undefined,
      });
    });

    it("hands the service's refusal to the error handler, still uncached", async () => {
      getPublicForm.mockRejectedValue(new NotFoundException("gone"));

      const { next, response } = await runHandler(
        "GET",
        READ_URI,
        buildRequest({}),
      );

      expect(nextError(next).message).toBe("gone");
      expect(setNoCacheHeadersMock).toHaveBeenCalledWith(response);
      expect(sendJsonObjectResponseMock).not.toHaveBeenCalled();
    });

    /*
     * Forms are anonymous. A signed-in visitor, a tenant header, a user type
     * - none of it may change what the service is asked.
     */
    it("never tells the service who is calling", async () => {
      await runHandler(
        "GET",
        READ_URI,
        buildRequest({
          extra: {
            userAuthorization: { userId: ObjectID.generate() },
            userType: UserType.User,
            tenantId: ObjectID.generate(),
          },
        }),
      );

      expect(getPublicForm).toHaveBeenCalledWith({
        shareKey: SHARE_KEY,
        clientIp: TRUSTED_IP,
      });
    });
  });

  describe("POST /incident-form/public/:shareKey/submit", () => {
    const answers: Record<string, unknown> = {
      title: "Checkout is down",
      reporterName: "Jane",
      reporterEmail: "jane@example.com",
    };

    it("declares through the service and answers with its result, uncached", async () => {
      const request: ExpressRequest = buildRequest({
        body: { data: answers, captchaToken: "captcha" },
      });
      const { next, response } = await runHandler("POST", SUBMIT_URI, request);

      expect(next).not.toHaveBeenCalled();
      expect(setNoCacheHeadersMock).toHaveBeenCalledWith(response);
      expect(sendJsonObjectResponseMock).toHaveBeenCalledWith(
        request,
        response,
        SUBMISSION_RESULT,
      );
    });

    it("asks the service with the key, the answers, the captcha token and the trusted address", async () => {
      await runHandler(
        "POST",
        SUBMIT_URI,
        buildRequest({ body: { data: answers, captchaToken: "captcha" } }),
      );

      expect(submitPublicForm).toHaveBeenCalledWith({
        shareKey: SHARE_KEY,
        request: { data: answers, captchaToken: "captcha" },
        clientIp: TRUSTED_IP,
        captchaRemoteIp: TRUSTED_IP,
      });
    });

    it("leaves every other key of the body behind", async () => {
      await runHandler(
        "POST",
        SUBMIT_URI,
        buildRequest({
          body: {
            data: answers,
            projectId: ObjectID.generate().toString(),
            isRoot: true,
            miscDataProps: { ownerUsers: [ObjectID.generate().toString()] },
          },
        }),
      );

      expect(submitPublicForm).toHaveBeenCalledWith({
        shareKey: SHARE_KEY,
        request: { data: answers },
        clientIp: TRUSTED_IP,
        captchaRemoteIp: TRUSTED_IP,
      });
    });

    it.each([
      ["a null token", null],
      ["no token", undefined],
    ])(
      "accepts %s, sending none on",
      async (_label: string, captchaToken: null | undefined) => {
        await runHandler(
          "POST",
          SUBMIT_URI,
          buildRequest({ body: { data: answers, captchaToken } }),
        );

        const request: Record<string, unknown> = (
          submitPublicForm.mock.calls[0]![0] as {
            request: Record<string, unknown>;
          }
        ).request;

        expect(request).toEqual({ data: answers });
        expect(request).not.toHaveProperty("captchaToken");
      },
    );

    it.each([
      ["no body", undefined],
      ["a null body", null],
      ["a string", "title=Down"],
      ["an array", [answers]],
      ["no answers", {}],
      ["answers that are a string", { data: "Down" }],
      ["answers that are a list", { data: [answers] }],
      ["null answers", { data: null }],
    ])(
      "refuses %s with a 400 before the service sees it",
      async (_label: string, body: unknown) => {
        const { next } = await runHandler(
          "POST",
          SUBMIT_URI,
          buildRequest({ body }),
        );

        const error: Exception = nextError(next);

        expect(error).toBeInstanceOf(BadDataException);
        expect(error.code).toBe(400);
        expect(error.message).toBe(INCIDENT_FORM_SUBMISSION_BODY_MESSAGE);
        expect(submitPublicForm).not.toHaveBeenCalled();
        expect(sendJsonObjectResponseMock).not.toHaveBeenCalled();
      },
    );

    it.each([
      ["a number", 42],
      ["an object", { token: "x" }],
      ["a list", ["x"]],
      ["a boolean", true],
    ])(
      "refuses a captcha token that is %s",
      async (_label: string, captchaToken: unknown) => {
        const { next } = await runHandler(
          "POST",
          SUBMIT_URI,
          buildRequest({ body: { data: answers, captchaToken } }),
        );

        const error: Exception = nextError(next);

        expect(error).toBeInstanceOf(BadDataException);
        expect(error.message).toBe(INCIDENT_FORM_CAPTCHA_TOKEN_MESSAGE);
        expect(submitPublicForm).not.toHaveBeenCalled();
      },
    );

    it("hands the service's refusal to the error handler", async () => {
      submitPublicForm.mockRejectedValue(
        new BadDataException("Title is required."),
      );

      const { next } = await runHandler(
        "POST",
        SUBMIT_URI,
        buildRequest({ body: { data: answers } }),
      );

      expect(nextError(next).message).toBe("Title is required.");
      expect(sendJsonObjectResponseMock).not.toHaveBeenCalled();
    });

    it("never tells the service who is calling", async () => {
      await runHandler(
        "POST",
        SUBMIT_URI,
        buildRequest({
          body: { data: answers },
          extra: {
            userAuthorization: { userId: ObjectID.generate() },
            userType: UserType.User,
            tenantId: ObjectID.generate(),
          },
        }),
      );

      expect(submitPublicForm).toHaveBeenCalledWith({
        shareKey: SHARE_KEY,
        request: { data: answers },
        clientIp: TRUSTED_IP,
        captchaRemoteIp: TRUSTED_IP,
      });
    });
  });

  describe("readSubmissionRequest", () => {
    it("returns the answers object itself, unread", () => {
      const data: Record<string, unknown> = { title: 1, anything: ["goes"] };

      expect(IncidentFormAPI.readSubmissionRequest({ data }).data).toBe(data);
    });

    it("keeps an empty captcha token for the captcha check to refuse", () => {
      expect(
        IncidentFormAPI.readSubmissionRequest({ data: {}, captchaToken: "" }),
      ).toEqual({ data: {}, captchaToken: "" });
    });

    /*
     * The token is forwarded to hCaptcha as it is, so a stranger must not be
     * able to make the server send megabytes of it on the form's behalf.
     */
    it("takes a token as long as the cap, and refuses one character more", () => {
      const longest: string = "t".repeat(
        INCIDENT_FORM_CAPTCHA_TOKEN_MAX_LENGTH,
      );

      expect(
        IncidentFormAPI.readSubmissionRequest({
          data: {},
          captchaToken: longest,
        }).captchaToken,
      ).toBe(longest);

      expect(() => {
        IncidentFormAPI.readSubmissionRequest({
          data: {},
          captchaToken: `${longest}t`,
        });
      }).toThrow(
        new BadDataException(INCIDENT_FORM_CAPTCHA_TOKEN_TOO_LONG_MESSAGE),
      );
      expect(INCIDENT_FORM_CAPTCHA_TOKEN_MAX_LENGTH).toBe(16384);
    });

    it("refuses a megabyte token before the service or hCaptcha sees it", async () => {
      const { next } = await runHandler(
        "POST",
        SUBMIT_URI,
        buildRequest({
          body: { data: answersForToken, captchaToken: "t".repeat(1_000_000) },
        }),
      );

      const error: Exception = nextError(next);

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe(INCIDENT_FORM_CAPTCHA_TOKEN_TOO_LONG_MESSAGE);
      expect(submitPublicForm).not.toHaveBeenCalled();
    });
  });
});
