import { describe, expect, test } from "@jest/globals";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  DEFAULT_PROCESS_SORT,
  PROCESS_COMMAND_ATTR,
  PROCESS_CPU_MODE_ATTR,
  PROCESS_CPU_MODE_IOWAIT,
  PROCESS_CPU_STATE_ATTR,
  PROCESS_CPU_STATE_WAIT,
  PROCESS_CPU_UTILIZATION_METRIC_NAME,
  PROCESS_MEMORY_USAGE_METRIC_NAME,
  PROCESS_NAME_ATTR,
  PROCESS_OWNER_ATTR,
  PROCESS_PID_ATTR,
  PROCESS_SORT_KEYS,
  ProcessMetricDatapoint,
  ProcessRollup,
  ProcessRow,
  ProcessSort,
  ProcessSortKey,
  buildProcessRows,
  defaultSortOrderFor,
  filterProcessRows,
  isProcessFetchCutOff,
  isProcessSortKey,
  processCpuWaitExclusion,
  processSearchTerms,
  resolveProcessSort,
  sortProcessRows,
} from "../../FeatureSet/Dashboard/src/Pages/Host/Utils/Processes";

/*
 * The Processes tab reads two metrics from the OTel hostmetrics `process`
 * scraper, and the one people sort by is the awkward one: a process's CPU is
 * not one reading but one per mode - user, system and (on Linux) wait - all
 * stamped with the same timestamp. From otelcol-contrib v0.158.0 a feature
 * gate can send every one of those readings twice, once under `state` and once
 * under the semantic-convention `cpu.mode`.
 *
 * Every way of reading that wrong is silent. Take the first reading per
 * process (what the list used to do) and the column shows whichever mode
 * ClickHouse returned first, so "sort by CPU" orders processes by a coin toss.
 * Add every reading and the wait time - time spent blocked on disk, not CPU -
 * inflates disk-heavy processes, and the v1 gate doubles everything. So the
 * rules live in a pure module and are pinned here against the exact shapes
 * the scraper emits (receiver/hostmetricsreceiver/.../processscraper).
 */

const NOW: string = "2026-10-06T12:00:30.000Z";
const BEFORE: string = "2026-10-06T12:00:00.000Z";
const LONG_AGO: string = "2026-10-06T11:50:00.000Z";
const GIB: number = 1024 * 1024 * 1024;

interface Identity {
  pid: string | number;
  exe: string;
  command?: string;
  owner?: string;
}

function identityAttributes(identity: Identity): Record<string, unknown> {
  const attributes: Record<string, unknown> = {
    [PROCESS_PID_ATTR]: identity.pid,
    [PROCESS_NAME_ATTR]: identity.exe,
    "resource.host.name": "web-01",
  };
  if (identity.command !== undefined) {
    attributes[PROCESS_COMMAND_ATTR] = identity.command;
  }
  if (identity.owner !== undefined) {
    attributes[PROCESS_OWNER_ATTR] = identity.owner;
  }
  return attributes;
}

function cpuReading(
  identity: Identity,
  time: string,
  value: number | string | null,
  modeAttributes: Record<string, string>,
): ProcessMetricDatapoint {
  return {
    time: time,
    value: value,
    attributes: { ...identityAttributes(identity), ...modeAttributes },
  };
}

// One scrape from the Linux scraper: user, system and wait under `state`.
function linuxScrape(
  identity: Identity,
  time: string,
  readings: { user: number; system: number; wait: number },
): Array<ProcessMetricDatapoint> {
  return [
    cpuReading(identity, time, readings.user, { state: "user" }),
    cpuReading(identity, time, readings.system, { state: "system" }),
    cpuReading(identity, time, readings.wait, { state: "wait" }),
  ];
}

// The Windows scraper never reports wait.
function windowsScrape(
  identity: Identity,
  time: string,
  readings: { user: number; system: number },
): Array<ProcessMetricDatapoint> {
  return [
    cpuReading(identity, time, readings.user, { state: "user" }),
    cpuReading(identity, time, readings.system, { state: "system" }),
  ];
}

function memoryReading(
  identity: Identity,
  time: string,
  value: number | string | null,
): ProcessMetricDatapoint {
  return { time: time, value: value, attributes: identityAttributes(identity) };
}

function rollup(input: {
  cpu?: Array<ProcessMetricDatapoint>;
  memory?: Array<ProcessMetricDatapoint>;
  totalMemoryBytes?: number | null;
}): ProcessRollup {
  return buildProcessRows({
    cpuDatapoints: input.cpu || [],
    memoryDatapoints: input.memory || [],
    totalMemoryBytes:
      input.totalMemoryBytes === undefined ? 16 * GIB : input.totalMemoryBytes,
  });
}

