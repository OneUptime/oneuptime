/** @timezone UTC */

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
 * The rules of the `@key:` value picker (issue #4708): which word asks for
 * values, which keys get a lookup, the window a lookup sends, and the tab's
 * cache of answers - one lookup per key and window, joined while it is on
 * its way, a failure kept a minute and an answer five.
 */

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return { tenantid: "project-1" };
      },
    },
  };
});

import {
  ATTRIBUTE_VALUE_ANSWER_TTL_IN_MS,
  ATTRIBUTE_VALUE_FAILURE_TTL_IN_MS,
  ATTRIBUTE_VALUE_LOOKUP_PAUSE_IN_MS,
  ATTRIBUTE_VALUE_REQUEST_TIMEOUT_IN_MS,
  AttributeKeyList,
  AttributeKeyVerdict,
  AttributeValueAnswer,
  clearAttributeValueAnswers,
  fetchAttributeValueSuggestions,
  forgetAttributeValues,
  getLookupWindowBody,
  getTimeRangeScope,
  getTypedAttributeKey,
  judgeTypedAttributeKey,
  lookUpAttributeValues,
  onAttributeValueAnswers,
  readAnswer,
  toAnswerKey,
  toValueList,
} from "../../../UI/Utils/Telemetry/AttributeValueSuggestions";
import { TelemetryLoadErrorKind } from "../../../UI/Utils/Telemetry/TelemetryLoadError";
import { ATTRIBUTE_KEYS_LIMIT } from "../../../Types/Telemetry/AttributeSuggestionLimits";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import { JSONObject } from "../../../Types/JSON";
import TimeRange from "../../../Types/Time/TimeRange";
import URL from "../../../Types/API/URL";

const NOW: Date = new Date("2026-10-14T12:00:00.000Z");

