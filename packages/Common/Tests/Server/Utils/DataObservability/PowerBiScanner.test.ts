import { describe, expect, test } from "@jest/globals";
import BiRequestError from "../../../../Server/Utils/DataObservability/Bi/BiRequestError";
import {
  askPowerBi,
  chunkWorkspaces,
  describeRunningScans,
  describeUnscannedWorkspaces,
  listPowerBiWorkspaces,
  MAX_SIMULTANEOUS_SCANS,
  POWER_BI_ASKED_SCAN_WAIT_IN_MS,
  POWER_BI_SCAN_QUERY,
  POWER_BI_SCANS_FULL_REASON,
  POWER_BI_SCHEDULED_SCAN_WAIT_IN_MS,
  PowerBiLimitError,
  PowerBiPendingScan,
  PowerBiScannerApi,
  PowerBiScanRun,
  PowerBiScanTiming,
  runPowerBiScans,
  settlePowerBiScans,
} from "../../../../Server/Utils/DataObservability/Bi/PowerBiScanner";
import { JSONObject } from "../../../../Types/JSON";

/*
 * Power BI's metadata scan of a tenant (#9552), as Microsoft's "Run
 * metadata scanning" guide runs it: at most 100 workspaces a scan and 16
 * scans at once, each scan's status asked patiently - sooner at first,
 * then every 30 seconds, as Microsoft recommends - until it succeeds,
 * fails or the read's wait runs out, and Power BI's Retry-After respected.
 * A scan of 100 workspaces with their schemas and expressions can take
 * minutes on a big tenant; before, one still running after about a minute
 * failed the whole read.
 */

/*
 * Time that passes only while the scanner waits, as it does for real:
 * scans waiting side by side wait at once, so the clock moves to the
 * earliest wait's end, one at a time, once everything else has run. Every
 * wait asked for is noted.
 */
function fakeTiming(): PowerBiScanTiming & { waits: Array<number> } {
  let now: number = Date.parse("2026-11-19T10:00:00.000Z");
  const waits: Array<number> = [];
  const timers: Array<{ at: number; order: number; resolve: () => void }> = [];
  let order: number = 0;
  let isScheduled: boolean = false;

  const advance: () => void = (): void => {
    isScheduled = false;
    timers.sort(
      (
        a: { at: number; order: number },
        b: { at: number; order: number },
      ): number => {
        return a.at - b.at || a.order - b.order;
      },
    );

    const next: { at: number; resolve: () => void } | undefined =
      timers.shift();

    if (!next) {
      return;
    }

    now = next.at;
    next.resolve();
    schedule();
  };
  const schedule: () => void = (): void => {
    if (!isScheduled) {
      isScheduled = true;
      // After every promise that can run has: each scan has reached its next wait.
      setTimeout(advance, 0);
    }
  };

  return {
    waits,
    wait: (ms: number): Promise<void> => {
      waits.push(ms);

      return new Promise((resolve: () => void) => {
        timers.push({ at: now + ms, order: order++, resolve });
        schedule();
      });
    },
    clock: (): number => {
      return now;
    },
  };
}

function ids(count: number, prefix: string = "ws"): Array<string> {
  return Array.from({ length: count }, (_: unknown, index: number): string => {
    return `${prefix}-${String(index).padStart(5, "0")}`;
  });
}

interface FakeScanner {
  api: PowerBiScannerApi;
  calls: Array<string>;
  // The most scans running at once: started, and not yet done.
  maxRunning: number;
}

/*
 * Power BI's scanner, in memory: each scan answers Running for as many
 * asks of its status as `polls(workspaceIds)` says, then Succeeded (or
 * what `status` says), and its result names each of its workspaces. Scans
 * an earlier read started (`started`) are running when the read begins; a
 * scan it never started is unknown to it (a 404), as is one whose result it
 * no longer keeps.
 */
