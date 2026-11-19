import { describe, expect, test } from "@jest/globals";
import BiRequestError from "../../../../Server/Utils/DataObservability/Bi/BiRequestError";
import {
  askPowerBi,
  chunkWorkspaces,
  describeUnscannedWorkspaces,
  listPowerBiWorkspaces,
  MAX_SIMULTANEOUS_SCANS,
  POWER_BI_ASKED_SCAN_WAIT_IN_MS,
  POWER_BI_SCAN_QUERY,
  POWER_BI_SCHEDULED_SCAN_WAIT_IN_MS,
  PowerBiLimitError,
  PowerBiScannerApi,
  PowerBiScanRun,
  PowerBiScanTiming,
  runPowerBiScans,
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
 * what `status` says), and its result names each of its workspaces.
 */
function fakeScanner(
  data: {
    polls?: (workspaceIds: Array<string>) => number;
    status?: (workspaceIds: Array<string>) => JSONObject | null;
    onGetInfo?: (call: number) => void;
    listed?: Array<JSONObject>;
  } = {},
): FakeScanner {
  const scans: Map<string, { workspaceIds: Array<string>; asked: number }> =
    new Map();
  let running: number = 0;
  let getInfoCalls: number = 0;
  const scanner: FakeScanner = {
    calls: [],
    maxRunning: 0,
    api: {
      get: async (path: string): Promise<unknown> => {
        scanner.calls.push(`GET ${path}`);

        if (path.startsWith("/admin/workspaces/modified")) {
          return data.listed || [];
        }

        const scanId: string = decodeURIComponent(path.split("/").pop()!);
        const scan: { workspaceIds: Array<string>; asked: number } =
          scans.get(scanId)!;

        if (path.startsWith("/admin/workspaces/scanStatus/")) {
          scan.asked++;

          const said: JSONObject | null = data.status
            ? data.status(scan.workspaceIds)
            : null;

          if (said) {
            running--;
            return said;
          }

          if (scan.asked > (data.polls ? data.polls(scan.workspaceIds) : 0)) {
            running--;
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

  test("a scan that does not finish within the read's wait is left unscanned, and says so", async () => {
    const scheduled: ReturnType<typeof fakeTiming> = fakeTiming();
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
    expect(run.unscanned).toEqual([
      {
        workspaceIds: ids(3),
        reason: "Power BI's workspace scan did not finish within 20 minutes.",
      },
    ]);
    // It stopped asking at the wait's end, not after.
    expect(
      scheduled.waits.reduce((total: number, ms: number): number => {
        return total + ms;
      }, 0),
    ).toBeLessThanOrEqual(POWER_BI_SCHEDULED_SCAN_WAIT_IN_MS);

    const asked: PowerBiScanRun = await runPowerBiScans({
      api: never().api,
      workspaceIds: ids(3),
      timing: fakeTiming(),
      waitInMs: POWER_BI_ASKED_SCAN_WAIT_IN_MS,
    });

    expect(asked.unscanned[0]!.reason).toBe(
      "Power BI's workspace scan did not finish within 4 minutes.",
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
