import InvestigationRecorder from "../../../../../Server/Utils/AI/Eval/InvestigationRecorder";
import { ObservabilityAssistantToolOutcome } from "../../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import AIAgentRunLimitsHelper from "../../../../../Types/AI/AIAgentRunLimits";
import { AIChatCitationTargetType } from "../../../../../Types/AI/AIChatTypes";
import {
  INVESTIGATION_RECORDING_MAX_ARGUMENT_CHARACTERS,
  INVESTIGATION_RECORDING_MAX_RESULT_CHARACTERS,
  INVESTIGATION_RECORDING_MAX_TOOL_CALLS,
  INVESTIGATION_RECORDING_MAX_TOTAL_CHARACTERS,
  INVESTIGATION_RECORDING_RETENTION_IN_DAYS,
  INVESTIGATION_RECORDING_VERSION,
  InvestigationRecordedToolCall,
  InvestigationRecording,
  InvestigationRecordingInputs,
} from "../../../../../Types/AI/InvestigationRecording";
import { JSONObject } from "../../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT AN INVESTIGATION SAW, AS IT IS RECORDED (issue #6800):
 * Eval/InvestigationRecorder collects every tool call the agent loop hands
 * it (ObservabilityAssistant onToolOutcome) and turns them into the
 * recording AIRunRecording keeps, so the run can be replayed on the same
 * data after a prompt or model change.
 *
 * Under test: what a call is kept as (success or failure, the text the model
 * read, the facts it read with it), that the arguments are a copy taken when
 * the call ran, and every cap the recording is held to - the most calls, the
 * longest arguments, the longest result and the most text together. A call
 * past a cap is counted, never silently dropped, so a replay can say how
 * much of the run it could not follow.
 */

const PROMPT_TIME: string = "2026-11-10T08:30:00.000Z";

function inputs(): InvestigationRecordingInputs {
  return {
    contextText: "# Incident\nTitle: Checkout is failing",
    aiContext: null,
    promptTime: PROMPT_TIME,
    runLimits: AIAgentRunLimitsHelper.getDefault(),
    maxOutputTokens: 4096,
    excludedToolNames: ["get_ai_investigation", "start_investigation"],
    extraTools: [],
  };
}

function success(
  overrides: Partial<ObservabilityAssistantToolOutcome> = {},
): ObservabilityAssistantToolOutcome {
  return {
    toolName: "search_logs",
    toolArguments: { query: "checkout", severity: "Error" },
    success: true,
    textForLlm: "12 errors: connection refused",
    rowCount: 12,
    citationLabel: "Error logs of checkout",
    citationTarget: {
      type: AIChatCitationTargetType.Logs,
      params: { service: "checkout" },
    },
    isTruncated: false,
    durationMs: 41,
    ...overrides,
  };
}

function failure(
  overrides: Partial<ObservabilityAssistantToolOutcome> = {},
): ObservabilityAssistantToolOutcome {
  return {
    toolName: "query_metrics",
    toolArguments: { metricName: "http.server.duration" },
    success: false,
    textForLlm: "Error: no metric named http.server.duration in this project.",
    durationMs: 7,
    ...overrides,
  };
}

// A call whose text is exactly `length` characters long.
function withText(
  length: number,
  index: number = 0,
): ObservabilityAssistantToolOutcome {
  return success({
    toolArguments: { page: index },
    textForLlm: "x".repeat(length),
  });
}

function recordingOf(recorder: InvestigationRecorder): InvestigationRecording {
  return recorder.getRecording(inputs());
}

function texts(recorder: InvestigationRecorder): Array<number | null> {
  return recordingOf(recorder).toolCalls.map(
    (call: InvestigationRecordedToolCall): number | null => {
      return call.text === null ? null : call.text.length;
    },
  );
}

describe("the recording's caps", () => {
  test("are the numbers the issue settled on, and a recording is kept 30 days", () => {
    expect(INVESTIGATION_RECORDING_VERSION).toBe(1);
    expect(INVESTIGATION_RECORDING_RETENTION_IN_DAYS).toBe(30);
    expect(INVESTIGATION_RECORDING_MAX_TOOL_CALLS).toBe(300);
    expect(INVESTIGATION_RECORDING_MAX_RESULT_CHARACTERS).toBe(100000);
    expect(INVESTIGATION_RECORDING_MAX_TOTAL_CHARACTERS).toBe(1000000);
    expect(INVESTIGATION_RECORDING_MAX_ARGUMENT_CHARACTERS).toBe(10000);
  });

  test("a whole recording at its caps still fits what one result may be, ten times over", () => {
    expect(
      INVESTIGATION_RECORDING_MAX_TOTAL_CHARACTERS /
        INVESTIGATION_RECORDING_MAX_RESULT_CHARACTERS,
    ).toBe(10);
  });
});

