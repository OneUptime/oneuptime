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
import RollingTime from "../../../Types/RollingTime/RollingTime";

/*
 * The infrastructure MonitorStep utils share one shape: getDefault() returns
 * an empty-scope config on a Past1Minute rolling window with an empty metric
 * view config, and fromJSON/toJSON are structural pass-throughs. This suite
 * locks in that contract for each of them so a future refactor cannot quietly
 * change a default or drop a field on the wire.
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
