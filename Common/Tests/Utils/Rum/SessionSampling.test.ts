import SessionSampling from "../../../Utils/Rum/SessionSampling";

describe("SessionSampling", () => {
  describe("fnv1a32", () => {
    it("returns the published FNV-1a 32-bit vectors", () => {
      /*
       * Reference vectors from the FNV specification. If these drift, the
       * server and the browser recorder will disagree about which sessions
       * are sampled, and sessions will be half-recorded.
       */
      expect(SessionSampling.fnv1a32("")).toBe(0x811c9dc5);
      expect(SessionSampling.fnv1a32("a")).toBe(0xe40c292c);
      expect(SessionSampling.fnv1a32("foobar")).toBe(0xbf9cf968);
    });

    it("always returns an unsigned 32-bit integer", () => {
      /*
       * The multiply must stay in integer space. A plain `*` overflows to
       * a float and silently stops distributing, which would not fail any
       * naive equality test — so assert the range over many inputs.
       */
      for (let i: number = 0; i < 2000; i++) {
        const hash: number = SessionSampling.fnv1a32(`session-${i}`);

        expect(Number.isInteger(hash)).toBe(true);
        expect(hash).toBeGreaterThanOrEqual(0);
        expect(hash).toBeLessThanOrEqual(0xffffffff);
      }
    });

    it("is stable across calls", () => {
      expect(SessionSampling.fnv1a32("abc123")).toBe(
        SessionSampling.fnv1a32("abc123"),
      );
    });
  });

  describe("getBucket", () => {
    it("returns a bucket in [0, 10000)", () => {
      for (let i: number = 0; i < 2000; i++) {
        const bucket: number = SessionSampling.getBucket(`s-${i}`);

        expect(bucket).toBeGreaterThanOrEqual(0);
        expect(bucket).toBeLessThan(10000);
      }
    });
  });

  describe("isSampled", () => {
    it("samples nothing at 0 percent", () => {
      for (let i: number = 0; i < 500; i++) {
        expect(SessionSampling.isSampled(`session-${i}`, 0)).toBe(false);
      }
    });

    it("samples everything at 100 percent", () => {
      for (let i: number = 0; i < 500; i++) {
        expect(SessionSampling.isSampled(`session-${i}`, 100)).toBe(true);
      }
    });

    it("is deterministic for the same session id", () => {
      const sessionId: string = "3f1a9c7e5b2d4801f6a3c9e7b1d5028f";

      const first: boolean = SessionSampling.isSampled(sessionId, 37.5);

      for (let i: number = 0; i < 50; i++) {
        expect(SessionSampling.isSampled(sessionId, 37.5)).toBe(first);
      }
    });

    it("lands within a couple of points of the requested rate over a large population", () => {
      /*
       * The whole point of hashing rather than counting is that the rate
       * emerges from the distribution. A skewed hash would still be
       * deterministic and would still pass the tests above, so the
       * distribution itself has to be asserted.
       */
      const population: number = 20000;

      for (const percentage of [1, 10, 25, 50, 90]) {
        let sampled: number = 0;

        for (let i: number = 0; i < population; i++) {
          if (SessionSampling.isSampled(`sess-${percentage}-${i}`, percentage)) {
            sampled++;
          }
        }

        const observed: number = (sampled / population) * 100;

        expect(Math.abs(observed - percentage)).toBeLessThan(2);
      }
    });

    it("is monotonic in the sample percentage", () => {
      /*
       * Raising the rate must never *unsample* a session that was already
       * in. Anything else means a customer who increases sampling loses
       * recordings they were previously getting.
       */
      const sessionIds: Array<string> = Array.from(
        { length: 500 },
        (_unused: unknown, i: number): string => {
          return `mono-${i}`;
        },
      );

      for (const sessionId of sessionIds) {
        let wasSampled: boolean = false;

        for (const percentage of [0, 5, 10, 25, 50, 75, 100]) {
          const isSampled: boolean = SessionSampling.isSampled(
            sessionId,
            percentage,
          );

          if (wasSampled) {
            expect(isSampled).toBe(true);
          }

          wasSampled = isSampled;
        }
      }
    });

    it("clamps out-of-range percentages instead of throwing", () => {
      expect(SessionSampling.isSampled("x", -10)).toBe(false);
      expect(SessionSampling.isSampled("x", 1000)).toBe(true);
    });

    it("fails closed on a non-finite percentage", () => {
      /*
       * A garbage sample rate must record nobody, not everybody. NaN and
       * Infinity both mean "this config is broken", and for a feature that
       * records real end users' screens the safe reading of a broken
       * config is zero, not 100%.
       */
      expect(SessionSampling.isSampled("x", Number.NaN)).toBe(false);
      expect(SessionSampling.isSampled("x", Number.POSITIVE_INFINITY)).toBe(
        false,
      );
      expect(SessionSampling.isSampled("x", Number.NEGATIVE_INFINITY)).toBe(
        false,
      );
    });
  });

  describe("clampPercentage", () => {
    it("clamps to the 0..100 range", () => {
      expect(SessionSampling.clampPercentage(-1)).toBe(0);
      expect(SessionSampling.clampPercentage(0)).toBe(0);
      expect(SessionSampling.clampPercentage(42.5)).toBe(42.5);
      expect(SessionSampling.clampPercentage(100)).toBe(100);
      expect(SessionSampling.clampPercentage(101)).toBe(100);
    });

    it("treats NaN as zero so a bad config cannot throw on the ingest path", () => {
      expect(SessionSampling.clampPercentage(Number.NaN)).toBe(0);
    });
  });
});
