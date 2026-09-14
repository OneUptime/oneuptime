import MonitorStepCephMonitor, {
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
import MonitorStepPodmanMonitor, {
  MonitorStepPodmanMonitorUtil,
} from "../../../Types/Monitor/MonitorStepPodmanMonitor";
import MonitorStepProxmoxMonitor, {
  MonitorStepProxmoxMonitorUtil,
} from "../../../Types/Monitor/MonitorStepProxmoxMonitor";
import MonitorStepVMwareMonitor, {
  MonitorStepVMwareMonitorUtil,
} from "../../../Types/Monitor/MonitorStepVMwareMonitor";
import { JSONObject } from "../../../Types/JSON";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import { describe, expect, it } from "@jest/globals";

/*
 * The infrastructure monitor-step types (Host, Docker, Podman, Kubernetes,
 * Ceph, IoT, Docker Swarm, Proxmox, VMware) each ship a small `*Util` class with
 * getDefault / fromJSON / toJSON. getDefault seeds the monitor-step editor
 * when a user first picks that monitor type, so two things it does are
 * load-bearing and neither is obvious from the (near-identity) code:
 *
 *   1. THE DEFAULT ROLLING WINDOW. Every infra step whose agent scrapes
 *      every 30 s defaults to RollingTime.Past1Minute. VMware is the one
 *      exception: its agent polls vCenter every 2 minutes
 *      (VCENTER_COLLECTION_INTERVAL) and emits one sample per object per
 *      collection, so it defaults to Past5Minutes — a 1-minute window
 *      would be empty every other evaluation and flap. That value is what
 *      a freshly created metric monitor evaluates over until the user
 *      changes it; a silent change to it would change the meaning of every
 *      new monitor. Pinned per type so a copy-paste edit in one file is
 *      caught in either direction.
 *
 *   2. getDefault RETURNS A FRESH OBJECT GRAPH. The editor mutates the
 *      returned object (typing an identifier, adding a filter). If
 *      getDefault handed back a shared reference — or a shared nested
 *      metricViewConfig — one monitor's edits would bleed into the next
 *      default. Each call must yield independent objects all the way down.
 */

interface InfraMonitorUtil<T> {
  getDefault: () => T;
  fromJSON: (json: JSONObject) => T;
  toJSON: (monitor: T) => JSONObject;
}

interface InfraCase {
  name: string;
  // The util under test. Typed loosely so the table can hold every variant.
  util: InfraMonitorUtil<any>;
  // The empty-string identifier field each default carries.
  identifierField: string;
  // The rolling window getDefault seeds — see note 1 in the header.
  defaultRollingTime: RollingTime;
}

const CASES: Array<InfraCase> = [
  {
    name: "Host",
    util: MonitorStepHostMonitorUtil as InfraMonitorUtil<MonitorStepHostMonitor>,
    identifierField: "hostIdentifier",
    defaultRollingTime: RollingTime.Past1Minute,
  },
  {
    name: "Docker",
    util: MonitorStepDockerMonitorUtil as InfraMonitorUtil<MonitorStepDockerMonitor>,
    identifierField: "hostIdentifier",
    defaultRollingTime: RollingTime.Past1Minute,
  },
  {
    name: "Podman",
    util: MonitorStepPodmanMonitorUtil as InfraMonitorUtil<MonitorStepPodmanMonitor>,
    identifierField: "hostIdentifier",
    defaultRollingTime: RollingTime.Past1Minute,
  },
  {
    name: "Kubernetes",
    util: MonitorStepKubernetesMonitorUtil as InfraMonitorUtil<MonitorStepKubernetesMonitor>,
    identifierField: "clusterIdentifier",
    defaultRollingTime: RollingTime.Past1Minute,
  },
  {
    name: "Ceph",
    util: MonitorStepCephMonitorUtil as InfraMonitorUtil<MonitorStepCephMonitor>,
    identifierField: "clusterIdentifier",
    defaultRollingTime: RollingTime.Past1Minute,
  },
  {
    name: "IoT",
    util: MonitorStepIoTMonitorUtil as InfraMonitorUtil<MonitorStepIoTMonitor>,
    identifierField: "fleetIdentifier",
    defaultRollingTime: RollingTime.Past1Minute,
  },
  {
    name: "DockerSwarm",
    util: MonitorStepDockerSwarmMonitorUtil as InfraMonitorUtil<MonitorStepDockerSwarmMonitor>,
    identifierField: "clusterIdentifier",
    defaultRollingTime: RollingTime.Past1Minute,
  },
  {
    name: "Proxmox",
    util: MonitorStepProxmoxMonitorUtil as InfraMonitorUtil<MonitorStepProxmoxMonitor>,
    identifierField: "clusterIdentifier",
    defaultRollingTime: RollingTime.Past1Minute,
  },
  {
    name: "VMware",
    util: MonitorStepVMwareMonitorUtil as InfraMonitorUtil<MonitorStepVMwareMonitor>,
    identifierField: "vcenterIdentifier",
    defaultRollingTime: RollingTime.Past5Minutes,
  },
];

describe("Infrastructure monitor-step getDefault contract", () => {
  for (const testCase of CASES) {
    describe(`MonitorStep${testCase.name}MonitorUtil`, () => {
      it(`defaults the rolling window to ${testCase.defaultRollingTime}`, () => {
        const def: Record<string, unknown> = testCase.util.getDefault();
        expect(def["rollingTime"]).toBe(testCase.defaultRollingTime);
      });

      it("defaults the identifier to an empty string", () => {
        const def: Record<string, unknown> = testCase.util.getDefault();
        expect(def[testCase.identifierField]).toBe("");
      });

      it("defaults to an empty metric view config", () => {
        const def: Record<string, any> = testCase.util.getDefault();
        expect(def["metricViewConfig"]).toEqual({
          queryConfigs: [],
          formulaConfigs: [],
        });
      });

      it("returns a fresh object graph on every call", () => {
        const first: Record<string, any> = testCase.util.getDefault();
        const second: Record<string, any> = testCase.util.getDefault();

        // Distinct top-level objects.
        expect(first).not.toBe(second);
        // Distinct nested metricViewConfig, so mutating one is isolated.
        expect(first["metricViewConfig"]).not.toBe(second["metricViewConfig"]);

        // Mutating the first default must not touch a later default.
        first["metricViewConfig"].queryConfigs.push({ any: "thing" });
        first[testCase.identifierField] = "edited";

        const third: Record<string, any> = testCase.util.getDefault();
        expect(third["metricViewConfig"].queryConfigs).toEqual([]);
        expect(third[testCase.identifierField]).toBe("");
      });
    });
  }
});

describe("Infrastructure monitor-step default rolling window", () => {
  it("only VMware departs from the 1-minute window, and only upward", () => {
    /*
     * Guards the table itself: a new product copy-pasted from VMware must
     * not inherit the 5-minute window without the 2-minute-collection
     * justification, and VMware must never slide back to 1 minute.
     */
    for (const testCase of CASES) {
      if (testCase.name === "VMware") {
        expect(testCase.defaultRollingTime).toBe(RollingTime.Past5Minutes);
      } else {
        expect(testCase.defaultRollingTime).toBe(RollingTime.Past1Minute);
      }
    }

    expect(MonitorStepVMwareMonitorUtil.getDefault().rollingTime).toBe(
      RollingTime.Past5Minutes,
    );
  });
});

describe("Infrastructure monitor-step JSON round-trip", () => {
  for (const testCase of CASES) {
    it(`MonitorStep${testCase.name}MonitorUtil round-trips getDefault through to/fromJSON`, () => {
      const def: any = testCase.util.getDefault();

      const json: JSONObject = testCase.util.toJSON(def);
      const restored: any = testCase.util.fromJSON(json);

      // The value survives a serialize/deserialize cycle unchanged.
      expect(restored).toEqual(def);
    });

    it(`MonitorStep${testCase.name}MonitorUtil preserves a populated identifier + rolling window`, () => {
      const populated: Record<string, unknown> = {
        ...(testCase.util.getDefault() as Record<string, unknown>),
        [testCase.identifierField]: "prod-cluster-1",
        rollingTime: RollingTime.Past1Hour,
      };

      const restored: Record<string, unknown> = testCase.util.fromJSON(
        testCase.util.toJSON(populated),
      ) as Record<string, unknown>;

      expect(restored[testCase.identifierField]).toBe("prod-cluster-1");
      expect(restored["rollingTime"]).toBe(RollingTime.Past1Hour);
    });
  }
});

describe("Infrastructure monitor-step scope enums", () => {
  it("Kubernetes default scope is Cluster", () => {
    const def: MonitorStepKubernetesMonitor =
      MonitorStepKubernetesMonitorUtil.getDefault();
    expect(def.resourceScope).toBe(KubernetesResourceScope.Cluster);
  });

  it("IoT scope enum values match the agent-stamped attribute strings", () => {
    /*
     * These strings equal the `iot.scope` datapoint attribute, so a rename
     * here would silently break the worker's attribute-equality mapping.
     */
    expect(IoTResourceScope.Fleet).toBe("fleet");
    expect(IoTResourceScope.Device).toBe("device");
  });
});
