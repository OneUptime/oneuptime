import { describe, expect, test } from "@jest/globals";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import OpenStackProbeMetrics from "Common/Server/Utils/OpenStack/OpenStackProbeMetrics";
import {
  OpenStackResourceBufferEntry,
  bufferOpenStackSnapshotMetric,
  finishOpenStackBatch,
  isOpenStackSnapshotDatapoint,
} from "Common/Server/Utils/Telemetry/OpenStackSnapshotScan";
import {
  OpenStackMetricDefinition,
  getAllOpenStackMetrics,
  getOpenStackMetricByMetricName,
} from "Common/Types/Monitor/OpenStackMetricCatalog";
import { OpenStackCollectionReport } from "Common/Types/OpenStack/OpenStackProbeCollection";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import OpenStackCollector from "../../../Utils/OpenStack/OpenStackCollector";
import {
  OpenStackHttpRequest,
  OpenStackHttpResponse,
} from "../../../Utils/OpenStack/OpenStackHttp";
import {
  COLLECTED_AT_MS,
  CollectorHarness,
  ReportedDatapoint,
  collectionJob,
  createCollectorHarness,
  datapointsOf,
} from "./Helpers/CollectorHarness";
import {
  PrometheusSeries,
  RECORDED_REGION,
  RecordedCloud,
  RecordedScene,
  createRecordedCloud,
  jsonAnswer,
  loadCollectorExport,
  loadScene,
  recordedJson,
} from "./Helpers/RecordedCloud";

/*
 * The promise the probe makes: what it sends for a cloud is what the OpenStack agent
 * sends for it, so every page, monitor and alert template reads either one the same way
 * and a cloud can move between them without its pages noticing.
 *
 * Both halves come from the same real DevStack at the same moment
 * (Tests/Ops/openstack-e2e): what each API answered, which the probe reads, and what the
 * agent's pinned exporter answered. So what must match is not only names, kinds, units
 * and attribute keys. It is every series of every cloud part, with its label values and
 * its value, and then what the server's scan makes of both.
 *
 * Three differences are expected, and each is spelled out where it is compared:
 *
 *   - the series the agent leaves off by default (quotas, ports, subnet pools) the probe
 *     leaves off too, though these recordings' exporter had some on;
 *   - what only a native collector can add, marked in OpenStackMetricCatalog;
 *   - the receiver's own bookkeeping about a scrape, which has no meaning for a probe:
 *     scrape_series_added and scrape_samples_post_metric_relabeling.
 */

const SCENES: ReadonlyArray<{ release: string; scene: string }> = [
  { release: "hibiscus-ovn", scene: "healthy" },
  { release: "hibiscus-ovn", scene: "compute-disabled" },
  { release: "hibiscus-ovn", scene: "compute-down" },
  { release: "gazpacho-ovs", scene: "healthy" },
  { release: "gazpacho-ovs", scene: "compute-disabled" },
  { release: "gazpacho-ovn", scene: "healthy" },
  { release: "flamingo-ovn", scene: "healthy" },
  { release: "epoxy-ovn", scene: "healthy" },
];

const SCRAPE_LABELS: ReadonlyArray<string> = [
  "openstack.region.name",
  "openstack_service",
];

function isOnByDefault(metricName: string): boolean {
  return !getOpenStackMetricByMetricName(metricName)?.offByDefault;
}

// Labels only the probe sends on each series, as the catalogue marks them.
function probeOnlyLabelsOf(metricName: string): ReadonlyArray<string> {
  return getOpenStackMetricByMetricName(metricName)?.probeOnlyAttributes || [];
}

/*
 * What the agent's collector makes of one of the exporter's lines: an empty label is no
 * label, and every datapoint says its region and service.
 */
function exportedLabels(series: PrometheusSeries): Record<string, string> {
  const labels: Record<string, string> = {
    "openstack.region.name": RECORDED_REGION,
    openstack_service: series.service,
  };

  for (const key of Object.keys(series.labels)) {
    if (series.labels[key] !== "") {
      labels[key] = series.labels[key] as string;
    }
  }

  return labels;
}

