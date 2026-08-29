import Chunker, {
  PendingChunk,
  SESSION_REPLAY_TRUNCATED_NOTICE,
  splitByUtf8Bytes,
  utf8ByteLength,
} from "../src/Chunker";
import { BufferedEvent } from "../src/RollingBuffer";

describe("Chunker", (): void => {
  const SESSION_START: number = 1_700_000_000_000;

  let chunks: Array<PendingChunk> = [];
  let truncationCallbacks: number = 0;

  const makeChunker: (maxPayloadBytes?: number) => Chunker = (
    maxPayloadBytes?: number,
  ): Chunker => {
    chunks = [];
    truncationCallbacks = 0;

    return new Chunker({
      sessionStartUnixMs: SESSION_START,
      sink: (chunk: PendingChunk): void => {
        chunks.push(chunk);
      },
      onTruncated: (): void => {
        truncationCallbacks++;
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

  /*
   * WHERE the page was while the chunk was open.
   *
   * routeCount already said HOW MANY navigations happened; without the URLs
   * themselves the server could only ever see the page a chunk was FLUSHED
   * from, so two navigations inside one 15s window collapsed to one and the
   * session's routes[] column could never hold more than the landing page.
   */
  describe("routes", (): void => {
    it("carries the routes recorded while the chunk was open", (): void => {
      const chunker: Chunker = makeChunker();

      chunker.addRoute("https://shop.example.com/");
      chunker.add(event());
      chunker.addRoute("https://shop.example.com/cart");
      chunker.add(event());
      chunker.close(false);

      expect(chunks[0]?.routes).toEqual([
        "https://shop.example.com/",
        "https://shop.example.com/cart",
      ]);
    });

    it("keeps first-seen order, so the last entry is the chunk's exit page", (): void => {
      const chunker: Chunker = makeChunker();

      chunker.addRoute("https://shop.example.com/a");
      chunker.addRoute("https://shop.example.com/b");
      chunker.addRoute("https://shop.example.com/a");
      chunker.addRoute("https://shop.example.com/c");
      chunker.add(event());
      chunker.close(false);

      expect(chunks[0]?.routes).toEqual([
        "https://shop.example.com/a",
        "https://shop.example.com/b",
        "https://shop.example.com/c",
      ]);
    });

    /*
     * Reset with the other per-chunk counters. The finalizer UNIONS routes
     * across chunks, so carrying them forward would make every chunk after
     * the first repeat the whole history for no gain.
     */
    it("resets per chunk, like the signal counters", (): void => {
      const chunker: Chunker = makeChunker();

      chunker.addRoute("https://shop.example.com/first");
      chunker.add(event());
      chunker.close(false);

      chunker.addRoute("https://shop.example.com/second");
      chunker.add(event());
      chunker.close(false);

      expect(chunks[0]?.routes).toEqual(["https://shop.example.com/first"]);
      expect(chunks[1]?.routes).toEqual(["https://shop.example.com/second"]);
    });

    it("ignores an empty url rather than storing a blank route", (): void => {
      const chunker: Chunker = makeChunker();

      chunker.addRoute("");
      chunker.add(event());
      chunker.close(false);

      expect(chunks[0]?.routes).toEqual([]);
    });

    /*
     * A page that rewrites its path on every keystroke must not be able to
     * grow one envelope without bound. routeCount still counts every change
     * past the cap, so the signal is not lost - only the list is bounded.
     */
    it("caps the number of distinct routes it will carry", (): void => {
      const chunker: Chunker = makeChunker();

      for (let index: number = 0; index < 200; index++) {
        chunker.addRoute(`https://shop.example.com/step-${index}`);
      }

      chunker.add(event());
      chunker.close(false);

      const routes: Array<string> = chunks[0]?.routes ?? [];

      /* MAX_ROUTES_PER_CHUNK. Pinned, so doubling the cap fails here. */
      expect(routes.length).toBe(32);
      expect(routes[0]).toBe("https://shop.example.com/step-0");
    });

    /*
     * The BYTE budget is the one that matters.
     *
     * routes rides the envelope JSON, and the server rejects any envelope
     * over 8 KB outright - failing the whole request, up to eight frames,
     * which the transport treats as permanent and never retries. A
     * count-only cap cannot prevent that: 32 long URLs exceed 8 KB on their
     * own, so a site with deep paths would lose its footage rather than lose
     * a few route entries.
     */
    it("caps the BYTES it will carry, so long URLs cannot blow the envelope", (): void => {
      const chunker: Chunker = makeChunker();

      const longPath: string = "a".repeat(400);

      for (let index: number = 0; index < 32; index++) {
        chunker.addRoute(`https://shop.example.com/${longPath}/${index}`);
      }

      chunker.add(event());
      chunker.close(false);

      const routes: Array<string> = chunks[0]?.routes ?? [];
      const bytes: number = routes.reduce(
        (total: number, route: string): number => {
          return total + route.length;
        },
        0,
      );

      /* Well inside the parser's 8 KB envelope ceiling. */
      expect(bytes).toBeLessThanOrEqual(2 * 1024);
      expect(routes.length).toBeGreaterThan(0);
      expect(routes.length).toBeLessThan(32);
    });

    it("does not double-count the bytes of a route it already holds", (): void => {
      const chunker: Chunker = makeChunker();

      for (let index: number = 0; index < 50; index++) {
        chunker.addRoute("https://shop.example.com/same");
      }

      chunker.addRoute("https://shop.example.com/other");
      chunker.add(event());
      chunker.close(false);

      expect(chunks[0]?.routes).toEqual([
        "https://shop.example.com/same",
        "https://shop.example.com/other",
      ]);
    });

    it("is present on the empty final chunk too", (): void => {
      const chunker: Chunker = makeChunker();

      chunker.addRoute("https://shop.example.com/checkout");
      chunker.close(true);

      const finalChunk: PendingChunk | undefined = chunks[chunks.length - 1];

      expect(finalChunk?.isFinal).toBe(true);
      expect(finalChunk?.routes).toEqual(["https://shop.example.com/checkout"]);
    });
  });

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

  /*
   * Hitting the cap used to be completely silent: add() and close() both
   * returned early, so events were discarded with no droppedEvents increment,
   * no fidelity notice and no final chunk. The server then sealed the session
   * as idle-timeout ten minutes later and the viewer was shown a recording
   * that simply stops.
   */
  describe("per-session chunk cap", (): void => {
    const fillToCap: (chunker: Chunker) => void = (chunker: Chunker): void => {
      for (let i: number = 0; i < 600; i++) {
        chunker.add(event({ bytes: 10 }));
      }
    };

    it("discloses the truncation instead of going silent", (): void => {
      const chunker: Chunker = makeChunker(10);

      fillToCap(chunker);

      expect(chunker.hasReachedSessionChunkCap()).toBe(true);
      expect(chunker.hasEmittedTruncation()).toBe(true);

      const last: PendingChunk | undefined = chunks[chunks.length - 1];

      expect(last?.isFinal).toBe(true);
      expect(last?.payload).toBe("[]");
      expect(last?.fidelityNotices).toContain(SESSION_REPLAY_TRUNCATED_NOTICE);
    });

    it("emits the disclosure exactly once and then tells the recorder to stop", (): void => {
      const chunker: Chunker = makeChunker(10);

      fillToCap(chunker);

      const afterCap: number = chunks.length;

      /* Everything past the cap, including a terminal flush, is a no-op. */
      chunker.add(event({ bytes: 10 }));
      chunker.close(false);
      chunker.close(true);

      expect(chunks.length).toBe(afterCap);
      expect(truncationCallbacks).toBe(1);
    });

    /*
     * A recorder that silently drops events is indistinguishable from a quiet
     * user, so it has to tell on itself.
     */
    it("counts the events it discarded past the cap", (): void => {
      const chunker: Chunker = makeChunker(10);

      fillToCap(chunker);

      expect(chunker.getDroppedEventCount()).toBeGreaterThan(0);
    });

    it("sends the 480 real chunks plus one disclosure and no more", (): void => {
      const chunker: Chunker = makeChunker(10);

      fillToCap(chunker);

      expect(chunks.length).toBe(481);
      expect(chunker.getClosedChunkCount()).toBe(480);
    });
  });
});

/*
 * Byte accounting and splitting.
 *
 * Everything here used to count String.length, which is UTF-16 code UNITS.
 * The wire, the 2 MiB request cap and the keepalive quota are counted in
 * UTF-8 BYTES, and - worse - slicing an oversized snapshot by code unit could
 * cut a surrogate pair in half. Each part is UTF-8 encoded independently
 * before it goes on the wire, so both halves of a broken pair became U+FFFD
 * and the server's reassembled snapshot was silently corrupted.
 */
describe("utf8ByteLength", (): void => {
  it("counts ASCII as one byte per character", (): void => {
    expect(utf8ByteLength("")).toBe(0);
    expect(utf8ByteLength('{"a":1}')).toBe(7);
  });

  it("agrees with TextEncoder on every width", (): void => {
    const samples: Array<string> = [
      "plain",
      "café",
      "naïve résumé",
      "日本語のページ",
      "emoji 👨‍👩‍👧‍👦 family",
      "𝄞 clef",
      '{"text":"税込 1,000円 🎉"}',
    ];

    for (const sample of samples) {
      expect(utf8ByteLength(sample)).toBe(
        new TextEncoder().encode(sample).length,
      );
    }
  });

  /* A lone surrogate is what a broken slice produces; it encodes as U+FFFD. */
  it("counts a lone surrogate the way TextEncoder does", (): void => {
    const lone: string = "\ud83d";

    expect(utf8ByteLength(lone)).toBe(new TextEncoder().encode(lone).length);
  });
});

describe("splitByUtf8Bytes", (): void => {
  it("never cuts a surrogate pair in half", (): void => {
    /* Ten ASCII, one emoji, ten ASCII - the exact shape that used to corrupt. */
    const body: string = `${"x".repeat(10)}😀${"y".repeat(10)}`;

    for (let limit: number = 4; limit <= 24; limit++) {
      const parts: Array<string> = splitByUtf8Bytes(body, limit);

      /* Round-tripping each part independently must reproduce the input. */
      const decoder: TextDecoder = new TextDecoder();
      const rejoined: string = parts
        .map((part: string): string => {
          return decoder.decode(new TextEncoder().encode(part));
        })
        .join("");

      expect(rejoined).toBe(body);
      expect(rejoined).not.toContain("�");
    }
  });

  it("keeps every part inside the byte budget", (): void => {
    const body: string = "日本語のページ".repeat(20);
    const parts: Array<string> = splitByUtf8Bytes(body, 32);

    for (const part of parts) {
      expect(utf8ByteLength(part)).toBeLessThanOrEqual(32);
    }

    expect(parts.join("")).toBe(body);
  });

  it("returns one part when the whole string fits", (): void => {
    expect(splitByUtf8Bytes("short", 1000)).toEqual(["short"]);
    expect(splitByUtf8Bytes("", 1000)).toEqual([""]);
  });
});

describe("Chunker oversized non-ASCII snapshot", (): void => {
  const SESSION_START: number = 1_700_000_000_000;

  it("splits an emoji-bearing snapshot without corrupting it", (): void => {
    const chunks: Array<PendingChunk> = [];

    const chunker: Chunker = new Chunker({
      sessionStartUnixMs: SESSION_START,
      sink: (chunk: PendingChunk): void => {
        chunks.push(chunk);
      },
      maxPayloadBytes: 40,
    });

    const big: string = `{"type":2,"data":"${"😀".repeat(60)}"}`;

    chunker.add({
      json: big,
      bytes: utf8ByteLength(big),
      timestampMs: SESSION_START + 10,
      isCheckout: true,
      type: 2,
    });

    expect(chunks.length).toBeGreaterThan(1);

    const decoder: TextDecoder = new TextDecoder();
    const rejoined: string = chunks
      .map((chunk: PendingChunk): string => {
        /* Exactly what the wire does to each part: encode it on its own. */
        return decoder.decode(new TextEncoder().encode(chunk.payload));
      })
      .join("");

    expect(rejoined).toBe(`[${big}]`);
    expect(rejoined).not.toContain("�");
    expect(JSON.parse(rejoined)).toHaveLength(1);
  });
});
