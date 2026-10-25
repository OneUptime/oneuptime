/*
 * What the Exceptions product's AI section finds and what its pull request
 * does (Utils/Exceptions/ExceptionInsight): which kind of finding an
 * insight is, where in your own code an exception was raised, which pull
 * request the investigation's verdict opens, and - for a service whose
 * exceptions carry no stack trace - which services a look picks, what the
 * finding is called and says, and what OneUptime asks the AI.
 */

import AIInsightSeverity from "../../../Types/AI/AIInsightSeverity";
import AIInsightType from "../../../Types/AI/AIInsightType";
import {
  ExceptionInsightFrameEvidence,
  ExceptionStackTraceInsightEvidence,
} from "../../../Types/AI/AIInsightEvidence";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import {
  TELEMETRY_AI_LANES,
  TelemetryAiLane,
} from "../../../Types/AI/TelemetryAi";
import ErrorClass from "../../../Types/Telemetry/ErrorClass";
import {
  EXCEPTION_EXPECTED_ERROR_CLASSIFICATIONS,
  EXCEPTION_FIX_TASK_TYPE_BY_KIND,
  EXCEPTION_INSIGHT_FRAME_TEXT_MAX_LENGTH,
  EXCEPTION_INSIGHT_MAX_OWN_CODE_FRAMES,
  EXCEPTION_INSIGHT_TYPE_BY_KIND,
  EXCEPTION_STACK_TRACE_FINGERPRINT_PREFIX,
  EXCEPTION_STACK_TRACE_GROUPS_KEPT,
  EXCEPTION_STACK_TRACE_MAX_SERVICES,
  EXCEPTION_STACK_TRACE_MEDIUM_OCCURRENCES,
  EXCEPTION_STACK_TRACE_MIN_OCCURRENCES,
  EXCEPTION_STACK_TRACE_WINDOW_HOURS,
  ExceptionFixKind,
  ExceptionInsightKind,
  ExceptionStackFrameReading,
  ExceptionStackTraceGroupReading,
  ExceptionStackTraceServicePick,
  buildExceptionSpikeDetail,
  buildExceptionStackTraceDetail,
  buildExceptionStackTraceEvidence,
  buildExceptionStackTraceEvidenceNote,
  buildExceptionStackTraceRequestMessage,
  buildNewExceptionDetail,
  describeExceptionStackTraceProblem,
  describeStackTraceGroup,
  getAutomaticExceptionFixKind,
  getExceptionFixKindOfTaskType,
  getExceptionInsightKind,
  getExceptionStackTraceFingerprint,
  getExceptionStackTraceRequestTitle,
  getExceptionStackTraceSeverity,
  getExceptionStackTraceTitle,
  getExceptionStackTraceWindow,
  getOwnCodeFrames,
  getPersonExceptionFixKind,
  isExceptionInsightAboutOneException,
  isExceptionRaisedInOwnCode,
  isExceptionStackTraceFingerprintOfService,
  pickServicesMissingStackTraces,
} from "../../../Utils/Exceptions/ExceptionInsight";
import { describe, expect, test } from "@jest/globals";

const SERVICE_A: string = "aaaaaaaa-0000-4000-8000-00000000000a";
const SERVICE_B: string = "bbbbbbbb-0000-4000-8000-00000000000b";
const SERVICE_C: string = "cccccccc-0000-4000-8000-00000000000c";
const SERVICE_D: string = "dddddddd-0000-4000-8000-00000000000d";

function frame(
  overrides: Partial<ExceptionStackFrameReading> = {},
): ExceptionStackFrameReading {
  return {
    functionName: "getOrder",
    fileName: "src/orders.ts",
    lineNumber: 42,
    inApp: true,
    ...overrides,
  };
}

let groupNumber: number = 0;

function group(
  overrides: Partial<ExceptionStackTraceGroupReading> = {},
): ExceptionStackTraceGroupReading {
  groupNumber++;

  return {
    telemetryExceptionId: `eeeeeeee-0000-4000-8000-${String(groupNumber).padStart(12, "0")}`,
    serviceId: SERVICE_A,
    exceptionType: "TimeoutError",
    exceptionMessage: "context deadline exceeded",
    occurrenceCount: 30,
    lastSeenAt: "2026-10-24T08:55:00.000Z",
    ...overrides,
  };
}

function stackTraceEvidence(
  overrides: Partial<ExceptionStackTraceInsightEvidence> = {},
): ExceptionStackTraceInsightEvidence {
  return {
    serviceId: SERVICE_A,
    windowStartTime: "2026-10-23T09:00:00.000Z",
    windowEndTime: "2026-10-24T09:00:00.000Z",
    exceptions: [
      {
        telemetryExceptionId: "eeeeeeee-0000-4000-8000-0000000000e1",
        exceptionType: "TimeoutError",
        exceptionMessage: "context deadline exceeded",
        occurrenceCount: 900,
        lastSeenAt: "2026-10-24T08:55:00.000Z",
      },
      {
        telemetryExceptionId: "eeeeeeee-0000-4000-8000-0000000000e2",
        exceptionType: "*errors.errorString",
        exceptionMessage: "",
        occurrenceCount: 340,
        lastSeenAt: "2026-10-24T08:40:00.000Z",
      },
    ],
    exceptionCount: 2,
    occurrenceCount: 1240,
    withStackTraceCount: 0,
    ...overrides,
  };
}

