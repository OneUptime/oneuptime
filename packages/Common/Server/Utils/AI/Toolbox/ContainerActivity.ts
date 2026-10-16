/*
 * The containers of one Docker or Podman host over a window, from the
 * metrics its collector exports per container (issue #4785): which ones are
 * busy, and which ones went quiet.
 *
 * A container that stops does not report a zero. The collector's
 * docker_stats receiver lists the containers that are running, so a stopped
 * container simply sends nothing - and every host-wide aggregate over the
 * containers still reporting looks healthy (the lowest uptime keeps rising,
 * the highest restart count stays 0). It shows only as a series that ends.
 *
 * So a container "stopped reporting" when its last data point is older than
 * the newest data point of the host's other containers by more than
 * STALE_AFTER: measured against the host's own newest data rather than the
 * clock, so a collector that is a minute behind singles nobody out, and a
 * host whose collector went silent as a whole is said once, about the host.
 *
 * Everything here is pure, over rows already read.
 */

// A container quieter than this, next to the host's newest data, stopped reporting.
export const STALE_AFTER_MS: number = 2 * 60 * 1000;

export type ContainerSortBy = "cpu" | "memory" | "restarts";

export const CONTAINER_SORT_BY_VALUES: ReadonlyArray<ContainerSortBy> = [
  "cpu",
  "memory",
  "restarts",
];

export enum ContainerStatus {
  // Seen, then silent while the host's other containers kept reporting.
  StoppedReporting = "stopped reporting",
  // First seen inside the window: started, restarted under a new id, or new.
  StartedInWindow = "started in the window",
  Reporting = "reporting",
}

// One bucket of one container's CPU, as the grouped read returns it.
export interface ContainerCpuBucket {
  containerName: string;
  imageName: string;
  bucketStart: Date;
  // Percent of one CPU core (100 = one full core); null when not a number.
  cpuPercent: number | null;
}

export interface ContainerActivity {
  containerName: string;
  // The image of its newest data point ("" when none was reported).
  imageName: string;
  // Other images it ran in the read, oldest first: it was redeployed.
  previousImageNames: Array<string>;
  status: ContainerStatus;
  firstSeenAt: Date;
  lastSeenAt: Date;
  // Over the buckets inside the window; null when it reported none there.
  cpuAverage: number | null;
  cpuPeak: number | null;
  // Peak memory in percent of its limit (or of the host); null when unknown.
  memoryPeak: number | null;
  // How many times it restarted inside the window; null when unknown.
  restartsInWindow: number | null;
}

export interface ContainerActivitySummary {
  containers: Array<ContainerActivity>;
  // The newest data point of any container of the host; null when none.
  hostLastSeenAt: Date | null;
  stoppedCount: number;
}

