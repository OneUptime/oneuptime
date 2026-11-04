import { describe, expect, test } from "@jest/globals";
import {
  OPENSTACK_CEILOMETER_NORMALIZED_SERIES_PER_INSTANCE,
  OPENSTACK_CEILOMETER_ORIGINAL_SERIES_PER_DISK,
  OPENSTACK_CEILOMETER_ORIGINAL_SERIES_PER_INSTANCE,
  OPENSTACK_CEILOMETER_ORIGINAL_SERIES_PER_INTERFACE,
  OPENSTACK_HYPERVISOR_ATTRIBUTE,
  OPENSTACK_INSTANCE_DEVICE_ATTRIBUTE,
  OPENSTACK_INSTANCE_ID_ATTRIBUTE,
  OPENSTACK_INSTANCE_PROJECT_ATTRIBUTE,
  OPENSTACK_INSTANCE_SOURCE_ATTRIBUTE,
  OPENSTACK_LIBVIRT_NORMALIZED_SERIES_PER_INSTANCE,
  OPENSTACK_LIBVIRT_ORIGINAL_SERIES_PER_DISK,
  OPENSTACK_LIBVIRT_ORIGINAL_SERIES_PER_INSTANCE,
  OPENSTACK_LIBVIRT_ORIGINAL_SERIES_PER_INTERFACE,
  OPENSTACK_LIBVIRT_ORIGINAL_SERIES_PER_VCPU,
  OPENSTACK_NORMALIZED_SERIES_PER_DISK,
  OPENSTACK_NORMALIZED_SERIES_PER_INTERFACE,
  OpenStackHypervisorMetric,
  OpenStackInstanceMetric,
  OpenStackInstanceMetricSource,
  OpenStackInstanceUsageReading,
  mergeOpenStackInstanceUsage,
  rankOpenStackInstancesByCpu,
} from "../../../../Types/OpenStack/OpenStackInstanceMetrics";
import {
  OPENSTACK_CEILOMETER_SERIES,
  OPENSTACK_LIBVIRT_SERIES,
  OpenStackInstancePlacement,
} from "../../../../Server/Utils/Telemetry/OpenStackInstanceMetricsScan";
import { PrometheusSeries } from "../../../Helpers/OpenStackInstanceMetricsFixtures";
import {
  InstanceMetricsRecording,
  RECORDED_HYPERVISOR,
  RecordedServer,
  ReplayedPoint,
  getRecordedInstanceMetricsReleases,
  meanOf,
  pointsOfHypervisor,
  pointsOfInstance,
  readInstanceMetricsRecording,
  recordedPlacements,
  recordedSeries,
  recordedServerNamed,
  replayRecordedSource,
  sourceOf,
  valuesOf,
} from "../../../Helpers/OpenStackInstanceMetricsRecordings";

/*
 * THE SAME INSTANCES, THE SAME MOMENTS, BOTH SOURCES. Real DevStacks, on every release the rig runs:
 * ou-burner spins on its one vCPU, writes to its disk and sends packets, ou-running and ou-research-1
 * sit idle, and ou-stopped is shut off. Each exporter was read every 30 seconds, and Ceilometer was
 * polling every minute. So what a right answer is, is known, and each test below says what it was.
 *
 * Everything here goes through ingest's own path: Tests/Helpers/OpenStackInstanceMetricsRecordings.ts.
 * Nothing here is a made-up row: those are in OpenStackInstanceMetricsScan.test.ts.
 */

const RELEASES: Array<string> = getRecordedInstanceMetricsReleases();

const LIBVIRT: OpenStackInstanceMetricSource =
  OpenStackInstanceMetricSource.Libvirt;
const CEILOMETER: OpenStackInstanceMetricSource =
  OpenStackInstanceMetricSource.Ceilometer;
const SOURCES: Array<OpenStackInstanceMetricSource> = [LIBVIRT, CEILOMETER];

const MIB: number = 1024 * 1024;
// estate.sh makes every one of these with this flavor: one vCPU and 128 MiB.
const FLAVOR_MEMORY_BYTES: number = 128 * MIB;

function seriesNamed(
  series: ReadonlyArray<PrometheusSeries>,
  name: string,
): Array<PrometheusSeries> {
  return series.filter((one: PrometheusSeries): boolean => {
    return one.name === name;
  });
}

function domainOf(
  recording: InstanceMetricsRecording,
  server: RecordedServer,
): string {
  const identity: PrometheusSeries | undefined = seriesNamed(
    recordedSeries(recording, LIBVIRT)[0]!.series,
    "libvirt_domain_openstack_info",
  ).find((one: PrometheusSeries): boolean => {
    return one.labels["instance_id"] === server.id;
  });
  return identity!.labels["domain"]!;
}

