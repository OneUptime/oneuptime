import MonitorProbeService from "../../../Server/Services/MonitorProbeService";
import MonitorProbe from "../../../Models/DatabaseModels/MonitorProbe";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import logger from "../../../Server/Utils/Logger";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { getJestSpyOn } from "../../Spy";

/*
 * How nextPingAt is computed when a probe claims work.
 *
 * The rule that matters for sub-minute intervals: the next fire time is
 * computed from an anchor a second ahead of the claim, not from a bare "now".
 * Without it, a "*\/10 * * * * *" monitor claimed at 12:00:09.999 is scheduled
 * for 12:00:10.000 - a one millisecond cooldown - and gets probed twice back
 * to back. The bug existed for minute intervals too; a ten-second poll just
 * makes it constant instead of rare.
 *
 * The claim runs raw SQL inside a transaction, so the transaction is stubbed
 * and the parameters handed to the batch UPDATE are inspected. That is where
 * the computed dates actually land.
 */

const PROBE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const MONITOR_PROBE_ID_ONE: string = "33333333-3333-4333-8333-333333333333";
const MONITOR_PROBE_ID_TWO: string = "44444444-4444-4444-8444-444444444444";
const MONITOR_PROBE_ID_THREE: string = "55555555-5555-4555-8555-555555555555";

interface ClaimedRow {
  _id: string;
  monitoringInterval: string | null;
}

interface CapturedUpdate {
  currentDate: Date;
  ids: Array<string>;
  nextPingDates: Array<Date>;
}

type StubTransactionFunction = (
  rows: Array<ClaimedRow>,
) => Array<CapturedUpdate>;

/*
 * Replaces executeTransaction with a fake entity manager: the first query is
 * the SELECT ... FOR UPDATE SKIP LOCKED (answered with `rows`), the second is
 * the batch UPDATE whose parameters we want to look at.
 */
const stubTransaction: StubTransactionFunction = (
  rows: Array<ClaimedRow>,
): Array<CapturedUpdate> => {
  const capturedUpdates: Array<CapturedUpdate> = [];

  getJestSpyOn(MonitorProbeService, "executeTransaction").mockImplementation(
    async (runInTransaction: any): Promise<unknown> => {
      const fakeEntityManager: {
        query: (sql: string, parameters: Array<unknown>) => Promise<unknown>;
      } = {
        query: async (
          sql: string,
          parameters: Array<unknown>,
        ): Promise<unknown> => {
          if (sql.includes("SELECT")) {
            return rows;
          }

          capturedUpdates.push({
            currentDate: parameters[0] as Date,
            ids: parameters[1] as Array<string>,
            nextPingDates: parameters.slice(2) as Array<Date>,
          });

          return [];
        },
      };

      return runInTransaction(fakeEntityManager);
    },
  );

  return capturedUpdates;
};

type ClaimFunction = () => Promise<Array<ObjectID>>;

const claim: ClaimFunction = (): Promise<Array<ObjectID>> => {
  return MonitorProbeService.claimMonitorProbesForProbing({
    probeId: PROBE_ID,
    limit: 10,
  });
};