function onlyRow(result: ProcessRollup): ProcessRow {
  expect(result.rows).toHaveLength(1);
  return result.rows[0]!;
}

function rowNamed(result: ProcessRollup, exe: string): ProcessRow {
  const row: ProcessRow | undefined = result.rows.find((r: ProcessRow) => {
    return r.executable === exe;
  });
  expect(row).toBeDefined();
  return row!;
}

function row(overrides: Partial<ProcessRow>): ProcessRow {
  const pid: string = overrides.pid ?? "1";
  const executable: string = overrides.executable ?? "proc";
  return {
    key: `${pid}-${executable}`,
    pid: pid,
    executable: executable,
    command: null,
    user: null,
    cpuPercent: null,
    memoryBytes: null,
    memoryPercent: null,
    ...overrides,
  };
}

function names(rows: Array<ProcessRow>): Array<string> {
  return rows.map((r: ProcessRow): string => {
    return r.executable;
  });
}

function pids(rows: Array<ProcessRow>): Array<string> {
  return rows.map((r: ProcessRow): string => {
    return r.pid;
  });
}

const POSTGRES: Identity = {
  pid: 4321,
  exe: "postgres",
  command: "/usr/lib/postgresql/16/bin/postgres",
  owner: "postgres",
};
const NGINX: Identity = {
  pid: 99,
  exe: "nginx",
  command: "nginx: master process /usr/sbin/nginx",
  owner: "root",
};

describe("process metric contract", () => {
  test("reads the two metrics the scraper emits", () => {
    expect(PROCESS_CPU_UTILIZATION_METRIC_NAME).toBe("process.cpu.utilization");
    expect(PROCESS_MEMORY_USAGE_METRIC_NAME).toBe("process.memory.usage");
  });

  test("identity is resource-prefixed, the CPU mode is not", () => {
    /*
     * The scraper puts identity on the Resource and the mode on the
     * datapoint; ingest prefixes only resource attributes. Swapping them
     * matches nothing and errors nowhere.
     */
    expect(PROCESS_PID_ATTR).toBe("resource.process.pid");
    expect(PROCESS_NAME_ATTR).toBe("resource.process.executable.name");
    expect(PROCESS_COMMAND_ATTR).toBe("resource.process.command");
    expect(PROCESS_OWNER_ATTR).toBe("resource.process.owner");
    expect(PROCESS_CPU_STATE_ATTR).toBe("state");
    expect(PROCESS_CPU_MODE_ATTR).toBe("cpu.mode");
  });

  test("names wait the way each attribute spells it", () => {
    // `state` enum: system, user, wait. `cpu.mode` enum: system, user, iowait.
    expect(PROCESS_CPU_STATE_WAIT).toBe("wait");
    expect(PROCESS_CPU_MODE_IOWAIT).toBe("iowait");
  });

  test("the CPU query leaves out wait under both spellings", () => {
    const exclusion: Record<
      string,
      NotEqual<string>
    > = processCpuWaitExclusion();

    expect(Object.keys(exclusion).sort()).toEqual(["cpu.mode", "state"]);
    expect(exclusion["state"]).toBeInstanceOf(NotEqual);
    expect(exclusion["state"]!.value).toBe("wait");
    expect(exclusion["cpu.mode"]).toBeInstanceOf(NotEqual);
    expect(exclusion["cpu.mode"]!.value).toBe("iowait");
  });

  test("the exclusion never filters on equality, which would drop the other spelling", () => {
    /*
     * A reading carries `state`, `cpu.mode` or both. `state = user` would
     * drop every reading that only carries `cpu.mode`; `!=` keeps it,
     * because a missing key reads as "" in ClickHouse.
     */
    for (const filter of Object.values(processCpuWaitExclusion())) {
      expect(filter.constructor.name).toBe("NotEqual");
    }
  });

  test("hands out a fresh filter per query", () => {
    expect(processCpuWaitExclusion()).not.toBe(processCpuWaitExclusion());
    expect(processCpuWaitExclusion()["state"]).not.toBe(
      processCpuWaitExclusion()["state"],
    );
  });
});

