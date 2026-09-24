import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  HOST_METRIC_DESCRIPTIONS,
  HostMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/HostMetricDescriptions";
import {
  activeStateMeta,
  computeSystemdAvailability,
  SystemdAvailability,
  unitTypeLabel,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/Utils/SystemdUnits";
import {
  startupModeLabel,
  statusMeta,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/Utils/WindowsServices";
import {
  expectReadableDescriptionRecord,
  expectTitleExplained,
  MAX_DESCRIPTION_LENGTH,
} from "./MetricDescriptionRules";
import AggregationIntervalUtil from "../../../Types/BaseDatabase/AggregationIntervalUtil";

/*
 * The (i) texts on the Host pages: the overview, one process, one Windows
 * service, one systemd unit, and the three lists. Each text has to say what
 * the page ACTUALLY computes, so beyond the shared readability rules these
 * pin the facts a customer would otherwise get wrong - which window a tile
 * averages, what a percentage is a share of, where a count is capped - and
 * cross-check the labels a text quotes against the helpers that produce the
 * labels on screen.
 */

const HOST_VIEW_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Pages",
  "Host",
  "View",
);

function readPage(file: string): string {
  return fs.readFileSync(path.join(HOST_VIEW_DIR, file), "utf8");
}

const D: Record<HostMetric, string> = HOST_METRIC_DESCRIPTIONS;

/*
 * Every title a Host page shows beside an (i), and the text it explains
 * with. The wiring suite (App/Tests/Dashboard/HostMetricTooltipWiring)
 * pins that each page really pairs them this way.
 */
const TITLED: Array<[string, HostMetric]> = [
  ["CPU", "cpu"],
  ["Memory", "memory"],
  ["Filesystem", "filesystem"],
  ["Load avg (1m)", "loadAverage"],
  ["Processes", "processes"],
  ["Availability", "availabilityChart"],
  ["CPU", "cpuChart"],
  ["Memory", "memoryChart"],
  ["Disk space", "diskSpaceChart"],
  ["Network", "networkChart"],
  ["Used / Total", "filesystemUsedTotal"],
  ["Utilization", "filesystemUtilization"],
  ["Process Count (cached)", "processCountCached"],
  ["CPU", "processCpu"],
  ["Memory (RSS)", "processMemoryRss"],
  ["Virtual Memory", "processVirtualMemory"],
  ["Threads", "processThreads"],
  ["CPU", "processCpuChart"],
  ["Memory (RSS)", "processMemoryRssChart"],
  ["Disk I/O", "processDiskIoChart"],
  ["Current Status", "serviceCurrentStatus"],
  ["Availability", "serviceAvailability"],
  ["Startup Mode", "serviceStartupMode"],
  ["State Changes", "serviceStateChanges"],
  ["Status timeline", "serviceStatusTimeline"],
  ["Current State", "unitCurrentState"],
  ["Availability", "unitAvailability"],
  ["Unit Type", "unitType"],
  ["State Changes", "unitStateChanges"],
  ["State timeline", "unitStateTimeline"],
  ["CPU", "processListCpu"],
  ["Memory", "processListMemory"],
  ["Status", "serviceListStatus"],
  ["Startup", "serviceListStartup"],
  ["State", "unitListState"],
  ["Type", "unitListType"],
];

const FIVE_MINUTE_TILES: Array<HostMetric> = [
  "cpu",
  "memory",
  "processCpu",
  "processMemoryRss",
  "processVirtualMemory",
  "processThreads",
];

const PER_INTERVAL_CHARTS: Array<HostMetric> = [
  "cpuChart",
  "memoryChart",
  "diskSpaceChart",
  "processCpuChart",
  "processMemoryRssChart",
  "processDiskIoChart",
];

const LAST_15_MINUTE_LISTS: Array<HostMetric> = [
  "processListCpu",
  "processListMemory",
  "serviceListStatus",
  "unitListState",
];

const SPLIT_CPU_READINGS: Array<HostMetric> = [
  "processCpu",
  "processCpuChart",
  "processListCpu",
];

// Word-boundary matchers, hoisted: eslint's wrap-regex fights prettier.
const RAW_METRIC_NAME: RegExp = /\b(system|process|windows|systemd)\.[a-z_]+/;
const PERCENTILE_TOKEN: RegExp = /\bp\d{2}\b/i;
const RATE_UNIT: RegExp = /bytes per second/i;
const WHOLE_RANGE: RegExp = /whole[- ]range/;

describe("HOST_METRIC_DESCRIPTIONS reads well", () => {
  test("every text passes the shared rules and none repeats another", () => {
    expectReadableDescriptionRecord(D, "HOST_METRIC_DESCRIPTIONS");
  });

  test("every text stays small - at most 260 characters and two sentences", () => {
    for (const [key, text] of Object.entries(D)) {
      expect({ key, length: text.length }).toEqual({
        key,
        length: Math.min(text.length, 260),
      });
      expect(text.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);

      const sentences: number = text
        .split(/[.!?](?:\s|$)/)
        .filter((part: string): boolean => {
          return part.trim().length > 0;
        }).length;

      expect({ key, sentences: sentences <= 2 }).toEqual({
        key,
        sentences: true,
      });
    }
  });

  test.each(TITLED)(
    "%s (%s) is explained by its text",
    (title: string, key: HostMetric) => {
      expectTitleExplained(title, D[key]);
    },
  );

  test("the title table covers every key exactly once", () => {
    const keys: Array<string> = TITLED.map(
      (entry: [string, HostMetric]): string => {
        return entry[1];
      },
    );

    expect([...keys].sort()).toEqual(Object.keys(D).sort());
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("no text names a percentile it would then have to explain", () => {
    for (const text of Object.values(D)) {
      expect(text).not.toMatch(PERCENTILE_TOKEN);
    }
  });

  test("raw metric names appear only where the customer needs them to act", () => {
    const naming: Array<string> = Object.entries(D)
      .filter((entry: [string, string]): boolean => {
        return RAW_METRIC_NAME.test(entry[1]);
      })
      .map((entry: [string, string]): string => {
        return entry[0];
      });

    // Threads and open fds are off by default in the collector.
    expect(naming).toEqual(["processThreads"]);
    expect(D.processThreads).toContain("process.threads");
    expect(D.processThreads).toContain("process.open_file_descriptors");
    expect(D.processThreads).toContain("turned on");
  });

  test("the one text shown as a visible caption is short", () => {
    /*
     * Detail has no tooltip slot, so "Process Count (cached)" shows its
     * text under the label - it has to stay a caption, not a paragraph.
     */
    expect(D.processCountCached.length).toBeLessThanOrEqual(200);
  });
});

describe("time windows are the ones the pages use", () => {
  test.each(FIVE_MINUTE_TILES)(
    "%s says it averages the last 5 minutes of the range",
    (key: HostMetric) => {
      expect(D[key]).toContain("averaged over the last 5 minutes of the range");
    },
  );

  test("overview CPU and memory admit the whole-range fallback on wide ranges", () => {
    /*
     * meanFromBuckets keeps buckets that START in the last 5 minutes; past
     * 12 hours a bucket is 15 minutes or wider, so usually none does and the
     * tile averages everything.
     */
    for (const key of ["cpu", "memory"] as Array<HostMetric>) {
      expect(D[key]).toContain("12 hours");
      expect(D[key]).toContain("whole-range average");
    }
  });

  test.each(FIVE_MINUTE_TILES)(
    "%s admits the whole-range fallback when nothing recent arrived",
    (key: HostMetric) => {
      /*
       * The same fallback fires when the last 5 minutes hold no bucket at
       * all - a host gone silent, a process that exited - so the tile shows
       * an old average instead of a dash. The text has to say so.
       */
      expect(D[key]).toContain("12 hours");
      expect(D[key]).toContain("no recent data");
      expect(D[key]).toMatch(WHOLE_RANGE);
    },
  );

  test.each(FIVE_MINUTE_TILES)(
    "%s says the wide-range fallback is usual, not certain",
    (key: HostMetric) => {
      /*
       * On a range over 12 hours a bucket STARTS inside the 5-minute tile
       * window only when a bucket boundary falls in it: with 15-minute
       * buckets that is a third of the time. So the tile is USUALLY - not
       * always - the whole-range average there.
       */
      expect(D[key]).toContain("usually");
    },
  );

  test("past 12 hours a bucket is at least three tile windows wide", () => {
    const end: Date = new Date("2026-09-24T12:00:00.000Z");
    const tileWindowMs: number = 5 * 60_000;

    const bucketMsFor: (hours: number) => number = (hours: number): number => {
      return AggregationIntervalUtil.getAggregationIntervalMs(
        AggregationIntervalUtil.getAggregationIntervalForWindow({
          startDate: new Date(end.getTime() - hours * 3_600_000),
          endDate: end,
        }),
      );
    };

    // Up to 12 hours a bucket is no wider than the tile window...
    expect(bucketMsFor(3)).toBeLessThanOrEqual(tileWindowMs);
    expect(bucketMsFor(12)).toBeLessThanOrEqual(tileWindowMs);
    // ...past it, a bucket starts in the window a third of the time at most.
    for (const hours of [13, 24, 72, 24 * 7, 24 * 30]) {
      expect(bucketMsFor(hours)).toBeGreaterThanOrEqual(3 * tileWindowMs);
    }
  });

  test("the pages really fall back to the whole range when no bucket is recent", () => {
    for (const page of ["Overview.tsx", "ProcessView.tsx"]) {
      const source: string = readPage(page);

      expect(source).toContain("t < tileWindowStartMs");
      expect(source).toContain("if (count === 0) {");
    }
  });

  test("the filesystem tile says it is a whole-range average, not a 5-minute one", () => {
    expect(D.filesystem).toContain("whole selected range");
    expect(D.filesystem).toContain("not the last 5 minutes");
    expect(D.filesystemUsedTotal).toContain("averaged over the selected range");
    expect(D.filesystemUtilization).toContain(
      "averaged over the selected range",
    );
  });

  test("load average and processes are the newest interval, not a mean", () => {
    expect(D.loadAverage).toContain("newest interval");
    expect(D.processes).toContain("newest interval");
    expect(D.loadAverage).not.toContain("5 minutes");
  });

  test.each(PER_INTERVAL_CHARTS)(
    "%s describes one value per interval",
    (key: HostMetric) => {
      expect(D[key]).toContain("each interval");
    },
  );

  test.each(LAST_15_MINUTE_LISTS)(
    "%s says the list ignores the time picker and reads the last 15 minutes",
    (key: HostMetric) => {
      expect(D[key]).toContain("last 15 minutes");
      expect(D[key]).not.toContain("selected range");
    },
  );

  test("the lists really look back 15 minutes", () => {
    expect(readPage("Processes.tsx")).toContain(
      "const PROCESS_LOOKBACK_MINUTES: number = 15;",
    );
    expect(readPage("Services.tsx")).toContain(
      "const SERVICE_LOOKBACK_MINUTES: number = 15;",
    );
    expect(readPage("SystemdUnits.tsx")).toContain(
      "const UNIT_LOOKBACK_MINUTES: number = 15;",
    );
  });

  test("the overview and process tiles really use a 5-minute window", () => {
    for (const page of ["Overview.tsx", "ProcessView.tsx"]) {
      expect(readPage(page)).toContain(
        "const TILE_WINDOW_MINUTES: number = 5;",
      );
    }
  });
});

describe("denominators, units and caps", () => {
  test("CPU texts say 100% is every core, not one core", () => {
    expect(D.cpu).toContain("across all cores");
    expect(D.cpu).toContain("100% means every core was busy");
    expect(D.cpuChart).toContain("100% means every core was busy");
    expect(D.processCpu).toContain("share of all host CPU cores");
    expect(D.processCpuChart).toContain("total CPU capacity");
    expect(D.processListCpu).toContain("all cores together");
  });

  test("load average is compared with the core count and can pass 100%", () => {
    expect(D.loadAverage).toContain("number of cores");
    expect(D.loadAverage).toContain("over 100% means work is queuing");
    // The tile's danger threshold is exactly that 100%.
    expect(readPage("Overview.tsx")).toContain(
      "thresholds={{ warn: 70, danger: 100 }}",
    );
  });

  test("filesystem percentages count reserved space in the total", () => {
    for (const key of [
      "filesystem",
      "diskSpaceChart",
      "filesystemUsedTotal",
      "filesystemUtilization",
    ] as Array<HostMetric>) {
      expect(D[key].toLowerCase()).toContain("reserved");
    }
    expect(D.filesystem).toContain("largest filesystem");
    expect(D.diskSpaceChart).toContain("same mount as the Filesystem tile");
  });

  test("the filesystem utilization bar colours match the table", () => {
    const overview: string = readPage("Overview.tsx");

    expect(D.filesystemUtilization).toContain("amber at 75%");
    expect(D.filesystemUtilization).toContain("red at 90%");
    expect(overview).toContain("pct >= 90");
    expect(overview).toContain("pct >= 75");
  });

  test("sizes are called out as 1024-based, as formatMemoryBytes renders them", () => {
    expect(D.filesystemUsedTotal).toContain("1024-based");
    expect(D.filesystemUsedTotal).toContain("1 GiB is 1,024 MiB");
    expect(readPage("Overview.tsx")).toContain(
      'const units: Array<string> = ["B", "KiB", "MiB", "GiB", "TiB"];',
    );
  });

  test("process memory is compared with the host's total RAM", () => {
    expect(D.processMemoryRss).toContain("host's total RAM");
    expect(D.processListMemory).toContain("host's total RAM");
  });

  test("the process list memory bar colours match memBarColor", () => {
    const processes: string = readPage("Processes.tsx");

    expect(D.processListMemory).toContain("amber at 10%");
    expect(D.processListMemory).toContain("red at 20%");
    expect(processes).toContain("if (value >= 20) {");
    expect(processes).toContain("if (value >= 10) {");
  });

  test("network is bytes per second, summed over every interface, loopback included", () => {
    expect(D.networkChart).toMatch(RATE_UNIT);
    expect(D.networkChart).toContain("(In)");
    expect(D.networkChart).toContain("(Out)");
    expect(D.networkChart).toContain("every network interface");
    expect(D.networkChart).toContain("loopback");
    expect(D.processDiskIoChart).toMatch(RATE_UNIT);
  });

  test("service and unit availability name the 2,000-sample cap the pages fetch", () => {
    for (const key of [
      "serviceAvailability",
      "unitAvailability",
    ] as Array<HostMetric>) {
      expect(D[key]).toContain("newest 2,000 samples");
      expect(D[key]).toContain("capped");
    }

    expect(readPage("ServiceView.tsx")).toContain(
      "const SAMPLE_FETCH_LIMIT: number = 2000;",
    );
    expect(readPage("SystemdUnitView.tsx")).toContain(
      "const SAMPLE_FETCH_LIMIT: number = 2000;",
    );
  });

  test("the cached process count says it is not live, and how often it moves", () => {
    /*
     * Host.processCount is written by ingest through ResourceHeartbeat, whose
     * enrichment gate admits one write per 60-second window (plus up to 25%
     * jitter) - "about once a minute", not "every few minutes".
     */
    expect(D.processCountCached).toContain("any state");
    expect(D.processCountCached).toContain("at most about once a minute");
    expect(D.processes).toContain("at most about once a minute");
    expect(D.processes).not.toContain("every few minutes");
    // The total is the tile's sublabel, printed under the number.
    expect(D.processes).toContain("the total on the line below");
  });

  test("the cached process count's refresh rate is the host heartbeat window", () => {
    const hostService: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "Server",
        "Services",
        "HostService.ts",
      ),
      "utf8",
    );

    expect(hostService).toContain(
      "const LAST_SEEN_THROTTLE_SECONDS: number = 60;",
    );
    expect(hostService).toContain("metadata.processCount = extra.processCount");
    expect(hostService).toContain(
      "throttleInSeconds: LAST_SEEN_THROTTLE_SECONDS",
    );
  });

  test("the Windows fallback of the Processes tile is disclosed", () => {
    expect(D.processes).toContain("Windows");
    expect(D.processes).toContain("every process seen in the last 5 minutes");
  });

  test("the availability chart explains the uptime badge and the unjudged edge", () => {
    expect(D.availabilityChart).toContain("uptime badge");
    expect(D.availabilityChart).toContain("Up if");
    expect(D.availabilityChart).toContain("Down if");
    expect(D.availabilityChart).toContain("newest interval is not judged");
  });
});

describe("honest about how process CPU is read", () => {
  test.each(SPLIT_CPU_READINGS)(
    "%s says the collector's user, system and wait readings are not added up",
    (key: HostMetric) => {
      expect(D[key]).toContain("user, system and wait");
    },
  );

  test("the tile and chart say they read about a third of the real use", () => {
    expect(D.processCpu).toContain("about a third of the real use");
    expect(D.processCpuChart).toContain("about a third of the real use");
  });

  test("the list says it shows only one of the readings", () => {
    expect(D.processListCpu).toContain("only one of them");
  });

  test("the pages still read process CPU the way the texts describe", () => {
    /*
     * If someone fixes the aggregation (filter or sum the states), these
     * texts must change with it - this test is the reminder.
     */
    const processView: string = readPage("ProcessView.tsx");
    const processes: string = readPage("Processes.tsx");

    expect(processView).toContain('"process.cpu.utilization",');
    expect(processView).not.toContain('state: "user"');
    expect(processes).toContain('buildQuery("process.cpu.utilization")');
    expect(processes).toContain(
      "// Skip — first datapoint per key is the most recent (sorted DESC).",
    );
  });
});

describe("state texts quote the labels the pages render", () => {
  test("Windows status texts use statusMeta's labels", () => {
    for (const code of [4, 1, 7]) {
      const label: string = statusMeta(code).label;

      expect(D.serviceCurrentStatus).toContain(label);
      expect(D.serviceListStatus).toContain(label);
    }
    expect(D.serviceAvailability).toContain(statusMeta(4).label);
  });

  test("Windows status texts cover all four in-progress states", () => {
    /*
     * statusMeta has four pending states: start (2), stop (3), continue (5,
     * resuming a paused service) and pause (6). The texts name each one in
     * plain words rather than quoting "Continue pending".
     */
    expect(
      [2, 3, 5, 6].map((code: number): string => {
        return statusMeta(code).label;
      }),
    ).toEqual([
      "Start pending",
      "Stop pending",
      "Continue pending",
      "Pause pending",
    ]);

    for (const key of [
      "serviceCurrentStatus",
      "serviceListStatus",
    ] as Array<HostMetric>) {
      expect(D[key]).toContain(
        "a start, stop, pause or resume still in progress",
      );
    }
  });

  test("startup texts use startupModeLabel's labels", () => {
    for (const mode of [
      "auto_start",
      "demand_start",
      "disabled",
      "boot_start",
      "system_start",
    ]) {
      const label: string = startupModeLabel(mode);

      expect(D.serviceStartupMode).toContain(label);
      expect(D.serviceListStartup).toContain(label);
    }
  });

  test("systemd state texts use activeStateMeta's labels", () => {
    for (const state of ["active", "inactive", "failed", "activating"]) {
      expect(D.unitCurrentState).toContain(activeStateMeta(state).label);
    }
    for (const state of ["active", "failed"]) {
      expect(D.unitListState).toContain(activeStateMeta(state).label);
    }
    expect(D.unitListState).toContain(activeStateMeta(null).label);
  });

  test("unit type texts use unitTypeLabel's labels", () => {
    expect(D.unitType).toContain(unitTypeLabel("nginx.service"));
    expect(D.unitType).toContain(unitTypeLabel("docker.socket"));
    expect(D.unitType).toContain(unitTypeLabel("logrotate.timer"));
    expect(D.unitListType).toContain(unitTypeLabel("nginx.service"));
    expect(D.unitListType).toContain(unitTypeLabel("logrotate.timer"));
  });

  test("unit availability counts Reloading as not active, as the text says", () => {
    const availability: SystemdAvailability = computeSystemdAvailability([
      { time: new Date(0), state: "active" },
      { time: new Date(30_000), state: "reloading" },
      { time: new Date(60_000), state: "active" },
      { time: new Date(90_000), state: "refreshing" },
    ]);

    expect(availability.percent).toBe(50);
    expect(D.unitAvailability).toContain("Reloading counts as not active");
    expect(D.unitAvailability).toContain("Active");
  });

  test("timelines say they show the worst state, as the Min x-axis does", () => {
    expect(D.serviceStatusTimeline).toContain("worst status");
    expect(D.unitStateTimeline).toContain("worst state");
    expect(readPage("ServiceView.tsx")).toContain(
      "aggregateType: XAxisAggregateType.Min",
    );
    expect(readPage("SystemdUnitView.tsx")).toContain(
      "aggregateType: XAxisAggregateType.Min",
    );
  });

  test("state-change counts admit what sampling cannot see", () => {
    expect(D.serviceStateChanges).toContain("between two samples is not seen");
    expect(D.unitStateChanges).toContain("between two samples is not seen");
  });
});
