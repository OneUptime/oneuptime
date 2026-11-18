import { mockRouter } from "./Helpers";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

import CommonAPI from "../../../Server/API/CommonAPI";
import ProductFeedbackAPI, {
  PRODUCT_FEEDBACK_ANSWER_NOT_FOUND_MESSAGE,
  PRODUCT_FEEDBACK_OFF_MESSAGE,
  PRODUCT_FEEDBACK_TOO_MANY_MESSAGE,
} from "../../../Server/API/ProductFeedbackAPI";
import MasterAdminAuthorization from "../../../Server/Middleware/MasterAdminAuthorization";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import ProductFeedbackService from "../../../Server/Services/ProductFeedbackService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import GiveFeedbackEmail, {
  GiveFeedbackDelivery,
} from "../../../Server/Utils/GiveFeedbackEmail";
import ProductFeedbackRateLimit from "../../../Server/Utils/ProductFeedbackRateLimit";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  FeedbackQuestionDecision,
  GiveFeedbackCategory,
  GiveFeedbackDestination,
  ONEUPTIME_SUPPORT_EMAIL,
  PRODUCT_FEEDBACK_ADMIN_ANSWER_ROUTE,
  PRODUCT_FEEDBACK_ADMIN_LIST_ROUTE,
  PRODUCT_FEEDBACK_ADMIN_SUMMARY_ROUTE,
  PRODUCT_FEEDBACK_ASK_ROUTE,
  PRODUCT_FEEDBACK_DETAILS_ROUTE,
  PRODUCT_FEEDBACK_LIST_MAX_PAGE_SIZE,
  PRODUCT_FEEDBACK_LIST_PAGE_SIZE,
  PRODUCT_FEEDBACK_ROUTE,
  PRODUCT_FEEDBACK_SETTINGS_ROUTE,
  PRODUCT_FEEDBACK_SUBMISSION_FIELDS,
  ProductFeedbackKind,
} from "../../../Types/ProductFeedback/ProductFeedback";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Asking people, over HTTP (issue #6832), through the real handlers and
 * guards with the service answered here: who may ask and answer, that the
 * server's switch refuses answers, that an answer keeps only its own
 * fields, that one person cannot flood the table, and that only master
 * admins read what people said.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const ANSWER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

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

function memberProps(
  overrides?: Partial<DatabaseCommonInteractionProps>,
): DatabaseCommonInteractionProps {
  const tenant: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: [
      {
        _type: "UserPermission",
        permission: Permission.ProjectMember,
        labelIds: [],
      } as UserPermission,
    ],
  };

  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    userTenantAccessPermission: { [PROJECT_ID.toString()]: tenant },
    ...overrides,
  };
}

function routeFor(method: string, uri: string): RegisteredRoute {
  const route: RegisteredRoute | undefined = (
    mockRouter.routes as unknown as Array<RegisteredRoute>
  ).find((candidate: RegisteredRoute): boolean => {
    return candidate.method === method && candidate.uri === uri;
  });

  if (!route) {
    throw new Error(`No ${method} route for ${uri}`);
  }

  return route;
}

let props: DatabaseCommonInteractionProps;
let isServerOn: jest.SpyInstance;
let getSettings: jest.SpyInstance;
let ask: jest.SpyInstance;
let submit: jest.SpyInstance;
let addDetails: jest.SpyInstance;
let getAdminSummary: jest.SpyInstance;
let getAdminList: jest.SpyInstance;
let deleteAnswer: jest.SpyInstance;
let sendJson: jest.SpyInstance;
let takeAnswer: jest.SpyInstance;
let prepareEmail: jest.SpyInstance;
let sendEmail: jest.SpyInstance;
// The order the handler answered the Dashboard and sent the email in.
let events: Array<string> = [];

// What prepare() decides for Give feedback emailed on OneUptime Cloud.
const DELIVERY: GiveFeedbackDelivery = {
  to: ONEUPTIME_SUPPORT_EMAIL,
  destination: GiveFeedbackDestination.OneUptimeTeam,
  projectId: PROJECT_ID,
  email: {
    category: GiveFeedbackCategory.Broken,
    details: "The SLO page shows no budget.",
    page: "/dashboard/:projectId/slos",
    version: "14.3.0",
    person: {
      name: "Ada Lovelace",
      email: "ada@example.com",
      isEmailVerified: true,
    },
    project: null,
  },
};