describe("a process's CPU is its user plus system time at its newest scrape", () => {
  test("Linux: adds user and system, leaves wait out", () => {
    const result: ProcessRollup = rollup({
      cpu: linuxScrape(POSTGRES, NOW, { user: 0.3, system: 0.06, wait: 0.2 }),
    });

    expect(onlyRow(result).cpuPercent).toBeCloseTo(36, 10);
  });

  test("Windows: adds user and system", () => {
    const result: ProcessRollup = rollup({
      cpu: windowsScrape({ pid: 784, exe: "java.exe" }, NOW, {
        user: 0.003,
        system: 0.001,
      }),
    });

    expect(onlyRow(result).cpuPercent).toBeCloseTo(0.4, 10);
  });

  test("is not whichever single reading came back first", () => {
    /*
     * The regression: the old list kept the first reading per process. In
     * this order that is the wait reading, so postgres read 20% - a number
     * made of disk waits - and in another order it would read 6%.
     */
    const scrape: Array<ProcessMetricDatapoint> = linuxScrape(POSTGRES, NOW, {
      user: 0.3,
      system: 0.06,
      wait: 0.2,
    });

    for (const order of [
      [2, 0, 1],
      [1, 2, 0],
      [0, 1, 2],
    ]) {
      const result: ProcessRollup = rollup({
        cpu: order.map((i: number): ProcessMetricDatapoint => {
          return scrape[i]!;
        }),
      });
      expect(onlyRow(result).cpuPercent).toBeCloseTo(36, 10);
    }
  });

  test("never adds wait, even when a query lets it through", () => {
    const busy: ProcessRollup = rollup({
      cpu: linuxScrape(POSTGRES, NOW, { user: 0.01, system: 0.01, wait: 0.9 }),
    });

    expect(onlyRow(busy).cpuPercent).toBeCloseTo(2, 10);
  });

  test("never adds iowait under the semantic-convention attribute", () => {
    const result: ProcessRollup = rollup({
      cpu: [
        cpuReading(POSTGRES, NOW, 0.1, { "cpu.mode": "user" }),
        cpuReading(POSTGRES, NOW, 0.05, { "cpu.mode": "system" }),
        cpuReading(POSTGRES, NOW, 0.5, { "cpu.mode": "iowait" }),
      ],
    });

    expect(onlyRow(result).cpuPercent).toBeCloseTo(15, 10);
  });

  test("counts each mode once when the v1 gate sends every reading twice", () => {
    /*
     * EmitV1SystemConventions without DontEmitV0SystemConventions: the old
     * reading carries `state`, its v1 copy carries `cpu.mode` and `state`,
     * both under the same metric name and timestamp. Adding them all would
     * double every process's CPU.
     */
    const result: ProcessRollup = rollup({
      cpu: [
        cpuReading(POSTGRES, NOW, 0.3, { state: "user" }),
        cpuReading(POSTGRES, NOW, 0.06, { state: "system" }),
        cpuReading(POSTGRES, NOW, 0.3, { "cpu.mode": "user", state: "user" }),
        cpuReading(POSTGRES, NOW, 0.06, {
          "cpu.mode": "system",
          state: "system",
        }),
      ],
    });

    expect(onlyRow(result).cpuPercent).toBeCloseTo(36, 10);
  });

  test("reads the v1 shape alone, when the old readings are switched off", () => {
    const result: ProcessRollup = rollup({
      cpu: [
        cpuReading(NGINX, NOW, 0.02, { "cpu.mode": "user" }),
        cpuReading(NGINX, NOW, 0.03, { "cpu.mode": "system" }),
      ],
    });

    expect(onlyRow(result).cpuPercent).toBeCloseTo(5, 10);
  });

  test("ignores the case of the mode", () => {
    const result: ProcessRollup = rollup({
      cpu: [
        cpuReading(NGINX, NOW, 0.02, { state: "User" }),
        cpuReading(NGINX, NOW, 0.03, { state: "SYSTEM" }),
        cpuReading(NGINX, NOW, 0.5, { "cpu.mode": "IOWait" }),
      ],
    });

    expect(onlyRow(result).cpuPercent).toBeCloseTo(5, 10);
  });

  test("uses only the newest scrape, whatever order the readings arrive in", () => {
    const older: Array<ProcessMetricDatapoint> = linuxScrape(POSTGRES, BEFORE, {
      user: 0.9,
      system: 0.09,
      wait: 0,
    });
    const newer: Array<ProcessMetricDatapoint> = linuxScrape(POSTGRES, NOW, {
      user: 0.1,
      system: 0.02,
      wait: 0,
    });

    expect(
      onlyRow(rollup({ cpu: [...newer, ...older] })).cpuPercent,
    ).toBeCloseTo(12, 10);
    expect(
      onlyRow(rollup({ cpu: [...older, ...newer] })).cpuPercent,
    ).toBeCloseTo(12, 10);
  });

  test("does not mix modes from two scrapes", () => {
    // Newest scrape: user only. The older system reading must not be added.
    const result: ProcessRollup = rollup({
      cpu: [
        cpuReading(POSTGRES, NOW, 0.1, { state: "user" }),
        cpuReading(POSTGRES, BEFORE, 0.4, { state: "system" }),
      ],
    });

    expect(onlyRow(result).cpuPercent).toBeCloseTo(10, 10);
  });

  test("takes a reading that names no mode as the process's whole CPU", () => {
    const result: ProcessRollup = rollup({
      cpu: [cpuReading(NGINX, NOW, 0.25, {})],
    });

    expect(onlyRow(result).cpuPercent).toBeCloseTo(25, 10);
  });

  test("prefers the per-mode readings over a modeless one at the same scrape", () => {
    const result: ProcessRollup = rollup({
      cpu: [
        cpuReading(NGINX, NOW, 0.9, {}),
        cpuReading(NGINX, NOW, 0.02, { state: "user" }),
        cpuReading(NGINX, NOW, 0.03, { state: "system" }),
      ],
    });

    expect(onlyRow(result).cpuPercent).toBeCloseTo(5, 10);
  });

  test("has no CPU when the newest scrape holds only wait", () => {
    const result: ProcessRollup = rollup({
      cpu: [cpuReading(NGINX, NOW, 0.4, { state: "wait" })],
    });

    expect(onlyRow(result).cpuPercent).toBeNull();
  });

  test("an idle process reads 0%, not unknown", () => {
    const result: ProcessRollup = rollup({
      cpu: windowsScrape({ pid: 772, exe: "services.exe" }, NOW, {
        user: 0,
        system: 0,
      }),
    });

    expect(onlyRow(result).cpuPercent).toBe(0);
  });

  test("reads numbers that come back as strings, and never a blank as zero", () => {
    const fromStrings: ProcessRollup = rollup({
      cpu: [
        cpuReading(NGINX, NOW, "0.02", { state: "user" }),
        cpuReading(NGINX, NOW, "0.03", { state: "system" }),
      ],
    });
    expect(onlyRow(fromStrings).cpuPercent).toBeCloseTo(5, 10);

    const blank: ProcessRollup = rollup({
      cpu: [
        cpuReading(NGINX, NOW, "", { state: "user" }),
        cpuReading(NGINX, NOW, "  ", { state: "system" }),
      ],
    });
    expect(onlyRow(blank).cpuPercent).toBeNull();
  });

  test("skips readings that are not finite numbers", () => {
    const result: ProcessRollup = rollup({
      cpu: [
        cpuReading(NGINX, NOW, "not-a-number", { state: "user" }),
        cpuReading(NGINX, NOW, null, { state: "system" }),
        cpuReading(NGINX, BEFORE, 0.07, { state: "user" }),
      ],
    });

    // The newest usable reading is the older one; the broken ones never win.
    expect(onlyRow(result).cpuPercent).toBeCloseTo(7, 10);
  });
});

