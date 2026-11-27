import { CLOUD_RESOURCE_DISCONNECTED_MINUTES } from "../../../../Server/Services/CloudResourceService";
import ReceivingCoverage, {
  RECEIVING_LEDGER_CACHE_HORIZON_MS,
  TELEMETRY_EVALUATION_MAX_DEFERRAL_MS,
  TelemetryEvaluationPlan,
} from "../../../../Server/Utils/Telemetry/ReceivingCoverage";
import InstanceReceivingPeriodService, {
  ReceivingLedgerRead,
} from "../../../../Server/Services/InstanceReceivingPeriodService";
import TelemetryIngestBacklog from "../../../../Server/Utils/Telemetry/TelemetryIngestBacklog";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import logger from "../../../../Server/Utils/Logger";
import {
  MAX_RECEIVING_LOOKBACK_EXTENSION_MS,
  ReceivingGap,
  ReceivingGapReason,
  ReceivingPeriod,
} from "../../../../Utils/Telemetry/ReceivingGaps";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * Issue #2825: what every silence verdict asks before it holds silence
 * against a resource. The ledger and the queue are stood in for; the clock is
 * passed in, never read.
 */

const SECOND: number = 1_000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

const NOW: Date = new Date("2026-10-09T12:00:00.000Z");

function ago(ms: number, from: Date = NOW): Date {
  return new Date(from.getTime() - ms);
}

function period(startedAgoMs: number, lastAgoMs: number): ReceivingPeriod {
  return { startedAt: ago(startedAgoMs), lastReceivingAt: ago(lastAgoMs) };
}

let readLedger: SpyInstance<typeof InstanceReceivingPeriodService.readLedger>;
let oldestWaiting: SpyInstance<
  typeof TelemetryIngestBacklog.getOldestWaitingSince
>;

function givenLedger(periods: Array<ReceivingPeriod>): void {
  readLedger.mockImplementation(async (): Promise<ReceivingLedgerRead> => {
    const latest: number | null =
      periods.length > 0
        ? Math.max(
            ...periods.map((p: ReceivingPeriod) => {
              return p.lastReceivingAt.getTime();
            }),
          )
        : null;
    return {
      periods,
      latestReceivingAt: latest === null ? null : new Date(latest),
      now: NOW,
    };
  });
}

function givenBacklogSince(agoMs: number | null): void {
  oldestWaiting.mockResolvedValue(agoMs === null ? null : ago(agoMs));
}

beforeEach(() => {
  ReceivingCoverage.clearCache();
  jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
  readLedger = jest.spyOn(InstanceReceivingPeriodService, "readLedger");
  oldestWaiting = jest.spyOn(TelemetryIngestBacklog, "getOldestWaitingSince");
  givenLedger([period(10 * DAY, 10 * SECOND)]);
  givenBacklogSince(null);
});

afterEach(() => {
  ReceivingCoverage.clearCache();
  jest.restoreAllMocks();
});

// Down from 30 to 18 minutes ago; agents reconnecting until 16 minutes ago.
const RESTART: Array<ReceivingPeriod> = [
  period(10 * DAY, 30 * MINUTE),
  period(18 * MINUTE, 10 * SECOND),
];

