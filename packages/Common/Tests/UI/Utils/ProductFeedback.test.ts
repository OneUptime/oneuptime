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
