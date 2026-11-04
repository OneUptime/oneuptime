import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import {
  OPENSTACK_INSTANCE_METRICS_AUTOMATIC_LIMIT,
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
      "Ceilometer's exporter, read every 2 minutes and polled every 5",
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

describe("what the docs say about turning it on", () => {
  test("names both of the agent's settings", () => {
    expect(DOCS).toContain("`OPENSTACK_LIBVIRT_EXPORTER_TARGETS`");
    expect(DOCS).toContain("`OPENSTACK_CEILOMETER_EXPORTER_TARGETS`");
  });

  test("says nova has to come first, or system's host.id wins", () => {
    expect(DOCS).toContain("detectors: [nova, system, env]");
  });
});
