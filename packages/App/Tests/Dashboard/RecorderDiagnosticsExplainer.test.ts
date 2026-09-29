import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";
import {
  RECORDER_DEBUG_CODE_COPY,
  RecorderDiagnosticsResult,
  UNKNOWN_RECORDER_DEBUG_CODE_COPY,
  explainRecorderDebugCode,
  explainRecorderDiagnostics,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/RecorderDiagnosticsExplainer";

/*
 * The explainer's whole value is that it knows every code the recorder can
 * emit. The recorder's vocabulary is not exported anywhere - each code is a
 * string literal at a debugLog/debugWarn call site - so this test reads
 * the recorder sources and diffs them against the copy table. A new code
 * in the recorder without a sentence here fails this test on purpose.
 */

const RECORDER_SRC_DIR: string = nodePath.join(
  __dirname,
  "../../FeatureSet/BrowserRecorder/src",
);

/*
 * debugLog("code", ...) / debugWarn("code", ...) - the call may wrap onto
 * the next line, so whitespace between the paren and the literal is free.
 */
const DEBUG_CALL_PATTERN: RegExp = new RegExp(
  'debug(?:Log|Warn)\\(\\s*"([a-z0-9-]+)"',
  "g",
);

/* Debug.ts builds one record by hand for the "diagnostics on" line. */
const LITERAL_CODE_PATTERN: RegExp = new RegExp('code:\\s*"([a-z0-9-]+)"', "g");

function readRecorderCodes(): Array<string> {
  const codes: Set<string> = new Set<string>();

  for (const fileName of fs.readdirSync(RECORDER_SRC_DIR)) {
    if (!fileName.endsWith(".ts")) {
      continue;
    }

    const source: string = fs.readFileSync(
      nodePath.join(RECORDER_SRC_DIR, fileName),
      "utf8",
    );

    for (const match of source.matchAll(DEBUG_CALL_PATTERN)) {
      codes.add(match[1] as string);
    }

    if (fileName === "Debug.ts") {
      for (const match of source.matchAll(LITERAL_CODE_PATTERN)) {
        codes.add(match[1] as string);
      }
    }
  }

  return Array.from(codes).sort();
}

describe("RecorderDiagnosticsExplainer code table", () => {
  const recorderCodes: Array<string> = readRecorderCodes();

  test("the recorder sources yield a real vocabulary", () => {
    expect(recorderCodes.length).toBeGreaterThan(40);
    expect(recorderCodes).toContain("privacy-signal");
    expect(recorderCodes).toContain("not-sampled");
    expect(recorderCodes).toContain("upload-blocked-consent");
  });

  for (const code of readRecorderCodes()) {
    test(`maps ${code} to plain copy`, () => {
      const copy: {
        explanation: string;
        action: string | null;
        isKnown: boolean;
      } = explainRecorderDebugCode(code);

      expect(copy.isKnown).toBe(true);
      expect(copy.explanation.length).toBeGreaterThan(20);
      expect(copy.explanation).not.toBe(UNKNOWN_RECORDER_DEBUG_CODE_COPY);
      /* The sentence must not just be the code echoed back. */
      expect(copy.explanation).not.toBe(code);
    });
  }

  test("every entry in the copy table is a code the recorder still emits", () => {
    for (const code of Object.keys(RECORDER_DEBUG_CODE_COPY)) {
      expect(recorderCodes).toContain(code);
    }
  });

  test("an unknown code falls back without throwing", () => {
    const copy: {
      explanation: string;
      action: string | null;
      isKnown: boolean;
    } = explainRecorderDebugCode("not-a-real-code");

    expect(copy.isKnown).toBe(false);
    expect(copy.explanation).toBe(UNKNOWN_RECORDER_DEBUG_CODE_COPY);
    expect(copy.action).toBeNull();
  });

  test("a prototype key is not a code", () => {
    expect(explainRecorderDebugCode("constructor").isKnown).toBe(false);
    expect(explainRecorderDebugCode("__proto__").isKnown).toBe(false);
  });

  /*
   * github.com/OneUptime/oneuptime/issues/3642: final-chunk-too-large is
   * logged for two different outcomes, told apart by `sealed` in the
   * detail. sealed: true - the final chunk's events were dropped and an
   * empty final chunk sealed the session. sealed: false - a chunk that was
   * NOT final was dropped whole, so nothing was sealed and the session is
   * still open with a gap. Describing both as "the final chunk was dropped"
   * told a customer their recording ended early when it had not ended.
   */
  test("final-chunk-too-large explains both sealed outcomes, and never calls a non-final chunk final", () => {
    const explanation: string = explainRecorderDebugCode(
      "final-chunk-too-large",
    ).explanation;

    const sealedTrue: number = explanation.indexOf("sealed: true");
    const sealedFalse: number = explanation.indexOf("sealed: false");

    expect(sealedTrue).toBeGreaterThan(-1);
    expect(sealedFalse).toBeGreaterThan(sealedTrue);

    const whenSealed: string = explanation.slice(sealedTrue, sealedFalse);
    const whenNotSealed: string = explanation.slice(sealedFalse);

    expect(whenSealed).toContain("final chunk");
    expect(whenSealed).toContain("empty final chunk sealed the session");
    expect(whenNotSealed).toContain("not a final chunk");
    expect(whenNotSealed).toContain("stays open with a gap");
    expect(whenNotSealed).not.toMatch(/last seconds|ends early/);
  });
});

/*
 * same-origin-propagation is one code with several reasons, and a customer
 * reading "reason: agent-stand-down" needs to know which agent took the
 * traceparent over and what to change. Every reason literal the recorder
 * emits under that code must be explained - read from the source, so a new
 * reason without a sentence fails here.
 */
describe("RecorderDiagnosticsExplainer same-origin-propagation reasons", () => {
  const networkRecorder: string = fs.readFileSync(
    nodePath.join(RECORDER_SRC_DIR, "NetworkRecorder.ts"),
    "utf8",
  );

  const emittedReasons: Array<string> = Array.from(
    new Set(
      networkRecorder
        .split('"same-origin-propagation",')
        .slice(1)
        .flatMap((emission: string): Array<string> => {
          const call: string = emission.split(");")[0] || "";

          return Array.from(call.matchAll(/"(on|[a-z]+(?:-[a-z]+)+)"/g)).map(
            (match: RegExpMatchArray): string => {
              return match[1] as string;
            },
          );
        }),
    ),
  ).sort();

  test("the recorder reports the start-up reasons and the vendor stand-down", () => {
    expect(emittedReasons).toEqual([
      "agent-stand-down",
      "on",
      "opaque-origin",
      "policy-off",
    ]);
  });

  test("every emitted reason is explained, and the stand-down names its agents", () => {
    const copy: { explanation: string; action: string | null } =
      explainRecorderDebugCode("same-origin-propagation");

    for (const reason of emittedReasons) {
      expect([reason, copy.explanation.includes(reason)]).toEqual([
        reason,
        true,
      ]);
    }

    for (const agent of ["DD_RUM", "NREUM", "elasticApm"]) {
      expect(copy.explanation).toContain(agent);
    }

    expect(copy.action).toContain("agent-stand-down");
    expect(copy.action).toContain("allowedTracingUrls");
  });

  /*
   * One "configure the agent to propagate" line was wrong for two of the
   * three agents: New Relic with distributed tracing on already sends a
   * traceparent (with its own tracestate in place of the session's), and a
   * Datadog session that links nothing is usually one Datadog does not
   * trace-sample, which no propagation setting changes.
   */
  test("gives each stand-down agent its own advice, and never tells New Relic to propagate", () => {
    const action: string =
      explainRecorderDebugCode("same-origin-propagation").action || "";

    const advice: (agent: string) => string = (agent: string): string => {
      const start: number = action.indexOf(`${agent}:`);

      expect([agent, start >= 0]).toEqual([agent, true]);

      const rest: string = action.slice(start + agent.length + 1);
      const next: number = rest.search(/\b(DD_RUM|NREUM|elasticApm):/);

      return next >= 0 ? rest.slice(0, next) : rest;
    };

    expect(action).not.toContain("configure the named agent");

    expect(advice("DD_RUM")).toContain("trace-sample");
    /*
     * traceSampleRate: 100 is the fix. traceContextInjection: "all" only
     * sends a not-sampled traceparent in the other sessions, which a
     * default ParentBased backend drops, so it must never read as the fix.
     */
    expect(advice("DD_RUM")).toContain("traceSampleRate: 100");
    expect(advice("DD_RUM")).toMatch(
      /traceContextInjection: "all" also sends a traceparent there, but flagged not sampled/,
    );
    expect(advice("DD_RUM")).toContain("allowedTracingUrls");

    expect(advice("elasticApm")).toContain("disableInstrumentations");

    const newRelic: string = advice("NREUM");

    expect(newRelic).toContain("own tracestate");
    expect(newRelic).toContain("nothing to change");
    expect(newRelic).not.toMatch(/propagat/i);
    expect(newRelic).not.toMatch(/\bconfigure\b/i);
  });

  test("says which Datadog, New Relic and Elastic set-ups make the recorder stand down", () => {
    const explanation: string = explainRecorderDebugCode(
      "same-origin-propagation",
    ).explanation;

    expect(explanation).toContain("tracked session");
    expect(explanation).toContain("distributed tracing on");
    expect(explanation).toContain("traceparent header name");
  });
});

describe("explainRecorderDiagnostics input handling", () => {
  test("empty and non-JSON pastes are reported, not thrown", () => {
    const empty: RecorderDiagnosticsResult = explainRecorderDiagnostics("   ");
    const garbage: RecorderDiagnosticsResult =
      explainRecorderDiagnostics("{ nope");

    expect(empty.ok).toBe(false);
    expect(garbage.ok).toBe(false);

    if (!empty.ok && !garbage.ok) {
      expect(empty.error).toContain("getDiagnostics()");
      expect(garbage.error).toContain("not JSON");
    }
  });

  test("JSON that is not the diagnostics shape is reported", () => {
    const scalar: RecorderDiagnosticsResult = explainRecorderDiagnostics("42");
    const noRecords: RecorderDiagnosticsResult = explainRecorderDiagnostics(
      JSON.stringify({ version: "1.0.0" }),
    );

    expect(scalar.ok).toBe(false);
    expect(noRecords.ok).toBe(false);

    if (!noRecords.ok) {
      expect(noRecords.error).toContain("No records array");
    }
  });

  test("accepts the bare records array and an already-parsed object", () => {
    const fromArray: RecorderDiagnosticsResult = explainRecorderDiagnostics(
      JSON.stringify([
        { code: "loader-start", level: "info", atUnixMs: 1, message: "" },
      ]),
    );
    const fromObject: RecorderDiagnosticsResult = explainRecorderDiagnostics({
      records: [{ code: "loader-start", level: "info" }],
    });

    expect(fromArray.ok).toBe(true);
    expect(fromObject.ok).toBe(true);

    if (fromArray.ok) {
      expect(fromArray.explanation.records).toHaveLength(1);
      expect(fromArray.explanation.records[0]?.code).toBe("loader-start");
    }
  });

  test("skips entries without a code and keeps only primitive detail values", () => {
    const result: RecorderDiagnosticsResult = explainRecorderDiagnostics({
      records: [
        null,
        "string",
        { level: "warn" },
        {
          code: "chunk-refused",
          level: "warn",
          detail: { reason: "origin-not-allowed", nested: { a: 1 }, n: 2 },
        },
      ],
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.explanation.records).toHaveLength(1);
      expect(result.explanation.records[0]?.detail).toEqual({
        reason: "origin-not-allowed",
        n: 2,
      });
      expect(result.explanation.warnCount).toBe(1);
    }
  });
});

describe("explainRecorderDiagnostics headline", () => {
  test("is the LAST outcome record, not the first warn", () => {
    const result: RecorderDiagnosticsResult = explainRecorderDiagnostics({
      isRecording: false,
      records: [
        { code: "loader-start", level: "info" },
        { code: "config-value-unrecognised", level: "warn" },
        { code: "not-sampled", level: "warn" },
        { code: "recorder-stopped", level: "info" },
      ],
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.explanation.headline).toContain(
        "not selected by the sample percentage",
      );
    }
  });

  test("with no outcome record, the recorder's own state decides", () => {
    const recording: RecorderDiagnosticsResult = explainRecorderDiagnostics({
      isRecording: true,
      isUploading: false,
      records: [{ code: "recording", level: "info" }],
    });
    const uploading: RecorderDiagnosticsResult = explainRecorderDiagnostics({
      isRecording: true,
      isUploading: true,
      records: [],
    });
    const neverStarted: RecorderDiagnosticsResult = explainRecorderDiagnostics({
      isRecording: false,
      bootstrapDecision: "not-started",
      records: [],
    });

    expect(recording.ok && recording.explanation.headline).toContain(
      "nothing has triggered an upload yet",
    );
    expect(uploading.ok && uploading.explanation.headline).toContain(
      "recording and uploading",
    );
    expect(neverStarted.ok && neverStarted.explanation.headline).toContain(
      "never started on this page",
    );
  });

  test("facts summarise version, session, state, decisions and capabilities", () => {
    const result: RecorderDiagnosticsResult = explainRecorderDiagnostics({
      version: "1.4.0",
      sessionId: "abc",
      state: "recording",
      stopReason: null,
      bootstrapDecision: "started",
      triggerReason: "error",
      decisions: {
        isSampled: true,
        captureTrigger: "Always",
        consentMode: "RequireExplicit",
        consentState: "unknown",
        uploadsAllowed: false,
        uploadBlockedBy: "consent",
        lastDirective: "continue",
        lastDirectiveReason: "consent-required",
        startDecision: "recording",
      },
      capabilities: ["click-events", 7],
      records: [],
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      const facts: Record<string, string> = {};

      for (const fact of result.explanation.facts) {
        facts[fact.label] = fact.value;
      }

      expect(facts["Recorder version"]).toBe("1.4.0");
      expect(facts["Session"]).toBe("abc");
      expect(facts["Sampled"]).toBe("yes");
      expect(facts["Consent"]).toBe("RequireExplicit (unknown)");
      expect(facts["Uploads"]).toBe("blocked by consent");
      expect(facts["Last server directive"]).toBe(
        "continue (consent-required)",
      );
      expect(facts["Upload trigger"]).toBe("error");
      expect(result.explanation.capabilities).toEqual(["click-events"]);
    }
  });

  test("a null decisions block is explained rather than omitted", () => {
    const result: RecorderDiagnosticsResult = explainRecorderDiagnostics({
      decisions: null,
      records: [],
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(
        result.explanation.facts.find((fact: { label: string }): boolean => {
          return fact.label === "Decisions";
        })?.value,
      ).toContain("no recorder object was built");
    }
  });

  test("unknown codes are listed once each", () => {
    const result: RecorderDiagnosticsResult = explainRecorderDiagnostics({
      records: [
        { code: "future-a", level: "info" },
        { code: "future-a", level: "info" },
        { code: "future-b", level: "warn" },
        { code: "loader-start", level: "info" },
      ],
    });

    expect(result.ok && result.explanation.unknownCodes).toEqual([
      "future-a",
      "future-b",
    ]);
  });
});
