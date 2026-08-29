import {
  MAX_SESSION_REPLAY_CHUNKS_PER_REQUEST,
  MAX_SESSION_REPLAY_CHUNKS_PER_SESSION,
  MAX_SESSION_REPLAY_CHUNK_BYTES,
  SESSION_REPLAY_MAX_USER_REF_LENGTH,
  SESSION_REPLAY_WIRE_VERSION,
  SessionReplayChunkEnvelope,
  SessionReplayChunkMeta,
  SessionReplayConsentState,
  SessionReplayPayloadEncoding,
  SessionReplayRecorderKind,
  SessionReplaySignalCounts,
} from "Common/Types/Rum/SessionReplay";
import SessionReplayMaskingMode, {
  parseSessionReplayMaskingMode,
} from "Common/Types/Rum/SessionReplayMaskingMode";
import SessionReplayTriggerReason from "Common/Types/Rum/SessionReplayTriggerReason";
import { JSONObject } from "Common/Types/JSON";

/*
 * Wire format decoder for a session-replay chunk POST.
 *
 * The body is one or more frames concatenated, each frame being
 *
 *   <envelope JSON>\n<payload bytes>
 *
 * with the payload length taken from the envelope's own `payloadBytes`.
 * That makes the stream self-delimiting without a separate length prefix,
 * and it makes `payloadBytes` load-bearing rather than advisory - which is
 * good, because it is also the metering signal, so a recorder that lies
 * about it produces a body that will not parse.
 *
 * The envelope lives in the body rather than in a dozen custom headers on
 * purpose: every extra request header widens the CORS preflight surface on
 * a browser endpoint, whereas scanning for the first 0x0A and parsing a
 * ~200 byte JSON object costs microseconds.
 *
 * Nothing here decompresses anything. The payload stays an opaque buffer
 * until the worker, so the HTTP path never spends CPU on gunzip.
 */

/*
 * Hard ceiling on the envelope JSON itself. Bounds both the newline scan
 * and the JSON.parse: without it a 2MiB body containing no newline would be
 * scanned in full, and a 2MiB "envelope" would be handed to JSON.parse on
 * the request thread.
 */
const MAX_ENVELOPE_JSON_BYTES: number = 8 * 1024;

/* Field length caps. Every one of these lands in a ClickHouse row. */
const MAX_ID_LENGTH: number = 64;
const MAX_URL_LENGTH: number = 2048;
const MAX_VERSION_STRING_LENGTH: number = 32;
const MAX_FIDELITY_NOTICES: number = 32;
const MAX_TRACE_IDS: number = 64;

/*
 * Mirrors MAX_ROUTES_PER_CHUNK in the recorder's Chunker. Kept a little
 * higher than the client cap so a legitimate client is never truncated by
 * the parser - the parser's job here is to bound a hostile envelope, not to
 * second-guess the recorder.
 */
const MAX_ROUTES: number = 64;
const MAX_TRACE_ID_LENGTH: number = 64;
const MAX_META_STRING_LENGTH: number = 128;

/*
 * Reasons a body is refused, kept as codes rather than prose so the route
 * can map them to distinct status codes and the metrics can be labelled by
 * cause. The split that matters is SnapshotTooLarge (422) against
 * everything else (400): an indivisible full snapshot that will not fit is
 * a fidelity problem for one chunk, and the session should survive it with
 * a disclosure rather than vanishing behind a size error.
 */
export enum SessionReplayEnvelopeError {
  EmptyBody = "empty-body",
  MissingEnvelope = "missing-envelope",
  EnvelopeTooLarge = "envelope-too-large",
  MalformedEnvelope = "malformed-envelope",
  UnsupportedWireVersion = "unsupported-wire-version",
  TruncatedPayload = "truncated-payload",
  TooManyFrames = "too-many-frames",
  SnapshotTooLarge = "snapshot-too-large",
  AppIdentifierMismatch = "app-identifier-mismatch",
  ChunkIndexOutOfRange = "chunk-index-out-of-range",
}

export interface ParsedSessionReplayFrame {
  envelope: SessionReplayChunkEnvelope;