describe("the kinds of finding", () => {
  test("three kinds, each an insight type of the Exceptions lane", () => {
    expect(EXCEPTION_INSIGHT_TYPE_BY_KIND).toEqual({
      [ExceptionInsightKind.New]: AIInsightType.NewException,
      [ExceptionInsightKind.Rising]: AIInsightType.ExceptionSpike,
      [ExceptionInsightKind.MissingStackTrace]:
        AIInsightType.ExceptionMissingStackTrace,
    });
    expect([...Object.values(EXCEPTION_INSIGHT_TYPE_BY_KIND)].sort()).toEqual(
      [...TELEMETRY_AI_LANES[TelemetryAiLane.Exception].insightTypes].sort(),
    );
  });

  test("an insight type's kind, or none for another lane's or AI Insights' own", () => {
    expect(getExceptionInsightKind(AIInsightType.NewException)).toBe(
      ExceptionInsightKind.New,
    );
    expect(getExceptionInsightKind(AIInsightType.ExceptionSpike)).toBe(
      ExceptionInsightKind.Rising,
    );
    expect(
      getExceptionInsightKind(AIInsightType.ExceptionMissingStackTrace),
    ).toBe(ExceptionInsightKind.MissingStackTrace);

    for (const other of [
      AIInsightType.TraceFailingOperation,
      AIInsightType.ErrorLogSpike,
      AIInsightType.ProfileHotspot,
      "NewException ",
      undefined,
      null,
    ]) {
      expect(getExceptionInsightKind(other)).toBeNull();
    }
  });

  test("new and rising exceptions are about one exception; missing stack traces about a service", () => {
    expect(
      isExceptionInsightAboutOneException(AIInsightType.NewException),
    ).toBe(true);
    expect(
      isExceptionInsightAboutOneException(AIInsightType.ExceptionSpike),
    ).toBe(true);
    expect(
      isExceptionInsightAboutOneException(
        AIInsightType.ExceptionMissingStackTrace,
      ),
    ).toBe(false);
    expect(isExceptionInsightAboutOneException(undefined)).toBe(false);
  });
});

describe("your own code in a stack trace", () => {
  test("keeps the application's own frames, innermost first, at most a few", () => {
    const frames: Array<ExceptionInsightFrameEvidence> = getOwnCodeFrames({
      frames: [
        frame({
          functionName: "parse",
          fileName: "node:internal/x",
          inApp: false,
        }),
        frame({
          functionName: "getOrder",
          fileName: "src/orders.ts",
          lineNumber: 42,
        }),
        frame({
          functionName: "handle",
          fileName: "src/routes.ts",
          lineNumber: 10,
        }),
        frame({
          functionName: "lib",
          fileName: "node_modules/x/y.js",
          inApp: false,
        }),
        frame({
          functionName: "main",
          fileName: "src/index.ts",
          lineNumber: 3,
        }),
        frame({ functionName: "boot", fileName: "src/boot.ts", lineNumber: 1 }),
      ],
      stackTrace: "TypeError: x\n    at parse (node:internal/x)",
    });

    expect(EXCEPTION_INSIGHT_MAX_OWN_CODE_FRAMES).toBe(3);
    expect(frames).toEqual([
      { functionName: "getOrder", fileName: "src/orders.ts", lineNumber: 42 },
      { functionName: "handle", fileName: "src/routes.ts", lineNumber: 10 },
      { functionName: "main", fileName: "src/index.ts", lineNumber: 3 },
    ]);
  });

  /*
   * Python writes the most recent call last: its innermost frame of your
   * code is the last one written.
   */
  test("reads a Python traceback from its end", () => {
    expect(
      getOwnCodeFrames({
        frames: [
          frame({
            functionName: "<module>",
            fileName: "app/main.py",
            lineNumber: 5,
          }),
          frame({
            functionName: "view",
            fileName: "app/views.py",
            lineNumber: 20,
          }),
          frame({
            functionName: "load",
            fileName: "app/models.py",
            lineNumber: 88,
          }),
        ],
        stackTrace:
          'Traceback (most recent call last):\n  File "app/main.py", line 5, in <module>',
      }),
    ).toEqual([
      { functionName: "load", fileName: "app/models.py", lineNumber: 88 },
      { functionName: "view", fileName: "app/views.py", lineNumber: 20 },
      { functionName: "<module>", fileName: "app/main.py", lineNumber: 5 },
    ]);
  });

  test("a frame with no file says nothing about where the code is", () => {
    expect(
      getOwnCodeFrames({
        frames: [frame({ fileName: "" }), frame({ fileName: "   " })],
        stackTrace: "",
      }),
    ).toEqual([]);
  });

  test("each frame once, a line that is not a line as 0, and long names cut", () => {
    const long: string = "a".repeat(
      EXCEPTION_INSIGHT_FRAME_TEXT_MAX_LENGTH + 50,
    );
    const frames: Array<ExceptionInsightFrameEvidence> = getOwnCodeFrames({
      frames: [
        frame(),
        frame(),
        frame({ lineNumber: -3, fileName: "src/a.ts" }),
        frame({ lineNumber: 1.5, fileName: "src/b.ts", functionName: long }),
      ],
      stackTrace: "",
    });

    expect(frames).toHaveLength(3);
    expect(frames[1]!.lineNumber).toBe(0);
    expect(frames[2]!.lineNumber).toBe(0);
    expect(frames[2]!.functionName.length).toBe(
      EXCEPTION_INSIGHT_FRAME_TEXT_MAX_LENGTH,
    );
    expect(frames[2]!.functionName.endsWith("…")).toBe(true);
  });

  test("library and runtime frames only: none of your code", () => {
    expect(
      getOwnCodeFrames({
        frames: [
          frame({ inApp: false, fileName: "node_modules/pg/lib/client.js" }),
          frame({
            inApp: false,
            fileName: "node:internal/process/task_queues",
          }),
        ],
        stackTrace: "Error: x",
      }),
    ).toEqual([]);
  });

  test("whether the finding read its own code: yes, no, or not read at all", () => {
    expect(
      isExceptionRaisedInOwnCode({
        ownCodeFrames: [
          { functionName: "f", fileName: "src/f.ts", lineNumber: 1 },
        ],
      }),
    ).toBe(true);
    expect(isExceptionRaisedInOwnCode({ ownCodeFrames: [] })).toBe(false);
    expect(
      isExceptionRaisedInOwnCode({ exceptionType: "TypeError" }),
    ).toBeNull();
    expect(isExceptionRaisedInOwnCode(undefined)).toBeNull();
    expect(isExceptionRaisedInOwnCode(null)).toBeNull();
  });
});