function fakeScanner(
  data: {
    polls?: (workspaceIds: Array<string>) => number;
    status?: (workspaceIds: Array<string>) => JSONObject | null;
    onGetInfo?: (call: number) => void;
    listed?: Array<JSONObject>;
    started?: Array<{ scanId: string; workspaceIds: Array<string> }>;
    // An answer to a request about a scan, in place of the scan's own: a thrown error.
    onScanRequest?: (path: string) => void;
  } = {},
): FakeScanner {
  const scans: Map<
    string,
    { workspaceIds: Array<string>; asked: number; isDone: boolean }
  > = new Map(
    (data.started || []).map(
      (scan: {
        scanId: string;
        workspaceIds: Array<string>;
      }): [
        string,
        { workspaceIds: Array<string>; asked: number; isDone: boolean },
      ] => {
        return [
          scan.scanId,
          { workspaceIds: scan.workspaceIds, asked: 0, isDone: false },
        ];
      },
    ),
  );
  let running: number = scans.size;
  let getInfoCalls: number = 0;
  const end: (scan: { isDone: boolean }) => void = (scan: {
    isDone: boolean;
  }): void => {
    if (!scan.isDone) {
      scan.isDone = true;
      running--;
    }
  };
  const scanner: FakeScanner = {
    calls: [],
    maxRunning: running,
    api: {
      get: async (path: string): Promise<unknown> => {
        scanner.calls.push(`GET ${path}`);

        if (path.startsWith("/admin/workspaces/modified")) {
          return data.listed || [];
        }

        data.onScanRequest?.(path);

        const scanId: string = decodeURIComponent(path.split("/").pop()!);
        const scan:
          | { workspaceIds: Array<string>; asked: number; isDone: boolean }
          | undefined = scans.get(scanId);

        if (!scan) {
          throw new BiRequestError(
            "Power BI answered 404: The scan was not found.",
            404,
          );
        }

        if (path.startsWith("/admin/workspaces/scanStatus/")) {
          scan.asked++;

          const said: JSONObject | null = data.status
            ? data.status(scan.workspaceIds)
            : null;

          if (said) {
            end(scan);
            return said;
          }

          if (scan.asked > (data.polls ? data.polls(scan.workspaceIds) : 0)) {
            end(scan);
            return { id: scanId, status: "Succeeded" };
          }

          return { id: scanId, status: "Running" };
        }

        return {
          workspaces: scan.workspaceIds.map((id: string): JSONObject => {
            return { id, name: `Workspace ${id}`, state: "Active" };
          }),
        };
      },
      post: async (path: string, body: JSONObject): Promise<unknown> => {
        scanner.calls.push(`POST ${path}`);
        getInfoCalls++;
        data.onGetInfo?.(getInfoCalls);

        const scanId: string = `scan-${getInfoCalls}`;

        scans.set(scanId, {
          workspaceIds: body["workspaces"] as Array<string>,
          asked: 0,
          isDone: false,
        });
        running++;
        scanner.maxRunning = Math.max(scanner.maxRunning, running);

        return { id: scanId, status: "NotStarted" };
      },
    },
  };

  return scanner;
}

describe("listing the workspaces to scan", () => {
  test("every workspace but personal ones, or those changed since a time: each once, by id in lower case", async () => {
    const scanner: FakeScanner = fakeScanner({
      listed: [
        { id: "3740504D-1F93-42F9-8E9D-C8BA9B787A3B" },
        { id: "19cb346c-9839-4e19-81e6-76364d0b836f" },
        { id: "3740504d-1f93-42f9-8e9d-c8ba9b787a3b" },
        { notAnId: true },
      ],
    });

    expect(
      await listPowerBiWorkspaces({
        api: scanner.api,
        modifiedSince: null,
        timing: fakeTiming(),
      }),
    ).toEqual([
      "3740504d-1f93-42f9-8e9d-c8ba9b787a3b",
      "19cb346c-9839-4e19-81e6-76364d0b836f",
    ]);

    await listPowerBiWorkspaces({
      api: scanner.api,
      modifiedSince: new Date("2026-11-19T09:30:00.000Z"),
      timing: fakeTiming(),
    });

    expect(scanner.calls).toEqual([
      "GET /admin/workspaces/modified?excludePersonalWorkspaces=true",
      "GET /admin/workspaces/modified?excludePersonalWorkspaces=true&modifiedSince=2026-11-19T09%3A30%3A00.000Z",
    ]);
  });
});