describe("one row per process", () => {
  test("lists every process from either metric", () => {
    const result: ProcessRollup = rollup({
      cpu: linuxScrape(POSTGRES, NOW, { user: 0.1, system: 0, wait: 0 }),
      memory: [memoryReading(NGINX, NOW, 100 * 1024 * 1024)],
    });

    expect(names(result.rows).sort()).toEqual(["nginx", "postgres"]);
    expect(rowNamed(result, "postgres").memoryBytes).toBeNull();
    expect(rowNamed(result, "nginx").cpuPercent).toBeNull();
  });

  test("keeps a recycled pid apart from the process that had it before", () => {
    const result: ProcessRollup = rollup({
      memory: [
        memoryReading({ pid: 500, exe: "bash" }, NOW, 1),
        memoryReading({ pid: 500, exe: "python3" }, BEFORE, 2),
      ],
    });

    expect(names(result.rows).sort()).toEqual(["bash", "python3"]);
    expect(
      result.rows.map((r: ProcessRow): string => {
        return r.key;
      }),
    ).toEqual(expect.arrayContaining(["500-bash", "500-python3"]));
  });

  test("reads a numeric pid as text", () => {
    const result: ProcessRollup = rollup({
      memory: [memoryReading({ pid: 784, exe: "java.exe" }, NOW, 1)],
    });

    expect(onlyRow(result).pid).toBe("784");
  });

  test("skips a reading with neither pid nor name", () => {
    const result: ProcessRollup = rollup({
      memory: [
        {
          time: NOW,
          value: 5,
          attributes: { "resource.host.name": "web-01" },
        },
        { time: NOW, value: 5, attributes: null },
        { time: NOW, value: 5 },
      ],
    });

    expect(result.rows).toEqual([]);
  });

  test("leaves the name empty when the scraper sent none, for the page to fill in", () => {
    const result: ProcessRollup = rollup({
      memory: [
        {
          time: NOW,
          value: 5,
          attributes: { [PROCESS_PID_ATTR]: "4", [PROCESS_NAME_ATTR]: "  " },
        },
      ],
    });

    expect(onlyRow(result).executable).toBe("");
    expect(onlyRow(result).pid).toBe("4");
  });

  test("takes command and owner from whichever reading carries them, trimmed", () => {
    const result: ProcessRollup = rollup({
      cpu: [
        cpuReading({ pid: 1216, exe: "svchost.exe" }, NOW, 0.01, {
          state: "user",
        }),
      ],
      memory: [
        memoryReading(
          {
            pid: 1216,
            exe: "svchost.exe",
            command: "  C:\\WINDOWS\\system32\\svchost.exe ",
            owner: "NT AUTHORITY\\NETWORK SERVICE",
          },
          NOW,
          10 * 1024 * 1024,
        ),
      ],
    });

    const svchost: ProcessRow = onlyRow(result);
    expect(svchost.command).toBe("C:\\WINDOWS\\system32\\svchost.exe");
    expect(svchost.user).toBe("NT AUTHORITY\\NETWORK SERVICE");
  });

  test("a blank command or owner is no command or owner", () => {
    const result: ProcessRollup = rollup({
      memory: [
        memoryReading({ pid: 1, exe: "init", command: "", owner: " " }, NOW, 1),
      ],
    });

    expect(onlyRow(result).command).toBeNull();
    expect(onlyRow(result).user).toBeNull();
  });
});