export default class ContainerActivityUtil {
  public static summarize(data: {
    buckets: Array<ContainerCpuBucket>;
    windowStart: Date;
    windowEnd: Date;
    // The width of one bucket: a container is never stale by less than two.
    bucketMs: number;
    memoryPeaks?: Map<string, number> | undefined;
    restarts?: Map<string, number> | undefined;
  }): ContainerActivitySummary {
    interface Accumulator {
      containerName: string;
      // Image -> the newest bucket it was seen in.
      imageLastSeen: Map<string, number>;
      imageFirstSeen: Map<string, number>;
      firstSeenMs: number;
      lastSeenMs: number;
      windowCpu: Array<number>;
    }

    const byName: Map<string, Accumulator> = new Map<string, Accumulator>();
    const windowStartMs: number = data.windowStart.getTime();
    const windowEndMs: number = data.windowEnd.getTime();

    for (const bucket of data.buckets) {
      const name: string = bucket.containerName.trim();
      const bucketMs: number = new Date(bucket.bucketStart).getTime();

      if (!name || !Number.isFinite(bucketMs)) {
        continue;
      }

      let accumulator: Accumulator | undefined = byName.get(name);

      if (!accumulator) {
        accumulator = {
          containerName: name,
          imageLastSeen: new Map<string, number>(),
          imageFirstSeen: new Map<string, number>(),
          firstSeenMs: bucketMs,
          lastSeenMs: bucketMs,
          windowCpu: [],
        };
        byName.set(name, accumulator);
      }

      accumulator.firstSeenMs = Math.min(accumulator.firstSeenMs, bucketMs);
      accumulator.lastSeenMs = Math.max(accumulator.lastSeenMs, bucketMs);

      const image: string = bucket.imageName.trim();
      accumulator.imageLastSeen.set(
        image,
        Math.max(accumulator.imageLastSeen.get(image) ?? bucketMs, bucketMs),
      );
      accumulator.imageFirstSeen.set(
        image,
        Math.min(accumulator.imageFirstSeen.get(image) ?? bucketMs, bucketMs),
      );

      /*
       * A bucket belongs to the window when it starts inside it: the bucket
       * the window starts in is the lookback's, unless it starts there too.
       */
      if (
        bucketMs >= windowStartMs &&
        bucketMs <= windowEndMs &&
        bucket.cpuPercent !== null &&
        Number.isFinite(bucket.cpuPercent)
      ) {
        accumulator.windowCpu.push(bucket.cpuPercent);
      }
    }

    const accumulators: Array<Accumulator> = Array.from(byName.values());
    const hostLastSeenMs: number | null =
      accumulators.length > 0
        ? Math.max(
            ...accumulators.map((accumulator: Accumulator): number => {
              return accumulator.lastSeenMs;
            }),
          )
        : null;
    const staleAfterMs: number = Math.max(STALE_AFTER_MS, 2 * data.bucketMs);

    const containers: Array<ContainerActivity> = accumulators.map(
      (accumulator: Accumulator): ContainerActivity => {
        const images: Array<string> = Array.from(
          accumulator.imageLastSeen.keys(),
        ).sort((a: string, b: string): number => {
          return (
            (accumulator.imageFirstSeen.get(a) || 0) -
            (accumulator.imageFirstSeen.get(b) || 0)
          );
        });
        const imageName: string = images.reduce(
          (newest: string, image: string): string => {
            return (accumulator.imageLastSeen.get(image) || 0) >=
              (accumulator.imageLastSeen.get(newest) || 0)
              ? image
              : newest;
          },
          images[0] || "",
        );

        let status: ContainerStatus = ContainerStatus.Reporting;

        if (
          hostLastSeenMs !== null &&
          hostLastSeenMs - accumulator.lastSeenMs >= staleAfterMs
        ) {
          status = ContainerStatus.StoppedReporting;
        } else if (accumulator.firstSeenMs >= windowStartMs) {
          status = ContainerStatus.StartedInWindow;
        }

        const cpu: Array<number> = accumulator.windowCpu;

        return {
          containerName: accumulator.containerName,
          imageName,
          previousImageNames: images.filter((image: string): boolean => {
            return image !== imageName && image !== "";
          }),
          status,
          firstSeenAt: new Date(accumulator.firstSeenMs),
          lastSeenAt: new Date(accumulator.lastSeenMs),
          cpuAverage:
            cpu.length > 0
              ? cpu.reduce((sum: number, value: number): number => {
                  return sum + value;
                }, 0) / cpu.length
              : null,
          cpuPeak: cpu.length > 0 ? Math.max(...cpu) : null,
          memoryPeak: ContainerActivityUtil.readNumber(
            data.memoryPeaks,
            accumulator.containerName,
          ),
          restartsInWindow: ContainerActivityUtil.readNumber(
            data.restarts,
            accumulator.containerName,
          ),
        };
      },
    );

    return {
      containers,
      hostLastSeenAt: hostLastSeenMs !== null ? new Date(hostLastSeenMs) : null,
      stoppedCount: containers.filter(
        (container: ContainerActivity): boolean => {
          return container.status === ContainerStatus.StoppedReporting;
        },
      ).length,
    };
  }

  /*
   * The order a reader needs them in: the containers that stopped reporting
   * first (the most recent stop first) - they are what host-wide numbers
   * hide - then the busiest by `sortBy`, then by name.
   */
  public static sort(
    containers: Array<ContainerActivity>,
    sortBy: ContainerSortBy,
  ): Array<ContainerActivity> {
    const score: (container: ContainerActivity) => Array<number> = (
      container: ContainerActivity,
    ): Array<number> => {
      if (sortBy === "memory") {
        return [
          container.memoryPeak ?? -1,
          container.cpuAverage ?? -1,
          container.cpuPeak ?? -1,
        ];
      }

      if (sortBy === "restarts") {
        return [
          container.restartsInWindow ?? -1,
          container.cpuAverage ?? -1,
          container.cpuPeak ?? -1,
        ];
      }

      return [
        container.cpuAverage ?? -1,
        container.cpuPeak ?? -1,
        container.memoryPeak ?? -1,
      ];
    };

    return [...containers].sort(
      (a: ContainerActivity, b: ContainerActivity): number => {
        const aStopped: boolean = a.status === ContainerStatus.StoppedReporting;
        const bStopped: boolean = b.status === ContainerStatus.StoppedReporting;

        if (aStopped !== bStopped) {
          return aStopped ? -1 : 1;
        }

        if (aStopped && bStopped) {
          const byStop: number =
            b.lastSeenAt.getTime() - a.lastSeenAt.getTime();

          if (byStop !== 0) {
            return byStop;
          }
        }

        const aScore: Array<number> = score(a);
        const bScore: Array<number> = score(b);

        for (let index: number = 0; index < aScore.length; index++) {
          const difference: number = bScore[index]! - aScore[index]!;

          if (difference !== 0) {
            return difference;
          }
        }

        return a.containerName.localeCompare(b.containerName);
      },
    );
  }

  private static readNumber(
    values: Map<string, number> | undefined,
    containerName: string,
  ): number | null {
    const value: number | undefined = values?.get(containerName);

    return value !== undefined && Number.isFinite(value) ? value : null;
  }
}