beforeEach(() => {
  postMock.mockReset();
  clearAttributeValueAnswers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("the word that asks for values", () => {
  test.each([
    ["@http.method:", "http.method"],
    ["@http.method:GE", "http.method"],
    ["severity:error @http.method:", "http.method"],
    ["-@http.method:GET", "http.method"],
    ["@k:", "k"],
    ["@url:https://example.com:8080/x", "url"],
    ["@exception.message:Error: timeout", null],
  ])("%j asks for %j", (searchText: string, key: string | null) => {
    expect(getTypedAttributeKey(searchText)).toBe(key);
  });

  test.each([
    ["", "nothing typed"],
    ["@", "an @ alone"],
    ["@http", "a key still being typed"],
    ["@exception.message", "a whole key with no colon yet"],
    ["@:", "a colon with no key"],
    ["severity:error", "a field without @"],
    ["http.method:GET", "an attribute written without @"],
    ["@http.method:GET ", "a finished term followed by a space"],
    ["timeout", "free text"],
    ["--@k:", "two dashes"],
  ])("%j asks for nothing (%s)", (searchText: string) => {
    expect(getTypedAttributeKey(searchText)).toBeNull();
  });

  /*
   * Typed one character at a time, a key asks for nothing until its colon:
   * `@e`, `@ex`, ... are never keys.
   */
  test("typing a key letter by letter asks for nothing until the colon", () => {
    const typed: string = "@exception.message:";
    const asked: Array<string | null> = [];

    for (let length: number = 1; length <= typed.length; length++) {
      asked.push(getTypedAttributeKey(typed.substring(0, length)));
    }

    expect(asked.filter(Boolean)).toEqual(["exception.message"]);
  });
});

describe("which keys get a lookup", () => {
  const KEYS: Array<string> = ["env", "http.method", "exception.message"];

  function list(overrides: Partial<AttributeKeyList> = {}): AttributeKeyList {
    return { keys: KEYS, isLoading: false, hasFailed: false, ...overrides };
  }

  test("a key the project has", () => {
    expect(judgeTypedAttributeKey("env", list())).toBe(
      AttributeKeyVerdict.LookUp,
    );
  });

  test.each(["e", "ex", "exception", "exception.messag", "envv", "nope"])(
    "not %j, which the project does not have",
    (key: string) => {
      expect(judgeTypedAttributeKey(key, list())).toBe(
        AttributeKeyVerdict.NotAKey,
      );
    },
  );

  test("keys are matched as the data holds them, case included", () => {
    expect(judgeTypedAttributeKey("Env", list())).toBe(
      AttributeKeyVerdict.NotAKey,
    );
    expect(judgeTypedAttributeKey("HTTP.METHOD", list())).toBe(
      AttributeKeyVerdict.NotAKey,
    );
  });

  test("while the key list loads, the answer waits for it", () => {
    expect(judgeTypedAttributeKey("env", list({ isLoading: true }))).toBe(
      AttributeKeyVerdict.WaitForKeyList,
    );
  });

  test("a key list that could not load cannot rule a key out", () => {
    expect(
      judgeTypedAttributeKey("anything", list({ keys: [], hasFailed: true })),
    ).toBe(AttributeKeyVerdict.LookUp);
  });

  test("a key list cut off at the limit cannot rule a key out", () => {
    const full: Array<string> = Array.from(
      { length: ATTRIBUTE_KEYS_LIMIT },
      (_value: unknown, index: number): string => {
        return `key.${index}`;
      },
    );

    expect(judgeTypedAttributeKey("past.the.end", list({ keys: full }))).toBe(
      AttributeKeyVerdict.LookUp,
    );
    expect(
      judgeTypedAttributeKey("past.the.end", list({ keys: full.slice(1) })),
    ).toBe(AttributeKeyVerdict.NotAKey);
  });
});

describe("the window a lookup sends", () => {
  test("a moving range is named by itself, so its answer is reused while fresh", () => {
    expect(getTimeRangeScope({ range: TimeRange.PAST_ONE_HOUR })).toBe(
      "Past 1 Hour",
    );
    expect(getTimeRangeScope(undefined)).toBe("no-window");
  });

  test("a fixed range is named by its edges", () => {
    expect(
      getTimeRangeScope({
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(
          new Date("2026-10-07T14:00:00.000Z"),
          new Date("2026-10-07T15:00:00.000Z"),
        ),
      }),
    ).toBe("2026-10-07T14:00:00.000Z..2026-10-07T15:00:00.000Z");
  });

  test("the window is the range on screen, resolved when the lookup is sent", () => {
    jest.useFakeTimers({ now: NOW });

    expect(getLookupWindowBody({ range: TimeRange.PAST_ONE_HOUR })).toEqual({
      startTime: "2026-10-14T11:00:00.000Z",
      endTime: "2026-10-14T12:00:00.000Z",
    });

    jest.setSystemTime(new Date(NOW.getTime() + 60 * 1000));

    expect(getLookupWindowBody({ range: TimeRange.PAST_ONE_HOUR })).toEqual({
      startTime: "2026-10-14T11:01:00.000Z",
      endTime: "2026-10-14T12:01:00.000Z",
    });
  });

  test("a fixed range is sent as it is; no range sends no window", () => {
    expect(
      getLookupWindowBody({
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(
          new Date("2026-10-07T14:00:00.000Z"),
          new Date("2026-10-07T15:00:00.000Z"),
        ),
      }),
    ).toEqual({
      startTime: "2026-10-07T14:00:00.000Z",
      endTime: "2026-10-07T15:00:00.000Z",
    });
    expect(getLookupWindowBody(undefined)).toEqual({});
  });
});

describe("the request", () => {
  test("names the signal, the key, the window and a time limit of its own", async () => {
    jest.useFakeTimers({ now: NOW });
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, { values: ["GET", "POST", 7] }, {}),
    );

    const values: Array<string> = await fetchAttributeValueSuggestions({
      signal: "traces",
      attributeKey: "http.method",
      timeRange: { range: TimeRange.PAST_ONE_HOUR },
    });

    expect(values).toEqual(["GET", "POST"]);
    expect(postMock).toHaveBeenCalledTimes(1);

    const request: {
      url: URL;
      data: JSONObject;
      headers: JSONObject;
      options: JSONObject;
    } = postMock.mock.calls[0]![0] as {
      url: URL;
      data: JSONObject;
      headers: JSONObject;
      options: JSONObject;
    };

    expect(request.url.toString()).toContain(
      "/telemetry/traces/get-attribute-values",
    );
    expect(request.data).toEqual({
      attributeKey: "http.method",
      startTime: "2026-10-14T11:00:00.000Z",
      endTime: "2026-10-14T12:00:00.000Z",
    });
    expect(request.headers).toEqual({ tenantid: "project-1" });
    expect(request.options).toEqual({
      timeout: ATTRIBUTE_VALUE_REQUEST_TIMEOUT_IN_MS,
    });
  });

  test("a metric's lookup names the metric", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, { values: [] }, {}),
    );

    await fetchAttributeValueSuggestions({
      signal: "metrics",
      attributeKey: "host.name",
      metricName: "system.cpu.utilization",
    });

    expect((postMock.mock.calls[0]![0] as { data: JSONObject }).data).toEqual({
      attributeKey: "host.name",
      metricName: "system.cpu.utilization",
    });
  });

  test("an error answer is thrown, for the picker to show", async () => {
    const error: HTTPErrorResponse = new HTTPErrorResponse(
      504,
      { message: "This query took longer than 10 seconds" },
      {},
    );
    postMock.mockResolvedValue(error);

    await expect(
      fetchAttributeValueSuggestions({ signal: "logs", attributeKey: "env" }),
    ).rejects.toBe(error);
  });

  test("only strings are values", () => {
    expect(toValueList(["a", 1, null, "b", { c: 1 }])).toEqual(["a", "b"]);
    expect(toValueList(undefined)).toEqual([]);
    expect(toValueList("a")).toEqual([]);
  });
});