describe("memory", () => {
  test("is the newest reading, compared with the host's total RAM", () => {
    const result: ProcessRollup = rollup({
      memory: [
        memoryReading(POSTGRES, BEFORE, 4 * GIB),
        memoryReading(POSTGRES, NOW, 2 * GIB),
        memoryReading(POSTGRES, LONG_AGO, 8 * GIB),
      ],
      totalMemoryBytes: 16 * GIB,
    });

    expect(onlyRow(result).memoryBytes).toBe(2 * GIB);
    expect(onlyRow(result).memoryPercent).toBeCloseTo(12.5, 10);
  });

  test("has no share without a usable host total", () => {
    for (const total of [null, 0, -1, Number.NaN, Infinity]) {
      const result: ProcessRollup = rollup({
        memory: [memoryReading(POSTGRES, NOW, 2 * GIB)],
        totalMemoryBytes: total,
      });

      expect(onlyRow(result).memoryBytes).toBe(2 * GIB);
      expect(onlyRow(result).memoryPercent).toBeNull();
    }
  });
});

describe("latest sample time", () => {
  test("is the newest reading of either metric", () => {
    const result: ProcessRollup = rollup({
      cpu: linuxScrape(POSTGRES, BEFORE, { user: 0, system: 0, wait: 0 }),
      memory: [memoryReading(NGINX, NOW, 1)],
    });

    expect(result.latestSampleAt?.toISOString()).toBe(NOW);
  });

  test("ignores readings with no usable time", () => {
    const result: ProcessRollup = rollup({
      memory: [
        { time: "not a date", value: 1, attributes: identityAttributes(NGINX) },
        { time: null, value: 1, attributes: identityAttributes(NGINX) },
        memoryReading(NGINX, BEFORE, 1),
      ],
    });

    expect(result.latestSampleAt?.toISOString()).toBe(BEFORE);
  });

  test("is null when nothing came back", () => {
    expect(rollup({}).latestSampleAt).toBeNull();
    expect(rollup({}).rows).toEqual([]);
  });
});

describe("a capped fetch that stopped inside the newest scrape", () => {
  /*
   * The scraper stamps each process as it walks the process table, so one
   * scrape spans many timestamps, newest first in the fetch.
   */
  function oneScrape(processCount: number): Array<ProcessMetricDatapoint> {
    const datapoints: Array<ProcessMetricDatapoint> = [];
    for (let i: number = processCount; i >= 1; i--) {
      datapoints.push(
        memoryReading(
          { pid: i, exe: `worker-${i}` },
          new Date(Date.parse(NOW) - i).toISOString(),
          i,
        ),
      );
    }
    return datapoints;
  }

  test("is not suspected while the fetch is under its cap", () => {
    expect(isProcessFetchCutOff(oneScrape(5), 6)).toBe(false);
    expect(isProcessFetchCutOff([], 1)).toBe(false);
  });

  test("is suspected when the cap was hit and no process was seen twice", () => {
    // Every process at its own timestamp proves nothing: that is one scrape.
    expect(isProcessFetchCutOff(oneScrape(6), 6)).toBe(true);
  });

  test("is ruled out once any process shows up in an earlier scrape too", () => {
    const datapoints: Array<ProcessMetricDatapoint> = [
      ...oneScrape(5),
      memoryReading({ pid: 5, exe: "worker-5" }, BEFORE, 5),
    ];

    expect(isProcessFetchCutOff(datapoints, datapoints.length)).toBe(false);
  });

  test("the readings of one scrape do not count as a second sighting", () => {
    // Three modes, and the v1 gate's copies, all share a timestamp.
    const datapoints: Array<ProcessMetricDatapoint> = [
      ...linuxScrape(POSTGRES, NOW, { user: 0.1, system: 0.1, wait: 0 }),
      cpuReading(POSTGRES, NOW, 0.1, { "cpu.mode": "user", state: "user" }),
    ];

    expect(isProcessFetchCutOff(datapoints, datapoints.length)).toBe(true);
  });

  test("a recycled pid is a different process, not a second sighting", () => {
    const datapoints: Array<ProcessMetricDatapoint> = [
      memoryReading({ pid: 500, exe: "bash" }, NOW, 1),
      memoryReading({ pid: 500, exe: "python3" }, BEFORE, 1),
    ];

    expect(isProcessFetchCutOff(datapoints, 2)).toBe(true);
  });

  test("readings with no identity or time are left out of the judgement", () => {
    const datapoints: Array<ProcessMetricDatapoint> = [
      memoryReading(NGINX, NOW, 1),
      { time: BEFORE, value: 1, attributes: {} },
      { time: "garbage", value: 1, attributes: identityAttributes(NGINX) },
    ];

    expect(isProcessFetchCutOff(datapoints, 3)).toBe(true);
  });
});

