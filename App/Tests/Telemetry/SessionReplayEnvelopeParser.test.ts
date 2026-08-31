import { describe, expect, test } from "@jest/globals";
import SessionReplayEnvelopeParser, {
  SessionReplayEnvelopeError,
  SessionReplayParseResult,
} from "../../FeatureSet/Telemetry/Utils/SessionReplayEnvelopeParser";
import {
  MAX_SESSION_REPLAY_CHUNKS_PER_SESSION,
  MAX_SESSION_REPLAY_CHUNK_BYTES,
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

  test("chunkIndex out of range → ChunkIndexOutOfRange", () => {
    expect(
      parseError(
        frameBuffer({
          envelope: baseEnvelope({ chunkIndex: -1 }),
          payload: "x",
        }),
      ),
    ).toBe(SessionReplayEnvelopeError.ChunkIndexOutOfRange);
    expect(
      parseError(
        frameBuffer({
          envelope: baseEnvelope({
            chunkIndex: MAX_SESSION_REPLAY_CHUNKS_PER_SESSION,
          }),
          payload: "x",
        }),
      ),
    ).toBe(SessionReplayEnvelopeError.ChunkIndexOutOfRange);
    expect(
      parseError(
        frameBuffer({
          envelope: baseEnvelope({ chunkIndex: 2.5 }),
          payload: "x",
        }),
      ),
    ).toBe(SessionReplayEnvelopeError.ChunkIndexOutOfRange);
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
