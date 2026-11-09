import { afterEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import logger from "../../../Server/Utils/Logger";
import LlmConversationService, {
  LlmConversationDetail,
  LlmConversationDetailQuery,
} from "../../../Server/Services/LlmConversationService";
import SpanService from "../../../Server/Services/SpanService";
import LogService from "../../../Server/Services/LogService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import TelemetryReadScopeUtil, {
  TelemetryReadScope,
} from "../../../Server/Utils/Telemetry/TelemetryReadScope";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import {
  LlmConversationKeyKind,
  LlmConversationListItem,
  LlmConversationListResponse,
  LlmConversationSort,
  LlmLogEventsRead,
  emptyIssueCounts,
} from "../../../Types/Telemetry/LlmConversationApi";
import { LlmCallKind } from "../../../Types/Telemetry/LlmCallKind";
import LlmConversationTranscriptUtil, {
  LlmConversationCall,
  LlmTranscript,
  LlmTranscriptStep,
  LlmTranscriptStepType,
} from "../../../Utils/Telemetry/LlmConversationTranscript";
import LlmMessageParser, {
  LlmCallContent,
  LlmMessage,
} from "../../../Utils/Telemetry/LlmMessageParser";
import { LlmLogEventRecord } from "../../../Utils/Telemetry/LlmLogEvents";
import {
  GenAiLogEventFixture,
  StoredGenAiSpan,
  loadGenAiLogEventFixture,
  toStoredLogRecords,
  toStoredSpans,
} from "../../Helpers/GenAiLogEventFixtures";

/*
 * A conversation whose prompts and answers came as GenAI log events, read
 * by LlmConversationService with the span and log tables served from what
 * the OpenTelemetry instrumentations really sent
 * (Tests/Fixtures/GenAiLogEvents): which calls are read for, by whom, what
 * the reader is told when the logs could not be read, and the list titles.
 */

const PROJECT: ObjectID = new ObjectID("9900000000000000000000a1");
const CHAT_APP: ObjectID = new ObjectID("9900000000000000000000b1");
const OTHER_APP: ObjectID = new ObjectID("9900000000000000000000b2");

const ARRIVED_AT_NANO: string = "1794199999000000000";
const FAKE_ANSWER: string =
  "This is a test answer from the fake OpenAI server.";

const EVERY_LOG: TelemetryReadScope =
  TelemetryReadScopeUtil.getUnrestrictedScope();

function spansOf(fixture: GenAiLogEventFixture): Array<StoredGenAiSpan> {
  return toStoredSpans(loadGenAiLogEventFixture(fixture));
}

// A call row as the conversation's calls read returns it.
function callRow(
  span: StoredGenAiSpan,
  overrides: JSONObject = {},
): JSONObject {
  return {
    spanId: span.spanId,
    traceId: span.traceId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    startMs: span.startMs,
    endMs: span.endMs,
    statusCode: 1,
    statusMessage: "",
    llmCallKind: LlmCallKind.Answer,
    llmSystem: "openai",
    llmRequestModel: "gpt-4o-mini",
    attributes: span.attributes,
    events: JSON.stringify(span.events),
    primaryEntityId: CHAT_APP.toString(),
    ...overrides,
  };
}

// A stored record as the log read's SELECT returns it.
function logRow(record: LlmLogEventRecord, index: number): JSONObject {
  return {
    traceId: record.traceId || "",
    spanId: record.spanId || "",
    timeUnixNano: String(record.timeUnixNano || "0"),
    observedTimeUnixNano: String(record.observedTimeUnixNano || "0"),
    rowOffset: String(index),
    attributes: record.attributes as JSONObject,
    body: typeof record.body === "string" ? record.body : "",
  };
}

function logRowsOf(fixture: GenAiLogEventFixture): Array<JSONObject> {
  return toStoredLogRecords(loadGenAiLogEventFixture(fixture), {
    arrivedAtNano: ARRIVED_AT_NANO,
  })
    .map(logRow)
    .reverse(); // Newest first, as the read orders them.
}

function answer(rows: Array<JSONObject>): unknown {
  return {
    json: async (): Promise<{ data: Array<JSONObject> }> => {
      return { data: rows };
    },
  };
}