describe("search", () => {
  const JAVA_SYSTEM: ProcessRow = row({
    pid: "784",
    executable: "java.exe",
    command: "E:\\Java\\Java64\\jdk\\bin\\java",
    user: "NT AUTHORITY\\SYSTEM",
  });
  const JAVA_SERVICE: ProcessRow = row({
    pid: "8404",
    executable: "java.exe",
    command: "E:\\Java\\Java64\\jdk\\bin\\java",
    user: "NT AUTHORITY\\NETWORK SERVICE",
  });
  const ZABBIX: ProcessRow = row({
    pid: "2480",
    executable: "zabbix_agent2.exe",
    command: '"c:\\Program Files\\Zabbix Agent 2\\zabbix_agent2.exe"',
    user: "NT AUTHORITY\\SYSTEM",
  });
  const SVCHOST: ProcessRow = row({
    pid: "17840",
    executable: "svchost.exe",
    command: "C:\\WINDOWS\\system32\\svchost.exe",
    user: null,
  });
  const ROWS: Array<ProcessRow> = [JAVA_SYSTEM, JAVA_SERVICE, ZABBIX, SVCHOST];

  function search(text: string): Array<string> {
    return pids(filterProcessRows(ROWS, text));
  }

  test("an empty search keeps every row, as a new list", () => {
    for (const text of ["", "   ", "\t\n"]) {
      const result: Array<ProcessRow> = filterProcessRows(ROWS, text);
      expect(result).toEqual(ROWS);
      expect(result).not.toBe(ROWS);
    }
  });

  test("finds a process by name, as the issue asks", () => {
    expect(search("java.exe")).toEqual(["784", "8404"]);
  });

  test("finds a process by pid", () => {
    expect(search("2480")).toEqual(["2480"]);
  });

  test("a pid search is a substring search, like the rest", () => {
    // "784" is pid 784, and also part of pid 17840.
    expect(search("784")).toEqual(["784", "17840"]);
  });

  test("finds processes by user", () => {
    expect(search("network service")).toEqual(["8404"]);
  });

  test("finds a process by its path", () => {
    expect(search("system32")).toEqual(["17840"]);
    expect(search("E:\\Java")).toEqual(["784", "8404"]);
  });

  test("ignores case", () => {
    expect(search("JAVA.EXE")).toEqual(["784", "8404"]);
    expect(search("Zabbix_Agent2")).toEqual(["2480"]);
  });

  test("every word has to match somewhere in the row", () => {
    expect(search("java system")).toEqual(["784"]);
    expect(search("java nginx")).toEqual([]);
  });

  test("a pasted path with spaces in it still finds its process", () => {
    expect(
      search('"c:\\Program Files\\Zabbix Agent 2\\zabbix_agent2.exe"'),
    ).toEqual(["2480"]);
  });

  test("a word never spans two fields", () => {
    // java.exe's name runs straight into its pid only if fields were glued.
    expect(search("exe784")).toEqual([]);
    expect(search("java.exe784")).toEqual([]);
  });

  test("a missing user or command matches nothing, not the word null", () => {
    expect(search("null")).toEqual([]);
  });

  test("splits words on any whitespace", () => {
    expect(processSearchTerms("  Java\tSYSTEM \n ")).toEqual([
      "java",
      "system",
    ]);
    expect(processSearchTerms("   ")).toEqual([]);
  });

  test("does not change the rows it searches", () => {
    const before: string = JSON.stringify(ROWS);
    filterProcessRows(ROWS, "java");
    expect(JSON.stringify(ROWS)).toBe(before);
  });
});