describe("ReceivingCoverage.getGaps", () => {
  test("with OneUptime receiving throughout there are no gaps", async () => {
    expect(
      await ReceivingCoverage.getGaps({
        startsAt: ago(HOUR),
        endsAt: NOW,
        now: NOW,
      }),
    ).toEqual([]);
  });

  test("a restart in the window is the outage plus the reconnect grace", async () => {
    givenLedger(RESTART);
    const gaps: Array<ReceivingGap> = await ReceivingCoverage.getGaps({
      startsAt: ago(HOUR),
      endsAt: NOW,
      now: NOW,
    });
    expect(gaps).toEqual([
      {
        startsAt: ago(30 * MINUTE),
        endsAt: ago(18 * MINUTE),
        reason: ReceivingGapReason.NotReceiving,
      },
      {
        startsAt: ago(18 * MINUTE),
        endsAt: ago(16 * MINUTE),
        reason: ReceivingGapReason.Reconnecting,
      },
    ]);
  });

  test("gaps are clipped to the window asked about", async () => {
    givenLedger(RESTART);
    expect(
      await ReceivingCoverage.getGaps({
        startsAt: ago(20 * MINUTE),
        endsAt: ago(17 * MINUTE),
        now: NOW,
      }),
    ).toEqual([
      {
        startsAt: ago(20 * MINUTE),
        endsAt: ago(18 * MINUTE),
        reason: ReceivingGapReason.NotReceiving,
      },
      {
        startsAt: ago(18 * MINUTE),
        endsAt: ago(17 * MINUTE),
        reason: ReceivingGapReason.Reconnecting,
      },
    ]);
  });

  test("an ingest queue more than a minute behind is catching up, to now", async () => {
    givenBacklogSince(5 * MINUTE);
    expect(
      await ReceivingCoverage.getGaps({
        startsAt: ago(HOUR),
        endsAt: NOW,
        now: NOW,
      }),
    ).toEqual([
      {
        startsAt: ago(5 * MINUTE),
        endsAt: NOW,
        reason: ReceivingGapReason.CatchingUp,
      },
    ]);
  });

  test("a queue within the normal ingest lag is not a gap", async () => {
    givenBacklogSince(45 * SECOND);
    expect(
      await ReceivingCoverage.getGaps({
        startsAt: ago(HOUR),
        endsAt: NOW,
        now: NOW,
      }),
    ).toEqual([]);
  });

  test("the recent horizon is read once and cached; concurrent callers share one read", async () => {
    givenLedger(RESTART);

    await Promise.all(
      Array.from({ length: 10 }, () => {
        return ReceivingCoverage.getGaps({
          startsAt: ago(HOUR),
          endsAt: NOW,
          now: NOW,
        });
      }),
    );
    await ReceivingCoverage.getGaps({
      startsAt: ago(2 * DAY),
      endsAt: ago(DAY),
      now: new Date(NOW.getTime() + 10 * SECOND),
    });

    expect(readLedger).toHaveBeenCalledTimes(1);
    const window: { startsAt: Date; endsAt: Date } = readLedger.mock
      .calls[0]![0] as { startsAt: Date; endsAt: Date };
    expect(NOW.getTime() - window.startsAt.getTime()).toBe(
      RECEIVING_LEDGER_CACHE_HORIZON_MS,
    );
  });

  test("the cache expires after a few seconds, so a restart is seen promptly", async () => {
    await ReceivingCoverage.getGaps({
      startsAt: ago(HOUR),
      endsAt: NOW,
      now: NOW,
    });
    await ReceivingCoverage.getGaps({
      startsAt: ago(HOUR),
      endsAt: NOW,
      now: new Date(NOW.getTime() + 20 * SECOND),
    });

    expect(readLedger).toHaveBeenCalledTimes(2);
  });

  test("a window older than the horizon is read directly, for that window", async () => {
    const startsAt: Date = ago(90 * DAY);
    const endsAt: Date = ago(60 * DAY);

    await ReceivingCoverage.getGaps({ startsAt, endsAt, now: NOW });

    expect(readLedger).toHaveBeenCalledWith({ startsAt, endsAt });
  });

  test("an unreachable ledger means no gaps, logged once a minute at most (fails open)", async () => {
    const errorLog: SpyInstance<typeof logger.error> = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {});
    readLedger.mockRejectedValue(new Error("connection refused"));

    expect(
      await ReceivingCoverage.getGaps({
        startsAt: ago(HOUR),
        endsAt: NOW,
        now: NOW,
      }),
    ).toEqual([]);
    ReceivingCoverage.clearCache();
    expect(
      await ReceivingCoverage.getGaps({
        startsAt: ago(HOUR),
        endsAt: NOW,
        now: NOW,
      }),
    ).toEqual([]);

    expect(errorLog.mock.calls.length).toBeLessThanOrEqual(2);
  });

  test("with no database connection it never asks the ledger", async () => {
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(false);

    expect(
      await ReceivingCoverage.getGaps({
        startsAt: ago(HOUR),
        endsAt: NOW,
        now: NOW,
      }),
    ).toEqual([]);
    expect(readLedger).not.toHaveBeenCalled();
  });

  test("an unreadable queue means no backlog (fails open)", async () => {
    jest.spyOn(logger, "error").mockImplementation(() => {});
    oldestWaiting.mockRejectedValue(new Error("valkey down"));

    expect(
      await ReceivingCoverage.getGaps({
        startsAt: ago(HOUR),
        endsAt: NOW,
        now: NOW,
      }),
    ).toEqual([]);
  });
});

