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
 * A form submission's follow-up on the page of the record it created
 * (Server/API/FormFollowUpRecordAPI): every route behind the signed-in user
 * middleware; the writes refused while Forms or the record's product is
 * switched off, and for a caller who is not a signed-in member of the
 * project; the record named in the path checked before anything is read,
 * and the caller's own props handed on, so the record's rules decide.
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

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Form/FormFollowUp", () => {
  return {
    __esModule: true,
    default: {
      getForRecord: jest.fn(),
      replyFromRecord: jest.fn(),
      addPersonFromRecord: jest.fn(),
      removePersonFromRecord: jest.fn(),
    },
  };
});

jest.mock("../../../Server/API/CommonAPI", () => {
  return {
    __esModule: true,
    default: {
      getDatabaseCommonInteractionProps: jest.fn(),
      assertTenantScoped: jest.fn(),
      assertAuthenticatedProjectMember: jest.fn(),
    },
  };
});

import "../../../Server/API/FormFollowUpRecordAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import FormFollowUp from "../../../Server/Utils/Form/FormFollowUp";
import ProductsOfRequest from "../../../Server/Utils/ServerProducts/ProductsOfRequest";
import Response from "../../../Server/Utils/Response";
import ServerProductRoutes from "../../../Server/Utils/ServerProducts/ServerProductRoutes";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { FORM_FOLLOW_UP_RECORD_ROUTE } from "../../../Types/Form/FormFollowUp";
import FormTargetType from "../../../Types/Form/FormTargetType";
import ProductKey from "../../../Types/Product/ProductKey";
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

const BASE: string = `${FORM_FOLLOW_UP_RECORD_ROUTE}/:recordType/:recordId`;
const RECORD_ID: string = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const FOLLOWER_ID: string = "9a2504e0-4f89-41d3-9a0c-0305e82c3302";
const PROPS: Record<string, unknown> = { userId: "u", tenantId: "p" };

// The routes as registered once, at import; kept apart from later tests.
const ROUTES: Array<RegisteredRoute> = [
  ...(mockRouter.routes as unknown as Array<RegisteredRoute>),
];

const route: (method: string, uri: string) => RegisteredRoute = (
  method: string,
  uri: string,
): RegisteredRoute => {
  const found: RegisteredRoute | undefined = ROUTES.find(
    (registered: RegisteredRoute): boolean => {
      return registered.method === method && registered.uri === uri;
    },
  );

  if (!found) {
    throw new Error(`No ${method} ${uri}`);
  }

  return found;
};

const run: (data: {
  method: string;
  uri: string;
  params: Record<string, string>;
  body?: unknown;
}) => Promise<MockedFn> = async (data: {
  method: string;
  uri: string;
  params: Record<string, string>;
  body?: unknown;
}): Promise<MockedFn> => {
  const next: MockedFn = jest.fn();

  await route(data.method, data.uri).handlerFunction(
    { params: data.params, body: data.body } as unknown as ExpressRequest,
    {} as unknown as ExpressResponse,
    next as unknown as NextFunction,
  );

  return next;
};

