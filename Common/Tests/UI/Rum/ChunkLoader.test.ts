import { describe, expect, it } from "@jest/globals";
import { SessionReplayChunkManifestEntry } from "../../../Types/Rum/SessionReplay";
import ChunkLoader, {
  SessionReplayRecordedEvent,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ChunkLoader";

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
