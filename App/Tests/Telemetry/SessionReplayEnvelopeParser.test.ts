import { describe, expect, test } from "@jest/globals";
import SessionReplayEnvelopeParser, {
  ParsedSessionReplayFrame,
  SessionReplayEnvelopeError,
  SessionReplayParseResult,
} from "../../FeatureSet/Telemetry/Utils/SessionReplayEnvelopeParser";
import {
  MAX_SESSION_REPLAY_CHUNKS_PER_SESSION,
  MAX_SESSION_REPLAY_CHUNK_BYTES,
  SESSION_REPLAY_MAX_TAG_KEY_LENGTH,
  SESSION_REPLAY_MAX_TAG_VALUE_LENGTH,
  SESSION_REPLAY_MAX_TRAIT_KEYS,
  SESSION_REPLAY_RECORDER_CAPABILITIES,
  SESSION_REPLAY_WIRE_VERSION,
} from "Common/Types/Rum/SessionReplay";
import SessionReplayTriggerReason from "Common/Types/Rum/SessionReplayTriggerReason";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import { JSONObject } from "Common/Types/JSON";

/*
 * Wire decoder for a session-replay chunk POST. The body is one or more
 * `<envelope JSON>\n<payload bytes>` frames, the payload length taken from the
 * envelope's own `payloadBytes`, which makes that field load-bearing (it is
 * also the metering signal — a recorder that lies about it produces a body that
 * will not parse).
 *
 * The envelope is attacker-controllable (a scraped ingestion key is a public
 * credential by design), so every field is bounded and every unknown enum value
 * fails toward the safe default. These tests pin, through the public parse
 * contract: the frame framing and its distinct error codes; the wire-version
 * gate; the payloadBytes size / truncation gates; the app-identifier binding;
 * and the field-coercion defaults (recorderKind→dom, encoding→gzip,
 * consent→Unknown, masking→MaskAllText, trigger→Sampled).
 */

const APP_ID: string = "app-identifier-123";

interface Frame {
  envelope: JSONObject;
  payload: string;
}

/*
 * Build one `<envelope>\n<payload>` frame. payloadBytes defaults to the actual
 * payload byte length; pass it explicitly in the envelope to simulate a lying
 * recorder (over-cap, truncated, non-integer).
 */
function frameBuffer(frame: Frame): Buffer {
  const payloadBuf: Buffer = Buffer.from(frame.payload, "utf-8");
  const envelope: JSONObject = { ...frame.envelope };
  if (envelope["payloadBytes"] === undefined) {
    envelope["payloadBytes"] = payloadBuf.length;
  }
  const json: Buffer = Buffer.from(JSON.stringify(envelope), "utf-8");
  return Buffer.concat([json, Buffer.from("\n", "utf-8"), payloadBuf]);
}

function concatFrames(frames: Array<Frame>): Buffer {
  return Buffer.concat(frames.map(frameBuffer));
}

function baseEnvelope(overrides: JSONObject = {}): JSONObject {
  return {
    v: SESSION_REPLAY_WIRE_VERSION,
    appIdentifier: APP_ID,
    sessionId: "session-1",
    tabId: "tab-1",
    chunkIndex: 0,
    ...overrides,
  };
}

function parseValid(
  body: Buffer,
  appId: string = APP_ID,
): Extract<SessionReplayParseResult, { isValid: true }> {
  const result: SessionReplayParseResult = SessionReplayEnvelopeParser.parse(
    body,
    appId,
  );
  if (!result.isValid) {
    throw new Error(`Expected a valid parse, got ${result.error}`);
  }
  return result;
}

function parseError(
  body: Buffer,
  appId: string = APP_ID,
): SessionReplayEnvelopeError {
  const result: SessionReplayParseResult = SessionReplayEnvelopeParser.parse(
    body,
    appId,
  );
  if (result.isValid) {
    throw new Error("Expected an invalid parse, got a valid one");
  }
  return result.error;
}

