import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import OpenStackCloudService from "../../../../Server/Services/OpenStackCloudService";
import OpenStackResourceService from "../../../../Server/Services/OpenStackResourceService";
import OpenStackInstanceMetricsIngest from "../../../../Server/Utils/Telemetry/OpenStackInstanceMetricsIngest";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { OpenStackInstanceMetric } from "../../../../Types/OpenStack/OpenStackInstanceMetrics";
import { OpenStackResourceKind } from "../../../../Types/OpenStack/OpenStackResourceKind";
import {
  BURNER_ID,
  InstanceTruth,
  ceilometerText,
  libvirtText,
  parsePrometheusExposition,
  prometheusToEnvelope,
} from "../../../Helpers/OpenStackInstanceMetricsFixtures";

/*
 * What sits around the pure scan: the last readings in Redis, the inventory and what the cloud
 * chose. Never in the way of a batch: whatever fails, the originals go through as they came.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const START_MS: number = 1793785799000;

const TRUTH: InstanceTruth = {
  instanceId: BURNER_ID,
  domain: "instance-00000001",
  vcpus: 2,
  cpuSeconds: 1000,
  delaySeconds: 10,
  residentBytes: 1048576,
  diskReadBytes: 0,
  diskWriteBytes: 0,
  diskReadRequests: 0,
  diskWriteRequests: 0,
  diskReadSeconds: 0,
  diskWriteSeconds: 0,
  networkReceiveBytes: 0,
  networkTransmitBytes: 0,
};

let store: Map<string, string>;

function envelopeAt(minute: number): JSONObject {
  return prometheusToEnvelope({
    series: parsePrometheusExposition(
      libvirtText([{ ...TRUTH, cpuSeconds: 1000 + minute * 60 }]),
    ),
    timeMs: START_MS + minute * 60000,
    exporterHost: "compute-01",
  });
}

function namesIn(envelope: JSONObject): Array<string> {
  return (envelope["scopeMetrics"] as Array<JSONObject>).flatMap(
    (scope: JSONObject): Array<string> => {
      return (scope["metrics"] as Array<JSONObject>).map(
        (metric: JSONObject): string => {
          return metric["name"] as string;
        },
      );
    },
  );
}

// Every cloud is a new one, so what one test caches can't reach another.
function aCloud(options?: JSONObject, instanceCount: number = 3): ObjectID {
  jest.spyOn(OpenStackCloudService, "findOneById").mockResolvedValue({
    instanceMetricsOptions: options,
    instanceCount,
  } as never);
  return ObjectID.generate();
}

beforeEach(() => {
  store = new Map();
  jest.spyOn(GlobalCache, "getStrings").mockImplementation((async (
    _namespace: string,
    keys: Array<string>,
  ) => {
    return keys.map((key: string): string | null => {
      return store.get(key) || null;
    });
  }) as never);
  jest.spyOn(GlobalCache, "setString").mockImplementation((async (
    _namespace: string,
    key: string,
    value: string,
  ) => {
    store.set(key, value);
  }) as never);
  jest
    .spyOn(OpenStackResourceService, "findBy")
    .mockImplementation((async (data: {
      query: { kind: OpenStackResourceKind };
    }) => {
      return data.query.kind === OpenStackResourceKind.Instance
        ? [
            {
              externalId: BURNER_ID,
              hypervisorName: "compute-01.example.internal",
              regionName: "RegionOne",
              openStackProjectId: "p1",
            },
          ]
        : [
            {
              hypervisorName: "compute-01.example.internal",
              facts: { aggregates: "fast, gpu" },
            },
          ];
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a batch through ingest", () => {
  test("a rate comes from a reading kept since the last batch", async () => {
    const openStackCloudId: ObjectID = aCloud();
    await OpenStackInstanceMetricsIngest.normalizeEnvelope({
      projectId: PROJECT_ID,
      openStackCloudId,
      envelope: envelopeAt(0),
    });
    const second: JSONObject = envelopeAt(1);
    await OpenStackInstanceMetricsIngest.normalizeEnvelope({
      projectId: PROJECT_ID,
      openStackCloudId,
      envelope: second,
    });
    expect(namesIn(second)).toContain(OpenStackInstanceMetric.CpuUsage);
    // Each cloud and exporter keeps its own, one value in Redis per compute node.
    expect(
      Array.from(store.keys()).every((key: string): boolean => {
        return key === `${openStackCloudId.toString()}:libvirt|compute-01`;
      }),
    ).toBe(true);
  });

  test("the inventory is read once per instance, however many batches it reports in", async () => {
    const openStackCloudId: ObjectID = aCloud();
    const findBy: unknown = OpenStackResourceService.findBy;
    for (let minute: number = 0; minute < 3; minute++) {
      await OpenStackInstanceMetricsIngest.normalizeEnvelope({
        projectId: PROJECT_ID,
        openStackCloudId,
        envelope: envelopeAt(minute),
      });
    }
    // Its row, and its hypervisor's for the aggregates. Then from memory.
    expect(findBy).toHaveBeenCalledTimes(2);
  });

  describe("a source that doesn't say how many vCPUs an instance has", () => {
    // Ceilometer's lines, without its vcpus, as Epoxy and the polling.yaml it ships leave them.
    function ceilometerAt(minute: number): JSONObject {
      return prometheusToEnvelope({
        series: parsePrometheusExposition(
          ceilometerText([{ ...TRUTH, cpuSeconds: 1000 + (minute / 5) * 300 }])
            .split("\n")
            .filter((line: string): boolean => {
              return !line.startsWith("ceilometer_vcpus");
            })
            .join("\n"),
        ),
        timeMs: START_MS + minute * 60000,
        exporterHost: "compute-01",
      });
    }

    function withFlavor(vcpuCapacity: number | undefined): void {
      jest
        .spyOn(OpenStackResourceService, "findBy")
        .mockImplementation((async (data: {
          query: { kind: OpenStackResourceKind };
        }) => {
          if (data.query.kind === OpenStackResourceKind.Instance) {
            return [
              {
                externalId: BURNER_ID,
                hypervisorName: "compute-01.example.internal",
                regionName: "RegionOne",
                openStackProjectId: "p1",
                facts: { flavorId: "f1" },
              },
            ];
          }
          if (data.query.kind === OpenStackResourceKind.Flavor) {
            return vcpuCapacity
              ? [{ externalId: "RegionOne/f1", vcpuCapacity }]
              : [];
          }
          return [{ hypervisorName: "compute-01.example.internal", facts: {} }];
        }) as never);
    }

    async function utilizationAfterThreePolls(): Promise<number | undefined> {
      const openStackCloudId: ObjectID = aCloud();
      let last: JSONObject = {};
      for (const minute of [0, 5, 10]) {
        last = ceilometerAt(minute);
        await OpenStackInstanceMetricsIngest.normalizeEnvelope({
          projectId: PROJECT_ID,
          openStackCloudId,
          envelope: last,
        });
      }
      const metric: JSONObject | undefined = (
        last["scopeMetrics"] as Array<JSONObject>
      )
        .flatMap((scope: JSONObject): Array<JSONObject> => {
          return scope["metrics"] as Array<JSONObject>;
        })
        .find((one: JSONObject): boolean => {
          return one["name"] === OpenStackInstanceMetric.CpuUtilization;
        });
      return metric
        ? ((
            (metric["gauge"] as JSONObject)["dataPoints"] as Array<JSONObject>
          )[0]!["asDouble"] as number)
        : undefined;
    }

    test("what its flavor says is what its CPU is a share of", async () => {
      withFlavor(4);
      // One thread busy of the four its flavor gives it.
      expect(await utilizationAfterThreePolls()).toBeCloseTo(25);
    });

    test("its flavor is asked for by how a flavor's row is keyed, and once", async () => {
      withFlavor(4);
      await utilizationAfterThreePolls();
      const calls: Array<Array<unknown>> = (
        OpenStackResourceService.findBy as unknown as jest.Mock
      ).mock.calls as Array<Array<unknown>>;
      const flavorCalls: Array<Array<unknown>> = calls.filter(
        (call: Array<unknown>): boolean => {
          return (
            (call[0] as { query: { kind: OpenStackResourceKind } }).query
              .kind === OpenStackResourceKind.Flavor
          );
        },
      );
      expect(flavorCalls).toHaveLength(1);
      expect(
        JSON.stringify(
          (flavorCalls[0]![0] as { query: { externalId: unknown } }).query
            .externalId,
        ),
      ).toContain("RegionOne/f1");
      // Its row, its hypervisor's and its flavor's, then from memory.
      expect(calls).toHaveLength(3);
    });

    test("with a flavor nobody knows, it has no share, rather than a made-up one", async () => {
      withFlavor(undefined);
      expect(await utilizationAfterThreePolls()).toBeUndefined();
    });
  });

  test("a batch from anything else costs no read at all", async () => {
    const openStackCloudId: ObjectID = aCloud();
    const envelope: JSONObject = prometheusToEnvelope({
      series: parsePrometheusExposition("openstack_nova_up 1"),
      timeMs: START_MS,
    });
    await OpenStackInstanceMetricsIngest.normalizeEnvelope({
      projectId: PROJECT_ID,
      openStackCloudId,
      envelope,
    });
    expect(GlobalCache.getStrings).not.toHaveBeenCalled();
    expect(OpenStackResourceService.findBy).not.toHaveBeenCalled();
  });

  test("past the stated size a cloud keeps only its hypervisors' totals", async () => {
    const openStackCloudId: ObjectID = aCloud(undefined, 501);
    await OpenStackInstanceMetricsIngest.normalizeEnvelope({
      projectId: PROJECT_ID,
      openStackCloudId,
      envelope: envelopeAt(0),
    });
    const second: JSONObject = envelopeAt(1);
    await OpenStackInstanceMetricsIngest.normalizeEnvelope({
      projectId: PROJECT_ID,
      openStackCloudId,
      envelope: second,
    });
    expect(namesIn(second)).not.toContain(OpenStackInstanceMetric.CpuUsage);
    expect(namesIn(second)).not.toContain(
      "libvirt_domain_info_cpu_time_seconds_total",
    );
    expect(namesIn(second)).toContain(
      "openstack.hypervisor.instances.cpu.usage",
    );
  });

  test("a selection by aggregate keeps the instances on that aggregate's hypervisors", async () => {
    const openStackCloudId: ObjectID = aCloud(
      { mode: "selected", aggregates: ["gpu"] },
      100000,
    );
    await OpenStackInstanceMetricsIngest.normalizeEnvelope({
      projectId: PROJECT_ID,
      openStackCloudId,
      envelope: envelopeAt(0),
    });
    const second: JSONObject = envelopeAt(1);
    await OpenStackInstanceMetricsIngest.normalizeEnvelope({
      projectId: PROJECT_ID,
      openStackCloudId,
      envelope: second,
    });
    expect(namesIn(second)).toContain(OpenStackInstanceMetric.CpuUsage);
  });

  test("a saved choice that has gone wrong reads as the defaults", async () => {
    const openStackCloudId: ObjectID = aCloud({ mode: "nonsense" });
    await OpenStackInstanceMetricsIngest.normalizeEnvelope({
      projectId: PROJECT_ID,
      openStackCloudId,
      envelope: envelopeAt(0),
    });
    const second: JSONObject = envelopeAt(1);
    await OpenStackInstanceMetricsIngest.normalizeEnvelope({
      projectId: PROJECT_ID,
      openStackCloudId,
      envelope: second,
    });
    expect(namesIn(second)).toContain(OpenStackInstanceMetric.CpuUsage);
  });

  test("a state that can't be read is a first sample, and the next rate is right again", async () => {
    const openStackCloudId: ObjectID = aCloud();
    store.set(
      `${openStackCloudId.toString()}:libvirt|compute-01`,
      "not json at all",
    );
    const first: JSONObject = envelopeAt(0);
    await OpenStackInstanceMetricsIngest.normalizeEnvelope({
      projectId: PROJECT_ID,
      openStackCloudId,
      envelope: first,
    });
    expect(namesIn(first)).not.toContain(OpenStackInstanceMetric.CpuUsage);
    const second: JSONObject = envelopeAt(1);
    await OpenStackInstanceMetricsIngest.normalizeEnvelope({
      projectId: PROJECT_ID,
      openStackCloudId,
      envelope: second,
    });
    expect(namesIn(second)).toContain(OpenStackInstanceMetric.CpuUsage);
  });

  describe("never in the way of a batch", () => {
    async function afterFailure(): Promise<JSONObject> {
      const envelope: JSONObject = envelopeAt(0);
      await expect(
        OpenStackInstanceMetricsIngest.normalizeEnvelope({
          projectId: PROJECT_ID,
          openStackCloudId: aCloud(),
          envelope,
        }),
      ).resolves.toBeUndefined();
      return envelope;
    }

    test("Redis being down leaves the originals as they came", async () => {
      jest
        .spyOn(GlobalCache, "getStrings")
        .mockRejectedValue(new Error("not connected") as never);
      expect(namesIn(await afterFailure())).toEqual(namesIn(envelopeAt(0)));
    });

    test("Postgres being down leaves them too", async () => {
      jest
        .spyOn(OpenStackResourceService, "findBy")
        .mockRejectedValue(new Error("gone") as never);
      expect(namesIn(await afterFailure())).toEqual(namesIn(envelopeAt(0)));
    });
  });
});