interface Spies {
  span: ReturnType<typeof jest.spyOn>;
  log: ReturnType<typeof jest.spyOn>;
}

function serve(data: {
  calls: Array<JSONObject>;
  logs?: Array<JSONObject> | Error;
}): Spies {
  return {
    span: jest.spyOn(SpanService, "executeQuery").mockImplementation((() => {
      return Promise.resolve(answer(data.calls));
    }) as never),
    log: jest.spyOn(LogService, "executeQuery").mockImplementation((() => {
      return data.logs instanceof Error
        ? Promise.reject(data.logs)
        : Promise.resolve(answer(data.logs || []));
    }) as never),
  };
}

function detailQuery(
  logScope: TelemetryReadScope | null,
): LlmConversationDetailQuery {
  return {
    projectId: PROJECT,
    key: { kind: LlmConversationKeyKind.Conversation, value: "conv-1" },
    startTime: new Date("2026-11-08T00:00:00.000Z"),
    endTime: new Date("2026-11-10T00:00:00.000Z"),
    logScope: logScope,
  };
}

function stepTexts(
  transcript: LlmTranscript,
  type: LlmTranscriptStepType,
): Array<string> {
  return transcript.steps
    .filter((step: LlmTranscriptStep): boolean => {
      return step.type === type;
    })
    .map((step: LlmTranscriptStep): string => {
      return step.text;
    });
}

function sentLogStatement(spies: Spies): Statement {
  expect(spies.log).toHaveBeenCalledTimes(1);
  return spies.log.mock.calls[0]![0] as Statement;
}

const THE_QUESTIONS: Array<string> = [
  "Say this is a test.",
  "What is the weather in Paris?",
  "Write a haiku about logs.",
  "Stream me an answer.",
];

afterEach(() => {
  jest.restoreAllMocks();
  jest.mocked(logger.warn).mockClear();
});