describe("the pull request the verdict opens", () => {
  test("a fault of the code is fixed; an expected error gets better handling; the rest no pull request on its own", () => {
    expect(getAutomaticExceptionFixKind(ErrorClass.CodeFault)).toBe(
      ExceptionFixKind.Fix,
    );
    expect(getAutomaticExceptionFixKind(ErrorClass.UserError)).toBe(
      ExceptionFixKind.ImproveHandling,
    );
    expect(getAutomaticExceptionFixKind(ErrorClass.ExpectedDenial)).toBe(
      ExceptionFixKind.ImproveHandling,
    );

    for (const classification of [
      ErrorClass.Infrastructure,
      ErrorClass.Unknown,
      "Code-Fault",
      "",
      null,
      undefined,
      1,
    ]) {
      expect(getAutomaticExceptionFixKind(classification)).toBeNull();
    }
  });

  test("a person's Fix with AI: better handling for an expected error, else a fix", () => {
    expect(getPersonExceptionFixKind(ErrorClass.UserError)).toBe(
      ExceptionFixKind.ImproveHandling,
    );
    expect(getPersonExceptionFixKind(ErrorClass.ExpectedDenial)).toBe(
      ExceptionFixKind.ImproveHandling,
    );

    for (const classification of [
      ErrorClass.CodeFault,
      ErrorClass.Infrastructure,
      ErrorClass.Unknown,
      undefined,
    ]) {
      expect(getPersonExceptionFixKind(classification)).toBe(
        ExceptionFixKind.Fix,
      );
    }
  });

  test("each kind is the exception's own AI task", () => {
    expect(EXCEPTION_FIX_TASK_TYPE_BY_KIND).toEqual({
      [ExceptionFixKind.Fix]: CodeFixTaskType.FixException,
      [ExceptionFixKind.ImproveHandling]:
        CodeFixTaskType.ImproveExceptionHandling,
    });
    expect(getExceptionFixKindOfTaskType(CodeFixTaskType.FixException)).toBe(
      ExceptionFixKind.Fix,
    );
    expect(
      getExceptionFixKindOfTaskType(CodeFixTaskType.ImproveExceptionHandling),
    ).toBe(ExceptionFixKind.ImproveHandling);
    expect(
      getExceptionFixKindOfTaskType(CodeFixTaskType.WriteRegressionTest),
    ).toBeNull();
    expect(
      getExceptionFixKindOfTaskType(CodeFixTaskType.CodeRequest),
    ).toBeNull();
  });

  // The lane opens a handling fix on exactly these verdicts.
  test("the expected errors are the lane's handling verdicts", () => {
    expect([...EXCEPTION_EXPECTED_ERROR_CLASSIFICATIONS].sort()).toEqual(
      [
        ...(TELEMETRY_AI_LANES[TelemetryAiLane.Exception]
          .handlingFixClassifications || []),
      ].sort(),
    );
  });
});

