import SessionSampling from "Common/Utils/Rum/SessionSampling";
import SessionId from "../src/SessionId";

/*
 * The recorder and the ingest gate must reach the SAME sampling verdict for a
 * given session id.
 *
 * If they disagree the failure is silent and expensive: the browser records
 * and uploads a session the gate then discards, so the customer pays the
 * bandwidth, the end user is recorded for nothing, and the engineer looking
 * for the recording finds an empty list with no error anywhere.
 *
 * The decision is therefore a pure function of the session id, in a module
 * that is bundled into the browser AND imported by the server, and this test
 * pins that property rather than re-implementing the hash.
 */

describe("sampling parity", (): void => {
  /*
   * Known-answer vectors for the hash both sides depend on.
   *
   * The rest of this file only proves that SessionSampling is internally
   * consistent - determinism, endpoints, distribution - which a reimplemented
   * hash on either side of the wire would also satisfy. These vectors pin the
   * actual output, so any change to fnv1a32, to the bucket count, or to a
   * server-side reimplementation of either fails HERE rather than showing up
   * as a customer paying to upload sessions the ingest gate then discards.
   *
   * The gate itself (App/FeatureSet/Telemetry/Services/
   * SessionReplayIngestService.ts) calls this same module. It cannot be
   * imported into this suite - it is server code, and this package's tsconfig
   * has no Node types and no path alias reaching outside the Common Rum
   * modules.
   */
  describe("shared hash vectors", (): void => {
    const VECTORS: Array<{ id: string; hash: number; bucket: number }> = [
      { id: "", hash: 2166136261, bucket: 6261 },
      { id: "a", hash: 3826002220, bucket: 2220 },
      { id: "oneuptime", hash: 1539883643, bucket: 3643 },
      {
        id: "9f8e7d6c5b4a39281706f5e4d3c2b1a0",
        hash: 215457021,
        bucket: 7021,
      },
      {
        id: "00000000000000000000000000000000",
        hash: 4039664709,
        bucket: 4709,
      },
      {
        id: "ffffffffffffffffffffffffffffffff",
        hash: 3985802821,
        bucket: 2821,
      },
      {
        id: "0123456789abcdef0123456789abcdef",
        hash: 2261798325,
        bucket: 8325,
      },
    ];

    for (const vector of VECTORS) {
      it(`hashes ${JSON.stringify(vector.id)} to a fixed bucket`, (): void => {
        expect(SessionSampling.fnv1a32(vector.id)).toBe(vector.hash);
        expect(SessionSampling.getBucket(vector.id)).toBe(vector.bucket);
      });
    }

    /*
     * The verdict is `bucket < round(percentage * 100)`. Pinned as a whole so
     * a change to the rounding rule - not just to the hash - is caught too.
     */
    it("turns a fixed bucket into a fixed verdict", (): void => {
      const id: string = "9f8e7d6c5b4a39281706f5e4d3c2b1a0";

      /* bucket 7021: inside 71%, outside 70%. */
      expect(SessionSampling.isSampled(id, 70)).toBe(false);
      expect(SessionSampling.isSampled(id, 71)).toBe(true);
      expect(SessionSampling.isSampled(id, 70.22)).toBe(true);
    });
  });

  it("is a pure function of the session id", (): void => {
    const sessionId: string = "9f8e7d6c5b4a39281706f5e4d3c2b1a0";

    const first: boolean = SessionSampling.isSampled(sessionId, 42);
    const second: boolean = SessionSampling.isSampled(sessionId, 42);

    expect(first).toBe(second);
  });

  it("never samples at 0 and always samples at 100", (): void => {
    for (let i: number = 0; i < 50; i++) {
      const sessionId: string = SessionId.generateId();

      expect(SessionSampling.isSampled(sessionId, 0)).toBe(false);
      expect(SessionSampling.isSampled(sessionId, 100)).toBe(true);
    }
  });

  /*
   * The ids this test feeds in are produced by the recorder's own generator,
   * so the distribution check is against real inputs rather than against a
   * synthetic alphabet the hash might happen to like.
   */
  it("distributes recorder-generated ids close to the requested rate", (): void => {
    const total: number = 4000;
    let sampled: number = 0;

    for (let i: number = 0; i < total; i++) {
      if (SessionSampling.isSampled(SessionId.generateId(), 25)) {
        sampled++;
      }
    }

    const rate: number = (sampled / total) * 100;

    expect(rate).toBeGreaterThan(20);
    expect(rate).toBeLessThan(30);
  });

  it("is monotonic in the percentage", (): void => {
    const ids: Array<string> = [];

    for (let i: number = 0; i < 200; i++) {
      ids.push(SessionId.generateId());
    }

    const countAt: (percentage: number) => number = (
      percentage: number,
    ): number => {
      return ids.filter((id: string): boolean => {
        return SessionSampling.isSampled(id, percentage);
      }).length;
    };

    expect(countAt(10)).toBeLessThanOrEqual(countAt(50));
    expect(countAt(50)).toBeLessThanOrEqual(countAt(90));
  });

  it("clamps a nonsense percentage instead of throwing", (): void => {
    const sessionId: string = SessionId.generateId();

    expect(SessionSampling.isSampled(sessionId, Number.NaN)).toBe(false);
    expect(SessionSampling.isSampled(sessionId, -5)).toBe(false);
    expect(SessionSampling.isSampled(sessionId, 5000)).toBe(true);
  });
});