  /*
   * A view onto the request buffer, not a copy. Callers must not hold it
   * past the request unless they copy it - which the staging path does when
   * it base64-encodes or writes to Redis.
   */
  payload: Buffer;
}

export type SessionReplayParseResult =
  | {
      isValid: true;
      frames: Array<ParsedSessionReplayFrame>;
      totalPayloadBytes: number;
    }
  | {
      isValid: false;
      error: SessionReplayEnvelopeError;
      message: string;
    };

export default class SessionReplayEnvelopeParser {
  /*
   * Decode a chunk POST body.
   *
   * `expectedAppIdentifier` is the value from the x-oneuptime-app-identifier
   * header, which is what the ingest gates were evaluated against. Every
   * frame must agree with it: otherwise a client could pass the gate for an
   * application with a permissive policy and write rows attributed to a
   * different one.
   */
  public static parse(
    body: Buffer,
    expectedAppIdentifier: string,
  ): SessionReplayParseResult {
    if (!body || body.length === 0) {
      return {
        isValid: false,
        error: SessionReplayEnvelopeError.EmptyBody,
        message: "Request body is empty.",
      };
    }

    const frames: Array<ParsedSessionReplayFrame> = [];
    let offset: number = 0;
    let totalPayloadBytes: number = 0;

    while (offset < body.length) {
      if (frames.length >= MAX_SESSION_REPLAY_CHUNKS_PER_REQUEST) {
        return {
          isValid: false,
          error: SessionReplayEnvelopeError.TooManyFrames,
          message: `A request may carry at most ${MAX_SESSION_REPLAY_CHUNKS_PER_REQUEST} frames.`,
        };
      }

      /*
       * Scan for the separator only across the window an envelope is
       * allowed to occupy, so a 2MiB body with no newline in it costs one
       * bounded memchr rather than a full-body one.
       */
      const scanEnd: number = Math.min(
        body.length,
        offset + MAX_ENVELOPE_JSON_BYTES + 1,
      );

      const relativeNewlineIndex: number = body
        .subarray(offset, scanEnd)
        .indexOf(0x0a);

      if (relativeNewlineIndex === -1) {
        /*
         * Distinguish "no separator anywhere" from "envelope longer than
         * the cap" only by how much of the body we were allowed to look at:
         * if the window covered the whole remaining body there is genuinely
         * no separator, otherwise the envelope is oversized.
         */
        return {
          isValid: false,
          error:
            scanEnd === body.length
              ? SessionReplayEnvelopeError.MissingEnvelope
              : SessionReplayEnvelopeError.EnvelopeTooLarge,
          message:
            scanEnd === body.length
              ? "Frame is missing the newline separating its envelope from its payload."
              : `Frame envelope exceeds ${MAX_ENVELOPE_JSON_BYTES} bytes.`,
        };
      }

      const newlineIndex: number = offset + relativeNewlineIndex;

      let parsedJson: unknown = undefined;

      try {
        parsedJson = JSON.parse(
          body.subarray(offset, newlineIndex).toString("utf-8"),
        );
      } catch {
        return {
          isValid: false,
          error: SessionReplayEnvelopeError.MalformedEnvelope,
          message: "Frame envelope is not valid JSON.",
        };
      }

      if (!parsedJson || typeof parsedJson !== "object") {
        return {
          isValid: false,
          error: SessionReplayEnvelopeError.MalformedEnvelope,
          message: "Frame envelope must be a JSON object.",
        };
      }

      const raw: JSONObject = parsedJson as JSONObject;

      const wireVersion: number = this.readNumber(raw["v"], -1);

      if (wireVersion < 1 || wireVersion > SESSION_REPLAY_WIRE_VERSION) {
        return {
          isValid: false,
          error: SessionReplayEnvelopeError.UnsupportedWireVersion,
          message: `Unsupported session replay wire version: ${String(raw["v"])}.`,
        };
      }

      const declaredPayloadBytes: number = this.readNumber(
        raw["payloadBytes"],
        -1,
      );

      if (declaredPayloadBytes < 0 || !Number.isInteger(declaredPayloadBytes)) {
        return {
          isValid: false,
          error: SessionReplayEnvelopeError.MalformedEnvelope,
          message: "payloadBytes must be a non-negative integer.",
        };
      }

      /*
       * A recorder that could not split an indivisible full snapshot small
       * enough tells us by declaring an over-cap frame. 422 rather than 413
       * so the session is still recorded, with a fidelity notice, instead
       * of disappearing behind a size error.
       */
      if (declaredPayloadBytes > MAX_SESSION_REPLAY_CHUNK_BYTES) {
        return {
          isValid: false,
          error: SessionReplayEnvelopeError.SnapshotTooLarge,
          message: `A single frame may not exceed ${MAX_SESSION_REPLAY_CHUNK_BYTES} bytes.`,
        };
      }

      const payloadStart: number = newlineIndex + 1;
      const payloadEnd: number = payloadStart + declaredPayloadBytes;

      if (payloadEnd > body.length) {
        return {
          isValid: false,
          error: SessionReplayEnvelopeError.TruncatedPayload,
          message:
            "Frame declares more payload bytes than the request body contains.",
        };
      }

      const appIdentifier: string = this.readString(
        raw["appIdentifier"],
        MAX_ID_LENGTH,
      );

      /*
       * Case-insensitive because RumApplication lookup is
       * case-insensitive (QueryHelper.findWithSameText), so a case-only
       * difference resolves to the same application and rejecting it would
       * be a confusing false negative.
       */
      if (
        appIdentifier.toLowerCase() !==
        expectedAppIdentifier.trim().toLowerCase()
      ) {
        return {
          isValid: false,
          error: SessionReplayEnvelopeError.AppIdentifierMismatch,
          message:
            "Frame appIdentifier does not match the x-oneuptime-app-identifier header the request was authorized against.",
        };
      }

      const sessionId: string = this.readString(
        raw["sessionId"],
        MAX_ID_LENGTH,
      );
      const tabId: string = this.readString(raw["tabId"], MAX_ID_LENGTH);

      if (!sessionId || !tabId) {
        return {
          isValid: false,
          error: SessionReplayEnvelopeError.MalformedEnvelope,
          message: "sessionId and tabId are required.",
        };
      }

      const chunkIndex: number = this.readNumber(raw["chunkIndex"], -1);

      if (
        !Number.isInteger(chunkIndex) ||
        chunkIndex < 0 ||
        chunkIndex >= MAX_SESSION_REPLAY_CHUNKS_PER_SESSION
      ) {
        return {
          isValid: false,
          error: SessionReplayEnvelopeError.ChunkIndexOutOfRange,
          message: `chunkIndex must be an integer in [0, ${MAX_SESSION_REPLAY_CHUNKS_PER_SESSION}).`,
        };
      }

      const envelope: SessionReplayChunkEnvelope = {
        v: wireVersion,
        appIdentifier: appIdentifier,
        sessionId: sessionId,
        tabId: tabId,
        chunkIndex: chunkIndex,
        sessionStartUnixMs: this.readNumber(raw["sessionStartUnixMs"], 0),
        clientSendUnixMs: this.readNumber(raw["clientSendUnixMs"], 0),
        chunkStartOffsetMs: this.readNonNegativeInteger(
          raw["chunkStartOffsetMs"],
        ),
        chunkEndOffsetMs: this.readNonNegativeInteger(raw["chunkEndOffsetMs"]),
        eventCount: this.readNonNegativeInteger(raw["eventCount"]),
        hasFullSnapshot: raw["hasFullSnapshot"] === true,
        isFinal: raw["isFinal"] === true,
        recorderKind: this.readRecorderKind(raw["recorderKind"]),
        schemaVersion: this.readNonNegativeInteger(raw["schemaVersion"]),
        rrwebVersion: this.readString(
          raw["rrwebVersion"],
          MAX_VERSION_STRING_LENGTH,
        ),
        recorderVersion: this.readString(
          raw["recorderVersion"],
          MAX_VERSION_STRING_LENGTH,
        ),
        maskingMode: this.readMaskingMode(raw["maskingMode"]),
        consentState: this.readConsentState(raw["consentState"]),
        triggerReason: this.readTriggerReason(raw["triggerReason"]),
        payloadEncoding: this.readPayloadEncoding(raw["payloadEncoding"]),
        payloadBytes: declaredPayloadBytes,
        url: this.readString(raw["url"], MAX_URL_LENGTH),
        signals: this.readSignals(raw["signals"]),
        fidelityNotices: this.readStringArray(
          raw["fidelityNotices"],
          MAX_FIDELITY_NOTICES,
          MAX_ID_LENGTH,
        ),
        droppedEvents: this.readNonNegativeInteger(raw["droppedEvents"]),
        flushFailures: this.readNonNegativeInteger(raw["flushFailures"]),
      };

      const snapshotPart: { index: number; total: number } | undefined =
        this.readSnapshotPart(raw["snapshotPart"]);

      /*
       * exactOptionalPropertyTypes means assigning `undefined` to an
       * optional property is not the same as leaving it out, so the
       * optional members are attached conditionally.
       */
      if (snapshotPart) {
        envelope.snapshotPart = snapshotPart;
      }

      const meta: SessionReplayChunkMeta | undefined = this.readMeta(
        raw["meta"],
      );

      if (meta) {
        envelope.meta = meta;
      }

      const traceIds: Array<string> = this.readStringArray(
        raw["traceIds"],
        MAX_TRACE_IDS,
        MAX_TRACE_ID_LENGTH,
      );

      if (traceIds.length > 0) {
        envelope.traceIds = traceIds;
      }

      /*
       * Optional and additive: a recorder built before this field existed
       * simply sends none, and the ingest falls back to `url`. Capped and
       * length-limited like every other array on the wire, because the
       * envelope is attacker-controllable - a scraped ingestion key is a
       * public credential by design.
       */
      const routes: Array<string> = this.readStringArray(
        raw["routes"],
        MAX_ROUTES,
        MAX_URL_LENGTH,
      );

      if (routes.length > 0) {
        envelope.routes = routes;
      }

      frames.push({
        envelope: envelope,
        payload: body.subarray(payloadStart, payloadEnd),
      });

      totalPayloadBytes += declaredPayloadBytes;

      offset = payloadEnd;
    }

    if (frames.length === 0) {
      return {
        isValid: false,
        error: SessionReplayEnvelopeError.EmptyBody,
        message: "Request body contained no frames.",
      };
    }

    return {
      isValid: true,
      frames: frames,
      totalPayloadBytes: totalPayloadBytes,
    };
  }