describe("a new or rising exception's evidence", () => {
  const newBase: Parameters<typeof buildNewExceptionDetail>[0] = {
    label: "TypeError: Cannot read properties of undefined (reading 'id')",
    message: "Cannot read properties of undefined (reading 'id')",
    serviceName: "checkout",
    firstSeenAt: "2026-10-24T02:00:00.000Z",
    lookbackHours: 24,
    totalOccurrenceCount: 1057,
    groupCount: 1,
  };

  test("a new exception: what, where, when and how often", () => {
    const lines: Array<string> = buildNewExceptionDetail(newBase).split("\n");

    expect(lines[0]).toBe("**New exception detected**");
    expect(lines[1]).toBe("");
    expect(lines[2]).toContain("- Exception: `TypeError");
    expect(lines.join("\n")).toContain("- Service: checkout");
    // A date a person reads, in UTC and said so - not an ISO timestamp.
    expect(lines.join("\n")).toContain(
      "- First seen: Oct 24, 2026, 02:00 UTC (within the last 24h)",
    );
    expect(lines.join("\n")).not.toContain("2026-10-24T02:00:00.000Z");
    // The label already says the whole message: it is not said twice.
    expect(lines.join("\n")).not.toContain("- Message:");
    expect(lines.join("\n")).toContain("- Occurrences so far: 1,057");
    expect(lines.join("\n")).not.toContain("distinct stack traces");
    // Not read: nothing said about the code.
    expect(lines.join("\n")).not.toContain("your code");
  });

  test("stack variants rolled up, and the frames of your own code", () => {
    const text: string = buildNewExceptionDetail({
      ...newBase,
      groupCount: 3,
      stackFrameCount: 9,
      ownCodeFrames: [
        { functionName: "getOrder", fileName: "src/orders.ts", lineNumber: 42 },
        { functionName: "", fileName: "src/routes.ts", lineNumber: 0 },
      ],
    });

    expect(text).toContain("- Raised from 3 distinct stack traces");
    expect(text).toContain("**Your code in its stack trace**");
    expect(text).toContain("- `getOrder` at `src/orders.ts:42`");
    expect(text).toContain("- `src/routes.ts`");
  });

  test("a stack of library frames only, and none at all, say so", () => {
    expect(
      buildNewExceptionDetail({
        ...newBase,
        stackFrameCount: 6,
        ownCodeFrames: [],
      }),
    ).toContain(
      "- Its stack trace shows only library and runtime code, so nothing shows where in your code it was raised",
    );
    expect(
      buildNewExceptionDetail({
        ...newBase,
        stackFrameCount: 0,
        ownCodeFrames: [],
      }),
    ).toContain(
      "- It was recorded without a stack trace, so nothing shows where in your code it was raised",
    );
  });

  /*
   * The label cuts a long message short (ExceptionIdentity): then the
   * message is said whole, on its own line - and a label that does not
   * carry it at all leaves it there too.
   */
  test("a message the label cut short, or does not carry, is said on its own line", () => {
    const message: string =
      "Cannot read properties of undefined (reading 'id') while applying the coupon to the order total";

    expect(
      buildNewExceptionDetail({
        ...newBase,
        label: `TypeError: ${message.slice(0, 40)}…`,
        message,
      }),
    ).toContain(`- Message: ${message}`);
    expect(
      buildNewExceptionDetail({
        ...newBase,
        label: "TypeError",
        message: "boom",
      }),
    ).toContain("- Message: boom");
  });

  test("a first-seen time that cannot be read is unknown", () => {
    expect(
      buildNewExceptionDetail({ ...newBase, firstSeenAt: "not a date" }),
    ).toContain("- First seen: unknown (within the last 24h)");
  });

  test("no message and no service: their lines are left out", () => {
    const text: string = buildNewExceptionDetail({
      ...newBase,
      message: "",
      serviceName: null,
      firstSeenAt: undefined,
    });

    expect(text).not.toContain("- Message:");
    expect(text).not.toContain("- Service:");
    expect(text).toContain("- First seen: unknown (within the last 24h)");
  });

  /*
   * The message and the names are the service's: Markdown in them reads as
   * text, never as a link, an image or a heading.
   */
  test("the service's words are written as text", () => {
    const text: string = buildNewExceptionDetail({
      ...newBase,
      label: "Error: `boom`",
      message: "[click](https://example.com) ![x](https://example.com/p.png)",
      serviceName: "[svc](https://example.com/s)",
    });

    expect(text).not.toContain("[click](https://example.com)");
    expect(text).not.toContain("![x](");
    expect(text).not.toContain("[svc](https://example.com/s)");
    // A backtick in the label cannot close the code span it sits in.
    expect(text).toContain("- Exception: `` Error: `boom` ``");
  });

  test("a spike: the last hour against its usual rate", () => {
    const text: string = buildExceptionSpikeDetail({
      label: "TimeoutError: payment provider did not answer",
      message: "payment provider did not answer",
      serviceName: "payments",
      isDormantAwakening: false,
      recentWindowHours: 1,
      recentOccurrenceCount: 420,
      baselineWindowHours: 24,
      baselineHourlyAverage: 8.4,
      priorWindowCount: 201,
      multiplier: 50,
      firstSeenAt: "2026-09-01T00:00:00.000Z",
      totalOccurrenceCount: 12000,
      stackFrameCount: 4,
      ownCodeFrames: [
        { functionName: "charge", fileName: "src/pay.ts", lineNumber: 9 },
      ],
    });

    expect(text.split("\n")[0]).toBe("**Exception spike detected**");
    expect(text).toContain("- Occurrences in the last 1h: 420");
    expect(text).toContain(
      "- Baseline: 8.40/hour over the prior 24h (201 total)",
    );
    expect(text).toContain("- Spike multiplier: 50.0x");
    expect(text).toContain(
      "- Exception first seen: Sep 1, 2026, 00:00 UTC (lifetime occurrences: 12,000)",
    );
    expect(text).toContain("- `charge` at `src/pay.ts:9`");
    // The label says the whole message: no second line for it.
    expect(text).not.toContain("- Message:");
  });

  test("a dormant exception waking up says so", () => {
    expect(
      buildExceptionSpikeDetail({
        label: "Error",
        message: "",
        serviceName: null,
        isDormantAwakening: true,
        recentWindowHours: 1,
        recentOccurrenceCount: 12,
        baselineWindowHours: 24,
        baselineHourlyAverage: 0,
        priorWindowCount: 0,
        multiplier: 12,
        firstSeenAt: undefined,
        totalOccurrenceCount: 40,
      }).split("\n")[0],
    ).toBe("**Dormant exception woke up**");
  });
});

