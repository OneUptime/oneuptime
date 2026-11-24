import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Asking people, in the browser (issue #6832): the settings that decide
 * whether anything is asked or offered, the server deciding each question,
 * and what an answer is sent with - the answer, the page as a route with no
 * ids and the version, nothing else - and the event that carries the score
 * but never the words.
 */

const getMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const captureMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

/*
 * Whether this frontend is OneUptime Cloud's (BILLING_ENABLED): Common Test
 * runs with it on, a self-hosted server with it off. It is a const of
 * Common/UI/Config, read off the module where it is used, so a getter over
 * this lets a test say which frontend it is; null reads the environment's.
 */
let mockBillingEnabled: boolean | null = null;

jest.mock("../../../UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;
  const mockedConfig: Record<string, unknown> = { ...actualConfig };

  // Object.defineProperty: a getter in a spread literal is read only once.
  Object.defineProperty(mockedConfig, "BILLING_ENABLED", {
    get: (): boolean => {
      return mockBillingEnabled ?? (actualConfig["BILLING_ENABLED"] as boolean);
    },
  });

  return mockedConfig;
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<unknown>) => {
        return getMock(...args);
      },
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Analytics", () => {
  return {
    __esModule: true,
    default: {
      capture: (...args: Array<unknown>) => {
        return captureMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return { tenantid: "11111111-1111-4111-8111-111111111111" };
      },
      updateById: (...args: Array<unknown>) => {
        return updateByIdMock(...args);
      },
    },
  };
});

import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import { JSONObject } from "../../../Types/JSON";
import {
  GiveFeedbackCategory,
  GiveFeedbackDestination,
  PRODUCT_FEEDBACK_ASK_ROUTE,
  PRODUCT_FEEDBACK_DETAILS_ROUTE,
  PRODUCT_FEEDBACK_ROUTE,
  PRODUCT_FEEDBACK_SETTINGS_ROUTE,
  PRODUCT_FEEDBACK_SUBMISSION_FIELDS,
  ProductFeedbackKind,
} from "../../../Types/ProductFeedback/ProductFeedback";
import ProductFeedback from "../../../UI/Utils/ProductFeedback";
import User from "../../../Models/DatabaseModels/User";

const ok: (data: JSONObject) => HTTPResponse<JSONObject> = (
  data: JSONObject,
): HTTPResponse<JSONObject> => {
  return new HTTPResponse<JSONObject>(200, data, {});
};

const lastCall: (mock: MockFunction) => {
  url: { toString: () => string };
  data: JSONObject;
} = (
  mock: MockFunction,
): { url: { toString: () => string }; data: JSONObject } => {
  return mock.mock.calls[mock.mock.calls.length - 1]![0] as {
    url: { toString: () => string };
    data: JSONObject;
  };
};

beforeEach(() => {
  ProductFeedback.setSettings(null);
  ProductFeedback.setPageResolver(() => {
    return "/dashboard/:projectId/monitors/setup";
  });
});

afterEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  captureMock.mockReset();
  updateByIdMock.mockReset();
  mockBillingEnabled = null;
});

