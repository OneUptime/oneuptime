import useAttributeValueSuggestions, {
  AttributeValueSuggestionsState,
  UseAttributeValueSuggestionsOptions,
} from "../../../UI/Utils/Telemetry/UseAttributeValueSuggestions";
import {
  ATTRIBUTE_VALUE_ANSWER_TTL_IN_MS,
  ATTRIBUTE_VALUE_LOOKUP_PAUSE_IN_MS,
  clearAttributeValueAnswers,
} from "../../../UI/Utils/Telemetry/AttributeValueSuggestions";
import { TelemetryLoadErrorKind } from "../../../UI/Utils/Telemetry/TelemetryLoadError";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import {
  act,
  cleanup,
  renderHook,
  RenderHookResult,
} from "@testing-library/react";
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
 * What a search bar asks for while the reader types (issue #4708): typing
 * `exception.message` used to send 17 lookups, one per prefix, each a scan
 * of a day of logs, and every key asked about again whenever it came back.
 * Now a key is asked about once the reader pauses on it, only when the
 * project has it, and once per key and time range - for every explorer on
 * the page at once.
 */

const KEYS: Array<string> = [
  "env",
  "exception",
  "exception.message",
  "http.method",
  "http.status_code",
];

const PAUSE: number = ATTRIBUTE_VALUE_LOOKUP_PAUSE_IN_MS;
// Faster than the pause: a person typing a word.
const KEYSTROKE: number = 120;

let fetchValues: MockFunction;

beforeEach(() => {
  jest.useFakeTimers({
    now: new Date("2026-10-14T12:00:00.000Z"),
    doNotFake: ["nextTick", "queueMicrotask"],
  });
  clearAttributeValueAnswers();
  fetchValues = getJestMockFunction();
  fetchValues.mockImplementation(
    async (key: string): Promise<Array<string>> => {
      return [`${key}-value-1`, `${key}-value-2`];
    },
  );
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

type Harness = RenderHookResult<
  AttributeValueSuggestionsState,
  Partial<UseAttributeValueSuggestionsOptions>
>;

function options(
  overrides: Partial<UseAttributeValueSuggestionsOptions> = {},
): UseAttributeValueSuggestionsOptions {
  return {
    searchText: "",
    attributeKeys: KEYS,
    isAttributeKeysLoading: false,
    hasAttributeKeysFailed: false,
    scope: "logs|project-1|Past 1 Hour",
    fetchValues: (key: string): Promise<Array<string>> => {
      return fetchValues(key) as Promise<Array<string>>;
    },
    ...overrides,
  };
}

function renderPicker(
  initial: Partial<UseAttributeValueSuggestionsOptions> = {},
): Harness {
  return renderHook(
    (props: Partial<UseAttributeValueSuggestionsOptions>) => {
      return useAttributeValueSuggestions(options(props));
    },
    { initialProps: initial },
  );
}

// Lets timers run and the answers they start settle.
async function wait(milliseconds: number): Promise<void> {
  await act(async (): Promise<void> => {
    jest.advanceTimersByTime(milliseconds);
    await Promise.resolve();
    await Promise.resolve();
  });
}

// Types `text` one character at a time onto `prefix`, KEYSTROKE apart.
async function type(
  harness: Harness,
  text: string,
  prefix: string = "",
  extra: Partial<UseAttributeValueSuggestionsOptions> = {},
): Promise<void> {
  for (let length: number = 1; length <= text.length; length++) {
    harness.rerender({
      ...extra,
      searchText: prefix + text.substring(0, length),
    });
    await wait(KEYSTROKE);
  }
}

function askedFor(): Array<string> {
  return fetchValues.mock.calls.map((call: Array<unknown>): string => {
    return call[0] as string;
  });
}

describe("typing a key", () => {
  test("typing `@exception.message:` asks once, for the whole key, after the pause", async () => {
    const harness: Harness = renderPicker();

    await type(harness, "@exception.message:");

    // Still typing: nothing asked, the values are on their way.
    expect(askedFor()).toEqual([]);
    expect(harness.result.current.isLoading).toBe(true);

    await wait(PAUSE);

    expect(askedFor()).toEqual(["exception.message"]);
    expect(harness.result.current.isLoading).toBe(false);
    expect(harness.result.current.valueSuggestions).toEqual({
      "exception.message": [
        "exception.message-value-1",
        "exception.message-value-2",
      ],
    });
  });

  test("typing a value after the colon asks nothing more", async () => {
    const harness: Harness = renderPicker();

    await type(harness, "@http.method:");
    await wait(PAUSE);
    await type(harness, "GET", "@http.method:");
    await wait(10 * PAUSE);

    expect(askedFor()).toEqual(["http.method"]);
  });

  /*
   * The search help's example, its key typed over: every letter makes a
   * new `@<key>:` - "e", "ex", "exc", ... - and none of them is a key, or
   * one is only on the way to the real one.
   */
  test("editing a key in place asks only for the key the reader stops on", async () => {
    const harness: Harness = renderPicker({
      searchText: "@http.status_code:500",
    });

    await wait(PAUSE);
    expect(askedFor()).toEqual(["http.status_code"]);

    const typedOver: string = "exception.message";

    for (let length: number = 1; length <= typedOver.length; length++) {
      harness.rerender({
        searchText: `@${typedOver.substring(0, length)}:500`,
      });
      await wait(KEYSTROKE);
    }

    await wait(PAUSE);

    // "exception" is a key too, passed on the way: not asked about.
    expect(askedFor()).toEqual(["http.status_code", "exception.message"]);
  });

  test("a key the reader does stop on is asked about, even on the way to a longer one", async () => {
    const harness: Harness = renderPicker({ searchText: "@exception:" });

    await wait(PAUSE);

    expect(askedFor()).toEqual(["exception"]);
  });

  test("a key the project does not have is never asked about", async () => {
    const harness: Harness = renderPicker();

    await type(harness, "@exceptoin.message:");
    await wait(10 * PAUSE);

    expect(askedFor()).toEqual([]);
    expect(harness.result.current.isLoading).toBe(false);
    expect(harness.result.current.error).toBeUndefined();
    expect(harness.result.current.valueSuggestions).toEqual({});
  });

  test("a key in another case is another key", async () => {
    renderPicker({ searchText: "@ENV:" });
    await wait(10 * PAUSE);

    expect(askedFor()).toEqual([]);
  });

  test("a field written with @ is never looked up as an attribute", async () => {
    const harness: Harness = renderPicker({
      attributeKeys: [...KEYS, "service"],
      ignoreKey: (key: string): boolean => {
        return key.toLowerCase() === "service";
      },
      searchText: "@service:",
    });

    await wait(10 * PAUSE);

    expect(askedFor()).toEqual([]);
    expect(harness.result.current.isLoading).toBe(false);
    expect(harness.result.current.typedKey).toBeNull();
  });

  test("an excluded term asks for its key's values too", async () => {
    renderPicker({ searchText: "-@env:" });
    await wait(PAUSE);

    expect(askedFor()).toEqual(["env"]);
  });
});

describe("the key list", () => {
  test("while it loads, the picker waits for it, then asks once the key is known", async () => {
    const harness: Harness = renderPicker({
      attributeKeys: [],
      isAttributeKeysLoading: true,
      searchText: "@env:",
    });

    await wait(10 * PAUSE);
    expect(askedFor()).toEqual([]);
    expect(harness.result.current.isLoading).toBe(true);

    harness.rerender({ searchText: "@env:" });
    await wait(PAUSE);

    expect(askedFor()).toEqual(["env"]);
    expect(harness.result.current.valueSuggestions["env"]).toEqual([
      "env-value-1",
      "env-value-2",
    ]);
  });

  test("once it has loaded without the key, the wait ends with nothing asked", async () => {
    const harness: Harness = renderPicker({
      attributeKeys: [],
      isAttributeKeysLoading: true,
      searchText: "@not.a.key:",
    });

    harness.rerender({ searchText: "@not.a.key:" });
    await wait(10 * PAUSE);

    expect(askedFor()).toEqual([]);
    expect(harness.result.current.isLoading).toBe(false);
  });

  test("a list that could not load asks for the key the reader typed", async () => {
    renderPicker({
      attributeKeys: [],
      hasAttributeKeysFailed: true,
      searchText: "@exceptoin.message:",
    });

    await wait(PAUSE);

    expect(askedFor()).toEqual(["exceptoin.message"]);
  });
});

describe("one lookup per key and time range", () => {
  test("coming back to a key asks nothing, and its values are there at once", async () => {
    const harness: Harness = renderPicker();

    await type(harness, "@env:");
    await wait(PAUSE);
    harness.rerender({ searchText: "" });
    await type(harness, "@http.method:");
    await wait(PAUSE);
    harness.rerender({ searchText: "" });
    await type(harness, "@env:");

    // No pause needed, no spinner: the answer is the one already here.
    expect(harness.result.current.isLoading).toBe(false);
    expect(harness.result.current.valueSuggestions["env"]).toEqual([
      "env-value-1",
      "env-value-2",
    ]);

    await wait(10 * PAUSE);
    expect(askedFor()).toEqual(["env", "http.method"]);
  });

  test("another time range is another question", async () => {
    const harness: Harness = renderPicker({ searchText: "@env:" });

    await wait(PAUSE);
    harness.rerender({
      searchText: "@env:",
      scope: "logs|project-1|Past 1 Day",
    });
    await wait(PAUSE);
    harness.rerender({
      searchText: "@env:",
      scope: "logs|project-1|Past 1 Hour",
    });
    await wait(PAUSE);

    expect(askedFor()).toEqual(["env", "env"]);
  });

  test("explorers and remounts on the page share the answers", async () => {
    const first: Harness = renderPicker({ searchText: "@env:" });

    await wait(PAUSE);
    first.unmount();

    const second: Harness = renderPicker({ searchText: "@env:" });
    await wait(PAUSE);

    expect(askedFor()).toEqual(["env"]);
    expect(second.result.current.valueSuggestions["env"]).toHaveLength(2);
  });

  test("two pickers asking at once share one lookup", async () => {
    let release: (values: Array<string>) => void = (): void => {};
    fetchValues.mockImplementation((): Promise<Array<string>> => {
      return new Promise<Array<string>>(
        (resolve: (values: Array<string>) => void) => {
          release = resolve;
        },
      );
    });

    const first: Harness = renderPicker({ searchText: "@env:" });
    const second: Harness = renderPicker({ searchText: "@env:" });

    await wait(PAUSE);
    expect(first.result.current.isLoading).toBe(true);
    expect(second.result.current.isLoading).toBe(true);

    await act(async (): Promise<void> => {
      release(["production"]);
      await Promise.resolve();
    });

    expect(askedFor()).toEqual(["env"]);
    expect(first.result.current.valueSuggestions).toEqual({
      env: ["production"],
    });
    expect(second.result.current.valueSuggestions).toEqual({
      env: ["production"],
    });
  });

  test("an answer five minutes old is asked for again", async () => {
    const harness: Harness = renderPicker({ searchText: "@env:" });

    await wait(PAUSE);
    harness.rerender({ searchText: "" });
    await wait(ATTRIBUTE_VALUE_ANSWER_TTL_IN_MS);
    harness.rerender({ searchText: "@env:" });
    await wait(PAUSE);

    expect(askedFor()).toEqual(["env", "env"]);
  });

  test("the values handed out keep their identity between renders", async () => {
    const harness: Harness = renderPicker({ searchText: "@env:" });

    await wait(PAUSE);

    const first: Record<string, Array<string>> = harness.result.current
      .valueSuggestions;

    harness.rerender({ searchText: "@env:" });

    expect(harness.result.current.valueSuggestions).toBe(first);
  });
});

describe("a lookup that fails", () => {
  test("says it could not load, stops loading, and Try again asks at once", async () => {
    fetchValues.mockImplementationOnce(async (): Promise<Array<string>> => {
      throw new HTTPErrorResponse(
        504,
        {
          message:
            "This query took longer than 10 seconds and was stopped before it finished.",
        },
        {},
      );
    });

    const harness: Harness = renderPicker({ searchText: "@env:" });

    await wait(PAUSE);

    expect(harness.result.current.isLoading).toBe(false);
    expect(harness.result.current.error?.kind).toBe(
      TelemetryLoadErrorKind.TimedOut,
    );
    expect(harness.result.current.valueSuggestions).toEqual({});

    // Typing the value on does not ask again.
    harness.rerender({ searchText: "@env:prod" });
    await wait(10 * PAUSE);
    expect(askedFor()).toEqual(["env"]);

    await act(async (): Promise<void> => {
      harness.result.current.retry();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(askedFor()).toEqual(["env", "env"]);
    expect(harness.result.current.error).toBeUndefined();
    expect(harness.result.current.valueSuggestions["env"]).toHaveLength(2);
  });

  test("any other failure reads as a failure", async () => {
    fetchValues.mockImplementationOnce(async (): Promise<Array<string>> => {
      throw new Error("Network Error");
    });

    const harness: Harness = renderPicker({ searchText: "@env:" });
    await wait(PAUSE);

    expect(harness.result.current.error?.kind).toBe(
      TelemetryLoadErrorKind.Failed,
    );
  });

  test("Try again does nothing when no key is being typed", async () => {
    const harness: Harness = renderPicker({ searchText: "timeout" });

    await act(async (): Promise<void> => {
      harness.result.current.retry();
      await Promise.resolve();
    });

    expect(askedFor()).toEqual([]);
  });

  test("a failed key is not asked again while the failure stands", async () => {
    fetchValues.mockImplementationOnce(async (): Promise<Array<string>> => {
      throw new Error("Network Error");
    });

    const harness: Harness = renderPicker({ searchText: "@env:" });
    await wait(PAUSE);
    harness.rerender({ searchText: "" });
    harness.rerender({ searchText: "@env:" });
    await wait(10 * PAUSE);

    expect(askedFor()).toEqual(["env"]);
    expect(harness.result.current.error).toBeDefined();
  });
});