describe("missing stack traces: the gates", () => {
  test("the day read, the fewest occurrences, the services a look reads", () => {
    expect(EXCEPTION_STACK_TRACE_WINDOW_HOURS).toBe(24);
    expect(EXCEPTION_STACK_TRACE_MIN_OCCURRENCES).toBe(20);
    expect(EXCEPTION_STACK_TRACE_MAX_SERVICES).toBe(3);
    expect(EXCEPTION_STACK_TRACE_GROUPS_KEPT).toBe(5);
    expect(EXCEPTION_STACK_TRACE_MEDIUM_OCCURRENCES).toBe(1000);
  });

  test("the window is the last day", () => {
    const now: Date = new Date("2026-10-24T09:00:00.000Z");

    expect(getExceptionStackTraceWindow(now)).toEqual({
      startTime: new Date("2026-10-23T09:00:00.000Z"),
      endTime: now,
    });
  });

  test("a service's exceptions together must have happened 20 or more times", () => {
    expect(
      pickServicesMissingStackTraces([
        group({ occurrenceCount: 12 }),
        group({ occurrenceCount: 7 }),
      ]),
    ).toEqual([]);

    const picks: Array<ExceptionStackTraceServicePick> =
      pickServicesMissingStackTraces([
        group({ occurrenceCount: 12 }),
        group({ occurrenceCount: 8 }),
      ]);

    expect(picks).toHaveLength(1);
    expect(picks[0]!.serviceId).toBe(SERVICE_A);
    expect(picks[0]!.occurrenceCount).toBe(20);
    expect(picks[0]!.groups).toHaveLength(2);
  });

  test("the loudest services first, at most three, and their exceptions loudest first", () => {
    const picks: Array<ExceptionStackTraceServicePick> =
      pickServicesMissingStackTraces([
        group({ serviceId: SERVICE_A, occurrenceCount: 25 }),
        group({ serviceId: SERVICE_B, occurrenceCount: 50 }),
        group({ serviceId: SERVICE_B, occurrenceCount: 400 }),
        group({ serviceId: SERVICE_C, occurrenceCount: 21 }),
        group({ serviceId: SERVICE_D, occurrenceCount: 300 }),
      ]);

    expect(
      picks.map((pick: ExceptionStackTraceServicePick): string => {
        return pick.serviceId;
      }),
    ).toEqual([SERVICE_B, SERVICE_D, SERVICE_A]);
    expect(
      picks[0]!.groups.map((reading: ExceptionStackTraceGroupReading) => {
        return reading.occurrenceCount;
      }),
    ).toEqual([400, 50]);
  });

  test("an exception that names no service, or none of its own, is left out; each exception once", () => {
    const repeated: ExceptionStackTraceGroupReading = group({
      occurrenceCount: 15,
    });

    const picks: Array<ExceptionStackTraceServicePick> =
      pickServicesMissingStackTraces([
        group({ serviceId: "", occurrenceCount: 500 }),
        group({ serviceId: "  ", occurrenceCount: 500 }),
        group({ telemetryExceptionId: "", occurrenceCount: 500 }),
        repeated,
        repeated,
        group({ occurrenceCount: 4 }),
      ]);

    expect(picks).toHaveLength(0);
  });

  test("ties are broken by id, so a look picks the same every time", () => {
    const first: Array<ExceptionStackTraceServicePick> =
      pickServicesMissingStackTraces([
        group({ serviceId: SERVICE_C, occurrenceCount: 30 }),
        group({ serviceId: SERVICE_A, occurrenceCount: 30 }),
        group({ serviceId: SERVICE_B, occurrenceCount: 30 }),
        group({ serviceId: SERVICE_D, occurrenceCount: 30 }),
      ]);
    const second: Array<ExceptionStackTraceServicePick> =
      pickServicesMissingStackTraces([
        group({ serviceId: SERVICE_D, occurrenceCount: 30 }),
        group({ serviceId: SERVICE_B, occurrenceCount: 30 }),
        group({ serviceId: SERVICE_A, occurrenceCount: 30 }),
        group({ serviceId: SERVICE_C, occurrenceCount: 30 }),
      ]);

    const ids: (
      picks: Array<ExceptionStackTraceServicePick>,
    ) => Array<string> = (
      picks: Array<ExceptionStackTraceServicePick>,
    ): Array<string> => {
      return picks.map((pick: ExceptionStackTraceServicePick): string => {
        return pick.serviceId;
      });
    };

    expect(ids(first)).toEqual([SERVICE_A, SERVICE_B, SERVICE_C]);
    expect(ids(second)).toEqual(ids(first));
  });

  test("an occurrence count that is not a count counts nothing; service ids are read in lower case", () => {
    const picks: Array<ExceptionStackTraceServicePick> =
      pickServicesMissingStackTraces([
        group({
          serviceId: SERVICE_A.toUpperCase(),
          occurrenceCount: Number.NaN,
        }),
        group({ serviceId: SERVICE_A, occurrenceCount: -40 }),
        group({ serviceId: SERVICE_A, occurrenceCount: 20.9 }),
      ]);

    expect(picks).toHaveLength(1);
    expect(picks[0]!.serviceId).toBe(SERVICE_A);
    expect(picks[0]!.occurrenceCount).toBe(20);
  });

  test("one finding per service: its fingerprint", () => {
    expect(EXCEPTION_STACK_TRACE_FINGERPRINT_PREFIX).toBe(
      "exception-missing-stack-trace",
    );
    expect(
      getExceptionStackTraceFingerprint(` ${SERVICE_A.toUpperCase()} `),
    ).toBe(`exception-missing-stack-trace:${SERVICE_A}`);
    expect(
      isExceptionStackTraceFingerprintOfService(
        `exception-missing-stack-trace:${SERVICE_A}`,
        SERVICE_A.toUpperCase(),
      ),
    ).toBe(true);
    expect(
      isExceptionStackTraceFingerprintOfService(
        `exception-missing-stack-trace:${SERVICE_A}`,
        SERVICE_B,
      ),
    ).toBe(false);
    expect(
      isExceptionStackTraceFingerprintOfService(
        `exception-missing-stack-trace:${SERVICE_A}:x`,
        SERVICE_A,
      ),
    ).toBe(false);
    expect(isExceptionStackTraceFingerprintOfService("", "")).toBe(false);
  });

  test("the evidence keeps the loudest few exceptions and the whole count", () => {
    const pick: ExceptionStackTraceServicePick = pickServicesMissingStackTraces(
      Array.from({ length: 8 }, (_: unknown, index: number) => {
        return group({ occurrenceCount: 10 + index });
      }),
    )[0]!;

    const evidence: ExceptionStackTraceInsightEvidence =
      buildExceptionStackTraceEvidence({
        pick,
        window: getExceptionStackTraceWindow(
          new Date("2026-10-24T09:00:00.000Z"),
        ),
        withStackTraceCount: 4.7,
      });

    expect(evidence.serviceId).toBe(SERVICE_A);
    expect(evidence.windowStartTime).toBe("2026-10-23T09:00:00.000Z");
    expect(evidence.windowEndTime).toBe("2026-10-24T09:00:00.000Z");
    expect(evidence.exceptions).toHaveLength(EXCEPTION_STACK_TRACE_GROUPS_KEPT);
    expect(evidence.exceptions[0]!.occurrenceCount).toBe(17);
    expect(evidence.exceptionCount).toBe(8);
    expect(evidence.occurrenceCount).toBe(108);
    expect(evidence.withStackTraceCount).toBe(4);
  });

  test("a count of exceptions with a stack trace that is not a count is none", () => {
    const pick: ExceptionStackTraceServicePick = pickServicesMissingStackTraces(
      [group({ occurrenceCount: 40 })],
    )[0]!;

    for (const value of [Number.NaN, -1, 0]) {
      expect(
        buildExceptionStackTraceEvidence({
          pick,
          window: getExceptionStackTraceWindow(new Date()),
          withStackTraceCount: value,
        }).withStackTraceCount,
      ).toBe(0);
    }
  });

  test("Low, and Medium once a thousand or more", () => {
    expect(
      getExceptionStackTraceSeverity(
        stackTraceEvidence({ occurrenceCount: 999 }),
      ),
    ).toBe(AIInsightSeverity.Low);
    expect(
      getExceptionStackTraceSeverity(
        stackTraceEvidence({ occurrenceCount: 1000 }),
      ),
    ).toBe(AIInsightSeverity.Medium);
  });
});

