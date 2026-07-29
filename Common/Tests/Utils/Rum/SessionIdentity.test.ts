import SessionIdentity, {
  SessionRotationReason,
  StoredSessionState,
} from "../../../Utils/Rum/SessionIdentity";

const NOW: number = 1_700_000_000_000;
const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

const makeState: (overrides?: Partial<StoredSessionState>) => StoredSessionState =
  (overrides?: Partial<StoredSessionState>): StoredSessionState => {
    return {
      sessionId: "3f1a9c7e5b2d4801f6a3c9e7b1d5028f",
      sessionStartUnixMs: NOW - 5 * MINUTE,
      lastActivityUnixMs: NOW - MINUTE,
      ...overrides,
    };
  };

describe("SessionIdentity", () => {
  describe("shouldRotateSession", () => {
    it("rotates when there is no stored session", () => {
      const decision: ReturnType<typeof SessionIdentity.shouldRotateSession> =
        SessionIdentity.shouldRotateSession(null, NOW);

      expect(decision.shouldRotate).toBe(true);
      expect(decision.reason).toBe(SessionRotationReason.New);
    });

    it("keeps an active session", () => {
      expect(
        SessionIdentity.shouldRotateSession(makeState(), NOW).shouldRotate,
      ).toBe(false);
    });

    it("rotates after the idle window elapses", () => {
      /*
       * A single "session" that spans a lunch break is not a session, and
       * stitching one produces a recording with a 40-minute dead zone.
       */
      const state: StoredSessionState = makeState({
        sessionStartUnixMs: NOW - 40 * MINUTE,
        lastActivityUnixMs: NOW - 31 * MINUTE,
      });

      const decision: ReturnType<typeof SessionIdentity.shouldRotateSession> =
        SessionIdentity.shouldRotateSession(state, NOW);

      expect(decision.shouldRotate).toBe(true);
      expect(decision.reason).toBe(SessionRotationReason.Idle);
    });

    it("does not rotate one millisecond before the idle boundary", () => {
      const state: StoredSessionState = makeState({
        sessionStartUnixMs: NOW - 40 * MINUTE,
        lastActivityUnixMs: NOW - (30 * MINUTE - 1),
      });

      expect(
        SessionIdentity.shouldRotateSession(state, NOW).shouldRotate,
      ).toBe(false);
    });

    it("rotates exactly at the idle boundary", () => {
      const state: StoredSessionState = makeState({
        sessionStartUnixMs: NOW - 40 * MINUTE,
        lastActivityUnixMs: NOW - 30 * MINUTE,
      });

      expect(SessionIdentity.shouldRotateSession(state, NOW).reason).toBe(
        SessionRotationReason.Idle,
      );
    });

    it("rotates at the absolute duration cap even while still active", () => {
      /*
       * A tab left open for days would otherwise accumulate an unbounded
       * chunk sequence under a single sort-key prefix.
       */
      const state: StoredSessionState = makeState({
        sessionStartUnixMs: NOW - 5 * HOUR,
        lastActivityUnixMs: NOW - 1000,
      });

      const decision: ReturnType<typeof SessionIdentity.shouldRotateSession> =
        SessionIdentity.shouldRotateSession(state, NOW);

      expect(decision.shouldRotate).toBe(true);
      expect(decision.reason).toBe(SessionRotationReason.DurationCap);
    });

    it("prefers the idle reason when both conditions hold", () => {
      const state: StoredSessionState = makeState({
        sessionStartUnixMs: NOW - 5 * HOUR,
        lastActivityUnixMs: NOW - 2 * HOUR,
      });

      expect(SessionIdentity.shouldRotateSession(state, NOW).reason).toBe(
        SessionRotationReason.Idle,
      );
    });

    it("rotates on corrupt stored state rather than trusting it", () => {
      /*
       * Trusting inconsistent state can attribute one user's chunks to
       * another user's session id. A fresh session loses a little context;
       * a mis-attributed session is a privacy incident.
       */
      const corruptStates: Array<StoredSessionState> = [
        makeState({ sessionId: "" }),
        makeState({ sessionStartUnixMs: Number.NaN }),
        makeState({ lastActivityUnixMs: Number.NaN }),
        makeState({ sessionStartUnixMs: 0 }),
        makeState({ lastActivityUnixMs: -1 }),
        /* Activity before the session started. */
        makeState({
          sessionStartUnixMs: NOW - MINUTE,
          lastActivityUnixMs: NOW - 10 * MINUTE,
        }),
        /* Stamped far in the future: clock jump or tampering. */
        makeState({ sessionStartUnixMs: NOW + HOUR }),
      ];

      for (const state of corruptStates) {
        const decision: ReturnType<typeof SessionIdentity.shouldRotateSession> =
          SessionIdentity.shouldRotateSession(state, NOW);

        expect(decision.shouldRotate).toBe(true);
        expect(decision.reason).toBe(SessionRotationReason.Corrupt);
      }
    });

    it("tolerates small forward skew from a corrected device clock", () => {
      const state: StoredSessionState = makeState({
        sessionStartUnixMs: NOW + 30 * 1000,
        lastActivityUnixMs: NOW + 30 * 1000,
      });

      expect(
        SessionIdentity.shouldRotateSession(state, NOW).shouldRotate,
      ).toBe(false);
    });
  });

  describe("clampSessionStart", () => {
    it("passes through a sane client timestamp", () => {
      expect(SessionIdentity.clampSessionStart(NOW - MINUTE, NOW)).toBe(
        NOW - MINUTE,
      );
    });

    it("clamps a future client clock to the server clock", () => {
      /*
       * The clamped value lands in the partition key and the TTL
       * expression. A device clock set to 2035 would otherwise create a
       * partition that never expires.
       */
      const yearAhead: number = NOW + 365 * 24 * HOUR;

      expect(SessionIdentity.clampSessionStart(yearAhead, NOW)).toBe(NOW);
    });

    it("clamps an ancient client clock forward to the acceptance window", () => {
      /*
       * A device clock set to 2015 would otherwise produce a row whose
       * retentionDate is already past, deleting it on arrival.
       */
      const decadeAgo: number = NOW - 10 * 365 * 24 * HOUR;

      expect(SessionIdentity.clampSessionStart(decadeAgo, NOW)).toBe(
        NOW - 4 * HOUR,
      );
    });

    it("falls back to the server clock for non-finite input", () => {
      expect(SessionIdentity.clampSessionStart(Number.NaN, NOW)).toBe(NOW);
    });

    it("always returns a value inside the acceptance window", () => {
      const inputs: Array<number> = [
        0,
        -1,
        NOW,
        NOW - HOUR,
        NOW + HOUR,
        Number.MAX_SAFE_INTEGER,
        Number.MIN_SAFE_INTEGER,
      ];

      for (const input of inputs) {
        const clamped: number = SessionIdentity.clampSessionStart(input, NOW);

        expect(clamped).toBeLessThanOrEqual(NOW);
        expect(clamped).toBeGreaterThanOrEqual(NOW - 4 * HOUR);
      }
    });
  });

  describe("getClockSkewMs", () => {
    it("is positive when the client clock runs ahead", () => {
      expect(SessionIdentity.getClockSkewMs(NOW + 5000, NOW)).toBe(5000);
    });

    it("is negative when the client clock lags", () => {
      expect(SessionIdentity.getClockSkewMs(NOW - 5000, NOW)).toBe(-5000);
    });

    it("returns zero rather than NaN for unusable input", () => {
      expect(SessionIdentity.getClockSkewMs(Number.NaN, NOW)).toBe(0);
      expect(SessionIdentity.getClockSkewMs(NOW, Number.NaN)).toBe(0);
    });
  });

  describe("clampRetentionDays", () => {
    const allowed: Array<number> = [1, 7, 14, 30, 90];

    it("passes through an exact allowed value", () => {
      for (const days of allowed) {
        expect(SessionIdentity.clampRetentionDays(days, allowed, 7)).toBe(days);
      }
    });

    it("rounds UP to the next allowed value", () => {
      /*
       * Rounding up is deliberate: silently shortening a customer's
       * configured retention destroys evidence they expected to keep,
       * whereas keeping it a little longer only costs disk.
       */
      expect(SessionIdentity.clampRetentionDays(2, allowed, 7)).toBe(7);
      expect(SessionIdentity.clampRetentionDays(8, allowed, 7)).toBe(14);
      expect(SessionIdentity.clampRetentionDays(31, allowed, 7)).toBe(90);
    });

    it("caps at the largest allowed value", () => {
      expect(SessionIdentity.clampRetentionDays(365, allowed, 7)).toBe(90);
    });

    it("falls back for non-positive or non-finite input", () => {
      expect(SessionIdentity.clampRetentionDays(0, allowed, 7)).toBe(7);
      expect(SessionIdentity.clampRetentionDays(-5, allowed, 7)).toBe(7);
      expect(SessionIdentity.clampRetentionDays(Number.NaN, allowed, 7)).toBe(7);
    });

    it("falls back when the allowed set is empty", () => {
      expect(SessionIdentity.clampRetentionDays(30, [], 7)).toBe(7);
    });

    it("handles an unsorted allowed set", () => {
      expect(SessionIdentity.clampRetentionDays(8, [90, 1, 30, 7, 14], 7)).toBe(
        14,
      );
    });

    it("only ever returns a member of the allowed set", () => {
      /*
       * This is the load-bearing property: each distinct retention value
       * creates its own ClickHouse partition per ingest day, so an
       * unclamped value is a partition-count problem, not just a policy one.
       */
      for (let days: number = -5; days <= 400; days++) {
        expect(allowed).toContain(
          SessionIdentity.clampRetentionDays(days, allowed, 7),
        );
      }
    });
  });
});
