import {
  XcpNgBackupReadPlan,
  advanceXcpNgBackupWatermark,
  getXcpNgBackupReadSince,
  getXcpNgTrackedBackupRunIds,
  mergeXcpNgBackupSummaries,
  planXcpNgBackupRead,
} from "../../../Utils/XcpNg/XcpNgBackupReading";
import { XoBackupLogSummary } from "../../../Utils/XcpNg/XenOrchestraRest";
import {
  XCP_NG_BACKUP_FIRST_READ_LOOKBACK_MS,
  XCP_NG_BACKUP_PENDING_GIVE_UP_MS,
  XCP_NG_MAX_TRACKED_BACKUP_RUNS,
  XcpNgBackupStatus,
  XcpNgBackupWatermark,
} from "../../../Types/XcpNg/XcpNgPoolEvents";
import { describe, expect, test } from "@jest/globals";

/*
 * Which backup runs a read delivers and where the next starts
 * (XcpNgBackupReading): each finished run once, whatever restarts in
 * between, with the state kept small.
 */

const HOUR: number = 60 * 60 * 1000;
const NOW: number = 1795000000000;

function run(
  id: string,
  start: number,
  status: XoBackupLogSummary["status"] = XcpNgBackupStatus.Success,
  jobId: string = "job-a",
): XoBackupLogSummary {
  return {
    id: id,
    jobId: jobId,
    jobName: jobId,
    scheduleId: null,
    start: start,
    end: status === "pending" ? null : start + 1000,
    status: status,
  };
}

function ids(list: Array<XoBackupLogSummary>): Array<string> {
  return list.map((summary: XoBackupLogSummary): string => {
    return summary.id;
  });
}

/*
 * One read as the probe makes it, against what Xen Orchestra lists: the
 * runs since readSince and the tracked ones, the plan, every planned run
 * read, the watermark advanced. Returns the runs delivered.
 */
function readOnce(data: {
  watermark: XcpNgBackupWatermark | undefined;
  logs: Array<XoBackupLogSummary>;
  nowMs: number;
  failToRead?: Set<string> | undefined;
  maxRuns?: number | undefined;
}): { delivered: Array<string>; watermark: XcpNgBackupWatermark } {
  const since: number = getXcpNgBackupReadSince({
    watermark: data.watermark,
    nowMs: data.nowMs,
  });
  const tracked: Set<string> = new Set<string>(
    getXcpNgTrackedBackupRunIds(data.watermark),
  );
  const summaries: Array<XoBackupLogSummary> = mergeXcpNgBackupSummaries(
    data.logs.filter((log: XoBackupLogSummary): boolean => {
      return log.start >= since;
    }),
    data.logs.filter((log: XoBackupLogSummary): boolean => {
      return tracked.has(log.id);
    }),
  );
  const plan: XcpNgBackupReadPlan = planXcpNgBackupRead({
    watermark: data.watermark,
    summaries: summaries,
    maxRuns: data.maxRuns,
  });
  const fetched: Array<string> = ids(plan.toFetch).filter((id: string) => {
    return !data.failToRead?.has(id);
  });
  return {
    delivered: fetched,
    watermark: advanceXcpNgBackupWatermark({
      watermark: data.watermark,
      summaries: summaries,
      deliveredRunIds: [...fetched, ...ids(plan.passedOver)],
      nowMs: data.nowMs,
    }),
  };
}

describe("the first read", () => {
  test("looks a week and a day back", () => {
    expect(XCP_NG_BACKUP_FIRST_READ_LOOKBACK_MS).toBe(8 * 24 * HOUR);
    expect(getXcpNgBackupReadSince({ nowMs: NOW })).toBe(NOW - 8 * 24 * HOUR);
    expect(
      getXcpNgBackupReadSince({
        watermark: { readSince: 5, deliveredRunIds: [], trackedRuns: [] },
        nowMs: NOW,
      }),
    ).toBe(5);
  });

  test("delivers each job's newest five, and passes the rest over", () => {
    const logs: Array<XoBackupLogSummary> = [];
    for (let day: number = 7; day >= 0; day--) {
      logs.push(run(`a${day}`, NOW - day * 24 * HOUR - HOUR));
    }
    logs.push(run("b0", NOW - 2 * HOUR, XcpNgBackupStatus.Failure, "job-b"));

    const plan: XcpNgBackupReadPlan = planXcpNgBackupRead({
      summaries: logs,
    });
    expect(ids(plan.passedOver)).toEqual(["a7", "a6", "a5"]);
    // Oldest first, across jobs.
    expect(ids(plan.toFetch)).toEqual(["a4", "a3", "a2", "a1", "b0", "a0"]);
  });
});