describe("scanning them", () => {
  test("at most 100 workspaces a scan, with lineage, data sources, schemas and expressions", async () => {
    const scanner: FakeScanner = fakeScanner();
    const run: PowerBiScanRun = await runPowerBiScans({
      api: scanner.api,
      workspaceIds: ids(250),
      timing: fakeTiming(),
      waitInMs: POWER_BI_SCHEDULED_SCAN_WAIT_IN_MS,
    });

    expect(
      chunkWorkspaces(ids(250)).map((chunk: Array<string>) => {
        return chunk.length;
      }),
    ).toEqual([100, 100, 50]);
    expect(
      scanner.calls.filter((call: string): boolean => {
        return call.startsWith("POST");
      }),
    ).toEqual(
      Array(3).fill(`POST /admin/workspaces/getInfo?${POWER_BI_SCAN_QUERY}`),
    );
    expect(run.unscanned).toEqual([]);
    expect(
      run.scanned.map((chunk: PowerBiScanRun["scanned"][number]) => {
        return chunk.workspaceIds.length;
      }),
    ).toEqual([100, 100, 50]);
  });

  test("never more than 16 scans at once, however many workspaces", async () => {
    const scanner: FakeScanner = fakeScanner({
      polls: (): number => {
        return 3;
      },
    });
    const run: PowerBiScanRun = await runPowerBiScans({
      api: scanner.api,
      workspaceIds: ids(4_000),
      timing: fakeTiming(),
      waitInMs: POWER_BI_SCHEDULED_SCAN_WAIT_IN_MS,
    });

    expect(run.scanned).toHaveLength(40);
    expect(scanner.maxRunning).toBe(MAX_SIMULTANEOUS_SCANS);
  });

  test("a scan's status is asked after 3, 5, 10 and 20 seconds, then every 30: a slow scan finishes", async () => {
    const timing: ReturnType<typeof fakeTiming> = fakeTiming();
    // Done after about seven minutes: the old reader gave up after a minute.
    const scanner: FakeScanner = fakeScanner({
      polls: (): number => {
        return 15;
      },
    });
    const run: PowerBiScanRun = await runPowerBiScans({
      api: scanner.api,
      workspaceIds: ids(10),
      timing,
      waitInMs: POWER_BI_SCHEDULED_SCAN_WAIT_IN_MS,
    });

    expect(timing.waits).toEqual([
      3_000,
      5_000,
      10_000,
      20_000,
      ...Array(12).fill(30_000),
    ]);
    expect(run.scanned).toHaveLength(1);
    expect(run.unscanned).toEqual([]);
  });

  test("a scan that does not finish within the read's wait is kept by its id for the next read, not given up on (#9697)", async () => {
    const scheduled: ReturnType<typeof fakeTiming> = fakeTiming();
    const startedAt: string = new Date(scheduled.clock()).toISOString();
    const never: () => FakeScanner = (): FakeScanner => {
      return fakeScanner({
        polls: (): number => {
          return Number.POSITIVE_INFINITY;
        },
      });
    };
    const run: PowerBiScanRun = await runPowerBiScans({
      api: never().api,
      workspaceIds: ids(3),
      timing: scheduled,
      waitInMs: POWER_BI_SCHEDULED_SCAN_WAIT_IN_MS,
    });

    expect(run.scanned).toEqual([]);
    expect(run.unscanned).toEqual([]);
    expect(run.running).toEqual([
      { scanId: "scan-1", workspaceIds: ids(3), startedAt },
    ]);
    expect(run.outcomes).toEqual([
      { kind: "running", scanId: "scan-1", workspaceIds: ids(3), startedAt },
    ]);
    // It stopped asking at the wait's end, not after.
    expect(
      scheduled.waits.reduce((total: number, ms: number): number => {
        return total + ms;
      }, 0),
    ).toBeLessThanOrEqual(POWER_BI_SCHEDULED_SCAN_WAIT_IN_MS);
    expect(
      describeRunningScans(run.running, POWER_BI_SCHEDULED_SCAN_WAIT_IN_MS),
    ).toBe(
      "Power BI was still scanning 3 workspaces when the read stopped waiting after 20 minutes. The next read reads those scans once Power BI has finished them, and until then the workspaces show what was read before.",
    );

    const asked: PowerBiScanRun = await runPowerBiScans({
      api: never().api,
      workspaceIds: ids(3),
      timing: fakeTiming(),
      waitInMs: POWER_BI_ASKED_SCAN_WAIT_IN_MS,
    });

    expect(asked.running).toHaveLength(1);
    expect(
      describeRunningScans(
        [{ ...asked.running[0]!, workspaceIds: ["only"] }],
        POWER_BI_ASKED_SCAN_WAIT_IN_MS,
      ),
    ).toBe(
      "Power BI was still scanning 1 workspace when the read stopped waiting after 4 minutes. The next read reads that scan once Power BI has finished it, and until then the workspace shows what was read before.",
    );
  });

  test("a failed scan leaves its workspaces unscanned with Power BI's reason; the others are scanned", async () => {
    const scanner: FakeScanner = fakeScanner({
      status: (workspaceIds: Array<string>): JSONObject | null => {
        return workspaceIds[0] === "ws-00100"
          ? {
              status: "Failed",
              error: {
                code: "ScanFailed",
                message: "The workspace scan could not complete.",
              },
            }
          : null;
      },
    });
    const run: PowerBiScanRun = await runPowerBiScans({
      api: scanner.api,
      workspaceIds: ids(250),
      timing: fakeTiming(),
      waitInMs: POWER_BI_SCHEDULED_SCAN_WAIT_IN_MS,
    });

    expect(
      run.scanned.map((chunk: PowerBiScanRun["scanned"][number]) => {
        return chunk.workspaceIds[0];
      }),
    ).toEqual(["ws-00000", "ws-00200"]);
    expect(run.unscanned).toEqual([
      {
        workspaceIds: ids(250).slice(100, 200),
        reason:
          "Power BI's workspace scan failed: The workspace scan could not complete.",
      },
    ]);
  });

  test("results keep the workspaces' order, whichever scan finishes first", async () => {
    // The first scan is the slowest.
    const scanner: FakeScanner = fakeScanner({
      polls: (workspaceIds: Array<string>): number => {
        return workspaceIds[0] === "ws-00000" ? 6 : 0;
      },
    });
    const run: PowerBiScanRun = await runPowerBiScans({
      api: scanner.api,
      workspaceIds: ids(300),
      timing: fakeTiming(),
      waitInMs: POWER_BI_SCHEDULED_SCAN_WAIT_IN_MS,
    });

    expect(
      run.scanned.map((chunk: PowerBiScanRun["scanned"][number]) => {
        return chunk.workspaceIds[0];
      }),
    ).toEqual(["ws-00000", "ws-00100", "ws-00200"]);
  });
});