describe("SessionReplayEnvelopeParser.parse — a well-formed body", () => {
  test("decodes a single frame and returns its payload as a view", () => {
    const result: Extract<SessionReplayParseResult, { isValid: true }> =
      parseValid(
        frameBuffer({ envelope: baseEnvelope(), payload: "hello-payload" }),
      );

    expect(result.frames).toHaveLength(1);
    expect(result.totalPayloadBytes).toBe("hello-payload".length);

    const frame: (typeof result.frames)[0] = result.frames[0]!;
    expect(frame.payload.toString("utf-8")).toBe("hello-payload");
    expect(frame.envelope.sessionId).toBe("session-1");
    expect(frame.envelope.tabId).toBe("tab-1");
    expect(frame.envelope.chunkIndex).toBe(0);
    expect(frame.envelope.payloadBytes).toBe("hello-payload".length);
  });

  test("decodes several concatenated frames and sums payload bytes", () => {
    const result: Extract<SessionReplayParseResult, { isValid: true }> =
      parseValid(
        concatFrames([
          { envelope: baseEnvelope({ chunkIndex: 0 }), payload: "aaa" },
          { envelope: baseEnvelope({ chunkIndex: 1 }), payload: "bbbb" },
          { envelope: baseEnvelope({ chunkIndex: 2 }), payload: "cc" },
        ]),
      );

    expect(result.frames).toHaveLength(3);
    expect(result.totalPayloadBytes).toBe(3 + 4 + 2);
    expect(
      result.frames.map((f: (typeof result.frames)[0]): number => {
        return f.envelope.chunkIndex;
      }),
    ).toEqual([0, 1, 2]);
    expect(result.frames[1]!.payload.toString("utf-8")).toBe("bbbb");
  });

  test("accepts an empty payload (payloadBytes 0)", () => {
    const result: Extract<SessionReplayParseResult, { isValid: true }> =
      parseValid(frameBuffer({ envelope: baseEnvelope(), payload: "" }));

    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]!.payload.length).toBe(0);
    expect(result.totalPayloadBytes).toBe(0);
  });

  test("app identifier binding is case-insensitive and whitespace-tolerant", () => {
    const result: Extract<SessionReplayParseResult, { isValid: true }> =
      parseValid(
        frameBuffer({
          envelope: baseEnvelope({ appIdentifier: APP_ID.toUpperCase() }),
          payload: "x",
        }),
        `  ${APP_ID}  `,
      );

    expect(result.frames).toHaveLength(1);
  });

  test("over-long id fields are capped rather than rejected", () => {
    const longSession: string = "s".repeat(200);
    const result: Extract<SessionReplayParseResult, { isValid: true }> =
      parseValid(
        frameBuffer({
          envelope: baseEnvelope({ sessionId: longSession }),
          payload: "x",
        }),
      );

    // MAX_ID_LENGTH is 64; the parser truncates instead of failing.
    expect(result.frames[0]!.envelope.sessionId).toBe("s".repeat(64));
  });
});