test("every release the rig runs has been recorded", () => {
  expect(RELEASES).toEqual(
    expect.arrayContaining([
      "epoxy-ovn",
      "flamingo-ovn",
      "gazpacho-ovn",
      "hibiscus-ovn",
    ]),
  );
});

describe.each(RELEASES)("%s", (release: string) => {
  const recording: InstanceMetricsRecording =
    readInstanceMetricsRecording(release);
  const burner: RecordedServer = recordedServerNamed(recording, "ou-burner");
  const idle: RecordedServer = recordedServerNamed(recording, "ou-running");
  const stopped: RecordedServer = recordedServerNamed(recording, "ou-stopped");

  const replayed: Record<
    OpenStackInstanceMetricSource,
    Array<ReplayedPoint>
  > = {
    [LIBVIRT]: replayRecordedSource({ recording, source: LIBVIRT }),
    [CEILOMETER]: replayRecordedSource({ recording, source: CEILOMETER }),
  };

  describe("what the two exporters really say", () => {
    const libvirt: Array<PrometheusSeries> = recordedSeries(
      recording,
      LIBVIRT,
    ).flatMap((scrape: { series: Array<PrometheusSeries> }) => {
      return scrape.series;
    });
    const ceilometer: Array<PrometheusSeries> = recordedSeries(
      recording,
      CEILOMETER,
    ).flatMap((scrape: { series: Array<PrometheusSeries> }) => {
      return scrape.series;
    });

    test("both answered every scrape", () => {
      expect(recordedSeries(recording, LIBVIRT).length).toBeGreaterThan(5);
      expect(recordedSeries(recording, CEILOMETER)).toHaveLength(
        recordedSeries(recording, LIBVIRT).length,
      );
    });

    test("libvirt_domain_info_memory_usage_bytes is the balloon's size: the flavor's memory, on a shut-off instance too", () => {
      const balloon: Array<PrometheusSeries> = seriesNamed(
        libvirt,
        "libvirt_domain_info_memory_usage_bytes",
      );
      expect(balloon.length).toBeGreaterThan(0);
      for (const one of balloon) {
        expect(one.value).toBe(FLAVOR_MEMORY_BYTES);
      }
    });

    test("no release has Ceilometer's cpu.delay yet, so CPU waiting only ever comes from libvirt", () => {
      expect(seriesNamed(ceilometer, "ceilometer_cpu_delay")).toEqual([]);
      expect(
        seriesNamed(libvirt, "libvirt_domain_vcpu_delay_seconds_total").length,
      ).toBeGreaterThan(0);
    });

    test("every other series the scan reads from libvirt is really there", () => {
      for (const name of OPENSTACK_LIBVIRT_SERIES.keys()) {
        expect(`${name}: ${seriesNamed(libvirt, name).length > 0}`).toBe(
          `${name}: true`,
        );
      }
    });

    test("and from Ceilometer, but for cpu.delay, and vcpus on Epoxy", () => {
      for (const name of OPENSTACK_CEILOMETER_SERIES.keys()) {
        const isMissingHere: boolean =
          name === "ceilometer_cpu_delay" ||
          (name === "ceilometer_vcpus" && release === "epoxy-ovn");
        expect(`${name}: ${seriesNamed(ceilometer, name).length > 0}`).toBe(
          `${name}: ${!isMissingHere}`,
        );
      }
    });

    test("a shut-off instance reads a CPU time of exactly 0 from libvirt, and has no other reading", () => {
      const domain: string = domainOf(recording, stopped);
      const readings: Array<PrometheusSeries> = libvirt.filter(
        (one: PrometheusSeries): boolean => {
          return one.labels["domain"] === domain;
        },
      );
      const cpu: Array<PrometheusSeries> = seriesNamed(
        readings,
        "libvirt_domain_info_cpu_time_seconds_total",
      );
      expect(cpu.length).toBeGreaterThan(0);
      for (const one of cpu) {
        expect(one.value).toBe(0);
      }
      for (const name of [
        "libvirt_domain_memory_stats_rss_bytes",
        "libvirt_domain_memory_stats_available_bytes",
        "libvirt_domain_vcpu_delay_seconds_total",
        "libvirt_domain_block_stats_read_bytes_total",
        "libvirt_domain_interface_stats_receive_bytes_total",
      ]) {
        expect(seriesNamed(readings, name)).toEqual([]);
      }
    });

    test("and Ceilometer says nothing about it at all", () => {
      expect(
        ceilometer.filter((one: PrometheusSeries): boolean => {
          return (one.labels["resource"] || "").includes(stopped.id);
        }),
      ).toEqual([]);
    });

    test("what an instance holds on its host is the same bytes from each, whatever Ceilometer's unit label says", () => {
      const domain: string = domainOf(recording, idle);
      const rss: PrometheusSeries = seriesNamed(
        libvirt,
        "libvirt_domain_memory_stats_rss_bytes",
      ).find((one: PrometheusSeries): boolean => {
        return one.labels["domain"] === domain;
      })!;
      const resident: PrometheusSeries = seriesNamed(
        ceilometer,
        "ceilometer_memory_resident",
      ).find((one: PrometheusSeries): boolean => {
        return one.labels["resource"] === idle.id;
      })!;
      expect(["MB", "MiB"]).toContain(resident.labels["unit"]);
      expect(resident.value * MIB).toBeCloseTo(rss.value, -6);
      // More than its flavor, because QEMU itself is in it.
      expect(rss.value).toBeGreaterThan(FLAVOR_MEMORY_BYTES);
    });

    test("what the guest uses is available less usable from libvirt, and exactly Ceilometer's number", () => {
      const domain: string = domainOf(recording, idle);
      const usableOf: Array<PrometheusSeries> = seriesNamed(
        libvirt,
        "libvirt_domain_memory_stats_usable_bytes",
      ).filter((one: PrometheusSeries): boolean => {
        return one.labels["domain"] === domain;
      });
      const availableOf: Array<PrometheusSeries> = seriesNamed(
        libvirt,
        "libvirt_domain_memory_stats_available_bytes",
      ).filter((one: PrometheusSeries): boolean => {
        return one.labels["domain"] === domain;
      });
      const fromCeilometer: Array<number> = seriesNamed(
        ceilometer,
        "ceilometer_memory_usage",
      )
        .filter((one: PrometheusSeries): boolean => {
          return one.labels["resource"] === idle.id;
        })
        .map((one: PrometheusSeries): number => {
          return one.value * MIB;
        });
      const fromLibvirt: Array<number> = usableOf.map(
        (one: PrometheusSeries, index: number): number => {
          return availableOf[index]!.value - one.value;
        },
      );
      // A guest's memory moves between a poll and a scrape, so one of them has to line up.
      const closest: number = Math.min(
        ...fromCeilometer.flatMap((one: number): Array<number> => {
          return fromLibvirt.map((other: number): number => {
            return Math.abs(one - other);
          });
        }),
      );
      expect(closest).toBeLessThan(MIB);
    });

    test("a config drive's CD-ROM has counters from Ceilometer and none from libvirt's exporter", () => {
      expect(
        seriesNamed(
          libvirt,
          "libvirt_domain_block_stats_read_bytes_total",
        ).filter((one: PrometheusSeries): boolean => {
          return one.labels["target_device"] === "hda";
        }),
      ).toEqual([]);
      expect(
        seriesNamed(ceilometer, "ceilometer_disk_device_read_bytes").filter(
          (one: PrometheusSeries): boolean => {
            return one.labels["resource"] === `${burner.id}-hda`;
          },
        ).length,
      ).toBeGreaterThan(0);
    });

    test("a disk's time and its requests are the same counters from each", () => {
      const domain: string = domainOf(recording, burner);
      const time: PrometheusSeries = seriesNamed(
        libvirt,
        "libvirt_domain_block_stats_read_time_seconds_total",
      ).find((one: PrometheusSeries): boolean => {
        return (
          one.labels["domain"] === domain &&
          one.labels["target_device"] === "vda"
        );
      })!;
      const latency: PrometheusSeries = seriesNamed(
        ceilometer,
        "ceilometer_disk_device_read_latency",
      ).find((one: PrometheusSeries): boolean => {
        return one.labels["resource"] === `${burner.id}-vda`;
      })!;
      expect(latency.labels["unit"]).toBe("ns");
      expect(latency.value / 1e9).toBeCloseTo(time.value, 3);
    });
  });

  describe("what one instance really costs", () => {
    // ou-research-1 has one vCPU, one disk and one interface, and no config drive.
    const plain: RecordedServer = recordedServerNamed(
      recording,
      "ou-research-1",
    );

    test("libvirt says as many series about it as the estimate says", () => {
      const domain: string = domainOf(recording, plain);
      const series: Array<PrometheusSeries> = recordedSeries(
        recording,
        LIBVIRT,
      )[0]!.series.filter((one: PrometheusSeries): boolean => {
        return (
          one.labels["domain"] === domain &&
          OPENSTACK_LIBVIRT_SERIES.has(one.name)
        );
      });
      expect(series).toHaveLength(
        OPENSTACK_LIBVIRT_ORIGINAL_SERIES_PER_INSTANCE +
          OPENSTACK_LIBVIRT_ORIGINAL_SERIES_PER_VCPU +
          OPENSTACK_LIBVIRT_ORIGINAL_SERIES_PER_DISK +
          OPENSTACK_LIBVIRT_ORIGINAL_SERIES_PER_INTERFACE,
      );
    });

    test("and Ceilometer, which has one fewer on Epoxy, for want of a vcpus", () => {
      const series: Array<PrometheusSeries> = recordedSeries(
        recording,
        CEILOMETER,
      )[0]!.series.filter((one: PrometheusSeries): boolean => {
        return (
          (one.labels["resource"] || "").includes(plain.id) &&
          OPENSTACK_CEILOMETER_SERIES.has(one.name)
        );
      });
      expect(series).toHaveLength(
        OPENSTACK_CEILOMETER_ORIGINAL_SERIES_PER_INSTANCE +
          OPENSTACK_CEILOMETER_ORIGINAL_SERIES_PER_DISK +
          OPENSTACK_CEILOMETER_ORIGINAL_SERIES_PER_INTERFACE -
          (release === "epoxy-ovn" ? 1 : 0),
      );
    });

    test.each(SOURCES)(
      "what %s comes to in series worked out is no more than the estimate says",
      (source: OpenStackInstanceMetricSource) => {
        const names: Set<string> = new Set(
          replayed[source]
            .filter((point: ReplayedPoint): boolean => {
              return (
                point.attributes[OPENSTACK_INSTANCE_ID_ATTRIBUTE] === plain.id
              );
            })
            .map((point: ReplayedPoint): string => {
              return `${point.name}|${point.attributes[OPENSTACK_INSTANCE_DEVICE_ATTRIBUTE] || ""}`;
            }),
        );
        expect(names.size).toBeGreaterThan(0);
        expect(names.size).toBeLessThanOrEqual(
          (source === LIBVIRT
            ? OPENSTACK_LIBVIRT_NORMALIZED_SERIES_PER_INSTANCE
            : OPENSTACK_CEILOMETER_NORMALIZED_SERIES_PER_INSTANCE) +
            OPENSTACK_NORMALIZED_SERIES_PER_DISK +
            OPENSTACK_NORMALIZED_SERIES_PER_INTERFACE,
        );
      },
    );

    test("Ceilometer adds a row worked out once a poll, however often it is read", () => {
      const rows: number = pointsOfInstance(
        replayed[CEILOMETER],
        OpenStackInstanceMetric.DiskWriteRate,
        plain.id,
        "vda",
      ).length;
      // A poll a minute and a read every 30 seconds: half as many rows as reads, at most.
      expect(rows).toBeGreaterThan(0);
      expect(rows).toBeLessThanOrEqual(
        Math.ceil(recordedSeries(recording, CEILOMETER).length / 2),
      );
    });
  });

  describe("rates", () => {
    test("dividing Ceilometer's change by the time between scrapes is the trap: twice the truth, then nothing", () => {
      const samples: Array<{ atMs: number; value: number }> = recordedSeries(
        recording,
        CEILOMETER,
      ).flatMap((scrape: { atMs: number; series: Array<PrometheusSeries> }) => {
        return seriesNamed(scrape.series, "ceilometer_cpu")
          .filter((one: PrometheusSeries): boolean => {
            return one.labels["resource"] === burner.id;
          })
          .map((one: PrometheusSeries): { atMs: number; value: number } => {
            return { atMs: scrape.atMs, value: one.value / 1e9 };
          });
      });
      const naive: Array<number> = samples
        .slice(1)
        .map(
          (sample: { atMs: number; value: number }, index: number): number => {
            return (
              (sample.value - samples[index]!.value) /
              ((sample.atMs - samples[index]!.atMs) / 1000)
            );
          },
        );
      expect(Math.max(...naive)).toBeGreaterThan(1.8);
      expect(Math.min(...naive)).toBe(0);
    });

    test.each(SOURCES)(
      "%s reads the burning instance as one CPU thread, at every reading",
      (source: OpenStackInstanceMetricSource) => {
        const cores: Array<number> = valuesOf(
          pointsOfInstance(
            replayed[source],
            OpenStackInstanceMetric.CpuUsage,
            burner.id,
          ),
        );
        expect(cores.length).toBeGreaterThanOrEqual(2);
        for (const value of cores) {
          expect(value).toBeGreaterThan(0.95);
          expect(value).toBeLessThan(1.05);
        }
      },
    );

    test.each(SOURCES)(
      "%s reads that as all of its one vCPU",
      (source: OpenStackInstanceMetricSource) => {
        const percent: Array<number> = valuesOf(
          pointsOfInstance(
            replayed[source],
            OpenStackInstanceMetric.CpuUtilization,
            burner.id,
          ),
        );
        expect(percent.length).toBeGreaterThanOrEqual(2);
        for (const value of percent) {
          expect(value).toBeGreaterThan(95);
          expect(value).toBeLessThan(105);
        }
      },
    );

    test.each(SOURCES)(
      "%s reads an idle instance as next to nothing, rather than as nothing",
      (source: OpenStackInstanceMetricSource) => {
        const cores: Array<number> = valuesOf(
          pointsOfInstance(
            replayed[source],
            OpenStackInstanceMetric.CpuUsage,
            idle.id,
          ),
        );
        expect(cores.length).toBeGreaterThanOrEqual(2);
        for (const value of cores) {
          expect(value).toBeGreaterThan(0);
          expect(value).toBeLessThan(0.02);
        }
      },
    );

    test.each(SOURCES)(
      "%s says nothing at all about a shut-off instance",
      (source: OpenStackInstanceMetricSource) => {
        expect(
          replayed[source].filter((point: ReplayedPoint): boolean => {
            return (
              point.attributes[OPENSTACK_INSTANCE_ID_ATTRIBUTE] === stopped.id
            );
          }),
        ).toEqual([]);
      },
    );

    test("CPU waiting is real, and on a runner with room to spare it is almost nothing", () => {
      const waiting: Array<number> = valuesOf(
        pointsOfInstance(
          replayed[LIBVIRT],
          OpenStackInstanceMetric.CpuContention,
          burner.id,
        ),
      );
      expect(waiting.length).toBeGreaterThanOrEqual(2);
      for (const value of waiting) {
        expect(value).toBeGreaterThan(0);
        expect(value).toBeLessThan(5);
      }
    });

    test("the two agree on what the burner writes to its disk", () => {
      const average: (source: OpenStackInstanceMetricSource) => number = (
        source: OpenStackInstanceMetricSource,
      ): number => {
        return meanOf(
          valuesOf(
            pointsOfInstance(
              replayed[source],
              OpenStackInstanceMetric.DiskWriteRate,
              burner.id,
              "vda",
            ),
          ),
        );
      };
      // It writes 8 MiB every few seconds, on a runner that takes its time over it.
      expect(average(LIBVIRT)).toBeGreaterThan(MIB);
      expect(average(CEILOMETER) / average(LIBVIRT)).toBeGreaterThan(0.8);
      expect(average(CEILOMETER) / average(LIBVIRT)).toBeLessThan(1.25);
    });

    test("and on how long each write took", () => {
      const average: (source: OpenStackInstanceMetricSource) => number = (
        source: OpenStackInstanceMetricSource,
      ): number => {
        return meanOf(
          valuesOf(
            pointsOfInstance(
              replayed[source],
              OpenStackInstanceMetric.DiskWriteLatency,
              burner.id,
              "vda",
            ),
          ),
        );
      };
      expect(average(LIBVIRT)).toBeGreaterThan(0);
      expect(average(CEILOMETER) / average(LIBVIRT)).toBeGreaterThan(0.6);
      expect(average(CEILOMETER) / average(LIBVIRT)).toBeLessThan(1.6);
    });

    test("and on what it sends over its interface", () => {
      const average: (source: OpenStackInstanceMetricSource) => number = (
        source: OpenStackInstanceMetricSource,
      ): number => {
        return meanOf(
          valuesOf(
            pointsOfInstance(
              replayed[source],
              OpenStackInstanceMetric.NetworkTransmitRate,
              burner.id,
            ),
          ),
        );
      };
      expect(average(LIBVIRT)).toBeGreaterThan(0);
      expect(average(CEILOMETER) / average(LIBVIRT)).toBeGreaterThan(0.7);
      expect(average(CEILOMETER) / average(LIBVIRT)).toBeLessThan(1.4);
    });

    test("nothing the burner read from its disk reads as anything but what it read: nothing", () => {
      for (const source of SOURCES) {
        for (const value of valuesOf(
          pointsOfInstance(
            replayed[source],
            OpenStackInstanceMetric.DiskReadRate,
            burner.id,
            "vda",
          ),
        )) {
          expect(value).toBe(0);
        }
      }
    });

    test.each(SOURCES)(
      "%s reads memory in use as what the guest uses, far under its flavor's size",
      (source: OpenStackInstanceMetricSource) => {
        const inUse: Array<number> = valuesOf(
          pointsOfInstance(
            replayed[source],
            OpenStackInstanceMetric.MemoryUsage,
            idle.id,
          ),
        );
        expect(inUse.length).toBeGreaterThan(0);
        for (const value of inUse) {
          expect(value).toBeGreaterThan(20 * MIB);
          expect(value).toBeLessThan(FLAVOR_MEMORY_BYTES * 0.6);
        }
      },
    );

    test("a scrape that repeats a poll's values adds no row, so Ceilometer costs fewer rows than scrapes", () => {
      const rows: number = pointsOfInstance(
        replayed[CEILOMETER],
        OpenStackInstanceMetric.CpuUsage,
        burner.id,
      ).length;
      const scrapes: number = recordedSeries(recording, CEILOMETER).length;
      expect(rows).toBeLessThanOrEqual(Math.ceil(scrapes / 2));
    });
  });

  describe("one shape", () => {
    function namesFrom(source: OpenStackInstanceMetricSource): Set<string> {
      return new Set(
        replayed[source].map((point: ReplayedPoint): string => {
          return point.name;
        }),
      );
    }

    function keysOf(point: ReplayedPoint): Array<string> {
      return Object.keys(point.attributes).sort();
    }

    test("the same series come out of each, but for what Ceilometer doesn't say", () => {
      const fromLibvirt: Set<string> = namesFrom(LIBVIRT);
      const fromCeilometer: Set<string> = namesFrom(CEILOMETER);
      expect(fromLibvirt.has(OpenStackInstanceMetric.CpuContention)).toBe(true);
      expect(fromCeilometer.has(OpenStackInstanceMetric.CpuContention)).toBe(
        false,
      );
      fromLibvirt.delete(OpenStackInstanceMetric.CpuContention);
      expect(Array.from(fromCeilometer).sort()).toEqual(
        Array.from(fromLibvirt).sort(),
      );
    });

    test("every instance series the product has comes out, on the same recorded instance", () => {
      const fromLibvirt: Set<string> = new Set(
        replayed[LIBVIRT].filter((point: ReplayedPoint): boolean => {
          return (
            point.attributes[OPENSTACK_INSTANCE_ID_ATTRIBUTE] === burner.id
          );
        }).map((point: ReplayedPoint): string => {
          return point.name;
        }),
      );
      for (const name of Object.values(OpenStackInstanceMetric)) {
        // A disk nobody read from has no read latency, from either.
        if (name !== OpenStackInstanceMetric.DiskReadLatency) {
          expect(`${name}: ${fromLibvirt.has(name)}`).toBe(`${name}: true`);
        }
      }
    });

    test.each(Object.values(OpenStackInstanceMetric))(
      "%s has the same unit and labels from each, keyed by the instance's UUID",
      (name: string) => {
        const fromLibvirt: ReplayedPoint | undefined = pointsOfInstance(
          replayed[LIBVIRT],
          name,
          burner.id,
        )[0];
        const fromCeilometer: ReplayedPoint | undefined = pointsOfInstance(
          replayed[CEILOMETER],
          name,
          burner.id,
          fromLibvirt?.attributes[OPENSTACK_INSTANCE_DEVICE_ATTRIBUTE],
        )[0];
        if (!fromLibvirt || !fromCeilometer) {
          // Contention, from one source. An unread disk's read latency, from neither.
          expect([
            OpenStackInstanceMetric.CpuContention,
            OpenStackInstanceMetric.DiskReadLatency,
          ]).toContain(name);
          return;
        }
        expect(fromCeilometer.unit).toBe(fromLibvirt.unit);
        expect(keysOf(fromCeilometer)).toEqual(keysOf(fromLibvirt));
        for (const key of keysOf(fromLibvirt)) {
          if (key === OPENSTACK_INSTANCE_SOURCE_ATTRIBUTE) {
            expect(sourceOf(fromLibvirt)).toBe(LIBVIRT);
            expect(sourceOf(fromCeilometer)).toBe(CEILOMETER);
          } else {
            expect(fromCeilometer.attributes[key]).toBe(
              fromLibvirt.attributes[key],
            );
          }
        }
        expect(fromLibvirt.attributes[OPENSTACK_INSTANCE_ID_ATTRIBUTE]).toBe(
          burner.id,
        );
        expect(
          fromLibvirt.attributes[OPENSTACK_INSTANCE_PROJECT_ATTRIBUTE],
        ).toBe(
          seriesNamed(
            recordedSeries(recording, LIBVIRT)[0]!.series,
            "libvirt_domain_openstack_info",
          ).find((one: PrometheusSeries): boolean => {
            return one.labels["instance_id"] === burner.id;
          })!.labels["project_id"],
        );
        expect(fromLibvirt.attributes[OPENSTACK_HYPERVISOR_ATTRIBUTE]).toBe(
          RECORDED_HYPERVISOR,
        );
      },
    );

    test.each([
      [OpenStackInstanceMetric.CpuUsage, 0.03],
      [OpenStackInstanceMetric.CpuUtilization, 3],
    ])("%s reads the same number from each", (name: string, within: number) => {
      const of: (source: OpenStackInstanceMetricSource) => number = (
        source: OpenStackInstanceMetricSource,
      ): number => {
        return meanOf(
          valuesOf(pointsOfInstance(replayed[source], name, burner.id)),
        );
      };
      expect(Math.abs(of(LIBVIRT) - of(CEILOMETER))).toBeLessThan(within);
    });

    test("memory held reads the same number from each", () => {
      const of: (source: OpenStackInstanceMetricSource) => number = (
        source: OpenStackInstanceMetricSource,
      ): number => {
        return meanOf(
          valuesOf(
            pointsOfInstance(
              replayed[source],
              OpenStackInstanceMetric.MemoryResident,
              idle.id,
            ),
          ),
        );
      };
      expect(Math.abs(of(LIBVIRT) - of(CEILOMETER))).toBeLessThan(2 * MIB);
    });

    test("the same disks and interfaces, but for a config drive's CD-ROM, which libvirt's exporter leaves out", () => {
      const devicesFrom: (
        source: OpenStackInstanceMetricSource,
        metric: string,
      ) => Set<string> = (
        source: OpenStackInstanceMetricSource,
        metric: string,
      ): Set<string> => {
        return new Set(
          pointsOfInstance(replayed[source], metric, burner.id).map(
            (point: ReplayedPoint): string => {
              return point.attributes[OPENSTACK_INSTANCE_DEVICE_ATTRIBUTE]!;
            },
          ),
        );
      };
      expect(
        Array.from(devicesFrom(LIBVIRT, OpenStackInstanceMetric.DiskWriteRate)),
      ).toEqual(["vda"]);
      expect(
        Array.from(
          devicesFrom(CEILOMETER, OpenStackInstanceMetric.DiskWriteRate),
        ),
      ).toContain("vda");
      expect(
        Array.from(
          devicesFrom(LIBVIRT, OpenStackInstanceMetric.NetworkTransmitRate),
        ),
      ).toEqual(
        Array.from(
          devicesFrom(CEILOMETER, OpenStackInstanceMetric.NetworkTransmitRate),
        ),
      );
    });
  });

  describe("what a source that doesn't report its own vCPUs comes to", () => {
    // Epoxy's Ceilometer has no vcpus series, and the polling.yaml it ships doesn't ask any release for one.
    const withoutVcpus: Array<ReplayedPoint> = replayRecordedSource({
      recording,
      source: CEILOMETER,
      leaveOut: (line: string): boolean => {
        return line.startsWith("ceilometer_vcpus");
      },
    });

    test("the burner is still all of its one vCPU, from what its flavor says", () => {
      const percent: Array<number> = valuesOf(
        pointsOfInstance(
          withoutVcpus,
          OpenStackInstanceMetric.CpuUtilization,
          burner.id,
        ),
      );
      expect(percent.length).toBeGreaterThanOrEqual(2);
      for (const value of percent) {
        expect(value).toBeGreaterThan(95);
        expect(value).toBeLessThan(105);
      }
    });
  });

  describe("what the polling.yaml Ceilometer ships leaves out", () => {
    // It asks for no vcpus, no memory.resident and no disk latency: etc/ceilometer/polling.yaml.
    const shipped: Array<ReplayedPoint> = replayRecordedSource({
      recording,
      source: CEILOMETER,
      leaveOut: (line: string): boolean => {
        return (
          line.startsWith("ceilometer_vcpus") ||
          line.startsWith("ceilometer_memory_resident") ||
          line.includes("_latency{")
        );
      },
    });

    test("CPU, disk and network still read", () => {
      expect(
        pointsOfInstance(
          shipped,
          OpenStackInstanceMetric.CpuUtilization,
          burner.id,
        ).length,
      ).toBeGreaterThanOrEqual(2);
      expect(
        pointsOfInstance(
          shipped,
          OpenStackInstanceMetric.DiskWriteRate,
          burner.id,
        ).length,
      ).toBeGreaterThanOrEqual(2);
    });

    test("and what it didn't ask for is left out, never made up", () => {
      for (const name of [
        OpenStackInstanceMetric.MemoryResident,
        OpenStackInstanceMetric.DiskWriteLatency,
        OpenStackInstanceMetric.DiskReadLatency,
      ]) {
        expect(
          shipped.filter((point: ReplayedPoint): boolean => {
            return point.name === name;
          }),
        ).toEqual([]);
      }
      expect(
        pointsOfHypervisor(
          shipped,
          OpenStackHypervisorMetric.InstancesMemoryResident,
        ),
      ).toEqual([]);
    });

    test("its hypervisor's CPU still adds up", () => {
      expect(
        Math.max(
          ...valuesOf(
            pointsOfHypervisor(
              shipped,
              OpenStackHypervisorMetric.InstancesCpuUsage,
            ),
          ),
        ),
      ).toBeGreaterThan(0.95);
    });
  });

  describe("a hypervisor", () => {
    function busiestOf(
      source: OpenStackInstanceMetricSource,
    ): Array<OpenStackInstanceUsageReading> {
      const averages: (name: string) => Map<string, number> = (
        name: string,
      ): Map<string, number> => {
        const byInstance: Map<string, Array<number>> = new Map();
        for (const point of replayed[source]) {
          if (point.name === name) {
            const id: string =
              point.attributes[OPENSTACK_INSTANCE_ID_ATTRIBUTE]!;
            byInstance.set(id, [...(byInstance.get(id) || []), point.value]);
          }
        }
        return new Map(
          Array.from(byInstance.entries()).map(
            ([id, values]: [string, Array<number>]): [string, number] => {
              return [id, meanOf(values)];
            },
          ),
        );
      };
      return rankOpenStackInstancesByCpu(
        mergeOpenStackInstanceUsage({
          cpuCores: averages(OpenStackInstanceMetric.CpuUsage),
          cpuPercent: averages(OpenStackInstanceMetric.CpuUtilization),
          contentionPercent: averages(OpenStackInstanceMetric.CpuContention),
          memoryResidentBytes: averages(OpenStackInstanceMetric.MemoryResident),
        }),
      );
    }

    test.each(SOURCES)(
      "%s names the burning instance first among those on it, and never the shut-off one",
      (source: OpenStackInstanceMetricSource) => {
        const busiest: Array<OpenStackInstanceUsageReading> = busiestOf(source);
        expect(busiest[0]!.instanceId).toBe(burner.id);
        expect(busiest[0]!.cpuCores).toBeGreaterThan(0.95);
        expect(busiest[1]!.cpuCores).toBeLessThan(0.02);
        expect(
          busiest.map((reading: OpenStackInstanceUsageReading): string => {
            return reading.instanceId;
          }),
        ).not.toContain(stopped.id);
        expect(busiest).toHaveLength(3);
      },
    );

    test.each(SOURCES)(
      "%s adds its instances up against what it really has, and counts the three that are running",
      (source: OpenStackInstanceMetricSource) => {
        // What Placement said of the runner on every recorded release: 4 threads and 15982 MiB.
        const points: Array<ReplayedPoint> = replayRecordedSource({
          recording,
          source,
          placements: new Map(
            Array.from(recordedPlacements(recording).entries()).map(
              ([id, placement]: [string, OpenStackInstancePlacement]): [
                string,
                OpenStackInstancePlacement,
              ] => {
                return [
                  id,
                  {
                    ...placement,
                    hypervisorCapacity: {
                      cores: 4,
                      memoryBytes: 15982 * MIB,
                    },
                  },
                ];
              },
            ),
          ),
        });
        const last: (name: string) => number = (name: string): number => {
          const all: Array<number> = valuesOf(pointsOfHypervisor(points, name));
          return all[all.length - 1]!;
        };
        expect(last(OpenStackHypervisorMetric.InstancesReporting)).toBe(3);
        // One thread busy of four.
        expect(
          last(OpenStackHypervisorMetric.InstancesCpuUsage),
        ).toBeGreaterThan(0.95);
        expect(last(OpenStackHypervisorMetric.InstancesCpuUsage)).toBeLessThan(
          1.1,
        );
        expect(
          last(OpenStackHypervisorMetric.InstancesCpuUtilization),
        ).toBeGreaterThan(24);
        expect(
          last(OpenStackHypervisorMetric.InstancesCpuUtilization),
        ).toBeLessThan(28);
        // Three instances' worth of about 177 MiB each.
        expect(
          last(OpenStackHypervisorMetric.InstancesMemoryResident),
        ).toBeGreaterThan(3 * 170 * MIB);
        expect(
          last(OpenStackHypervisorMetric.InstancesMemoryResident),
        ).toBeLessThan(3 * 200 * MIB);
      },
    );

    test.each(SOURCES)(
      "%s names it by Nova's own word for it",
      (source: OpenStackInstanceMetricSource) => {
        const point: ReplayedPoint = pointsOfHypervisor(
          replayed[source],
          OpenStackHypervisorMetric.InstancesCpuUsage,
        )[0]!;
        expect(point.attributes[OPENSTACK_HYPERVISOR_ATTRIBUTE]).toBe(
          RECORDED_HYPERVISOR,
        );
      },
    );
  });

  describe("however the collector's batches fall", () => {
    function everyNthLine(parts: number): (text: string) => Array<string> {
      return (text: string): Array<string> => {
        const out: Array<Array<string>> = Array.from(
          { length: parts },
          (): Array<string> => {
            return [];
          },
        );
        text.split("\n").forEach((line: string, index: number): void => {
          out[index % parts]!.push(line);
        });
        return out.map((part: Array<string>): string => {
          return part.join("\n");
        });
      };
    }

    test.each([
      [LIBVIRT, 3],
      [LIBVIRT, 17],
      [CEILOMETER, 3],
      [CEILOMETER, 17],
    ] as Array<[OpenStackInstanceMetricSource, number]>)(
      "%s split into %i batches reads the same",
      (source: OpenStackInstanceMetricSource, parts: number) => {
        const split: Array<ReplayedPoint> = replayRecordedSource({
          recording,
          source,
          split: everyNthLine(parts),
        });
        const whole: Array<number> = valuesOf(
          pointsOfInstance(
            replayed[source],
            OpenStackInstanceMetric.CpuUsage,
            burner.id,
          ),
        );
        const pieces: Array<number> = valuesOf(
          pointsOfInstance(split, OpenStackInstanceMetric.CpuUsage, burner.id),
        );
        expect(meanOf(pieces)).toBeCloseTo(meanOf(whole), 2);
      },
    );
  });
});