function canonicalLabels(labels: Record<string, string>): string {
  return Object.keys(labels)
    .sort()
    .map((key: string): string => {
      return `${key}=${labels[key] as string}`;
    })
    .join(",");
}

interface ComparableSeries {
  key: string;
  value: number;
}

// A series as far as it can be compared: Cinder's uuid is the exporter's own random one.
function comparable(metric: string, labels: Record<string, string>): string {
  const kept: Record<string, string> = { ...labels };

  if (metric === "openstack_cinder_agent_state") {
    delete kept["uuid"];
  }

  for (const key of probeOnlyLabelsOf(metric)) {
    delete kept[key];
  }

  return `${metric}{${canonicalLabels(kept)}}`;
}

async function collect(scene: RecordedScene): Promise<{
  report: OpenStackCollectionReport;
  points: Array<ReportedDatapoint>;
  cloud: RecordedCloud;
}> {
  const cloud: RecordedCloud = createRecordedCloud(scene);
  const harness: CollectorHarness = createCollectorHarness({
    transport: cloud.transport,
  });

  const report: OpenStackCollectionReport = await OpenStackCollector.collect(
    collectionJob(),
    harness.dependencies,
  );

  return {
    report: report,
    points: datapointsOf(report.resourceMetrics),
    cloud: cloud,
  };
}

/*
 * What the ingest makes of a collection: each datapoint the scan reads, folded per
 * cloud, then the rows finished and joined. The same walk OtelMetricsIngestService
 * makes, on what the server's own route would hand it.
 */
function scanAsIngest(
  resourceMetrics: JSONArray,
): Map<string, OpenStackResourceBufferEntry> {
  const buffer: Map<string, OpenStackResourceBufferEntry> = new Map();

  for (const resource of resourceMetrics as Array<JSONObject>) {
    for (const scope of resource["scopeMetrics"] as Array<JSONObject>) {
      for (const metric of scope["metrics"] as Array<JSONObject>) {
        const metricName: string = metric["name"] as string;
        const body: JSONObject = metric["gauge"] as JSONObject;

        for (const datapoint of body["dataPoints"] as Array<JSONObject>) {
          if (isOpenStackSnapshotDatapoint({ metricName, datapoint })) {
            bufferOpenStackSnapshotMetric({ metricName, datapoint, buffer });
          }
        }
      }
    }
  }

  const rows: Map<string, OpenStackResourceBufferEntry> = new Map();

  for (const entry of finishOpenStackBatch(buffer.values())) {
    rows.set(`${entry.kind}/${entry.externalId}`, entry);
  }

  return rows;
}

// The exporter's series as the collector exports them, at the moment the probe read.
function exporterAsOtlp(scene: RecordedScene, timeUnixNano: string): JSONArray {
  const metrics: Map<string, Array<JSONObject>> = new Map();

  const add: (
    name: string,
    labels: Record<string, string>,
    value: number,
  ) => void = (
    name: string,
    labels: Record<string, string>,
    value: number,
  ): void => {
    const points: Array<JSONObject> = metrics.get(name) || [];

    points.push({
      attributes: Object.keys(labels)
        .sort()
        .map((key: string): JSONObject => {
          return { key: key, value: { stringValue: labels[key] as string } };
        }),
      timeUnixNano: timeUnixNano,
      asDouble: value,
    });

    metrics.set(name, points);
  };

  const services: Set<string> = new Set();

  for (const series of scene.exporter) {
    if (!isOnByDefault(series.name)) {
      continue;
    }

    services.add(series.service);
    add(series.name, exportedLabels(series), series.value);
  }

  for (const service of services) {
    add(
      "up",
      { "openstack.region.name": RECORDED_REGION, openstack_service: service },
      1,
    );
  }

  return [
    {
      resource: { attributes: [] },
      scopeMetrics: [
        {
          scope: { name: "exporter" },
          metrics: Array.from(metrics.entries()).map(
            ([name, points]: [string, Array<JSONObject>]): JSONObject => {
              return { name: name, gauge: { dataPoints: points } };
            },
          ),
        },
      ],
    },
  ];
}