describe("ReceivingCoverage silence measures", () => {
  test("receiving minutes leave out the restart, and agree with the clock without one", async () => {
    expect(
      await ReceivingCoverage.getReceivingMinutes({
        from: ago(40 * MINUTE),
        to: NOW,
        now: NOW,
      }),
    ).toBe(40);

    ReceivingCoverage.clearCache();
    givenLedger(RESTART);

    expect(
      await ReceivingCoverage.getReceivingMinutes({
        from: ago(40 * MINUTE),
        to: NOW,
        now: NOW,
      }),
    ).toBe(26);
  });

  test("receiving minutes read string dates and either order", async () => {
    givenLedger(RESTART);
    expect(
      await ReceivingCoverage.getReceivingMinutes({
        from: NOW.toISOString(),
        to: ago(40 * MINUTE).toISOString(),
        now: NOW,
      }),
    ).toBe(26);
  });

  test("a silence cutoff reaches back past the restart", async () => {
    givenLedger(RESTART);
    expect(
      await ReceivingCoverage.getSilenceCutoff({
        silenceInMinutes: 20,
        now: NOW,
      }),
    ).toEqual(ago(34 * MINUTE));
  });

  test("a silence cutoff with no gaps is the plain cutoff", async () => {
    expect(
      await ReceivingCoverage.getSilenceCutoff({
        silenceInMinutes: 15,
        now: NOW,
      }),
    ).toEqual(ago(15 * MINUTE));
  });

  test("after a three-day outage, a resource that reported until it went down is not silent yet", async () => {
    // Down for three days, back five minutes ago; agents reconnecting until three minutes ago.
    givenLedger([
      period(10 * DAY, 3 * DAY + 5 * MINUTE),
      period(5 * MINUTE, 10 * SECOND),
    ]);

    const cutoff: Date = await ReceivingCoverage.getSilenceCutoff({
      silenceInMinutes: 15,
      now: NOW,
    });

    // Three receiving minutes since the grace; the other twelve come from before the outage.
    expect(cutoff).toEqual(ago(3 * DAY + 5 * MINUTE + 12 * MINUTE));
    const lastReportedBeforeTheOutage: Date = ago(
      3 * DAY + 5 * MINUTE + 30 * SECOND,
    );
    expect(lastReportedBeforeTheOutage.getTime()).toBeGreaterThan(
      cutoff.getTime(),
    );
  });

  test("every sweep's cutoff, even the longest threshold's, is answered from the cached horizon", async () => {
    expect(
      MAX_RECEIVING_LOOKBACK_EXTENSION_MS +
        (CLOUD_RESOURCE_DISCONNECTED_MINUTES + 60) * MINUTE,
    ).toBeLessThan(RECEIVING_LEDGER_CACHE_HORIZON_MS);

    await ReceivingCoverage.getSilenceCutoff({
      silenceInMinutes: CLOUD_RESOURCE_DISCONNECTED_MINUTES,
      now: NOW,
    });
    await ReceivingCoverage.getSilenceCutoff({ silenceInMinutes: 3, now: NOW });

    expect(readLedger).toHaveBeenCalledTimes(1);
    const window: { startsAt: Date; endsAt: Date } = readLedger.mock
      .calls[0]![0] as { startsAt: Date; endsAt: Date };
    expect(NOW.getTime() - window.startsAt.getTime()).toBe(
      RECEIVING_LEDGER_CACHE_HORIZON_MS,
    );
  });
});

