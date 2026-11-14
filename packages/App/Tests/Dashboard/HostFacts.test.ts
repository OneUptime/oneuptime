import { describe, expect, test } from "@jest/globals";
import { formatDurationCompactInLanguage } from "Common/Utils/Slo/SloDuration";
import {
  HOST_DISK_FULL_PERCENT,
  HOST_DISK_NEAR_FULL_PERCENT,
  HOST_MEMORY_CRITICAL_PERCENT,
  HOST_MEMORY_HIGH_PERCENT,
  HOST_READINGS_STALE_MS,
  HostHealthRow,
} from "Common/Types/Host/HostHealth";
import {
  HOST_CPU_BUSY_PERCENT,
  HOST_LOAD_QUEUING_PERCENT,
  HostStatusFacts,
  formatHostBytes,
  formatHostUptime,
  formatHostUsagePercent,
  getHostStatusFacts,
  getHostUptimeSeconds,
  getHostUsage,
  getHostUsageTone,
  isHostStarting,
} from "../../FeatureSet/Dashboard/src/Pages/Host/Utils/HostFacts";

/*
 * What a host's row and hero say from what it last reported
 * (Pages/Host/Utils/HostFacts): the Status cell's word and reason, the
 * CPU, Memory and Disk bars and their colours, and how long the host has
 * been up - each from the same rules as its Needs attention card, so the
 * list, the card and the host's page say one thing.
 */

const NOW: Date = new Date("2026-11-02T10:00:00.000Z");
const MINUTE: number = 60_000;
const GIB: number = 1024 * 1024 * 1024;

function host(fields: Partial<HostHealthRow> = {}): HostHealthRow {
  return {
    otelCollectorStatus: "connected",
    lastSeenAt: new Date(NOW.getTime() - MINUTE),
    createdAt: new Date(NOW.getTime() - 30 * 24 * 60 * MINUTE),
    cpuCores: 4,
    latestCpuPercent: 42.4,
    latestMemoryPercent: 55,
    latestSwapPercent: 0,
    latestDiskPercent: 61,
    latestDiskMountpoint: "/",
    latestLoadAverage15m: 1,
    failedSystemdUnitCount: 0,
    readingsUpdatedAt: new Date(NOW.getTime() - MINUTE),
    ...fields,
  };
}

describe("each bar's colour", () => {
  test("CPU turns amber past its busy line and is never red", () => {
    expect(getHostUsageTone("cpu", HOST_CPU_BUSY_PERCENT)).toBe("positive");
    expect(getHostUsageTone("cpu", HOST_CPU_BUSY_PERCENT + 0.1)).toBe(
      "warning",
    );
    expect(getHostUsageTone("cpu", 100)).toBe("warning");
  });

  test("memory and disk turn amber and red where Needs attention lists them", () => {
    expect(getHostUsageTone("memory", HOST_MEMORY_HIGH_PERCENT)).toBe(
      "positive",
    );
    expect(getHostUsageTone("memory", HOST_MEMORY_HIGH_PERCENT + 0.1)).toBe(
      "warning",
    );
    expect(getHostUsageTone("memory", HOST_MEMORY_CRITICAL_PERCENT)).toBe(
      "warning",
    );
    expect(getHostUsageTone("memory", HOST_MEMORY_CRITICAL_PERCENT + 0.1)).toBe(
      "danger",
    );
    expect(getHostUsageTone("disk", HOST_DISK_NEAR_FULL_PERCENT)).toBe(
      "positive",
    );
    expect(getHostUsageTone("disk", HOST_DISK_NEAR_FULL_PERCENT + 0.1)).toBe(
      "warning",
    );
    expect(getHostUsageTone("disk", HOST_DISK_FULL_PERCENT + 0.1)).toBe(
      "danger",
    );
  });
});

describe("the load tile's line", () => {
  /*
   * The host's UI review: the load tile's bar was red from 100% of the
   * cores, beside an amber "15-minute load" in the host's Needs attention.
   * Its (i) says over 100% means work is queuing: amber from there, and
   * never red, as the rules call a high load one to look at.
   */
  test("is where work starts to queue: as many runnable processes as cores", () => {
    expect(HOST_LOAD_QUEUING_PERCENT).toBe(100);
  });
});