describe("SessionReplayEnvelopeParser.parse — field coercion defaults", () => {
  test("unknown / missing enum fields fall to their safe defaults", () => {
    const result: Extract<SessionReplayParseResult, { isValid: true }> =
      parseValid(frameBuffer({ envelope: baseEnvelope(), payload: "x" }));
    const env: (typeof result.frames)[0]["envelope"] =
      result.frames[0]!.envelope;

    expect(env.recorderKind).toBe("dom");
    expect(env.payloadEncoding).toBe("gzip");
    expect(env.consentState).toBe("Unknown");
    expect(env.maskingMode).toBe(SessionReplayMaskingMode.MaskAllText);
    expect(env.triggerReason).toBe(SessionReplayTriggerReason.Sampled);
    expect(env.hasFullSnapshot).toBe(false);
    expect(env.isFinal).toBe(false);
    // Signals default to an all-zero object, never undefined.
    expect(env.signals.errorCount).toBe(0);
    expect(env.signals.rageClickCount).toBe(0);
  });

  test("recognised enum values pass through unchanged", () => {
    const result: Extract<SessionReplayParseResult, { isValid: true }> =
      parseValid(
        frameBuffer({
          envelope: baseEnvelope({
            recorderKind: "rn-view-tree",
            payloadEncoding: "identity",
            consentState: "Granted",
            maskingMode: SessionReplayMaskingMode.MaskInputsOnly,
            triggerReason: SessionReplayTriggerReason.Error,
            hasFullSnapshot: true,
            isFinal: true,
          }),
          payload: "x",
        }),
      );
    const env: (typeof result.frames)[0]["envelope"] =
      result.frames[0]!.envelope;

    expect(env.recorderKind).toBe("rn-view-tree");
    expect(env.payloadEncoding).toBe("identity");
    expect(env.consentState).toBe("Granted");
    expect(env.maskingMode).toBe(SessionReplayMaskingMode.MaskInputsOnly);
    expect(env.triggerReason).toBe(SessionReplayTriggerReason.Error);
    expect(env.hasFullSnapshot).toBe(true);
    expect(env.isFinal).toBe(true);
  });

  test("non-boolean hasFullSnapshot / isFinal are treated as false (=== true only)", () => {
    const result: Extract<SessionReplayParseResult, { isValid: true }> =
      parseValid(
        frameBuffer({
          envelope: baseEnvelope({ hasFullSnapshot: "true", isFinal: 1 }),
          payload: "x",
        }),
      );

    expect(result.frames[0]!.envelope.hasFullSnapshot).toBe(false);
    expect(result.frames[0]!.envelope.isFinal).toBe(false);
  });

  test("signal counts are parsed and clamped to non-negative integers", () => {
    const result: Extract<SessionReplayParseResult, { isValid: true }> =
      parseValid(
        frameBuffer({
          envelope: baseEnvelope({
            signals: {
              errorCount: 3,
              rageClickCount: -5, // clamped to 0
              deadClickCount: 2.7, // non-integer -> 0
            },
          }),
          payload: "x",
        }),
      );
    const signals: (typeof result.frames)[0]["envelope"]["signals"] =
      result.frames[0]!.envelope.signals;

    expect(signals.errorCount).toBe(3);
    expect(signals.rageClickCount).toBe(0);
    expect(signals.deadClickCount).toBe(0);
  });

  test("traceIds / routes are attached only when non-empty", () => {
    const withArrays: Extract<SessionReplayParseResult, { isValid: true }> =
      parseValid(
        frameBuffer({
          envelope: baseEnvelope({
            traceIds: ["abc", "", "def"], // blanks dropped
            routes: ["/home", "/settings"],
          }),
          payload: "x",
        }),
      );
    expect(withArrays.frames[0]!.envelope.traceIds).toEqual(["abc", "def"]);
    expect(withArrays.frames[0]!.envelope.routes).toEqual([
      "/home",
      "/settings",
    ]);

    const withoutArrays: Extract<SessionReplayParseResult, { isValid: true }> =
      parseValid(frameBuffer({ envelope: baseEnvelope(), payload: "x" }));
    expect(withoutArrays.frames[0]!.envelope.traceIds).toBeUndefined();
    expect(withoutArrays.frames[0]!.envelope.routes).toBeUndefined();
  });

  test("snapshotPart is kept only when total > 1 and index < total", () => {
    const kept: Extract<SessionReplayParseResult, { isValid: true }> =
      parseValid(
        frameBuffer({
          envelope: baseEnvelope({ snapshotPart: { index: 1, total: 3 } }),
          payload: "x",
        }),
      );
    expect(kept.frames[0]!.envelope.snapshotPart).toEqual({
      index: 1,
      total: 3,
    });

    const droppedSingle: Extract<SessionReplayParseResult, { isValid: true }> =
      parseValid(
        frameBuffer({
          envelope: baseEnvelope({ snapshotPart: { index: 0, total: 1 } }),
          payload: "x",
        }),
      );
    expect(droppedSingle.frames[0]!.envelope.snapshotPart).toBeUndefined();

    const droppedOutOfRange: Extract<
      SessionReplayParseResult,
      { isValid: true }
    > = parseValid(
      frameBuffer({
        envelope: baseEnvelope({ snapshotPart: { index: 3, total: 3 } }),
        payload: "x",
      }),
    );
    expect(droppedOutOfRange.frames[0]!.envelope.snapshotPart).toBeUndefined();
  });
});