describe("Power BI's limits", () => {
  test("a 429 is asked again after the wait its Retry-After names", async () => {
    const timing: ReturnType<typeof fakeTiming> = fakeTiming();
    const scanner: FakeScanner = fakeScanner({
      onGetInfo: (call: number): void => {
        if (call === 1) {
          throw new BiRequestError(
            "Power BI answered 429: Too many requests",
            429,
            20_000,
          );
        }
      },
    });
    const run: PowerBiScanRun = await runPowerBiScans({
      api: scanner.api,
      workspaceIds: ids(5),
      timing,
      waitInMs: POWER_BI_SCHEDULED_SCAN_WAIT_IN_MS,
    });

    expect(run.scanned).toHaveLength(1);
    expect(timing.waits[0]).toBe(20_000);
  });

  test("a wait longer than a read's leaves that scan and every later one for the next read, untried", async () => {
    const scanner: FakeScanner = fakeScanner({
      // Each of the first scans finishes at its own time, so one starts at a time after them.
      polls: (workspaceIds: Array<string>): number => {
        return Number(workspaceIds[0]!.slice(3)) / 100;
      },
      onGetInfo: (call: number): void => {
        if (call >= 17) {
          throw new BiRequestError(
            "Power BI answered 429: Too many requests",
            429,
            30 * 60 * 1000,
          );
        }
      },
    });
    const run: PowerBiScanRun = await runPowerBiScans({
      api: scanner.api,
      workspaceIds: ids(2_000),
      timing: fakeTiming(),
      waitInMs: POWER_BI_SCHEDULED_SCAN_WAIT_IN_MS,
    });

    expect(run.scanned).toHaveLength(16);
    expect(run.unscanned).toHaveLength(4);
    expect(run.unscanned[0]!.reason).toBe(
      "Power BI asked for fewer requests for 30 minutes (its scanner takes 500 scans an hour, and 30 lists of workspaces); the next read goes on.",
    );
    // The scans after the refusal were not started.
    expect(
      scanner.calls.filter((call: string): boolean => {
        return call.startsWith("POST");
      }),
    ).toHaveLength(17);
  });

  test("a 429 that names no wait waits 30 seconds, at most three times; any other error at once", async () => {
    const timing: ReturnType<typeof fakeTiming> = fakeTiming();
    let asked: number = 0;

    await expect(
      askPowerBi(async (): Promise<never> => {
        asked++;
        throw new BiRequestError("Power BI answered 429: slow down", 429);
      }, timing),
    ).rejects.toBeInstanceOf(PowerBiLimitError);
    expect(asked).toBe(4);
    expect(timing.waits).toEqual([30_000, 30_000, 30_000]);

    let failed: number = 0;

    await expect(
      askPowerBi(async (): Promise<never> => {
        failed++;
        throw new BiRequestError("Power BI answered 401: Unauthorized", 401);
      }, fakeTiming()),
    ).rejects.toThrow("Power BI answered 401: Unauthorized");
    expect(failed).toBe(1);
  });
});

describe("what a read says it could not scan", () => {
  test("how many workspaces, Power BI's reason, and that the next read scans them", () => {
    expect(describeUnscannedWorkspaces([])).toBeNull();
    expect(
      describeUnscannedWorkspaces([
        {
          workspaceIds: ["a"],
          reason: "Power BI's workspace scan failed: Timeout.",
        },
      ]),
    ).toBe(
      "1 workspace was not scanned this time: Power BI's workspace scan failed: Timeout. The next read scans it again, and until then it shows what was read before.",
    );
    expect(
      describeUnscannedWorkspaces([
        {
          workspaceIds: ids(100),
          reason: "Power BI's workspace scan did not finish within 20 minutes.",
        },
        { workspaceIds: ids(20), reason: "Something else." },
      ]),
    ).toBe(
      "120 workspaces were not scanned this time: Power BI's workspace scan did not finish within 20 minutes. The next read scans them again, and until then they show what was read before.",
    );
  });
});

/*
 * A scan an earlier read stopped waiting for, picked up by the next read
 * (#9697): Power BI goes on with it and keeps its result for 24 hours, so
 * the next read asks for its status first and reads its result, instead
 * of starting a scan of its workspaces that, in a tenant whose scans
 * outlast the wait, would never be read either.
 */