describe("each bar's number", () => {
  test("what the host last reported, kept between 0 and 100", () => {
    expect(getHostUsage({ row: host(), kind: "cpu", now: NOW })).toEqual({
      percent: 42.4,
      tone: "positive",
    });
    expect(
      getHostUsage({
        row: host({ latestDiskPercent: 104 }),
        kind: "disk",
        now: NOW,
      }),
    ).toEqual({ percent: 100, tone: "danger" });
    expect(
      getHostUsage({
        row: host({ latestMemoryPercent: "93.5" }),
        kind: "memory",
        now: NOW,
      }),
    ).toEqual({ percent: 93.5, tone: "warning" });
  });

  test("no number from a host that is not reporting, readings too old, or none", () => {
    const none: { percent: null; tone: string } = {
      percent: null,
      tone: "neutral",
    };
    expect(
      getHostUsage({
        row: host({ otelCollectorStatus: "disconnected" }),
        kind: "cpu",
        now: NOW,
      }),
    ).toEqual(none);
    expect(
      getHostUsage({
        row: host({
          readingsUpdatedAt: new Date(
            NOW.getTime() - HOST_READINGS_STALE_MS - MINUTE,
          ),
        }),
        kind: "cpu",
        now: NOW,
      }),
    ).toEqual(none);
    expect(
      getHostUsage({
        row: host({ latestDiskPercent: null }),
        kind: "disk",
        now: NOW,
      }),
    ).toEqual(none);
  });

  test("written whole from 10, with one decimal below", () => {
    expect(formatHostUsagePercent(42.4)).toBe("42%");
    expect(formatHostUsagePercent(99.6)).toBe("100%");
    expect(formatHostUsagePercent(4.24)).toBe("4.2%");
    expect(formatHostUsagePercent(0)).toBe("0%");
  });
});

describe("the Status cell", () => {
  test("a word, the most urgent reason and how many more", () => {
    const facts: HostStatusFacts = getHostStatusFacts({
      row: host({
        latestDiskPercent: 97,
        latestDiskMountpoint: "/var",
        latestMemoryPercent: 92,
      }),
      now: NOW,
    });

    expect(facts.status).toEqual({ text: "Unhealthy" });
    expect(facts.tone).toBe("danger");
    expect(facts.firstReason).toEqual({
      text: "{{mount}} {{percent}} full",
      values: { mount: "/var", percent: "97%" },
    });
    expect(facts.moreReasons).toBe(1);
    expect(facts.isStarting).toBe(false);
    expect(facts.lastReportedAt).toBeNull();
  });

  test("a host gone quiet: when it last reported, not its word again as a reason", () => {
    const lastSeenAt: Date = new Date(NOW.getTime() - 3 * 60 * MINUTE);
    const facts: HostStatusFacts = getHostStatusFacts({
      row: host({
        otelCollectorStatus: "disconnected",
        lastSeenAt: lastSeenAt,
      }),
      now: NOW,
    });

    expect(facts.status).toEqual({ text: "Not reporting" });
    expect(facts.firstReason).toBeNull();
    expect(facts.moreReasons).toBe(0);
    expect(facts.lastReportedAt).toEqual(lastSeenAt);
  });

  test("a host that never sent anything says so once", () => {
    const facts: HostStatusFacts = getHostStatusFacts({
      row: host({
        otelCollectorStatus: null,
        lastSeenAt: null,
        readingsUpdatedAt: null,
        createdAt: new Date(NOW.getTime() - 60 * MINUTE),
      }),
      now: NOW,
    });

    expect(facts.status).toEqual({ text: "No data yet" });
    expect(facts.firstReason).toBeNull();
    expect(facts.lastReportedAt).toBeNull();
  });

  test("a host whose collector is still starting pulses", () => {
    const facts: HostStatusFacts = getHostStatusFacts({
      row: host({
        otelCollectorStatus: null,
        lastSeenAt: null,
        readingsUpdatedAt: null,
        collectorRegisteredAt: new Date(NOW.getTime() - 2 * MINUTE),
      }),
      now: NOW,
    });

    expect(facts.status).toEqual({ text: "Starting" });
    expect(facts.isStarting).toBe(true);
    expect(facts.tone).toBe("neutral");
  });

  test("a healthy host has no reason under its word", () => {
    const facts: HostStatusFacts = getHostStatusFacts({
      row: host(),
      now: NOW,
    });

    expect(facts.status).toEqual({ text: "Healthy" });
    expect(facts.tone).toBe("positive");
    expect(facts.firstReason).toBeNull();
  });
});