describe("ReceivingCoverage.planTelemetryEvaluation", () => {
  async function plan(windowInMs: number): Promise<TelemetryEvaluationPlan> {
    return ReceivingCoverage.planTelemetryEvaluation({ windowInMs, now: NOW });
  }

  test("receiving throughout: evaluate a window that ends now", async () => {
    expect(await plan(5 * MINUTE)).toEqual({
      evaluate: true,
      evaluateUntil: NOW,
      isIngestBehind: false,
    });
  });

  test("a window holding the restart or its grace waits, and says why", async () => {
    // Down from 12 to 5 minutes ago; agents reconnecting until 3 minutes ago.
    givenLedger([
      period(10 * DAY, 12 * MINUTE),
      period(5 * MINUTE, 10 * SECOND),
    ]);
    expect(await plan(10 * MINUTE)).toEqual({
      evaluate: false,
      evaluateUntil: NOW,
      isIngestBehind: false,
      deferredBecause: ReceivingGapReason.Reconnecting,
    });
  });

  test("a window clear of the restart is evaluated", async () => {
    givenLedger(RESTART);
    expect((await plan(15 * MINUTE)).evaluate).toBe(true);
  });

  test("a window holding a restart that ended longer ago than the cap is evaluated", async () => {
    // The restart's grace ended 16 minutes ago: past the 15-minute cap.
    givenLedger(RESTART);
    expect((await plan(20 * MINUTE)).evaluate).toBe(true);
  });

  test("a long window waits at most the deferral cap after the gap", async () => {
    // Back for exactly the cap, plus a moment.
    givenLedger([
      period(10 * DAY, TELEMETRY_EVALUATION_MAX_DEFERRAL_MS + 30 * MINUTE),
      period(
        TELEMETRY_EVALUATION_MAX_DEFERRAL_MS + 2 * MINUTE + SECOND,
        10 * SECOND,
      ),
    ]);
    expect((await plan(DAY)).evaluate).toBe(true);

    ReceivingCoverage.clearCache();
    givenLedger([
      period(10 * DAY, 3 * HOUR),
      period(TELEMETRY_EVALUATION_MAX_DEFERRAL_MS, 10 * SECOND),
    ]);
    expect((await plan(DAY)).evaluate).toBe(false);
  });

  test("while no process records that OneUptime is receiving, every window waits", async () => {
    givenLedger([period(10 * DAY, 4 * MINUTE)]);
    const result: TelemetryEvaluationPlan = await plan(MINUTE);
    expect(result.evaluate).toBe(false);
    expect(result.deferredBecause).toBe(ReceivingGapReason.NotReceiving);
  });

  test("a queue that is behind moves the window back to where the queue is", async () => {
    givenBacklogSince(7 * MINUTE);
    expect(await plan(5 * MINUTE)).toEqual({
      evaluate: true,
      evaluateUntil: ago(7 * MINUTE),
      isIngestBehind: true,
    });
  });

  test("a queue within the normal lag does not move the window", async () => {
    givenBacklogSince(40 * SECOND);
    expect((await plan(5 * MINUTE)).evaluateUntil).toEqual(NOW);
  });

  test("moved back into the restart, the window waits", async () => {
    givenLedger(RESTART);
    givenBacklogSince(17 * MINUTE);
    const result: TelemetryEvaluationPlan = await plan(MINUTE);
    expect(result.evaluate).toBe(false);
    expect(result.isIngestBehind).toBe(true);
  });
});

/*
 * Issue #11248: a telemetry check judges the window that ends when it was
 * due, however late it runs. The plan is handed that end (windowEndsAt) and
 * the time it runs (now), and works out from the end.
 */