describe("the settings", () => {
  test("until they are read, nothing is asked and nothing is offered", () => {
    expect(ProductFeedback.getSettings()).toBeNull();
    expect(ProductFeedback.isOn()).toBe(false);
    expect(ProductFeedback.isAskingMe()).toBe(false);
  });

  test("read from the server: the server's switch and the person's", async () => {
    getMock.mockResolvedValue(ok({ isOn: true, isAskingMe: true }));

    await ProductFeedback.loadSettings();

    expect(lastCall(getMock).url.toString()).toContain(
      PRODUCT_FEEDBACK_SETTINGS_ROUTE,
    );
    expect(ProductFeedback.isOn()).toBe(true);
    expect(ProductFeedback.isAskingMe()).toBe(true);
  });

  test("a server that takes feedback but a person who said stop: offered, never asked", async () => {
    getMock.mockResolvedValue(ok({ isOn: true, isAskingMe: false }));

    await ProductFeedback.loadSettings();

    expect(ProductFeedback.isOn()).toBe(true);
    expect(ProductFeedback.isAskingMe()).toBe(false);
  });

  test("an error, a throw or an answer of another shape is off", async () => {
    getMock.mockResolvedValue(
      new HTTPErrorResponse(500, { message: "down" }, {}),
    );
    await ProductFeedback.loadSettings();
    expect(ProductFeedback.isOn()).toBe(false);

    getMock.mockRejectedValue(new Error("network"));
    await ProductFeedback.loadSettings();
    expect(ProductFeedback.isOn()).toBe(false);

    // What an endpoint over nothing answers (the journeys' fixture).
    getMock.mockResolvedValue(ok({ data: [], count: 0 } as JSONObject));
    await ProductFeedback.loadSettings();
    expect(ProductFeedback.getSettings()).toBeNull();
  });

  test("a change is told to every listener", () => {
    const listener: MockFunction = getJestMockFunction();
    const unsubscribe: () => void = ProductFeedback.subscribe(listener);

    ProductFeedback.setSettings({ isOn: true, isAskingMe: true });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    ProductFeedback.setSettings(null);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("asking a question", () => {
  test("never asks the server when this person is not asked", async () => {
    ProductFeedback.setSettings({ isOn: true, isAskingMe: false });

    expect(
      await ProductFeedback.ask({
        kind: ProductFeedbackKind.SetupFlow,
        topic: "website_down",
      }),
    ).toBe(false);
    expect(postMock).not.toHaveBeenCalled();
  });

  test("asks the server about the question by its key, with the project's header", async () => {
    ProductFeedback.setSettings({ isOn: true, isAskingMe: true });
    postMock.mockResolvedValue(ok({ ask: true, reason: "ask" }));

    expect(
      await ProductFeedback.ask({
        kind: ProductFeedbackKind.SetupFlow,
        topic: "website_down",
      }),
    ).toBe(true);

    const call: {
      url: { toString: () => string };
      data: JSONObject;
      headers?: JSONObject;
    } = postMock.mock.calls[0]![0] as never;

    expect(call.url.toString()).toContain(PRODUCT_FEEDBACK_ASK_ROUTE);
    expect(call.data).toEqual({ question: "setup_flow:website_down" });
    expect(call.headers).toEqual({
      tenantid: "11111111-1111-4111-8111-111111111111",
    });
  });

  test("the server's no, an error or a throw is no", async () => {
    ProductFeedback.setSettings({ isOn: true, isAskingMe: true });

    postMock.mockResolvedValue(ok({ ask: false, reason: "asked_recently" }));
    expect(
      await ProductFeedback.ask({
        kind: ProductFeedbackKind.CheckIn,
        topic: "abc",
      }),
    ).toBe(false);

    postMock.mockResolvedValue(new HTTPErrorResponse(500, {}, {}));
    expect(
      await ProductFeedback.ask({
        kind: ProductFeedbackKind.CheckIn,
        topic: "abc",
      }),
    ).toBe(false);

    postMock.mockRejectedValue(new Error("network"));
    expect(
      await ProductFeedback.ask({
        kind: ProductFeedbackKind.CheckIn,
        topic: "abc",
      }),
    ).toBe(false);
  });
});

describe("what an answer is sent with", () => {
  test("the answer, the page as a route with no ids and the version - nothing else", async () => {
    ProductFeedback.setSettings({ isOn: true, isAskingMe: true });
    postMock.mockResolvedValue(ok({ answerId: "answer-1" }));

    expect(
      await ProductFeedback.submit({
        kind: ProductFeedbackKind.SetupFlow,
        topic: "website_down",
        score: 2,
        details: "  The test page took a while.  ",
      }),
    ).toBe("answer-1");

    const call: { url: { toString: () => string }; data: JSONObject } =
      lastCall(postMock);

    expect(call.url.toString()).toContain(PRODUCT_FEEDBACK_ROUTE);
    expect(Object.keys(call.data).sort()).toEqual(
      [...PRODUCT_FEEDBACK_SUBMISSION_FIELDS].sort(),
    );
    expect(call.data).toEqual({
      kind: "setup_flow",
      topic: "website_down",
      score: 2,
      isPositive: null,
      details: "The test page took a while.",
      page: "/dashboard/:projectId/monitors/setup",
      version: ProductFeedback.getVersion(),
    });
  });

  test("a page resolver that hands back a full address is scrubbed before it is sent", async () => {
    ProductFeedback.setSettings({ isOn: true, isAskingMe: true });
    ProductFeedback.setPageResolver(() => {
      return "/dashboard/11111111-1111-4111-8111-111111111111/incidents/42?x=ada@example.com";
    });
    postMock.mockResolvedValue(ok({ answerId: "answer-2" }));

    await ProductFeedback.submit({
      kind: ProductFeedbackKind.General,
      topic: "help",
      details: "Where is the importer?",
    });

    expect(lastCall(postMock).data["page"]).toBe(
      "/dashboard/:id/incidents/:id",
    );
  });

  test("feedback/given carries the score, the kind and the page, never the words", async () => {
    ProductFeedback.setSettings({ isOn: true, isAskingMe: true });
    postMock.mockResolvedValue(ok({ answerId: "answer-3" }));

    await ProductFeedback.submit({
      kind: ProductFeedbackKind.SetupFlow,
      topic: "on_call",
      score: 1,
      details: "My phone number is 555-0100 and it never rang.",
    });

    const event: Array<unknown> | undefined = captureMock.mock.calls.find(
      (call: Array<unknown>): boolean => {
        return call[0] === ProductEventName.FeedbackGiven;
      },
    );

    expect(event).toBeDefined();

    const properties: JSONObject = event![1] as JSONObject;

    expect(properties).toMatchObject({
      kind: "setup_flow",
      topic: "on_call",
      score: 1,
      has_details: true,
    });
    expect(JSON.stringify(properties)).not.toContain("555-0100");
    expect(JSON.stringify(properties)).not.toContain("never rang");
  });

  test("nothing is sent while the server takes no feedback", async () => {
    ProductFeedback.setSettings({ isOn: false, isAskingMe: false });

    expect(
      await ProductFeedback.submit({
        kind: ProductFeedbackKind.General,
        topic: "help",
        details: "x",
      }),
    ).toBeNull();
    expect(postMock).not.toHaveBeenCalled();
    expect(captureMock).not.toHaveBeenCalled();
  });

  test("an answer the server refused is null, and no event says it was given", async () => {
    ProductFeedback.setSettings({ isOn: true, isAskingMe: true });
    postMock.mockResolvedValue(new HTTPErrorResponse(400, {}, {}));

    expect(
      await ProductFeedback.submit({
        kind: ProductFeedbackKind.General,
        topic: "help",
        details: "x",
      }),
    ).toBeNull();
    expect(captureMock).not.toHaveBeenCalled();
  });
});

describe("Give feedback (#8893)", () => {
  test("posts what it is about as its topic with the words, the page and the version - nothing else", async () => {
    ProductFeedback.setSettings({ isOn: true, isAskingMe: false });
    postMock.mockResolvedValue(
      ok({ answerId: "answer-9", isEmailed: true, copyTo: "jane@acme.test" }),
    );

    await ProductFeedback.giveFeedback({
      category: GiveFeedbackCategory.Idea,
      details: "  Let me copy an SLO.  ",
    });

    const call: { url: { toString: () => string }; data: JSONObject } =
      lastCall(postMock);

    expect(call.url.toString()).toContain(PRODUCT_FEEDBACK_ROUTE);
    expect(call.data).toEqual({
      kind: "general",
      topic: "idea",
      score: null,
      isPositive: null,
      details: "Let me copy an SLO.",
      page: "/dashboard/:projectId/monitors/setup",
      version: ProductFeedback.getVersion(),
    });
    // The server adds who sent it, from who is signed in: never the Dashboard.
    expect(JSON.stringify(call.data)).not.toContain("@");
  });

  test("answers with what the server did: whether it is emailed, and where a copy is on its way", async () => {
    ProductFeedback.setSettings({ isOn: true, isAskingMe: true });
    postMock.mockResolvedValue(
      ok({ answerId: "answer-9", isEmailed: true, copyTo: "jane@acme.test" }),
    );

    expect(
      await ProductFeedback.giveFeedback({
        category: GiveFeedbackCategory.Broken,
        details: "No budget on the SLO page.",
      }),
    ).toEqual({
      answerId: "answer-9",
      isEmailed: true,
      copyTo: "jane@acme.test",
    });
  });

  test("kept and not emailed - or from a server that does not say - promises nothing", async () => {
    ProductFeedback.setSettings({ isOn: true, isAskingMe: true });

    for (const answer of [
      { answerId: "answer-9", isEmailed: false, copyTo: null },
      { answerId: "answer-9" },
    ]) {
      postMock.mockResolvedValue(ok(answer as JSONObject));

      expect(
        await ProductFeedback.giveFeedback({
          category: GiveFeedbackCategory.Other,
          details: "Words.",
        }),
      ).toEqual({ answerId: "answer-9", isEmailed: false, copyTo: null });
    }
  });

  test("not kept - refused, thrown, or a server that takes no feedback - is null", async () => {
    ProductFeedback.setSettings({ isOn: true, isAskingMe: true });

    postMock.mockResolvedValue(new HTTPErrorResponse(400, {}, {}));
    expect(
      await ProductFeedback.giveFeedback({
        category: GiveFeedbackCategory.Other,
        details: "Words.",
      }),
    ).toBeNull();

    postMock.mockRejectedValue(new Error("offline"));
    expect(
      await ProductFeedback.giveFeedback({
        category: GiveFeedbackCategory.Other,
        details: "Words.",
      }),
    ).toBeNull();

    postMock.mockReset();
    ProductFeedback.setSettings({ isOn: false, isAskingMe: false });
    expect(
      await ProductFeedback.giveFeedback({
        category: GiveFeedbackCategory.Other,
        details: "Words.",
      }),
    ).toBeNull();
    expect(postMock).not.toHaveBeenCalled();
  });

  test("feedback/given carries what it is about, never the words", async () => {
    ProductFeedback.setSettings({ isOn: true, isAskingMe: true });
    postMock.mockResolvedValue(ok({ answerId: "answer-9" }));

    await ProductFeedback.giveFeedback({
      category: GiveFeedbackCategory.Confusing,
      details: "Where do I set the paging order?",
    });

    const event: Array<unknown> | undefined = captureMock.mock.calls.find(
      (call: Array<unknown>): boolean => {
        return call[0] === ProductEventName.FeedbackGiven;
      },
    );

    expect(event![1]).toMatchObject({
      kind: "general",
      topic: "confusing",
      has_details: true,
    });
    expect(JSON.stringify(event![1])).not.toContain("paging order");
  });

  test("where it goes is the server's word, and before it has one, this frontend's", () => {
    ProductFeedback.setSettings(null);

    // A self-hosted frontend (billing off) claims nothing is emailed.
    mockBillingEnabled = false;
    expect(ProductFeedback.getGiveFeedbackDestination()).toBe(
      GiveFeedbackDestination.ServerAdmins,
    );

    // OneUptime Cloud's (billing on) says the OneUptime team reads it.
    mockBillingEnabled = true;
    expect(ProductFeedback.getGiveFeedbackDestination()).toBe(
      GiveFeedbackDestination.OneUptimeTeam,
    );

    // Once the server has said, its word, on either frontend.
    for (const isCloud of [false, true]) {
      mockBillingEnabled = isCloud;

      for (const destination of Object.values(GiveFeedbackDestination)) {
        ProductFeedback.setSettings({
          isOn: true,
          isAskingMe: true,
          giveFeedbackGoesTo: destination,
        });
        expect(ProductFeedback.getGiveFeedbackDestination()).toBe(destination);
      }
    }
  });

  test("the settings carry where it goes, from the server", async () => {
    getMock.mockResolvedValue(
      ok({
        isOn: true,
        isAskingMe: true,
        giveFeedbackGoesTo: GiveFeedbackDestination.ServerAdminsByEmail,
      }),
    );

    await ProductFeedback.loadSettings();

    expect(ProductFeedback.getGiveFeedbackDestination()).toBe(
      GiveFeedbackDestination.ServerAdminsByEmail,
    );
  });
});

/*
 * WHERE THE SERVER'S ADMINS SEND GIVE FEEDBACK (Admin Dashboard > Settings >
 * Help and Support, #10865): an address of their own, a page of their own,
 * or nowhere. What a person writes is never posted where the server would
 * not take it, so nothing written is dropped silently.
 */
describe("Give feedback, where the server's admins chose (#10865)", () => {
  test("offered where the server takes feedback and does not say otherwise, as it always was", () => {
    ProductFeedback.setSettings({ isOn: true, isAskingMe: true });
    expect(ProductFeedback.isGiveFeedbackOffered()).toBe(true);

    ProductFeedback.setSettings({
      isOn: true,
      isAskingMe: true,
      isGiveFeedbackOffered: true,
    });
    expect(ProductFeedback.isGiveFeedbackOffered()).toBe(true);
  });

  test("not offered where the server says so, nor where it takes no feedback at all, nor before it has said", () => {
    ProductFeedback.setSettings({
      isOn: true,
      isAskingMe: true,
      isGiveFeedbackOffered: false,
    });
    expect(ProductFeedback.isGiveFeedbackOffered()).toBe(false);
    // Its questions are another matter: they still ask.
    expect(ProductFeedback.isOn()).toBe(true);

    ProductFeedback.setSettings({ isOn: false, isAskingMe: false });
    expect(ProductFeedback.isGiveFeedbackOffered()).toBe(false);

    ProductFeedback.setSettings(null);
    expect(ProductFeedback.isGiveFeedbackOffered()).toBe(false);
  });

  test("a page of their own is read only for that destination", () => {
    ProductFeedback.setSettings({
      isOn: true,
      isAskingMe: true,
      giveFeedbackGoesTo: GiveFeedbackDestination.SupportPage,
      giveFeedbackUrl: "https://help.example.com/feedback",
    });
    expect(ProductFeedback.getGiveFeedbackUrl()).toBe(
      "https://help.example.com/feedback",
    );
    expect(ProductFeedback.getGiveFeedbackTo()).toBeNull();

    ProductFeedback.setSettings({
      isOn: true,
      isAskingMe: true,
      giveFeedbackGoesTo: GiveFeedbackDestination.ServerAdmins,
      giveFeedbackUrl: "https://help.example.com/feedback",
    });
    expect(ProductFeedback.getGiveFeedbackUrl()).toBeNull();
  });

  test("an address of their own is read only for that destination", () => {
    ProductFeedback.setSettings({
      isOn: true,
      isAskingMe: true,
      giveFeedbackGoesTo: GiveFeedbackDestination.SupportTeamByEmail,
      giveFeedbackTo: "it-help@example.com",
    });
    expect(ProductFeedback.getGiveFeedbackTo()).toBe("it-help@example.com");
    expect(ProductFeedback.getGiveFeedbackUrl()).toBeNull();
    expect(ProductFeedback.getGiveFeedbackDestination()).toBe(
      GiveFeedbackDestination.SupportTeamByEmail,
    );

    ProductFeedback.setSettings({
      isOn: true,
      isAskingMe: true,
      giveFeedbackTo: "it-help@example.com",
    });
    expect(ProductFeedback.getGiveFeedbackTo()).toBeNull();
  });

  test.each([
    [
      "hidden",
      { isOn: true, isAskingMe: true, isGiveFeedbackOffered: false },
    ],
    [
      "sent to a page of their own",
      {
        isOn: true,
        isAskingMe: true,
        giveFeedbackGoesTo: GiveFeedbackDestination.SupportPage,
        giveFeedbackUrl: "https://help.example.com/feedback",
      },
    ],
  ])(
    "%s: what is written is not posted, and nothing says it was sent",
    async (_name: string, settings: Record<string, unknown>) => {
      ProductFeedback.setSettings(
        settings as unknown as Parameters<
          typeof ProductFeedback.setSettings
        >[0],
      );

      expect(
        await ProductFeedback.giveFeedback({
          category: GiveFeedbackCategory.Broken,
          details: "Words that would go nowhere.",
        }),
      ).toBeNull();
      expect(postMock).not.toHaveBeenCalled();
      expect(captureMock).not.toHaveBeenCalledWith(
        ProductEventName.FeedbackGiven,
        expect.anything(),
      );
    },
  );

  test("hidden: the questions' one-click answers are still kept", async () => {
    ProductFeedback.setSettings({
      isOn: true,
      isAskingMe: true,
      isGiveFeedbackOffered: false,
    });
    postMock.mockResolvedValue(ok({ answerId: "answer-9" }));

    expect(
      await ProductFeedback.submit({
        kind: ProductFeedbackKind.SetupFlow,
        topic: "website_down",
        score: 5,
      }),
    ).toBe("answer-9");
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  test("the settings carry the offer, the address and the page, read from the server", async () => {
    getMock.mockResolvedValue(
      ok({
        isOn: true,
        isAskingMe: true,
        giveFeedbackGoesTo: GiveFeedbackDestination.SupportTeamByEmail,
        isGiveFeedbackOffered: true,
        giveFeedbackTo: "it-help@example.com",
      }),
    );

    await ProductFeedback.loadSettings();

    expect(ProductFeedback.isGiveFeedbackOffered()).toBe(true);
    expect(ProductFeedback.getGiveFeedbackTo()).toBe("it-help@example.com");
  });
});

describe("words after a one-click answer, and stopping", () => {
  test("the words go to the answer they follow", async () => {
    postMock.mockResolvedValue(ok({ added: true }));

    expect(
      await ProductFeedback.addDetails({
        answerId: "answer-1",
        details: " Phone step. ",
      }),
    ).toBe(true);

    const call: { url: { toString: () => string }; data: JSONObject } =
      lastCall(postMock);

    expect(call.url.toString()).toContain(PRODUCT_FEEDBACK_DETAILS_ROUTE);
    expect(call.data).toEqual({ answerId: "answer-1", details: "Phone step." });
  });

  test("no id or no words sends nothing", async () => {
    expect(
      await ProductFeedback.addDetails({ answerId: "", details: "x" }),
    ).toBe(false);
    expect(
      await ProductFeedback.addDetails({ answerId: "a", details: "  " }),
    ).toBe(false);
    expect(postMock).not.toHaveBeenCalled();
  });

  test("Don't ask me again switches the person's questions off, here at once and on their record", async () => {
    ProductFeedback.setSettings({ isOn: true, isAskingMe: true });
    updateByIdMock.mockResolvedValue(ok({}));

    await ProductFeedback.stopAsking();

    expect(ProductFeedback.isAskingMe()).toBe(false);
    expect(ProductFeedback.isOn()).toBe(true);

    const update: { modelType: unknown; data: JSONObject } = updateByIdMock.mock
      .calls[0]![0] as { modelType: unknown; data: JSONObject };

    expect(update.modelType).toBe(User);
    expect(update.data).toEqual({ disableFeedbackQuestions: true });
  });
});