// A row as far as the two can be asked to agree, without what only a probe knows.
function comparableRow(entry: OpenStackResourceBufferEntry): JSONObject {
  const facts: JSONObject = { ...entry.facts };

  for (const key of [
    "taskState",
    "faultMessage",
    "updatedAt",
    "scrapeFailed",
    "vouchedAt",
    // How long one collection took: its own reading on each path.
    "collectionSeconds",
  ]) {
    delete facts[key];
  }

  // Cinder's services have no id, so this is the uuid the exporter makes up each time.
  if (entry.facts["family"] === "volume") {
    delete facts["agentId"];
  }

  return {
    kind: entry.kind,
    externalId: entry.externalId,
    name: entry.name,
    regionName: entry.regionName,
    availabilityZone: entry.availabilityZone,
    hypervisorName: entry.hypervisorName,
    openStackProjectId: entry.openStackProjectId,
    status: entry.status,
    adminState: entry.adminState,
    disabledReason: entry.disabledReason,
    vcpuCapacity: entry.vcpuCapacity,
    vcpuAllocated: entry.vcpuAllocated,
    memoryCapacityBytes: entry.memoryCapacityBytes,
    memoryAllocatedBytes: entry.memoryAllocatedBytes,
    diskCapacityBytes: entry.diskCapacityBytes,
    diskAllocatedBytes: entry.diskAllocatedBytes,
    instanceCount: entry.instanceCount,
    facts: facts,
  };
}