describe("a conversation whose prompts and answers came as log events", () => {
  test.each([
    [GenAiLogEventFixture.JavaScriptContent],
    [GenAiLogEventFixture.JavaContent],
    [GenAiLogEventFixture.PythonOpenAiV2True],
    [GenAiLogEventFixture.PythonOpenAiV2EventOnly],
    [GenAiLogEventFixture.PythonGenAiOpenAiEventOnly],
  ])(
    "%s: read for a reader of the app's logs, every call's own",
    async (fixture: GenAiLogEventFixture) => {
      const spans: Array<StoredGenAiSpan> = spansOf(fixture);
      const spies: Spies = serve({
        calls: spans.map((span: StoredGenAiSpan): JSONObject => {
          return callRow(span);
        }),
        logs: logRowsOf(fixture),
      });

      const detail: LlmConversationDetail =
        await LlmConversationService.getConversation(detailQuery(EVERY_LOG));

      expect(detail.logEvents).toBe(LlmLogEventsRead.Read);
      expect(detail.transcript.contentRecorded).toBe(true);
      expect(
        stepTexts(detail.transcript, LlmTranscriptStepType.UserMessage).slice(
          0,
          4,
        ),
      ).toEqual(THE_QUESTIONS);
      expect(
        stepTexts(detail.transcript, LlmTranscriptStepType.AssistantMessage),
      ).toContain(FAKE_ANSWER);
      expect(detail.transcript.instructions).toBe(
        "You are a helpful assistant.",
      );

      // One log read, for these calls' spans, in the project.
      const sent: Statement = sentLogStatement(spies);
      expect(sent.query).toContain("FROM LogItemV3");
      expect(Object.values(sent.query_params)).toContain(PROJECT.toString());
      expect(Object.values(sent.query_params)).toContainEqual(
        expect.arrayContaining(
          spans.map((span: StoredGenAiSpan): string => {
            return span.spanId;
          }),
        ),
      );
    },
  );

  test("a reader who may read no log: the spans alone, and it says why", async () => {
    const spies: Spies = serve({
      calls: spansOf(GenAiLogEventFixture.JavaScriptContent).map(
        (span: StoredGenAiSpan): JSONObject => {
          return callRow(span);
        },
      ),
      logs: logRowsOf(GenAiLogEventFixture.JavaScriptContent),
    });

    const detail: LlmConversationDetail =
      await LlmConversationService.getConversation(detailQuery(null));

    expect(detail.logEvents).toBe(LlmLogEventsRead.NotAllowed);
    expect(spies.log).not.toHaveBeenCalled();
    expect(
      stepTexts(detail.transcript, LlmTranscriptStepType.UserMessage),
    ).toEqual([]);
    expect(
      stepTexts(detail.transcript, LlmTranscriptStepType.AssistantMessage),
    ).toEqual([]);
  });

  test("a reader of other apps' logs only: none read, and it says why", async () => {
    const spies: Spies = serve({
      calls: spansOf(GenAiLogEventFixture.JavaContent).map(
        (span: StoredGenAiSpan): JSONObject => {
          return callRow(span);
        },
      ),
      logs: logRowsOf(GenAiLogEventFixture.JavaContent),
    });

    const detail: LlmConversationDetail =
      await LlmConversationService.getConversation(
        detailQuery({ readableIds: [OTHER_APP.toString()], blockedIds: [] }),
      );

    expect(detail.logEvents).toBe(LlmLogEventsRead.NotAllowed);
    expect(spies.log).not.toHaveBeenCalled();
    expect(detail.transcript.contentRecorded).toBe(false);
  });

  test("an app blocked to the reader is not read, whatever else they may read", async () => {
    const spies: Spies = serve({
      calls: spansOf(GenAiLogEventFixture.JavaContent).map(
        (span: StoredGenAiSpan): JSONObject => {
          return callRow(span);
        },
      ),
      logs: logRowsOf(GenAiLogEventFixture.JavaContent),
    });

    const detail: LlmConversationDetail =
      await LlmConversationService.getConversation(
        detailQuery({ readableIds: null, blockedIds: [CHAT_APP.toString()] }),
      );

    expect(detail.logEvents).toBe(LlmLogEventsRead.NotAllowed);
    expect(spies.log).not.toHaveBeenCalled();
  });

  test("a reader of one of two apps' logs: that app's calls read, the other's left, and it says some were not", async () => {
    const spans: Array<StoredGenAiSpan> = spansOf(
      GenAiLogEventFixture.JavaScriptContent,
    );
    const spies: Spies = serve({
      calls: spans.map((span: StoredGenAiSpan, index: number): JSONObject => {
        // The first call is another app's.
        return callRow(
          span,
          index === 0 ? { primaryEntityId: OTHER_APP.toString() } : {},
        );
      }),
      logs: logRowsOf(GenAiLogEventFixture.JavaScriptContent),
    });

    const detail: LlmConversationDetail =
      await LlmConversationService.getConversation(
        detailQuery({ readableIds: [CHAT_APP.toString()], blockedIds: [] }),
      );

    expect(detail.logEvents).toBe(LlmLogEventsRead.NotAllowed);

    // The other app's call - the system prompt and the first question - stays unread.
    expect(
      stepTexts(detail.transcript, LlmTranscriptStepType.UserMessage),
    ).not.toContain("Say this is a test.");
    expect(
      stepTexts(detail.transcript, LlmTranscriptStepType.UserMessage),
    ).toContain("What is the weather in Paris?");

    // Only the readable app's spans are asked for, in its log scope.
    const sent: Statement = sentLogStatement(spies);
    const params: Array<unknown> = Object.values(sent.query_params);
    expect(params).toContainEqual(
      spans.slice(1).map((span: StoredGenAiSpan): string => {
        return span.spanId;
      }),
    );
    expect(sent.query).toContain("AND primaryEntityId IN (");
    expect(params).toContainEqual([CHAT_APP.toString()]);
  });

  test("spans that record their prompt and answer: no log is read", async () => {
    const spies: Spies = serve({
      calls: spansOf(GenAiLogEventFixture.PythonOpenAiV2SpanAndEvent).map(
        (span: StoredGenAiSpan): JSONObject => {
          return callRow(span);
        },
      ),
      logs: logRowsOf(GenAiLogEventFixture.PythonOpenAiV2SpanAndEvent),
    });

    const detail: LlmConversationDetail =
      await LlmConversationService.getConversation(detailQuery(EVERY_LOG));

    expect(detail.logEvents).toBe(LlmLogEventsRead.NotNeeded);
    expect(spies.log).not.toHaveBeenCalled();
    expect(
      stepTexts(detail.transcript, LlmTranscriptStepType.UserMessage).slice(
        0,
        4,
      ),
    ).toEqual(THE_QUESTIONS);
  });

  test("a span with its prompt only: its answer from the logs, its own prompt kept, each shown once", async () => {
    const spans: Array<StoredGenAiSpan> = spansOf(
      GenAiLogEventFixture.JavaScriptContent,
    );
    serve({
      calls: [
        callRow(spans[0]!, {
          attributes: {
            ...spans[0]!.attributes,
            "gen_ai.input.messages": JSON.stringify([
              { role: "user", content: "Asked on the span" },
            ]),
          },
        }),
      ],
      logs: logRowsOf(GenAiLogEventFixture.JavaScriptContent),
    });

    const detail: LlmConversationDetail =
      await LlmConversationService.getConversation(detailQuery(EVERY_LOG));

    expect(detail.logEvents).toBe(LlmLogEventsRead.Read);
    expect(
      stepTexts(detail.transcript, LlmTranscriptStepType.UserMessage),
    ).toEqual(["Asked on the span"]);
    expect(
      stepTexts(detail.transcript, LlmTranscriptStepType.AssistantMessage),
    ).toEqual([FAKE_ANSWER]);
  });

  test("records that name the trace but no span: given to the trace's one answer", async () => {
    const spans: Array<StoredGenAiSpan> = spansOf(
      GenAiLogEventFixture.JavaContent,
    );
    serve({
      calls: [callRow(spans[0]!)],
      logs: logRowsOf(GenAiLogEventFixture.JavaContent).map(
        (row: JSONObject): JSONObject => {
          return { ...row, spanId: "" };
        },
      ),
    });

    const detail: LlmConversationDetail =
      await LlmConversationService.getConversation(detailQuery(EVERY_LOG));

    expect(detail.logEvents).toBe(LlmLogEventsRead.Read);
    expect(
      stepTexts(detail.transcript, LlmTranscriptStepType.UserMessage),
    ).toEqual(["Say this is a test."]);
  });

  test("the log read fails: the spans alone, and it says they could not be read", async () => {
    serve({
      calls: spansOf(GenAiLogEventFixture.JavaScriptContent).map(
        (span: StoredGenAiSpan): JSONObject => {
          return callRow(span);
        },
      ),
      logs: new Error("Timeout exceeded: elapsed 12.1 seconds"),
    });

    const detail: LlmConversationDetail =
      await LlmConversationService.getConversation(detailQuery(EVERY_LOG));

    expect(detail.logEvents).toBe(LlmLogEventsRead.Failed);
    // Every call is still there, as its span recorded it.
    expect(detail.transcript.callCount).toBe(6);
    expect(
      stepTexts(detail.transcript, LlmTranscriptStepType.UserMessage),
    ).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Timeout exceeded"),
    );
  });

  test("content capture off: read, and nothing to show", async () => {
    serve({
      calls: spansOf(GenAiLogEventFixture.JavaScriptNoContent).map(
        (span: StoredGenAiSpan): JSONObject => {
          return callRow(span);
        },
      ),
      logs: logRowsOf(GenAiLogEventFixture.JavaScriptNoContent),
    });

    const detail: LlmConversationDetail =
      await LlmConversationService.getConversation(detailQuery(EVERY_LOG));

    expect(detail.logEvents).toBe(LlmLogEventsRead.Read);
    expect(
      stepTexts(detail.transcript, LlmTranscriptStepType.UserMessage),
    ).toEqual([]);
    expect(
      stepTexts(detail.transcript, LlmTranscriptStepType.AssistantMessage),
    ).toEqual([]);
    // Each answer reads as one whose content was not recorded.
    expect(
      stepTexts(detail.transcript, LlmTranscriptStepType.SilentAnswer).length,
    ).toBeGreaterThan(0);
  });
});