describe("missing stack traces: what the finding says", () => {
  test("every exception of the service, some of them, or one", () => {
    expect(
      getExceptionStackTraceTitle({
        evidence: stackTraceEvidence(),
        serviceName: "payments",
      }),
    ).toBe("Exceptions in payments have no stack trace");
    expect(
      getExceptionStackTraceTitle({
        evidence: stackTraceEvidence({ withStackTraceCount: 12 }),
        serviceName: "payments",
      }),
    ).toBe("2 exceptions in payments have no stack trace");
    expect(
      getExceptionStackTraceTitle({
        evidence: stackTraceEvidence({
          withStackTraceCount: 12,
          exceptionCount: 1,
        }),
        serviceName: "payments",
      }),
    ).toBe("An exception in payments has no stack trace");
    expect(
      getExceptionStackTraceTitle({
        evidence: stackTraceEvidence(),
        serviceName: "",
      }),
    ).toBe("Exceptions in a service have no stack trace");
    // An unnamed service mid-sentence is "a service", never "A service".
    expect(
      getExceptionStackTraceTitle({
        evidence: stackTraceEvidence({ withStackTraceCount: 12 }),
        serviceName: "",
      }),
    ).toBe("2 exceptions in a service have no stack trace");
  });

  test("an exception as the finding names it", () => {
    expect(
      describeStackTraceGroup({
        telemetryExceptionId: "x",
        exceptionType: "TimeoutError",
        exceptionMessage: "deadline exceeded",
        occurrenceCount: 1,
        lastSeenAt: "",
      }),
    ).toBe("TimeoutError: deadline exceeded");
    expect(
      describeStackTraceGroup({
        telemetryExceptionId: "x",
        exceptionType: " ",
        exceptionMessage: "deadline exceeded",
        occurrenceCount: 1,
        lastSeenAt: "",
      }),
    ).toBe("deadline exceeded");
    expect(
      describeStackTraceGroup({
        telemetryExceptionId: "x",
        exceptionType: "",
        exceptionMessage: "",
        occurrenceCount: 1,
        lastSeenAt: "",
      }),
    ).toBe("An exception");
  });

  test("the problem in sentences, with the loudest exceptions", () => {
    expect(
      describeExceptionStackTraceProblem({
        evidence: stackTraceEvidence(),
        serviceName: "payments",
      }),
    ).toBe(
      "In the last day payments recorded 2 exceptions, and none of them carried a stack trace. Together they have happened 1,240 times since they were first seen. Without one, nobody can tell where in its code they were raised. The loudest: TimeoutError: context deadline exceeded (900 times), *errors.errorString (340 times).",
    );
    expect(
      describeExceptionStackTraceProblem({
        evidence: stackTraceEvidence({
          withStackTraceCount: 30,
          exceptionCount: 1,
          occurrenceCount: 25,
          exceptions: [],
        }),
        serviceName: "payments",
      }),
    ).toBe(
      "In the last day payments recorded 1 exception without a stack trace, while 30 others carried one. It has happened 25 times since it was first seen. Without one, nobody can tell where in its code it was raised.",
    );
  });

  /*
   * An exception's count is every time it happened since it was first
   * seen - what the Exceptions list shows - not only on the day read: the
   * sentences say so, and never that the count happened that day.
   */
  test("how often they happened is said since they were first seen, never as the day's", () => {
    const every: string = describeExceptionStackTraceProblem({
      evidence: stackTraceEvidence(),
      serviceName: "payments",
    });

    expect(every).toContain("since they were first seen");
    expect(every).not.toContain("1,240 times in the last day");
    expect(every).not.toContain("Over the last day");

    // Some carried one: those without one are counted, apart from the rest.
    expect(
      describeExceptionStackTraceProblem({
        evidence: stackTraceEvidence({
          exceptionCount: 3,
          occurrenceCount: 60,
          withStackTraceCount: 1,
          exceptions: [],
        }),
        serviceName: "payments",
      }),
    ).toBe(
      "In the last day payments recorded 3 exceptions without a stack trace, while 1 other carried one. Together those 3 have happened 60 times since they were first seen. Without one, nobody can tell where in its code they were raised.",
    );

    // One exception, the only one of the day: it, not they.
    expect(
      describeExceptionStackTraceProblem({
        evidence: stackTraceEvidence({
          exceptionCount: 1,
          occurrenceCount: 42,
          exceptions: [],
        }),
        serviceName: "payments",
      }),
    ).toBe(
      "In the last day payments recorded 1 exception, and it carried no stack trace. It has happened 42 times since it was first seen. Without one, nobody can tell where in its code it was raised.",
    );
  });

  test("a service with no name is the service, in the middle of the sentence", () => {
    expect(
      describeExceptionStackTraceProblem({
        evidence: stackTraceEvidence({ exceptions: [] }),
        serviceName: "",
      }),
    ).toMatch(/^In the last day the service recorded 2 exceptions, /);
  });

  test("the evidence a person reads: the facts, then the exceptions", () => {
    const lines: Array<string> = buildExceptionStackTraceDetail({
      serviceName: "payments",
      evidence: stackTraceEvidence(),
    })
      .toString()
      .split("\n");

    expect(lines).toEqual([
      "**Missing stack traces in payments**",
      "",
      "- Seen in the last day: 2 exceptions with no stack trace",
      "- Together they have happened 1,240 times since they were first seen",
      "- None of its exceptions seen that day carried a stack trace",
      "- Without a stack trace, nothing shows where in its code they were raised",
      "",
      "**The exceptions**",
      "",
      "- `TimeoutError: context deadline exceeded` (900 times)",
      "- `*errors.errorString` (340 times)",
    ]);
  });

  test("more exceptions than are named: the loudest of them", () => {
    const text: string = buildExceptionStackTraceDetail({
      serviceName: "payments",
      evidence: stackTraceEvidence({
        exceptionCount: 9,
        withStackTraceCount: 3,
      }),
    }).toString();

    expect(text).toContain("**The loudest of them**");
    expect(text).toContain(
      "- 3 of its other exceptions seen that day carried a stack trace",
    );
    expect(text).toContain(
      "- Seen in the last day: 9 exceptions with no stack trace",
    );
    expect(text).toContain(
      "- Together they have happened 1,240 times since they were first seen",
    );
  });

  test("one exception: it, not they", () => {
    const lines: Array<string> = buildExceptionStackTraceDetail({
      serviceName: "payments",
      evidence: stackTraceEvidence({
        exceptionCount: 1,
        occurrenceCount: 900,
        exceptions: [stackTraceEvidence().exceptions[0]!],
      }),
    })
      .toString()
      .split("\n");

    expect(lines.slice(2, 6)).toEqual([
      "- Seen in the last day: 1 exception with no stack trace",
      "- It has happened 900 times since it was first seen",
      "- None of its exceptions seen that day carried a stack trace",
      "- Without a stack trace, nothing shows where in its code it was raised",
    ]);
    expect(lines).toContain("**The exceptions**");
  });

  test("the service's words are written as text", () => {
    const text: string = buildExceptionStackTraceDetail({
      serviceName: "**pay**",
      evidence: stackTraceEvidence({
        exceptions: [
          {
            telemetryExceptionId: "x",
            exceptionType: "Error",
            exceptionMessage: "`; DROP TABLE` [x](https://example.com)",
            occurrenceCount: 1,
            lastSeenAt: "",
          },
        ],
      }),
    }).toString();

    expect(text.split("\n")[0]).not.toBe("**Missing stack traces in **pay****");
    // Inside a code span a link is code, and a backtick cannot close it.
    expect(text).toContain(
      "- `` Error: `; DROP TABLE` [x](https://example.com) `` (once)",
    );
  });
});