describe.each(SCENES)(
  "the probe sends what the agent sends, on $release, $scene",
  (data: { release: string; scene: string }) => {
    const scene: RecordedScene = loadScene(data.release, data.scene);

    test("the collection itself worked", async () => {
      const { report } = await collect(scene);

      expect(report).toMatchObject({ status: "Succeeded" });
      expect(report.errorCode).toBeUndefined();
    });

    /*
     * A comparison of two empty lists passes. So this says there was something to compare:
     * a recording that was cut short, or a reader that found none of it, fails here.
     */
    test("there was a whole cloud to compare", async () => {
      const { points } = await collect(scene);

      expect(scene.exporter.length).toBeGreaterThan(100);
      expect(points.length).toBeGreaterThan(100);

      for (const up of [
        "openstack_identity_up",
        "openstack_nova_up",
        "openstack_placement_up",
        "openstack_neutron_up",
        "openstack_cinder_up",
        "openstack_glance_up",
      ]) {
        expect(
          scene.exporter.some((series: PrometheusSeries): boolean => {
            return series.name === up;
          }),
        ).toBe(true);
      }
    });

    test("every series the agent sends by default, the probe sends", async () => {
      const { points } = await collect(scene);
      const sent: Set<string> = new Set(
        points.map((point: ReportedDatapoint): string => {
          return point.metric;
        }),
      );

      const missing: Array<string> = Array.from(
        new Set(
          scene.exporter
            .filter((series: PrometheusSeries): boolean => {
              return isOnByDefault(series.name);
            })
            .map((series: PrometheusSeries): string => {
              return series.name;
            }),
        ),
      ).filter((name: string): boolean => {
        return !sent.has(name);
      });

      expect(missing).toEqual([]);
    });

    test("nothing the catalogue has not heard of", async () => {
      const { points } = await collect(scene);
      const unknown: Array<string> = Array.from(
        new Set(
          points.map((point: ReportedDatapoint): string => {
            return point.metric;
          }),
        ),
      ).filter((name: string): boolean => {
        return (
          !getOpenStackMetricByMetricName(name) &&
          name !== "scrape_duration_seconds"
        );
      });

      expect(unknown).toEqual([]);
    });

    test("every series is a gauge with the exporter's help text and no unit", async () => {
      const { points } = await collect(scene);

      for (const series of scene.exporter) {
        if (!isOnByDefault(series.name)) {
          continue;
        }

        const point: ReportedDatapoint | undefined = points.find(
          (candidate: ReportedDatapoint): boolean => {
            return candidate.metric === series.name;
          },
        );

        expect({
          name: series.name,
          kinds: point?.kinds,
          description: point?.description,
          unit: point?.unit,
        }).toEqual({
          name: series.name,
          kinds: [series.type],
          description: series.help,
          unit: undefined,
        });
      }
    });

    test("every series has the exporter's attribute keys, and what else is marked in the catalogue", async () => {
      const { points } = await collect(scene);

      const keySets: (
        keysOf: Array<{ metric: string; keys: Array<string> }>,
      ) => Map<string, Set<string>> = (
        keysOf: Array<{ metric: string; keys: Array<string> }>,
      ): Map<string, Set<string>> => {
        const sets: Map<string, Set<string>> = new Map();

        for (const entry of keysOf) {
          const kept: Array<string> = entry.keys
            .filter((key: string): boolean => {
              return !probeOnlyLabelsOf(entry.metric).includes(key);
            })
            .sort();

          const set: Set<string> = sets.get(entry.metric) || new Set();
          set.add(kept.join(","));
          sets.set(entry.metric, set);
        }

        return sets;
      };

      const fromProbe: Map<string, Set<string>> = keySets(
        points.map((point: ReportedDatapoint) => {
          return { metric: point.metric, keys: Object.keys(point.labels) };
        }),
      );

      const fromExporter: Map<string, Set<string>> = keySets(
        scene.exporter
          .filter((series: PrometheusSeries): boolean => {
            return isOnByDefault(series.name);
          })
          .map((series: PrometheusSeries) => {
            return {
              metric: series.name,
              keys: Object.keys(exportedLabels(series)),
            };
          }),
      );

      for (const [metric, sets] of fromExporter) {
        expect({
          metric,
          keys: Array.from(fromProbe.get(metric) || []).sort(),
        }).toEqual({
          metric,
          keys: Array.from(sets).sort(),
        });
      }
    });

    test("every series has the exporter's label values and its value", async () => {
      const { points } = await collect(scene);

      const fromProbe: Array<ComparableSeries> = points
        .filter((point: ReportedDatapoint): boolean => {
          return point.metric.startsWith("openstack_");
        })
        .map((point: ReportedDatapoint): ComparableSeries => {
          return {
            key: comparable(point.metric, point.labels),
            value: point.value,
          };
        })
        .sort((a: ComparableSeries, b: ComparableSeries): number => {
          return a.key < b.key ? -1 : 1;
        });

      const fromExporter: Array<ComparableSeries> = scene.exporter
        .filter((series: PrometheusSeries): boolean => {
          return isOnByDefault(series.name);
        })
        .map((series: PrometheusSeries): ComparableSeries => {
          return {
            key: comparable(series.name, exportedLabels(series)),
            value: series.value,
          };
        })
        .sort((a: ComparableSeries, b: ComparableSeries): number => {
          return a.key < b.key ? -1 : 1;
        });

      const inExporter: Map<string, number> = new Map(
        fromExporter.map((series: ComparableSeries): [string, number] => {
          return [series.key, series.value];
        }),
      );

      // What the exporter says, the probe says, to the digit.
      const differences: Array<JSONObject> = [];

      for (const series of fromExporter) {
        const sent: ComparableSeries | undefined = fromProbe.find(
          (candidate: ComparableSeries): boolean => {
            return candidate.key === series.key;
          },
        );

        if (!sent || sent.value !== series.value) {
          differences.push({
            series: series.key,
            exporter: series.value,
            probe: sent ? sent.value : "not sent",
          });
        }
      }

      expect(differences).toEqual([]);

      /*
       * What the probe says beyond that is a series this exporter's flags left out in
       * this recording, or one only a native collector has.
       */
      const beyond: Array<string> = Array.from(
        new Set(
          fromProbe
            .filter((series: ComparableSeries): boolean => {
              return !inExporter.has(series.key);
            })
            .map((series: ComparableSeries): string => {
              return series.key.substring(0, series.key.indexOf("{"));
            }),
        ),
      ).sort();

      for (const name of beyond) {
        const definition: OpenStackMetricDefinition | undefined =
          getOpenStackMetricByMetricName(name);

        expect({
          name,
          isExpected: definition?.onlyFromProbe === true,
        }).toEqual({
          name,
          isExpected: true,
        });
      }
    });

    test("the server's scan builds the same rows from either", async () => {
      const { report } = await collect(scene);

      const prepared: JSONArray = OpenStackProbeMetrics.prepare({
        resourceMetrics: report.resourceMetrics,
        cloudName: "devstack",
      }).resourceMetrics;

      const fromProbe: Map<string, OpenStackResourceBufferEntry> =
        scanAsIngest(prepared);
      const fromExporter: Map<string, OpenStackResourceBufferEntry> =
        scanAsIngest(exporterAsOtlp(scene, `${COLLECTED_AT_MS}000000`));

      expect(fromExporter.size).toBeGreaterThan(20);

      for (const [key, row] of fromExporter) {
        const probeRow: OpenStackResourceBufferEntry | undefined =
          fromProbe.get(key);

        expect({ key, row: probeRow ? comparableRow(probeRow) : null }).toEqual(
          {
            key,
            row: comparableRow(row),
          },
        );
      }

      // Rows only the probe has: the snapshots the exporter only counts, and backups.
      const onlyInProbe: Array<string> = Array.from(fromProbe.keys()).filter(
        (key: string): boolean => {
          return !fromExporter.has(key);
        },
      );

      for (const key of onlyInProbe) {
        expect(
          key.startsWith(`${OpenStackResourceKind.Snapshot}/`) ||
            key.startsWith(`${OpenStackResourceKind.Backup}/`),
        ).toBe(true);
      }
    });

    test("no secret, traceback or token goes anywhere near the report", async () => {
      const { report } = await collect(scene);
      const text: string = JSON.stringify(report);

      expect(text).not.toContain("n0t-in-any-report!");
      expect(text).not.toContain("a-token-from-the-recording");
      expect(text).not.toContain("Traceback");
    });
  },
);

