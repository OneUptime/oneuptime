import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import {
  OPENSTACK_CEILOMETER_COLLECTIONS_PER_HOUR,
  OPENSTACK_INSTANCE_METRICS_AUTOMATIC_LIMIT,
  OPENSTACK_LIBVIRT_COLLECTIONS_PER_HOUR,
  OpenStackInstanceMetricSource,
  OpenStackInstanceMetricsVolume,
  estimateOpenStackInstanceMetricsVolume,
} from "../../../Types/OpenStack/OpenStackInstanceMetrics";

/*
 * What the docs say it costs and what the code says it costs, and the one sentence the host
 * guide gains, held together: a number somebody plans a bill on can't drift from the code.
 */

const DOCS: string = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Docs/Content/en/telemetry/openstack.md",
  ),
  "utf8",
);

function text(value: number): string {
  return value.toLocaleString("en-US");
}

describe("what the docs say keeping them costs", () => {
  test.each([
    [
      OpenStackInstanceMetricSource.Libvirt,
      "`prometheus-libvirt-exporter`, read every minute",
    ],
    [
      OpenStackInstanceMetricSource.Ceilometer,
      "Ceilometer's exporter, read every minute and polled every 5",
    ],
  ])(
    "%s is what the code works out",
    (source: OpenStackInstanceMetricSource, label: string) => {
      const one: OpenStackInstanceMetricsVolume =
        estimateOpenStackInstanceMetricsVolume({ source, instances: 1 });
      const hundred: OpenStackInstanceMetricsVolume =
        estimateOpenStackInstanceMetricsVolume({ source, instances: 100 });
      const thousand: OpenStackInstanceMetricsVolume =
        estimateOpenStackInstanceMetricsVolume({ source, instances: 1000 });
      expect(DOCS).toContain(
        `| ${label} | ${one.seriesPerInstance} | ${text(one.rowsPerHour)} | ${text(hundred.rowsPerMonth)} | ${text(thousand.rowsPerMonth)} |`,
      );
    },
  );

  test("the stated size is the code's", () => {
    expect(DOCS).toContain(
      `Every instance while the cloud has ${OPENSTACK_INSTANCE_METRICS_AUTOMATIC_LIMIT} or fewer`,
    );
  });
});

describe("how often the docs say each is read", () => {
  const CONFIG: string = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../../../agents/OpenStackAgent/otel-collector-config.yaml",
    ),
    "utf8",
  );

  function collectionsPerHourOf(jobName: string): number {
    const job: string = CONFIG.substring(
      CONFIG.indexOf(`job_name: ${jobName}`),
    );
    const match: RegExpMatchArray | null = job.match(
      /scrape_interval: (\d+)s/,
    );
    expect(match).not.toBeNull();
    return 3600 / Number(match![1]);
  }

  test("what the agent's collector does is what the costs are worked out on", () => {
    expect(collectionsPerHourOf("oneuptime-openstack-libvirt")).toBe(
      OPENSTACK_LIBVIRT_COLLECTIONS_PER_HOUR,
    );
    expect(collectionsPerHourOf("oneuptime-openstack-ceilometer")).toBe(
      OPENSTACK_CEILOMETER_COLLECTIONS_PER_HOUR,
    );
    expect(OPENSTACK_LIBVIRT_COLLECTIONS_PER_HOUR).toBe(60);
    expect(OPENSTACK_CEILOMETER_COLLECTIONS_PER_HOUR).toBe(60);
  });
});

describe("what the docs say about Ceilometer's polling.yaml", () => {
  test.each([
    "`vcpus`",
    "`memory.resident`",
    "`disk.device.read.latency`",
    "`disk.device.write.latency`",
  ])("names %s, which the file it ships leaves out", (meter: string) => {
    expect(DOCS).toContain(meter);
  });

  test("says no released Ceilometer has CPU waiting yet", () => {
    expect(DOCS).toContain("No released Ceilometer does yet");
  });
});

describe("what the docs say about turning it on", () => {
  test("names both of the agent's settings", () => {
    expect(DOCS).toContain("`OPENSTACK_LIBVIRT_EXPORTER_TARGETS`");
    expect(DOCS).toContain("`OPENSTACK_CEILOMETER_EXPORTER_TARGETS`");
  });

  test("says nova has to come first, or system's host.id wins", () => {
    expect(DOCS).toContain("detectors: [nova, system, env]");
  });
});