describe("sorting", () => {
  const IDLE_B: ProcessRow = row({
    pid: "10040",
    executable: "bravo",
    user: "root",
    cpuPercent: 0,
    memoryBytes: 300,
  });
  const BUSY: ProcessRow = row({
    pid: "784",
    executable: "Charlie",
    user: "postgres",
    cpuPercent: 42.5,
    memoryBytes: 100,
  });
  const IDLE_A: ProcessRow = row({
    pid: "9",
    executable: "alpha",
    user: "Admin",
    cpuPercent: 0,
    memoryBytes: 900,
  });
  const UNREAD: ProcessRow = row({
    pid: "55",
    executable: "delta",
    user: null,
    cpuPercent: null,
    memoryBytes: null,
  });
  const ROWS: Array<ProcessRow> = [IDLE_B, UNREAD, BUSY, IDLE_A];

  function order(sortBy: ProcessSortKey, sortOrder: SortOrder): Array<string> {
    return names(sortProcessRows(ROWS, sortBy, sortOrder));
  }

  test("opens on the busiest processes", () => {
    expect(DEFAULT_PROCESS_SORT).toEqual({
      sortBy: "cpuPercent",
      sortOrder: SortOrder.Descending,
    });
  });

  test("CPU, highest first - and a missing reading is not the lowest one", () => {
    expect(order("cpuPercent", SortOrder.Descending)).toEqual([
      "Charlie",
      "alpha",
      "bravo",
      "delta",
    ]);
  });

  test("CPU, lowest first - and a missing reading still sorts last", () => {
    expect(order("cpuPercent", SortOrder.Ascending)).toEqual([
      "alpha",
      "bravo",
      "Charlie",
      "delta",
    ]);
  });

  test("memory, both ways, missing last", () => {
    expect(order("memoryBytes", SortOrder.Descending)).toEqual([
      "alpha",
      "bravo",
      "Charlie",
      "delta",
    ]);
    expect(order("memoryBytes", SortOrder.Ascending)).toEqual([
      "Charlie",
      "bravo",
      "alpha",
      "delta",
    ]);
  });

  test("name, A to Z and Z to A, ignoring case", () => {
    expect(order("executable", SortOrder.Ascending)).toEqual([
      "alpha",
      "bravo",
      "Charlie",
      "delta",
    ]);
    expect(order("executable", SortOrder.Descending)).toEqual([
      "delta",
      "Charlie",
      "bravo",
      "alpha",
    ]);
  });

  test("name sorts numbers the way people count", () => {
    const workers: Array<ProcessRow> = ["worker10", "worker2", "worker1"].map(
      (executable: string, i: number): ProcessRow => {
        return row({ pid: String(i), executable: executable });
      },
    );

    expect(
      names(sortProcessRows(workers, "executable", SortOrder.Ascending)),
    ).toEqual(["worker1", "worker2", "worker10"]);
  });

  test("pid sorts as a number, not as text", () => {
    expect(pids(sortProcessRows(ROWS, "pid", SortOrder.Ascending))).toEqual([
      "9",
      "55",
      "784",
      "10040",
    ]);
    expect(pids(sortProcessRows(ROWS, "pid", SortOrder.Descending))).toEqual([
      "10040",
      "784",
      "55",
      "9",
    ]);
  });

  test("user, A to Z ignoring case, a process with no user last both ways", () => {
    expect(order("user", SortOrder.Ascending)).toEqual([
      "alpha",
      "Charlie",
      "bravo",
      "delta",
    ]);
    expect(order("user", SortOrder.Descending)).toEqual([
      "bravo",
      "Charlie",
      "alpha",
      "delta",
    ]);
  });

  test("a process with no name or pid sorts last by name and by pid", () => {
    const rows: Array<ProcessRow> = [
      row({ pid: "", executable: "zeta" }),
      row({ pid: "3", executable: "" }),
      row({ pid: "2", executable: "beta" }),
    ];

    expect(
      pids(sortProcessRows(rows, "executable", SortOrder.Ascending)),
    ).toEqual(["2", "", "3"]);
    expect(
      pids(sortProcessRows(rows, "executable", SortOrder.Descending)),
    ).toEqual(["", "2", "3"]);
    expect(pids(sortProcessRows(rows, "pid", SortOrder.Descending))).toEqual([
      "3",
      "2",
      "",
    ]);
  });

  test("ties fall back to name then pid, A to Z, whichever way the column runs", () => {
    const svchosts: Array<ProcessRow> = ["2732", "436", "1216"].map(
      (pid: string): ProcessRow => {
        return row({ pid: pid, executable: "svchost.exe", cpuPercent: 0 });
      },
    );

    for (const sortOrder of [SortOrder.Ascending, SortOrder.Descending]) {
      expect(pids(sortProcessRows(svchosts, "cpuPercent", sortOrder))).toEqual([
        "436",
        "1216",
        "2732",
      ]);
    }
    expect(order("cpuPercent", SortOrder.Descending).slice(1, 3)).toEqual([
      "alpha",
      "bravo",
    ]);
  });

  test("gives the same order whatever order the rows came in", () => {
    const shuffled: Array<ProcessRow> = [IDLE_A, BUSY, UNREAD, IDLE_B];

    for (const sortBy of PROCESS_SORT_KEYS) {
      for (const sortOrder of [SortOrder.Ascending, SortOrder.Descending]) {
        expect(names(sortProcessRows(shuffled, sortBy, sortOrder))).toEqual(
          names(sortProcessRows(ROWS, sortBy, sortOrder)),
        );
      }
    }
  });

  test("sorts a copy and leaves the rows as they were", () => {
    const before: Array<string> = names(ROWS);
    const sorted: Array<ProcessRow> = sortProcessRows(
      ROWS,
      "executable",
      SortOrder.Ascending,
    );

    expect(sorted).not.toBe(ROWS);
    expect(names(ROWS)).toEqual(before);
  });

  test("an unknown column falls back to CPU", () => {
    for (const sortBy of [null, undefined, "command", "key", 7]) {
      expect(
        names(sortProcessRows(ROWS, sortBy, SortOrder.Descending)),
      ).toEqual(order("cpuPercent", SortOrder.Descending));
    }
  });

  test("knows exactly the sortable columns", () => {
    expect([...PROCESS_SORT_KEYS].sort()).toEqual([
      "cpuPercent",
      "executable",
      "memoryBytes",
      "pid",
      "user",
    ]);
    expect(isProcessSortKey("memoryBytes")).toBe(true);
    expect(isProcessSortKey("command")).toBe(false);
    expect(isProcessSortKey(null)).toBe(false);
  });
});