describe("over many reads", () => {
  test("a run is delivered once, and a pending run once it finishes", () => {
    const logs: Array<XoBackupLogSummary> = [
      run("r1", NOW - 3 * HOUR),
      run("r2", NOW - HOUR, "pending"),
    ];

    let state: { delivered: Array<string>; watermark: XcpNgBackupWatermark } =
      readOnce({ watermark: undefined, logs: logs, nowMs: NOW });
    expect(state.delivered).toEqual(["r1"]);
    expect(state.watermark.readSince).toBe(NOW - HOUR);
    expect(state.watermark.trackedRuns).toEqual([
      { runId: "r2", start: NOW - HOUR },
    ]);

    // Nothing new: nothing delivered again.
    state = readOnce({
      watermark: state.watermark,
      logs: logs,
      nowMs: NOW + 60000,
    });
    expect(state.delivered).toEqual([]);

    // r2 finishes, and a new run starts after it.
    logs[1] = run("r2", NOW - HOUR, XcpNgBackupStatus.Failure);
    logs.push(run("r3", NOW + 120000));
    state = readOnce({
      watermark: state.watermark,
      logs: logs,
      nowMs: NOW + 180000,
    });
    expect(state.delivered).toEqual(["r2", "r3"]);
    expect(state.watermark.trackedRuns).toEqual([]);
    expect(state.watermark.readSince).toBe(NOW + 120000);
    expect(state.watermark.deliveredRunIds).toEqual(["r3"]);

    state = readOnce({
      watermark: state.watermark,
      logs: logs,
      nowMs: NOW + 240000,
    });
    expect(state.delivered).toEqual([]);
  });

  test("a run that started long before readSince is still read by its id", () => {
    const logs: Array<XoBackupLogSummary> = [
      run("long", NOW - 10 * HOUR, "pending"),
      run("short", NOW - HOUR),
    ];
    let state: { delivered: Array<string>; watermark: XcpNgBackupWatermark } =
      readOnce({ watermark: undefined, logs: logs, nowMs: NOW });
    expect(state.delivered).toEqual(["short"]);
    expect(state.watermark.readSince).toBe(NOW - HOUR);

    logs[0] = run("long", NOW - 10 * HOUR, XcpNgBackupStatus.Success);
    state = readOnce({
      watermark: state.watermark,
      logs: logs,
      nowMs: NOW + HOUR,
    });
    expect(state.delivered).toEqual(["long"]);
    expect(state.watermark.trackedRuns).toEqual([]);
  });

  test("more finished runs than one read takes wait for the next, never lost", () => {
    const logs: Array<XoBackupLogSummary> = [];
    for (let index: number = 0; index < 5; index++) {
      logs.push(
        run(`j${index}`, NOW - HOUR + index, undefined, `job-${index}`),
      );
    }
    let state: { delivered: Array<string>; watermark: XcpNgBackupWatermark } =
      readOnce({ watermark: undefined, logs: logs, nowMs: NOW, maxRuns: 2 });
    expect(state.delivered).toEqual(["j0", "j1"]);

    const delivered: Array<string> = [...state.delivered];
    for (let minute: number = 1; minute <= 3; minute++) {
      state = readOnce({
        watermark: state.watermark,
        logs: logs,
        nowMs: NOW + minute * 60000,
        maxRuns: 2,
      });
      delivered.push(...state.delivered);
    }
    expect(delivered).toEqual(["j0", "j1", "j2", "j3", "j4"]);
  });

  test("a run whose full log could not be read is read again", () => {
    const logs: Array<XoBackupLogSummary> = [run("r1", NOW - HOUR)];
    let state: { delivered: Array<string>; watermark: XcpNgBackupWatermark } =
      readOnce({
        watermark: undefined,
        logs: logs,
        nowMs: NOW,
        failToRead: new Set<string>(["r1"]),
      });
    expect(state.delivered).toEqual([]);
    state = readOnce({ watermark: state.watermark, logs: logs, nowMs: NOW });
    expect(state.delivered).toEqual(["r1"]);
  });

  test("a probe that restarts reads from the kept watermark: no loss, no repeat", () => {
    const logs: Array<XoBackupLogSummary> = [
      run("r1", NOW - 2 * HOUR),
      run("r2", NOW - HOUR),
    ];
    const first: { delivered: Array<string>; watermark: XcpNgBackupWatermark } =
      readOnce({ watermark: undefined, logs: logs, nowMs: NOW });
    // What the server stored, read back as a restarted probe gets it.
    const kept: XcpNgBackupWatermark = JSON.parse(
      JSON.stringify(first.watermark),
    ) as XcpNgBackupWatermark;
    logs.push(run("r3", NOW + 1000));
    const afterRestart: {
      delivered: Array<string>;
      watermark: XcpNgBackupWatermark;
    } = readOnce({ watermark: kept, logs: logs, nowMs: NOW + 60000 });
    expect([...first.delivered, ...afterRestart.delivered]).toEqual([
      "r1",
      "r2",
      "r3",
    ]);
  });

  test("a run pending for three days is not waited for any more", () => {
    expect(XCP_NG_BACKUP_PENDING_GIVE_UP_MS).toBe(3 * 24 * HOUR);
    const logs: Array<XoBackupLogSummary> = [
      run("stuck", NOW - 4 * 24 * HOUR, "pending"),
    ];
    const state: { delivered: Array<string>; watermark: XcpNgBackupWatermark } =
      readOnce({ watermark: undefined, logs: logs, nowMs: NOW });
    expect(state.watermark.trackedRuns).toEqual([]);
  });

  test("with no run at all, the read moves with the clock", () => {
    let state: { delivered: Array<string>; watermark: XcpNgBackupWatermark } =
      readOnce({ watermark: undefined, logs: [], nowMs: NOW });
    expect(state.watermark.readSince).toBe(NOW - 8 * 24 * HOUR);
    state = readOnce({
      watermark: state.watermark,
      logs: [],
      nowMs: NOW + 30 * 24 * HOUR,
    });
    expect(state.watermark.readSince).toBe(NOW + 22 * 24 * HOUR);
  });

  test("a tracked run Xen Orchestra stopped listing is let go after the give-up time", () => {
    const watermark: XcpNgBackupWatermark = {
      readSince: NOW,
      deliveredRunIds: [],
      trackedRuns: [
        { runId: "gone-old", start: NOW - 4 * 24 * HOUR },
        { runId: "gone-new", start: NOW - HOUR },
      ],
    };
    const next: XcpNgBackupWatermark = advanceXcpNgBackupWatermark({
      watermark: watermark,
      summaries: [],
      deliveredRunIds: [],
      nowMs: NOW,
    });
    expect(next.trackedRuns).toEqual([
      { runId: "gone-new", start: NOW - HOUR },
    ]);
  });

  test("the runs followed by id are bounded, newest kept", () => {
    const summaries: Array<XoBackupLogSummary> = [];
    for (
      let index: number = 0;
      index < XCP_NG_MAX_TRACKED_BACKUP_RUNS + 10;
      index++
    ) {
      summaries.push(run(`p${index}`, NOW - HOUR + index, "pending"));
    }
    const next: XcpNgBackupWatermark = advanceXcpNgBackupWatermark({
      summaries: summaries,
      deliveredRunIds: [],
      nowMs: NOW,
    });
    expect(next.trackedRuns).toHaveLength(XCP_NG_MAX_TRACKED_BACKUP_RUNS);
    expect(next.trackedRuns[0]?.runId).toBe("p10");
  });
});

describe("summaries read twice", () => {
  test("the finished word on a run wins over the pending one", () => {
    expect(
      mergeXcpNgBackupSummaries(
        [run("r", 1, "pending")],
        [run("r", 1, XcpNgBackupStatus.Failure)],
      ),
    ).toEqual([run("r", 1, XcpNgBackupStatus.Failure)]);
    expect(
      mergeXcpNgBackupSummaries(
        [run("r", 1, XcpNgBackupStatus.Failure)],
        [run("r", 1, "pending")],
      )[0]?.status,
    ).toBe(XcpNgBackupStatus.Failure);
  });

  test("tracked ids are unique", () => {
    expect(
      getXcpNgTrackedBackupRunIds({
        readSince: 0,
        deliveredRunIds: [],
        trackedRuns: [
          { runId: "a", start: 1 },
          { runId: "a", start: 1 },
          { runId: "", start: 2 },
        ],
      }),
    ).toEqual(["a"]);
    expect(getXcpNgTrackedBackupRunIds(undefined)).toEqual([]);
  });
});