  private static readString(value: unknown, maxLength: number): string {
    if (typeof value !== "string") {
      return "";
    }

    const trimmed: string = value.trim();

    return trimmed.length > maxLength
      ? trimmed.substring(0, maxLength)
      : trimmed;
  }

  private static readNumber(value: unknown, fallback: number): number {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    return fallback;
  }

  private static readNonNegativeInteger(value: unknown): number {
    const parsed: number = this.readNumber(value, 0);

    if (!Number.isInteger(parsed) || parsed < 0) {
      return 0;
    }

    return parsed;
  }

  private static readRecorderKind(value: unknown): SessionReplayRecorderKind {
    return value === "rn-view-tree" ? "rn-view-tree" : "dom";
  }

  private static readPayloadEncoding(
    value: unknown,
  ): SessionReplayPayloadEncoding {
    /*
     * Defaults to gzip because that is what every shipped recorder sends;
     * "identity" is the fallback for a browser with no CompressionStream.
     * Never widened beyond these two: the whole server decode vocabulary is
     * gzip-or-nothing, and raw DEFLATE would be stored as garbage.
     */
    return value === "identity" ? "identity" : "gzip";
  }

  private static readConsentState(value: unknown): SessionReplayConsentState {
    if (value === "Granted") {
      return "Granted";
    }

    if (value === "NotRequired") {
      return "NotRequired";
    }

    /*
     * Anything unrecognised is Unknown, not Granted. A recorder that omits
     * or garbles the field must not be treated as having consent.
     */
    return "Unknown";
  }

