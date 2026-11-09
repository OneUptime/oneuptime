import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";

/*
 * The Markdown viewer as plain text: what the panel shows, not a lazily
 * loaded renderer, is what these tests are about.
 */
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  const mockReact: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    default: (props: { text: string }) => {
      return mockReact.createElement(
        "div",
        { "data-testid": "llm-markdown" },
        props.text,
      );
    },
  };
});

import LlmSpanPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/LlmSpanPanel";
import {
  LLM_SPAN_LOG_EVENT_LIMIT,
  LlmSpanMessages,
  buildSpanLogEventsQuery,
  fetchSpanLogEventContent,
  isNotAllowedError,
  mergeSpanMessages,
  nanosToMs,
  readSpanLogEventContent,
  toLogEventRecord,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/LlmSpanLogEvents";
import { LlmMessage } from "../../../../App/FeatureSet/Dashboard/src/Utils/LlmSpanDisplay";
import Log from "../../../Models/AnalyticsModels/Log";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  LLM_LOG_EVENT_AFTER_CALL_MS,
  LLM_LOG_EVENT_BEFORE_CALL_MS,
  LlmLogEventRecord,
} from "../../../Utils/Telemetry/LlmLogEvents";
import { LlmCallContent } from "../../../Utils/Telemetry/LlmMessageParser";
import {
  GenAiLogEventFixture,
  StoredGenAiSpan,
  loadGenAiLogEventFixture,
  toStoredLogRecords,
  toStoredSpans,
} from "../../Helpers/GenAiLogEventFixtures";

/*
 * A CALL'S DETAILS, ITS PROMPT AND ANSWER SENT AS GENAI LOG EVENTS.
 *
 * Traces > a trace > an AI call's panel showed "Prompt" and "Completion"
 * empty for every call of an app instrumented with the OpenTelemetry
 * JavaScript or Java instrumentation: they send what was said as log
 * records carrying the call's trace and span id. The panel reads them now,
 * through the Log model (the reader's own log permissions), when the span
 * holds no prompt or no answer, and says when they could not be read.
 * The records here are what those instrumentations really sent
 * (Tests/Fixtures/GenAiLogEvents).
 */

const PROJECT_ID: ObjectID = new ObjectID("9900000000000000000000a1");
const FAKE_ANSWER: string =
  "This is a test answer from the fake OpenAI server.";

// The fixture's records of one span, as the Log list read returns them.
function logsOf(
  fixture: GenAiLogEventFixture,
  span: StoredGenAiSpan,
): Array<Log> {
  return toStoredLogRecords(loadGenAiLogEventFixture(fixture), {
    arrivedAtNano: "1794199999000000000",
  })
    .filter((record: LlmLogEventRecord): boolean => {
      return record.spanId === span.spanId;
    })
    .map((record: LlmLogEventRecord): Log => {
      const log: Log = new Log();
      log.traceId = record.traceId || "";
      log.spanId = record.spanId || "";
      // The API sends the 64-bit nanosecond columns as text.
      log.timeUnixNano = record.timeUnixNano as unknown as number;
      log.observedTimeUnixNano =
        record.observedTimeUnixNano as unknown as number;
      log.attributes = record.attributes as JSONObject;
      log.body = record.body as string;
      return log;
    });
}

function listOf(logs: Array<Log>): ListResult<Log> {
  return { data: logs, count: logs.length, skip: 0, limit: logs.length };
}

function firstSpan(fixture: GenAiLogEventFixture): StoredGenAiSpan {
  return toStoredSpans(loadGenAiLogEventFixture(fixture))[0]!;
}

// An LLM span as the span panel hands its attributes: no prompt, no answer.
const SILENT_SPAN_ATTRIBUTES: JSONObject = {
  "gen_ai.system": "openai",
  "gen_ai.operation.name": "chat",
  "gen_ai.request.model": "gpt-4o-mini",
  "gen_ai.usage.input_tokens": 31,
  "gen_ai.usage.output_tokens": 12,
};

function message(role: string, content: string): LlmMessage {
  return { role: role, content: content };
}