describe("InvestigationRecorder: what a call is kept as", () => {
  test("a successful call keeps its tool, its arguments, the text the model read and the facts it read with it", () => {
    const recorder: InvestigationRecorder = new InvestigationRecorder();

    recorder.add(success());

    expect(recordingOf(recorder).toolCalls).toStrictEqual([
      {
        toolName: "search_logs",
        arguments: { query: "checkout", severity: "Error" },
        success: true,
        text: "12 errors: connection refused",
        rowCount: 12,
        citationLabel: "Error logs of checkout",
        citationTarget: {
          type: AIChatCitationTargetType.Logs,
          params: { service: "checkout" },
        },
        isTruncated: false,
        durationMs: 41,
      },
    ]);
  });

  test("a failed call is kept as a failure, with the error the model read as its text", () => {
    const recorder: InvestigationRecorder = new InvestigationRecorder();

    recorder.add(failure());

    // Nothing it was not given: no row count, citation or truncation.
    expect(recordingOf(recorder).toolCalls).toStrictEqual([
      {
        toolName: "query_metrics",
        arguments: { metricName: "http.server.duration" },
        success: false,
        text: "Error: no metric named http.server.duration in this project.",
        durationMs: 7,
      },
    ]);
  });

  test("a result that was cut short says so", () => {
    const recorder: InvestigationRecorder = new InvestigationRecorder();

    recorder.add(success({ isTruncated: true }));

    expect(recordingOf(recorder).toolCalls[0]!.isTruncated).toBe(true);
  });

  test("facts that are not numbers are left out rather than kept wrong", () => {
    const recorder: InvestigationRecorder = new InvestigationRecorder();

    recorder.add(
      success({
        rowCount: "12" as unknown as number,
        durationMs: undefined as unknown as number,
        citationLabel: undefined,
        citationTarget: undefined,
        isTruncated: undefined,
      }),
    );

    const call: InvestigationRecordedToolCall =
      recordingOf(recorder).toolCalls[0]!;

    expect(Object.keys(call).sort()).toEqual([
      "arguments",
      "success",
      "text",
      "toolName",
    ]);
  });

  test("text that is not a string is kept as no text, never as 'undefined'", () => {
    const recorder: InvestigationRecorder = new InvestigationRecorder();

    recorder.add(success({ textForLlm: undefined as unknown as string }));

    expect(recordingOf(recorder).toolCalls[0]!.text).toBe("");
  });

  test("calls are kept in the order the model made them", () => {
    const recorder: InvestigationRecorder = new InvestigationRecorder();

    recorder.add(success({ toolName: "search_logs" }));
    recorder.add(failure({ toolName: "query_metrics" }));
    recorder.add(success({ toolName: "query_traces" }));

    expect(
      recordingOf(recorder).toolCalls.map(
        (call: InvestigationRecordedToolCall): string => {
          return call.toolName;
        },
      ),
    ).toEqual(["search_logs", "query_metrics", "query_traces"]);
    expect(recorder.getToolCallCount()).toBe(3);
  });
});

