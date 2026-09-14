import { JSONObject } from "../../../Types/JSON";
import MonitorStepCephMonitor, {
  CephResourceScope,
  MonitorStepCephMonitorUtil,
} from "../../../Types/Monitor/MonitorStepCephMonitor";
import MonitorStepDockerMonitor, {
  MonitorStepDockerMonitorUtil,
} from "../../../Types/Monitor/MonitorStepDockerMonitor";
import MonitorStepDockerSwarmMonitor, {
  MonitorStepDockerSwarmMonitorUtil,
} from "../../../Types/Monitor/MonitorStepDockerSwarmMonitor";
import MonitorStepHostMonitor, {
  MonitorStepHostMonitorUtil,
} from "../../../Types/Monitor/MonitorStepHostMonitor";
import MonitorStepIoTMonitor, {
  IoTResourceScope,
  MonitorStepIoTMonitorUtil,
} from "../../../Types/Monitor/MonitorStepIoTMonitor";
import MonitorStepKubernetesMonitor, {
  KubernetesResourceScope,
  MonitorStepKubernetesMonitorUtil,
} from "../../../Types/Monitor/MonitorStepKubernetesMonitor";
import MonitorStepMetricMonitor, {
  MonitorStepMetricMonitorUtil,
} from "../../../Types/Monitor/MonitorStepMetricMonitor";
import MonitorStepPodmanMonitor, {
  MonitorStepPodmanMonitorUtil,
} from "../../../Types/Monitor/MonitorStepPodmanMonitor";
import MonitorStepProxmoxMonitor, {
  MonitorStepProxmoxMonitorUtil,
  ProxmoxResourceScope,
} from "../../../Types/Monitor/MonitorStepProxmoxMonitor";
import MonitorStepVMwareMonitor, {
  MonitorStepVMwareMonitorUtil,
  VMwareResourceKind,
  VMwareResourceScope,
} from "../../../Types/Monitor/MonitorStepVMwareMonitor";
import RollingTime from "../../../Types/RollingTime/RollingTime";

/*
 * The infrastructure MonitorStep utils share one shape: getDefault() returns
 * an empty-scope config on a Past1Minute rolling window with an empty metric
 * view config, and fromJSON/toJSON are structural pass-throughs. This suite
 * locks in that contract for each of them so a future refactor cannot quietly
 * change a default or drop a field on the wire.
 *
 * VMware is the one deliberate exception to the 1-minute window: its agent
 * collects every 2 minutes (VCENTER_COLLECTION_INTERVAL), so it defaults to
 * Past5Minutes — see the VMware block below.
 */