describe("SessionReplayEnvelopeParser.parse — rejection codes", () => {
  test("empty body → EmptyBody", () => {
    expect(parseError(Buffer.alloc(0))).toBe(
      SessionReplayEnvelopeError.EmptyBody,
    );
  });

  test("no newline in a short body → MissingEnvelope", () => {
    expect(parseError(Buffer.from('{"v":1}', "utf-8"))).toBe(
      SessionReplayEnvelopeError.MissingEnvelope,
    );
  });

  test("no newline within the 8KiB envelope window → EnvelopeTooLarge", () => {
    // A long body whose separator (if any) is past the scan window.
    const huge: Buffer = Buffer.from("x".repeat(9000), "utf-8");
    expect(parseError(huge)).toBe(SessionReplayEnvelopeError.EnvelopeTooLarge);
  });

  test("non-JSON envelope → MalformedEnvelope", () => {
    expect(parseError(Buffer.from("{not json\npayload", "utf-8"))).toBe(
      SessionReplayEnvelopeError.MalformedEnvelope,
    );
  });

  test("a JSON envelope that is not an object → MalformedEnvelope", () => {
    expect(parseError(Buffer.from("123\npayload", "utf-8"))).toBe(
      SessionReplayEnvelopeError.MalformedEnvelope,
    );
  });

  test("wire version below 1 or above the current → UnsupportedWireVersion", () => {
    expect(
      parseError(
        frameBuffer({ envelope: baseEnvelope({ v: 0 }), payload: "x" }),
      ),
    ).toBe(SessionReplayEnvelopeError.UnsupportedWireVersion);
    expect(
      parseError(
        frameBuffer({
          envelope: baseEnvelope({ v: SESSION_REPLAY_WIRE_VERSION + 1 }),
          payload: "x",
        }),
      ),
    ).toBe(SessionReplayEnvelopeError.UnsupportedWireVersion);
  });

  test("missing / negative / non-integer payloadBytes → MalformedEnvelope", () => {
    // Missing entirely.
    const noBytes: JSONObject = baseEnvelope();
    const json: Buffer = Buffer.from(JSON.stringify(noBytes), "utf-8");
    const body: Buffer = Buffer.concat([
      json,
      Buffer.from("\npayload", "utf-8"),
    ]);
    expect(parseError(body)).toBe(SessionReplayEnvelopeError.MalformedEnvelope);

    // Non-integer.
    expect(
      parseError(
        frameBuffer({
          envelope: baseEnvelope({ payloadBytes: 3.5 }),
          payload: "abc",
        }),
      ),
    ).toBe(SessionReplayEnvelopeError.MalformedEnvelope);
  });

  test("payloadBytes over the per-frame cap → SnapshotTooLarge (its own code)", () => {
    expect(
      parseError(
        frameBuffer({
          envelope: baseEnvelope({
            payloadBytes: MAX_SESSION_REPLAY_CHUNK_BYTES + 1,
          }),
          payload: "",
        }),
      ),
    ).toBe(SessionReplayEnvelopeError.SnapshotTooLarge);
  });

  test("payloadBytes larger than the body provides → TruncatedPayload", () => {
    expect(
      parseError(
        frameBuffer({
          envelope: baseEnvelope({ payloadBytes: 100 }),
          payload: "abc",
        }),
      ),
    ).toBe(SessionReplayEnvelopeError.TruncatedPayload);
  });

  test("app identifier mismatch → AppIdentifierMismatch", () => {
    expect(
      parseError(
        frameBuffer({
          envelope: baseEnvelope({ appIdentifier: "some-other-app" }),
          payload: "x",
        }),
      ),
    ).toBe(SessionReplayEnvelopeError.AppIdentifierMismatch);
  });

  test("missing sessionId or tabId → MalformedEnvelope", () => {
    expect(
      parseError(
        frameBuffer({
          envelope: baseEnvelope({ sessionId: "" }),
          payload: "x",
        }),
      ),
    ).toBe(SessionReplayEnvelopeError.MalformedEnvelope);
    expect(
      parseError(
        frameBuffer({ envelope: baseEnvelope({ tabId: "" }), payload: "x" }),
      ),
    ).toBe(SessionReplayEnvelopeError.MalformedEnvelope);
  });

  /*
   * Audit finding ingest-3: a MISSING or garbled chunkIndex used to share the
   * out-of-range code with the per-session cap, so the route answered it as
   * "session-chunk-cap" and stopped the recorder after chunk 0 with a reason
   * that sent the customer looking at the wrong thing. Malformed is now its
   * own 400 code.
   */
  test("negative / fractional / missing / absurd chunkIndex → ChunkIndexMalformed", () => {
    for (const chunkIndex of [-1, 2.5, undefined, "3", 5_000_000_000]) {
      const envelope: JSONObject = baseEnvelope();

      if (chunkIndex === undefined) {
        delete envelope["chunkIndex"];
      } else {
        envelope["chunkIndex"] = chunkIndex as number | string;
      }

      expect(
        parseError(frameBuffer({ envelope: envelope, payload: "x" })),
      ).toBe(SessionReplayEnvelopeError.ChunkIndexMalformed);
    }
  });

  /*
   * Audit finding ingest-4: the per-session cap is a GATE decision taken per
   * frame, not a parse failure. A body carrying frames on both sides of the
   * cap parses whole, so the route can keep the frames under it.
   */
  test("a chunkIndex at or past the per-session cap still parses", () => {
    const result: Extract<SessionReplayParseResult, { isValid: true }> =
      parseValid(
        concatFrames([
          {
            envelope: baseEnvelope({
              chunkIndex: MAX_SESSION_REPLAY_CHUNKS_PER_SESSION - 1,
            }),
            payload: "a",
          },
          {
            envelope: baseEnvelope({
              chunkIndex: MAX_SESSION_REPLAY_CHUNKS_PER_SESSION,
            }),
            payload: "b",
          },
        ]),
      );

    expect(
      result.frames.map((frame: ParsedSessionReplayFrame): number => {
        return frame.envelope.chunkIndex;
      }),
    ).toEqual([
      MAX_SESSION_REPLAY_CHUNKS_PER_SESSION - 1,
      MAX_SESSION_REPLAY_CHUNKS_PER_SESSION,
    ]);
  });

  test("more frames than a request may carry → TooManyFrames", () => {
    // 9 frames; the request cap is 8, and the guard fires before parsing #9.
    const frames: Array<Frame> = [];
    for (let i: number = 0; i < 9; i++) {
      frames.push({ envelope: baseEnvelope({ chunkIndex: i }), payload: "y" });
    }
    expect(parseError(concatFrames(frames))).toBe(
      SessionReplayEnvelopeError.TooManyFrames,
    );
  });
});