beforeEach(() => {
  props = memberProps();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return props;
    });

  isServerOn = jest
    .spyOn(ProductFeedbackService, "isServerOn")
    .mockResolvedValue(true);
  getSettings = jest
    .spyOn(ProductFeedbackService, "getSettings")
    .mockResolvedValue({ isOn: true, isAskingMe: false });
  ask = jest
    .spyOn(ProductFeedbackService, "ask")
    .mockResolvedValue(FeedbackQuestionDecision.Ask);
  submit = jest
    .spyOn(ProductFeedbackService, "submit")
    .mockResolvedValue(ANSWER_ID);
  addDetails = jest
    .spyOn(ProductFeedbackService, "addDetails")
    .mockResolvedValue(true);
  getAdminSummary = jest
    .spyOn(ProductFeedbackService, "getAdminSummary")
    .mockResolvedValue({
      sinceDays: 90,
      topics: [],
      askAi: { helpful: 1, notHelpful: 2, ratedDown: null },
    });
  getAdminList = jest
    .spyOn(ProductFeedbackService, "getAdminList")
    .mockResolvedValue({ items: [], count: 0 });
  deleteAnswer = jest
    .spyOn(ProductFeedbackService, "deleteAnswer")
    .mockResolvedValue(true);
  takeAnswer = jest
    .spyOn(ProductFeedbackRateLimit, "take")
    .mockReturnValue(true);
  sendJson = jest
    .spyOn(Response, "sendJsonObjectResponse")
    .mockImplementation((() => {
      events.push("answered");
    }) as never);
  events = [];
  prepareEmail = jest
    .spyOn(GiveFeedbackEmail, "prepare")
    .mockResolvedValue(null);
  sendEmail = jest
    .spyOn(GiveFeedbackEmail, "send")
    .mockImplementation(async (): Promise<void> => {
      events.push("emailed");
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function call(
  method: string,
  uri: string,
  body?: unknown,
  query?: Record<string, string>,
  params?: Record<string, string>,
): Promise<unknown> {
  const next: jest.Mock = jest.fn();

  await routeFor(method, uri).handlerFunction(
    {
      query: query || {},
      params: params || {},
      headers: {},
      body: body,
    } as never,
    {} as never,
    next as unknown as NextFunction,
  );

  return next.mock.calls[0]?.[0];
}

const answered: () => JSONObject = (): JSONObject => {
  return sendJson.mock.calls[0]![2] as JSONObject;
};

describe("the routes", () => {
  test("one bare router: a person's four behind the user middleware, the admins' three behind the master-admin one", () => {
    expect(ProductFeedbackAPI).toBe(mockRouter);

    expect(
      routeFor("GET", PRODUCT_FEEDBACK_SETTINGS_ROUTE).middlewares,
    ).toEqual([UserMiddleware.getUserMiddleware]);

    for (const uri of [
      PRODUCT_FEEDBACK_ASK_ROUTE,
      PRODUCT_FEEDBACK_ROUTE,
      PRODUCT_FEEDBACK_DETAILS_ROUTE,
    ]) {
      expect(routeFor("POST", uri).middlewares).toEqual([
        UserMiddleware.getUserMiddleware,
      ]);
    }

    for (const uri of [
      PRODUCT_FEEDBACK_ADMIN_SUMMARY_ROUTE,
      PRODUCT_FEEDBACK_ADMIN_LIST_ROUTE,
    ]) {
      expect(routeFor("GET", uri).middlewares).toEqual([
        MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      ]);
    }

    // Deleting an answer is a master admin's, alone (#7366).
    expect(
      routeFor("DELETE", `${PRODUCT_FEEDBACK_ADMIN_ANSWER_ROUTE}/:answerId`)
        .middlewares,
    ).toEqual([MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware]);
  });
});

describe("GET /product-feedback/settings", () => {
  test("a signed-in person reads whether the server asks, and whether it asks them - nothing more", async () => {
    expect(await call("GET", PRODUCT_FEEDBACK_SETTINGS_ROUTE)).toBeUndefined();

    expect(getSettings).toHaveBeenCalledWith(USER_ID);
    expect(answered()).toEqual({ isOn: true, isAskingMe: false });
  });

  test("and where Give feedback goes, for the dialog to say before it is sent", async () => {
    getSettings.mockResolvedValue({
      isOn: true,
      isAskingMe: true,
      giveFeedbackGoesTo: GiveFeedbackDestination.ServerAdminsByEmail,
    });

    await call("GET", PRODUCT_FEEDBACK_SETTINGS_ROUTE);

    expect(answered()).toEqual({
      isOn: true,
      isAskingMe: true,
      giveFeedbackGoesTo: GiveFeedbackDestination.ServerAdminsByEmail,
    });
    // Where it goes, never the admins' address.
    expect(JSON.stringify(answered())).not.toContain("@");
  });

  test("an expired session is a 401, so the browser refreshes it and asks again", async () => {
    props = { userType: UserType.Public } as DatabaseCommonInteractionProps;

    expect(await call("GET", PRODUCT_FEEDBACK_SETTINGS_ROUTE)).toBeInstanceOf(
      NotAuthenticatedException,
    );
    expect(getSettings).not.toHaveBeenCalled();
  });

  test("an API key is not a person, and is refused", async () => {
    props = {
      tenantId: PROJECT_ID,
      userType: UserType.API,
    } as DatabaseCommonInteractionProps;

    expect(await call("GET", PRODUCT_FEEDBACK_SETTINGS_ROUTE)).toBeInstanceOf(
      NotAuthorizedException,
    );
  });

  test("no project is needed: the switches are the server's and the person's", async () => {
    props = memberProps({ tenantId: undefined });

    expect(await call("GET", PRODUCT_FEEDBACK_SETTINGS_ROUTE)).toBeUndefined();
    expect(getSettings).toHaveBeenCalledWith(USER_ID);
  });
});

describe("POST /product-feedback/ask", () => {
  test("asks the service about the question, with the member's project for its incidents", async () => {
    expect(
      await call("POST", PRODUCT_FEEDBACK_ASK_ROUTE, {
        question: "setup_flow:website_down",
      }),
    ).toBeUndefined();

    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0]![0]).toMatchObject({
      userId: USER_ID,
      projectId: PROJECT_ID,
      key: "setup_flow:website_down",
    });
    expect(answered()).toEqual({ ask: true, reason: "ask" });
  });

  test("a project the person is not a member of is no project", async () => {
    props = memberProps({ tenantId: OTHER_PROJECT_ID });

    await call("POST", PRODUCT_FEEDBACK_ASK_ROUTE, {
      question: "check_in:abc",
    });

    expect(ask.mock.calls[0]![0]).toMatchObject({ projectId: null });
  });

  test("a no carries why", async () => {
    ask.mockResolvedValue(FeedbackQuestionDecision.AskedRecently);

    await call("POST", PRODUCT_FEEDBACK_ASK_ROUTE, {
      question: "setup_flow:on_call",
    });

    expect(answered()).toEqual({ ask: false, reason: "asked_recently" });
  });

  test("only the questions OneUptime asks may be asked about", async () => {
    for (const question of [
      undefined,
      "general:help",
      "explanation:how_oneuptime_works",
      "setup_flow:Website Down",
      42,
    ]) {
      expect(
        await call("POST", PRODUCT_FEEDBACK_ASK_ROUTE, { question: question }),
      ).toBeInstanceOf(BadDataException);
    }

    expect(ask).not.toHaveBeenCalled();
  });

  test("an expired session is a 401", async () => {
    props = { userType: UserType.Public } as DatabaseCommonInteractionProps;

    expect(
      await call("POST", PRODUCT_FEEDBACK_ASK_ROUTE, {
        question: "setup_flow:website_down",
      }),
    ).toBeInstanceOf(NotAuthenticatedException);
  });
});

