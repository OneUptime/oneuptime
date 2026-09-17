import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import SessionReplayTriggerReason from "Common/Types/Rum/SessionReplayTriggerReason";
import {
  SESSION_REPLAY_FLUSH_BYTES,
  SESSION_REPLAY_SCHEMA_VERSION,
  SESSION_REPLAY_WIRE_VERSION,
  SessionReplayChunkEnvelope,
} from "Common/Types/Rum/SessionReplay";
import zlib from "zlib";

/*
 * THE END-TO-END REGRESSION FOR github.com/OneUptime/oneuptime/issues/3527.
 *
 * This file exists because the bug it pins was invisible from either side.
 *
 * The recorder's chunker used to cut an oversized indivisible FullSnapshot
 * into raw slices of the array text, one chunk index per slice, tagged
 * snapshotPart {index, total}, "and the receiving side must concatenate the
 * parts by chunkIndex before parsing". The ingest worker never learned to.
 * decodePayload JSON.parses every frame on its own, so every slice threw and
 * was dropped - and because the recorder had already minted a chunk index for
 * each one, those indexes were missing from the session forever.
 *
 * Both sides had thorough unit tests. The recorder's proved the slices
 * rejoined into the original JSON; the worker's proved a well-formed frame
 * decoded. Nothing anywhere ran the REAL chunker's output through the REAL
 * worker, which is the only place the contract lived - so on any page whose
 * DOM serialises to more than SESSION_REPLAY_FLUSH_BYTES (a Dynamics portal,
 * a large admin console, any enterprise app) the snapshot was destroyed on
 * every single page load, the dashboard reported "N chunks missing" and drew
 * gaps on the scrubber, and playback had no anchor to rebuild the DOM from.
 *
 * So this test crosses the boundary on purpose: it drives the actual Chunker,
 * puts each chunk it emits on the wire the way Transport does, and hands the
 * result to the actual processFromQueue.
 */

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn(),
  };
});

jest.mock("Common/Server/Utils/Telemetry/CaptureSpan", () => {
  return {
    __esModule: true,
    default: () => {
      return (): void => {
        /* The real decorator needs a live tracer provider. */
      };
    },
  };
});

jest.mock("Common/Server/Utils/Telemetry/AppMetrics", () => {
  const counter: { add: unknown } = { add: jest.fn() };
  const histogram: { record: unknown } = { record: jest.fn() };

  return {
    __esModule: true,
    default: {
      getIngestCounter: () => {
        return counter;
      },
      getIngestDuration: () => {
        return histogram;
      },
      getIngestPayloadBytes: () => {
        return histogram;
      },
    },
  };
});

jest.mock("../../FeatureSet/Telemetry/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../FeatureSet/Telemetry/Config",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    SESSION_REPLAY_INGEST_ENABLED: true,
    SESSION_REPLAY_ENABLED_BY_DEFAULT: true,
  };
});

jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: (): unknown => {
        return { zadd: jest.fn(), expire: jest.fn() };
      },
      isConnected: (): boolean => {
        return true;
      },
    },
  };
});

jest.mock("Common/Server/Services/RumSessionService", () => {
  return {
    __esModule: true,
    default: { model: { tableName: "RumSessionV1" } },
  };
});

jest.mock("Common/Server/Services/RumSessionChunkService", () => {
  return {
    __esModule: true,
    default: { model: { tableName: "RumSessionChunkV1" } },
  };
});