describe("SessionReplayEnvelopeParser.parse — raw frame views", () => {
  test("each frame carries its own bytes so a subset can be re-staged verbatim", () => {
    const first: Buffer = frameBuffer({
      envelope: baseEnvelope({ chunkIndex: 0 }),
      payload: "first-payload",
    });
    const second: Buffer = frameBuffer({
      envelope: baseEnvelope({ chunkIndex: 1 }),
      payload: "second",
    });

    const result: Extract<SessionReplayParseResult, { isValid: true }> =
      parseValid(Buffer.concat([first, second]));

    expect(Buffer.from(result.frames[0]!.raw).equals(first)).toBe(true);
    expect(Buffer.from(result.frames[1]!.raw).equals(second)).toBe(true);

    /* Re-parsing one frame's raw bytes yields that frame alone. */
    const reparsed: Extract<SessionReplayParseResult, { isValid: true }> =
      parseValid(Buffer.from(result.frames[1]!.raw));

    expect(reparsed.frames).toHaveLength(1);
    expect(reparsed.frames[0]!.envelope.chunkIndex).toBe(1);
    expect(reparsed.frames[0]!.payload.toString("utf-8")).toBe("second");
  });
});

/*
 * The additive wire fields: traits, tags, engagement counters and recorder
 * capabilities. Every one is optional, every one is capped by truncation
 * rather than rejection, and an envelope that predates them parses to
 * exactly what it parsed to before.
 */