describe("which calls are read for", () => {
  const content: (input: number, output: number) => LlmCallContent = (
    input: number,
    output: number,
  ): LlmCallContent => {
    const message: (role: string) => LlmMessage = (
      role: string,
    ): LlmMessage => {
      return LlmMessageParser.normalizeMessages(
        [{ role: role, content: "Hi" }],
        role,
      )[0]!;
    };

    return {
      systemInstructions: "",
      input: input ? [message("user")] : [],
      output: output ? [message("assistant")] : [],
      finishReasons: [],
      tool: null,
      evaluations: [],
      errorType: "",
    };
  };

  function conversationCall(
    spanId: string,
    kind: LlmCallKind,
    callContent: LlmCallContent,
  ): LlmConversationCall {
    return {
      spanId: spanId,
      traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa01",
      parentSpanId: "",
      name: "chat",
      startMs: 1000,
      endMs: 2000,
      statusIsError: false,
      statusMessage: "",
      kind: kind,
      model: "gpt-4o-mini",
      provider: "openai",
      agentName: "",
      toolName: "",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      issues: [],
      userLabel: "",
      serviceId: CHAT_APP.toString(),
      content: callContent,
    };
  }

  test("answers that lack their prompt or their answer; never tool runs, agents or a call without a span", () => {
    const calls: Array<LlmConversationCall> = [
      conversationCall("b000000000000001", LlmCallKind.Answer, content(1, 1)),
      conversationCall("b000000000000002", LlmCallKind.Answer, content(1, 0)),
      conversationCall("b000000000000003", LlmCallKind.Answer, content(0, 1)),
      conversationCall("b000000000000004", LlmCallKind.Answer, content(0, 0)),
      conversationCall("b000000000000005", LlmCallKind.Tool, content(0, 0)),
      conversationCall("b000000000000006", LlmCallKind.Agent, content(0, 0)),
      conversationCall("", LlmCallKind.Answer, content(0, 0)),
    ];

    expect(
      LlmConversationService.getCallsLackingContent(calls).map(
        (call: LlmConversationCall): string => {
          return call.spanId;
        },
      ),
    ).toEqual(["b000000000000002", "b000000000000003", "b000000000000004"]);
  });

  test("a conversation of tool runs only reads no log", async () => {
    const spy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      LogService,
      "executeQuery",
    );

    expect(
      await LlmConversationService.addLogEventContent({
        projectId: PROJECT,
        calls: [
          conversationCall("b000000000000005", LlmCallKind.Tool, content(0, 0)),
        ],
        logScope: EVERY_LOG,
      }),
    ).toBe(LlmLogEventsRead.NotNeeded);
    expect(spy).not.toHaveBeenCalled();
  });

  test("a call with no app is read for whoever may read logs", async () => {
    const spans: Array<StoredGenAiSpan> = spansOf(
      GenAiLogEventFixture.JavaContent,
    );
    serve({
      calls: [],
      logs: logRowsOf(GenAiLogEventFixture.JavaContent),
    });

    const call: LlmConversationCall = LlmConversationService.toCall(
      callRow(spans[0]!, { primaryEntityId: "" }),
    );

    expect(
      await LlmConversationService.addLogEventContent({
        projectId: PROJECT,
        calls: [call],
        logScope: { readableIds: [OTHER_APP.toString()], blockedIds: [] },
      }),
    ).toBe(LlmLogEventsRead.Read);
    expect(LlmConversationTranscriptUtil.build([call]).contentRecorded).toBe(
      true,
    );
  });
});

