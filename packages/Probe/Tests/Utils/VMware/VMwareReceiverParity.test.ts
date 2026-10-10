import { describe, expect, test } from "@jest/globals";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import VMwareProbeMetrics from "Common/Server/Utils/VMware/VMwareProbeMetrics";
import {
  VMWARE_SNAPSHOT_METRIC_NAMES,
  VMwareResourceBufferEntry,
  VMwareVCenterSnapshotBufferEntry,
  VMwareVCenterSnapshotExtras,
  bufferVMwareSnapshotMetric,
  computeVMwareIsPoweredOn,
  deriveVMwareVCenterSnapshotExtras,
  toVMwareResourceAttributeMap,
} from "Common/Server/Utils/Telemetry/VMwareSnapshotScan";
import VMwareInventoryCollector from "../../../Utils/VMware/VMwareInventoryCollector";
import {
  VMwareDatacenter,
  VMwareInventorySnapshot,
} from "../../../Utils/VMware/VMwareInventory";
import VMwareOtlpBuilder, {
  VMwareOtlpBuildResult,
} from "../../../Utils/VMware/VMwareOtlpBuilder";
import VSphereSoapClient, {
  PerfEntityMetric,
  PerfSeries,
} from "../../../Utils/VMware/VSphereSoapClient";
import {
  ReplayTransport,
  createReplayTransport,
  loadExchanges,
  loadJsonFixture,
} from "./Helpers/ReplayTransport";

/*
 * The promise the probe makes: what it sends for a vCenter is what the
 * VMware agent's own collector sends for it, so every page, chart, alert
 * template and the AI read either one the same way.
 *
 * Both fixtures were taken from the same simulated vCenter (and ESXi host):
 * the probe's own recorded collection, and the first export of the agent's
 * collector (otel/opentelemetry-collector-contrib 0.161.0, vcenter receiver)
 * for it. The simulator's metric values are random, so what must match is
 * everything else - which resources, which metrics on each, and every
 * metric's kind, unit, description, value type, temporality and datapoint
 * attributes - and then what the server's ingest makes of both.
 *
 * Two differences are expected:
 *
 *   - on vCenter, the agent's collector leaves out a VM that sits in a vApp
 *     when its finder cannot place the vApp (the simulator's are not found,
 *     and the receiver records a partial error instead), while the probe
 *     reports those VMs under the vApp, with the attributes the receiver
 *     itself uses for them (vcenter.virtual_app.*);
 *   - the simulator sends a performance sample of 0 as no value at all (Go's
 *     XML encoder drops a zero in a list) and its canned samples pass through
 *     zeros as time goes on, so a series one recording caught as 0 the other
 *     may have caught as a number. Such a series has no datapoint in one
 *     export and one in the other - on either side, whatever the collector.
 *     So performance metrics are compared both ways: nothing the probe sends
 *     is foreign to the agent's export, and everything the agent's export
 *     has the probe sends too once every series it asked for has a sample.
 *     Every other metric must match exactly.
 */

// Added downstream - by the agent's resource processor, or by the server.
const NOT_IDENTITY: ReadonlySet<string> = new Set([
  "vmware.vcenter.name",
  "oneuptime.agent.version",
]);

const COLLECTED_AT: Date = new Date("2026-10-10T12:00:00.000Z");

interface MetricShape {
  kind: "sum" | "gauge";
  unit: string;
  description: string;
  valueKinds: Array<string>;
  aggregationTemporality: number | null;
  attributeSets: Array<string>;
}

function attributeValueOf(value: JSONObject): string {
  return JSON.stringify(value);
}

function identityOf(resource: JSONObject): string {
  const attributes: JSONArray = ((resource["resource"] as JSONObject)[
    "attributes"
  ] || []) as JSONArray;

  return (attributes as Array<JSONObject>)
    .filter((attribute: JSONObject) => {
      return !NOT_IDENTITY.has(attribute["key"] as string);
    })
    .map((attribute: JSONObject) => {
      return `${attribute["key"] as string}=${
        (attribute["value"] as JSONObject)["stringValue"] as string
      }`;
    })
    .join(" | ");
}

