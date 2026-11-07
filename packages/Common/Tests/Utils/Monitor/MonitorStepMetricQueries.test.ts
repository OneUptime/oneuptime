import { describe, expect, test } from "@jest/globals";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import Wildcard from "../../../Types/BaseDatabase/Wildcard";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import MetricFormulaConfigData from "../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepMetricViewConfigUtil from "../../../Types/Monitor/MonitorStepMetricViewConfigUtil";
import { SWARM_TASK_SERVICE_ATTRIBUTE } from "../../../Types/Monitor/MonitorStepDockerSwarmMonitor";
import { OPENSTACK_REGION_ATTRIBUTE } from "../../../Types/Monitor/MonitorStepOpenStackMonitor";
import MonitorType, {
  MonitorTypeHelper,
} from "../../../Types/Monitor/MonitorType";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import StorageSystem from "../../../Types/StorageArray/StorageSystem";
import MonitorStepMetricQueries, {
  MonitorStepMetricReads,
  StorageArrayResourceFilterScopes,
  VMwareResourceFilterAttributeKeys,
  applyStorageArrayResourceFilters,
  applyVMwareResourceFilters,
} from "../../../Utils/Monitor/MonitorStepMetricQueries";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * Issue #5759: a monitor's page charts what the monitor evaluates. A step's
 * queries are read the way the worker reads them, each with the filters the
 * monitor adds to it: the host, cluster or fleet it watches, and its
 * resource filters. (The App suite MonitorStepMetricQueriesWorkerParity
 * holds this to the worker's own functions.)
 */

const queryOf: (data: {
  variable?: string;
  metricName?: string;
  attributes?: JSONObject;
  aggregation?: MetricsAggregationType;
}) => MetricQueryConfigData = (data: {
  variable?: string;
  metricName?: string;
  attributes?: JSONObject;
  aggregation?: MetricsAggregationType;
}): MetricQueryConfigData => {
  return {
    metricAliasData: {
      metricVariable: data.variable || "a",
      title: "CPU",
      description: "",
      legend: "",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: data.metricName || "a.metric",
        aggegationType: data.aggregation || MetricsAggregationType.Avg,
        ...(data.attributes ? { attributes: data.attributes } : {}),
      },
      groupByAttributeKeys: ["host.name"],
    },
    criticalThreshold: 95,
  } as unknown as MetricQueryConfigData;
};

const stepOf: (data: {
  stepKey: string;
  settings?: JSONObject;
  queryConfigs?: Array<MetricQueryConfigData>;
  formulaConfigs?: Array<MetricFormulaConfigData>;
  rollingTime?: RollingTime;
}) => MonitorStep = (data: {
  stepKey: string;
  settings?: JSONObject;
  queryConfigs?: Array<MetricQueryConfigData>;
  formulaConfigs?: Array<MetricFormulaConfigData>;
  rollingTime?: RollingTime;
}): MonitorStep => {
  const step: MonitorStep = new MonitorStep();

  step.data = {
    id: "step-1",
    monitorCriteria: { data: undefined },
    [data.stepKey]: {
      ...(data.settings || {}),
      rollingTime: data.rollingTime || RollingTime.Past5Minutes,
      metricViewConfig: {
        queryConfigs: data.queryConfigs || [queryOf({})],
        formulaConfigs: data.formulaConfigs || [],
      },
    },
  } as unknown as MonitorStep["data"];

  return step;
};

const readOf: (data: {
  monitorType: MonitorType;
  stepKey: string;
  settings?: JSONObject;
  query?: MetricQueryConfigData;
}) => Dictionary<unknown> | undefined = (data: {
  monitorType: MonitorType;
  stepKey: string;
  settings?: JSONObject;
  query?: MetricQueryConfigData;
}): Dictionary<unknown> | undefined => {
  const reads: MonitorStepMetricReads | null =
    MonitorStepMetricQueries.getReads({
      monitorType: data.monitorType,
      monitorStep: stepOf({
        stepKey: data.stepKey,
        settings: data.settings || {},
        queryConfigs: [data.query || queryOf({})],
      }),
    });

  return reads?.queryConfigs[0]?.metricQueryData.filterData
    .attributes as unknown as Dictionary<unknown> | undefined;
};