describe("Infrastructure MonitorStep utils", () => {
  describe("MonitorStepMetricMonitorUtil", () => {
    test("getDefault has an empty metric view config on a 1-minute window", () => {
      const def: MonitorStepMetricMonitor =
        MonitorStepMetricMonitorUtil.getDefault();

      expect(def.metricViewConfig).toEqual({
        queryConfigs: [],
        formulaConfigs: [],
      });
      expect(def.rollingTime).toBe(RollingTime.Past1Minute);
    });

    test("fromJSON/toJSON are pass-through and round-trip", () => {
      const monitor: MonitorStepMetricMonitor = {
        metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
        rollingTime: RollingTime.Past1Minute,
      };
      const json: JSONObject = MonitorStepMetricMonitorUtil.toJSON(monitor);
      expect(MonitorStepMetricMonitorUtil.fromJSON(json)).toEqual(monitor);
    });
  });

  describe("MonitorStepHostMonitorUtil", () => {
    test("getDefault has an empty host identifier", () => {
      const def: MonitorStepHostMonitor =
        MonitorStepHostMonitorUtil.getDefault();

      expect(def.hostIdentifier).toBe("");
      expect(def.rollingTime).toBe(RollingTime.Past1Minute);
    });

    test("round-trips through JSON", () => {
      const monitor: MonitorStepHostMonitor = {
        hostIdentifier: "web-1",
        metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
        rollingTime: RollingTime.Past1Minute,
      };
      expect(
        MonitorStepHostMonitorUtil.fromJSON(
          MonitorStepHostMonitorUtil.toJSON(monitor),
        ),
      ).toEqual(monitor);
    });
  });

  describe("MonitorStepDockerMonitorUtil", () => {
    test("getDefault has empty container filters", () => {
      const def: MonitorStepDockerMonitor =
        MonitorStepDockerMonitorUtil.getDefault();

      expect(def.hostIdentifier).toBe("");
      expect(def.containerFilters).toEqual({});
      expect(def.rollingTime).toBe(RollingTime.Past1Minute);
    });

    test("round-trips container filters", () => {
      const monitor: MonitorStepDockerMonitor = {
        hostIdentifier: "docker-host",
        containerFilters: { containerName: "api", containerImage: "nginx" },
        metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
        rollingTime: RollingTime.Past1Minute,
      };
      expect(
        MonitorStepDockerMonitorUtil.fromJSON(
          MonitorStepDockerMonitorUtil.toJSON(monitor),
        ),
      ).toEqual(monitor);
    });
  });

  describe("MonitorStepPodmanMonitorUtil", () => {
    test("getDefault has empty container filters", () => {
      const def: MonitorStepPodmanMonitor =
        MonitorStepPodmanMonitorUtil.getDefault();

      expect(def.hostIdentifier).toBe("");
      expect(def.containerFilters).toEqual({});
      expect(def.rollingTime).toBe(RollingTime.Past1Minute);
    });

    test("round-trips container filters", () => {
      const monitor: MonitorStepPodmanMonitor = {
        hostIdentifier: "podman-host",
        containerFilters: { hostName: "node-1" },
        metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
        rollingTime: RollingTime.Past1Minute,
      };
      expect(
        MonitorStepPodmanMonitorUtil.fromJSON(
          MonitorStepPodmanMonitorUtil.toJSON(monitor),
        ),
      ).toEqual(monitor);
    });
  });

  describe("MonitorStepKubernetesMonitorUtil", () => {
    test("getDefault scopes to the whole cluster", () => {
      const def: MonitorStepKubernetesMonitor =
        MonitorStepKubernetesMonitorUtil.getDefault();

      expect(def.clusterIdentifier).toBe("");
      expect(def.resourceScope).toBe(KubernetesResourceScope.Cluster);
      expect(def.resourceFilters).toEqual({});
    });

    test("round-trips a namespace-scoped monitor", () => {
      const monitor: MonitorStepKubernetesMonitor = {
        clusterIdentifier: "prod",
        resourceScope: KubernetesResourceScope.Namespace,
        resourceFilters: { namespace: "payments" },
        metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
        rollingTime: RollingTime.Past1Minute,
      };
      expect(
        MonitorStepKubernetesMonitorUtil.fromJSON(
          MonitorStepKubernetesMonitorUtil.toJSON(monitor),
        ),
      ).toEqual(monitor);
    });
  });

  describe("MonitorStepCephMonitorUtil", () => {
    test("getDefault has no OSD/pool filters", () => {
      const def: MonitorStepCephMonitor =
        MonitorStepCephMonitorUtil.getDefault();

      expect(def.clusterIdentifier).toBe("");
      expect(def.resourceFilters).toEqual({});
    });

    test("round-trips an OSD-scoped monitor", () => {
      const monitor: MonitorStepCephMonitor = {
        clusterIdentifier: "ceph-1",
        resourceFilters: { osdId: "osd.3", poolId: "2" },
        metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
        rollingTime: RollingTime.Past1Minute,
      };
      expect(
        MonitorStepCephMonitorUtil.fromJSON(
          MonitorStepCephMonitorUtil.toJSON(monitor),
        ),
      ).toEqual(monitor);
      // Scope enum sanity.
      expect(CephResourceScope.Osd).toBe("OSD");
    });
  });

  describe("MonitorStepProxmoxMonitorUtil", () => {
    test("getDefault has no resource filters", () => {
      const def: MonitorStepProxmoxMonitor =
        MonitorStepProxmoxMonitorUtil.getDefault();

      expect(def.clusterIdentifier).toBe("");
      expect(def.resourceFilters).toEqual({});
    });

    test("round-trips a guest-scoped monitor", () => {
      const monitor: MonitorStepProxmoxMonitor = {
        clusterIdentifier: "pve-cluster",
        resourceFilters: {
          scope: ProxmoxResourceScope.Guest,
          guestId: "qemu/100",
        },
        metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
        rollingTime: RollingTime.Past1Minute,
      };
      expect(
        MonitorStepProxmoxMonitorUtil.fromJSON(
          MonitorStepProxmoxMonitorUtil.toJSON(monitor),
        ),
      ).toEqual(monitor);
    });
  });

  describe("MonitorStepVMwareMonitorUtil", () => {
    test("getDefault has no resource filters", () => {
      const def: MonitorStepVMwareMonitor =
        MonitorStepVMwareMonitorUtil.getDefault();

      expect(def.vcenterIdentifier).toBe("");
      expect(def.resourceFilters).toEqual({});
    });

    test("getDefault evaluates over a 5-minute window, not the 1-minute one", () => {
      /*
       * The VMware Agent's default VCENTER_COLLECTION_INTERVAL is 2 minutes
       * and the vcenter receiver emits one sample per object per
       * collection, so a 1-minute window (the Proxmox / Kubernetes default,
       * whose agents scrape every 30 s) would be empty on roughly every
       * other evaluation and a hand-built monitor would flap between "no
       * criteria met" and firing. The default must cover at least two
       * collections.
       */
      const def: MonitorStepVMwareMonitor =
        MonitorStepVMwareMonitorUtil.getDefault();

      expect(def.rollingTime).toBe(RollingTime.Past5Minutes);
      expect(def.rollingTime).not.toBe(RollingTime.Past1Minute);
    });

    test("round-trips a VM-scoped monitor", () => {
      const monitor: MonitorStepVMwareMonitor = {
        vcenterIdentifier: "vcsa-prod",
        resourceFilters: {
          datacenterName: "DC1",
          clusterName: "Compute-A",
          hostName: "esx01.example.com",
          vmName: "web-01",
        },
        metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
        rollingTime: RollingTime.Past1Minute,
      };
      expect(
        MonitorStepVMwareMonitorUtil.fromJSON(
          MonitorStepVMwareMonitorUtil.toJSON(monitor),
        ),
      ).toEqual(monitor);
    });

    test("round-trips a resource-pool-scoped monitor by inventory path", () => {
      const monitor: MonitorStepVMwareMonitor = {
        vcenterIdentifier: "vcsa-prod",
        resourceFilters: {
          resourcePoolPath: "/DC1/host/Compute-A/Resources/prod",
          datastoreName: "vsanDatastore",
        },
        metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
        rollingTime: RollingTime.Past5Minutes,
      };
      expect(
        MonitorStepVMwareMonitorUtil.fromJSON(
          MonitorStepVMwareMonitorUtil.toJSON(monitor),
        ),
      ).toEqual(monitor);
    });

    test("scope and kind enums carry the spec'd literal values", () => {
      /*
       * The scope values are what the picker and the worker key on; the
       * kind values are the literal strings stored in VMwareResource.kind
       * and read back by the ingest scan and the dashboard.
       */
      expect(Object.values(VMwareResourceScope)).toEqual([
        "vcenter",
        "datacenter",
        "cluster",
        "host",
        "vm",
        "datastore",
        "resource_pool",
      ]);
      expect(Object.values(VMwareResourceKind)).toEqual([
        "Datacenter",
        "Cluster",
        "Host",
        "VirtualMachine",
        "Datastore",
        "ResourcePool",
      ]);
    });
  });

  describe("MonitorStepDockerSwarmMonitorUtil", () => {
    test("getDefault has no resource filters", () => {
      const def: MonitorStepDockerSwarmMonitor =
        MonitorStepDockerSwarmMonitorUtil.getDefault();

      expect(def.clusterIdentifier).toBe("");
      expect(def.resourceFilters).toEqual({});
    });

    test("round-trips a service-scoped monitor", () => {
      const monitor: MonitorStepDockerSwarmMonitor = {
        clusterIdentifier: "swarm-1",
        resourceFilters: { serviceName: "web", nodeName: "node-2" },
        metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
        rollingTime: RollingTime.Past1Minute,
      };
      expect(
        MonitorStepDockerSwarmMonitorUtil.fromJSON(
          MonitorStepDockerSwarmMonitorUtil.toJSON(monitor),
        ),
      ).toEqual(monitor);
    });
  });

  describe("MonitorStepIoTMonitorUtil", () => {
    test("getDefault scopes to the whole fleet", () => {
      const def: MonitorStepIoTMonitor = MonitorStepIoTMonitorUtil.getDefault();

      expect(def.fleetIdentifier).toBe("");
      expect(def.resourceFilters).toEqual({});
    });

    test("round-trips a device-scoped monitor", () => {
      const monitor: MonitorStepIoTMonitor = {
        fleetIdentifier: "fleet-1",
        resourceFilters: {
          scope: IoTResourceScope.Device,
          deviceId: "sensor-42",
          deviceType: "temperature",
        },
        metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
        rollingTime: RollingTime.Past1Minute,
      };
      expect(
        MonitorStepIoTMonitorUtil.fromJSON(
          MonitorStepIoTMonitorUtil.toJSON(monitor),
        ),
      ).toEqual(monitor);
    });
  });
});
