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
import MonitorStepOpenStackMonitor, {
  MonitorStepOpenStackMonitorUtil,
  OPENSTACK_CLOUD_RESOURCE_ATTRIBUTE,
  OPENSTACK_REGION_ATTRIBUTE,
  OpenStackResourceFilters,
  alignOpenStackSeriesLabels,
  getOpenStackFilterAttributes,
  getOpenStackGroupByKeysForMetric,
} from "../../../Types/Monitor/MonitorStepOpenStackMonitor";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
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
import MonitorStepStorageArrayMonitor, {
  MonitorStepStorageArrayMonitorUtil,
  StorageArrayResourceScope,
} from "../../../Types/Monitor/MonitorStepStorageArrayMonitor";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import StorageSystem from "../../../Types/StorageArray/StorageSystem";

/*
 * The infrastructure MonitorStep utils share one shape: getDefault() returns
 * an empty-scope config on a Past1Minute rolling window with an empty metric
 * view config, and fromJSON/toJSON are structural pass-throughs. This suite
 * locks in that contract for each of them so a future refactor cannot quietly
 * change a default or drop a field on the wire.
 *
 * VMware and Storage Array are the deliberate exceptions to the 1-minute
 * window: VMware's agent collects every 2 minutes
 * (VCENTER_COLLECTION_INTERVAL) and the Storage Array Agent reads volumes,
 * hosts and pods every 2 minutes, so both default to Past5Minutes — see
 * their blocks below.
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

  describe("MonitorStepStorageArrayMonitorUtil", () => {
    test("getDefault has no array, platform or object filters, on a 5-minute window", () => {
      const def: MonitorStepStorageArrayMonitor =
        MonitorStepStorageArrayMonitorUtil.getDefault();

      expect(def.arrayIdentifier).toBe("");
      expect(def.storageSystem).toBeUndefined();
      expect(def.resourceFilters).toEqual({});
      expect(def.metricViewConfig).toEqual({
        queryConfigs: [],
        formulaConfigs: [],
      });
      // Volumes, hosts and pods are read every 2 minutes.
      expect(def.rollingTime).toBe(RollingTime.Past5Minutes);
    });

    test("round-trips a FlashBlade file-system-scoped monitor with its platform", () => {
      const monitor: MonitorStepStorageArrayMonitor = {
        arrayIdentifier: "pure-fb-01",
        storageSystem: StorageSystem.PureStorageFlashBlade,
        resourceFilters: { fileSystemName: "home", componentName: "CH1.FB3" },
        metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
        rollingTime: RollingTime.Past5Minutes,
      };
      expect(
        MonitorStepStorageArrayMonitorUtil.fromJSON(
          MonitorStepStorageArrayMonitorUtil.toJSON(monitor),
        ),
      ).toEqual(monitor);
      // Scope enum sanity: the display value is spelled out.
      expect(StorageArrayResourceScope.FileSystem).toBe("File System");
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

  describe("MonitorStepOpenStackMonitorUtil", () => {
    test("getDefault has no resource filters", () => {
      const def: MonitorStepOpenStackMonitor =
        MonitorStepOpenStackMonitorUtil.getDefault();

      expect(def.cloudIdentifier).toBe("");
      expect(def.resourceFilters).toEqual({});
    });

    test("getDefault's window holds three of the agent's slowest collections", () => {
      /*
       * Identity and image are collected every 5 minutes, so a hand-built
       * monitor on anything shorter holds too few of them for "All Values".
       */
      expect(MonitorStepOpenStackMonitorUtil.getDefault().rollingTime).toBe(
        RollingTime.Past15Minutes,
      );
    });

    test("round-trips a monitor narrowed by every filter", () => {
      const monitor: MonitorStepOpenStackMonitor = {
        cloudIdentifier: "prod",
        resourceFilters: {
          regionName: "RegionOne",
          availabilityZone: "nova",
          hypervisorName: "compute-01.example.internal",
          serviceName: "nova-compute",
          projectId: "4f2d",
        },
        metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
        rollingTime: RollingTime.Past10Minutes,
      };
      expect(
        MonitorStepOpenStackMonitorUtil.fromJSON(
          MonitorStepOpenStackMonitorUtil.toJSON(monitor),
        ),
      ).toEqual(monitor);
    });

    test("reads through the attributes the agent stamps", () => {
      expect(OPENSTACK_CLOUD_RESOURCE_ATTRIBUTE).toBe(
        "resource.openstack.cloud.name",
      );
      expect(OPENSTACK_REGION_ATTRIBUTE).toBe("openstack.region.name");
    });

    describe("getOpenStackFilterAttributes", () => {
      test("no filter reads every series", () => {
        expect(
          getOpenStackFilterAttributes({
            resourceFilters: {},
            seriesLabels: ["hostname", "service", "zone"],
          }),
        ).toEqual({});
        expect(
          getOpenStackFilterAttributes({
            resourceFilters: undefined,
            seriesLabels: undefined,
          }),
        ).toEqual({});
      });

      test("the region applies to every series, whatever its labels", () => {
        expect(
          getOpenStackFilterAttributes({
            resourceFilters: { regionName: "RegionOne" },
            seriesLabels: [],
          }),
        ).toEqual({ "openstack.region.name": "RegionOne" });
      });

      test("each filter uses the spelling the series has", () => {
        const resourceFilters: {
          availabilityZone: string;
          hypervisorName: string;
          projectId: string;
        } = {
          availabilityZone: "nova",
          hypervisorName: "compute-01",
          projectId: "4f2d",
        };

        // A hypervisor's own series.
        expect(
          getOpenStackFilterAttributes({
            resourceFilters,
            seriesLabels: ["aggregates", "availability_zone", "hostname"],
          }),
        ).toEqual({ availability_zone: "nova", hostname: "compute-01" });

        // Nova's workers say `zone`, not `availability_zone`.
        expect(
          getOpenStackFilterAttributes({
            resourceFilters,
            seriesLabels: ["hostname", "service", "zone"],
          }),
        ).toEqual({ zone: "nova", hostname: "compute-01" });

        // An instance says which hypervisor it is on, and whose it is.
        expect(
          getOpenStackFilterAttributes({
            resourceFilters,
            seriesLabels: [
              "availability_zone",
              "hypervisor_hostname",
              "tenant_id",
            ],
          }),
        ).toEqual({
          availability_zone: "nova",
          hypervisor_hostname: "compute-01",
          tenant_id: "4f2d",
        });

        // A floating IP says project_id.
        expect(
          getOpenStackFilterAttributes({
            resourceFilters,
            seriesLabels: ["floating_ip_address", "project_id"],
          }),
        ).toEqual({ project_id: "4f2d" });
      });

      test("a filter that is not text, or is only spaces, is no filter", () => {
        // Step JSON is not schema-checked: the API or an import can write these.
        expect(
          getOpenStackFilterAttributes({
            resourceFilters: {
              regionName: "  ",
              availabilityZone: 7,
              hypervisorName: { name: "compute-01" },
              serviceName: "",
            } as unknown as OpenStackResourceFilters,
            seriesLabels: ["availability_zone", "hostname", "service"],
          }),
        ).toEqual({});
      });

      test("a filter is read without the spaces around it", () => {
        expect(
          getOpenStackFilterAttributes({
            resourceFilters: {
              regionName: " RegionOne ",
              serviceName: " nova-compute ",
            },
            seriesLabels: ["service"],
          }),
        ).toEqual({
          "openstack.region.name": "RegionOne",
          service: "nova-compute",
        });
      });

      test("a filter does not empty a series without its label", () => {
        expect(
          getOpenStackFilterAttributes({
            resourceFilters: { projectId: "4f2d", serviceName: "nova-compute" },
            seriesLabels: [],
          }),
        ).toEqual({});
      });

      test("a series the catalogue does not know takes each filter's first label", () => {
        expect(
          getOpenStackFilterAttributes({
            resourceFilters: {
              availabilityZone: "nova",
              hypervisorName: "compute-01",
              serviceName: "nova-compute",
              projectId: "4f2d",
            },
            seriesLabels: undefined,
          }),
        ).toEqual({
          availability_zone: "nova",
          hostname: "compute-01",
          service: "nova-compute",
          tenant_id: "4f2d",
        });
      });
    });

    describe("lining up series that name a label differently", () => {
      test("openstack_neutron_network is grouped by its own label", () => {
        expect(
          getOpenStackGroupByKeysForMetric({
            metricName: "openstack_neutron_network",
            groupByAttributeKeys: [
              "openstack.region.name",
              "network_id",
              "network_name",
            ],
          }),
        ).toEqual(["openstack.region.name", "id", "name"]);
      });

      test("any other series keeps the keys it was given", () => {
        const keys: Array<string> = ["network_id", "network_name"];

        expect(
          getOpenStackGroupByKeysForMetric({
            metricName: "openstack_neutron_network_ip_availabilities_used",
            groupByAttributeKeys: keys,
          }),
        ).toEqual(keys);
      });

      test("its rows then carry the common label, and keep their own", () => {
        const result: AggregatedResult = {
          data: [
            {
              timestamp: new Date(),
              value: 1,
              attributes: { id: "net-1", name: "public" },
            },
            // A row with no attributes at all is left alone.
            { timestamp: new Date(), value: 1 },
          ],
        } as unknown as AggregatedResult;

        const aligned: AggregatedResult = alignOpenStackSeriesLabels({
          metricName: "openstack_neutron_network",
          aggregatedResult: result,
        });

        expect(
          (aligned.data[0] as unknown as { attributes: unknown }).attributes,
        ).toEqual({
          id: "net-1",
          name: "public",
          network_id: "net-1",
          network_name: "public",
        });
        expect(
          (aligned.data[1] as unknown as { attributes?: unknown }).attributes,
        ).toBeUndefined();
      });

      test("any other series' rows are not touched", () => {
        const result: AggregatedResult = {
          data: [
            {
              timestamp: new Date(),
              value: 1,
              attributes: { network_id: "net-1" },
            },
          ],
        } as unknown as AggregatedResult;

        expect(
          (
            alignOpenStackSeriesLabels({
              metricName: "openstack_neutron_network_ip_availabilities_used",
              aggregatedResult: result,
            }).data[0] as unknown as { attributes: unknown }
          ).attributes,
        ).toEqual({ network_id: "net-1" });
      });
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