function emptyContent(): LlmCallContent {
  return {
    systemInstructions: "",
    input: [],
    output: [],
    finishReasons: [],
    tool: null,
    evaluations: [],
    errorType: "",
  };
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the span's time, its log read and its errors", () => {
  test("nanoseconds as milliseconds, from a number or text; nothing when unknown", () => {
    expect(nanosToMs(1794198568695123456)).toBe(1794198568695);
    expect(nanosToMs("1794198568695000000")).toBe(1794198568695);
    expect(nanosToMs(0)).toBeNull();
    expect(nanosToMs(-5)).toBeNull();
    expect(nanosToMs("soon")).toBeNull();
    expect(nanosToMs(undefined)).toBeNull();
    expect(nanosToMs(null)).toBeNull();
  });

  test("the span's records, a minute before it to a minute after it, no longer ten (#6395)", () => {
    const query: JSONObject = buildSpanLogEventsQuery({
      projectId: PROJECT_ID,
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      startMs: 1_000_000,
      endMs: 1_002_000,
    }) as unknown as JSONObject;

    expect(query["projectId"]).toEqual(PROJECT_ID);
    expect(query["traceId"]).toBe("0af7651916cd43dd8448eb211c80319c");
    expect(query["spanId"]).toBe("b7ad6b7169203331");

    const time: InBetween<Date> = query["time"] as unknown as InBetween<Date>;
    expect(time).toBeInstanceOf(InBetween);
    expect(time.startValue).toEqual(
      new Date(1_000_000 - LLM_LOG_EVENT_BEFORE_CALL_MS),
    );
    expect(time.endValue).toEqual(
      new Date(1_002_000 + LLM_LOG_EVENT_AFTER_CALL_MS),
    );
    expect(time.startValue).toEqual(new Date(1_000_000 - 60_000));
    expect(time.endValue).toEqual(new Date(1_002_000 + 60_000));
  });

  test("an end before the start reads from the start; no project, no project filter", () => {
    const query: JSONObject = buildSpanLogEventsQuery({
      projectId: null,
      traceId: "t",
      spanId: "s",
      startMs: 5_000_000,
      endMs: 1,
    }) as unknown as JSONObject;

    expect(query["projectId"]).toBeUndefined();
    expect((query["time"] as unknown as InBetween<Date>).endValue).toEqual(
      new Date(5_000_000 + LLM_LOG_EVENT_AFTER_CALL_MS),
    );
  });

  test("a refusal is the reader not being allowed; anything else a failure", () => {
    for (const status of [401, 403, 422]) {
      expect(isNotAllowedError(new HTTPErrorResponse(status, {}, {}))).toBe(
        true,
      );
    }

    expect(isNotAllowedError(new HTTPErrorResponse(500, {}, {}))).toBe(false);
    expect(isNotAllowedError(new HTTPErrorResponse(504, {}, {}))).toBe(false);
    expect(isNotAllowedError(new Error("Network Error"))).toBe(false);
    expect(isNotAllowedError(undefined)).toBe(false);
  });

  test("a Log as the record the conversation view reads", () => {
    const log: Log = new Log();
    log.traceId = "0af7651916cd43dd8448eb211c80319c";
    log.spanId = "b7ad6b7169203331";
    log.timeUnixNano = "1794198568695000000" as unknown as number;
    log.attributes = { "event.name": "gen_ai.user.message" };
    log.body = '{"content":"Hi"}';

    expect(toLogEventRecord(log)).toEqual({
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      timeUnixNano: "1794198568695000000",
      observedTimeUnixNano: undefined,
      attributes: { "event.name": "gen_ai.user.message" },
      body: '{"content":"Hi"}',
    });
    expect(toLogEventRecord(new Log())).toEqual({
      traceId: "",
      spanId: "",
      timeUnixNano: undefined,
      observedTimeUnixNano: undefined,
      attributes: {},
      body: "",
    });
  });

  test("the span's other log lines say nothing", () => {
    expect(
      readSpanLogEventContent([
        {
          traceId: "t",
          spanId: "s",
          timeUnixNano: "1",
          attributes: { "log.file": "app.log" },
          body: "GET /orders 200",
        },
      ]),
    ).toEqual(emptyContent());
  });
});