  private static readMaskingMode(value: unknown): SessionReplayMaskingMode {
    return parseSessionReplayMaskingMode(value);
  }

  private static readTriggerReason(value: unknown): SessionReplayTriggerReason {
    switch (value) {
      case SessionReplayTriggerReason.Error:
        return SessionReplayTriggerReason.Error;
      case SessionReplayTriggerReason.Frustration:
        return SessionReplayTriggerReason.Frustration;
      case SessionReplayTriggerReason.Manual:
        return SessionReplayTriggerReason.Manual;
      case SessionReplayTriggerReason.Performance:
        return SessionReplayTriggerReason.Performance;
      default:
        return SessionReplayTriggerReason.Sampled;
    }
  }

  private static readSignals(value: unknown): SessionReplaySignalCounts {
    const raw: JSONObject =
      value && typeof value === "object" ? (value as JSONObject) : {};

    return {
      errorCount: this.readNonNegativeInteger(raw["errorCount"]),
      rageClickCount: this.readNonNegativeInteger(raw["rageClickCount"]),
      deadClickCount: this.readNonNegativeInteger(raw["deadClickCount"]),
      errorClickCount: this.readNonNegativeInteger(raw["errorClickCount"]),
      refreshRageCount: this.readNonNegativeInteger(raw["refreshRageCount"]),
      routeCount: this.readNonNegativeInteger(raw["routeCount"]),
    };
  }