describe("a header click", () => {
  const CPU_DESC: ProcessSort = {
    sortBy: "cpuPercent",
    sortOrder: SortOrder.Descending,
  };

  test("opens CPU and Memory on the heaviest, everything else from the top", () => {
    expect(defaultSortOrderFor("cpuPercent")).toBe(SortOrder.Descending);
    expect(defaultSortOrderFor("memoryBytes")).toBe(SortOrder.Descending);
    expect(defaultSortOrderFor("executable")).toBe(SortOrder.Ascending);
    expect(defaultSortOrderFor("pid")).toBe(SortOrder.Ascending);
    expect(defaultSortOrderFor("user")).toBe(SortOrder.Ascending);
  });

  test("on a new column starts in that column's own direction", () => {
    /*
     * The shared header flips the table's last direction whichever column
     * was clicked: from CPU (descending) a click on Memory asks for
     * ascending - the processes using the least memory first.
     */
    expect(
      resolveProcessSort({
        current: CPU_DESC,
        requestedSortBy: "memoryBytes",
        requestedSortOrder: SortOrder.Ascending,
      }),
    ).toEqual({ sortBy: "memoryBytes", sortOrder: SortOrder.Descending });

    expect(
      resolveProcessSort({
        current: CPU_DESC,
        requestedSortBy: "executable",
        requestedSortOrder: SortOrder.Ascending,
      }),
    ).toEqual({ sortBy: "executable", sortOrder: SortOrder.Ascending });

    expect(
      resolveProcessSort({
        current: { sortBy: "executable", sortOrder: SortOrder.Ascending },
        requestedSortBy: "pid",
        requestedSortOrder: SortOrder.Descending,
      }),
    ).toEqual({ sortBy: "pid", sortOrder: SortOrder.Ascending });
  });

  test("on the sorted column flips it, as the header asks", () => {
    expect(
      resolveProcessSort({
        current: CPU_DESC,
        requestedSortBy: "cpuPercent",
        requestedSortOrder: SortOrder.Ascending,
      }),
    ).toEqual({ sortBy: "cpuPercent", sortOrder: SortOrder.Ascending });

    expect(
      resolveProcessSort({
        current: { sortBy: "user", sortOrder: SortOrder.Ascending },
        requestedSortBy: "user",
        requestedSortOrder: SortOrder.Descending,
      }),
    ).toEqual({ sortBy: "user", sortOrder: SortOrder.Descending });
  });

  test("on something that is not a column returns to the default", () => {
    for (const requestedSortBy of [null, "key", "command", undefined]) {
      expect(
        resolveProcessSort({
          current: { sortBy: "user", sortOrder: SortOrder.Ascending },
          requestedSortBy: requestedSortBy,
          requestedSortOrder: SortOrder.Ascending,
        }),
      ).toEqual(DEFAULT_PROCESS_SORT);
    }
  });
});