describe("which monitor types it reads", () => {
  test("every metric-backed monitor type, and nothing else", () => {
    expect(MonitorStepMetricQueries.getMonitorTypes().sort()).toEqual(
      MonitorTypeHelper.getMetricBackedMonitorTypes().sort(),
    );
  });

  test("each keeps its settings under a key the criteria UI reads queries from", () => {
    for (const monitorType of MonitorStepMetricQueries.getMonitorTypes()) {
      const stepKey: string | null =
        MonitorStepMetricQueries.getStepKey(monitorType);

      expect(stepKey).not.toBeNull();

      const step: MonitorStep = stepOf({ stepKey: stepKey! });

      // The same queries the criteria editor offers for the step.
      expect(
        MonitorStepMetricViewConfigUtil.getMetricViewConfig(step.data)
          ?.queryConfigs,
      ).toHaveLength(1);
    }
  });

  test("a type that is not metric-backed, or none, has no step key", () => {
    expect(MonitorStepMetricQueries.getStepKey(MonitorType.Logs)).toBeNull();
    expect(MonitorStepMetricQueries.getStepKey(MonitorType.Website)).toBeNull();
    expect(MonitorStepMetricQueries.getStepKey(undefined)).toBeNull();
    expect(MonitorStepMetricQueries.getStepKey(null)).toBeNull();
  });
});