describe("SessionReplayEnvelopeParser.parse — additive fields", () => {
  test("an old envelope parses identically: no traits, tags, counters or capabilities", () => {
    const result: Extract<SessionReplayParseResult, { isValid: true }> =
      parseValid(
        frameBuffer({
          envelope: baseEnvelope({
            meta: { entryUrl: "https://x.example/", browserName: "Chrome" },
            signals: { errorCount: 1 },
          }),
          payload: "x",
        }),
      );

    const envelope: (typeof result.frames)[0]["envelope"] =
      result.frames[0]!.envelope;

    expect(envelope.meta).toBeDefined();
    expect("identifiedUserTraits" in envelope.meta!).toBe(false);
    expect("tags" in envelope.meta!).toBe(false);
    expect("clickCount" in envelope.signals).toBe(false);
    expect("customEventCount" in envelope.signals).toBe(false);
    expect("capabilities" in envelope).toBe(false);
  });

  test("traits and tags are read through the shared sanitiser with their caps", () => {
    const tooManyTraits: Record<string, unknown> = {};

    for (let i: number = 0; i < SESSION_REPLAY_MAX_TRAIT_KEYS + 5; i++) {
      tooManyTraits[`trait-${i}`] = `value-${i}`;
    }

    const result: Extract<SessionReplayParseResult, { isValid: true }> =
      parseValid(
        frameBuffer({
          envelope: baseEnvelope({
            meta: {
              entryUrl: "https://x.example/",
              identifiedUserTraits: {
                ...tooManyTraits,
                plan: "pro",
                seats: 12,
                nested: { not: "a string" },
              },
              tags: {
                ["k".repeat(SESSION_REPLAY_MAX_TAG_KEY_LENGTH + 10)]:
                  "v".repeat(SESSION_REPLAY_MAX_TAG_VALUE_LENGTH + 50),
                build: "abc123",
              },
            },
          }),
          payload: "x",
        }),
      );

    const meta: NonNullable<(typeof result.frames)[0]["envelope"]["meta"]> =
      result.frames[0]!.envelope.meta!;

    /* Truncated to the cap, never rejected: the first N keys survive. */
    expect(Object.keys(meta.identifiedUserTraits!)).toHaveLength(
      SESSION_REPLAY_MAX_TRAIT_KEYS,
    );
    expect(meta.identifiedUserTraits!["trait-0"]).toBe("value-0");
    expect(meta.identifiedUserTraits!["nested"]).toBeUndefined();

    const tagKeys: Array<string> = Object.keys(meta.tags!);
    expect(tagKeys).toHaveLength(2);
    expect(tagKeys[0]!.length).toBe(SESSION_REPLAY_MAX_TAG_KEY_LENGTH);
    expect(meta.tags![tagKeys[0]!]!.length).toBe(
      SESSION_REPLAY_MAX_TAG_VALUE_LENGTH,
    );
    expect(meta.tags!["build"]).toBe("abc123");
  });

  test("a non-object traits / tags value yields no map rather than a failure", () => {
    const result: Extract<SessionReplayParseResult, { isValid: true }> =
      parseValid(
        frameBuffer({
          envelope: baseEnvelope({
            meta: {
              entryUrl: "https://x.example/",
              identifiedUserTraits: ["not", "a", "map"],
              tags: "nope",
            },
          }),
          payload: "x",
        }),
      );

    const meta: NonNullable<(typeof result.frames)[0]["envelope"]["meta"]> =
      result.frames[0]!.envelope.meta!;

    expect(meta.identifiedUserTraits).toBeUndefined();
    expect(meta.tags).toBeUndefined();
  });

  test("clickCount / customEventCount are kept when sane and absent when garbled", () => {
    const sane: Extract<SessionReplayParseResult, { isValid: true }> =
      parseValid(
        frameBuffer({
          envelope: baseEnvelope({
            signals: { clickCount: 41, customEventCount: 0 },
          }),
          payload: "x",
        }),
      );

    expect(sane.frames[0]!.envelope.signals.clickCount).toBe(41);
    expect(sane.frames[0]!.envelope.signals.customEventCount).toBe(0);

    const garbled: Extract<SessionReplayParseResult, { isValid: true }> =
      parseValid(
        frameBuffer({
          envelope: baseEnvelope({
            signals: { clickCount: -3, customEventCount: "12" },
          }),
          payload: "x",
        }),
      );

    expect("clickCount" in garbled.frames[0]!.envelope.signals).toBe(false);
    expect("customEventCount" in garbled.frames[0]!.envelope.signals).toBe(
      false,
    );
  });

  test("capabilities are filtered to the known list, deduplicated and canonically ordered", () => {
    const result: Extract<SessionReplayParseResult, { isValid: true }> =
      parseValid(
        frameBuffer({
          envelope: baseEnvelope({
            capabilities: [
              "web-vitals",
              "click-events",
              "web-vitals",
              "made-up-capability",
              42,
            ],
          }),
          payload: "x",
        }),
      );

    expect(result.frames[0]!.envelope.capabilities).toEqual([
      "click-events",
      "web-vitals",
    ]);

    for (const capability of result.frames[0]!.envelope.capabilities!) {
      expect(SESSION_REPLAY_RECORDER_CAPABILITIES).toContain(capability);
    }
  });

  test("an empty or non-array capabilities field is simply absent", () => {
    for (const capabilities of [[], "click-events", {}]) {
      const result: Extract<SessionReplayParseResult, { isValid: true }> =
        parseValid(
          frameBuffer({
            envelope: baseEnvelope({
              capabilities: capabilities as Array<string>,
            }),
            payload: "x",
          }),
        );

      expect("capabilities" in result.frames[0]!.envelope).toBe(false);
    }
  });
});