describe("FormFollowUpRecordAPI", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (
      CommonAPI.getDatabaseCommonInteractionProps as unknown as MockedFn
    ).mockResolvedValue(PROPS as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("registers the read and the three writes", () => {
    expect(
      ROUTES.map((registered: RegisteredRoute): string => {
        return `${registered.method} ${registered.uri}`;
      }).sort(),
    ).toEqual(
      [
        `GET ${BASE}`,
        `POST ${BASE}/reply`,
        `POST ${BASE}/people`,
        `POST ${BASE}/people/:followerId/remove`,
      ].sort(),
    );
  });

  it("reads behind the signed-in user middleware, and nothing else", () => {
    expect(route("GET", BASE).middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
    ]);
  });

  it.each([
    [`${BASE}/reply`],
    [`${BASE}/people`],
    [`${BASE}/people/:followerId/remove`],
  ])(
    "refuses %s while Forms or the record's product is switched off",
    (uri: string) => {
      const middlewares: Array<RouterFunction> = route("POST", uri).middlewares;

      expect(middlewares.slice(0, 2)).toEqual([
        UserMiddleware.getUserMiddleware,
        UserMiddleware.requireUserAuthentication,
      ]);
      expect(middlewares).toHaveLength(3);
      expect(ServerProductRoutes.isRefusal(middlewares[2])).toBe(true);
    },
  );

  it("names Forms and the record's product for every record type", () => {
    expect(
      ProductsOfRequest.formFollowUpRecord({
        body: {},
        params: { recordType: FormTargetType.Incident },
      } as never),
    ).toEqual([ProductKey.Forms, ProductKey.Incidents]);
    expect(
      ProductsOfRequest.formFollowUpRecord({
        body: {},
        params: { recordType: FormTargetType.Alert },
      } as never),
    ).toEqual([ProductKey.Forms, ProductKey.Alerts]);
    expect(
      ProductsOfRequest.formFollowUpRecord({
        body: {},
        params: { recordType: FormTargetType.ScheduledMaintenance },
      } as never),
    ).toEqual([ProductKey.Forms, ProductKey.ScheduledMaintenance]);
    expect(
      ProductsOfRequest.formFollowUpRecord({
        body: {},
        params: { recordType: "Monitor" },
      } as never),
    ).toEqual([ProductKey.Forms]);
  });

  it("hands the follow-up the record and the caller's own props", async () => {
    (FormFollowUp.getForRecord as unknown as MockedFn).mockResolvedValue(
      {} as never,
    );

    const next: MockedFn = await run({
      method: "GET",
      uri: BASE,
      params: { recordType: FormTargetType.Alert, recordId: RECORD_ID },
    });

    expect(next).not.toHaveBeenCalled();
    expect(CommonAPI.assertTenantScoped).toHaveBeenCalledWith(PROPS);

    const call: Record<string, unknown> = (
      FormFollowUp.getForRecord as unknown as MockedFn
    ).mock.calls[0]![0] as Record<string, unknown>;

    expect(call["recordType"]).toBe(FormTargetType.Alert);
    expect(String(call["recordId"])).toBe(RECORD_ID);
    expect(call["props"]).toBe(PROPS);
  });

  it("answers the view a record has, as it is", async () => {
    const view: Record<string, unknown> = {
      submissionId: "s",
      people: [],
      messages: [],
    };

    (FormFollowUp.getForRecord as unknown as MockedFn).mockResolvedValue(
      view as never,
    );

    await run({
      method: "GET",
      uri: BASE,
      params: { recordType: FormTargetType.Incident, recordId: RECORD_ID },
    });

    expect(
      (Response.sendJsonObjectResponse as unknown as MockedFn).mock
        .calls[0]![2],
    ).toBe(view);
    expect(Response.setNoCacheHeaders).toHaveBeenCalled();
  });

  it("answers an empty object, and no error, for a record no submission created", async () => {
    (FormFollowUp.getForRecord as unknown as MockedFn).mockResolvedValue(
      null as never,
    );

    const next: MockedFn = await run({
      method: "GET",
      uri: BASE,
      params: { recordType: FormTargetType.Incident, recordId: RECORD_ID },
    });

    expect(next).not.toHaveBeenCalled();
    expect(
      (Response.sendJsonObjectResponse as unknown as MockedFn).mock
        .calls[0]![2],
    ).toEqual({});
  });

  it.each([
    ["an unknown record type", { recordType: "Monitor", recordId: RECORD_ID }],
    ["a record id that is not one", { recordType: "Incident", recordId: "x" }],
  ])(
    "refuses %s before anything is read",
    async (_name: string, params: Record<string, string>) => {
      const next: MockedFn = await run({ method: "GET", uri: BASE, params });

      expect(next.mock.calls[0]![0]).toBeInstanceOf(BadDataException);
      expect(FormFollowUp.getForRecord).not.toHaveBeenCalled();
    },
  );

  it("a reply is written by a signed-in member of the project, with the message the body holds", async () => {
    (FormFollowUp.replyFromRecord as unknown as MockedFn).mockResolvedValue(
      {} as never,
    );

    await run({
      method: "POST",
      uri: `${BASE}/reply`,
      params: { recordType: FormTargetType.Incident, recordId: RECORD_ID },
      body: { message: "We found it", other: "ignored" },
    });

    expect(CommonAPI.assertAuthenticatedProjectMember).toHaveBeenCalledWith(
      PROPS,
    );

    const call: Record<string, unknown> = (
      FormFollowUp.replyFromRecord as unknown as MockedFn
    ).mock.calls[0]![0] as Record<string, unknown>;

    expect(call["message"]).toBe("We found it");
    expect(call["props"]).toBe(PROPS);
  });

  it("a write is refused to a caller who is not a signed-in member of the project", async () => {
    (
      CommonAPI.assertAuthenticatedProjectMember as unknown as MockedFn
    ).mockImplementation(() => {
      throw new NotAuthorizedException("A person writes to strangers.");
    });

    const next: MockedFn = await run({
      method: "POST",
      uri: `${BASE}/people`,
      params: { recordType: FormTargetType.Incident, recordId: RECORD_ID },
      body: { email: "bob@example.com" },
    });

    expect(next.mock.calls[0]![0] as Exception).toBeInstanceOf(
      NotAuthorizedException,
    );
    expect(FormFollowUp.addPersonFromRecord).not.toHaveBeenCalled();
  });

  it("removes the person the path names, once their id is checked", async () => {
    (
      CommonAPI.assertAuthenticatedProjectMember as unknown as MockedFn
    ).mockImplementation(() => {});
    (
      FormFollowUp.removePersonFromRecord as unknown as MockedFn
    ).mockResolvedValue({} as never);

    await run({
      method: "POST",
      uri: `${BASE}/people/:followerId/remove`,
      params: {
        recordType: FormTargetType.Incident,
        recordId: RECORD_ID,
        followerId: FOLLOWER_ID,
      },
    });

    const call: Record<string, unknown> = (
      FormFollowUp.removePersonFromRecord as unknown as MockedFn
    ).mock.calls[0]![0] as Record<string, unknown>;

    expect(String(call["followerId"])).toBe(FOLLOWER_ID);

    const refused: MockedFn = await run({
      method: "POST",
      uri: `${BASE}/people/:followerId/remove`,
      params: {
        recordType: FormTargetType.Incident,
        recordId: RECORD_ID,
        followerId: "not-an-id",
      },
    });

    expect(refused.mock.calls[0]![0]).toBeInstanceOf(BadDataException);
  });
});