describe("the filters each monitor type reads its queries with", () => {
  test("Metrics: the query's own filters, as written", () => {
    expect(
      readOf({
        monitorType: MonitorType.Metrics,
        stepKey: "metricMonitor",
        query: queryOf({ attributes: { state: "idle" } }),
      }),
    ).toEqual({ state: "idle" });

    expect(
      readOf({ monitorType: MonitorType.Metrics, stepKey: "metricMonitor" }),
    ).toBeUndefined();
  });

  test("Host: the host, as ingest stores its name", () => {
    expect(
      readOf({
        monitorType: MonitorType.Host,
        stepKey: "hostMonitor",
        settings: { hostIdentifier: "  Web-01 " },
      }),
    ).toEqual({ "resource.host.name": "web-01" });

    expect(
      readOf({ monitorType: MonitorType.Host, stepKey: "hostMonitor" }),
    ).toBeUndefined();
  });

  test.each([
    [MonitorType.Docker, "dockerMonitor", "docker"],
    [MonitorType.Podman, "podmanMonitor", "podman"],
  ])(
    "%s: the host, its runtime and the container filters",
    (monitorType: MonitorType, stepKey: string, runtime: string) => {
      expect(
        readOf({
          monitorType,
          stepKey,
          settings: {
            hostIdentifier: "Web-01",
            containerFilters: {
              containerName: "api",
              containerImage: "nginx:1.27",
            },
          },
        }),
      ).toEqual({
        "resource.host.name": "web-01",
        "resource.container.runtime": runtime,
        "resource.container.name": "api",
        "resource.container.image.name": "nginx:1.27",
      });

      // The runtime is always read, even with nothing else.
      expect(readOf({ monitorType, stepKey })).toEqual({
        "resource.container.runtime": runtime,
      });
    },
  );

  test("Kubernetes: the cluster and every resource filter, the workload by its kind", () => {
    expect(
      readOf({
        monitorType: MonitorType.Kubernetes,
        stepKey: "kubernetesMonitor",
        settings: {
          clusterIdentifier: " prod ",
          resourceFilters: {
            namespace: "payments",
            nodeName: "node-1",
            podName: "api-0",
            workloadType: "StatefulSet",
            workloadName: " api ",
          },
        },
      }),
    ).toEqual({
      "resource.k8s.cluster.name": "prod",
      "resource.k8s.namespace.name": "payments",
      "resource.k8s.node.name": "node-1",
      "resource.k8s.pod.name": "api-0",
      "resource.k8s.statefulset.name": "api",
    });

    // A workload named without a kind is a Deployment's.
    expect(
      readOf({
        monitorType: MonitorType.Kubernetes,
        stepKey: "kubernetesMonitor",
        settings: { resourceFilters: { workloadName: "web" } },
      }),
    ).toEqual({ "resource.k8s.deployment.name": "web" });

    /*
     * The worker says it read a query with nothing as an empty map, and the
     * query then carries no filters at all.
     */
    expect(
      MonitorStepMetricQueries.getReadAttributes({
        monitorType: MonitorType.Kubernetes,
        settings: {},
        queryConfig: queryOf({}),
      }),
    ).toEqual({});
    expect(
      readOf({ monitorType: MonitorType.Kubernetes, stepKey: "kubernetesMonitor" }),
    ).toBeUndefined();
  });

  test("Proxmox: the cluster; a guest id wins, then a node name, then scope and id", () => {
    const read: (filters: JSONObject) => Dictionary<unknown> | undefined = (
      filters: JSONObject,
    ): Dictionary<unknown> | undefined => {
      return readOf({
        monitorType: MonitorType.Proxmox,
        stepKey: "proxmoxMonitor",
        settings: { clusterIdentifier: "pve", resourceFilters: filters },
      });
    };

    expect(
      read({ guestId: "qemu/100", nodeName: "pve1", scope: "storage" }),
    ).toEqual({ "resource.proxmox.cluster.name": "pve", id: "qemu/100" });
    expect(read({ nodeName: "pve1", scope: "storage", pveId: "x" })).toEqual({
      "resource.proxmox.cluster.name": "pve",
      "pve.scope": "node",
      "pve.id": "pve1",
    });
    expect(read({ scope: "guest", pveId: "100" })).toEqual({
      "resource.proxmox.cluster.name": "pve",
      "pve.scope": "guest",
      "pve.id": "100",
    });
    expect(read({})).toEqual({ "resource.proxmox.cluster.name": "pve" });
  });

  test("OpenStack: the cloud, the region, and each filter on the label its series spells it with", () => {
    expect(
      readOf({
        monitorType: MonitorType.OpenStack,
        stepKey: "openstackMonitor",
        settings: {
          cloudIdentifier: "prod",
          resourceFilters: {
            regionName: "RegionOne",
            availabilityZone: "nova",
            hypervisorName: "compute-1",
            projectId: "tenant-1",
          },
        },
        query: queryOf({ metricName: "openstack_nova_server_status" }),
      }),
    ).toEqual({
      "resource.openstack.cloud.name": "prod",
      [OPENSTACK_REGION_ATTRIBUTE]: "RegionOne",
      availability_zone: "nova",
      hypervisor_hostname: "compute-1",
      tenant_id: "tenant-1",
    });

    // A series without those labels is narrowed by the region alone.
    expect(
      readOf({
        monitorType: MonitorType.OpenStack,
        stepKey: "openstackMonitor",
        settings: {
          cloudIdentifier: "prod",
          resourceFilters: { regionName: "RegionOne", projectId: "tenant-1" },
        },
        query: queryOf({ metricName: "openstack_nova_up" }),
      }),
    ).toEqual({
      "resource.openstack.cloud.name": "prod",
      [OPENSTACK_REGION_ATTRIBUTE]: "RegionOne",
    });
  });

  test("VMware: the vCenter and every inventory filter, trimmed; values that are not text are left out", () => {
    expect(
      readOf({
        monitorType: MonitorType.VMware,
        stepKey: "vmwareMonitor",
        settings: {
          vcenterIdentifier: "vc-1",
          resourceFilters: {
            datacenterName: " DC1 ",
            clusterName: "C1",
            hostName: "esx-01",
            vmName: "",
            datastoreName: 7 as unknown as string,
            resourcePoolPath: "/DC1/host/C1/Resources/pool",
          },
        },
      }),
    ).toEqual({
      "resource.vmware.vcenter.name": "vc-1",
      "resource.vcenter.datacenter.name": "DC1",
      "resource.vcenter.cluster.name": "C1",
      "resource.vcenter.host.name": "esx-01",
      "resource.vcenter.resource_pool.inventory_path":
        "/DC1/host/C1/Resources/pool",
    });
  });

  test("Ceph: the cluster, an OSD's daemon and a pool's id", () => {
    expect(
      readOf({
        monitorType: MonitorType.Ceph,
        stepKey: "cephMonitor",
        settings: {
          clusterIdentifier: "ceph-1",
          resourceFilters: { osdId: "osd.3", poolId: "2" },
        },
      }),
    ).toEqual({
      "resource.ceph.cluster.name": "ceph-1",
      ceph_daemon: "osd.3",
      pool_id: "2",
    });
  });

  test("Storage Array: the array, and each object filter on its platform's label", () => {
    expect(
      readOf({
        monitorType: MonitorType.StorageArray,
        stepKey: "storageArrayMonitor",
        settings: {
          arrayIdentifier: "array-1",
          storageSystem: StorageSystem.PureStorageFlashBlade,
          resourceFilters: { componentName: "CH1.FM1", hostName: "esx-1" },
        },
      }),
    ).toEqual({
      "resource.storage.array.name": "array-1",
      name: "CH1.FM1",
      host: "esx-1",
    });
  });

  test("IoT: the fleet whatever its case, the device and its type; a saved scope is ignored", () => {
    expect(
      readOf({
        monitorType: MonitorType.IoTDevice,
        stepKey: "iotMonitor",
        settings: {
          fleetIdentifier: " Ware*house ",
          resourceFilters: {
            scope: "device",
            deviceId: "sensor-1",
            deviceType: "thermometer",
          },
        },
      }),
    ).toEqual({
      // Matched literally: a "*" in a fleet's name is not a wildcard.
      "resource.iot.fleet.name": new Wildcard<string>(["Ware\\*house"]),
      "device.id": "sensor-1",
      "iot.device.type": "thermometer",
    });

    expect(
      readOf({ monitorType: MonitorType.IoTDevice, stepKey: "iotMonitor" }),
    ).toBeUndefined();
  });

  test("Docker Swarm: the cluster, the image with or without its digest, and tasks only", () => {
    const read: Dictionary<unknown> | undefined = readOf({
      monitorType: MonitorType.DockerSwarm,
      stepKey: "dockerSwarmMonitor",
      settings: {
        clusterIdentifier: "swarm-1",
        resourceFilters: {
          containerName: "web.1.abc",
          containerImage: "nginx",
          nodeName: "node-1",
          tasksOnly: true,
        },
      },
    });

    expect(read).toEqual({
      "resource.docker.swarm.cluster.name": "swarm-1",
      "resource.container.name": "web.1.abc",
      "resource.container.image.name": new Wildcard<string>([
        "nginx",
        "nginx@*",
        "nginx:latest",
        "nginx:latest@*",
      ]),
      "resource.docker.swarm.node.name": "node-1",
      [SWARM_TASK_SERVICE_ATTRIBUTE]: new NotNull(),
    });

    // A named service scopes to tasks already.
    expect(
      readOf({
        monitorType: MonitorType.DockerSwarm,
        stepKey: "dockerSwarmMonitor",
        settings: {
          resourceFilters: { serviceName: "shop_web", tasksOnly: true },
        },
      }),
    ).toEqual({ "resource.docker.swarm.service.name": "shop_web" });

    // Tasks only, and nothing else.
    expect(
      readOf({
        monitorType: MonitorType.DockerSwarm,
        stepKey: "dockerSwarmMonitor",
        settings: { resourceFilters: { tasksOnly: true } },
      }),
    ).toEqual({ [SWARM_TASK_SERVICE_ATTRIBUTE]: new NotNull() });

    expect(
      readOf({
        monitorType: MonitorType.DockerSwarm,
        stepKey: "dockerSwarmMonitor",
      }),
    ).toBeUndefined();
  });

  test("a query's own filters stay, and the monitor's win where they name the same attribute", () => {
    expect(
      readOf({
        monitorType: MonitorType.Host,
        stepKey: "hostMonitor",
        settings: { hostIdentifier: "web-01" },
        query: queryOf({
          attributes: { state: "used", "resource.host.name": "other" },
        }),
      }),
    ).toEqual({ state: "used", "resource.host.name": "web-01" });
  });
});