describe("ReceivingCoverage.planTelemetryEvaluation for a check due before it runs (#11248)", () => {
  async function planDue(data: {
    windowInMs: number;
    windowEndsAt: Date;
    now?: Date | undefined;
  }): Promise<TelemetryEvaluationPlan> {
    ReceivingCoverage.clearCache();

    return ReceivingCoverage.planTelemetryEvaluation({
      windowInMs: data.windowInMs,
      windowEndsAt: data.windowEndsAt,
      now: data.now || NOW,
    });
  }

  test("the window ends when the check was due, not when it runs", async () => {
    expect(
      await planDue({ windowInMs: MINUTE, windowEndsAt: ago(25 * SECOND) }),
    ).toEqual({
      evaluate: true,
      evaluateUntil: ago(25 * SECOND),
      isIngestBehind: false,
    });
  });

  test("checks due a minute apart judge windows that follow on exactly, however late each runs", async () => {
    const firstDueAt: number = NOW.getTime() - 10 * MINUTE;

    // On time, 40 s late, after the next was due, a second late, retried 15 s on.
    const lateByMs: Array<number> = [
      5,
      40 * SECOND,
      61 * SECOND,
      SECOND,
      15 * SECOND,
    ];

    const windows: Array<{ startsAt: number; endsAt: number }> = [];

    for (let index: number = 0; index < lateByMs.length; index++) {
      const dueAtMs: number = firstDueAt + index * MINUTE;
      const result: TelemetryEvaluationPlan = await planDue({
        windowInMs: MINUTE,
        windowEndsAt: new Date(dueAtMs),
        now: new Date(dueAtMs + lateByMs[index]!),
      });

      expect(result.evaluate).toBe(true);
      windows.push({
        startsAt: result.evaluateUntil.getTime() - MINUTE,
        endsAt: result.evaluateUntil.getTime(),
      });
    }

    for (let index: number = 1; index < windows.length; index++) {
      expect(windows[index]!.startsAt).toBe(windows[index - 1]!.endsAt);
    }
  });

  test("a due time to come - another server's clock ahead of this one's - is now", async () => {
    expect(
      (
        await planDue({
          windowInMs: MINUTE,
          windowEndsAt: new Date(NOW.getTime() + 3 * SECOND),
        })
      ).evaluateUntil,
    ).toEqual(NOW);
  });

  test("a due time that cannot be read is now", async () => {
    expect(
      (
        await planDue({
          windowInMs: MINUTE,
          windowEndsAt: new Date(Number.NaN),
        })
      ).evaluateUntil,
    ).toEqual(NOW);
  });

  test("ingest more than a minute behind the window's end moves the window back to where the queue is: the earlier end wins", async () => {
    givenBacklogSince(2 * MINUTE);

    expect(
      await planDue({ windowInMs: MINUTE, windowEndsAt: ago(30 * SECOND) }),
    ).toEqual({
      evaluate: true,
      evaluateUntil: ago(2 * MINUTE),
      isIngestBehind: true,
    });
  });

  test("how far behind ingest is counts from the window's end: a late check judges no more unread data than an on-time one", async () => {
    // 100 s behind now, but only 55 s behind the window's end.
    givenBacklogSince(100 * SECOND);

    expect(
      await planDue({ windowInMs: MINUTE, windowEndsAt: ago(45 * SECOND) }),
    ).toEqual({
      evaluate: true,
      evaluateUntil: ago(45 * SECOND),
      isIngestBehind: false,
    });

    // The same queue holds a check due now back: 100 s is past the minute.
    givenBacklogSince(100 * SECOND);

    expect(
      await planDue({ windowInMs: MINUTE, windowEndsAt: NOW }),
    ).toMatchObject({
      evaluateUntil: ago(100 * SECOND),
      isIngestBehind: true,
    });
  });

  test("a queue whose oldest waiting job came in after the window's end holds none of the window's data", async () => {
    givenBacklogSince(10 * SECOND);

    expect(
      await planDue({ windowInMs: MINUTE, windowEndsAt: ago(40 * SECOND) }),
    ).toEqual({
      evaluate: true,
      evaluateUntil: ago(40 * SECOND),
      isIngestBehind: false,
    });
  });

  test("a window that ended before OneUptime stopped receiving is judged, however long after the restart its check runs", async () => {
    // Down from 30 to 18 minutes ago; reconnecting until 16 minutes ago.
    givenLedger(RESTART);

    expect(
      await planDue({ windowInMs: MINUTE, windowEndsAt: ago(31 * MINUTE) }),
    ).toEqual({
      evaluate: true,
      evaluateUntil: ago(31 * MINUTE),
      isIngestBehind: false,
    });
  });

  test("a window that holds the outage, or the reconnect after it, waits and says why", async () => {
    givenLedger(RESTART);

    expect(
      await planDue({ windowInMs: MINUTE, windowEndsAt: ago(20 * MINUTE) }),
    ).toEqual({
      evaluate: false,
      evaluateUntil: ago(20 * MINUTE),
      isIngestBehind: false,
      deferredBecause: ReceivingGapReason.NotReceiving,
    });

    expect(
      await planDue({ windowInMs: MINUTE, windowEndsAt: ago(17 * MINUTE) }),
    ).toMatchObject({
      evaluate: false,
      deferredBecause: ReceivingGapReason.Reconnecting,
    });
  });

  test("the ledger is read as of when the check runs, once, for the window it was due to", async () => {
    givenLedger(RESTART);

    await planDue({ windowInMs: 5 * MINUTE, windowEndsAt: ago(40 * MINUTE) });

    expect(readLedger).toHaveBeenCalledTimes(1);
    expect(readLedger.mock.calls[0]![0].endsAt).toEqual(NOW);
  });
});