describe("a host still starting, in its hero", () => {
  /*
   * The hero said an amber Disconnected a minute after Add Host, above a
   * card saying "This host is starting", while its Hosts row said
   * Starting. Now the hero says Starting too - for a host OneUptime
   * installed the collector on, within its first ten minutes.
   */
  function starting(fields: Partial<HostHealthRow> = {}): HostHealthRow {
    return host({
      otelCollectorStatus: "disconnected",
      lastSeenAt: null,
      readingsUpdatedAt: null,
      collectorInstanceUid: "uid-new-01",
      collectorRegisteredAt: new Date(NOW.getTime() - 2 * MINUTE),
      createdAt: new Date(NOW.getTime() - 2 * MINUTE),
      ...fields,
    });
  }

  test("a managed host waiting for its first metrics is starting", () => {
    expect(isHostStarting({ row: starting(), now: NOW })).toBe(true);
  });

  test("ten minutes after its collector registered, it no longer is", () => {
    expect(
      isHostStarting({
        row: starting({
          collectorRegisteredAt: new Date(NOW.getTime() - 11 * MINUTE),
          createdAt: new Date(NOW.getTime() - 11 * MINUTE),
        }),
        now: NOW,
      }),
    ).toBe(false);
  });

  test("a host set up by hand reads Disconnected, as its connection card explains", () => {
    expect(
      isHostStarting({
        row: starting({ collectorInstanceUid: null }),
        now: NOW,
      }),
    ).toBe(false);
  });

  test("a host that has reported, or reports now, is not starting", () => {
    expect(
      isHostStarting({
        row: starting({ lastSeenAt: new Date(NOW.getTime() - 3 * MINUTE) }),
        now: NOW,
      }),
    ).toBe(false);
    expect(
      isHostStarting({
        row: starting({
          otelCollectorStatus: "connected",
          lastSeenAt: new Date(NOW.getTime() - MINUTE),
        }),
        now: NOW,
      }),
    ).toBe(false);
  });
});

describe("how long the host has been up", () => {
  test("from when it booted, while it reports", () => {
    expect(
      getHostUptimeSeconds({
        row: { ...host(), bootedAt: new Date(NOW.getTime() - 90 * MINUTE) },
        now: NOW,
      }),
    ).toBe(90 * 60);
  });

  test("nothing for a host that stopped reporting, never said, or boots in the future", () => {
    expect(
      getHostUptimeSeconds({
        row: {
          ...host({ otelCollectorStatus: "disconnected" }),
          bootedAt: new Date(NOW.getTime() - 90 * MINUTE),
        },
        now: NOW,
      }),
    ).toBeNull();
    expect(getHostUptimeSeconds({ row: host(), now: NOW })).toBeNull();
    expect(
      getHostUptimeSeconds({
        row: { ...host(), bootedAt: new Date(NOW.getTime() + MINUTE) },
        now: NOW,
      }),
    ).toBeNull();
  });
});

/*
 * The hero's uptime chip (issue #7306): the largest unit and the one right
 * below it, never days with seconds. A host booted 41 days and a second ago
 * read "Up 41d 1s", and the HostPages browser suite, whose host boots
 * exactly 41 days before its data is built, failed whenever the page drew
 * more than a second later.
 */