describe("the step's queries as the monitor reads them", () => {
  test("each query reads with the monitor's filters; everything else about it is kept", () => {
    const query: MetricQueryConfigData = queryOf({
      variable: "b",
      metricName: "pve_memory_usage_bytes",
      attributes: { "pve.scope": "node" },
      aggregation: MetricsAggregationType.Max,
    });

    const reads: MonitorStepMetricReads = MonitorStepMetricQueries.getReads({
      monitorType: MonitorType.Proxmox,
      monitorStep: stepOf({
        stepKey: "proxmoxMonitor",
        settings: { clusterIdentifier: "pve" },
        queryConfigs: [query],
        rollingTime: RollingTime.Past15Minutes,
      }),
    })!;

    expect(reads.queryConfigs).toEqual([
      {
        ...query,
        metricQueryData: {
          ...query.metricQueryData,
          filterData: {
            ...query.metricQueryData.filterData,
            attributes: {
              "pve.scope": "node",
              "resource.proxmox.cluster.name": "pve",
            },
          },
        },
      },
    ]);
    expect(reads.rollingTime).toBe(RollingTime.Past15Minutes);
    expect(reads.aggregatesWholeWindow).toBe(false);
    expect(reads.telemetryServiceIds).toEqual([]);
  });

  test("a query read with nothing carries no attributes at all", () => {
    const reads: MonitorStepMetricReads = MonitorStepMetricQueries.getReads({
      monitorType: MonitorType.Metrics,
      monitorStep: stepOf({
        stepKey: "metricMonitor",
        queryConfigs: [queryOf({ attributes: {} })],
      }),
    })!;

    expect(
      Object.keys(reads.queryConfigs[0]!.metricQueryData.filterData),
    ).not.toContain("attributes");
  });

  test("the step it was handed is left as it was", () => {
    const step: MonitorStep = stepOf({
      stepKey: "kubernetesMonitor",
      settings: { clusterIdentifier: "prod" },
      queryConfigs: [queryOf({ attributes: { phase: "Running" } })],
    });
    const before: string = JSON.stringify(step.data);

    MonitorStepMetricQueries.getReads({
      monitorType: MonitorType.Kubernetes,
      monitorStep: step,
    });

    expect(JSON.stringify(step.data)).toBe(before);
  });

  test("a Metrics step says it reads its whole window, and the services it is scoped to", () => {
    const step: MonitorStep = stepOf({
      stepKey: "metricMonitor",
      settings: {
        aggregatesWholeWindow: true,
        telemetryServiceIds: ["service-1", "", null] as unknown as JSONObject,
      },
    });

    const reads: MonitorStepMetricReads = MonitorStepMetricQueries.getReads({
      monitorType: MonitorType.Metrics,
      monitorStep: step,
    })!;

    expect(reads.aggregatesWholeWindow).toBe(true);
    expect(reads.telemetryServiceIds).toEqual(["service-1"]);

    // Only a Metrics step can read its window whole.
    expect(
      MonitorStepMetricQueries.getReads({
        monitorType: MonitorType.Host,
        monitorStep: stepOf({
          stepKey: "hostMonitor",
          settings: { aggregatesWholeWindow: true },
        }),
      })!.aggregatesWholeWindow,
    ).toBe(false);
  });

  test("settings under another type's key, or none, read as nothing", () => {
    expect(
      MonitorStepMetricQueries.getReads({
        monitorType: MonitorType.Host,
        monitorStep: stepOf({ stepKey: "dockerMonitor" }),
      }),
    ).toBeNull();
    expect(
      MonitorStepMetricQueries.getReads({
        monitorType: MonitorType.Logs,
        monitorStep: stepOf({ stepKey: "logMonitor" }),
      }),
    ).toBeNull();
    expect(
      MonitorStepMetricQueries.getReads({
        monitorType: MonitorType.Host,
        monitorStep: undefined,
      }),
    ).toBeNull();

    const arrayStep: MonitorStep = new MonitorStep();
    arrayStep.data = {
      hostMonitor: [],
    } as unknown as MonitorStep["data"];

    expect(
      MonitorStepMetricQueries.getReads({
        monitorType: MonitorType.Host,
        monitorStep: arrayStep,
      }),
    ).toBeNull();
  });

  test("a step stored without its queries, or with broken ones, reads as no queries", () => {
    const step: MonitorStep = new MonitorStep();
    step.data = {
      hostMonitor: {
        hostIdentifier: "web-01",
        metricViewConfig: {
          queryConfigs: [null, "x", queryOf({})],
          formulaConfigs: null,
        },
      },
    } as unknown as MonitorStep["data"];

    const reads: MonitorStepMetricReads = MonitorStepMetricQueries.getReads({
      monitorType: MonitorType.Host,
      monitorStep: step,
    })!;

    expect(reads.queryConfigs).toHaveLength(1);
    expect(reads.formulaConfigs).toEqual([]);
    expect(reads.rollingTime).toBe(RollingTime.Past1Minute);

    const empty: MonitorStep = new MonitorStep();
    empty.data = {
      proxmoxMonitor: { clusterIdentifier: "pve" },
    } as unknown as MonitorStep["data"];

    expect(
      MonitorStepMetricQueries.getReads({
        monitorType: MonitorType.Proxmox,
        monitorStep: empty,
      }),
    ).toEqual({
      queryConfigs: [],
      formulaConfigs: [],
      rollingTime: RollingTime.Past1Minute,
      aggregatesWholeWindow: false,
      telemetryServiceIds: [],
    });
  });
});