describe("InvestigationRecorder: the arguments are the ones the call ran with", () => {
  test("a copy: changing the arguments after the call never changes the recording", () => {
    const recorder: InvestigationRecorder = new InvestigationRecorder();
    const toolArguments: JSONObject = {
      query: "checkout",
      window: { startTime: "2026-11-10T07:30:00.000Z" },
      services: ["checkout", "payments"],
    };

    recorder.add(success({ toolArguments }));

    (toolArguments["window"] as JSONObject)["startTime"] =
      "2026-11-10T08:00:00.000Z";
    (toolArguments["services"] as Array<string>).push("storefront");
    toolArguments["query"] = "changed";
    delete toolArguments["window"];

    expect(recordingOf(recorder).toolCalls[0]!.arguments).toEqual({
      query: "checkout",
      window: { startTime: "2026-11-10T07:30:00.000Z" },
      services: ["checkout", "payments"],
    });
  });

  test("the recording never holds the caller's own object", () => {
    const recorder: InvestigationRecorder = new InvestigationRecorder();
    const toolArguments: JSONObject = { query: "checkout" };

    recorder.add(success({ toolArguments }));

    expect(recordingOf(recorder).toolCalls[0]!.arguments).not.toBe(
      toolArguments,
    );
  });

  test("a call with no arguments is kept with none", () => {
    const recorder: InvestigationRecorder = new InvestigationRecorder();

    recorder.add(
      success({ toolArguments: undefined as unknown as JSONObject }),
    );
    recorder.add(success({ toolArguments: null as unknown as JSONObject }));

    expect(
      recordingOf(recorder).toolCalls.map(
        (call: InvestigationRecordedToolCall): JSONObject => {
          return call.arguments;
        },
      ),
    ).toEqual([{}, {}]);
    expect(recordingOf(recorder).toolCallsNotKept).toBe(0);
  });

  test(`arguments up to ${INVESTIGATION_RECORDING_MAX_ARGUMENT_CHARACTERS} characters are kept; one more and the call is counted, not kept`, () => {
    const recorder: InvestigationRecorder = new InvestigationRecorder();
    // '{"q":""}' is 8 characters: the value makes up the rest.
    const atTheCap: JSONObject = {
      q: "a".repeat(INVESTIGATION_RECORDING_MAX_ARGUMENT_CHARACTERS - 8),
    };
    const pastTheCap: JSONObject = {
      q: "a".repeat(INVESTIGATION_RECORDING_MAX_ARGUMENT_CHARACTERS - 7),
    };

    expect(JSON.stringify(atTheCap)).toHaveLength(
      INVESTIGATION_RECORDING_MAX_ARGUMENT_CHARACTERS,
    );

    recorder.add(success({ toolArguments: atTheCap }));
    recorder.add(success({ toolArguments: pastTheCap }));

    const recording: InvestigationRecording = recordingOf(recorder);

    expect(recording.toolCalls).toHaveLength(1);
    expect(recording.toolCalls[0]!.arguments).toEqual(atTheCap);
    expect(recording.toolCallsNotKept).toBe(1);
    expect(recorder.getToolCallCount()).toBe(1);
  });

  test("arguments that cannot be written as JSON are counted, not kept, and never throw into the run", () => {
    const recorder: InvestigationRecorder = new InvestigationRecorder();
    const circular: JSONObject = { query: "checkout" };
    circular["self"] = circular;

    expect(() => {
      recorder.add(success({ toolArguments: circular }));
      recorder.add(
        success({
          toolArguments: { count: BigInt(5) } as unknown as JSONObject,
        }),
      );
    }).not.toThrow();

    expect(recordingOf(recorder).toolCalls).toEqual([]);
    expect(recordingOf(recorder).toolCallsNotKept).toBe(2);
  });

  test("arguments that are not an object are counted, not kept", () => {
    const recorder: InvestigationRecorder = new InvestigationRecorder();

    recorder.add(
      success({ toolArguments: ["checkout"] as unknown as JSONObject }),
    );
    recorder.add(
      success({ toolArguments: "checkout" as unknown as JSONObject }),
    );
    recorder.add(success({ toolArguments: 5 as unknown as JSONObject }));

    expect(recordingOf(recorder).toolCalls).toEqual([]);
    expect(recordingOf(recorder).toolCallsNotKept).toBe(3);
  });

  test("a call not kept for its arguments takes no place among the calls kept", () => {
    const recorder: InvestigationRecorder = new InvestigationRecorder();

    for (
      let index: number = 0;
      index < INVESTIGATION_RECORDING_MAX_TOOL_CALLS - 1;
      index++
    ) {
      recorder.add(success({ toolArguments: { page: index } }));
    }

    recorder.add(
      success({
        toolArguments: {
          q: "a".repeat(INVESTIGATION_RECORDING_MAX_ARGUMENT_CHARACTERS),
        },
      }),
    );
    recorder.add(success({ toolArguments: { page: "last" } }));

    const recording: InvestigationRecording = recordingOf(recorder);

    expect(recording.toolCalls).toHaveLength(
      INVESTIGATION_RECORDING_MAX_TOOL_CALLS,
    );
    expect(
      recording.toolCalls[recording.toolCalls.length - 1]!.arguments,
    ).toEqual({ page: "last" });
    expect(recording.toolCallsNotKept).toBe(1);
  });
});

