import {
  getSessionReplayRetentionDate,
  resolveSessionReplayRetentionInDays,
} from "../../../../Server/Utils/SessionReplay/SessionReplayRetention";
import OneUptimeDate from "../../../../Types/Date";
import {
  DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS,
  SESSION_REPLAY_ALLOWED_RETENTION_DAYS,
} from "../../../../Types/Rum/SessionReplay";
import { resolveTelemetryRetentionInDays } from "../../../../Types/Telemetry/TelemetryRetentionConfig";
import { describe, expect, it } from "@jest/globals";

describe("resolveSessionReplayRetentionInDays", () => {
  it("defaults to 7 days, not the 15 the other pillars use", () => {
    expect(resolveSessionReplayRetentionInDays({})).toBe(7);
    expect(DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS).toBe(7);
  });

  it("prefers the application's explicit replay retention", () => {
    expect(
      resolveSessionReplayRetentionInDays({
        applicationRetentionInDays: 30,
        applicationConfig: { sessionReplay: { default: 14 } },
        projectConfig: { sessionReplay: { default: 90 } },
      }),
    ).toBe(30);
  });

  it("falls back to the application pillar, then the project pillar", () => {
    expect(
      resolveSessionReplayRetentionInDays({
        applicationConfig: { sessionReplay: { default: 14 } },
        projectConfig: { sessionReplay: { default: 90 } },
      }),
    ).toBe(14);

    expect(
      resolveSessionReplayRetentionInDays({
        projectConfig: { sessionReplay: { default: 90 } },
      }),
    ).toBe(90);
  });

  it("ignores non-positive, null and undefined candidates", () => {
    expect(
      resolveSessionReplayRetentionInDays({
        applicationRetentionInDays: 0,
        applicationConfig: { sessionReplay: { default: -5 } },
        projectConfig: { sessionReplay: { default: null } },
      }),
    ).toBe(7);

    expect(
      resolveSessionReplayRetentionInDays({
        applicationRetentionInDays: null,
        applicationConfig: null,
        projectConfig: null,
      }),
    ).toBe(7);
  });

  it("does not read another pillar's retention", () => {
    /*
     * The whole point of the dedicated resolver: a project or application
     * configured for long log/trace retention must not drag replay along
     * with it.
     */
    expect(
      resolveSessionReplayRetentionInDays({
        applicationConfig: {
          logs: { default: 90 },
          traces: { default: 90 },
          metrics: { default: 90 },
          profiles: { default: 90 },
        },
        projectConfig: {
          logs: { default: 90 },
          traces: { default: 90 },
        },
      }),
    ).toBe(7);
  });

  it("clamps to the allowed closed set, rounding up", () => {
    /*
     * Each distinct value becomes its own partition per ingest day under
     * expiry-based partitioning, so the set has to stay closed. Rounding
     * up never silently destroys evidence the customer asked to keep.
     */
    expect(SESSION_REPLAY_ALLOWED_RETENTION_DAYS).toEqual([1, 7, 14, 30, 90]);

    const clamped: Array<number> = [2, 8, 15, 31, 45].map(
      (days: number): number => {
        return resolveSessionReplayRetentionInDays({
          applicationRetentionInDays: days,
        });
      },
    );

    expect(clamped).toEqual([7, 14, 30, 90, 90]);
  });

  it("clamps a mis-set value down to the maximum instead of honouring it", () => {
    expect(
      resolveSessionReplayRetentionInDays({
        applicationRetentionInDays: 900,
      }),
    ).toBe(90);
  });

  it("only ever returns a value from the allowed set", () => {
    for (let days: number = -5; days <= 200; days++) {
      const resolved: number = resolveSessionReplayRetentionInDays({
        applicationRetentionInDays: days,
      });

      expect(SESSION_REPLAY_ALLOWED_RETENTION_DAYS).toContain(resolved);
    }
  });

  it("differs from resolveTelemetryRetentionInDays on the case that motivated it", () => {
    /*
     * An application with 90-day trace retention and nothing replay-specific
     * configured. The generic resolver hands back 90 because
     * serviceRetentionInDays outranks the project pillar; the replay
     * resolver hands back 7. If this assertion ever fails, someone has
     * changed the generic candidate order and the two can be reunified.
     */
    expect(
      resolveTelemetryRetentionInDays({
        pillar: "sessionReplay",
        serviceRetentionInDays: 90,
      }),
    ).toBe(90);

    expect(resolveSessionReplayRetentionInDays({})).toBe(7);
  });
});

describe("getSessionReplayRetentionDate", () => {
  it("derives the expiry from the session start, so a session expires atomically", () => {
    /*
     * Chunks of one session can arrive hours apart. Deriving from the
     * shared, server-clamped session start is what stops the same
     * session's chunks landing in different expiry partitions and being
     * TTL-dropped halfway through.
     */
    const sessionStart: Date = OneUptimeDate.fromString(
      "2026-01-01T00:00:00.000Z",
    );

    const retentionDate: Date = getSessionReplayRetentionDate({
      serverClampedSessionStart: sessionStart,
      retentionInDays: 7,
    });

    expect(
      OneUptimeDate.getDaysBetweenTwoDates(sessionStart, retentionDate),
    ).toBe(7);
  });

  it("gives every chunk of a session the same expiry regardless of when it arrived", () => {
    /*
     * The arrival time is moved, not the arguments. Calling the function
     * twice with identical arguments would only assert that it is a
     * function; what has to hold is that the wall clock at ingest does not
     * enter the arithmetic, because a chunk buffered offline and flushed
     * hours later must land in the same expiry partition as the first
     * chunk of its session.
     */
    const sessionStart: Date = OneUptimeDate.fromString(
      "2026-01-01T00:00:00.000Z",
    );

    jest.useFakeTimers();

    try {
      jest.setSystemTime(
        OneUptimeDate.fromString("2026-01-01T00:00:05.000Z").getTime(),
      );

      const firstChunk: Date = getSessionReplayRetentionDate({
        serverClampedSessionStart: sessionStart,
        retentionInDays: 14,
      });

      /* Same session, flushed from an offline buffer nine hours later. */
      jest.setSystemTime(
        OneUptimeDate.fromString("2026-01-01T09:13:00.000Z").getTime(),
      );

      const lateFlush: Date = getSessionReplayRetentionDate({
        serverClampedSessionStart: sessionStart,
        retentionInDays: 14,
      });

      expect(lateFlush.getTime()).toBe(firstChunk.getTime());

      /* And it really is session start + 14 days, not clock + 14 days. */
      expect(
        OneUptimeDate.getDaysBetweenTwoDates(sessionStart, lateFlush),
      ).toBe(14);
    } finally {
      jest.useRealTimers();
    }
  });

  it("moves the expiry when the session start moves", () => {
    /*
     * The negative of the test above: an expiry that ignored its input
     * entirely would pass that one too.
     */
    const earlier: Date = getSessionReplayRetentionDate({
      serverClampedSessionStart: OneUptimeDate.fromString(
        "2026-01-01T00:00:00.000Z",
      ),
      retentionInDays: 14,
    });

    const later: Date = getSessionReplayRetentionDate({
      serverClampedSessionStart: OneUptimeDate.fromString(
        "2026-01-03T00:00:00.000Z",
      ),
      retentionInDays: 14,
    });

    expect(OneUptimeDate.getDaysBetweenTwoDates(earlier, later)).toBe(2);
  });
});