describe("how long a stretch each value the monitor compares covers", () => {
  test.each([
    [RollingTime.Past1Minute, AggregationInterval.Minute],
    [RollingTime.Past5Minutes, AggregationInterval.Minute],
    [RollingTime.Past3Hours, AggregationInterval.Minute],
    [RollingTime.Past6Hours, AggregationInterval.FiveMinutes],
    [RollingTime.Past12Hours, AggregationInterval.FiveMinutes],
    [RollingTime.Past1Hours, AggregationInterval.FifteenMinutes],
    [RollingTime.Past2Days, AggregationInterval.ThirtyMinutes],
    [RollingTime.Past7Days, AggregationInterval.Hour],
    [RollingTime.Past30Days, AggregationInterval.Day],
  ])(
    "a window of %s is read a %s at a time",
    (rollingTime: RollingTime, interval: AggregationInterval) => {
      expect(
        MonitorStepMetricQueries.getEvaluationInterval({
          rollingTime,
          aggregatesWholeWindow: false,
        }),
      ).toBe(interval);
    },
  );

  test("a window read whole is one value", () => {
    expect(
      MonitorStepMetricQueries.getEvaluationInterval({
        rollingTime: RollingTime.Past15Minutes,
        aggregatesWholeWindow: true,
      }),
    ).toBe(AggregationInterval.Total);
  });
});