describe("MonitorProbeService nextPingAt scheduling", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("claimMonitorProbesForProbing", () => {
    it("never schedules the very next tick when it is milliseconds away", async () => {
      /*
       * The exact shape of the bug: claimed at :09.999 on a ten second
       * interval. Scheduling :10.000 would be a 1ms cooldown.
       */
      jest.useFakeTimers();
      jest.setSystemTime(new Date(Date.UTC(2026, 0, 1, 12, 0, 9, 999)));

      const capturedUpdates: Array<CapturedUpdate> = stubTransaction([
        {
          _id: MONITOR_PROBE_ID_ONE,
          monitoringInterval: "*/10 * * * * *",
        },
      ]);

      await claim();

      jest.useRealTimers();

      expect(capturedUpdates.length).toBe(1);

      const nextPingAt: Date = capturedUpdates[0]!.nextPingDates[0]!;

      expect(nextPingAt.toISOString()).toBe("2026-01-01T12:00:20.000Z");
      expect(
        nextPingAt.getTime() - capturedUpdates[0]!.currentDate.getTime(),
      ).toBeGreaterThanOrEqual(10000);
    });

    it("gives a full interval of cooldown when claimed exactly on the grid", async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date(Date.UTC(2026, 0, 1, 12, 0, 10, 0)));

      const capturedUpdates: Array<CapturedUpdate> = stubTransaction([
        {
          _id: MONITOR_PROBE_ID_ONE,
          monitoringInterval: "*/10 * * * * *",
        },
      ]);

      await claim();

      jest.useRealTimers();

      expect(capturedUpdates[0]!.nextPingDates[0]!.toISOString()).toBe(
        "2026-01-01T12:00:20.000Z",
      );
    });

    it("re-syncs a late claim to the wall-clock grid instead of accumulating drift", async () => {
      /*
       * Claimed 2.5s late. The next tick is still the grid's :20, not
       * :12.5 + 10s - so a probe that runs slow once does not push every
       * subsequent check off the grid.
       */
      jest.useFakeTimers();
      jest.setSystemTime(new Date(Date.UTC(2026, 0, 1, 12, 0, 12, 500)));

      const capturedUpdates: Array<CapturedUpdate> = stubTransaction([
        {
          _id: MONITOR_PROBE_ID_ONE,
          monitoringInterval: "*/10 * * * * *",
        },
      ]);

      await claim();

      jest.useRealTimers();

      expect(capturedUpdates[0]!.nextPingDates[0]!.toISOString()).toBe(
        "2026-01-01T12:00:20.000Z",
      );
    });

    it("schedules a whole batch off one consistent clock", async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date(Date.UTC(2026, 0, 1, 12, 0, 0, 0)));

      const capturedUpdates: Array<CapturedUpdate> = stubTransaction([
        {
          _id: MONITOR_PROBE_ID_ONE,
          monitoringInterval: "*/10 * * * * *",
        },
        {
          _id: MONITOR_PROBE_ID_TWO,
          monitoringInterval: "*/30 * * * * *",
        },
        {
          _id: MONITOR_PROBE_ID_THREE,
          monitoringInterval: "*/5 * * * *",
        },
      ]);

      await claim();

      jest.useRealTimers();

      const update: CapturedUpdate = capturedUpdates[0]!;

      expect(update.ids).toEqual([
        MONITOR_PROBE_ID_ONE,
        MONITOR_PROBE_ID_TWO,
        MONITOR_PROBE_ID_THREE,
      ]);

      expect(
        update.nextPingDates.map((date: Date) => {
          return date.toISOString();
        }),
      ).toEqual([
        "2026-01-01T12:00:10.000Z",
        "2026-01-01T12:00:30.000Z",
        "2026-01-01T12:05:00.000Z",
      ]);
    });

    it("keeps minute-and-above intervals working exactly as before", async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date(Date.UTC(2026, 0, 1, 12, 3, 20, 0)));

      const capturedUpdates: Array<CapturedUpdate> = stubTransaction([
        {
          _id: MONITOR_PROBE_ID_ONE,
          monitoringInterval: "*/5 * * * *",
        },
      ]);

      await claim();

      jest.useRealTimers();

      expect(capturedUpdates[0]!.nextPingDates[0]!.toISOString()).toBe(
        "2026-01-01T12:05:00.000Z",
      );
    });

    it("falls back to one minute and warns when the interval cannot be parsed", async () => {
      const warnSpy: jest.SpyInstance<any, any> = getJestSpyOn(
        logger,
        "warn",
      ).mockImplementation(() => {
        // Keep test output clean.
        return undefined;
      });

      jest.useFakeTimers();
      jest.setSystemTime(new Date(Date.UTC(2026, 0, 1, 12, 0, 0, 0)));

      const capturedUpdates: Array<CapturedUpdate> = stubTransaction([
        {
          _id: MONITOR_PROBE_ID_ONE,
          monitoringInterval: "not a cron",
        },
      ]);

      await claim();

      jest.useRealTimers();

      expect(capturedUpdates[0]!.nextPingDates[0]!.toISOString()).toBe(
        "2026-01-01T12:01:00.000Z",
      );

      expect(warnSpy).toHaveBeenCalled();
      expect(String(warnSpy.mock.calls[0]![0])).toContain(MONITOR_PROBE_ID_ONE);
      expect(String(warnSpy.mock.calls[0]![0])).toContain("not a cron");
    });

    it("falls back to one minute without warning when there is no interval at all", async () => {
      const warnSpy: jest.SpyInstance<any, any> = getJestSpyOn(
        logger,
        "warn",
      ).mockImplementation(() => {
        // Keep test output clean.
        return undefined;
      });

      jest.useFakeTimers();
      jest.setSystemTime(new Date(Date.UTC(2026, 0, 1, 12, 0, 0, 0)));

      const capturedUpdates: Array<CapturedUpdate> = stubTransaction([
        {
          _id: MONITOR_PROBE_ID_ONE,
          monitoringInterval: null,
        },
      ]);

      await claim();

      jest.useRealTimers();

      expect(capturedUpdates[0]!.nextPingDates[0]!.toISOString()).toBe(
        "2026-01-01T12:01:00.000Z",
      );
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("returns the claimed ids and writes nothing when nothing is due", async () => {
      const capturedUpdates: Array<CapturedUpdate> = stubTransaction([]);

      const claimedIds: Array<ObjectID> = await claim();

      expect(claimedIds).toEqual([]);
      expect(capturedUpdates.length).toBe(0);
    });
  });

  /*
   * The acceptance criterion from the issue, end to end over the two pieces
   * that decide it: a probe that asks for work every ten seconds, and the
   * server's nextPingAt arithmetic. A monitor set to twenty seconds must
   * produce consecutive checks twenty seconds apart - not sixty, which is
   * what a once-a-minute probe delivered no matter what the interval said.
   */
  describe("simulated probe ticks", () => {
    type SimulateFunction = (data: {
      monitoringInterval: string;
      probeTickInSeconds: number;
      durationInSeconds: number;
    }) => Promise<Array<number>>;

    const simulateProbeTicks: SimulateFunction = async (data: {
      monitoringInterval: string;
      probeTickInSeconds: number;
      durationInSeconds: number;
    }): Promise<Array<number>> => {
      const startTime: number = Date.UTC(2026, 0, 1, 12, 0, 0, 0);

      // The server's view of when this monitor is next due.
      let nextPingAt: number = startTime;

      const claimTimes: Array<number> = [];

      jest.useFakeTimers();

      for (
        let elapsed: number = 0;
        elapsed <= data.durationInSeconds;
        elapsed += data.probeTickInSeconds
      ) {
        const tickTime: number = startTime + elapsed * 1000;
        jest.setSystemTime(new Date(tickTime));

        // The claim query only returns rows whose nextPingAt has passed.
        const dueRows: Array<ClaimedRow> =
          nextPingAt <= tickTime
            ? [
                {
                  _id: MONITOR_PROBE_ID_ONE,
                  monitoringInterval: data.monitoringInterval,
                },
              ]
            : [];

        const capturedUpdates: Array<CapturedUpdate> = stubTransaction(dueRows);

        await claim();

        if (capturedUpdates.length > 0) {
          claimTimes.push(tickTime);
          nextPingAt = capturedUpdates[0]!.nextPingDates[0]!.getTime();
        }

        jest.restoreAllMocks();
      }

      jest.useRealTimers();

      return claimTimes;
    };

    it("checks a 20 second monitor every 20 seconds", async () => {
      const claimTimes: Array<number> = await simulateProbeTicks({
        monitoringInterval: "*/20 * * * * *",
        probeTickInSeconds: 10,
        durationInSeconds: 180,
      });

      // Three minutes at twenty seconds apart, plus the claim at t=0.
      expect(claimTimes.length).toBe(10);

      for (let i: number = 1; i < claimTimes.length; i++) {
        expect(claimTimes[i]! - claimTimes[i - 1]!).toBe(20000);
      }
    });

    it("checks a 10 second monitor every 10 seconds", async () => {
      const claimTimes: Array<number> = await simulateProbeTicks({
        monitoringInterval: "*/10 * * * * *",
        probeTickInSeconds: 10,
        durationInSeconds: 120,
      });

      expect(claimTimes.length).toBe(13);

      for (let i: number = 1; i < claimTimes.length; i++) {
        expect(claimTimes[i]! - claimTimes[i - 1]!).toBe(10000);
      }
    });

    it("checks a 30 second monitor every 30 seconds", async () => {
      const claimTimes: Array<number> = await simulateProbeTicks({
        monitoringInterval: "*/30 * * * * *",
        probeTickInSeconds: 10,
        durationInSeconds: 180,
      });

      expect(claimTimes.length).toBe(7);

      for (let i: number = 1; i < claimTimes.length; i++) {
        expect(claimTimes[i]! - claimTimes[i - 1]!).toBe(30000);
      }
    });

    it("still checks a one minute monitor once a minute at the faster tick", async () => {
      const claimTimes: Array<number> = await simulateProbeTicks({
        monitoringInterval: "* * * * *",
        probeTickInSeconds: 10,
        durationInSeconds: 180,
      });

      expect(claimTimes.length).toBe(4);

      for (let i: number = 1; i < claimTimes.length; i++) {
        expect(claimTimes[i]! - claimTimes[i - 1]!).toBe(60000);
      }
    });

    /*
     * The old world, for contrast: the same 20 second monitor against a probe
     * that only asks for work once a minute is checked once a minute. This is
     * exactly what issue #2937 reported.
     */
    it("is capped at the probe's tick - a 20 second monitor on a 60 second probe runs once a minute", async () => {
      const claimTimes: Array<number> = await simulateProbeTicks({
        monitoringInterval: "*/20 * * * * *",
        probeTickInSeconds: 60,
        durationInSeconds: 180,
      });

      expect(claimTimes.length).toBe(4);

      for (let i: number = 1; i < claimTimes.length; i++) {
        expect(claimTimes[i]! - claimTimes[i - 1]!).toBe(60000);
      }
    });
  });

  describe("updateNextPingAtForMonitor", () => {
    type MakeMonitorProbeFunction = (interval: string) => MonitorProbe;

    const makeMonitorProbe: MakeMonitorProbeFunction = (
      interval: string,
    ): MonitorProbe => {
      const monitorProbe: MonitorProbe = new MonitorProbe();
      monitorProbe.id = new ObjectID(MONITOR_PROBE_ID_ONE);
      monitorProbe.probeId = PROBE_ID;

      const monitor: Monitor = new Monitor();
      monitor.monitoringInterval = interval;
      monitorProbe.monitor = monitor;

      return monitorProbe;
    };

    let updateOneByIdSpy: jest.SpyInstance<any, any>;

    beforeEach(() => {
      updateOneByIdSpy = getJestSpyOn(
        MonitorProbeService,
        "updateOneById",
      ).mockResolvedValue(undefined as never);
    });

    it("anchors the same way the claim does", async () => {
      getJestSpyOn(MonitorProbeService, "findBy").mockResolvedValue([
        makeMonitorProbe("*/10 * * * * *"),
      ] as never);

      jest.useFakeTimers();
      jest.setSystemTime(new Date(Date.UTC(2026, 0, 1, 12, 0, 9, 999)));

      await MonitorProbeService.updateNextPingAtForMonitor({
        monitorId: MONITOR_ID,
      });

      jest.useRealTimers();

      const nextPingAt: Date = updateOneByIdSpy.mock.calls[0]![0].data
        .nextPingAt as Date;

      expect(nextPingAt.toISOString()).toBe("2026-01-01T12:00:20.000Z");
    });

    it("still resolves minute intervals correctly", async () => {
      getJestSpyOn(MonitorProbeService, "findBy").mockResolvedValue([
        makeMonitorProbe("*/5 * * * *"),
      ] as never);

      jest.useFakeTimers();
      jest.setSystemTime(new Date(Date.UTC(2026, 0, 1, 12, 3, 20, 0)));

      await MonitorProbeService.updateNextPingAtForMonitor({
        monitorId: MONITOR_ID,
      });

      jest.useRealTimers();

      const nextPingAt: Date = updateOneByIdSpy.mock.calls[0]![0].data
        .nextPingAt as Date;

      expect(nextPingAt.toISOString()).toBe("2026-01-01T12:05:00.000Z");
    });
  });
});
