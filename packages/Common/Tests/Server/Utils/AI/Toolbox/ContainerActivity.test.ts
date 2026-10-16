import ContainerActivityUtil, {
  ContainerActivity,
  ContainerActivitySummary,
  ContainerCpuBucket,
  ContainerStatus,
  STALE_AFTER_MS,
} from "../../../../../Server/Utils/AI/Toolbox/ContainerActivity";
import { describe, expect, test } from "@jest/globals";

/*
 * A CONTAINER HOST'S CONTAINERS, FROM THEIR METRICS (issue #4785).
 *
 * A container that stops sends nothing - not a zero - so it shows only as a
 * series that ends while the host's other containers keep reporting. These
 * tests pin how that is told apart from a collector that is a minute behind
 * or a host that went silent as a whole, and the order a reader needs:
 * stopped containers first, then the busiest.
 */

const MINUTE: number = 60 * 1000;
// The lookback starts at 13:45; the window is 14:00 - 14:30.
const READ_START: Date = new Date("2026-10-16T13:45:00.000Z");
const WINDOW_START: Date = new Date("2026-10-16T14:00:00.000Z");
const WINDOW_END: Date = new Date("2026-10-16T14:30:00.000Z");

function at(minutesFromReadStart: number): Date {
  return new Date(READ_START.getTime() + minutesFromReadStart * MINUTE);
}

/*
 * One container reporting every minute from `from` to `to` (inclusive,
 * minutes after the read start) at `cpu` percent.
 */
function reporting(data: {
  name: string;
  from: number;
  to: number;
  cpu: number | ((minute: number) => number);
  image?: string;
}): Array<ContainerCpuBucket> {
  const buckets: Array<ContainerCpuBucket> = [];

  for (let minute: number = data.from; minute <= data.to; minute++) {
    buckets.push({
      containerName: data.name,
      imageName: data.image ?? `acme/${data.name}:1`,
      bucketStart: at(minute),
      cpuPercent: typeof data.cpu === "function" ? data.cpu(minute) : data.cpu,
    });
  }

  return buckets;
}

function summarize(
  buckets: Array<ContainerCpuBucket>,
  extra: {
    memoryPeaks?: Map<string, number>;
    restarts?: Map<string, number>;
    bucketMs?: number;
  } = {},
): ContainerActivitySummary {
  return ContainerActivityUtil.summarize({
    buckets,
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    bucketMs: extra.bucketMs ?? MINUTE,
    memoryPeaks: extra.memoryPeaks,
    restarts: extra.restarts,
  });
}

function byName(
  summary: ContainerActivitySummary,
  name: string,
): ContainerActivity {
  const found: ContainerActivity | undefined = summary.containers.find(
    (container: ContainerActivity): boolean => {
      return container.containerName === name;
    },
  );

  if (!found) {
    throw new Error(`${name} not summarized`);
  }

  return found;
}

