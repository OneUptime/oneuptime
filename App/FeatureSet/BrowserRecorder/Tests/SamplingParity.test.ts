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