describe("the panel's prompt and completion", () => {
  const logContent: LlmCallContent = readSpanLogEventContent(
    logsOf(
      GenAiLogEventFixture.JavaScriptContent,
      firstSpan(GenAiLogEventFixture.JavaScriptContent),
    ).map(toLogEventRecord),
  );

  test("all from the log events when the span holds neither", () => {
    const messages: LlmSpanMessages = mergeSpanMessages({
      spanPrompt: [],
      spanCompletion: [],
      logContent: logContent,
    });

    expect(messages).toEqual({
      promptMessages: [
        message("system", "You are a helpful assistant."),
        message("user", "Say this is a test."),
      ],
      completionMessages: [message("assistant", FAKE_ANSWER)],
      fromLogEvents: true,
    });
  });

  test("what the span holds wins, each half shown once", () => {
    const spanPrompt: Array<LlmMessage> = [message("user", "On the span")];

    expect(
      mergeSpanMessages({
        spanPrompt: spanPrompt,
        spanCompletion: [],
        logContent: logContent,
      }),
    ).toEqual({
      promptMessages: spanPrompt,
      completionMessages: [message("assistant", FAKE_ANSWER)],
      fromLogEvents: true,
    });

    const spanCompletion: Array<LlmMessage> = [message("assistant", "Mine")];

    expect(
      mergeSpanMessages({
        spanPrompt: spanPrompt,
        spanCompletion: spanCompletion,
        logContent: logContent,
      }),
    ).toEqual({
      promptMessages: spanPrompt,
      completionMessages: spanCompletion,
      fromLogEvents: false,
    });
  });

  test("not read, or nothing in them: the span's own, not from the log events", () => {
    for (const content of [null, emptyContent()]) {
      expect(
        mergeSpanMessages({
          spanPrompt: [],
          spanCompletion: [],
          logContent: content,
        }),
      ).toEqual({
        promptMessages: [],
        completionMessages: [],
        fromLogEvents: false,
      });
    }
  });

  test("instructions sent apart from the history lead the prompt, once", () => {
    const withInstructions: LlmCallContent = {
      ...logContent,
      systemInstructions: "Answer in one sentence.",
      input: logContent.input.slice(1),
    };

    expect(
      mergeSpanMessages({
        spanPrompt: [],
        spanCompletion: [],
        logContent: withInstructions,
      }).promptMessages,
    ).toEqual([
      message("system", "Answer in one sentence."),
      message("user", "Say this is a test."),
    ]);

    // A history with its own system message is not given a second one.
    expect(
      mergeSpanMessages({
        spanPrompt: [],
        spanCompletion: [],
        logContent: { ...logContent, systemInstructions: "Again." },
      }).promptMessages[0],
    ).toEqual(message("system", "You are a helpful assistant."));
  });

  test.each([
    [GenAiLogEventFixture.JavaContent],
    [GenAiLogEventFixture.PythonOpenAiV2True],
    [GenAiLogEventFixture.PythonOpenAiV2EventOnly],
  ])("%s reads the same", (fixture: GenAiLogEventFixture) => {
    const messages: LlmSpanMessages = mergeSpanMessages({
      spanPrompt: [],
      spanCompletion: [],
      logContent: readSpanLogEventContent(
        logsOf(fixture, firstSpan(fixture)).map(toLogEventRecord),
      ),
    });

    expect(messages.promptMessages).toEqual([
      message("system", "You are a helpful assistant."),
      message("user", "Say this is a test."),
    ]);
    expect(messages.completionMessages).toEqual([
      message("assistant", FAKE_ANSWER),
    ]);
  });
});