describe("picking up a scan an earlier read stopped waiting for", () => {
  const STARTED_AT: string = "2026-11-19T09:00:00.000Z";

  function pending(
    scanId: string,
    workspaceIds: Array<string>,
    startedAt: string = STARTED_AT,
  ): PowerBiPendingScan {
    return { scanId, workspaceIds, startedAt };
  }

  function posts(scanner: FakeScanner): Array<string> {
    return scanner.calls.filter((call: string): boolean => {
      return call.startsWith("POST");
    });
  }

  function chunksOf(run: PowerBiScanRun): Array<Array<string>> {
    return run.scanned.map(
      (chunk: PowerBiScanRun["scanned"][number]): Array<string> => {
        return chunk.workspaceIds;
      },
    );
  }

  test("a scan that finished since is asked about at once and read: no scan starts for its workspaces", async () => {
    const timing: ReturnType<typeof fakeTiming> = fakeTiming();
    const scanner: FakeScanner = fakeScanner({
      started: [{ scanId: "earlier", workspaceIds: ids(3) }],
    });
    const run: PowerBiScanRun = await runPowerBiScans({
      api: scanner.api,
      workspaceIds: [],
      pickUp: [pending("earlier", ids(3))],
      timing,
      waitInMs: POWER_BI_SCHEDULED_SCAN_WAIT_IN_MS,
    });

    expect(scanner.calls).toEqual([
      "GET /admin/workspaces/scanStatus/earlier",
      "GET /admin/workspaces/scanResult/earlier",
    ]);
    // Asked at once: a scan that ran through a read already needs no first wait.
    expect(timing.waits).toEqual([]);
    expect(run.scanned).toEqual([
      {
        workspaceIds: ids(3),
        result: {
          workspaces: ids(3).map((id: string): JSONObject => {
            return { id, name: `Workspace ${id}`, state: "Active" };
          }),
        },
        // What it read is as old as its start, not the read that picked it up (#9901).
        startedAt: STARTED_AT,
      },
    ]);
    expect(run.running).toEqual([]);
    expect(run.unscanned).toEqual([]);
  });

  test("one still running is asked every 30 seconds while the read waits, and kept with its first start for the next", async () => {
    const timing: ReturnType<typeof fakeTiming> = fakeTiming();
    const scanner: FakeScanner = fakeScanner({
      started: [{ scanId: "slow", workspaceIds: ids(2) }],
      polls: (): number => {
        return Number.POSITIVE_INFINITY;
      },
    });
    const run: PowerBiScanRun = await runPowerBiScans({
      api: scanner.api,
      workspaceIds: [],
      pickUp: [pending("slow", ids(2))],
      timing,
      waitInMs: POWER_BI_ASKED_SCAN_WAIT_IN_MS,
    });

    expect(timing.waits).toEqual(Array(8).fill(30_000));
    expect(posts(scanner)).toEqual([]);
    expect(run.running).toEqual([pending("slow", ids(2))]);
  });

  test("one that finishes while the read waits is read beside the read's own scans, as the older", async () => {
    const scanner: FakeScanner = fakeScanner({
      started: [{ scanId: "earlier", workspaceIds: ["old-1", "old-2"] }],
      polls: (workspaceIds: Array<string>): number => {
        return workspaceIds[0] === "old-1" ? 3 : 0;
      },
    });
    const run: PowerBiScanRun = await runPowerBiScans({
      api: scanner.api,
      workspaceIds: ["new-1"],
      pickUp: [pending("earlier", ["old-1", "old-2"])],
      timing: fakeTiming(),
      waitInMs: POWER_BI_SCHEDULED_SCAN_WAIT_IN_MS,
    });

    expect(chunksOf(run)).toEqual([["old-1", "old-2"], ["new-1"]]);
    expect(posts(scanner)).toHaveLength(1);
  });

  test("scans picked up are followed oldest first, whatever order they were kept in", async () => {
    const scanner: FakeScanner = fakeScanner({
      started: [
        { scanId: "newer", workspaceIds: ["b"] },
        { scanId: "older", workspaceIds: ["a"] },
      ],
    });
    const run: PowerBiScanRun = await runPowerBiScans({
      api: scanner.api,
      workspaceIds: [],
      pickUp: [
        pending("newer", ["b"], "2026-11-19T09:30:00.000Z"),
        pending("older", ["a"], "2026-11-19T08:30:00.000Z"),
      ],
      timing: fakeTiming(),
      waitInMs: POWER_BI_SCHEDULED_SCAN_WAIT_IN_MS,
    });

    expect(chunksOf(run)).toEqual([["a"], ["b"]]);
  });

  test("one that failed has its workspaces scanned anew in the same read, and Power BI's reason is kept with the first", async () => {
    let failed: boolean = false;
    const scanner: FakeScanner = fakeScanner({
      started: [{ scanId: "failed", workspaceIds: ids(2) }],
      status: (): JSONObject | null => {
        if (failed) {
          return null;
        }

        failed = true;

        return {
          status: "Failed",
          error: { message: "The workspace scan could not complete." },
        };
      },
    });
    const run: PowerBiScanRun = await runPowerBiScans({
      api: scanner.api,
      workspaceIds: [],
      pickUp: [pending("failed", ids(2))],
      timing: fakeTiming(),
      waitInMs: POWER_BI_SCHEDULED_SCAN_WAIT_IN_MS,
    });

    expect(posts(scanner)).toEqual([
      `POST /admin/workspaces/getInfo?${POWER_BI_SCAN_QUERY}`,
    ]);
    expect(
      run.outcomes.map((outcome: PowerBiScanRun["outcomes"][number]) => {
        return outcome.kind;
      }),
    ).toEqual(["unscanned", "scanned"]);
    expect(run.unscanned).toEqual([
      {
        workspaceIds: ids(2),
        reason:
          "Power BI's workspace scan failed: The workspace scan could not complete.",
      },
    ]);
    // The newer scan worked: nothing is left for the next read.
    expect(settlePowerBiScans(run.outcomes)).toEqual({
      unscanned: [],
      running: [],
    });
  });

  test("one Power BI no longer has (a 404) is scanned anew; one it could not answer about (a 500) is asked again by the next read", async () => {
    const gone: FakeScanner = fakeScanner();
    const goneRun: PowerBiScanRun = await runPowerBiScans({
      api: gone.api,
      workspaceIds: [],
      pickUp: [pending("unknown", ["a"])],
      timing: fakeTiming(),
      waitInMs: POWER_BI_SCHEDULED_SCAN_WAIT_IN_MS,
    });

    expect(posts(gone)).toHaveLength(1);
    expect(settlePowerBiScans(goneRun.outcomes)).toEqual({
      unscanned: [],
      running: [],
    });

    const flaky: FakeScanner = fakeScanner({
      started: [{ scanId: "earlier", workspaceIds: ["a"] }],
      onScanRequest: (): void => {
        throw new BiRequestError("Power BI answered 500: Internal error", 500);
      },
    });
    const flakyRun: PowerBiScanRun = await runPowerBiScans({
      api: flaky.api,
      workspaceIds: [],
      pickUp: [pending("earlier", ["a"])],
      timing: fakeTiming(),
      waitInMs: POWER_BI_SCHEDULED_SCAN_WAIT_IN_MS,
    });

    expect(posts(flaky)).toEqual([]);
    expect(flakyRun.running).toEqual([pending("earlier", ["a"])]);
  });

  test("one whose workspaces changed again gives only the others: those are scanned anew, and a scan left with none is followed to its end, its result unread", async () => {
    const scanner: FakeScanner = fakeScanner({
      started: [{ scanId: "earlier", workspaceIds: ["a", "b"] }],
    });
    const run: PowerBiScanRun = await runPowerBiScans({
      api: scanner.api,
      workspaceIds: ["a"],
      pickUp: [pending("earlier", ["a", "b"])],
      timing: fakeTiming(),
      waitInMs: POWER_BI_SCHEDULED_SCAN_WAIT_IN_MS,
    });

    // Only b is still the earlier scan's to give: a is scanned anew.
    expect(chunksOf(run)).toEqual([["b"], ["a"]]);

    const superseded: FakeScanner = fakeScanner({
      started: [{ scanId: "earlier", workspaceIds: ["a"] }],
    });

    await runPowerBiScans({
      api: superseded.api,
      workspaceIds: ["a"],
      pickUp: [pending("earlier", ["a"])],
      timing: fakeTiming(),
      waitInMs: POWER_BI_SCHEDULED_SCAN_WAIT_IN_MS,
    });

    // Followed until it ended, as Power BI counts it toward its 16 until then.
    expect(superseded.calls).toContain(
      "GET /admin/workspaces/scanStatus/earlier",
    );
    expect(superseded.calls).not.toContain(
      "GET /admin/workspaces/scanResult/earlier",
    );
  });

  test("scans picked up count toward the 16 Power BI runs at once", async () => {
    const earlier: Array<PowerBiPendingScan> = Array.from(
      { length: 10 },
      (_: unknown, index: number): PowerBiPendingScan => {
        return pending(`earlier-${index}`, [`old-${index}`]);
      },
    );
    const scanner: FakeScanner = fakeScanner({
      started: earlier,
      polls: (): number => {
        return 2;
      },
    });
    const run: PowerBiScanRun = await runPowerBiScans({
      api: scanner.api,
      workspaceIds: ids(2_000),
      pickUp: earlier,
      timing: fakeTiming(),
      waitInMs: POWER_BI_SCHEDULED_SCAN_WAIT_IN_MS,
    });

    expect(run.scanned).toHaveLength(30);
    expect(scanner.maxRunning).toBe(MAX_SIMULTANEOUS_SCANS);
  });

  test("a scan whose status Power BI asks to wait longer than a read does for is kept as it was; the scans running beside it go on", async () => {
    const scanner: FakeScanner = fakeScanner({
      started: [{ scanId: "first", workspaceIds: ["a"] }],
      polls: (): number => {
        return 1;
      },
      onScanRequest: (path: string): void => {
        if (path.endsWith("/first")) {
          throw new BiRequestError(
            "Power BI answered 429: Too many requests",
            429,
            45 * 60 * 1000,
          );
        }
      },
    });
    const run: PowerBiScanRun = await runPowerBiScans({
      api: scanner.api,
      workspaceIds: ids(250),
      pickUp: [pending("first", ["a"], "2026-11-19T08:00:00.000Z")],
      timing: fakeTiming(),
      waitInMs: POWER_BI_SCHEDULED_SCAN_WAIT_IN_MS,
    });

    expect(run.running).toEqual([
      pending("first", ["a"], "2026-11-19T08:00:00.000Z"),
    ]);
    // The three scans started beside it, before the refusal, are followed to their end and read.
    expect(chunksOf(run)).toHaveLength(3);
  });

  test("once starting a scan meets Power BI's limit, the scans picked up are still followed and read", async () => {
    const scanner: FakeScanner = fakeScanner({
      started: [
        { scanId: "first", workspaceIds: ["a"] },
        { scanId: "second", workspaceIds: ["b"] },
      ],
      polls: (workspaceIds: Array<string>): number => {
        // The picked-up scans finish after a few asks, long after the refusal.
        return ["a", "b"].includes(workspaceIds[0]!) ? 4 : 0;
      },
      onGetInfo: (): void => {
        throw new BiRequestError(
          "Power BI answered 429: Too many requests",
          429,
          45 * 60 * 1000,
        );
      },
    });
    const run: PowerBiScanRun = await runPowerBiScans({
      api: scanner.api,
      workspaceIds: ["c", ...ids(150)],
      pickUp: [
        pending("first", ["a"], "2026-11-19T08:00:00.000Z"),
        pending("second", ["b"], "2026-11-19T08:30:00.000Z"),
      ],
      timing: fakeTiming(),
      waitInMs: POWER_BI_SCHEDULED_SCAN_WAIT_IN_MS,
    });

    expect(chunksOf(run)).toEqual([["a"], ["b"]]);
    expect(run.running).toEqual([]);
    expect(
      run.unscanned.map((entry: PowerBiScanRun["unscanned"][number]) => {
        return entry.reason;
      }),
    ).toEqual([
      "Power BI asked for fewer requests for 45 minutes (its scanner takes 500 scans an hour, and 30 lists of workspaces); the next read goes on.",
      "Power BI asked for fewer requests for 45 minutes (its scanner takes 500 scans an hour, and 30 lists of workspaces); the next read goes on.",
    ]);
  });

  test("a scan of the read's own whose status could not be asked (a 503) is kept; one Power BI refuses to say of (a 403) is scanned anew next time", async () => {
    const flaky: FakeScanner = fakeScanner({
      onScanRequest: (): void => {
        throw new BiRequestError("Power BI answered 503: Unavailable", 503);
      },
    });
    const flakyRun: PowerBiScanRun = await runPowerBiScans({
      api: flaky.api,
      workspaceIds: ["a"],
      timing: fakeTiming(),
      waitInMs: POWER_BI_SCHEDULED_SCAN_WAIT_IN_MS,
    });

    expect(
      flakyRun.running.map((scan: PowerBiPendingScan): string => {
        return scan.scanId;
      }),
    ).toEqual(["scan-1"]);

    const refused: FakeScanner = fakeScanner({
      onScanRequest: (): void => {
        throw new BiRequestError("Power BI answered 403: Forbidden", 403);
      },
    });
    const refusedRun: PowerBiScanRun = await runPowerBiScans({
      api: refused.api,
      workspaceIds: ["a"],
      timing: fakeTiming(),
      waitInMs: POWER_BI_SCHEDULED_SCAN_WAIT_IN_MS,
    });

    expect(refusedRun.running).toEqual([]);
    expect(refusedRun.unscanned).toEqual([
      { workspaceIds: ["a"], reason: "Power BI answered 403: Forbidden" },
    ]);
  });
});