describe(`InvestigationRecorder: the most calls one recording keeps (${INVESTIGATION_RECORDING_MAX_TOOL_CALLS})`, () => {
  test("calls past the cap are counted, not kept, and the first ones stay", () => {
    const recorder: InvestigationRecorder = new InvestigationRecorder();

    for (
      let index: number = 0;
      index < INVESTIGATION_RECORDING_MAX_TOOL_CALLS + 5;
      index++
    ) {
      recorder.add(success({ toolArguments: { page: index } }));
    }

    const recording: InvestigationRecording = recordingOf(recorder);

    expect(recording.toolCalls).toHaveLength(
      INVESTIGATION_RECORDING_MAX_TOOL_CALLS,
    );
    expect(recording.toolCallsNotKept).toBe(5);
    expect(recorder.getToolCallCount()).toBe(
      INVESTIGATION_RECORDING_MAX_TOOL_CALLS,
    );
    expect(recording.toolCalls[0]!.arguments).toEqual({ page: 0 });
    expect(
      recording.toolCalls[recording.toolCalls.length - 1]!.arguments,
    ).toEqual({ page: INVESTIGATION_RECORDING_MAX_TOOL_CALLS - 1 });
  });

  test("past the cap even a failure, or a call with no text, is only counted", () => {
    const recorder: InvestigationRecorder = new InvestigationRecorder();

    for (
      let index: number = 0;
      index < INVESTIGATION_RECORDING_MAX_TOOL_CALLS;
      index++
    ) {
      recorder.add(success({ toolArguments: { page: index }, textForLlm: "" }));
    }

    recorder.add(failure());
    recorder.add(success({ textForLlm: "" }));

    expect(recordingOf(recorder).toolCalls).toHaveLength(
      INVESTIGATION_RECORDING_MAX_TOOL_CALLS,
    );
    expect(recordingOf(recorder).toolCallsNotKept).toBe(2);
  });
});

describe(`InvestigationRecorder: the longest result kept (${INVESTIGATION_RECORDING_MAX_RESULT_CHARACTERS} characters)`, () => {
  test("a result at the cap is kept whole; one character more is kept without its text", () => {
    const recorder: InvestigationRecorder = new InvestigationRecorder();

    recorder.add(withText(INVESTIGATION_RECORDING_MAX_RESULT_CHARACTERS, 1));
    recorder.add(
      withText(INVESTIGATION_RECORDING_MAX_RESULT_CHARACTERS + 1, 2),
    );

    expect(texts(recorder)).toEqual([
      INVESTIGATION_RECORDING_MAX_RESULT_CHARACTERS,
      null,
    ]);
  });

  test("a call kept without its text keeps everything else, and is not counted as a call not kept", () => {
    const recorder: InvestigationRecorder = new InvestigationRecorder();

    recorder.add(
      success({
        textForLlm: "y".repeat(
          INVESTIGATION_RECORDING_MAX_RESULT_CHARACTERS + 1,
        ),
      }),
    );

    const recording: InvestigationRecording = recordingOf(recorder);

    expect(recording.toolCalls).toStrictEqual([
      {
        toolName: "search_logs",
        arguments: { query: "checkout", severity: "Error" },
        success: true,
        text: null,
        rowCount: 12,
        citationLabel: "Error logs of checkout",
        citationTarget: {
          type: AIChatCitationTargetType.Logs,
          params: { service: "checkout" },
        },
        isTruncated: false,
        durationMs: 41,
      },
    ]);
    expect(recording.toolCallsNotKept).toBe(0);
  });

  test("a failure whose error is too long is kept as a failure without its text", () => {
    const recorder: InvestigationRecorder = new InvestigationRecorder();

    recorder.add(
      failure({
        textForLlm: "e".repeat(
          INVESTIGATION_RECORDING_MAX_RESULT_CHARACTERS + 1,
        ),
      }),
    );

    expect(recordingOf(recorder).toolCalls[0]).toMatchObject({
      success: false,
      text: null,
    });
  });

  test("a result too long to keep takes nothing from what the recording keeps together", () => {
    const recorder: InvestigationRecorder = new InvestigationRecorder();
    const fitting: number =
      INVESTIGATION_RECORDING_MAX_TOTAL_CHARACTERS /
      INVESTIGATION_RECORDING_MAX_RESULT_CHARACTERS;

    recorder.add(
      withText(INVESTIGATION_RECORDING_MAX_RESULT_CHARACTERS * 2, -1),
    );

    for (let index: number = 0; index < fitting; index++) {
      recorder.add(
        withText(INVESTIGATION_RECORDING_MAX_RESULT_CHARACTERS, index),
      );
    }

    // The one too long is left out; the next ten still fill the recording.
    expect(texts(recorder)).toEqual([
      null,
      ...new Array(fitting).fill(INVESTIGATION_RECORDING_MAX_RESULT_CHARACTERS),
    ]);
  });
});