/*
 * What only a native client can read is worth nothing unless it reaches the rows the pages
 * read, so this follows it there, from the real answers of a real cloud.
 */
describe("what only a probe adds, in the rows it fills", () => {
  const SCENE: RecordedScene = loadScene("hibiscus-ovn", "healthy");

  async function rowsFrom(
    answer?: (
      request: OpenStackHttpRequest,
    ) => OpenStackHttpResponse | undefined,
  ): Promise<Map<string, OpenStackResourceBufferEntry>> {
    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob(),
      createCollectorHarness({
        transport: createRecordedCloud(SCENE, { answer: answer }).transport,
      }).dependencies,
    );

    return scanAsIngest(
      OpenStackProbeMetrics.prepare({
        resourceMetrics: report.resourceMetrics,
        cloudName: "devstack",
      }).resourceMetrics,
    );
  }

  function rowsOf(
    rows: Map<string, OpenStackResourceBufferEntry>,
    kind: OpenStackResourceKind,
  ): Array<OpenStackResourceBufferEntry> {
    return Array.from(rows.values()).filter(
      (row: OpenStackResourceBufferEntry): boolean => {
        return row.kind === kind;
      },
    );
  }

  test("each instance has when it last changed, and a failed one what went wrong", async () => {
    const servers: Array<JSONObject> = recordedJson(SCENE, "nova-servers")?.[
      "servers"
    ] as Array<JSONObject>;

    const instances: Array<OpenStackResourceBufferEntry> = rowsOf(
      await rowsFrom(),
      OpenStackResourceKind.Instance,
    );

    expect(instances).toHaveLength(servers.length);

    for (const server of servers) {
      const row: OpenStackResourceBufferEntry | undefined = instances.find(
        (instance: OpenStackResourceBufferEntry): boolean => {
          return instance.externalId === server["id"];
        },
      );

      expect(row?.facts["updatedAt"]).toBe(server["updated"]);
      // Nova's message, as far as a label's value is one: without its trailing space.
      expect(row?.facts["faultMessage"] ?? null).toBe(
        (
          (server["fault"] as JSONObject | undefined)?.["message"] as
            | string
            | undefined
        )?.trim() ?? null,
      );
      expect(row?.facts["taskState"] ?? null).toBe(
        server["OS-EXT-STS:task_state"] ?? null,
      );
    }

    // Not one of them passes for metadata an operator chose to see.
    for (const row of instances) {
      expect(Object.keys((row.facts["labels"] as JSONObject) || {})).toEqual(
        [],
      );
    }
  });

  test("each snapshot is a row of its own, which the exporter only counts", async () => {
    const snapshots: Array<JSONObject> = recordedJson(
      SCENE,
      "cinder-snapshots",
    )?.["snapshots"] as Array<JSONObject>;

    expect(snapshots.length).toBeGreaterThan(0);

    const rows: Array<OpenStackResourceBufferEntry> = rowsOf(
      await rowsFrom(),
      OpenStackResourceKind.Snapshot,
    );

    expect(rows).toHaveLength(snapshots.length);

    const snapshot: JSONObject = snapshots[0] as JSONObject;

    expect(rows[0]).toMatchObject({
      externalId: snapshot["id"],
      name: snapshot["name"],
      status: snapshot["status"],
      diskCapacityBytes: (snapshot["size"] as number) * 1024 * 1024 * 1024,
    });
    expect(rows[0]?.facts["volumeId"]).toBe(snapshot["volume_id"]);
    expect(rows[0]?.facts["updatedAt"]).toBe(snapshot["updated_at"]);
  });

  test("each backup too, so one that keeps failing can be seen", async () => {
    const rows: Array<OpenStackResourceBufferEntry> = rowsOf(
      await rowsFrom((request: OpenStackHttpRequest) => {
        return new globalThis.URL(request.url).pathname ===
          "/volume/v3/backups/detail"
          ? jsonAnswer(200, {
              backups: [
                {
                  id: "backup-1",
                  name: "nightly",
                  status: "error",
                  size: 5,
                  volume_id: "volume-1",
                  availability_zone: "nova",
                  is_incremental: true,
                  updated_at: "2026-11-04T02:00:00.000000",
                  "os-backup-project-attr:project_id": "project-1",
                },
              ],
              backups_links: [],
            })
          : undefined;
      }),
      OpenStackResourceKind.Backup,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      externalId: "backup-1",
      name: "nightly",
      status: "error",
      availabilityZone: "nova",
      openStackProjectId: "project-1",
      diskCapacityBytes: 5 * 1024 * 1024 * 1024,
    });
    expect(rows[0]?.facts).toMatchObject({
      volumeId: "volume-1",
      isIncremental: true,
      updatedAt: "2026-11-04T02:00:00.000000",
    });
  });
});