function shapesOf(resource: JSONObject): Map<string, MetricShape> {
  const shapes: Map<string, MetricShape> = new Map();

  for (const scope of resource["scopeMetrics"] as Array<JSONObject>) {
    for (const metric of scope["metrics"] as Array<JSONObject>) {
      const kind: "sum" | "gauge" = metric["sum"] ? "sum" : "gauge";
      const body: JSONObject = metric[kind] as JSONObject;
      const dataPoints: Array<JSONObject> = body[
        "dataPoints"
      ] as Array<JSONObject>;

      const valueKinds: Set<string> = new Set();
      const attributeSets: Set<string> = new Set();

      for (const dataPoint of dataPoints) {
        valueKinds.add(dataPoint["asInt"] !== undefined ? "asInt" : "asDouble");
        attributeSets.add(
          ((dataPoint["attributes"] || []) as Array<JSONObject>)
            .map((attribute: JSONObject) => {
              return `${attribute["key"] as string}=${attributeValueOf(
                attribute["value"] as JSONObject,
              )}`;
            })
            .join(","),
        );
      }

      shapes.set(metric["name"] as string, {
        kind: kind,
        unit: metric["unit"] as string,
        description: metric["description"] as string,
        valueKinds: Array.from(valueKinds).sort(),
        aggregationTemporality:
          (body["aggregationTemporality"] as number | undefined) ?? null,
        attributeSets: Array.from(attributeSets).sort(),
      });
    }
  }

  return shapes;
}

function byIdentity(resourceMetrics: JSONArray): Map<string, JSONObject> {
  const map: Map<string, JSONObject> = new Map();

  for (const resource of resourceMetrics as Array<JSONObject>) {
    const identity: string = identityOf(resource);
    // Every vSphere object is exactly one resource.
    expect(map.has(identity)).toBe(false);
    map.set(identity, resource);
  }

  return map;
}

interface ProbeCollection {
  snapshot: VMwareInventorySnapshot;
  result: VMwareOtlpBuildResult;
}

async function probeCollection(fixture: string): Promise<ProbeCollection> {
  const replay: ReplayTransport = createReplayTransport(loadExchanges(fixture));
  const client: VSphereSoapClient = new VSphereSoapClient({
    transport: replay.transport,
    userAgent: "test",
  });

  await client.negotiateVersion();
  await client.retrieveServiceContent();
  await client.login("oneuptime", "secret");

  const snapshot: VMwareInventorySnapshot = await new VMwareInventoryCollector(
    client,
    {
      collectVsan: true,
      now: (): Date => {
        return COLLECTED_AT;
      },
    },
  ).collect();

  return {
    snapshot: snapshot,
    result: VMwareOtlpBuilder.build(snapshot, "test"),
  };
}

// The same collection, had every performance series vSphere answered carried a sample.
function withEverySeriesSampled(
  snapshot: VMwareInventorySnapshot,
): VMwareInventorySnapshot {
  const sampled: (
    perf: Map<string, PerfEntityMetric>,
  ) => Map<string, PerfEntityMetric> = (
    perf: Map<string, PerfEntityMetric>,
  ): Map<string, PerfEntityMetric> => {
    const copy: Map<string, PerfEntityMetric> = new Map();

    for (const [key, metric] of perf) {
      copy.set(key, {
        ...metric,
        series: metric.series.map((series: PerfSeries): PerfSeries => {
          if (series.values.length > 0) {
            return series;
          }

          return {
            ...series,
            values: metric.sampleInfo.map((): number => {
              return 0;
            }),
          };
        }),
      });
    }

    return copy;
  };

  return {
    ...snapshot,
    datacenters: snapshot.datacenters.map(
      (datacenter: VMwareDatacenter): VMwareDatacenter => {
        return {
          ...datacenter,
          hostPerf: sampled(datacenter.hostPerf),
          vmPerf: sampled(datacenter.vmPerf),
        };
      },
    ),
  };
}

function isSubsetOf(items: Array<string>, of: Array<string>): boolean {
  return items.every((item: string) => {
    return of.includes(item);
  });
}

function agentCollection(fixture: string): JSONArray {
  return loadJsonFixture<JSONObject>(fixture)["resourceMetrics"] as JSONArray;
}