describe("reading one span's log events", () => {
  test("through the Log model, the span's records in its window, oldest first, a bounded page", async () => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    const span: StoredGenAiSpan = firstSpan(
      GenAiLogEventFixture.JavaScriptContent,
    );
    const getList: ReturnType<typeof jest.spyOn> = jest
      .spyOn(AnalyticsModelAPI, "getList")
      .mockResolvedValue(
        listOf(logsOf(GenAiLogEventFixture.JavaScriptContent, span)) as never,
      );

    const content: LlmCallContent = await fetchSpanLogEventContent({
      traceId: span.traceId,
      spanId: span.spanId,
      startMs: span.startMs,
      endMs: span.endMs,
    });

    expect(content.output).toHaveLength(1);

    const request: JSONObject = getList.mock.calls[0]![0] as JSONObject;
    expect(request["modelType"]).toBe(Log);
    expect(request["limit"]).toBe(LLM_SPAN_LOG_EVENT_LIMIT);
    expect(request["skip"]).toBe(0);
    expect(request["sort"]).toEqual({ time: SortOrder.Ascending });
    expect(request["select"]).toEqual({
      time: true,
      timeUnixNano: true,
      observedTimeUnixNano: true,
      attributes: true,
      body: true,
      spanId: true,
      traceId: true,
    });

    const query: JSONObject = request["query"] as JSONObject;
    expect(query["projectId"]).toEqual(PROJECT_ID);
    expect(query["traceId"]).toBe(span.traceId);
    expect(query["spanId"]).toBe(span.spanId);
  });

  test("a read the server refuses is thrown as it came", async () => {
    const refusal: HTTPErrorResponse = new HTTPErrorResponse(403, {}, {});
    jest
      .spyOn(AnalyticsModelAPI, "getList")
      .mockRejectedValue(refusal as never);

    await expect(
      fetchSpanLogEventContent({
        traceId: "t",
        spanId: "s",
        startMs: 1,
        endMs: 2,
      }),
    ).rejects.toBe(refusal);
  });
});