describe("which containers stopped reporting", () => {
  test("the container that went quiet 3 minutes before the end, while the others kept reporting, stopped", () => {
    const summary: ContainerActivitySummary = summarize([
      ...reporting({ name: "web", from: 0, to: 45, cpu: 12 }),
      ...reporting({ name: "api", from: 0, to: 42, cpu: 8 }),
    ]);

    const api: ContainerActivity = byName(summary, "api");

    expect(api.status).toBe(ContainerStatus.StoppedReporting);
    expect(api.lastSeenAt).toEqual(at(42));
    expect(byName(summary, "web").status).toBe(ContainerStatus.Reporting);
    expect(summary.stoppedCount).toBe(1);
    expect(summary.hostLastSeenAt).toEqual(at(45));
  });

  test("a container seen only before the window, then silent, stopped (before the window)", () => {
    const summary: ContainerActivitySummary = summarize([
      ...reporting({ name: "web", from: 0, to: 45, cpu: 12 }),
      ...reporting({ name: "cron", from: 0, to: 10, cpu: 1 }),
    ]);

    const cron: ContainerActivity = byName(summary, "cron");

    expect(cron.status).toBe(ContainerStatus.StoppedReporting);
    expect(cron.lastSeenAt.getTime()).toBeLessThan(WINDOW_START.getTime());
    // It reported nothing inside the window, so it has no CPU there.
    expect(cron.cpuAverage).toBeNull();
    expect(cron.cpuPeak).toBeNull();
  });

  test("a minute behind the newest data is a collector catching up, not a stop", () => {
    const summary: ContainerActivitySummary = summarize([
      ...reporting({ name: "web", from: 0, to: 45, cpu: 12 }),
      ...reporting({ name: "api", from: 0, to: 44, cpu: 8 }),
    ]);

    expect(byName(summary, "api").status).toBe(ContainerStatus.Reporting);
    expect(summary.stoppedCount).toBe(0);
    // Two minutes is the line.
    expect(STALE_AFTER_MS).toBe(2 * MINUTE);
    expect(
      byName(
        summarize([
          ...reporting({ name: "web", from: 0, to: 45, cpu: 12 }),
          ...reporting({ name: "api", from: 0, to: 43, cpu: 8 }),
        ]),
        "api",
      ).status,
    ).toBe(ContainerStatus.StoppedReporting);
  });

  test("a host whose collector went silent as a whole singles out no container", () => {
    const summary: ContainerActivitySummary = summarize([
      ...reporting({ name: "web", from: 0, to: 20, cpu: 12 }),
      ...reporting({ name: "api", from: 0, to: 20, cpu: 8 }),
    ]);

    expect(summary.stoppedCount).toBe(0);
    expect(summary.hostLastSeenAt).toEqual(at(20));
  });

  test("with wide buckets, a container is never stale by less than two of them", () => {
    const fiveMinutes: number = 5 * MINUTE;
    const buckets: Array<ContainerCpuBucket> = [
      {
        containerName: "web",
        imageName: "web",
        bucketStart: at(40),
        cpuPercent: 3,
      },
      {
        containerName: "api",
        imageName: "api",
        bucketStart: at(35),
        cpuPercent: 3,
      },
    ];

    // One bucket behind is the collector, not a stop.
    expect(
      byName(summarize(buckets, { bucketMs: fiveMinutes }), "api").status,
    ).not.toBe(ContainerStatus.StoppedReporting);
    expect(
      byName(
        summarize(
          [
            ...buckets,
            {
              containerName: "web",
              imageName: "web",
              bucketStart: at(45),
              cpuPercent: 3,
            },
          ],
          { bucketMs: fiveMinutes },
        ),
        "api",
      ).status,
    ).toBe(ContainerStatus.StoppedReporting);
  });
});