describe("the shared filter maps (moved from the worker)", () => {
  test("VMware maps every filter the step offers", () => {
    expect(Object.keys(VMwareResourceFilterAttributeKeys).sort()).toEqual(
      [
        "clusterName",
        "datacenterName",
        "datastoreName",
        "hostName",
        "resourcePoolPath",
        "vmName",
      ].sort(),
    );

    const attributes: Dictionary<string> = {};
    applyVMwareResourceFilters({ attributes, resourceFilters: undefined });
    expect(attributes).toEqual({});
  });

  test("Storage Array leaves the attributes alone without filters", () => {
    expect(Object.keys(StorageArrayResourceFilterScopes)).toHaveLength(6);

    const attributes: Dictionary<string> = { kept: "yes" };
    applyStorageArrayResourceFilters({
      attributes,
      resourceFilters: "volume" as unknown as undefined,
      storageSystem: undefined,
      metricName: "purefa_volume_space_bytes",
    });
    expect(attributes).toEqual({ kept: "yes" });
  });
});

describe("whatever a step holds (seeded)", () => {
  const ALPHABET: Array<string> = ["a", "b", "-", "1", "_", "Z", ".", "x"];

  const textOf: (random: SeededRandom) => string = (
    random: SeededRandom,
  ): string => {
    let text: string = "";
    const length: number = 1 + random(8);
    for (let index: number = 0; index < length; index++) {
      text += ALPHABET[random(ALPHABET.length)];
    }
    return text;
  };

  test("every query keeps its own filters unless the monitor names the same attribute, and nothing is changed in place", () => {
    const random: SeededRandom = seededRandom(5759);

    for (let round: number = 0; round < 400; round++) {
      const monitorType: MonitorType = MonitorStepMetricQueries.getMonitorTypes()[
        random(MonitorStepMetricQueries.getMonitorTypes().length)
      ]!;
      const stepKey: string = MonitorStepMetricQueries.getStepKey(monitorType)!;

      const ownAttributes: JSONObject = {};
      const ownCount: number = random(4);
      for (let index: number = 0; index < ownCount; index++) {
        ownAttributes[`own.${textOf(random)}`] = textOf(random);
      }

      const settings: JSONObject = {
        hostIdentifier: textOf(random),
        clusterIdentifier: textOf(random),
        cloudIdentifier: textOf(random),
        vcenterIdentifier: textOf(random),
        arrayIdentifier: textOf(random),
        fleetIdentifier: textOf(random),
      };

      const step: MonitorStep = stepOf({
        stepKey,
        settings,
        queryConfigs: [queryOf({ attributes: ownAttributes })],
      });
      const before: string = JSON.stringify(step.data);

      const reads: MonitorStepMetricReads = MonitorStepMetricQueries.getReads({
        monitorType,
        monitorStep: step,
      })!;

      const attributes: Dictionary<unknown> =
        (reads.queryConfigs[0]!.metricQueryData.filterData
          .attributes as unknown as Dictionary<unknown>) || {};

      for (const key of Object.keys(ownAttributes)) {
        expect(attributes[key]).toBe(ownAttributes[key]);
      }

      // Every non-Metrics type names the resource it watches.
      if (monitorType !== MonitorType.Metrics) {
        expect(Object.keys(attributes).length).toBeGreaterThan(
          Object.keys(ownAttributes).length,
        );
      }

      expect(JSON.stringify(step.data)).toBe(before);
    }
  });
});