describe("the AI call panel", () => {
  const span: StoredGenAiSpan = firstSpan(GenAiLogEventFixture.JavaContent);

  function renderPanel(
    overrides: Partial<React.ComponentProps<typeof LlmSpanPanel>> = {},
  ): void {
    render(
      <LlmSpanPanel
        attributes={SILENT_SPAN_ATTRIBUTES}
        traceId={span.traceId}
        spanId={span.spanId}
        startTimeUnixNano={span.startTimeUnixNano}
        endTimeUnixNano={span.endTimeUnixNano}
        {...overrides}
      />,
    );
  }

  test("a call that sent its prompt and answer as log events shows them, and says where they came from", async () => {
    let resolveList: (value: ListResult<Log>) => void = () => {};
    const getList: ReturnType<typeof jest.spyOn> = jest
      .spyOn(AnalyticsModelAPI, "getList")
      .mockImplementation((() => {
        return new Promise<ListResult<Log>>(
          (resolve: (value: ListResult<Log>) => void) => {
            resolveList = resolve;
          },
        );
      }) as never);

    renderPanel();

    // While it reads them: a polite status line, where the source line goes.
    const loading: HTMLElement = screen.getByTestId(
      "llm-span-log-events-loading",
    );

    expect(loading).toHaveTextContent("Reading this call's log events…");
    expect(loading).toHaveAttribute("role", "status");

    resolveList(listOf(logsOf(GenAiLogEventFixture.JavaContent, span)));

    expect(
      await screen.findByTestId("llm-span-log-events-source"),
    ).toHaveTextContent("Read from this call's log events");
    expect(
      screen.queryByTestId("llm-span-log-events-loading"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Say this is a test.")).toBeInTheDocument();
    expect(
      screen.getByText("You are a helpful assistant."),
    ).toBeInTheDocument();
    expect(screen.getByText(FAKE_ANSWER)).toBeInTheDocument();
    expect(
      screen
        .getAllByTestId("llm-markdown")
        .map((element: HTMLElement): string => {
          return element.textContent || "";
        }),
    ).toEqual([
      "You are a helpful assistant.",
      "Say this is a test.",
      FAKE_ANSWER,
    ]);
    expect(screen.getByText("Prompt")).toBeInTheDocument();
    expect(screen.getByText("Completion")).toBeInTheDocument();
    expect(getList).toHaveBeenCalledTimes(1);
  });

  test("a reader who may not read logs is told why the prompt and answer are not shown", async () => {
    jest
      .spyOn(AnalyticsModelAPI, "getList")
      .mockRejectedValue(new HTTPErrorResponse(403, {}, {}) as never);

    renderPanel();

    const note: HTMLElement = await screen.findByTestId(
      "llm-span-log-events-note",
    );

    expect(note).toHaveAttribute("data-state", "notAllowed");
    expect(note).toHaveTextContent(
      "Any prompts and answers sent as log events are hidden: you need permission to read the logs of the app that sent them.",
    );
    // What a permission hides is a quiet note, not an alarm.
    expect(note.className).toContain("bg-gray-50");
    expect(note).not.toHaveAttribute("role");
    expect(
      screen.queryByTestId("llm-span-log-events-retry"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("llm-span-log-events-source"),
    ).not.toBeInTheDocument();
  });

  test("a read that fails says so, and Try again reads them again", async () => {
    const getList: ReturnType<typeof jest.spyOn> = jest
      .spyOn(AnalyticsModelAPI, "getList")
      .mockRejectedValueOnce(new Error("Network Error") as never)
      .mockResolvedValueOnce(
        listOf(logsOf(GenAiLogEventFixture.JavaContent, span)) as never,
      );

    renderPanel();

    const note: HTMLElement = await screen.findByTestId(
      "llm-span-log-events-note",
    );

    expect(note).toHaveAttribute("data-state", "failed");
    expect(note).toHaveTextContent(
      "The logs couldn't be read, so any prompts and answers sent as log events aren't shown.",
    );
    // It takes the place of the read in progress: said out loud, in amber.
    expect(note).toHaveAttribute("role", "alert");
    expect(note.className).toContain("bg-amber-50");
    expect(
      within(note).getByRole("button", { name: "Try again" }),
    ).toHaveAttribute("type", "button");

    fireEvent.click(screen.getByTestId("llm-span-log-events-retry"));

    expect(
      await screen.findByTestId("llm-span-log-events-source"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("llm-span-log-events-note"),
    ).not.toBeInTheDocument();
    expect(screen.getByText(FAKE_ANSWER)).toBeInTheDocument();
    expect(getList).toHaveBeenCalledTimes(2);
  });

  test("content capture off: read, nothing to show, nothing said", async () => {
    const silent: StoredGenAiSpan = firstSpan(
      GenAiLogEventFixture.JavaNoContent,
    );
    jest
      .spyOn(AnalyticsModelAPI, "getList")
      .mockResolvedValue(
        listOf(logsOf(GenAiLogEventFixture.JavaNoContent, silent)) as never,
      );

    renderPanel({
      traceId: silent.traceId,
      spanId: silent.spanId,
      startTimeUnixNano: silent.startTimeUnixNano,
      endTimeUnixNano: silent.endTimeUnixNano,
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId("llm-span-log-events-loading"),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("llm-span-log-events-source"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("llm-span-log-events-note"),
    ).not.toBeInTheDocument();
  });

  test("a span that records its prompt and answer reads no log", () => {
    const getList: ReturnType<typeof jest.spyOn> = jest.spyOn(
      AnalyticsModelAPI,
      "getList",
    );

    renderPanel({
      attributes: {
        ...SILENT_SPAN_ATTRIBUTES,
        "gen_ai.input.messages": JSON.stringify([
          { role: "user", content: "On the span" },
        ]),
        "gen_ai.output.messages": JSON.stringify([
          { role: "assistant", content: "Also on the span" },
        ]),
      },
    });

    expect(screen.getByText("On the span")).toBeInTheDocument();
    expect(getList).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("llm-span-log-events-loading"),
    ).not.toBeInTheDocument();
  });

  test("without its trace, span or time - or not an AI call - no log is read", () => {
    const getList: ReturnType<typeof jest.spyOn> = jest.spyOn(
      AnalyticsModelAPI,
      "getList",
    );

    renderPanel({ traceId: undefined });
    cleanup();
    renderPanel({ spanId: "" });
    cleanup();
    renderPanel({ startTimeUnixNano: undefined });
    cleanup();
    renderPanel({ attributes: { "http.route": "/orders" } });

    expect(getList).not.toHaveBeenCalled();
  });
});