describe("POST /product-feedback", () => {
  test("keeps an answer with only its own fields: no person, project or address, the page scrubbed", async () => {
    expect(
      await call("POST", PRODUCT_FEEDBACK_ROUTE, {
        kind: "setup_flow",
        topic: "website_down",
        score: 2,
        details: "The test page never arrived.",
        page: "/dashboard/11111111-1111-4111-8111-111111111111/monitors/setup?step=2",
        version: "14.0.108",
        userId: USER_ID.toString(),
        projectId: PROJECT_ID.toString(),
        email: "ada@example.com",
        url: "https://oneuptime.example/dashboard/11111111-1111-4111-8111-111111111111",
      }),
    ).toBeUndefined();

    expect(submit).toHaveBeenCalledTimes(1);

    const kept: JSONObject = submit.mock.calls[0]![0] as JSONObject;

    expect(Object.keys(kept).sort()).toEqual(
      [...PRODUCT_FEEDBACK_SUBMISSION_FIELDS].sort(),
    );
    expect(kept).toEqual({
      kind: ProductFeedbackKind.SetupFlow,
      topic: "website_down",
      score: 2,
      isPositive: null,
      details: "The test page never arrived.",
      page: "/dashboard/:id/monitors/setup",
      version: "14.0.108",
    });
    expect(JSON.stringify(kept)).not.toContain(USER_ID.toString());
    expect(JSON.stringify(kept)).not.toContain(PROJECT_ID.toString());
    expect(answered()).toEqual({ answerId: ANSWER_ID.toString() });
  });

  test("refused while a master admin has switched feedback off, and nothing is kept", async () => {
    isServerOn.mockResolvedValue(false);

    const refusal: unknown = await call("POST", PRODUCT_FEEDBACK_ROUTE, {
      kind: "general",
      details: "Hard to find the importer.",
    });

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect((refusal as Error).message).toBe(PRODUCT_FEEDBACK_OFF_MESSAGE);
    expect(submit).not.toHaveBeenCalled();
  });

  test("something that is not an answer is a 400 that says what to send, and nothing is kept", async () => {
    const refusal: unknown = await call("POST", PRODUCT_FEEDBACK_ROUTE, {
      kind: "general",
      details: "",
    });

    expect(refusal).toBeInstanceOf(BadDataException);
    expect((refusal as Error).message).toBe(
      "Write what you want to tell us, then send it again.",
    );
    expect(submit).not.toHaveBeenCalled();
    expect(prepareEmail).not.toHaveBeenCalled();
  });

  test("one person cannot fill the table: past the hour's limit the answer is refused", async () => {
    takeAnswer.mockReturnValue(false);

    const refusal: unknown = await call("POST", PRODUCT_FEEDBACK_ROUTE, {
      kind: "general",
      details: "Again.",
    });

    expect(refusal).toBeInstanceOf(BadDataException);
    expect((refusal as Error).message).toBe(PRODUCT_FEEDBACK_TOO_MANY_MESSAGE);
    expect(takeAnswer.mock.calls[0]![0]).toBe(USER_ID.toString());
    expect(submit).not.toHaveBeenCalled();
  });

  test("an expired session is a 401, and an API key cannot give feedback", async () => {
    props = { userType: UserType.Public } as DatabaseCommonInteractionProps;

    expect(
      await call("POST", PRODUCT_FEEDBACK_ROUTE, {
        kind: "general",
        details: "x",
      }),
    ).toBeInstanceOf(NotAuthenticatedException);

    props = {
      tenantId: PROJECT_ID,
      userType: UserType.API,
    } as DatabaseCommonInteractionProps;

    expect(
      await call("POST", PRODUCT_FEEDBACK_ROUTE, {
        kind: "general",
        details: "x",
      }),
    ).toBeInstanceOf(NotAuthorizedException);
    expect(submit).not.toHaveBeenCalled();
  });
});