describe("what each container did in the window", () => {
  test("a container first seen inside the window started there", () => {
    const summary: ContainerActivitySummary = summarize([
      ...reporting({ name: "web", from: 0, to: 45, cpu: 12 }),
      ...reporting({ name: "migrate", from: 20, to: 45, cpu: 40 }),
    ]);

    const migrate: ContainerActivity = byName(summary, "migrate");

    expect(migrate.status).toBe(ContainerStatus.StartedInWindow);
    expect(migrate.firstSeenAt).toEqual(at(20));
  });

  test("CPU average and peak count only the buckets inside the window", () => {
    const summary: ContainerActivitySummary = summarize(
      reporting({
        name: "api",
        from: 0,
        to: 45,
        // 500% in the lookback, 100% then 200% in the window.
        cpu: (minute: number): number => {
          if (minute < 15) {
            return 500;
          }
          return minute < 30 ? 100 : 200;
        },
      }),
    );

    const api: ContainerActivity = byName(summary, "api");

    expect(api.cpuPeak).toBe(200);
    // 15 buckets at 100 (minutes 15-29) and 16 at 200 (minutes 30-45).
    expect(api.cpuAverage).toBeCloseTo((15 * 100 + 16 * 200) / 31, 10);
  });

  test("a CPU reading that is not a number is left out, not counted as zero", () => {
    const summary: ContainerActivitySummary = summarize([
      {
        containerName: "api",
        imageName: "api",
        bucketStart: at(20),
        cpuPercent: null,
      },
      {
        containerName: "api",
        imageName: "api",
        bucketStart: at(21),
        cpuPercent: 50,
      },
    ]);

    expect(byName(summary, "api").cpuAverage).toBe(50);
  });

  test("a container redeployed with a new image names the new one, and the old", () => {
    const summary: ContainerActivitySummary = summarize([
      ...reporting({
        name: "api",
        from: 0,
        to: 20,
        cpu: 5,
        image: "acme/api:1.3",
      }),
      ...reporting({
        name: "api",
        from: 21,
        to: 45,
        cpu: 5,
        image: "acme/api:1.4",
      }),
    ]);

    const api: ContainerActivity = byName(summary, "api");

    expect(api.imageName).toBe("acme/api:1.4");
    expect(api.previousImageNames).toEqual(["acme/api:1.3"]);
  });

  test("memory and restarts come from their own reads, by container name", () => {
    const summary: ContainerActivitySummary = summarize(
      [
        ...reporting({ name: "api", from: 0, to: 45, cpu: 5 }),
        ...reporting({ name: "db", from: 0, to: 45, cpu: 5 }),
      ],
      {
        memoryPeaks: new Map<string, number>([["api", 91.5]]),
        restarts: new Map<string, number>([
          ["api", 3],
          ["db", Number.NaN],
        ]),
      },
    );

    expect(byName(summary, "api").memoryPeak).toBe(91.5);
    expect(byName(summary, "api").restartsInWindow).toBe(3);
    expect(byName(summary, "db").memoryPeak).toBeNull();
    expect(byName(summary, "db").restartsInWindow).toBeNull();
  });

  test("a bucket without a container name is not a container", () => {
    expect(
      summarize([
        {
          containerName: "  ",
          imageName: "x",
          bucketStart: at(20),
          cpuPercent: 99,
        },
      ]).containers,
    ).toEqual([]);
  });

  test("no data is no containers, and no host last seen", () => {
    const summary: ContainerActivitySummary = summarize([]);

    expect(summary.containers).toEqual([]);
    expect(summary.hostLastSeenAt).toBeNull();
    expect(summary.stoppedCount).toBe(0);
  });
});

describe("the order a reader needs", () => {
  const summary: ContainerActivitySummary = summarize(
    [
      ...reporting({ name: "web", from: 0, to: 45, cpu: 12 }),
      ...reporting({ name: "cpu-hog", from: 0, to: 45, cpu: 195 }),
      ...reporting({ name: "api", from: 0, to: 40, cpu: 8 }),
      ...reporting({ name: "worker", from: 0, to: 30, cpu: 2 }),
      ...reporting({ name: "cache", from: 0, to: 45, cpu: 12 }),
    ],
    {
      memoryPeaks: new Map<string, number>([
        ["web", 20],
        ["cache", 95],
        ["cpu-hog", 10],
      ]),
      restarts: new Map<string, number>([
        ["web", 4],
        ["cache", 0],
        ["cpu-hog", 1],
      ]),
    },
  );

  function names(containers: Array<ContainerActivity>): Array<string> {
    return containers.map((container: ContainerActivity): string => {
      return container.containerName;
    });
  }

  test("by CPU: the stopped first (the latest stop first), then the busiest, ties by name", () => {
    expect(
      names(ContainerActivityUtil.sort(summary.containers, "cpu")),
    ).toEqual(["api", "worker", "cpu-hog", "cache", "web"]);
  });

  test("by memory and by restarts, the stopped still lead", () => {
    expect(
      names(ContainerActivityUtil.sort(summary.containers, "memory")),
    ).toEqual(["api", "worker", "cache", "web", "cpu-hog"]);
    expect(
      names(ContainerActivityUtil.sort(summary.containers, "restarts")),
    ).toEqual(["api", "worker", "web", "cpu-hog", "cache"]);
  });

  test("sorting never changes the list it was handed", () => {
    const before: Array<string> = names(summary.containers);

    ContainerActivityUtil.sort(summary.containers, "memory");

    expect(names(summary.containers)).toEqual(before);
  });
});
