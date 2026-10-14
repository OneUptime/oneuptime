import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React from "react";
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
 * What the logs explorer asks the server while the reader types in its
 * search bar (issue #4708).
 *
 * Typing `exception.message` once sent 17 value lookups, one per prefix,
 * each a scan of a day of logs that ran to the 45-second limit; a key list
 * that could not load was asked for again, back to back, for as long as the
 * page was open. The real LogsViewer is rendered here with the API mocked,
 * and the requests it sends are counted:
 *
 *   - typing a key asks for its values once, after the reader pauses, with
 *     the time range on screen;
 *   - a key the project does not have asks nothing;
 *   - coming back to a key asks nothing;
 *   - a key list that fails is asked for once, and the picker still works;
 *   - a lookup that fails says so in the dropdown, and Try again asks again.
 */

const getListMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyErrorMessage: (error: Error) => {
        return error.message;
      },
      getFriendlyMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

// Imported after the mocks so the container picks them up.
import LogsViewer from "../../../UI/Components/LogsViewer/LogsViewer";
import {
  ATTRIBUTE_VALUES_LOAD_ERROR_TEST_ID,
  ATTRIBUTE_VALUES_RETRY_TEST_ID,
} from "../../../UI/Components/TelemetryViewer/components/AttributeValuesLoadError";
import {
  ATTRIBUTE_VALUE_LOOKUP_PAUSE_IN_MS,
  clearAttributeValueAnswers,
} from "../../../UI/Utils/Telemetry/AttributeValueSuggestions";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import URL from "../../../Types/API/URL";
import TimeRange from "../../../Types/Time/TimeRange";

const NOW: Date = new Date("2026-10-14T12:00:00.000Z");

const SEARCH_PLACEHOLDER: RegExp = /^Search logs/;

const KEYS: Array<string> = [
  "env",
  "exception.message",
  "http.method",
  "http.status_code",
];

interface PostRequest {
  url: URL;
  data: JSONObject;
}

let keysAnswer: () => Promise<unknown>;
let valuesAnswer: (key: string) => Promise<unknown>;

function requestsTo(route: string): Array<JSONObject> {
  return postMock.mock.calls
    .map((call: Array<unknown>): PostRequest => {
      return call[0] as PostRequest;
    })
    .filter((request: PostRequest): boolean => {
      return request.url.toString().endsWith(route);
    })
    .map((request: PostRequest): JSONObject => {
      return request.data;
    });
}

function valueLookups(): Array<JSONObject> {
  return requestsTo("/telemetry/logs/get-attribute-values");
}

beforeEach(() => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ["nextTick", "queueMicrotask"],
  });
  clearAttributeValueAnswers();
  getListMock.mockReset();
  postMock.mockReset();

  getListMock.mockImplementation(() => {
    return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
  });

  keysAnswer = async (): Promise<unknown> => {
    return new HTTPResponse<JSONObject>(200, { attributes: KEYS }, {});
  };

  valuesAnswer = async (key: string): Promise<unknown> => {
    return new HTTPResponse<JSONObject>(
      200,
      { values: [`${key}-one`, `${key}-two`] },
      {},
    );
  };

  postMock.mockImplementation((request: unknown): Promise<unknown> => {
    const { url, data } = request as PostRequest;
    const route: string = url.toString();

    if (route.endsWith("/telemetry/logs/get-attributes")) {
      return keysAnswer();
    }

    if (route.endsWith("/telemetry/logs/get-attribute-values")) {
      return valuesAnswer(data["attributeKey"] as string);
    }

    return Promise.resolve(new HTTPResponse<JSONObject>(200, {}, {}));
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

async function settle(milliseconds: number = 0): Promise<void> {
  await act(async (): Promise<void> => {
    jest.advanceTimersByTime(milliseconds);
    for (let index: number = 0; index < 5; index++) {
      await Promise.resolve();
    }
  });
}

async function renderViewer(): Promise<HTMLInputElement> {
  render(
    <LogsViewer
      logs={[]}
      isLoading={false}
      filterData={{}}
      onFilterChanged={jest.fn()}
      showFilters={true}
      timeRange={{ range: TimeRange.PAST_ONE_HOUR }}
      onTimeRangeChange={jest.fn()}
    />,
  );

  await settle();
  await settle();

  const input: HTMLInputElement = screen.getByPlaceholderText(
    SEARCH_PLACEHOLDER,
  ) as HTMLInputElement;

  fireEvent.focus(input);

  return input;
}

// Types `text` after `prefix`, a character every 120 ms, as a person does.
async function type(
  input: HTMLInputElement,
  text: string,
  prefix: string = "",
): Promise<void> {
  for (let length: number = 1; length <= text.length; length++) {
    fireEvent.change(input, {
      target: { value: prefix + text.substring(0, length) },
    });
    await settle(120);
  }
}

describe("the logs search bar asks for values", () => {
  test("typing `@exception.message:` asks once, after the pause, for the range on screen", async () => {
    const input: HTMLInputElement = await renderViewer();

    await type(input, "@exception.message:");
    expect(valueLookups()).toHaveLength(0);
    expect(
      screen.getByText("Loading values for exception.message..."),
    ).toBeInTheDocument();

    await settle(ATTRIBUTE_VALUE_LOOKUP_PAUSE_IN_MS);

    expect(valueLookups()).toEqual([
      {
        attributeKey: "exception.message",
        startTime: expect.any(String),
        endTime: expect.any(String),
      },
    ]);

    const lookup: JSONObject = valueLookups()[0]!;
    const start: number = new Date(lookup["startTime"] as string).getTime();
    const end: number = new Date(lookup["endTime"] as string).getTime();

    expect(end - start).toBe(60 * 60 * 1000);
    expect(screen.getByText("exception.message-one")).toBeInTheDocument();

    // Typing the value asks nothing more.
    await type(input, "exc", "@exception.message:");
    await settle(10 * ATTRIBUTE_VALUE_LOOKUP_PAUSE_IN_MS);
    expect(valueLookups()).toHaveLength(1);
  });

  test("a key the project does not have asks nothing", async () => {
    const input: HTMLInputElement = await renderViewer();

    await type(input, "@exceptoin.message:");
    await settle(10 * ATTRIBUTE_VALUE_LOOKUP_PAUSE_IN_MS);

    expect(valueLookups()).toHaveLength(0);
    expect(
      screen.queryByText("Loading values for exceptoin.message..."),
    ).toBeNull();
  });

  test("the search help's example, its key typed over, asks only for the key stopped on", async () => {
    const input: HTMLInputElement = await renderViewer();

    fireEvent.change(input, { target: { value: "@http.status_code:500" } });
    await settle(ATTRIBUTE_VALUE_LOOKUP_PAUSE_IN_MS);

    const typedOver: string = "exception.message";

    for (let length: number = 1; length <= typedOver.length; length++) {
      fireEvent.change(input, {
        target: { value: `@${typedOver.substring(0, length)}:500` },
      });
      await settle(120);
    }

    await settle(ATTRIBUTE_VALUE_LOOKUP_PAUSE_IN_MS);

    expect(
      valueLookups().map((lookup: JSONObject): unknown => {
        return lookup["attributeKey"];
      }),
    ).toEqual(["http.status_code", "exception.message"]);
  });

  test("coming back to a key asks nothing", async () => {
    const input: HTMLInputElement = await renderViewer();

    await type(input, "@env:");
    await settle(ATTRIBUTE_VALUE_LOOKUP_PAUSE_IN_MS);
    fireEvent.change(input, { target: { value: "" } });
    await type(input, "@http.method:");
    await settle(ATTRIBUTE_VALUE_LOOKUP_PAUSE_IN_MS);
    fireEvent.change(input, { target: { value: "" } });
    await type(input, "@env:");
    await settle(10 * ATTRIBUTE_VALUE_LOOKUP_PAUSE_IN_MS);

    expect(
      valueLookups().map((lookup: JSONObject): unknown => {
        return lookup["attributeKey"];
      }),
    ).toEqual(["env", "http.method"]);
    expect(screen.getByText("env-one")).toBeInTheDocument();
  });

  test("a key list that fails is asked for once, and the picker still looks keys up", async () => {
    keysAnswer = async (): Promise<unknown> => {
      return new HTTPErrorResponse(500, { message: "Server Error" }, {});
    };

    const input: HTMLInputElement = await renderViewer();

    // Before: asked for again as soon as each answer failed, forever.
    await settle(60 * 1000);
    expect(requestsTo("/telemetry/logs/get-attributes")).toHaveLength(1);

    await type(input, "@env:");
    await settle(ATTRIBUTE_VALUE_LOOKUP_PAUSE_IN_MS);

    expect(valueLookups()).toHaveLength(1);
    expect(screen.getByText("env-one")).toBeInTheDocument();
  });

  test("a lookup that fails says so, and Try again asks again", async () => {
    let failed: boolean = false;

    valuesAnswer = async (key: string): Promise<unknown> => {
      if (!failed) {
        failed = true;
        return new HTTPErrorResponse(
          504,
          {
            message:
              "This query took longer than 10 seconds and was stopped before it finished.",
          },
          {},
        );
      }

      return new HTTPResponse<JSONObject>(200, { values: [`${key}-one`] }, {});
    };

    const input: HTMLInputElement = await renderViewer();

    await type(input, "@env:");
    await settle(ATTRIBUTE_VALUE_LOOKUP_PAUSE_IN_MS);

    const error: HTMLElement = screen.getByTestId(
      ATTRIBUTE_VALUES_LOAD_ERROR_TEST_ID,
    );

    expect(error).toHaveTextContent("Values for env took too long to load.");
    expect(screen.queryByText("Loading values for env...")).toBeNull();

    fireEvent.click(screen.getByTestId(ATTRIBUTE_VALUES_RETRY_TEST_ID));
    await settle();

    expect(valueLookups()).toHaveLength(2);
    expect(
      screen.queryByTestId(ATTRIBUTE_VALUES_LOAD_ERROR_TEST_ID),
    ).toBeNull();
    expect(screen.getByText("env-one")).toBeInTheDocument();
  });

  test("`@service:` offers the services and never looks up an attribute named service", async () => {
    keysAnswer = async (): Promise<unknown> => {
      return new HTTPResponse<JSONObject>(
        200,
        { attributes: [...KEYS, "service"] },
        {},
      );
    };

    const input: HTMLInputElement = await renderViewer();

    await type(input, "@service:");
    await settle(10 * ATTRIBUTE_VALUE_LOOKUP_PAUSE_IN_MS);

    expect(valueLookups()).toHaveLength(0);
  });
});
