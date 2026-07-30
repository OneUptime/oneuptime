import Chunker, { PendingChunk } from "../src/Chunker";
import { BufferedEvent } from "../src/RollingBuffer";

describe("Chunker", (): void => {
  const SESSION_START: number = 1_700_000_000_000;

  let chunks: Array<PendingChunk> = [];

  const makeChunker: (maxPayloadBytes?: number) => Chunker = (
    maxPayloadBytes?: number,
  ): Chunker => {
    chunks = [];

    return new Chunker({
      sessionStartUnixMs: SESSION_START,
      sink: (chunk: PendingChunk): void => {
        chunks.push(chunk);
      },
      ...(maxPayloadBytes === undefined
        ? {}
        : { maxPayloadBytes: maxPayloadBytes }),
    });
  };

  const event: (overrides?: Partial<BufferedEvent>) => BufferedEvent = (
    overrides?: Partial<BufferedEvent>,
  ): BufferedEvent => {
    return {
      json: '{"type":3,"data":{"source":3}}',
      bytes: 30,
      timestampMs: SESSION_START + 1000,
      isCheckout: false,
      type: 3,
      ...overrides,
    };
  };

  it("emits a JSON array of the events it collected", (): void => {
    const chunker: Chunker = makeChunker();

    chunker.add(event({ json: '{"a":1}', bytes: 7 }));
    chunker.add(event({ json: '{"b":2}', bytes: 7 }));
    chunker.close(false);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.payload).toBe('[{"a":1},{"b":2}]');
    expect(chunks[0]?.eventCount).toBe(2);
  });

  /*
   * The load-bearing boundary rule. rrweb emits a checkout as TWO events -
   * Meta then FullSnapshot, both flagged isCheckout - so the naive "close on
   * every isCheckout" would emit a chunk containing only the Meta event.
   */
  it("closes on isCheckout and opens the next chunk on the snapshot", (): void => {
    const chunker: Chunker = makeChunker();

    chunker.add(event({ type: 4, json: '{"type":4}', bytes: 10 }));
    chunker.add(event({ type: 2, json: '{"type":2}', bytes: 10 }));
    chunker.add(event());
    chunker.add(event());

    /* The 60s checkout arrives. */
    chunker.add(event({ type: 4, json: '{"m":1}', isCheckout: true }));
    chunker.add(event({ type: 2, json: '{"s":1}', isCheckout: true }));
    chunker.add(event());
    chunker.close(false);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.eventCount).toBe(4);
    expect(chunks[0]?.hasFullSnapshot).toBe(true);
    expect(chunks[1]?.eventCount).toBe(3);
    expect(chunks[1]?.hasFullSnapshot).toBe(true);
    expect(chunks[1]?.payload.startsWith('[{"m":1},{"s":1}')).toBe(true);
  });

  /*
   * rrweb's FIRST snapshot is emitted with isCheckout false, so a
   * hasFullSnapshot derived only from that flag would leave chunk 0 without a
   * seek anchor even though it contains a snapshot.
   */
  it("sets hasFullSnapshot for the initial non-checkout snapshot", (): void => {
    const chunker: Chunker = makeChunker();

    chunker.add(event({ type: 4, isCheckout: false }));
    chunker.add(event({ type: 2, isCheckout: false }));
    chunker.close(false);

    expect(chunks[0]?.hasFullSnapshot).toBe(true);
  });

  it("does not treat a snapshot arriving mid-chunk as a seek anchor", (): void => {
    const chunker: Chunker = makeChunker();

    chunker.add(event());
    chunker.add(event({ type: 2 }));
    chunker.close(false);

    expect(chunks[0]?.hasFullSnapshot).toBe(false);
  });

  it("closes on the byte threshold", (): void => {
    const chunker: Chunker = makeChunker(100);

    chunker.add(event({ bytes: 60 }));
    expect(chunks).toHaveLength(0);

    chunker.add(event({ bytes: 60 }));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.rawBytes).toBe(120);
  });

  it("records offsets relative to the session start", (): void => {
    const chunker: Chunker = makeChunker();

    chunker.add(event({ timestampMs: SESSION_START + 500 }));
    chunker.add(event({ timestampMs: SESSION_START + 2500 }));
    chunker.close(false);

    expect(chunks[0]?.chunkStartOffsetMs).toBe(500);
    expect(chunks[0]?.chunkEndOffsetMs).toBe(2500);
  });

  it("emits an empty final chunk so the session seals cleanly", (): void => {
    const chunker: Chunker = makeChunker();

    chunker.close(true);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.isFinal).toBe(true);
    expect(chunks[0]?.payload).toBe("[]");
    expect(chunks[0]?.eventCount).toBe(0);
  });

  it("does not emit anything for a non-final close with no events", (): void => {
    const chunker: Chunker = makeChunker();

    chunker.close(false);

    expect(chunks).toHaveLength(0);
  });

  describe("oversized snapshot splitting", (): void => {
    /*
     * A FullSnapshot is one indivisible rrweb event. It cannot be split across
     * chunks and still parse, so the parts carry raw slices and only the LAST
     * part claims hasFullSnapshot - otherwise a seek anchor would point into
     * the middle of a snapshot and the player would rebuild a partial DOM.
     */
    it("splits one oversized event into parts, anchoring only the last", (): void => {
      const chunker: Chunker = makeChunker(50);
      const big: string = `{"type":2,"data":"${"x".repeat(200)}"}`;

      chunker.add(
        event({ type: 2, json: big, bytes: big.length, isCheckout: true }),
      );

      expect(chunks.length).toBeGreaterThan(1);

      const total: number = chunks.length;

      chunks.forEach((chunk: PendingChunk, index: number): void => {
        expect(chunk.snapshotPart).toEqual({ index: index, total: total });
        expect(chunk.hasFullSnapshot).toBe(index === total - 1);
        expect(chunk.eventCount).toBe(index === total - 1 ? 1 : 0);
      });

      /* Concatenating every part reproduces the exact JSON array. */
      const rejoined: string = chunks
        .map((chunk: PendingChunk): string => {
          return chunk.payload;
        })
        .join("");

      expect(rejoined).toBe(`[${big}]`);
    });
  });

  describe("per-chunk counters", (): void => {
    it("resets signals between chunks so the finalizer can sum them", (): void => {
      const chunker: Chunker = makeChunker();

      chunker.countSignal("errorCount");
      chunker.countSignal("rageClickCount", 2);
      chunker.add(event());
      chunker.close(false);

      chunker.add(event());
      chunker.close(false);

      expect(chunks[0]?.signals.errorCount).toBe(1);
      expect(chunks[0]?.signals.rageClickCount).toBe(2);
      expect(chunks[1]?.signals.errorCount).toBe(0);
      expect(chunks[1]?.signals.rageClickCount).toBe(0);
    });

    it("keeps fidelity notices across chunks, because they describe the page", (): void => {
      const chunker: Chunker = makeChunker();

      chunker.addFidelityNotice("canvas-not-recorded");
      chunker.add(event());
      chunker.close(false);

      chunker.add(event());
      chunker.close(false);

      expect(chunks[0]?.fidelityNotices).toEqual(["canvas-not-recorded"]);
      expect(chunks[1]?.fidelityNotices).toEqual(["canvas-not-recorded"]);
    });

    it("deduplicates trace ids and resets them per chunk", (): void => {
      const chunker: Chunker = makeChunker();

      chunker.addTraceId("a".repeat(32));
      chunker.addTraceId("a".repeat(32));
      chunker.add(event());
      chunker.close(false);

      chunker.add(event());
      chunker.close(false);

      expect(chunks[0]?.traceIds).toEqual(["a".repeat(32)]);
      expect(chunks[1]?.traceIds).toEqual([]);
    });
  });

  it("stops emitting once the per-session chunk cap is reached", (): void => {
    const chunker: Chunker = makeChunker(10);

    for (let i: number = 0; i < 600; i++) {
      chunker.add(event({ bytes: 10 }));
    }

    expect(chunker.hasReachedSessionChunkCap()).toBe(true);
    expect(chunks.length).toBeLessThanOrEqual(480);
  });
});