describe("the answers of this tab", () => {
  const KEY: string = toAnswerKey("logs|project-1|Past 1 Hour", "env");

  function deferred(): {
    promise: Promise<Array<string>>;
    resolve: (values: Array<string>) => void;
    reject: (error: unknown) => void;
  } {
    let resolve: (values: Array<string>) => void = (): void => {};
    let reject: (error: unknown) => void = (): void => {};
    const promise: Promise<Array<string>> = new Promise<Array<string>>(
      (
        onResolve: (values: Array<string>) => void,
        onReject: (error: unknown) => void,
      ) => {
        resolve = onResolve;
        reject = onReject;
      },
    );

    return { promise, resolve, reject };
  }

  test("a lookup on its way is joined, never sent twice", async () => {
    const answer: ReturnType<typeof deferred> = deferred();
    const fetchValues: MockFunction = getJestMockFunction();
    fetchValues.mockReturnValue(answer.promise);

    const first: Promise<void> = lookUpAttributeValues(KEY, fetchValues);
    const second: Promise<void> = lookUpAttributeValues(KEY, fetchValues);

    expect(readAnswer(KEY)?.kind).toBe("loading");

    answer.resolve(["production", "staging", "production"]);
    await Promise.all([first, second]);

    expect(fetchValues).toHaveBeenCalledTimes(1);
    expect(readAnswer(KEY)).toMatchObject({
      kind: "loaded",
      values: ["production", "staging"],
    });
  });

  test("an answer is kept five minutes", async () => {
    jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "queueMicrotask"] });

    await lookUpAttributeValues(KEY, async (): Promise<Array<string>> => {
      return ["production"];
    });

    expect(
      readAnswer(KEY, NOW.getTime() + ATTRIBUTE_VALUE_ANSWER_TTL_IN_MS - 1),
    ).toMatchObject({ kind: "loaded" });
    expect(
      readAnswer(KEY, NOW.getTime() + ATTRIBUTE_VALUE_ANSWER_TTL_IN_MS),
    ).toBeUndefined();
    // And once gone, it is gone.
    expect(readAnswer(KEY, NOW.getTime())).toBeUndefined();
  });

  test("a failure is an answer too: kept a minute, said as what it was", async () => {
    jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "queueMicrotask"] });

    await lookUpAttributeValues(KEY, async (): Promise<Array<string>> => {
      throw new HTTPErrorResponse(
        504,
        { message: "This query took longer than 10 seconds" },
        {},
      );
    });

    const answer: AttributeValueAnswer | undefined = readAnswer(KEY);

    expect(answer?.kind).toBe("failed");
    expect(
      answer && answer.kind === "failed" ? answer.error.kind : undefined,
    ).toBe(TelemetryLoadErrorKind.TimedOut);

    expect(
      readAnswer(KEY, NOW.getTime() + ATTRIBUTE_VALUE_FAILURE_TTL_IN_MS - 1)
        ?.kind,
    ).toBe("failed");
    expect(
      readAnswer(KEY, NOW.getTime() + ATTRIBUTE_VALUE_FAILURE_TTL_IN_MS),
    ).toBeUndefined();
  });

  test("another failure reads as a failure, not a time-out", async () => {
    await lookUpAttributeValues(KEY, async (): Promise<Array<string>> => {
      throw new Error("Network Error");
    });

    const answer: AttributeValueAnswer | undefined = readAnswer(KEY);

    expect(
      answer && answer.kind === "failed" ? answer.error.kind : undefined,
    ).toBe(TelemetryLoadErrorKind.Failed);
  });

  test("forgetting an answer makes the next lookup ask again; a lookup on its way is never forgotten", async () => {
    const fetchValues: MockFunction = getJestMockFunction();
    fetchValues.mockResolvedValue(["a"]);

    await lookUpAttributeValues(KEY, fetchValues);
    forgetAttributeValues(KEY);
    expect(readAnswer(KEY)).toBeUndefined();

    await lookUpAttributeValues(KEY, fetchValues);
    expect(fetchValues).toHaveBeenCalledTimes(2);

    const slow: ReturnType<typeof deferred> = deferred();
    forgetAttributeValues(KEY);
    const pending: Promise<void> = lookUpAttributeValues(KEY, () => {
      return slow.promise;
    });
    forgetAttributeValues(KEY);
    expect(readAnswer(KEY)?.kind).toBe("loading");

    slow.resolve(["b"]);
    await pending;
  });

  test("listeners hear when a lookup starts and when it settles", async () => {
    const heard: MockFunction = getJestMockFunction();
    const stop: () => void = onAttributeValueAnswers(heard);

    await lookUpAttributeValues(KEY, async (): Promise<Array<string>> => {
      return ["a"];
    });

    expect(heard).toHaveBeenCalledTimes(2);

    stop();
    await lookUpAttributeValues(
      toAnswerKey("other", "env"),
      async (): Promise<Array<string>> => {
        return ["a"];
      },
    );
    expect(heard).toHaveBeenCalledTimes(2);
  });

  test("answers are kept per scope and key", async () => {
    await lookUpAttributeValues(
      toAnswerKey("logs|project-1|Past 1 Hour", "env"),
      async (): Promise<Array<string>> => {
        return ["one-hour"];
      },
    );
    await lookUpAttributeValues(
      toAnswerKey("logs|project-1|Past 1 Day", "env"),
      async (): Promise<Array<string>> => {
        return ["one-day"];
      },
    );
    await lookUpAttributeValues(
      toAnswerKey("logs|project-2|Past 1 Hour", "env"),
      async (): Promise<Array<string>> => {
        return ["other-project"];
      },
    );

    const valuesOf: (scope: string) => Array<string> | undefined = (
      scope: string,
    ): Array<string> | undefined => {
      const answer: AttributeValueAnswer | undefined = readAnswer(
        toAnswerKey(scope, "env"),
      );
      return answer && answer.kind === "loaded" ? answer.values : undefined;
    };

    expect(valuesOf("logs|project-1|Past 1 Hour")).toEqual(["one-hour"]);
    expect(valuesOf("logs|project-1|Past 1 Day")).toEqual(["one-day"]);
    expect(valuesOf("logs|project-2|Past 1 Hour")).toEqual(["other-project"]);
    // A scope and a key never run together into another pair's name.
    expect(toAnswerKey("a|b", "c")).not.toBe(toAnswerKey("a", "b|c"));
  });

  test("the pause is long enough to type through, short enough not to wait for", () => {
    expect(ATTRIBUTE_VALUE_LOOKUP_PAUSE_IN_MS).toBeGreaterThanOrEqual(250);
    expect(ATTRIBUTE_VALUE_LOOKUP_PAUSE_IN_MS).toBeLessThanOrEqual(600);
  });
});