describe("how the hero says how long the host has been up", () => {
  const DAY_SECONDS: number = 24 * 60 * 60;
  const HOUR_SECONDS: number = 60 * 60;

  const LATIN_DIGIT: RegExp = /[0-9]/;
  const PERSIAN_DIGIT: RegExp = /[\u06F0-\u06F9]/;

  test.each([
    [41 * DAY_SECONDS + 1, "41d"],
    [41 * DAY_SECONDS + 59 * 60 + 59, "41d"],
    [41 * DAY_SECONDS + 3 * HOUR_SECONDS, "41d 3h"],
    [41 * DAY_SECONDS + 3 * HOUR_SECONDS + 7, "41d 3h"],
    [12 * DAY_SECONDS + 4 * HOUR_SECONDS, "12d 4h"],
    [3 * HOUR_SECONDS + 5, "3h"],
    [3 * HOUR_SECONDS + 2 * 60 + 5, "3h 2m"],
    [6 * 60 + 5, "6m 5s"],
    [59, "59s"],
    [0, "0s"],
  ])("English: %p seconds read %p", (seconds: number, text: string) => {
    expect(formatHostUptime(seconds, "en")).toBe(text);
  });

  test("English without a language reads the same", () => {
    expect(formatHostUptime(41 * DAY_SECONDS + 1)).toBe("41d");
  });

  test.each(["de", "fa"])(
    "%s: 41 d + 1 s reads as 41 whole days, in the language's own words",
    (language: string) => {
      const whole: string = formatHostUptime(41 * DAY_SECONDS, language);

      expect(formatHostUptime(41 * DAY_SECONDS + 1, language)).toBe(whole);
      expect(whole).not.toBe("41d");
    },
  );

  test("German writes its own units", () => {
    expect(formatHostUptime(41 * DAY_SECONDS + 1, "de")).toBe("41 Tg.");
    expect(formatHostUptime(41 * DAY_SECONDS + 3 * HOUR_SECONDS, "de")).toBe(
      "41 Tg., 3 Std.",
    );
    expect(formatHostUptime(3 * HOUR_SECONDS + 5, "de")).toBe("3 Std.");
    expect(formatHostUptime(59, "de")).toBe("59 Sek.");
  });

  test("Persian writes Persian digits and its own units, and no Latin digit", () => {
    const cases: Array<[number, string]> = [
      [41 * DAY_SECONDS + 1, "۴۱ روز"],
      [41 * DAY_SECONDS + 3 * HOUR_SECONDS, "۴۱ روز ۳ ساعت"],
      [3 * HOUR_SECONDS + 5, "۳ ساعت"],
      [59, "۵۹ ثانیه"],
    ];

    for (const [seconds, text] of cases) {
      const persian: string = formatHostUptime(seconds, "fa");

      expect({ seconds, persian }).toEqual({ seconds, persian: text });
      expect(LATIN_DIGIT.test(persian)).toBe(false);
      expect(PERSIAN_DIGIT.test(persian)).toBe(true);
    }
  });

  test("the negative control: the error budgets' rule, the default, still names the second", () => {
    expect(formatDurationCompactInLanguage(41 * DAY_SECONDS + 1, "en")).toBe(
      "41d 1s",
    );
    expect(formatHostUptime(41 * DAY_SECONDS + 1, "en")).not.toBe(
      formatDurationCompactInLanguage(41 * DAY_SECONDS + 1, "en"),
    );
  });
});

describe("sizes", () => {
  test("1024-based, one decimal under 10", () => {
    expect(formatHostBytes(16 * GIB)).toBe("16 GiB");
    expect(formatHostBytes(8 * GIB)).toBe("8.0 GiB");
    expect(formatHostBytes(512)).toBe("512 B");
    expect(formatHostBytes(null)).toBe("—");
    expect(formatHostBytes(Number.NaN)).toBe("—");
  });

  // A count of bytes is whole (issue #7417): never "0.0 B" or "5.0 B".
  test("plain bytes are whole, from zero to just under a KiB", () => {
    expect(formatHostBytes(0)).toBe("0 B");
    expect(formatHostBytes(5)).toBe("5 B");
    expect(formatHostBytes(9)).toBe("9 B");
    expect(formatHostBytes(1023)).toBe("1023 B");
    // From a KiB up, one decimal under ten as before.
    expect(formatHostBytes(1024)).toBe("1.0 KiB");
    expect(formatHostBytes(1536)).toBe("1.5 KiB");
  });
});
