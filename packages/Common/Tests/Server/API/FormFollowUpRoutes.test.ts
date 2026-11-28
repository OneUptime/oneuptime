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
 * A form's follow-up routes on FormAPI (Types/Form/FormFollowUp): on its
 * link and on its own domain, each held to the steps the form's own routes
 * are, in their order - the page's origin, then a JSON body (or, for the
 * GET, the page's header), then the limiter, then the anonymous user
 * middleware - and each handing Utils/Form/FormFollowUp the form read with
 * every check a visit makes, the visitor's form session and only what the
 * body names. Adding somebody, the one route that emails an address its
 * caller names, asks the public message limiter first and gives its count
 * back when nobody was added.
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

jest.mock("../../../Server/Utils/Form/FormFollowUp", () => {
  return {
    __esModule: true,
    default: {
      getRequest: jest.fn(),
      reply: jest.fn(),
      addPerson: jest.fn(),
      stopFollowing: jest.fn(),
      getMyRequests: jest.fn(),
    },
  };
});

import FormAPI from "../../../Server/API/FormAPI";
import Form from "../../../Models/DatabaseModels/Form";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import FormService from "../../../Server/Services/FormService";
import FormFollowUp from "../../../Server/Utils/Form/FormFollowUp";
import PublicMessageRateLimit, {
  PublicMessageKind,
} from "../../../Server/Utils/RateLimit/PublicMessageRateLimit";
import Response from "../../../Server/Utils/Response";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import {
  FORM_FOLLOW_UP_ADD_PERSON_ROUTE,
  FORM_FOLLOW_UP_BODY_MESSAGE,
  FORM_FOLLOW_UP_EMAIL_MESSAGE,
  FORM_FOLLOW_UP_REPLY_ROUTE,
  FORM_FOLLOW_UP_ROUTE,
  FORM_FOLLOW_UP_STOP_ROUTE,
  FORM_MY_REQUESTS_ROUTE,
} from "../../../Types/Form/FormFollowUp";
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

const LINK_PREFIX: string = "/form/public/:shareKey";
const DOMAIN_PREFIX: string = "/form/custom-domain";
const SHARE_KEY: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const CREDENTIAL: string = `3f2504e0-4f89-41d3-9a0c-0305e82c3301-${"ab".repeat(32)}`;

const FORM: Form = new Form();

function route(method: string, uri: string): RegisteredRoute {
  return mockRouter.match(method, uri) as unknown as RegisteredRoute;
}