describe(`InvestigationRecorder: the most text one recording keeps (${INVESTIGATION_RECORDING_MAX_TOTAL_CHARACTERS} characters)`, () => {
  test("texts are kept until the running total reaches the cap; later texts are kept as none", () => {
    const recorder: InvestigationRecorder = new InvestigationRecorder();
    const fitting: number =
      INVESTIGATION_RECORDING_MAX_TOTAL_CHARACTERS /
      INVESTIGATION_RECORDING_MAX_RESULT_CHARACTERS;

    for (let index: number = 0; index < fitting; index++) {
      recorder.add(
        withText(INVESTIGATION_RECORDING_MAX_RESULT_CHARACTERS, index),
      );
    }

    // Exactly at the cap: every one so far is kept.
    expect(texts(recorder)).toEqual(
      new Array(fitting).fill(INVESTIGATION_RECORDING_MAX_RESULT_CHARACTERS),
    );

    recorder.add(withText(1, 100));
    recorder.add(withText(5000, 101));

    const kept: Array<number | null> = texts(recorder);

    expect(kept.slice(fitting)).toEqual([null, null]);
    // The calls themselves are kept, and counted as calls kept.
    expect(recordingOf(recorder).toolCalls).toHaveLength(fitting + 2);
    expect(recordingOf(recorder).toolCallsNotKept).toBe(0);
  });

  test("the total counts every text kept, small ones too", () => {
    const recorder: InvestigationRecorder = new InvestigationRecorder();

    // 999,990 characters, then one of 20 that does not fit, then one of 10 that does.
    for (let index: number = 0; index < 9; index++) {
      recorder.add(
        withText(INVESTIGATION_RECORDING_MAX_RESULT_CHARACTERS, index),
      );
    }
    recorder.add(
      withText(INVESTIGATION_RECORDING_MAX_RESULT_CHARACTERS - 10, 9),
    );

    recorder.add(withText(20, 10));
    recorder.add(withText(10, 11));
    recorder.add(withText(1, 12));

    expect(texts(recorder).slice(10)).toEqual([null, 10, null]);
  });

  test("a failure's error counts toward the total like any text the model read", () => {
    const recorder: InvestigationRecorder = new InvestigationRecorder();

    for (let index: number = 0; index < 10; index++) {
      recorder.add(
        failure({
          toolArguments: { page: index },
          textForLlm: "e".repeat(INVESTIGATION_RECORDING_MAX_RESULT_CHARACTERS),
        }),
      );
    }

    recorder.add(success({ textForLlm: "one more row" }));

    expect(texts(recorder)[10]).toBeNull();
  });
});

describe("InvestigationRecorder.getRecording", () => {
  test("holds the version, the inputs it is given, every call kept and the count not kept", () => {
    const recorder: InvestigationRecorder = new InvestigationRecorder();
    const given: InvestigationRecordingInputs = inputs();

    recorder.add(success());
    recorder.add(failure());
    recorder.add(
      success({
        toolArguments: {
          q: "a".repeat(INVESTIGATION_RECORDING_MAX_ARGUMENT_CHARACTERS),
        },
      }),
    );

    const recording: InvestigationRecording = recorder.getRecording(given);

    expect(Object.keys(recording).sort()).toEqual(
      ["inputs", "toolCallsNotKept", "toolCalls", "version"].sort(),
    );
    expect(recording.version).toBe(INVESTIGATION_RECORDING_VERSION);
    expect(recording.inputs).toEqual(given);
    expect(recording.toolCalls).toHaveLength(2);
    expect(recording.toolCallsNotKept).toBe(1);
  });

  test("a recorder that saw nothing gives an empty recording, not a missing one", () => {
    expect(recordingOf(new InvestigationRecorder())).toEqual({
      version: INVESTIGATION_RECORDING_VERSION,
      inputs: inputs(),
      toolCalls: [],
      toolCallsNotKept: 0,
    });
  });

  test("a recording already taken does not change when the recorder goes on", () => {
    const recorder: InvestigationRecorder = new InvestigationRecorder();

    recorder.add(success());
    const first: InvestigationRecording = recordingOf(recorder);
    recorder.add(failure());

    expect(first.toolCalls).toHaveLength(1);
    expect(recordingOf(recorder).toolCalls).toHaveLength(2);
  });

  test("survives being written as JSON and read back unchanged, as the jsonb column keeps it", () => {
    const recorder: InvestigationRecorder = new InvestigationRecorder();

    recorder.add(success());
    recorder.add(failure());
    recorder.add(
      withText(INVESTIGATION_RECORDING_MAX_RESULT_CHARACTERS + 1, 3),
    );

    const recording: InvestigationRecording = recordingOf(recorder);

    expect(JSON.parse(JSON.stringify(recording))).toEqual(recording);
  });
});