interface ScannedInventory {
  resources: Map<string, string>;
  extras: VMwareVCenterSnapshotExtras;
}

/*
 * What the ingest makes of a collection (OtelMetricsIngestService's VMware
 * snapshot pass): each datapoint the snapshot reads, folded per resource,
 * then the inventory rows and the vCenter's counts derived from the fold.
 */
function scanAsIngest(resourceMetrics: JSONArray): ScannedInventory {
  const resourceBuffer: Map<
    string,
    Map<string, VMwareResourceBufferEntry>
  > = new Map();
  const vcenterBuffer: Map<string, VMwareVCenterSnapshotBufferEntry> =
    new Map();

  for (const resource of resourceMetrics as Array<JSONObject>) {
    const attributes: Record<string, unknown> = toVMwareResourceAttributeMap(
      (resource["resource"] as JSONObject)["attributes"] as JSONArray,
    );

    for (const scope of resource["scopeMetrics"] as Array<JSONObject>) {
      for (const metric of scope["metrics"] as Array<JSONObject>) {
        const metricName: string = metric["name"] as string;

        if (!VMWARE_SNAPSHOT_METRIC_NAMES.has(metricName)) {
          continue;
        }

        const body: JSONObject = (metric["sum"] ||
          metric["gauge"]) as JSONObject;

        for (const datapoint of body["dataPoints"] as Array<JSONObject>) {
          bufferVMwareSnapshotMetric({
            vcenterIdStr: "vcenter",
            metricName: metricName,
            resourceAttributes: attributes,
            datapoint: datapoint,
            resourceBuffer: resourceBuffer,
            vcenterBuffer: vcenterBuffer,
          });
        }
      }
    }
  }

  const entries: Array<VMwareResourceBufferEntry> = Array.from(
    resourceBuffer.get("vcenter")?.values() || [],
  );

  const resources: Map<string, string> = new Map();

  for (const entry of entries) {
    resources.set(
      `${entry.kind}:${entry.externalId}`,
      JSON.stringify({
        name: entry.name,
        datacenterName: entry.datacenterName,
        clusterName: entry.clusterName,
        hostName: entry.hostName,
        resourcePoolName: entry.resourcePoolName,
        resourcePoolPath: entry.resourcePoolPath,
        virtualAppName: entry.virtualAppName,
        vmInstanceUuid: entry.vmInstanceUuid,
        isTemplate: entry.isTemplate,
        isPoweredOn: computeVMwareIsPoweredOn(entry),
      }),
    );
  }

  return {
    resources: resources,
    extras: deriveVMwareVCenterSnapshotExtras(
      entries,
      vcenterBuffer.get("vcenter"),
    ),
  };
}

// The VM name in an identity ("... | vcenter.vm.name=web-01 | ...").
const VM_NAME_PATTERN: RegExp = /vcenter\.vm\.name=([^ |]+)/;

const VAPP_VMS: Array<string> = [
  "DC0_C0_APP0_VM0",
  "DC0_C0_APP0_VM1",
  "DC0_C1_APP0_VM0",
  "DC0_C1_APP0_VM1",
];

function isVAppVm(identity: string): boolean {
  return identity.includes("vcenter.virtual_app.name=");
}