function buildRequest(data: {
  body?: unknown;
  host?: string;
}): ExpressRequest {
  return {
    params: { shareKey: SHARE_KEY },
    body: data.body,
    query: {},
    cookies: {},
    headers: {
      host: data.host || "oneuptime.example",
      "x-forwarded-for": "203.0.113.7",
    },
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as ExpressRequest;
}

async function runHandler(
  method: string,
  uri: string,
  request: ExpressRequest,
): Promise<{ next: MockedFn }> {
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

  return { next };
}

function nextError(next: MockedFn): Exception {
  expect(next).toHaveBeenCalledTimes(1);
  return next.mock.calls[0]![0] as Exception;
}

describe("FormAPI's follow-up routes", () => {
  let getFormForFollowUp: MockedFn;
  let getShareKeyForCustomDomain: MockedFn;

  beforeEach(() => {
    mockRouter.routes.length = 0;
    jest.clearAllMocks();

    new FormAPI();

    getFormForFollowUp = jest
      .spyOn(FormService, "getFormForFollowUp")
      .mockResolvedValue(FORM as never) as unknown as MockedFn;
    getShareKeyForCustomDomain = jest
      .spyOn(FormService, "getShareKeyForCustomDomain")
      .mockResolvedValue(SHARE_KEY as never) as unknown as MockedFn;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the order of every route's checks", () => {
    const cases: Array<[string, string, Array<RouterFunction>]> = [];

    for (const prefix of [LINK_PREFIX, DOMAIN_PREFIX]) {
      const ownPage: RouterFunction =
        prefix === LINK_PREFIX
          ? FormAPI.refuseForeignPageRequests
          : FormAPI.refuseForeignPageRequestsOnCustomDomain;

      for (const path of [
        FORM_FOLLOW_UP_ROUTE,
        FORM_FOLLOW_UP_REPLY_ROUTE,
        FORM_FOLLOW_UP_ADD_PERSON_ROUTE,
        FORM_FOLLOW_UP_STOP_ROUTE,
      ]) {
        cases.push(["POST", `${prefix}${path}`, [ownPage, FormAPI.requireJsonBody]]);
      }

      cases.push([
        "GET",
        `${prefix}${FORM_MY_REQUESTS_ROUTE}`,
        [ownPage, FormAPI.requireFormPageHeader],
      ]);
    }

    it.each(cases)(
      "runs %s %s as own-page checks, limiter, anonymous user middleware, handler",
      (method: string, uri: string, checks: Array<RouterFunction>) => {
        const registered: RegisteredRoute = route(method, uri);

        expect(registered).toBeDefined();
        expect(registered.middlewares).toHaveLength(checks.length + 2);
        expect(registered.middlewares.slice(0, checks.length)).toEqual(checks);

        const limiter: RouterFunction = registered.middlewares[checks.length]!;

        expect(checks).not.toContain(limiter);
        expect(registered.middlewares[checks.length + 1]).toBe(
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
  });

  describe("reading a request", () => {
    it("hands the follow-up the form read through its link, and only the access the body names", async () => {
      (FormFollowUp.getRequest as unknown as MockedFn).mockResolvedValue({
        submissionId: "s",
      } as never);

      const { next } = await runHandler(
        "POST",
        `${LINK_PREFIX}${FORM_FOLLOW_UP_ROUTE}`,
        buildRequest({
          body: {
            access: {
              credential: CREDENTIAL,
              submissionId: "x".repeat(500),
              projectId: "anything",
            },
            projectId: "anything",
          },
        }),
      );

      expect(next).not.toHaveBeenCalled();
      expect(getFormForFollowUp).toHaveBeenCalledWith({
        shareKey: SHARE_KEY,
        clientIp: "203.0.113.7",
      });

      const call: Record<string, unknown> = (
        FormFollowUp.getRequest as unknown as MockedFn
      ).mock.calls[0]![0] as Record<string, unknown>;

      expect(call["form"]).toBe(FORM);
      expect(call["shareKey"]).toBe(SHARE_KEY);
      // Text past any sane length is left behind, and so is everything else.
      expect(call["access"]).toEqual({ credential: CREDENTIAL });
      expect(typeof call["formSession"]).toBe("function");
      expect(Response.sendJsonObjectResponse).toHaveBeenCalled();
    });

    it("on a form's own domain, finds the form by the domain the request came to", async () => {
      (FormFollowUp.getRequest as unknown as MockedFn).mockResolvedValue(
        {} as never,
      );

      await runHandler(
        "POST",
        `${DOMAIN_PREFIX}${FORM_FOLLOW_UP_ROUTE}`,
        buildRequest({
          body: { access: { credential: CREDENTIAL } },
          host: "report.acme.com",
        }),
      );

      expect(getShareKeyForCustomDomain).toHaveBeenCalledWith(
        "report.acme.com",
      );
      expect(getFormForFollowUp).toHaveBeenCalledWith({
        shareKey: SHARE_KEY,
        clientIp: "203.0.113.7",
      });
    });

    it.each([
      ["no body", undefined],
      ["a list", []],
      ["no access", {}],
      ["an access that is not an object", { access: "credential" }],
    ])(
      "refuses a body with %s before anything is read",
      async (_name: string, body: unknown) => {
        const { next } = await runHandler(
          "POST",
          `${LINK_PREFIX}${FORM_FOLLOW_UP_ROUTE}`,
          buildRequest({ body }),
        );

        const error: Exception = nextError(next);

        expect(error).toBeInstanceOf(BadDataException);
        expect(error.message).toBe(FORM_FOLLOW_UP_BODY_MESSAGE);
        expect(FormFollowUp.getRequest).not.toHaveBeenCalled();
      },
    );
  });

  describe("writing to the team", () => {
    it("hands the follow-up the reply box's answers", async () => {
      (FormFollowUp.reply as unknown as MockedFn).mockResolvedValue({} as never);

      await runHandler(
        "POST",
        `${LINK_PREFIX}${FORM_FOLLOW_UP_REPLY_ROUTE}`,
        buildRequest({
          body: {
            access: { credential: CREDENTIAL },
            answers: { message: "Still broken" },
          },
        }),
      );

      const call: Record<string, unknown> = (
        FormFollowUp.reply as unknown as MockedFn
      ).mock.calls[0]![0] as Record<string, unknown>;

      expect(call["answers"]).toEqual({ message: "Still broken" });
      expect(call["access"]).toEqual({ credential: CREDENTIAL });
    });
  });

  describe("adding somebody", () => {
    it("asks the public message limiter about the address before anybody is added", async () => {
      const order: Array<string> = [];

      const ask: MockedFn = jest
        .spyOn(PublicMessageRateLimit, "assertMaySend")
        .mockImplementation((async () => {
          order.push("ask");
          return { giveBack: jest.fn() };
        }) as never) as unknown as MockedFn;

      (FormFollowUp.addPerson as unknown as MockedFn).mockImplementation(
        (async () => {
          order.push("add");
          return {};
        }) as never,
      );

      const { next } = await runHandler(
        "POST",
        `${LINK_PREFIX}${FORM_FOLLOW_UP_ADD_PERSON_ROUTE}`,
        buildRequest({
          body: {
            access: { credential: CREDENTIAL },
            email: " Bob@Example.com ",
            name: "Bob",
          },
        }),
      );

      expect(next).not.toHaveBeenCalled();
      expect(order).toEqual(["ask", "add"]);

      const asked: Record<string, unknown> = ask.mock.calls[0]![0] as Record<
        string,
        unknown
      >;

      expect(asked["kind"]).toBe(PublicMessageKind.FormFollowUpInvite);
      expect(asked["contacts"]).toEqual([
        PublicMessageRateLimit.forEmail("bob@example.com"),
      ]);

      const added: Record<string, unknown> = (
        FormFollowUp.addPerson as unknown as MockedFn
      ).mock.calls[0]![0] as Record<string, unknown>;

      expect(added["email"]).toBe("bob@example.com");
      expect(added["name"]).toBe("Bob");
    });

    it("gives the address its count back when nobody was added", async () => {
      const giveBack: MockedFn = jest.fn();

      jest
        .spyOn(PublicMessageRateLimit, "assertMaySend")
        .mockResolvedValue({ giveBack } as never);

      (FormFollowUp.addPerson as unknown as MockedFn).mockRejectedValue(
        new BadDataException("That person is already following this request.") as never,
      );

      const { next } = await runHandler(
        "POST",
        `${LINK_PREFIX}${FORM_FOLLOW_UP_ADD_PERSON_ROUTE}`,
        buildRequest({
          body: {
            access: { credential: CREDENTIAL },
            email: "bob@example.com",
          },
        }),
      );

      expect(giveBack).toHaveBeenCalledTimes(1);
      expect(nextError(next)).toBeInstanceOf(BadDataException);
    });

    it("refuses an address that is not one, before it is counted or anybody is read", async () => {
      const ask: MockedFn = jest.spyOn(
        PublicMessageRateLimit,
        "assertMaySend",
      ) as unknown as MockedFn;

      const { next } = await runHandler(
        "POST",
        `${LINK_PREFIX}${FORM_FOLLOW_UP_ADD_PERSON_ROUTE}`,
        buildRequest({
          body: {
            access: { credential: CREDENTIAL },
            email: "Bob <bob@example.com>",
          },
        }),
      );

      expect(nextError(next).message).toBe(FORM_FOLLOW_UP_EMAIL_MESSAGE);
      expect(ask).not.toHaveBeenCalled();
      expect(getFormForFollowUp).not.toHaveBeenCalled();
      expect(FormFollowUp.addPerson).not.toHaveBeenCalled();
    });
  });

  describe("stopping, and My requests", () => {
    it("stops following, and answers with nothing", async () => {
      (FormFollowUp.stopFollowing as unknown as MockedFn).mockResolvedValue(
        undefined as never,
      );

      await runHandler(
        "POST",
        `${LINK_PREFIX}${FORM_FOLLOW_UP_STOP_ROUTE}`,
        buildRequest({ body: { access: { credential: CREDENTIAL } } }),
      );

      expect(FormFollowUp.stopFollowing).toHaveBeenCalledTimes(1);
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalled();
    });

    it("lists My requests with the form and the session alone", async () => {
      (FormFollowUp.getMyRequests as unknown as MockedFn).mockResolvedValue({
        requests: [],
      } as never);

      await runHandler(
        "GET",
        `${LINK_PREFIX}${FORM_MY_REQUESTS_ROUTE}`,
        buildRequest({}),
      );

      const call: Record<string, unknown> = (
        FormFollowUp.getMyRequests as unknown as MockedFn
      ).mock.calls[0]![0] as Record<string, unknown>;

      expect(Object.keys(call).sort()).toEqual(
        ["form", "formSession", "shareKey"].sort(),
      );
    });
  });

  describe("reading a body", () => {
    it("keeps a credential and a submission id of a sane length, and nothing else", () => {
      expect(
        FormAPI.readFollowUpAccess({
          access: { credential: CREDENTIAL, submissionId: "s-1", other: 1 },
        }),
      ).toEqual({ credential: CREDENTIAL, submissionId: "s-1" });

      expect(
        FormAPI.readFollowUpAccess({
          access: { credential: 42, submissionId: ["x"] },
        }),
      ).toEqual({});
    });
  });
});