/*
 * What the exporter's text says is not what reaches OneUptime: the collector turns it
 * into OTLP first. This recording of what it exported is what proves the shape above.
 */
describe("what the agent's collector really exported", () => {
  const metrics: Array<JSONObject> = (
    loadCollectorExport("hibiscus-ovn")["resourceMetrics"] as Array<JSONObject>
  ).flatMap((resource: JSONObject): Array<JSONObject> => {
    return (resource["scopeMetrics"] as Array<JSONObject>).flatMap(
      (scope: JSONObject): Array<JSONObject> => {
        return scope["metrics"] as Array<JSONObject>;
      },
    );
  });

  const named: (name: string) => JSONObject = (name: string): JSONObject => {
    const found: JSONObject | undefined = metrics.find(
      (metric: JSONObject): boolean => {
        return metric["name"] === name;
      },
    );

    if (!found) {
      throw new Error(`The recording has no ${name}.`);
    }

    return found;
  };

  test("an empty label is no label there, so it is none here", async () => {
    const { points } = await collect(loadScene("hibiscus-ovn", "healthy"));

    const failed: ReportedDatapoint = points.find(
      (point: ReportedDatapoint): boolean => {
        return (
          point.metric === "openstack_nova_server_status" &&
          point.labels["name"] === "ou-failed"
        );
      },
    )!;

    const recorded: JSONObject = (
      (named("openstack_nova_server_status")["gauge"] as JSONObject)[
        "dataPoints"
      ] as Array<JSONObject>
    ).find((point: JSONObject): boolean => {
      return (point["attributes"] as Array<JSONObject>).some(
        (attribute: JSONObject): boolean => {
          return (
            (attribute["value"] as JSONObject)["stringValue"] === "ou-failed"
          );
        },
      );
    })!;

    const keys: Array<string> = (
      recorded["attributes"] as Array<JSONObject>
    ).map((attribute: JSONObject): string => {
      return attribute["key"] as string;
    });

    expect(keys).not.toContain("hypervisor_hostname");
    expect(Object.keys(failed.labels)).not.toContain("hypervisor_hostname");
    expect(
      Object.keys(failed.labels)
        .filter((key: string): boolean => {
          return !probeOnlyLabelsOf("openstack_nova_server_status").includes(
            key,
          );
        })
        .sort(),
    ).toEqual([...keys].sort());
  });

  test("attributes are in the same order, sorted, with region and service among them", async () => {
    const { report } = await collect(loadScene("hibiscus-ovn", "healthy"));

    const walk: JSONObject = (report.resourceMetrics as Array<JSONObject>).find(
      (resource: JSONObject): boolean => {
        return JSON.stringify(resource).includes("openstack_nova_agent_state");
      },
    )!;

    const metric: JSONObject = (
      (walk["scopeMetrics"] as Array<JSONObject>)[0]![
        "metrics"
      ] as Array<JSONObject>
    ).find((candidate: JSONObject): boolean => {
      return candidate["name"] === "openstack_nova_agent_state";
    })!;

    const keysOf: (point: JSONObject) => Array<string> = (
      point: JSONObject,
    ): Array<string> => {
      return (point["attributes"] as Array<JSONObject>).map(
        (attribute: JSONObject): string => {
          return attribute["key"] as string;
        },
      );
    };

    expect(
      keysOf(
        (
          (metric["gauge"] as JSONObject)["dataPoints"] as Array<JSONObject>
        )[0]!,
      ),
    ).toEqual(
      keysOf(
        (
          (named("openstack_nova_agent_state")["gauge"] as JSONObject)[
            "dataPoints"
          ] as Array<JSONObject>
        )[0]!,
      ),
    );
  });

  test("a metric has the shape the collector gives it", async () => {
    const { report } = await collect(loadScene("hibiscus-ovn", "healthy"));

    const metric: JSONObject = (report.resourceMetrics as Array<JSONObject>)
      .flatMap((resource: JSONObject): Array<JSONObject> => {
        return (resource["scopeMetrics"] as Array<JSONObject>)[0]![
          "metrics"
        ] as Array<JSONObject>;
      })
      .find((candidate: JSONObject): boolean => {
        return candidate["name"] === "openstack_nova_up";
      })!;

    const recorded: JSONObject = named("openstack_nova_up");

    expect(Object.keys(metric).sort()).toEqual(Object.keys(recorded).sort());
    expect(metric["description"]).toBe(recorded["description"]);
    expect(metric["metadata"]).toEqual(recorded["metadata"]);
  });

  test("the receiver's own series read as the catalogue and templates expect", async () => {
    const { points } = await collect(loadScene("hibiscus-ovn", "healthy"));

    for (const name of [
      "up",
      "scrape_samples_scraped",
      "scrape_duration_seconds",
    ]) {
      const recorded: JSONObject = named(name);
      const point: ReportedDatapoint = points.find(
        (candidate: ReportedDatapoint): boolean => {
          return candidate.metric === name;
        },
      )!;

      expect({
        name,
        description: point.description,
        unit: point.unit,
      }).toEqual({
        name,
        description: recorded["description"],
        unit: recorded["unit"],
      });

      expect(Object.keys(point.labels).sort()).toEqual([...SCRAPE_LABELS]);
    }
  });
});

describe("the catalogue says who collects what", () => {
  test("what only the probe sends is marked, and the rest is the exporter's", () => {
    const onlyFromProbe: Array<string> = getAllOpenStackMetrics()
      .filter((metric: OpenStackMetricDefinition): boolean => {
        return metric.onlyFromProbe === true;
      })
      .map((metric: OpenStackMetricDefinition): string => {
        return metric.metricName;
      })
      .sort();

    expect(onlyFromProbe).toEqual([
      "openstack_cinder_backup_gb",
      "openstack_cinder_snapshot_gb",
    ]);
  });
});