describe("what a read's scans leave for the next", () => {
  test("each workspace by its newest scan: a later scan's outcome wins, and a scan keeps only what no later one took", () => {
    expect(
      settlePowerBiScans([
        {
          kind: "running",
          scanId: "old",
          workspaceIds: ["a", "b"],
          startedAt: "2026-11-19T08:00:00.000Z",
        },
        { kind: "unscanned", workspaceIds: ["b", "c"], reason: "Failed." },
        {
          kind: "scanned",
          workspaceIds: ["c"],
          result: {},
          startedAt: "2026-11-19T08:30:00.000Z",
        },
        {
          kind: "running",
          scanId: "new",
          workspaceIds: ["d"],
          startedAt: "2026-11-19T09:00:00.000Z",
        },
      ]),
    ).toEqual({
      unscanned: [{ workspaceIds: ["b"], reason: "Failed." }],
      running: [
        {
          scanId: "old",
          workspaceIds: ["a"],
          startedAt: "2026-11-19T08:00:00.000Z",
        },
        {
          scanId: "new",
          workspaceIds: ["d"],
          startedAt: "2026-11-19T09:00:00.000Z",
        },
      ],
    });
  });

  test("a first read that read nothing does not say its workspaces show what was read before", () => {
    expect(
      describeRunningScans(
        [
          {
            scanId: "s",
            workspaceIds: ids(250),
            startedAt: "2026-11-19T09:00:00.000Z",
          },
        ],
        POWER_BI_SCHEDULED_SCAN_WAIT_IN_MS,
        { isFirstRead: true },
      ),
    ).toBe(
      "Power BI was still scanning 250 workspaces when the read stopped waiting after 20 minutes. The next read reads those scans once Power BI has finished them, rather than scanning again.",
    );
    expect(
      describeRunningScans([], POWER_BI_SCHEDULED_SCAN_WAIT_IN_MS),
    ).toBeNull();
  });
});