describe.each([
  {
    mode: "vCenter",
    probeFixture: "vcsim-vcenter-collect.json",
    agentFixture: "vcenterreceiver-0.161.0-vcsim-vcenter.json",
    probeOnlyVms: VAPP_VMS,
    /*
     * Of the agent's 166 metrics, 6 depend on a sample: the six VMs' virtual
     * disk read throughput, a 0 in the probe's recording.
     */
    exactMetrics: 160,
    sampleMetrics: 6,
  },
  {
    mode: "standalone ESXi",
    probeFixture: "vcsim-esx-collect.json",
    agentFixture: "vcenterreceiver-0.161.0-vcsim-esx.json",
    probeOnlyVms: [] as Array<string>,
    // Of the agent's 48 metrics, 3 had a series the simulator sent as 0.
    exactMetrics: 45,
    sampleMetrics: 3,
  },
])(
  "the probe sends what the VMware agent sends ($mode)",
  (data: {
    mode: string;
    probeFixture: string;
    agentFixture: string;
    probeOnlyVms: Array<string>;
    exactMetrics: number;
    sampleMetrics: number;
  }) => {
    test("the same resources, each named by the same attributes in the same order", async () => {
      const probe: Map<string, JSONObject> = byIdentity(
        (await probeCollection(data.probeFixture)).result.resourceMetrics,
      );
      const agent: Map<string, JSONObject> = byIdentity(
        agentCollection(data.agentFixture),
      );

      const onlyAgent: Array<string> = Array.from(agent.keys()).filter(
        (identity: string) => {
          return !probe.has(identity);
        },
      );
      const onlyProbe: Array<string> = Array.from(probe.keys()).filter(
        (identity: string) => {
          return !agent.has(identity);
        },
      );

      expect(onlyAgent).toEqual([]);
      expect(onlyProbe.every(isVAppVm)).toBe(true);
      expect(
        onlyProbe
          .map((identity: string) => {
            return VM_NAME_PATTERN.exec(identity)![1];
          })
          .sort(),
      ).toEqual(data.probeOnlyVms);
      expect(probe.size).toBe(agent.size + data.probeOnlyVms.length);
    });

    test("every resource carries the same metrics, with the same kind, unit, description, value type and attributes", async () => {
      const collection: ProbeCollection = await probeCollection(
        data.probeFixture,
      );
      const probe: Map<string, JSONObject> = byIdentity(
        collection.result.resourceMetrics,
      );
      const sampled: Map<string, JSONObject> = byIdentity(
        VMwareOtlpBuilder.build(
          withEverySeriesSampled(collection.snapshot),
          "test",
        ).resourceMetrics,
      );
      const agent: Map<string, JSONObject> = byIdentity(
        agentCollection(data.agentFixture),
      );

      let comparedExactly: number = 0;
      let comparedAsSamples: number = 0;

      for (const [identity, agentResource] of agent) {
        expect(probe.has(identity)).toBe(true);

        const agentShapes: Map<string, MetricShape> = shapesOf(agentResource);
        const probeShapes: Map<string, MetricShape> = shapesOf(
          probe.get(identity)!,
        );
        const sampledShapes: Map<string, MetricShape> = shapesOf(
          sampled.get(identity)!,
        );

        // Nothing foreign to the agent's export ...
        expect({
          identity: identity,
          notInAgentExport: Array.from(probeShapes.keys()).filter(
            (name: string) => {
              return !agentShapes.has(name);
            },
          ),
        }).toEqual({ identity: identity, notInAgentExport: [] });

        for (const [name, agentShape] of agentShapes) {
          // ... and nothing of it missing, once every series has a sample.
          const sampledShape: MetricShape | undefined = sampledShapes.get(name);
          expect({
            identity: identity,
            name: name,
            sent: Boolean(sampledShape),
          }).toEqual({ identity: identity, name: name, sent: true });

          const probeShape: MetricShape | undefined = probeShapes.get(name);
          const isSampleDependent: boolean =
            !probeShape ||
            JSON.stringify(probeShape.attributeSets) !==
              JSON.stringify(sampledShape!.attributeSets);

          if (!isSampleDependent) {
            expect({
              identity: identity,
              name: name,
              shape: probeShape,
            }).toEqual({ identity: identity, name: name, shape: agentShape });
            comparedExactly++;
            continue;
          }

          const { attributeSets: sampledSets, ...sampledDefinition } =
            sampledShape!;
          const { attributeSets: agentSets, ...agentDefinition } = agentShape;

          expect({
            identity: identity,
            name: name,
            definition: sampledDefinition,
          }).toEqual({
            identity: identity,
            name: name,
            definition: agentDefinition,
          });
          expect({
            identity: identity,
            name: name,
            agentSetsTheProbeWouldSend: isSubsetOf(agentSets, sampledSets),
            probeSetsTheAgentSends: isSubsetOf(
              probeShape?.attributeSets || [],
              agentSets,
            ),
          }).toEqual({
            identity: identity,
            name: name,
            agentSetsTheProbeWouldSend: true,
            probeSetsTheAgentSends: true,
          });
          comparedAsSamples++;
        }
      }

      // The comparison really covered the collection.
      expect({
        exactly: comparedExactly,
        asSamples: comparedAsSamples,
      }).toEqual({
        exactly: data.exactMetrics,
        asSamples: data.sampleMetrics,
      });
    });

    test("the server's ingest builds the same inventory and the same vCenter counts from either", async () => {
      const probe: VMwareOtlpBuildResult = (
        await probeCollection(data.probeFixture)
      ).result;
      // What the probe-ingest route hands the metrics ingest.
      const prepared: JSONArray = VMwareProbeMetrics.prepare({
        resourceMetrics: probe.resourceMetrics,
        vcenterName: "golden-vcenter",
      }).resourceMetrics;

      const fromProbe: ScannedInventory = scanAsIngest(prepared);
      const fromAgent: ScannedInventory = scanAsIngest(
        agentCollection(data.agentFixture),
      );

      for (const [key, row] of fromAgent.resources) {
        expect({ key: key, row: fromProbe.resources.get(key) }).toEqual({
          key: key,
          row: row,
        });
      }

      const extraRows: Array<{ name: string; virtualAppName: string | null }> =
        Array.from(fromProbe.resources.entries())
          .filter(([key]: [string, string]) => {
            return !fromAgent.resources.has(key);
          })
          .map(([, row]: [string, string]) => {
            return JSON.parse(row) as {
              name: string;
              virtualAppName: string | null;
            };
          });

      expect(
        extraRows
          .map((row: { name: string }) => {
            return row.name;
          })
          .sort(),
      ).toEqual(data.probeOnlyVms);

      for (const row of extraRows) {
        expect(row.virtualAppName).toBeTruthy();
        expect(row).toMatchObject({ isPoweredOn: true, isTemplate: false });
      }

      // Every powered-on VM reads as powered on, from either.
      const poweredOn: (inventory: ScannedInventory) => number = (
        inventory: ScannedInventory,
      ): number => {
        return Array.from(inventory.resources.values()).filter(
          (row: string) => {
            return (
              (JSON.parse(row) as { isPoweredOn: boolean | null })
                .isPoweredOn === true
            );
          },
        ).length;
      };
      expect(poweredOn(fromProbe)).toBe(
        poweredOn(fromAgent) + data.probeOnlyVms.length,
      );

      expect(fromProbe.extras).toEqual({
        ...fromAgent.extras,
        vmCount: (fromAgent.extras.vmCount || 0) + data.probeOnlyVms.length,
        poweredOnVmCount:
          (fromAgent.extras.poweredOnVmCount || 0) + data.probeOnlyVms.length,
        // Capacity and use are the simulator's numbers of the moment.
        datastoreCapacityBytes: fromProbe.extras.datastoreCapacityBytes,
        datastoreUsedBytes: fromProbe.extras.datastoreUsedBytes,
      });
      expect(fromProbe.extras.datastoreCapacityBytes).toBe(
        fromAgent.extras.datastoreCapacityBytes,
      );
    });
  },
);

describe("a VM in a vApp (vCenter)", () => {
  test("carries the metrics of any other VM, named by its vApp", async () => {
    const probe: Map<string, JSONObject> = byIdentity(
      (await probeCollection("vcsim-vcenter-collect.json")).result
        .resourceMetrics,
    );
    const vAppVm: JSONObject = Array.from(probe.entries()).find(
      ([identity]: [string, JSONObject]) => {
        return isVAppVm(identity);
      },
    )![1];
    const pooledVm: JSONObject = Array.from(probe.entries()).find(
      ([identity]: [string, JSONObject]) => {
        return (
          identity.includes("vcenter.vm.name=") &&
          identity.includes("vcenter.resource_pool.name=")
        );
      },
    )![1];

    expect(identityOf(vAppVm)).toContain(
      "vcenter.virtual_app.inventory_path=/F0/DC0/vm/",
    );
    expect(Array.from(shapesOf(vAppVm).keys()).sort()).toEqual(
      Array.from(shapesOf(pooledVm).keys()).sort(),
    );
  });
});
