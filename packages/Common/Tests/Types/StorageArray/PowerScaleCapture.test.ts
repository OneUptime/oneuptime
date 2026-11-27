import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  POWERSCALE_CAPTURE_TIME_MS,
  POWERSCALE_CLUSTER_NAME,
  POWERSCALE_SERIES,
  PowerScaleCapturedPoint,
  getPowerScaleCapturedPoints,
} from "../../Helpers/StorageArray/PowerScale/PowerScaleCapture";
import DellPowerScalePlatform from "../../../Types/StorageArray/Platforms/Dell/PowerScale/PowerScalePlatform";
import {
  StorageArrayAlertTemplateSpec,
  StorageArrayMetricDefinition,
} from "../../../Types/StorageArray/StorageArrayPlatform";

/*
 * THE RECORDED CAPTURE IS WHAT THE AGENT SENDS FOR THE RECORDED WALKS
 * (#11003).
 *
 * PowerScaleCapture.json was recorded by running the agent's own collector
 * config, on the collector it pins, over snmpsim replaying the walks in
 * Examples/snmp-simulator/data/powerscale-node-<n>
 * (Examples/snmp-simulator/powerscale/record-capture.sh). This holds the
 * three together: every series the capture carries is one POWERSCALE_SERIES
 * documents, label by label; every figure the collector reworked (bits to
 * bytes, per mil to percent, a string reading to a number, a quota's usage
 * against its limit) is the walk's figure reworked; and every metric the
 * catalog charts and every template watches is in it.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");
const WALKS: string = path.join(
  REPOSITORY_ROOT,
  "Examples/snmp-simulator/data",
);

// A node's walk: OID -> value, as snmpsim serves it.
function readWalk(lnn: number): Map<string, string> {
  const walk: Map<string, string> = new Map();
  const text: string = fs.readFileSync(
    path.join(WALKS, `powerscale-node-${lnn}`, "public.snmprec"),
    "utf8",
  );
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const [oid, , ...value] = line.split("|");
    walk.set(oid!, value.join("|"));
  }
  return walk;
}

const POINTS: Array<PowerScaleCapturedPoint> = getPowerScaleCapturedPoints();

function pointsOf(metricName: string): Array<PowerScaleCapturedPoint> {
  return POINTS.filter((point: PowerScaleCapturedPoint) => {
    return point.metricName === metricName;
  });
}

function onePoint(
  metricName: string,
  labels: Record<string, string> = {},
): PowerScaleCapturedPoint {
  const matching: Array<PowerScaleCapturedPoint> = pointsOf(metricName).filter(
    (point: PowerScaleCapturedPoint) => {
      return Object.entries(labels).every(([key, value]: [string, string]) => {
        return point.labels[key] === value;
      });
    },
  );
  expect({ metricName, labels, found: matching.length }).toEqual({
    metricName,
    labels,
    found: 1,
  });
  return matching[0]!;
}

const ISILON: string = "1.3.6.1.4.1.12124";

describe("the capture", () => {
  test("is one round of polls of the cluster, its quotas and the three nodes that answer", () => {
    expect(POINTS.length).toBeGreaterThan(300);
    const nodes: Set<string> = new Set(
      POINTS.map((point: PowerScaleCapturedPoint) => {
        return point.labels["node"] || "";
      }).filter(Boolean),
    );
    expect([...nodes].sort()).toEqual(["ps-prod-1", "ps-prod-2", "ps-prod-4"]);
    for (const point of POINTS) {
      expect(point.datapoint["timeUnixNano"]).toBe(
        `${POWERSCALE_CAPTURE_TIME_MS}000000`,
      );
    }
  });

  test("names only the array, its platform and the agent's version on every resource", () => {
    for (const point of POINTS) {
      expect(point.resourceAttributes).toEqual({
        "storage.array.name": POWERSCALE_CLUSTER_NAME,
        "storage.system": "dell.powerscale",
        "oneuptime.agent.version": "0.165.0",
      });
    }
  });

  test("carries every series POWERSCALE_SERIES documents, and no other", () => {
    const sent: Set<string> = new Set(
      POINTS.map((point: PowerScaleCapturedPoint) => {
        return point.metricName;
      }),
    );
    expect([...sent].sort()).toEqual(Object.keys(POWERSCALE_SERIES).sort());
  });

  test.each(Object.keys(POWERSCALE_SERIES))(
    "%s carries exactly the labels documented, with values from their lists",
    (metricName: string) => {
      const documented: Record<string, Array<string> | null> =
        POWERSCALE_SERIES[metricName]!;
      const seen: Set<string> = new Set();
      for (const point of pointsOf(metricName)) {
        for (const [key, value] of Object.entries(point.labels)) {
          seen.add(key);
          expect({ metricName, key, documented: key in documented }).toEqual({
            metricName,
            key,
            documented: true,
          });
          const allowed: Array<string> | null | undefined = documented[key];
          if (allowed) {
            expect({
              metricName,
              key,
              value,
              allowed: allowed.includes(value),
            }).toEqual({ metricName, key, value, allowed: true });
          }
        }
      }
      expect([...seen].sort()).toEqual(Object.keys(documented).sort());
    },
  );

  test("every value is a finite number", () => {
    for (const point of POINTS) {
      expect({
        metric: point.metricName,
        finite: Number.isFinite(point.value),
      }).toEqual({ metric: point.metricName, finite: true });
    }
  });
});

describe("what the collector reworked, from the walks", () => {
  const node1: Map<string, string> = readWalk(1);
  const node2: Map<string, string> = readWalk(2);

  test("the cluster's identity and health are the walk's", () => {
    const health: PowerScaleCapturedPoint = onePoint(
      "powerscale_cluster_health",
    );
    expect(health.value).toBe(Number(node1.get(`${ISILON}.1.1.2.0`)));
    expect(health.labels).toMatchObject({
      cluster: node1.get(`${ISILON}.1.1.1.0`),
      cluster_guid: node1.get(`${ISILON}.1.1.3.0`),
      configured_nodes: node1.get(`${ISILON}.1.1.5.0`),
      online_nodes: node1.get(`${ISILON}.1.1.6.0`),
      offline_nodes: node1.get(`${ISILON}.1.1.7.0`),
      system_description: node1.get("1.3.6.1.2.1.1.1.0"),
      scrape_endpoint: "cluster",
    });
  });

  test("how full the cluster is: what is no longer available, of the total", () => {
    const total: number = Number(node1.get(`${ISILON}.1.3.1.0`));
    const available: number = Number(node1.get(`${ISILON}.1.3.3.0`));
    expect(onePoint("powerscale_ifs_total_bytes").value).toBe(total);
    expect(onePoint("powerscale_ifs_available_bytes").value).toBe(available);
    expect(onePoint("powerscale_ifs_used_percent").value).toBeCloseTo(
      ((total - available) / total) * 100,
      9,
    );
    expect(onePoint("powerscale_ifs_used_percent").unit).toBe("%");
  });

  test("how many nodes are offline, from the cluster's list of them", () => {
    expect(onePoint("powerscale_cluster_offline_nodes").value).toBe(1);
    expect(onePoint("powerscale_cluster_nodes").value).toBe(4);
  });

  test("throughput OneFS reports in bits per second is sent in bytes", () => {
    expect(onePoint("powerscale_cluster_ifs_read_bytes_per_second").value).toBe(
      Number(node1.get(`${ISILON}.1.2.1.4.0`)) / 8,
    );
    expect(
      onePoint("powerscale_cluster_ifs_write_bytes_per_second").value,
    ).toBe(Number(node1.get(`${ISILON}.1.2.1.2.0`)) / 8);
    expect(
      onePoint("powerscale_node_ifs_read_bytes_per_second", {
        node: "ps-prod-2",
      }).value,
    ).toBe(Number(node2.get(`${ISILON}.2.2.1.4.0`)) / 8);
    // A protocol's, indexed by its name.
    expect(
      onePoint("powerscale_protocol_out_bytes_per_second", {
        node: "ps-prod-2",
        protocol: "nfs3",
      }).value,
    ).toBe(Number(node2.get(`${ISILON}.2.2.10.1.13.110.102.115.51`)) / 8);
  });

  test("CPU OneFS reports idle per mil is sent busy, in percent", () => {
    expect(onePoint("powerscale_cluster_cpu_busy_percent").value).toBeCloseTo(
      100 - Number(node1.get(`${ISILON}.1.2.3.5.0`)) / 10,
      9,
    );
    expect(
      onePoint("powerscale_node_cpu_busy_percent", { node: "ps-prod-2" }).value,
    ).toBeCloseTo(100 - Number(node2.get(`${ISILON}.2.2.3.5.0`)) / 10, 9);
  });

  test("a protocol's latency and operations are the walk's, per node", () => {
    expect(
      onePoint("powerscale_protocol_latency_microseconds", {
        node: "ps-prod-2",
        protocol: "smb2",
      }).value,
    ).toBe(Number(node2.get(`${ISILON}.2.2.10.1.16.115.109.98.50`)));
    expect(
      onePoint("powerscale_protocol_operations_per_second", {
        node: "ps-prod-2",
        protocol: "smb2",
      }).value,
    ).toBe(Number(node2.get(`${ISILON}.2.2.10.1.3.115.109.98.50`)));
  });

  test("a sensor's string reading becomes its value; one that reads N/A is dropped", () => {
    expect(
      onePoint("powerscale_temperature_celsius", {
        node: "ps-prod-1",
        sensor: "TEMP_CPU1",
      }).value,
    ).toBe(Number(node1.get(`${ISILON}.2.54.1.4.2`)));
    expect(node1.get(`${ISILON}.2.54.1.4.5`)).toBe("N/A");
    expect(
      pointsOf("powerscale_temperature_celsius").some(
        (point: PowerScaleCapturedPoint) => {
          return point.labels["sensor"] === "TEMP_PS2";
        },
      ),
    ).toBe(false);
    expect(
      onePoint("powerscale_power_sensor_reading", {
        node: "ps-prod-1",
        power_sensor: "PS1_VIN",
      }).value,
    ).toBe(230);
  });

  test("a drive's status rides on its size series; the loopback port is dropped", () => {
    const drive: PowerScaleCapturedPoint = onePoint(
      "powerscale_drive_size_bytes",
      { node: "ps-prod-2", bay: "3" },
    );
    expect(drive.labels).toMatchObject({
      status: node2.get(`${ISILON}.2.52.1.5.3`),
      drive: "ps-prod-2 bay 3",
    });
    expect(drive.labels["status"]).toBe("SMARTFAIL");
    expect(
      pointsOf("powerscale_interface_status").some(
        (point: PowerScaleCapturedPoint) => {
          return point.labels["interface"] === "lo0";
        },
      ),
    ).toBe(false);
  });

  test("a quota's share of its limit: of the hard one, else the soft one, else none", () => {
    const shares: Record<string, [number, string]> = {};
    for (const point of pointsOf("powerscale_quota_used_percent")) {
      shares[point.labels["quota"]!] = [
        Math.round(point.value * 100) / 100,
        point.labels["limit"]!,
      ];
    }
    expect(shares).toEqual({
      "/ifs/data/home": [96, "hard"],
      "/ifs/data/home (default user)": [0, "hard"],
      "/ifs/data/home (user 2001)": [99.6, "hard"],
      "/ifs/data/pacs": [1.75, "soft"],
      "/ifs/data/projects": [42, "hard"],
      "/ifs/data/projects (group 3000)": [5, "hard"],
    });
    // The accounting-only quota is counted, and has no share.
    expect(pointsOf("powerscale_quota_usage_bytes")).toHaveLength(7);
  });
});

describe("what the platform reads is what the capture carries", () => {
  test.each(
    DellPowerScalePlatform.metrics.map(
      (
        metric: StorageArrayMetricDefinition,
      ): [string, StorageArrayMetricDefinition] => {
        return [metric.id, metric];
      },
    ),
  )(
    "%s: its series are sent, with every label it pins",
    (_id: string, metric: StorageArrayMetricDefinition) => {
      const points: Array<PowerScaleCapturedPoint> = pointsOf(
        metric.metricName,
      ).filter((point: PowerScaleCapturedPoint) => {
        return Object.entries(metric.attributes || {}).every(
          ([key, value]: [string, string]) => {
            return point.labels[key] === value;
          },
        );
      });
      expect(points.length).toBeGreaterThan(0);
      if (metric.objectLabel) {
        for (const point of points) {
          expect(point.labels[metric.objectLabel]).toBeDefined();
        }
      }
    },
  );

  test.each(
    DellPowerScalePlatform.alertTemplates.map(
      (
        template: StorageArrayAlertTemplateSpec,
      ): [string, StorageArrayAlertTemplateSpec] => {
        return [template.id, template];
      },
    ),
  )(
    "%s watches a series the agent sends, grouped by a label it carries",
    (_id: string, template: StorageArrayAlertTemplateSpec) => {
      const points: Array<PowerScaleCapturedPoint> = pointsOf(
        template.metricName,
      );
      expect(points.length).toBeGreaterThan(0);
      if (template.groupByAttributeKey) {
        for (const point of points) {
          expect(point.labels[template.groupByAttributeKey]).toBeDefined();
        }
      }
      for (const key of Object.keys(template.attributes || {})) {
        expect(Object.keys(POWERSCALE_SERIES[template.metricName]!)).toContain(
          key,
        );
      }
    },
  );

  test("the heartbeat is a series every cluster poll sends", () => {
    expect(pointsOf(DellPowerScalePlatform.heartbeat.metricName)).toHaveLength(
      1,
    );
  });

  test("the cards that split their charts by a label split them by one the series carry", () => {
    for (const section of DellPowerScalePlatform.insightsSections) {
      if (!section.groupByLabel) {
        continue;
      }
      for (const id of section.metricIds) {
        const metric: StorageArrayMetricDefinition | undefined =
          DellPowerScalePlatform.metrics.find(
            (candidate: StorageArrayMetricDefinition) => {
              return candidate.id === id;
            },
          );
        expect(metric).toBeDefined();
        for (const point of pointsOf(metric!.metricName)) {
          expect(point.labels[section.groupByLabel]).toBeDefined();
        }
      }
    }
  });
});