describe("missing stack traces: what OneUptime asks the AI", () => {
  test("the title is what to do, and where", () => {
    expect(
      getExceptionStackTraceRequestTitle({ serviceName: "payments" }),
    ).toBe("Record a stack trace with each exception in payments");
    expect(getExceptionStackTraceRequestTitle({ serviceName: "" })).toBe(
      "Record a stack trace with each exception in this service",
    );
  });

  test("OneUptime's own request says it found it, and gives leave to change nothing", () => {
    const lines: Array<string> = buildExceptionStackTraceRequestMessage({
      evidence: stackTraceEvidence(),
      serviceName: "payments",
      isStartedByOneUptime: true,
    }).split("\n");

    expect(lines[0]).toBe(
      "Record a stack trace with each exception in payments",
    );
    expect(lines[1]).toBe("");
    expect(lines[2]).toMatch(
      /^OneUptime found this in the service's exceptions on its own\. In the last day payments recorded 2 exceptions/,
    );
    expect(lines[4]).toContain(
      "Make the service record a stack trace with every exception it records",
    );
    expect(lines[4]).toContain("trace.WithStackTrace(true)");
    expect(lines[4]).toContain("Do not change what the code does");
    expect(lines[4]).toContain(
      "If this service records its exceptions somewhere other than this repository, say where and change nothing.",
    );
  });

  test("a person's request is the problem and the ask, without OneUptime's leave", () => {
    const message: string = buildExceptionStackTraceRequestMessage({
      evidence: stackTraceEvidence(),
      serviceName: "payments",
      isStartedByOneUptime: false,
    });

    expect(message).not.toContain("OneUptime found this");
    expect(message).not.toContain("change nothing");
    expect(message).toContain("record no secrets or personal data");
  });

  test("the note: the window, the counts and each exception", () => {
    expect(buildExceptionStackTraceEvidenceNote(stackTraceEvidence())).toBe(
      [
        "Window: 2026-10-23T09:00:00.000Z to 2026-10-24T09:00:00.000Z",
        "Exceptions seen in the window without a stack trace: 2, 1,240 times since they were first seen",
        "Exceptions of the service seen in the window with a stack trace: 0",
        "",
        "TimeoutError: context deadline exceeded (900 times, last seen 2026-10-24T08:55:00.000Z)",
        "*errors.errorString (340 times, last seen 2026-10-24T08:40:00.000Z)",
      ].join("\n"),
    );
    expect(
      buildExceptionStackTraceEvidenceNote(
        stackTraceEvidence({ exceptions: [] }),
      ),
    ).not.toContain("\n\n");
  });
});