jest.mock("Common/Server/Utils/SessionReplay/SessionReplayGateCache", () => {
  return {
    __esModule: true,
    default: {
      getPolicy: jest.fn(),
      isOriginAllowed: jest.fn().mockReturnValue(true),
      markProjectDisabled: jest.fn(),
      clearCache: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Telemetry/TelemetryFanInWriter", () => {
  return {
    __esModule: true,
    default: { submit: jest.fn() },
    pushObservedAck: (
      pendingAcks: Array<Promise<void>>,
      flushed: Promise<void>,
    ): void => {
      pendingAcks.push(flushed);
    },
  };
});

jest.mock(
  "../../FeatureSet/Telemetry/Services/SessionReplayScrubService",
  () => {
    return {
      __esModule: true,
      default: { loadRules: jest.fn(), scrubEvents: jest.fn() },
    };
  },
);

jest.mock("../../FeatureSet/Telemetry/Utils/SessionReplayChunkStore", () => {
  return {
    __esModule: true,
    default: {
      storeBody: jest.fn(),
      readBody: jest.fn(),
      deleteBody: jest.fn(),
    },
  };
});

jest.mock("../../FeatureSet/Telemetry/Utils/SessionReplayRateLimiter", () => {
  return {
    __esModule: true,
    default: {
      consumeChunkAllowance: jest.fn(),
      consumeByteBudget: jest.fn(),
      consumeApplicationMonthlyBudget: jest.fn(),
      getBytesUsedToday: jest.fn(),
    },
    SessionReplayLimitOutcome: {
      Allowed: "allowed",
      RateLimited: "rate-limited",
      BudgetExhausted: "budget-exhausted",
      CounterUnavailable: "counter-unavailable",
    },
  };
});

jest.mock(
  "Common/Server/Utils/SessionReplay/SessionReplayErasureTombstone",
  () => {
    class FakeErasureTombstoneUnavailableError extends Error {}

    return {
      __esModule: true,
      isSessionErased: jest.fn(),
      ErasureTombstoneUnavailableError: FakeErasureTombstoneUnavailableError,
    };
  },
);

import { isSessionErased } from "Common/Server/Utils/SessionReplay/SessionReplayErasureTombstone";
import SessionReplayGateCache, {
  SessionReplayGatePolicy,
} from "Common/Server/Utils/SessionReplay/SessionReplayGateCache";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import SessionReplayScrubService from "../../FeatureSet/Telemetry/Services/SessionReplayScrubService";
import SessionReplayIngestService from "../../FeatureSet/Telemetry/Services/SessionReplayIngestService";
import { SessionReplayIngestJobData } from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";

/* The REAL recorder chunker, not a stand-in for it. */
import Chunker, {
  PendingChunk,
} from "../../FeatureSet/BrowserRecorder/src/Chunker";
import { BufferedEvent } from "../../FeatureSet/BrowserRecorder/src/RollingBuffer";

type MockedFn = ReturnType<typeof jest.fn>;

const getPolicyMock: MockedFn =
  SessionReplayGateCache.getPolicy as unknown as MockedFn;
const submitMock: MockedFn = TelemetryFanInWriter.submit as unknown as MockedFn;
const loadRulesMock: MockedFn =
  SessionReplayScrubService.loadRules as unknown as MockedFn;
const scrubEventsMock: MockedFn =
  SessionReplayScrubService.scrubEvents as unknown as MockedFn;

const PROJECT_ID: ObjectID = ObjectID.generate();
const RUM_APPLICATION_ID: ObjectID = ObjectID.generate();
const APP_IDENTIFIER: string = "dynamics-portal";
const SESSION_ID: string = "a".repeat(32);
const TAB_ID: string = "b".repeat(32);
const SESSION_START: number = 1_800_000_000_000;

function buildPolicy(): SessionReplayGatePolicy {
  return {
    projectId: PROJECT_ID,
    rumApplicationId: RUM_APPLICATION_ID,
    isProjectAllowed: true,
    isAppEnabled: true,
    allowedOrigins: [],
    maskingMode: SessionReplayMaskingMode.MaskSensitiveInputsOnly,
    consentMode: SessionReplayConsentMode.NotRequired,
    captureTrigger: SessionReplayCaptureTrigger.OnErrorOrFrustration,
    samplePercentage: 0,
    maskSelectors: [],
    blockSelectors: [],
    recordCanvas: false,
    captureUserIdentity: false,
    captureGeo: true,
    retentionInDays: 7,
    monthlyBudgetInGB: null,
    ignoreErrorPatterns: [],
    tracePropagationOrigins: [],
    lcpBudgetMs: 0,
    longTaskBudgetMs: 0,
    slowRequestBudgetMs: 0,
    configEpoch: 1,
  };
}

/*
 * A serialised rrweb FullSnapshot of the given size. The shape is what
 * matters, not the content: ONE event, bigger than the flush threshold, that
 * cannot be cut in half and still parse.
 */
function buildFullSnapshotEvent(bytes: number): BufferedEvent {
  const prefix: string = '{"type":2,"timestamp":1,"data":{"node":"';
  const suffix: string = '"}}';
  const json: string = `${prefix}${"n".repeat(
    Math.max(0, bytes - prefix.length - suffix.length),
  )}${suffix}`;

  return {
    json: json,
    bytes: Buffer.byteLength(json, "utf-8"),
    timestampMs: SESSION_START + 500,
    isCheckout: true,
    type: 2,
  };
}

function buildIncrementalEvent(index: number): BufferedEvent {
  const json: string = `{"type":3,"timestamp":${
    SESSION_START + 1000 + index
  },"data":{"source":2,"id":${index}}}`;

  return {
    json: json,
    bytes: Buffer.byteLength(json, "utf-8"),
    timestampMs: SESSION_START + 1000 + index,
    isCheckout: false,
    type: 3,
  };
}

/*
 * Everything the recorder does to a chunk between the chunker's sink and the
 * server: mint the next index, build the envelope, gzip the payload, and lay
 * the two out as `envelope JSON`, newline, payload bytes.
 *
 * One frame per body, because that is what Transport.post does - which is
 * exactly why a fragmented snapshot could never be reassembled by a worker
 * that only ever sees one job at a time.
 */
function putOnTheWire(chunks: Array<PendingChunk>): Array<Buffer> {
  return chunks.map((chunk: PendingChunk, chunkIndex: number): Buffer => {
    const payload: Buffer = zlib.gzipSync(
      new Uint8Array(Buffer.from(chunk.payload, "utf-8")),
    );

    const envelope: SessionReplayChunkEnvelope = {
      v: SESSION_REPLAY_WIRE_VERSION,
      appIdentifier: APP_IDENTIFIER,
      sessionId: SESSION_ID,
      tabId: TAB_ID,
      chunkIndex: chunkIndex,
      sessionStartUnixMs: SESSION_START,
      clientSendUnixMs: SESSION_START + 20_000,
      chunkStartOffsetMs: chunk.chunkStartOffsetMs,
      chunkEndOffsetMs: chunk.chunkEndOffsetMs,
      eventCount: chunk.eventCount,
      hasFullSnapshot: chunk.hasFullSnapshot,
      isFinal: chunk.isFinal,
      recorderKind: "dom",
      schemaVersion: SESSION_REPLAY_SCHEMA_VERSION,
      rrwebVersion: "2.1.1",
      recorderVersion: "12.0.30",
      maskingMode: SessionReplayMaskingMode.MaskSensitiveInputsOnly,
      consentState: "NotRequired",
      triggerReason: SessionReplayTriggerReason.Frustration,
      payloadEncoding: "gzip",
      payloadBytes: payload.length,
      url: "https://portal.example.com/Account/Login",
      routes: chunk.routes,
      signals: chunk.signals,
      fidelityNotices: chunk.fidelityNotices,
      droppedEvents: 0,
      flushFailures: 0,
    };

    return Buffer.concat([
      new Uint8Array(Buffer.from(`${JSON.stringify(envelope)}\n`)),
      new Uint8Array(payload),
    ]);
  });
}

function buildJobData(body: Buffer): SessionReplayIngestJobData {
  return {
    projectId: PROJECT_ID.toString(),
    appIdentifier: APP_IDENTIFIER,
    inlineBodyBase64: body.toString("base64"),
    serverReceiveUnixMs: SESSION_START + 25_000,
    samplePercentageAtCapture: 0,
    countryCode: "GB",
  };
}

function getStoredChunkRows(): Array<JSONObject> {
  const rows: Array<JSONObject> = [];

  for (const call of submitMock.mock.calls) {
    const target: { model: { tableName: string } } = call[0] as {
      model: { tableName: string };
    };

    if (target.model.tableName === "RumSessionChunkV1") {
      rows.push(...(call[1] as Array<JSONObject>));
    }
  }

  return rows;
}

/* Drive the real chunker over one page load's worth of events. */
function recordPageLoad(snapshotBytes: number): Array<PendingChunk> {
  const chunks: Array<PendingChunk> = [];

  const chunker: Chunker = new Chunker({
    sessionStartUnixMs: SESSION_START,
    sink: (chunk: PendingChunk): void => {
      chunks.push(chunk);
    },
  });

  chunker.addRoute("https://portal.example.com/Account/Login");

  /*
   * rrweb's opening Meta, then the FullSnapshot, then a few mutations - the
   * order every real page load produces.
   */
  chunker.add({
    json: '{"type":4,"timestamp":1,"data":{"href":"https://portal.example.com/","width":1440,"height":900}}',
    bytes: 97,
    timestampMs: SESSION_START + 400,
    isCheckout: true,
    type: 4,
  });

  chunker.add(buildFullSnapshotEvent(snapshotBytes));

  for (let index: number = 0; index < 5; index++) {
    chunker.add(buildIncrementalEvent(index));
  }

  /* The page-hide flush that seals the recording. */
  chunker.close(true);

  return chunks;
}

async function ingestAll(bodies: Array<Buffer>): Promise<void> {
  for (const body of bodies) {
    await SessionReplayIngestService.processFromQueue(buildJobData(body));
  }
}

describe("an oversized full snapshot survives the round trip (issue #3527)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getPolicyMock.mockResolvedValue(buildPolicy() as never);
    loadRulesMock.mockResolvedValue([] as never);
    scrubEventsMock.mockResolvedValue({
      isComplete: true,
      nodesVisited: 1,
      stringsScrubbed: 0,
      skippedOversizedStrings: 0,
      truncatedAtDepth: false,
    } as never);
    submitMock.mockResolvedValue({ flushed: Promise.resolve() } as never);
    (isSessionErased as jest.Mock).mockResolvedValue(false as never);
  });

  /*
   * 4x the flush threshold. Under the old slicing this became four fragments,
   * every one of them undecodable, and four permanently missing chunk indexes.
   */
  const OVERSIZED_SNAPSHOT_BYTES: number = SESSION_REPLAY_FLUSH_BYTES * 4;

  test("every chunk the recorder emits is stored - none is dropped at decode", async () => {
    const chunks: Array<PendingChunk> = recordPageLoad(
      OVERSIZED_SNAPSHOT_BYTES,
    );

    await ingestAll(putOnTheWire(chunks));

    expect(getStoredChunkRows()).toHaveLength(chunks.length);
  });

  /*
   * The property the dashboard actually reports on. FinalizeSessions computes
   * missingChunkCount as the set difference between the indexes it stored and
   * 0..max, and the player draws a gap wherever the sequence skips - so a
   * contiguous run here IS "0 chunks missing, no gaps" on the session list.
   */
  test("the stored chunk indexes are contiguous from zero", async () => {
    const chunks: Array<PendingChunk> = recordPageLoad(
      OVERSIZED_SNAPSHOT_BYTES,
    );

    await ingestAll(putOnTheWire(chunks));

    const storedIndexes: Array<number> = getStoredChunkRows()
      .map((row: JSONObject): number => {
        return row["chunkIndex"] as number;
      })
      .sort((a: number, b: number): number => {
        return a - b;
      });

    expect(storedIndexes).toEqual(
      chunks.map((_chunk: PendingChunk, index: number): number => {
        return index;
      }),
    );
  });

  /*
   * Storing the chunks is not enough: the snapshot has to survive INTACT,
   * because it is the only thing the player can rebuild the DOM from. The old
   * slicing lost it whole; a subtly wrong reassembly would lose it silently,
   * which is worse.
   */
  test("the snapshot is stored whole, in one chunk, byte for byte", async () => {
    const chunks: Array<PendingChunk> = recordPageLoad(
      OVERSIZED_SNAPSHOT_BYTES,
    );

    await ingestAll(putOnTheWire(chunks));

    const snapshotRows: Array<JSONObject> = getStoredChunkRows().filter(
      (row: JSONObject): boolean => {
        return row["hasFullSnapshot"] === true;
      },
    );

    expect(snapshotRows).toHaveLength(1);

    const events: Array<JSONObject> = JSON.parse(
      snapshotRows[0]?.["payload"] as string,
    ) as Array<JSONObject>;

    expect(events).toHaveLength(1);
    expect(events[0]?.["type"]).toBe(2);
    expect(
      ((events[0]?.["data"] as JSONObject)?.["node"] as string).length,
    ).toBeGreaterThan(SESSION_REPLAY_FLUSH_BYTES);
  });

  /*
   * The seek anchor. Playback restarts from a full-snapshot chunk, so a
   * recording whose only snapshot chunk was dropped cannot be played from any
   * position at all - which is what "the recording does not behave as
   * expected" meant on the report.
   */
  test("the recording keeps a seek anchor", async () => {
    const chunks: Array<PendingChunk> = recordPageLoad(
      OVERSIZED_SNAPSHOT_BYTES,
    );

    await ingestAll(putOnTheWire(chunks));

    expect(
      getStoredChunkRows().some((row: JSONObject): boolean => {
        return row["hasFullSnapshot"] === true;
      }),
    ).toBe(true);
  });

  /*
   * The same page recorded four times, which is exactly what refresh rage -
   * the frustration signal that TRIGGERS the upload in the first place -
   * produces. Each page load mints a fresh tab id and its own chunk sequence,
   * so the bug multiplied by the number of reloads: the report showed four
   * tabs, four gaps and eight missing chunks.
   */
  test("a reload storm loses nothing on any of its page loads", async () => {
    let expectedChunks: number = 0;

    for (let pageLoad: number = 0; pageLoad < 4; pageLoad++) {
      const chunks: Array<PendingChunk> = recordPageLoad(
        OVERSIZED_SNAPSHOT_BYTES,
      );

      expectedChunks += chunks.length;

      await ingestAll(putOnTheWire(chunks));
    }

    expect(getStoredChunkRows()).toHaveLength(expectedChunks);
  });

  /*
   * A page small enough to fit the flush threshold never went near the split
   * path, which is why the bug looked like "session replay is broken for SOME
   * customers". Pinned so the fix cannot regress the case that always worked.
   */
  test("an ordinary page is unaffected", async () => {
    const chunks: Array<PendingChunk> = recordPageLoad(1024);

    await ingestAll(putOnTheWire(chunks));

    expect(getStoredChunkRows()).toHaveLength(chunks.length);
    expect(
      getStoredChunkRows().some((row: JSONObject): boolean => {
        return row["hasFullSnapshot"] === true;
      }),
    ).toBe(true);
  });
});