describe("Give feedback, emailed to the team that reads it (#8893)", () => {
  const giveFeedback: () => Promise<unknown> = (): Promise<unknown> => {
    return call("POST", PRODUCT_FEEDBACK_ROUTE, {
      kind: "general",
      topic: "broken",
      details: "The SLO page shows no budget.",
      page: "/dashboard/11111111-1111-4111-8111-111111111111/slos",
      version: "14.3.0",
    });
  };

  test("is kept first, then the Dashboard is told it is emailed and where the copy goes, and only then is it sent", async () => {
    prepareEmail.mockResolvedValue(DELIVERY);

    expect(await giveFeedback()).toBeUndefined();

    expect(submit).toHaveBeenCalledTimes(1);
    expect(answered()).toEqual({
      answerId: ANSWER_ID.toString(),
      isEmailed: true,
      copyTo: "ada@example.com",
    });
    expect(sendEmail).toHaveBeenCalledWith(DELIVERY);
    // The answer does not wait for the mail server.
    expect(events).toEqual(["answered", "emailed"]);
    expect(submit.mock.invocationCallOrder[0]!).toBeLessThan(
      prepareEmail.mock.invocationCallOrder[0]!,
    );
  });

  test("is asked about with what was kept, the person, and the project they are a member of", async () => {
    await giveFeedback();

    expect(prepareEmail).toHaveBeenCalledTimes(1);
    expect(prepareEmail.mock.calls[0]![0]).toMatchObject({
      userId: USER_ID,
      projectId: PROJECT_ID,
      submission: {
        kind: ProductFeedbackKind.General,
        topic: GiveFeedbackCategory.Broken,
        details: "The SLO page shows no budget.",
        page: "/dashboard/:id/slos",
        version: "14.3.0",
      },
    });
  });

  test("a project the person is not a member of is never named in it", async () => {
    props = memberProps({ tenantId: OTHER_PROJECT_ID });

    await giveFeedback();

    expect(prepareEmail.mock.calls[0]![0]).toMatchObject({ projectId: null });
  });

  test("where it is not emailed - a self-hosted server with no admin address, the hour's emails used - the Dashboard is told so, and nothing is sent", async () => {
    prepareEmail.mockResolvedValue(null);

    expect(await giveFeedback()).toBeUndefined();

    expect(answered()).toEqual({
      answerId: ANSWER_ID.toString(),
      isEmailed: false,
      copyTo: null,
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test("an address the person never proved is no copy", async () => {
    prepareEmail.mockResolvedValue({
      ...DELIVERY,
      email: {
        ...DELIVERY.email,
        person: { ...DELIVERY.email.person, isEmailVerified: false },
      },
    });

    await giveFeedback();

    expect(answered()).toEqual({
      answerId: ANSWER_ID.toString(),
      isEmailed: true,
      copyTo: null,
    });
  });

  test("an answer to a question OneUptime asks is never emailed", async () => {
    for (const body of [
      { kind: "setup_flow", topic: "website_down", score: 2 },
      { kind: "explanation", topic: "how_oneuptime_works", isPositive: true },
      { kind: "check_in", isPositive: false, details: "Paging." },
    ]) {
      await call("POST", PRODUCT_FEEDBACK_ROUTE, body);
    }

    expect(prepareEmail).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();

    for (const call of sendJson.mock.calls) {
      expect(Object.keys(call[2] as JSONObject)).toEqual(["answerId"]);
    }
  });

  test("nothing is emailed for feedback that was refused", async () => {
    isServerOn.mockResolvedValue(false);
    await giveFeedback();

    isServerOn.mockResolvedValue(true);
    takeAnswer.mockReturnValue(false);
    await giveFeedback();

    expect(prepareEmail).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("POST /product-feedback/details", () => {
  test("adds the words to the answer the person was given", async () => {
    expect(
      await call("POST", PRODUCT_FEEDBACK_DETAILS_ROUTE, {
        answerId: ANSWER_ID.toString(),
        details: "  The phone step was confusing.  ",
      }),
    ).toBeUndefined();

    expect(addDetails.mock.calls[0]![0]).toMatchObject({
      answerId: ANSWER_ID,
      details: "The phone step was confusing.",
    });
    expect(answered()).toEqual({ added: true });
  });

  test("an id that is not one, or no words, is a 400", async () => {
    expect(
      await call("POST", PRODUCT_FEEDBACK_DETAILS_ROUTE, {
        answerId: "not-an-id",
        details: "words",
      }),
    ).toBeInstanceOf(BadDataException);
    expect(
      await call("POST", PRODUCT_FEEDBACK_DETAILS_ROUTE, {
        answerId: ANSWER_ID.toString(),
        details: "   ",
      }),
    ).toBeInstanceOf(BadDataException);
    expect(addDetails).not.toHaveBeenCalled();
  });

  test("refused while feedback is off", async () => {
    isServerOn.mockResolvedValue(false);

    expect(
      await call("POST", PRODUCT_FEEDBACK_DETAILS_ROUTE, {
        answerId: ANSWER_ID.toString(),
        details: "words",
      }),
    ).toBeInstanceOf(NotAuthorizedException);
    expect(addDetails).not.toHaveBeenCalled();
  });
});

describe("the master admins' reads", () => {
  test("the summary is the service's", async () => {
    expect(
      await call("GET", PRODUCT_FEEDBACK_ADMIN_SUMMARY_ROUTE),
    ).toBeUndefined();
    expect(getAdminSummary).toHaveBeenCalledTimes(1);
    expect(answered()).toMatchObject({ sinceDays: 90 });
  });

  test("the list reads its kind, skip and limit, and holds the limit to its range", async () => {
    await call("GET", PRODUCT_FEEDBACK_ADMIN_LIST_ROUTE, undefined, {
      kind: "setup_flow",
      skip: "25",
      limit: "1000",
    });

    expect(getAdminList.mock.calls[0]![0]).toEqual({
      kind: ProductFeedbackKind.SetupFlow,
      skip: 25,
      limit: PRODUCT_FEEDBACK_LIST_MAX_PAGE_SIZE,
    });

    await call("GET", PRODUCT_FEEDBACK_ADMIN_LIST_ROUTE);

    expect(getAdminList.mock.calls[1]![0]).toEqual({
      kind: null,
      skip: 0,
      limit: PRODUCT_FEEDBACK_LIST_PAGE_SIZE,
    });
  });

  test("a kind or a number that is not one is a 400", async () => {
    expect(
      await call("GET", PRODUCT_FEEDBACK_ADMIN_LIST_ROUTE, undefined, {
        kind: "nps",
      }),
    ).toBeInstanceOf(BadDataException);
    expect(
      await call("GET", PRODUCT_FEEDBACK_ADMIN_LIST_ROUTE, undefined, {
        skip: "-1",
      }),
    ).toBeInstanceOf(BadDataException);
    expect(getAdminList).not.toHaveBeenCalled();
  });
});

describe("DELETE /product-feedback/admin/answer/:answerId (#7366)", () => {
  const DELETE_URI: string = `${PRODUCT_FEEDBACK_ADMIN_ANSWER_ROUTE}/:answerId`;

  test("deletes the answer named, and says so", async () => {
    expect(
      await call("DELETE", DELETE_URI, undefined, undefined, {
        answerId: ANSWER_ID.toString(),
      }),
    ).toBeUndefined();
    expect(deleteAnswer).toHaveBeenCalledTimes(1);
    expect((deleteAnswer.mock.calls[0]![0] as ObjectID).toString()).toBe(
      ANSWER_ID.toString(),
    );
    expect(answered()).toEqual({ deleted: true });
  });

  test("an answer already gone is a 404 that says so, never a pretended delete", async () => {
    deleteAnswer.mockResolvedValue(false);

    const error: unknown = await call(
      "DELETE",
      DELETE_URI,
      undefined,
      undefined,
      {
        answerId: ANSWER_ID.toString(),
      },
    );

    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as Error).message).toBe(
      PRODUCT_FEEDBACK_ANSWER_NOT_FOUND_MESSAGE,
    );
    expect(sendJson).not.toHaveBeenCalled();
  });

  test("an id that is not one is a 400, and nothing is deleted", async () => {
    for (const answerId of ["", "not-an-id", "1; DROP TABLE"]) {
      expect(
        await call("DELETE", DELETE_URI, undefined, undefined, { answerId }),
      ).toBeInstanceOf(BadDataException);
    }
    expect(deleteAnswer).not.toHaveBeenCalled();
  });
});

describe("the list's kinds (#7209)", () => {
  test("a docs page's answers can be listed on their own", async () => {
    await call("GET", PRODUCT_FEEDBACK_ADMIN_LIST_ROUTE, undefined, {
      kind: "docs_page",
    });

    expect(getAdminList.mock.calls[0]![0]).toMatchObject({
      kind: ProductFeedbackKind.DocsPage,
    });
  });

  test("the Dashboard can never post a docs page's answer: only the docs keep those", async () => {
    const error: unknown = await call("POST", PRODUCT_FEEDBACK_ROUTE, {
      kind: "docs_page",
      topic: "monitor/website-monitor",
      isPositive: false,
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).not.toContain("docs_page");
    expect(submit).not.toHaveBeenCalled();
  });
});