describe("conversation list titles from log events", () => {
  function listItem(
    overrides: Partial<LlmConversationListItem>,
  ): LlmConversationListItem {
    return {
      key: "t:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa01",
      kind: LlmConversationKeyKind.Request,
      conversationId: "",
      traceId: "",
      title: "",
      startedAt: new Date(0).toISOString(),
      endedAt: new Date(0).toISOString(),
      durationMs: 0,
      callCount: 1,
      answerCount: 1,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      issueCounts: emptyIssueCounts(),
      slowestAnswerMs: 0,
      models: [],
      people: [],
      serviceIds: [CHAT_APP.toString()],
      agents: [],
      ...overrides,
    };
  }

  const spans: Array<StoredGenAiSpan> = spansOf(
    GenAiLogEventFixture.JavaScriptContent,
  );
  const first: StoredGenAiSpan = spans[0]!;
  const second: StoredGenAiSpan = spans[1]!;

  function untitledRows(): Array<LlmConversationListItem> {
    return [
      listItem({
        key: `t:${first.traceId}`,
        traceId: first.traceId,
        startedAt: new Date(first.startMs).toISOString(),
      }),
      listItem({
        key: `t:${second.traceId}`,
        traceId: second.traceId,
        startedAt: new Date(second.startMs).toISOString(),
        title: "Titled on its span",
      }),
    ];
  }

  test("a row whose spans recorded no question is titled from its first call's log events", async () => {
    const spies: Spies = serve({
      calls: [],
      logs: logRowsOf(GenAiLogEventFixture.JavaScriptContent),
    });
    const rows: Array<LlmConversationListItem> = untitledRows();

    await LlmConversationService.addLogEventTitles({
      projectId: PROJECT,
      conversations: rows,
      logScope: EVERY_LOG,
    });

    expect(rows[0]!.title).toBe("Say this is a test.");
    // A row with a title of its own keeps it and is not looked for.
    expect(rows[1]!.title).toBe("Titled on its span");
    const sent: Statement = sentLogStatement(spies);
    expect(Object.values(sent.query_params)).toContainEqual([first.traceId]);
    expect(Object.values(sent.query_params)).not.toContainEqual([
      second.traceId,
    ]);
  });

  test("a reader who may read no log, or not that app's: nothing read, the rows as they were", async () => {
    for (const logScope of [
      null,
      { readableIds: [OTHER_APP.toString()], blockedIds: [] },
      { readableIds: null, blockedIds: [CHAT_APP.toString()] },
    ]) {
      const spies: Spies = serve({
        calls: [],
        logs: logRowsOf(GenAiLogEventFixture.JavaScriptContent),
      });
      const rows: Array<LlmConversationListItem> = untitledRows();

      await LlmConversationService.addLogEventTitles({
        projectId: PROJECT,
        conversations: rows,
        logScope: logScope,
      });

      expect(spies.log).not.toHaveBeenCalled();
      expect(rows[0]!.title).toBe("");
      jest.restoreAllMocks();
    }
  });

  test("a row without a trace is not looked for", async () => {
    const spies: Spies = serve({ calls: [], logs: [] });
    const rows: Array<LlmConversationListItem> = [listItem({ traceId: "" })];

    await LlmConversationService.addLogEventTitles({
      projectId: PROJECT,
      conversations: rows,
      logScope: EVERY_LOG,
    });

    expect(spies.log).not.toHaveBeenCalled();
  });

  test("a read that fails leaves the rows as they were, and the list still answers", async () => {
    serve({ calls: [], logs: new Error("Timeout exceeded") });
    const rows: Array<LlmConversationListItem> = untitledRows();

    await expect(
      LlmConversationService.addLogEventTitles({
        projectId: PROJECT,
        conversations: rows,
        logScope: EVERY_LOG,
      }),
    ).resolves.toBeUndefined();
    expect(rows[0]!.title).toBe("");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Timeout exceeded"),
    );
  });

  test("the list read titles its rows for a reader of the logs", async () => {
    serve({
      calls: [
        {
          conversationKey: `t:${first.traceId}`,
          firstTraceId: first.traceId,
          title: "",
          startedAtMs: first.startMs,
          endedAtMs: first.endMs,
          callCount: 1,
          answerCount: 1,
          serviceIds: [CHAT_APP.toString()],
        },
      ],
      logs: logRowsOf(GenAiLogEventFixture.JavaScriptContent),
    });

    const response: LlmConversationListResponse =
      await LlmConversationService.listConversations({
        projectId: PROJECT,
        startTime: new Date("2026-11-08T00:00:00.000Z"),
        endTime: new Date("2026-11-10T00:00:00.000Z"),
        sort: LlmConversationSort.Newest,
        limit: 25,
        skip: 0,
        includeSummary: false,
        logScope: EVERY_LOG,
      });

    expect(response.conversations).toHaveLength(1);
    expect(response.conversations[0]!.title).toBe("Say this is a test.");
  });
});