  private static readSnapshotPart(
    value: unknown,
  ): { index: number; total: number } | undefined {
    if (!value || typeof value !== "object") {
      return undefined;
    }

    const raw: JSONObject = value as JSONObject;

    const index: number = this.readNonNegativeInteger(raw["index"]);
    const total: number = this.readNonNegativeInteger(raw["total"]);

    if (total <= 1 || index >= total) {
      return undefined;
    }

    return { index: index, total: total };
  }

  private static readMeta(value: unknown): SessionReplayChunkMeta | undefined {
    if (!value || typeof value !== "object") {
      return undefined;
    }

    const raw: JSONObject = value as JSONObject;

    const meta: SessionReplayChunkMeta = {
      entryUrl: this.readString(raw["entryUrl"], MAX_URL_LENGTH),
      browserName: this.readString(raw["browserName"], MAX_META_STRING_LENGTH),
      browserVersion: this.readString(
        raw["browserVersion"],
        MAX_META_STRING_LENGTH,
      ),
      osName: this.readString(raw["osName"], MAX_META_STRING_LENGTH),
      deviceType: this.readString(raw["deviceType"], MAX_META_STRING_LENGTH),
      viewportWidth: this.readNonNegativeInteger(raw["viewportWidth"]),
      viewportHeight: this.readNonNegativeInteger(raw["viewportHeight"]),
    };

    /*
     * Capped at SESSION_REPLAY_MAX_USER_REF_LENGTH, not at the 128-byte cap
     * the device strings beside it use.
     *
     * This value has to survive a round trip that the other meta fields do
     * not. The recorder slices the CONFIG request's user-ref header to
     * exactly this length and the targeting handshake hashes it there, while
     * on the chunk path this truncation is the only bound - so the two paths
     * agree only if both cut at the same place. Truncating further HERE
     * would silently make the stored key the HMAC of a different string than
     * the one a dashboard lookup or an erasure request hashes: a long
     * reference (a signed customer id, a namespaced email) would file
     * recordings under a key nothing can ever resolve, and a
     * right-to-erasure request naming that person would under-delete without
     * erroring.
     */
    const identifiedUserRef: string = this.readString(
      raw["identifiedUserRef"],
      SESSION_REPLAY_MAX_USER_REF_LENGTH,
    );

    if (identifiedUserRef) {
      meta.identifiedUserRef = identifiedUserRef;
    }

    return meta;
  }

  private static readStringArray(
    value: unknown,
    maxEntries: number,
    maxEntryLength: number,
  ): Array<string> {
    if (!Array.isArray(value)) {
      return [];
    }

    const result: Array<string> = [];

    for (const entry of value) {
      if (result.length >= maxEntries) {
        break;
      }

      const asString: string = this.readString(entry, maxEntryLength);

      if (asString) {
        result.push(asString);
      }
    }

    return result;
  }
}
