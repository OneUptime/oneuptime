import { describe, expect, it } from "@jest/globals";
import {
  MAX_SESSION_REPLAY_CHUNKS_PER_READ,
  SessionReplayChunkManifestEntry,
} from "../../../Types/Rum/SessionReplay";
import { MAX_PREFETCH_PAGES_AHEAD } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayPlaybackIntent";
import ChunkLoader, {
  ChunkLoadError,
  DEFAULT_MAX_DECODED_CHUNKS,
  RRWEB_EVENT_TYPE_META,
  RRWEB_MOUSE_INTERACTION_CLICK,
  RRWEB_MOUSE_INTERACTION_TOUCH_START,
  RRWEB_SOURCE_MOUSE_INTERACTION,
  RRWEB_SOURCE_MOUSE_MOVE,
  RRWEB_SOURCE_SCROLL,
  SessionReplayRecordedEvent,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ChunkLoader";
import {
  REPLAY_TIMELINE_EXTRACTION_CAPS,
  ReplayTimelineEvent,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTimelineTypes";

/*
 * ChunkLoader lives in the Dashboard but is tested from Common, because it is
 * plain dependency-free TypeScript and its failure mode is not a crash: feed
 * rrweb events across a hole in the chunk sequence and it renders a plausible
 * DOM the end user never saw. That has to be pinned by tests that need no
 * browser, no React and no rrweb.
 */

const CHUNK_MS: number = 15000;

function makeEntry(
  chunkIndex: number,
  options?: {
    hasFullSnapshot?: boolean;
    payloadBytes?: number;
  },
): SessionReplayChunkManifestEntry {
  return {
    chunkIndex: chunkIndex,
    tabId: "tab-1",
    chunkStartOffsetMs: chunkIndex * CHUNK_MS,
    chunkEndOffsetMs: (chunkIndex + 1) * CHUNK_MS,
    eventCount: 10,
    hasFullSnapshot: options?.hasFullSnapshot ?? false,
    payloadBytes: options?.payloadBytes ?? 4096,
    errorCount: 0,
    rageClickCount: 0,
    deadClickCount: 0,
    errorClickCount: 0,
    refreshRageCount: 0,
    routeCount: 0,
  };
}

/*
 * Builds the wire format the /chunks endpoint returns:
 * repeated [u32 chunkIndex][u32 length][UTF-8 JSON payload], big-endian.
 */
function encodeFrames(
  frames: Array<{ chunkIndex: number; body: string }>,
): ArrayBuffer {
  const encoder: TextEncoder = new TextEncoder();
  const encoded: Array<{ chunkIndex: number; bytes: Uint8Array }> = frames.map(
    (frame: {
      chunkIndex: number;
      body: string;
    }): {
      chunkIndex: number;
      bytes: Uint8Array;
    } => {
      return {
        chunkIndex: frame.chunkIndex,
        bytes: encoder.encode(frame.body),
      };
    },
  );

  const totalBytes: number = encoded.reduce(
    (
      total: number,
      frame: { chunkIndex: number; bytes: Uint8Array },
    ): number => {
      return total + 8 + frame.bytes.length;
    },
    0,
  );

  const buffer: ArrayBuffer = new ArrayBuffer(totalBytes);
  const view: DataView = new DataView(buffer);
  const bytes: Uint8Array = new Uint8Array(buffer);

  let offset: number = 0;

  for (const frame of encoded) {
    /*
     * LITTLE-endian, byte for byte what the /chunks route emits with
     * Buffer.writeUInt32LE. If this helper and the decoder ever agree on the
     * wrong endianness together the tests pass and the product decodes an
     * empty recording, so the constant to check against is the server, not
     * this file: Common/Server/API/TelemetryAPI.ts.
     */
    view.setUint32(offset, frame.chunkIndex, true);
    view.setUint32(offset + 4, frame.bytes.length, true);
    bytes.set(frame.bytes, offset + 8);
    offset += 8 + frame.bytes.length;
  }

  return buffer;
}

function eventsFor(chunkIndex: number): Array<SessionReplayRecordedEvent> {
  return [
    {
      type: chunkIndex === 0 ? 2 : 3,
      timestamp: 1700000000000 + chunkIndex * CHUNK_MS,
      data: { chunkIndex: chunkIndex },
    },
  ];
}

function bodyFor(chunkIndex: number): string {
  return JSON.stringify(eventsFor(chunkIndex));
}

interface RecordingFetcher {
  requests: Array<Array<number>>;
  fetcher: (request: {
    sessionId: string;
    tabId: string;
    chunkIndexes: Array<number>;
  }) => Promise<ArrayBuffer>;
}

function makeFetcher(options?: {
  payloadFor?: (i: number) => string;
}): RecordingFetcher {
  const requests: Array<Array<number>> = [];

  return {
    requests: requests,
    fetcher: (request: {
      sessionId: string;
      tabId: string;
      chunkIndexes: Array<number>;
    }): Promise<ArrayBuffer> => {
      requests.push([...request.chunkIndexes]);

      return Promise.resolve(
        encodeFrames(
          request.chunkIndexes.map(
            (chunkIndex: number): { chunkIndex: number; body: string } => {
              return {
                chunkIndex: chunkIndex,
                body: options?.payloadFor
                  ? options.payloadFor(chunkIndex)
                  : bodyFor(chunkIndex),
              };
            },
          ),
        ),
      );
    },
  };
}

function makeLoader(
  entries: Array<SessionReplayChunkManifestEntry>,
  fetcher: RecordingFetcher,
  overrides?: { maxDecodedChunks?: number; maxDecodedBytes?: number },
): ChunkLoader {
  return new ChunkLoader({
    sessionId: "sess-1",
    tabId: "tab-1",
    entries: entries,
    fetcher: fetcher.fetcher,
    maxDecodedChunks: overrides?.maxDecodedChunks,
    maxDecodedBytes: overrides?.maxDecodedBytes,
  });
}

describe("ChunkLoader frame decoding", () => {
  it("decodes concatenated frames in wire order", () => {
    const buffer: ArrayBuffer = encodeFrames([
      { chunkIndex: 3, body: bodyFor(3) },
      { chunkIndex: 4, body: bodyFor(4) },
    ]);

    const frames: Array<{
      chunkIndex: number;
      events: Array<SessionReplayRecordedEvent>;
    }> = ChunkLoader.decodeFrames(buffer);

    expect(frames.length).toBe(2);
    expect(frames[0]!.chunkIndex).toBe(3);
    expect(frames[1]!.chunkIndex).toBe(4);
    expect(frames[0]!.events[0]!.data).toEqual({ chunkIndex: 3 });
  });

  it("keeps the frames it already decoded when the response is truncated", () => {
    const full: ArrayBuffer = encodeFrames([
      { chunkIndex: 0, body: bodyFor(0) },
      { chunkIndex: 1, body: bodyFor(1) },
    ]);

    // Lop off the tail so the second frame's declared length overruns.
    const truncated: ArrayBuffer = full.slice(0, full.byteLength - 5);

    const frames: Array<{ chunkIndex: number }> =
      ChunkLoader.decodeFrames(truncated);

    expect(frames.length).toBe(1);
    expect(frames[0]!.chunkIndex).toBe(0);
  });

  it("skips a corrupt frame rather than losing the whole response", () => {
    const buffer: ArrayBuffer = encodeFrames([
      { chunkIndex: 0, body: "{not json" },
      { chunkIndex: 1, body: bodyFor(1) },
    ]);

    const frames: Array<{ chunkIndex: number }> =
      ChunkLoader.decodeFrames(buffer);

    expect(frames.length).toBe(1);
    expect(frames[0]!.chunkIndex).toBe(1);
  });

  it("rejects a payload that is not an event array", () => {
    const buffer: ArrayBuffer = encodeFrames([
      { chunkIndex: 0, body: JSON.stringify({ events: [] }) },
    ]);

    expect(ChunkLoader.decodeFrames(buffer).length).toBe(0);
  });

  it("reads the frame header little-endian, the way the server writes it", () => {
    /*
     * Hand-built against Buffer.writeUInt32LE rather than against the helper
     * above, so this fails if the decoder is flipped even when the helper is
     * flipped with it. Reading these bytes big-endian yields chunkIndex
     * 117440512 and a length of 33554432, which overruns and decodes nothing.
     */
    const payload: Uint8Array = new TextEncoder().encode("[]");
    const buffer: ArrayBuffer = new ArrayBuffer(8 + payload.length);
    const bytes: Uint8Array = new Uint8Array(buffer);

    // chunkIndex = 7 as u32 LE.
    bytes[0] = 7;
    // length = 2 as u32 LE.
    bytes[4] = payload.length;
    bytes.set(payload, 8);

    const frames: Array<{ chunkIndex: number }> =
      ChunkLoader.decodeFrames(buffer);

    expect(frames.length).toBe(1);
    expect(frames[0]!.chunkIndex).toBe(7);
  });
});

describe("ChunkLoader seek anchors", () => {
  it("reports the first playable chunk as the first full snapshot, not chunk zero", () => {
    /*
     * A full snapshot split across parts sets hasFullSnapshot only on its
     * final part, so chunk 0 is routinely not a valid anchor.
     */
    const loader: ChunkLoader = makeLoader(
      [
        makeEntry(0),
        makeEntry(1, { hasFullSnapshot: true }),
        makeEntry(2),
        makeEntry(3),
      ],
      makeFetcher(),
    );

    expect(loader.getFirstPlayableChunkIndex()).toBe(1);
  });

  it("seeks to the greatest anchor at or before the target", () => {
    const loader: ChunkLoader = makeLoader(
      [
        makeEntry(0, { hasFullSnapshot: true }),
        makeEntry(1),
        makeEntry(2),
        makeEntry(3),
        makeEntry(4, { hasFullSnapshot: true }),
        makeEntry(5),
      ],
      makeFetcher(),
    );

    expect(loader.getSeekAnchor(5)).toBe(4);
    expect(loader.getSeekAnchor(4)).toBe(4);
    expect(loader.getSeekAnchor(3)).toBe(0);
  });

  it("refuses to seek when no anchor exists before the target", () => {
    /*
     * Returning 0 here would be the dangerous answer: playback would start
     * somewhere the viewer never asked for while looking entirely normal.
     */
    const loader: ChunkLoader = makeLoader(
      [makeEntry(0), makeEntry(1), makeEntry(2, { hasFullSnapshot: true })],
      makeFetcher(),
    );

    expect(loader.getSeekAnchor(1)).toBeNull();
  });

  it("maps offsets to the chunk covering them", () => {
    const loader: ChunkLoader = makeLoader(
      [makeEntry(0, { hasFullSnapshot: true }), makeEntry(1), makeEntry(2)],
      makeFetcher(),
    );

    expect(loader.getChunkIndexForOffset(0)).toBe(0);
    expect(loader.getChunkIndexForOffset(CHUNK_MS + 1)).toBe(1);
    expect(loader.getChunkIndexForOffset(3 * CHUNK_MS)).toBe(2);
    // Before the recording starts, clamp to the first chunk.
    expect(loader.getChunkIndexForOffset(-5000)).toBe(0);
  });
});

describe("ChunkLoader gap handling", () => {
  it("advances to the contiguous next chunk with no gap", () => {
    const loader: ChunkLoader = makeLoader(
      [makeEntry(0, { hasFullSnapshot: true }), makeEntry(1)],
      makeFetcher(),
    );

    expect(loader.getNextChunk(0)).toEqual({
      chunkIndex: 1,
      skippedGap: null,
    });
  });

  it("jumps a hole to the next FULL SNAPSHOT, never to the next present chunk", () => {
    /*
     * Chunk 3 is present but is not a snapshot. Feeding it after the hole at
     * chunk 1-2 would resolve mutations against node ids that were never
     * established. The only safe landing point is chunk 5.
     */
    const loader: ChunkLoader = makeLoader(
      [
        makeEntry(0, { hasFullSnapshot: true }),
        makeEntry(3),
        makeEntry(4),
        makeEntry(5, { hasFullSnapshot: true }),
      ],
      makeFetcher(),
    );

    const decision: { chunkIndex: number; skippedGap: unknown } | null =
      loader.getNextChunk(0);

    expect(decision).not.toBeNull();
    expect(decision!.chunkIndex).toBe(5);
    expect(decision!.skippedGap).toEqual({
      fromIndex: 0,
      toIndex: 5,
      missingMs: 5 * CHUNK_MS - CHUNK_MS,
    });
  });

  it("returns null when nothing after the hole can anchor playback", () => {
    const loader: ChunkLoader = makeLoader(
      [makeEntry(0, { hasFullSnapshot: true }), makeEntry(4), makeEntry(5)],
      makeFetcher(),
    );

    expect(loader.getNextChunk(0)).toBeNull();
  });

  it("reports every hole in the sequence with the wall-clock time lost", () => {
    const loader: ChunkLoader = makeLoader(
      [
        makeEntry(0, { hasFullSnapshot: true }),
        makeEntry(1),
        makeEntry(4, { hasFullSnapshot: true }),
      ],
      makeFetcher(),
    );

    expect(loader.getGaps()).toEqual([
      { fromIndex: 1, toIndex: 4, missingMs: 2 * CHUNK_MS },
    ]);
  });

  it("separates wall-clock duration from footage that actually exists", () => {
    const loader: ChunkLoader = makeLoader(
      [
        makeEntry(0, { hasFullSnapshot: true }),
        makeEntry(1),
        makeEntry(4, { hasFullSnapshot: true }),
      ],
      makeFetcher(),
    );

    expect(loader.getDurationMs()).toBe(5 * CHUNK_MS);
    expect(loader.getCoveredDurationMs()).toBe(3 * CHUNK_MS);
  });
});

describe("ChunkLoader paging and caching", () => {
  it("fetches a page and decodes every chunk in it", async () => {
    const fetcher: RecordingFetcher = makeFetcher();
    const loader: ChunkLoader = makeLoader(
      [
        makeEntry(0, { hasFullSnapshot: true }),
        makeEntry(1),
        makeEntry(2),
        makeEntry(3),
      ],
      fetcher,
    );

    const loaded: Array<number> = await loader.loadPage(0);

    expect(loaded).toEqual([0, 1, 2, 3]);
    expect(fetcher.requests).toEqual([[0, 1, 2, 3]]);
    expect(loader.getDecodedChunkIndexes()).toEqual([0, 1, 2, 3]);
  });

  it("caps a page on total bytes, not just count", async () => {
    const fetcher: RecordingFetcher = makeFetcher();
    const loader: ChunkLoader = makeLoader(
      [
        makeEntry(0, { hasFullSnapshot: true, payloadBytes: 5 * 1024 * 1024 }),
        makeEntry(1, { payloadBytes: 5 * 1024 * 1024 }),
        makeEntry(2, { payloadBytes: 5 * 1024 * 1024 }),
      ],
      fetcher,
    );

    // 8 MiB read cap: the second 5 MiB chunk does not fit alongside the first.
    expect(loader.planPage(0)).toEqual([0]);

    await loader.loadPage(0);
    expect(fetcher.requests).toEqual([[0]]);
  });

  it("still fetches a single chunk that alone exceeds the byte cap", () => {
    const loader: ChunkLoader = makeLoader(
      [makeEntry(0, { hasFullSnapshot: true, payloadBytes: 40 * 1024 * 1024 })],
      makeFetcher(),
    );

    // A zero-length page would deadlock the player on an oversized snapshot.
    expect(loader.planPage(0)).toEqual([0]);
  });

  it("reports only what actually decoded when the response is short", async () => {
    /*
     * The server can legitimately return fewer frames than were asked for: a
     * TTL drop between manifest and read, the 8 MB clamp, a truncated body,
     * or a corrupt frame decodeFrames skips. Reporting the PLANNED indexes
     * would make a partial response indistinguishable from a complete one,
     * and the player would then feed chunk N+1 into a Replayer that never
     * received N.
     */
    const requests: Array<Array<number>> = [];
    const shortFetcher: RecordingFetcher = {
      requests: requests,
      fetcher: (request: {
        sessionId: string;
        tabId: string;
        chunkIndexes: Array<number>;
      }): Promise<ArrayBuffer> => {
        requests.push([...request.chunkIndexes]);

        return Promise.resolve(
          encodeFrames(
            request.chunkIndexes
              .filter((chunkIndex: number): boolean => {
                return chunkIndex !== 2;
              })
              .map(
                (
                  chunkIndex: number,
                ): {
                  chunkIndex: number;
                  body: string;
                } => {
                  return { chunkIndex: chunkIndex, body: bodyFor(chunkIndex) };
                },
              ),
          ),
        );
      },
    };

    const loader: ChunkLoader = makeLoader(
      [
        makeEntry(0, { hasFullSnapshot: true }),
        makeEntry(1),
        makeEntry(2),
        makeEntry(3),
      ],
      shortFetcher,
    );

    const loaded: Array<number> = await loader.loadPage(0);

    expect(loaded).toEqual([0, 1, 3]);
    expect(loader.isChunkDecoded(2)).toBe(false);
    expect(await loader.ensureChunk(2)).toBeNull();
  });

  it("does not refetch chunks it already holds", async () => {
    const fetcher: RecordingFetcher = makeFetcher();
    const loader: ChunkLoader = makeLoader(
      [makeEntry(0, { hasFullSnapshot: true }), makeEntry(1)],
      fetcher,
    );

    await loader.loadPage(0);
    await loader.loadPage(0);

    expect(fetcher.requests.length).toBe(1);
  });

  it("collapses concurrent requests for the same page into one fetch", async () => {
    const fetcher: RecordingFetcher = makeFetcher();
    const loader: ChunkLoader = makeLoader(
      [makeEntry(0, { hasFullSnapshot: true }), makeEntry(1)],
      fetcher,
    );

    await Promise.all([loader.loadPage(0), loader.loadPage(0)]);

    expect(fetcher.requests.length).toBe(1);
  });

  it("evicts least-recently-used chunks once over the count budget", async () => {
    const entries: Array<SessionReplayChunkManifestEntry> = [];

    for (let i: number = 0; i < 6; i++) {
      entries.push(makeEntry(i, { hasFullSnapshot: i === 0 }));
    }

    const loader: ChunkLoader = makeLoader(entries, makeFetcher(), {
      maxDecodedChunks: 3,
    });

    await loader.loadPage(0);

    /*
     * A 30-minute session is ~120 chunks; holding them all parsed is hundreds
     * of megabytes of heap in a tab that also runs the whole Dashboard.
     */
    expect(loader.getDecodedChunkIndexes()).toEqual([3, 4, 5]);
  });

  it("touching a chunk protects it from the next eviction", async () => {
    const entries: Array<SessionReplayChunkManifestEntry> = [
      makeEntry(0, { hasFullSnapshot: true }),
      makeEntry(1),
      makeEntry(2),
      makeEntry(3),
    ];

    const loader: ChunkLoader = makeLoader(entries, makeFetcher(), {
      maxDecodedChunks: 3,
    });

    await loader.loadPage(0);
    expect(loader.getDecodedChunkIndexes()).toEqual([1, 2, 3]);

    // Re-reading 1 makes it most recent, so 2 goes when 0 is pulled back in.
    loader.getDecodedChunk(1);
    await loader.ensureChunk(0);

    expect(loader.getDecodedChunkIndexes()).toContain(1);
    expect(loader.getDecodedChunkIndexes()).not.toContain(2);
  });

  it("evicts everything outside a window on seek", async () => {
    const entries: Array<SessionReplayChunkManifestEntry> = [];

    for (let i: number = 0; i < 8; i++) {
      entries.push(makeEntry(i, { hasFullSnapshot: i === 0 }));
    }

    const loader: ChunkLoader = makeLoader(entries, makeFetcher(), {
      maxDecodedChunks: 32,
    });

    await loader.loadPage(0);
    loader.evictOutsideWindow(6, 1);

    expect(loader.getDecodedChunkIndexes()).toEqual([5, 6, 7]);
  });

  it("tracks decoded bytes and returns them to zero on dispose", async () => {
    const loader: ChunkLoader = makeLoader(
      [makeEntry(0, { hasFullSnapshot: true }), makeEntry(1)],
      makeFetcher(),
    );

    await loader.loadPage(0);
    expect(loader.getDecodedBytes()).toBeGreaterThan(0);

    loader.dispose();

    expect(loader.getDecodedBytes()).toBe(0);
    expect(loader.getDecodedChunkIndexes()).toEqual([]);
  });

  it("drops a response that lands after dispose", async () => {
    let release: (() => void) | null = null;

    const gate: Promise<void> = new Promise<void>((resolve: () => void) => {
      release = resolve;
    });

    const loader: ChunkLoader = new ChunkLoader({
      sessionId: "sess-1",
      tabId: "tab-1",
      entries: [makeEntry(0, { hasFullSnapshot: true })],
      fetcher: async (): Promise<ArrayBuffer> => {
        await gate;
        return encodeFrames([{ chunkIndex: 0, body: bodyFor(0) }]);
      },
    });

    const pending: Promise<Array<number>> = loader.loadPage(0);

    loader.dispose();
    release!();

    await pending;

    // A late response must not repopulate a disposed loader's cache.
    expect(loader.getDecodedChunkIndexes()).toEqual([]);
  });

  it("returns null for a chunk that is not in the manifest at all", async () => {
    const loader: ChunkLoader = makeLoader(
      [makeEntry(0, { hasFullSnapshot: true })],
      makeFetcher(),
    );

    await expect(loader.ensureChunk(9)).resolves.toBeNull();
  });
});

/*
 * Timeline-event extraction: the recorder embeds console/network/route/
 * error records as rrweb type-5 custom events, and the loader lifts them
 * out on admit. These pin that the data the DevTools panel and the exact
 * network lane run on actually gets extracted — it used to be downloaded
 * and discarded.
 */
describe("ChunkLoader timeline events", () => {
  const customEvent: (
    tag: string,
    payload: Record<string, unknown>,
    timestamp: number,
  ) => Record<string, unknown> = (
    tag: string,
    payload: Record<string, unknown>,
    timestamp: number,
  ): Record<string, unknown> => {
    return { type: 5, timestamp: timestamp, data: { tag: tag, payload } };
  };

  const baseTs: number = 1_700_000_000_000;

  const eventfulBody: () => string = (): string => {
    return JSON.stringify([
      { type: 2, timestamp: baseTs, data: {} },
      customEvent(
        "oneuptime.network",
        {
          method: "POST",
          url: "https://api.example.com/orders",
          status: 500,
          durationMs: 220,
          responseBytes: 512,
        },
        baseTs + 2000,
      ),
      customEvent(
        "oneuptime.console",
        { level: "error", message: "order save failed" },
        baseTs + 2500,
      ),
      customEvent(
        "oneuptime.route",
        { from: "/cart", to: "/checkout", kind: "pushState" },
        baseTs + 4000,
      ),
      customEvent("oneuptime.unknown-future-tag", { x: 1 }, baseTs + 4100),
      { type: 5, timestamp: baseTs + 4200, data: { tag: "oneuptime.console" } },
      { type: 3, timestamp: baseTs + 5000, data: {} },
    ]);
  };

  it("extracts the recorder's custom events with exact within-chunk offsets", () => {
    const extracted: Array<{
      kind: string;
      offsetMs: number;
      method?: string;
      status?: number;
      message?: string;
      to?: string;
    }> = ChunkLoader.extractTimelineEvents(
      makeEntry(2),
      JSON.parse(eventfulBody()),
    );

    /* Unknown tags are skipped; a payload-less custom event still lands. */
    expect(extracted).toHaveLength(4);

    /* Chunk 2 starts at 2 * 15s; the network event is 2s into the chunk. */
    expect(extracted[0]!.kind).toBe("network");
    expect(extracted[0]!.offsetMs).toBe(2 * CHUNK_MS + 2000);
    expect(extracted[0]!.method).toBe("POST");
    expect(extracted[0]!.status).toBe(500);

    expect(extracted[1]!.kind).toBe("console");
    expect(extracted[1]!.message).toBe("order save failed");

    expect(extracted[2]!.kind).toBe("route");
    expect(extracted[2]!.to).toBe("/checkout");

    /* The malformed console event degrades to empty fields, not a throw. */
    expect(extracted[3]!.kind).toBe("console");
    expect(extracted[3]!.message).toBe("");
  });

  it("carries a network event's trace id through to the panel row", () => {
    /*
     * The link from "this request failed" to the backend trace of the
     * request. The recorder has always put traceId on the network payload
     * (NetworkRecorder.record), and the extractor used to drop it on the
     * floor, so a player that had already downloaded and decoded the id
     * could not offer the one click that makes the correlation useful.
     */
    const extracted: Array<{ kind: string; traceId?: string }> =
      ChunkLoader.extractTimelineEvents(makeEntry(0), [
        { type: 2, timestamp: baseTs, data: {} },
        customEvent(
          "oneuptime.network",
          {
            method: "GET",
            url: "https://api.example.com/cart",
            status: 500,
            durationMs: 40,
            responseBytes: 0,
            traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
          },
          baseTs + 100,
        ) as never,
      ]);

    expect(extracted[0]!.kind).toBe("network");
    expect(extracted[0]!.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
  });

  it("leaves traceId absent rather than empty when there is none", () => {
    /*
     * Absent, not "" — the panel renders a trace link on the presence of
     * the key, and an empty string would put a dead link on every row of
     * an application with no trace propagation configured. An empty or
     * non-string value on the wire has to reach the same absence as a
     * missing one.
     */
    const rows: Array<{ traceId?: string }> = [
      ChunkLoader.extractTimelineEvents(makeEntry(0), [
        { type: 2, timestamp: baseTs, data: {} },
        customEvent(
          "oneuptime.network",
          { method: "GET", url: "/a", status: 200 },
          baseTs + 1,
        ) as never,
      ])[0]!,
      ChunkLoader.extractTimelineEvents(makeEntry(0), [
        { type: 2, timestamp: baseTs, data: {} },
        customEvent(
          "oneuptime.network",
          { method: "GET", url: "/b", status: 200, traceId: "" },
          baseTs + 1,
        ) as never,
      ])[0]!,
      ChunkLoader.extractTimelineEvents(makeEntry(0), [
        { type: 2, timestamp: baseTs, data: {} },
        customEvent(
          "oneuptime.network",
          { method: "GET", url: "/c", status: 200, traceId: 12345 },
          baseTs + 1,
        ) as never,
      ])[0]!,
    ];

    for (const row of rows) {
      expect(row.traceId).toBeUndefined();
      expect("traceId" in row).toBe(false);
    }
  });

  it("clamps a skewed timestamp inside its chunk's window", () => {
    const extracted: Array<{ offsetMs: number }> =
      ChunkLoader.extractTimelineEvents(makeEntry(1), [
        { type: 2, timestamp: baseTs, data: {} },
        customEvent(
          "oneuptime.console",
          { level: "warn", message: "late" },
          baseTs + 10 * CHUNK_MS,
        ) as never,
      ]);

    expect(extracted[0]!.offsetMs).toBe(2 * CHUNK_MS);
  });

  it("keeps extracted events across eviction and clears them on dispose", async () => {
    const fetcher: RecordingFetcher = makeFetcher({
      payloadFor: (): string => {
        return eventfulBody();
      },
    });

    const loader: ChunkLoader = makeLoader(
      [makeEntry(0, { hasFullSnapshot: true }), makeEntry(1)],
      fetcher,
    );

    await loader.loadPage(0);

    expect(loader.getTimelineEvents().length).toBeGreaterThan(0);
    const countAfterLoad: number = loader.getTimelineEvents().length;

    /* Evicting the decoded payloads must NOT blank the panel's data. */
    loader.evictOutsideWindow(99, 0);
    expect(loader.getDecodedChunkIndexes()).toHaveLength(0);
    expect(loader.getTimelineEvents()).toHaveLength(countAfterLoad);

    loader.dispose();
    expect(loader.getTimelineEvents()).toHaveLength(0);
  });

  it("caps the extracted set and reports the truncation honestly", async () => {
    const noisyBody: string = JSON.stringify([
      { type: 2, timestamp: baseTs, data: {} },
      ...Array.from(
        { length: 2100 },
        (_unused: unknown, index: number): Record<string, unknown> => {
          return customEvent(
            "oneuptime.console",
            { level: "log", message: `spam ${index}` },
            baseTs + index,
          );
        },
      ),
    ]);

    const fetcher: RecordingFetcher = makeFetcher({
      payloadFor: (): string => {
        return noisyBody;
      },
    });

    const loader: ChunkLoader = makeLoader(
      [makeEntry(0, { hasFullSnapshot: true })],
      fetcher,
    );

    await loader.loadPage(0);

    /*
     * Per KIND, not per session: 2100 console lines hit the console cap
     * (1500) and the loader says which kind was cut, so a page that logs in
     * a loop can never push the network or error rows out of the rail.
     */
    expect(loader.getTimelineEvents()).toHaveLength(
      REPLAY_TIMELINE_EXTRACTION_CAPS.console,
    );
    expect(loader.areTimelineEventsTruncated()).toBe(true);
    expect(loader.getExtractionStats().truncatedKinds).toEqual(["console"]);
    expect(loader.getExtractionStats().countsByKind.console).toBe(
      REPLAY_TIMELINE_EXTRACTION_CAPS.console,
    );
  });
});

/*
 * The upgrades the engine relies on: the priority pair, page-aligned
 * prefetching, retries and timeouts, abort on dispose, terminator rows,
 * live-session appends, stable ids, per-kind caps, every recorder tag,
 * rrweb-derived rows and activity intervals.
 */

const CUSTOM_BASE_TS: number = 1_700_000_000_000;

function custom(
  tag: string,
  payload: Record<string, unknown>,
  timestamp: number,
): SessionReplayRecordedEvent {
  return {
    type: 5,
    timestamp: timestamp,
    data: { tag: tag, payload: payload },
  };
}

function incremental(
  data: Record<string, unknown>,
  timestamp: number,
): SessionReplayRecordedEvent {
  return { type: 3, timestamp: timestamp, data: data };
}

/* Lets the loader's own un-awaited follow-up work (loadFirst's page) finish. */
async function settle(): Promise<void> {
  for (let i: number = 0; i < 4; i++) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  }
}

function sequentialEntries(
  count: number,
): Array<SessionReplayChunkManifestEntry> {
  return Array.from(
    { length: count },
    (_unused: unknown, index: number): SessionReplayChunkManifestEntry => {
      return makeEntry(index, { hasFullSnapshot: index === 0 });
    },
  );
}

describe("ChunkLoader first paint and prefetch", () => {
  it("requests the anchor plus one neighbour first, then the rest of the page", async () => {
    const fetcher: RecordingFetcher = makeFetcher();
    const loader: ChunkLoader = makeLoader(sequentialEntries(24), fetcher);

    const decoded: Array<number> = await loader.loadFirst(0);

    expect(decoded).toEqual([0, 1]);
    expect(fetcher.requests[0]).toEqual([0, 1]);

    /* The page fill-in is queued behind the pair, and never re-asks for it. */
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });

    expect(fetcher.requests[1]).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it("borrows the previous chunk when the anchor has none after it", async () => {
    /*
     * A lone oversized FullSnapshot at the end of a tab: the Meta rrweb
     * needs to show the iframe lives in the chunk before it.
     */
    const fetcher: RecordingFetcher = makeFetcher();
    const loader: ChunkLoader = makeLoader(
      [makeEntry(0), makeEntry(1, { hasFullSnapshot: true })],
      fetcher,
    );

    await loader.loadFirst(1);

    expect(fetcher.requests[0]).toEqual([0, 1]);
  });

  it("prefetches in page-aligned requests, never one chunk per fed chunk", async () => {
    /*
     * The old prefetchAfter planned relative to the FED chunk, so the
     * requests degenerated into one single-chunk POST per 15 seconds of
     * footage plus overlapping duplicates right after every rebuild.
     */
    const fetcher: RecordingFetcher = makeFetcher();
    const loader: ChunkLoader = makeLoader(sequentialEntries(24), fetcher);

    await loader.loadFirst(0);
    await loader.loadPage(0);
    await loader.prefetchAhead(1, 2);

    /* Feeding chunks one by one asks for nothing new: it is all resident. */
    for (let fed: number = 2; fed < 20; fed++) {
      await loader.ensureChunk(fed);
      await loader.prefetchAhead(fed, 2);
    }

    expect(fetcher.requests).toEqual([
      [0, 1],
      [2, 3, 4, 5, 6, 7],
      [8, 9, 10, 11, 12, 13, 14, 15],
      [16, 17, 18, 19, 20, 21, 22, 23],
    ]);
  });

  it("holds enough decoded chunks for the pages the player prefetches", () => {
    /*
     * The two numbers are not independent. A cache smaller than the
     * priority pair plus the page being fed plus every page prefetched
     * past it evicts footage that has been downloaded but not yet fed,
     * and the feed loop fetches it straight back.
     */
    expect(DEFAULT_MAX_DECODED_CHUNKS).toBeGreaterThanOrEqual(
      2 + MAX_SESSION_REPLAY_CHUNKS_PER_READ * (1 + MAX_PREFETCH_PAGES_AHEAD),
    );
  });

  it("never re-fetches a chunk during a straight playthrough longer than the cache", async () => {
    /*
     * The 12x request amplification. With a 24-chunk cache, the priority
     * pair plus one 8-chunk page plus the two pages prefetched after every
     * feed filled it exactly, so the next admit evicted the chunks about
     * to be fed and ensureChunk fetched them again - 95 page requests for a
     * 60-chunk session, one chunk fetched 17 times, and periodic stalls
     * because the junk prefetches shared the connection with the fetch on
     * the critical path.
     *
     * 60 entries, deliberately more than the cache holds, fed in order the
     * way the engine feeds them.
     */
    const fetcher: RecordingFetcher = makeFetcher();
    const loader: ChunkLoader = makeLoader(sequentialEntries(60), fetcher);

    await loader.loadFirst(0);
    await settle();

    for (let fed: number = 0; fed < 60; fed++) {
      loader.setFedThrough(fed - 1);

      const events: Array<SessionReplayRecordedEvent> | null =
        await loader.ensureChunk(fed);

      expect(events).not.toBeNull();

      loader.setFedThrough(fed);
      /* 4 pages: what the loader must survive at 4x and above. */
      await loader.prefetchAhead(fed, MAX_PREFETCH_PAGES_AHEAD);
    }

    const timesRequested: Map<number, number> = new Map<number, number>();

    for (const request of fetcher.requests) {
      for (const chunkIndex of request) {
        timesRequested.set(
          chunkIndex,
          (timesRequested.get(chunkIndex) ?? 0) + 1,
        );
      }
    }

    const refetched: Array<number> = [...timesRequested.entries()]
      .filter((pair: [number, number]): boolean => {
        return pair[1] > 1;
      })
      .map((pair: [number, number]): number => {
        return pair[0];
      });

    expect(refetched).toEqual([]);
    /* 60 chunks in 8-chunk pages, plus the priority pair's own request. */
    expect(fetcher.requests.length).toBeLessThanOrEqual(10);
  });

  it("evicts footage that has been fed before footage that has not", async () => {
    /*
     * Reading a chunk makes it the most recently USED, so once playback
     * has fed chunks 0..3 the least recently used entries are exactly the
     * prefetched ones it is about to need. Plain LRU therefore threw away
     * 4..7 to make room for 8..15 and fetched 4..7 straight back.
     */
    const fetcher: RecordingFetcher = makeFetcher();
    const loader: ChunkLoader = makeLoader(sequentialEntries(20), fetcher, {
      maxDecodedChunks: 12,
    });

    await loader.loadPage(0);

    for (let fed: number = 0; fed <= 3; fed++) {
      loader.getDecodedChunk(fed);
    }

    loader.setFedThrough(3);
    await loader.loadPage(8);

    const decoded: Array<number> = loader.getDecodedChunkIndexes();

    expect(decoded).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    /* The four the player has already watched are the four that went. */
    expect(decoded).not.toContain(0);
  });

  it("stops prefetching rather than fetching a page the cache cannot hold", async () => {
    const fetcher: RecordingFetcher = makeFetcher();
    const loader: ChunkLoader = makeLoader(sequentialEntries(40), fetcher, {
      maxDecodedChunks: 16,
    });

    await loader.loadPage(0);
    loader.setFedThrough(3);
    await loader.prefetchAhead(3, 4);

    /*
     * One more page fits alongside the four chunks still waiting to be
     * fed; a second would evict the first before anything played it, so
     * it is left for the moment playback actually asks.
     */
    expect(fetcher.requests).toEqual([
      [0, 1, 2, 3, 4, 5, 6, 7],
      [8, 9, 10, 11, 12, 13, 14, 15],
    ]);
    expect(loader.getDecodedChunkIndexes().length).toBeLessThanOrEqual(16);
  });

  it("waits for an in-flight request covering the same chunks instead of re-fetching them", async () => {
    let release: (() => void) | null = null;
    const gate: Promise<void> = new Promise<void>((resolve: () => void) => {
      release = resolve;
    });
    const requests: Array<Array<number>> = [];

    const loader: ChunkLoader = new ChunkLoader({
      sessionId: "sess-1",
      tabId: "tab-1",
      entries: sequentialEntries(16),
      fetcher: async (request: {
        chunkIndexes: Array<number>;
      }): Promise<ArrayBuffer> => {
        requests.push([...request.chunkIndexes]);
        await gate;
        return encodeFrames(
          request.chunkIndexes.map(
            (chunkIndex: number): { chunkIndex: number; body: string } => {
              return { chunkIndex: chunkIndex, body: bodyFor(chunkIndex) };
            },
          ),
        );
      },
    });

    /* Page from 8 overlaps the page from 10 on [10..15]. */
    const first: Promise<Array<number>> = loader.loadPage(8);
    const second: Promise<Array<number>> = loader.loadPage(10);

    expect(loader.isChunkInFlight(12)).toBe(true);

    release!();
    await Promise.all([first, second]);

    expect(requests).toEqual([[8, 9, 10, 11, 12, 13, 14, 15]]);
    expect(await second).toEqual([10, 11, 12, 13, 14, 15]);
    expect(loader.isChunkInFlight(12)).toBe(false);
  });
});

describe("ChunkLoader transport failures", () => {
  it("retries a failing fetch twice with the configured back-off, then throws a ChunkLoadError", async () => {
    let attempts: number = 0;

    const loader: ChunkLoader = new ChunkLoader({
      sessionId: "sess-1",
      tabId: "tab-1",
      entries: [makeEntry(0, { hasFullSnapshot: true })],
      retryDelaysMs: [1, 1],
      fetcher: (): Promise<ArrayBuffer> => {
        attempts += 1;
        return Promise.reject(
          new Error("Could not load recording data (HTTP 503)."),
        );
      },
    });

    let caught: unknown = null;

    try {
      await loader.ensureChunk(0);
    } catch (err) {
      caught = err;
    }

    expect(attempts).toBe(3);
    expect(caught).toBeInstanceOf(ChunkLoadError);
    expect((caught as ChunkLoadError).attempts).toBe(3);
    expect((caught as ChunkLoadError).isTimeout).toBe(false);
    expect((caught as ChunkLoadError).chunkIndexes).toEqual([0]);
    expect((caught as ChunkLoadError).message).toContain("after 3 attempts");
    expect((caught as ChunkLoadError).message).toContain("HTTP 503");
  });

  it("recovers when a retry succeeds", async () => {
    let attempts: number = 0;

    const loader: ChunkLoader = new ChunkLoader({
      sessionId: "sess-1",
      tabId: "tab-1",
      entries: [makeEntry(0, { hasFullSnapshot: true })],
      retryDelaysMs: [1, 1],
      fetcher: (request: {
        chunkIndexes: Array<number>;
      }): Promise<ArrayBuffer> => {
        attempts += 1;

        if (attempts === 1) {
          return Promise.reject(new Error("blip"));
        }

        return Promise.resolve(
          encodeFrames(
            request.chunkIndexes.map(
              (chunkIndex: number): { chunkIndex: number; body: string } => {
                return { chunkIndex: chunkIndex, body: bodyFor(chunkIndex) };
              },
            ),
          ),
        );
      },
    });

    const events: Array<SessionReplayRecordedEvent> | null =
      await loader.ensureChunk(0);

    expect(attempts).toBe(2);
    expect(events).not.toBeNull();
    expect(loader.getDecodedChunkIndexes()).toEqual([0]);
  });

  it("times out a hung request, even when the transport ignores the signal", async () => {
    let attempts: number = 0;

    const loader: ChunkLoader = new ChunkLoader({
      sessionId: "sess-1",
      tabId: "tab-1",
      entries: [makeEntry(0, { hasFullSnapshot: true })],
      fetchTimeoutMs: 5,
      retryDelaysMs: [1, 1],
      fetcher: (): Promise<ArrayBuffer> => {
        attempts += 1;
        return new Promise<ArrayBuffer>((): void => {
          // Never resolves.
        });
      },
    });

    let caught: unknown = null;

    try {
      await loader.ensureChunk(0);
    } catch (err) {
      caught = err;
    }

    expect(attempts).toBe(3);
    expect((caught as ChunkLoadError).isTimeout).toBe(true);
    expect((caught as ChunkLoadError).message).toContain("no response within");
  });

  it("hands the transport an abort signal and fires it on dispose", async () => {
    const signals: Array<AbortSignal> = [];

    const loader: ChunkLoader = new ChunkLoader({
      sessionId: "sess-1",
      tabId: "tab-1",
      entries: [makeEntry(0, { hasFullSnapshot: true })],
      fetcher: (request: { signal?: AbortSignal }): Promise<ArrayBuffer> => {
        if (request.signal) {
          signals.push(request.signal);
        }

        return new Promise<ArrayBuffer>((): void => {
          // Never resolves; dispose is what ends it.
        });
      },
    });

    const pending: Promise<Array<number>> = loader.loadPage(0);

    expect(signals.length).toBe(1);
    expect(signals[0]!.aborted).toBe(false);

    loader.dispose();

    expect(signals[0]!.aborted).toBe(true);
    /* Aborted by the viewer leaving: quiet, not an error. */
    await expect(pending).resolves.toEqual([]);
  });
});

describe("ChunkLoader terminators and appends", () => {
  it("treats a zero-event closing chunk as the end of footage, not as a chunk to feed", () => {
    /*
     * The recorder emits `[]` with eventCount 0 at tab close and at the
     * chunk cap, stamped with the close time. It used to reach the feeder
     * as "undecodable" and end most sessions with an error banner.
     */
    const loader: ChunkLoader = makeLoader(
      [
        makeEntry(0, { hasFullSnapshot: true }),
        makeEntry(1),
        { ...makeEntry(2), eventCount: 0, chunkEndOffsetMs: 10 * CHUNK_MS },
      ],
      makeFetcher(),
    );

    expect(loader.getNextChunk(1)).toBeNull();
    expect(loader.getDurationMs()).toBe(2 * CHUNK_MS);
    expect(loader.getRecordedEndMs()).toBe(10 * CHUNK_MS);
    expect(loader.planPage(0)).toEqual([0, 1]);
    expect(loader.getPlayableEntries()).toHaveLength(2);
    expect(
      loader
        .getTerminatorEntries()
        .map((e: SessionReplayChunkManifestEntry): number => {
          return e.chunkIndex;
        }),
    ).toEqual([2]);
    expect(loader.getChunkIndexForOffset(5 * CHUNK_MS)).toBe(1);
  });

  it("steps over an empty chunk in the middle without reporting a gap", () => {
    const loader: ChunkLoader = makeLoader(
      [
        makeEntry(0, { hasFullSnapshot: true }),
        { ...makeEntry(1), eventCount: 0 },
        makeEntry(2),
      ],
      makeFetcher(),
    );

    expect(loader.getNextChunk(0)).toEqual({ chunkIndex: 2, skippedGap: null });
    expect(loader.getGaps()).toEqual([]);
  });

  it("resolves null for a terminator rather than fetching it", async () => {
    const fetcher: RecordingFetcher = makeFetcher();
    const loader: ChunkLoader = makeLoader(
      [
        makeEntry(0, { hasFullSnapshot: true }),
        { ...makeEntry(1), eventCount: 0 },
      ],
      fetcher,
    );

    await expect(loader.ensureChunk(1)).resolves.toBeNull();
    expect(fetcher.requests).toEqual([]);
  });

  it("appends live manifest rows in order and recomputes gaps and duration", () => {
    const loader: ChunkLoader = makeLoader(
      [makeEntry(0, { hasFullSnapshot: true }), makeEntry(1)],
      makeFetcher(),
    );

    expect(loader.getDurationMs()).toBe(2 * CHUNK_MS);
    expect(loader.getNextChunk(1)).toBeNull();

    const added: number = loader.appendEntries([
      makeEntry(4, { hasFullSnapshot: true }),
      makeEntry(2),
      makeEntry(1),
    ]);

    expect(added).toBe(2);
    expect(
      loader
        .getEntries()
        .map((entry: SessionReplayChunkManifestEntry): number => {
          return entry.chunkIndex;
        }),
    ).toEqual([0, 1, 2, 4]);
    expect(loader.getDurationMs()).toBe(5 * CHUNK_MS);
    expect(loader.getGaps()).toEqual([
      { fromIndex: 2, toIndex: 4, missingMs: CHUNK_MS },
    ]);
    expect(loader.getFullSnapshotChunkIndexes()).toEqual([0, 4]);
    expect(loader.getNextChunk(1)).toEqual({ chunkIndex: 2, skippedGap: null });
  });
});

describe("ChunkLoader signal extraction", () => {
  it("assigns stable rec:<chunk>:<ordinal> ids that survive eviction and re-admission", async () => {
    const fetcher: RecordingFetcher = makeFetcher({
      payloadFor: (): string => {
        return JSON.stringify([
          { type: 2, timestamp: CUSTOM_BASE_TS, data: {} },
          custom(
            "oneuptime.console",
            { level: "warn", message: "a" },
            CUSTOM_BASE_TS + 100,
          ),
          custom(
            "oneuptime.console",
            { level: "error", message: "b" },
            CUSTOM_BASE_TS + 200,
          ),
        ]);
      },
    });
    const loader: ChunkLoader = makeLoader(
      [makeEntry(0, { hasFullSnapshot: true }), makeEntry(3)],
      fetcher,
    );

    await loader.loadPage(0);

    const before: Array<string> = loader
      .getTimelineEvents()
      .map((event: ReplayTimelineEvent): string => {
        return event.id;
      });

    expect(before).toEqual(["rec:0:0", "rec:0:1", "rec:3:0", "rec:3:1"]);

    loader.evictOutsideWindow(99, 0);
    await loader.loadPage(0);

    expect(
      loader.getTimelineEvents().map((event: ReplayTimelineEvent): string => {
        return event.id;
      }),
    ).toEqual(before);
  });

  it("extracts every recorder tag with its payload fields", () => {
    const rows: Array<ReplayTimelineEvent> = ChunkLoader.extractTimelineEvents(
      makeEntry(0),
      [
        { type: 2, timestamp: CUSTOM_BASE_TS, data: {} },
        custom(
          "oneuptime.error",
          {
            kind: "unhandledrejection",
            message: "boom",
            source: "app.js",
            lineNumber: 12,
            columnNumber: 4,
            stack: "Error: boom\n at x",
            occurredAtUnixMs: CUSTOM_BASE_TS - 5000,
          },
          CUSTOM_BASE_TS + 10,
        ),
        custom(
          "oneuptime.frustration",
          {
            kind: "rage-click",
            atUnixMs: CUSTOM_BASE_TS + 20,
            x: 10,
            y: 20,
            clickCount: 5,
          },
          CUSTOM_BASE_TS + 20,
        ),
        custom(
          "oneuptime.performance",
          { kind: "lcp", durationMs: 4800, budgetMs: 4000, url: "/checkout" },
          CUSTOM_BASE_TS + 30,
        ),
        custom(
          "oneuptime.performance",
          { kind: "web-vital", metric: "INP", value: 320, rating: "poor" },
          CUSTOM_BASE_TS + 40,
        ),
        custom(
          "oneuptime.click",
          {
            selector: "button.pay",
            text: "Pay now",
            x: 1,
            y: 2,
            atUnixMs: CUSTOM_BASE_TS + 50,
          },
          CUSTOM_BASE_TS + 50,
        ),
        custom("oneuptime.click-dropped", { count: 7 }, CUSTOM_BASE_TS + 60),
        custom(
          "oneuptime.visibility",
          { state: "hidden", atUnixMs: CUSTOM_BASE_TS + 70 },
          CUSTOM_BASE_TS + 70,
        ),
        custom(
          "oneuptime.custom",
          { name: "checkout_started", properties: { plan: "pro" } },
          CUSTOM_BASE_TS + 80,
        ),
        custom("oneuptime.custom-dropped", { count: 3 }, CUSTOM_BASE_TS + 90),
        custom("oneuptime.identify", { hasTraits: true }, CUSTOM_BASE_TS + 100),
        custom(
          "oneuptime.tags",
          { tags: { tenant: "acme" } },
          CUSTOM_BASE_TS + 110,
        ),
        custom(
          "oneuptime.network",
          {
            method: "POST",
            url: "/api/orders",
            status: 500,
            durationMs: 220,
            responseBytes: 512,
            requestBytes: 64,
            isError: true,
            initiator: "fetch",
            traceId: "abc",
          },
          CUSTOM_BASE_TS + 120,
        ),
        custom(
          "oneuptime.route",
          { from: "/cart", to: "/checkout", kind: "pushState" },
          CUSTOM_BASE_TS + 130,
        ),
      ],
    );

    const byKind: Map<string, ReplayTimelineEvent> = new Map<
      string,
      ReplayTimelineEvent
    >();

    for (const row of rows) {
      if (!byKind.has(row.kind)) {
        byKind.set(row.kind, row);
      }
    }

    expect([...byKind.keys()].sort()).toEqual(
      [
        "error",
        "frustration",
        "performance",
        "click",
        "click-dropped",
        "visibility",
        "custom",
        "custom-dropped",
        "identify",
        "tags",
        "network",
        "route",
      ].sort(),
    );

    expect(byKind.get("error")).toEqual(
      expect.objectContaining({
        errorKind: "unhandledrejection",
        lineNumber: 12,
        columnNumber: 4,
        stack: "Error: boom\n at x",
        atUnixMs: CUSTOM_BASE_TS - 5000,
      }),
    );
    expect(byKind.get("frustration")).toEqual(
      expect.objectContaining({
        frustrationKind: "rage-click",
        x: 10,
        y: 20,
        clickCount: 5,
      }),
    );
    expect(byKind.get("performance")).toEqual(
      expect.objectContaining({
        performanceKind: "lcp",
        durationMs: 4800,
        budgetMs: 4000,
        url: "/checkout",
      }),
    );
    expect(
      rows.find((row: ReplayTimelineEvent): boolean => {
        return row.metric === "INP";
      }),
    ).toEqual(
      expect.objectContaining({
        performanceKind: "web-vital",
        value: 320,
        rating: "poor",
      }),
    );
    expect(byKind.get("click")).toEqual(
      expect.objectContaining({
        selector: "button.pay",
        text: "Pay now",
        x: 1,
        y: 2,
      }),
    );
    expect(byKind.get("click-dropped")?.droppedCount).toBe(7);
    expect(byKind.get("visibility")?.visibilityState).toBe("hidden");
    expect(byKind.get("custom")).toEqual(
      expect.objectContaining({
        name: "checkout_started",
        properties: { plan: "pro" },
      }),
    );
    expect(byKind.get("custom-dropped")?.droppedCount).toBe(3);
    expect(byKind.get("identify")?.hasTraits).toBe(true);
    expect(byKind.get("tags")?.tags).toEqual({ tenant: "acme" });
    expect(byKind.get("network")).toEqual(
      expect.objectContaining({
        requestBytes: 64,
        isError: true,
        initiator: "fetch",
        traceId: "abc",
      }),
    );
    expect(byKind.get("route")?.routeKind).toBe("pushState");
  });

  it("places a performance row when the entry happened, not when the recorder emitted it", () => {
    /*
     * Performance entries are delivered late by design: a buffered LCP
     * arrives at its observer callback, a long task after it ends, and
     * CLS/INP only settle at page hide. Placing the row at the rrweb
     * event's timestamp put the marker wherever the event queue flushed,
     * which for a web vital is the end of the recording rather than the
     * moment the number describes.
     */
    const rows: Array<ReplayTimelineEvent> = ChunkLoader.extractTimelineEvents(
      makeEntry(0),
      [
        { type: 2, timestamp: CUSTOM_BASE_TS, data: {} },
        custom(
          "oneuptime.performance",
          {
            kind: "web-vital",
            metric: "LCP",
            value: 2400,
            rating: "poor",
            occurredAtUnixMs: CUSTOM_BASE_TS + 2400,
          },
          /* Reported 12 seconds later, at page hide. */
          CUSTOM_BASE_TS + 12000,
        ),
        custom(
          "oneuptime.performance",
          { kind: "long-task", durationMs: 180, budgetMs: 50 },
          CUSTOM_BASE_TS + 9000,
        ),
      ],
    );

    const vital: ReplayTimelineEvent | undefined = rows.find(
      (row: ReplayTimelineEvent): boolean => {
        return row.metric === "LCP";
      },
    );
    const longTask: ReplayTimelineEvent | undefined = rows.find(
      (row: ReplayTimelineEvent): boolean => {
        return row.performanceKind === "long-task";
      },
    );

    expect(vital?.offsetMs).toBe(2400);
    /* No occurredAtUnixMs: the event's own timestamp still stands. */
    expect(longTask?.offsetMs).toBe(9000);
  });

  it("turns rrweb Meta events into navigation rows carrying the viewport", () => {
    const rows: Array<ReplayTimelineEvent> = ChunkLoader.extractTimelineEvents(
      makeEntry(0),
      [
        {
          type: RRWEB_EVENT_TYPE_META,
          timestamp: CUSTOM_BASE_TS,
          data: {
            href: "https://app.example.com/start",
            width: 1440,
            height: 900,
          },
        },
        { type: 2, timestamp: CUSTOM_BASE_TS + 1, data: {} },
      ],
    );

    expect(rows).toEqual([
      {
        id: "rec:0:0",
        kind: "navigation",
        chunkIndex: 0,
        offsetMs: 0,
        to: "https://app.example.com/start",
        viewportWidth: 1440,
        viewportHeight: 900,
      },
    ]);
  });

  it("derives click rows from rrweb MouseInteraction only when the chunk carries no oneuptime.click", () => {
    const rrwebClick: SessionReplayRecordedEvent = incremental(
      {
        source: RRWEB_SOURCE_MOUSE_INTERACTION,
        type: RRWEB_MOUSE_INTERACTION_CLICK,
        id: 4,
        x: 30,
        y: 40,
      },
      CUSTOM_BASE_TS + 100,
    );
    const rrwebTouch: SessionReplayRecordedEvent = incremental(
      {
        source: RRWEB_SOURCE_MOUSE_INTERACTION,
        type: RRWEB_MOUSE_INTERACTION_TOUCH_START,
        id: 4,
        x: 5,
        y: 6,
      },
      CUSTOM_BASE_TS + 200,
    );

    /* An old recording: only rrweb's own interactions. */
    const legacy: Array<ReplayTimelineEvent> =
      ChunkLoader.extractTimelineEvents(makeEntry(0), [
        { type: 2, timestamp: CUSTOM_BASE_TS, data: {} },
        rrwebClick,
        rrwebTouch,
      ]);

    expect(
      legacy.map(
        (
          row: ReplayTimelineEvent,
        ): [string, number | undefined, number | undefined] => {
          return [row.kind, row.x, row.y];
        },
      ),
    ).toEqual([
      ["click", 30, 40],
      ["click", 5, 6],
    ]);
    expect(legacy[0]?.selector).toBeUndefined();

    /* A current recording: the labelled click wins, the fallback is dropped. */
    const labelled: Array<ReplayTimelineEvent> =
      ChunkLoader.extractTimelineEvents(makeEntry(0), [
        { type: 2, timestamp: CUSTOM_BASE_TS, data: {} },
        rrwebClick,
        custom(
          "oneuptime.click",
          { selector: "a.nav", x: 30, y: 40, atUnixMs: CUSTOM_BASE_TS + 100 },
          CUSTOM_BASE_TS + 100,
        ),
      ]);

    expect(labelled).toHaveLength(1);
    expect(labelled[0]?.selector).toBe("a.nav");
  });

  it("builds activity intervals from user-input sources and recorder activity tags", () => {
    const { activityIntervals } = ChunkLoader.extractChunk(makeEntry(2), [
      { type: 2, timestamp: CUSTOM_BASE_TS, data: {} },
      incremental({ source: RRWEB_SOURCE_MOUSE_MOVE }, CUSTOM_BASE_TS + 1000),
      incremental({ source: RRWEB_SOURCE_SCROLL }, CUSTOM_BASE_TS + 2000),
      /* A mutation is the page doing something, not the user. */
      incremental({ source: 0 }, CUSTOM_BASE_TS + 6000),
      custom(
        "oneuptime.route",
        { from: "/a", to: "/b", kind: "pushState" },
        CUSTOM_BASE_TS + 9000,
      ),
      incremental({ source: RRWEB_SOURCE_MOUSE_MOVE }, CUSTOM_BASE_TS + 13000),
    ]);

    /*
     * Chunk 2 starts at 30s. 1s and 2s are one stretch; 9s is 7s later, so
     * a new one; 13s is within the 5s threshold of 9s, so it extends it.
     */
    expect(activityIntervals).toEqual([
      {
        startMs: 2 * CHUNK_MS + 1000,
        endMs: 2 * CHUNK_MS + 2000,
        chunkIndex: 2,
      },
      {
        startMs: 2 * CHUNK_MS + 9000,
        endMs: 2 * CHUNK_MS + 13000,
        chunkIndex: 2,
      },
    ]);
  });

  it("reports per-kind counts and activity through the extraction stats", async () => {
    const fetcher: RecordingFetcher = makeFetcher({
      payloadFor: (): string => {
        return JSON.stringify([
          { type: 2, timestamp: CUSTOM_BASE_TS, data: {} },
          incremental(
            { source: RRWEB_SOURCE_MOUSE_MOVE },
            CUSTOM_BASE_TS + 500,
          ),
          custom(
            "oneuptime.console",
            { level: "warn", message: "x" },
            CUSTOM_BASE_TS + 600,
          ),
        ]);
      },
    });
    const loader: ChunkLoader = makeLoader(
      [makeEntry(0, { hasFullSnapshot: true }), makeEntry(1)],
      fetcher,
    );

    await loader.loadPage(0);

    const stats: {
      countsByKind: Partial<Record<string, number>>;
      truncatedKinds: Array<string>;
      activityIntervals: Array<{ chunkIndex: number }>;
    } = loader.getExtractionStats();

    expect(stats.countsByKind["console"]).toBe(2);
    expect(stats.truncatedKinds).toEqual([]);
    expect(
      stats.activityIntervals.map(
        (interval: { chunkIndex: number }): number => {
          return interval.chunkIndex;
        },
      ),
    ).toEqual([0, 1]);
    expect(loader.getActivityIntervalsForChunk(1)).toHaveLength(1);
    expect(loader.getActivityIntervalsForChunk(5)).toBeNull();
    expect(loader.getTimelineEventsForChunk(0)).toHaveLength(1);
  });
});