/*
 * Power BI counts a scan toward its 16 at once until its status says it
 * ended (#9901): Microsoft's guide says to wait for Succeeded or Failed
 * before starting another. A read that stopped waiting for a scan leaves
 * its place taken. Before, the place started the next chunk at once, could
 * not ask about it in time and went on, so a big tenant's read started
 * every chunk left, far past 16.
 */
describe("Power BI's 16 scans at once, as the read stops waiting", () => {
  function postsOf(scanner: FakeScanner): number {
    return scanner.calls.filter((call: string): boolean => {
      return call.startsWith("POST");
    }).length;
  }

  function scanIds(scans: Array<{ scanId: string }>): Array<string> {
    return scans.map((scan: { scanId: string }): string => {
      return scan.scanId;
    });
  }

  test("a place that leaves a scan running starts no other: 16 at most, the rest left for the next read", async () => {
    const scanner: FakeScanner = fakeScanner({
      polls: (): number => {
        return Number.POSITIVE_INFINITY;
      },
    });
    const run: PowerBiScanRun = await runPowerBiScans({
      api: scanner.api,
      workspaceIds: ids(4_000),
      timing: fakeTiming(),
      waitInMs: POWER_BI_SCHEDULED_SCAN_WAIT_IN_MS,
    });

    expect(scanner.maxRunning).toBe(MAX_SIMULTANEOUS_SCANS);
    expect(postsOf(scanner)).toBe(MAX_SIMULTANEOUS_SCANS);
    expect(
      run.running.flatMap((scan: PowerBiPendingScan): Array<string> => {
        return scan.workspaceIds;
      }),
    ).toEqual(ids(1_600));
    // The 24 chunks no place was free for: never started, so the next read scans them.
    expect(
      run.unscanned.flatMap(
        (entry: PowerBiScanRun["unscanned"][number]): Array<string> => {
          return entry.workspaceIds;
        },
      ),
    ).toEqual(ids(4_000).slice(1_600));
    expect(
      new Set(
        run.unscanned.map(
          (entry: PowerBiScanRun["unscanned"][number]): string => {
            return entry.reason;
          },
        ),
      ),
    ).toEqual(new Set([POWER_BI_SCANS_FULL_REASON]));
    expect(describeUnscannedWorkspaces(run.unscanned)).toBe(
      "2400 workspaces were not scanned this time: The read stopped waiting while Power BI was still running the 16 scans it allows at once. The next read scans them again, and until then they show what was read before.",
    );
  });

  test("a place whose scan ended takes the next, even as the wait runs out: one it cannot wait for is kept for the next read", async () => {
    // The first 16 chunks end after three asks; the 16 after them never do.
    const scanner: FakeScanner = fakeScanner({
      polls: (workspaceIds: Array<string>): number => {
        return Number(workspaceIds[0]!.split("-")[1]) < 1_600
          ? 3
          : Number.POSITIVE_INFINITY;
      },
    });
    const run: PowerBiScanRun = await runPowerBiScans({
      api: scanner.api,
      workspaceIds: ids(3_200),
      timing: fakeTiming(),
      waitInMs: POWER_BI_SCHEDULED_SCAN_WAIT_IN_MS,
    });

    expect(postsOf(scanner)).toBe(32);
    expect(scanner.maxRunning).toBe(MAX_SIMULTANEOUS_SCANS);
    expect(run.scanned).toHaveLength(16);
    expect(run.running).toHaveLength(16);
    expect(run.unscanned).toEqual([]);
  });

  test("scans picked up that no place reached are kept as they were, unasked, and none of the read's own starts", async () => {
    const startedAt: string = "2026-11-19T09:00:00.000Z";
    const kept: Array<PowerBiPendingScan> = Array.from(
      { length: 20 },
      (_: unknown, index: number): PowerBiPendingScan => {
        return {
          scanId: `s-${String(index).padStart(2, "0")}`,
          workspaceIds: ids(1, `p${index}`),
          startedAt,
        };
      },
    );
    const scanner: FakeScanner = fakeScanner({
      started: kept,
      polls: (): number => {
        return Number.POSITIVE_INFINITY;
      },
    });
    const run: PowerBiScanRun = await runPowerBiScans({
      api: scanner.api,
      workspaceIds: ids(5),
      pickUp: kept,
      timing: fakeTiming(),
      waitInMs: POWER_BI_SCHEDULED_SCAN_WAIT_IN_MS,
    });
    const asked: Set<string> = new Set(
      scanner.calls
        .filter((call: string): boolean => {
          return call.includes("/scanStatus/");
        })
        .map((call: string): string => {
          return call.split("/").pop()!;
        }),
    );

    // The 16 places each follow a picked-up scan to the wait's end.
    expect(Array.from(asked).sort()).toEqual(scanIds(kept.slice(0, 16)));
    // All 20 are kept for the next read, the 4 no place reached as they were.
    expect(scanIds(run.running)).toEqual(scanIds(kept));
    expect(run.running[19]).toEqual(kept[19]);
    expect(postsOf(scanner)).toBe(0);
    expect(run.unscanned).toEqual([
      { workspaceIds: ids(5), reason: POWER_BI_SCANS_FULL_REASON },
    ]);
  });
});
