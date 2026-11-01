import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import AggregateModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricsViewConfig from "../../../Types/Metrics/MetricsViewConfig";
import {
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../Types/Monitor/CriteriaFilter";
import MetricMonitorResponse from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import MetricMonitorCriteria from "../../../Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import {
  getAllCephAlertTemplates,
  getCephDefaultAlertTemplateId,
} from "../../../Types/Monitor/CephAlertTemplates";
import { getCephMetricByMetricName } from "../../../Types/Monitor/CephMetricCatalog";
import {
  getAllDockerAlertTemplates,
  getDockerDefaultAlertTemplateId,
} from "../../../Types/Monitor/DockerAlertTemplates";
import { getDockerMetricByMetricName } from "../../../Types/Monitor/DockerMetricCatalog";
import {
  getAllDockerSwarmAlertTemplates,
  getDockerSwarmDefaultAlertTemplateId,
} from "../../../Types/Monitor/DockerSwarmAlertTemplates";
import { getDockerSwarmMetricByMetricName } from "../../../Types/Monitor/DockerSwarmMetricCatalog";
import {
  getAllHostAlertTemplates,
  getHostDefaultAlertTemplateId,
} from "../../../Types/Monitor/HostAlertTemplates";
import { getHostMetricByMetricName } from "../../../Types/Monitor/HostMetricCatalog";
import {
  getAllIoTAlertTemplates,
  getIoTDefaultAlertTemplateId,
} from "../../../Types/Monitor/IotAlertTemplates";
import {
  getAllKubernetesAlertTemplates,
  getKubernetesDefaultAlertTemplateId,
} from "../../../Types/Monitor/KubernetesAlertTemplates";
import { getKubernetesMetricByMetricName } from "../../../Types/Monitor/KubernetesMetricCatalog";
import {
  getAllPodmanAlertTemplates,
  getPodmanDefaultAlertTemplateId,
} from "../../../Types/Monitor/PodmanAlertTemplates";
import { getPodmanMetricByMetricName } from "../../../Types/Monitor/PodmanMetricCatalog";
import {
  getAllProxmoxAlertTemplates,
  getProxmoxDefaultAlertTemplateId,
} from "../../../Types/Monitor/ProxmoxAlertTemplates";
import { getProxmoxMetricByMetricName } from "../../../Types/Monitor/ProxmoxMetricCatalog";
import {
  StorageArrayAlertTemplate,
  getStorageArrayAlertTemplatesForSystem,
  getStorageArrayDefaultAlertTemplateId,
} from "../../../Types/Monitor/StorageArrayAlertTemplates";
import StorageSystem from "../../../Types/StorageArray/StorageSystem";
import {
  getAllVMwareAlertTemplates,
  getVMwareDefaultAlertTemplateId,
} from "../../../Types/Monitor/VMwareAlertTemplates";
import { getVMwareMetricByMetricName } from "../../../Types/Monitor/VMwareMetricCatalog";

/*
 * "<Resource> Stopped Reporting", one per infrastructure type, and the
 * template a NEW monitor of each type starts on.
 *
 * Every other template compares values, so when the agent stops sending
 * there is nothing to compare: neither its firing nor its recovery criteria
 * matches, and the monitor silently keeps its last status - a cluster whose
 * agent was uninstalled stays green forever. These templates fire on the
 * silence itself: a Count of a series the resource always sends while it
 * reports, ungrouped, compared `< 0` (unreachable for a count) with the
 * Trigger no-data policy, so ONLY an empty window fires; any data recovers.
 *
 * IoT has none of its own: Device Offline already reads a silent registered
 * device as down, so it is IoT's default.
 */

interface StoppedReportingCase {
  type: string;
  templateId: string;
  // What the type's picker lists, in order.
  templates: () => Array<{ id: string; category: string; severity: string }>;
  defaultTemplateId: () => string;
  heartbeatMetric: string;
  // The step field the type's config lives on.
  configField: keyof NonNullable<MonitorStep["data"]>;
  // Whether the type's own metric catalog offers the heartbeat metric.
  isCatalogMetric: (metricName: string) => boolean;
}

const STEP_ARGS: Record<string, unknown> = {
  hostIdentifier: "host-01",
  clusterIdentifier: "cluster-01",
  vcenterIdentifier: "vcenter-01",
  arrayIdentifier: "array-01",
  fleetIdentifier: "fleet-01",
  onlineMonitorStatusId: ObjectID.generate(),
  offlineMonitorStatusId: ObjectID.generate(),
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
  monitorName: "Stopped Reporting check",
};

const CASES: Array<StoppedReportingCase> = [
  {
    type: "Host",
    templateId: "host-stopped-reporting",
    templates: getAllHostAlertTemplates,
    defaultTemplateId: getHostDefaultAlertTemplateId,
    heartbeatMetric: "system.memory.usage",
    configField: "hostMonitor",
    isCatalogMetric: (metricName: string): boolean => {
      return Boolean(getHostMetricByMetricName(metricName));
    },
  },
  {
    type: "Kubernetes",
    templateId: "k8s-cluster-stopped-reporting",
    templates: getAllKubernetesAlertTemplates,
    defaultTemplateId: getKubernetesDefaultAlertTemplateId,
    heartbeatMetric: "k8s.node.condition_ready",
    configField: "kubernetesMonitor",
    isCatalogMetric: (metricName: string): boolean => {
      return Boolean(getKubernetesMetricByMetricName(metricName));
    },
  },
  {
    type: "Docker",
    templateId: "docker-host-stopped-reporting",
    templates: getAllDockerAlertTemplates,
    defaultTemplateId: getDockerDefaultAlertTemplateId,
    heartbeatMetric: "container.memory.percent",
    configField: "dockerMonitor",
    isCatalogMetric: (metricName: string): boolean => {
      return Boolean(getDockerMetricByMetricName(metricName));
    },
  },
  {
    type: "Podman",
    templateId: "podman-host-stopped-reporting",
    templates: getAllPodmanAlertTemplates,
    defaultTemplateId: getPodmanDefaultAlertTemplateId,
    heartbeatMetric: "container.memory.percent",
    configField: "podmanMonitor",
    isCatalogMetric: (metricName: string): boolean => {
      return Boolean(getPodmanMetricByMetricName(metricName));
    },
  },
  {
    type: "Docker Swarm",
    templateId: "docker-swarm-cluster-stopped-reporting",
    templates: getAllDockerSwarmAlertTemplates,
    defaultTemplateId: getDockerSwarmDefaultAlertTemplateId,
    heartbeatMetric: "container.memory.percent",
    configField: "dockerSwarmMonitor",
    isCatalogMetric: (metricName: string): boolean => {
      return Boolean(getDockerSwarmMetricByMetricName(metricName));
    },
  },
  {
    type: "Proxmox",
    templateId: "pve-cluster-stopped-reporting",
    templates: getAllProxmoxAlertTemplates,
    defaultTemplateId: getProxmoxDefaultAlertTemplateId,
    heartbeatMetric: "pve_up",
    configField: "proxmoxMonitor",
    isCatalogMetric: (metricName: string): boolean => {
      return Boolean(getProxmoxMetricByMetricName(metricName));
    },
  },
  {
    type: "VMware",
    templateId: "vmware-vcenter-stopped-reporting",
    templates: getAllVMwareAlertTemplates,
    defaultTemplateId: getVMwareDefaultAlertTemplateId,
    heartbeatMetric: "vcenter.datacenter.cpu.limit",
    configField: "vmwareMonitor",
    isCatalogMetric: (metricName: string): boolean => {
      return Boolean(getVMwareMetricByMetricName(metricName));
    },
  },
  {
    type: "Ceph",
    templateId: "ceph-cluster-stopped-reporting",
    templates: getAllCephAlertTemplates,
    defaultTemplateId: getCephDefaultAlertTemplateId,
    heartbeatMetric: "ceph_health_status",
    configField: "cephMonitor",
    isCatalogMetric: (metricName: string): boolean => {
      return Boolean(getCephMetricByMetricName(metricName));
    },
  },
  {
    type: "Storage Array (FlashArray)",
    templateId: "purefa-array-stopped-reporting",
    templates: (): Array<StorageArrayAlertTemplate> => {
      return getStorageArrayAlertTemplatesForSystem(
        StorageSystem.PureStorageFlashArray,
      );
    },
    defaultTemplateId: (): string => {
      return getStorageArrayDefaultAlertTemplateId(
        StorageSystem.PureStorageFlashArray,
      );
    },
    heartbeatMetric: "purefa_info",
    configField: "storageArrayMonitor",
    // The identity series is not a chartable catalog metric.
    isCatalogMetric: (): boolean => {
      return true;
    },
  },
  {
    type: "Storage Array (FlashBlade)",
    templateId: "purefb-array-stopped-reporting",
    templates: (): Array<StorageArrayAlertTemplate> => {
      return getStorageArrayAlertTemplatesForSystem(
        StorageSystem.PureStorageFlashBlade,
      );
    },
    defaultTemplateId: (): string => {
      return getStorageArrayDefaultAlertTemplateId(
        StorageSystem.PureStorageFlashBlade,
      );
    },
    heartbeatMetric: "purefb_info",
    configField: "storageArrayMonitor",
    isCatalogMetric: (): boolean => {
      return true;
    },
  },
];

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");

function buildStep(testCase: StoppedReportingCase): MonitorStep {
  const template: unknown = testCase
    .templates()
    .find((candidate: { id: string }): boolean => {
      return candidate.id === testCase.templateId;
    });

  expect(template).toBeDefined();

  return (
    template as { getMonitorStep: (args: unknown) => MonitorStep }
  ).getMonitorStep(STEP_ARGS);
}

function getViewConfig(
  testCase: StoppedReportingCase,
  step: MonitorStep,
): MetricsViewConfig {
  const config: { metricViewConfig: MetricsViewConfig; rollingTime: unknown } =
    (step.data as unknown as Record<string, unknown>)[
      testCase.configField as string
    ] as { metricViewConfig: MetricsViewConfig; rollingTime: unknown };

  expect(config).toBeDefined();

  return config.metricViewConfig;
}

function getInstances(step: MonitorStep): Array<MonitorCriteriaInstance> {
  return step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;
}

const WINDOW_END_MS: number = Date.UTC(2026, 9, 30, 12, 0, 0);
const WINDOW_MS: number = 10 * 60 * 1000;

/*
 * A response over the template's ten-minute window: `counts` holds one
 * per-minute Count per minute, ending at the window's end (oldest first).
 */
function buildResponse(
  viewConfig: MetricsViewConfig,
  counts: Array<number>,
): MetricMonitorResponse {
  const firstMinuteMs: number = WINDOW_END_MS - counts.length * 60 * 1000;

  return {
    projectId: ObjectID.generate(),
    metricViewConfig: viewConfig,
    monitorId: ObjectID.generate(),
    startAndEndDate: {
      startValue: new Date(WINDOW_END_MS - WINDOW_MS),
      endValue: new Date(WINDOW_END_MS),
    } as NonNullable<MetricMonitorResponse["startAndEndDate"]>,
    metricResult: viewConfig.queryConfigs.map(
      (_query: MetricQueryConfigData): AggregatedResult => {
        return {
          data: counts.map((count: number, index: number): AggregateModel => {
            return {
              timestamp: new Date(firstMinuteMs + index * 60 * 1000),
              value: count,
            } as AggregateModel;
          }),
        };
      },
    ),
  };
}

async function isMet(
  step: MonitorStep,
  instance: MonitorCriteriaInstance,
  response: MetricMonitorResponse,
): Promise<boolean> {
  const results: Array<boolean> = [];

  for (const filter of instance.data!.filters) {
    const rootCause: string | null =
      await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: response,
        // A copy: the evaluator writes its context back onto the filter.
        criteriaFilter: JSON.parse(JSON.stringify(filter)) as CriteriaFilter,
        monitorStep: step,
      });

    results.push(rootCause !== null);
  }

  return instance.data!.filterCondition === FilterCondition.All
    ? results.every((met: boolean): boolean => {
        return met;
      })
    : results.some((met: boolean): boolean => {
        return met;
      });
}

async function evaluate(
  testCase: StoppedReportingCase,
  counts: Array<number>,
): Promise<{ breached: boolean; healthy: boolean }> {
  const step: MonitorStep = buildStep(testCase);
  const response: MetricMonitorResponse = buildResponse(
    getViewConfig(testCase, step),
    counts,
  );
  const [offline, online] = getInstances(step);

  return {
    breached: await isMet(step, offline!, response),
    healthy: await isMet(step, online!, response),
  };
}

const TYPE_CASES: Array<[string, StoppedReportingCase]> = CASES.map(
  (testCase: StoppedReportingCase): [string, StoppedReportingCase] => {
    return [testCase.type, testCase];
  },
);

describe("Infrastructure Stopped Reporting templates", () => {
  test.each(TYPE_CASES)(
    "%s: a new monitor starts on its Stopped Reporting template, listed first",
    (_type: string, testCase: StoppedReportingCase) => {
      expect(testCase.defaultTemplateId()).toBe(testCase.templateId);

      const templates: Array<{
        id: string;
        category: string;
        severity: string;
      }> = testCase.templates();

      expect(templates[0]!.id).toBe(testCase.templateId);
      expect(templates[0]!.category).toBe("Availability");
      expect(templates[0]!.severity).toBe("Critical");
    },
  );

  test.each(TYPE_CASES)(
    "%s: counts its heartbeat over the whole resource for ten minutes",
    (_type: string, testCase: StoppedReportingCase) => {
      const step: MonitorStep = buildStep(testCase);
      const config: { rollingTime: RollingTime } = (
        step.data as unknown as Record<string, { rollingTime: RollingTime }>
      )[testCase.configField as string]!;
      const viewConfig: MetricsViewConfig = getViewConfig(testCase, step);

      expect(config.rollingTime).toBe(RollingTime.Past10Minutes);
      expect(viewConfig.queryConfigs).toHaveLength(1);
      expect(viewConfig.formulaConfigs || []).toHaveLength(0);

      const query: MetricQueryConfigData = viewConfig.queryConfigs[0]!;

      expect(query.metricQueryData.filterData.metricName).toBe(
        testCase.heartbeatMetric,
      );
      expect(query.metricQueryData.filterData.aggegationType).toBe(
        MetricsAggregationType.Count,
      );
      // No filter that could empty the window on a healthy resource.
      expect(query.metricQueryData.filterData.attributes).toEqual({});
      /*
       * Ungrouped: grouped, a resource that went silent would simply have
       * no series left, and nothing would be evaluated.
       */
      expect(MonitorStep.getGroupByAttributeKeys(step)).toEqual([]);
      expect(testCase.isCatalogMetric(testCase.heartbeatMetric)).toBe(true);
    },
  );

  test.each(TYPE_CASES)(
    "%s: fires only through the no-data policy, and recovers on any data",
    (_type: string, testCase: StoppedReportingCase) => {
      const [offline, online] = getInstances(buildStep(testCase));
      const fire: CriteriaFilter = offline!.data!.filters[0]!;
      const recover: CriteriaFilter = online!.data!.filters[0]!;

      expect(offline!.data!.filters).toHaveLength(1);
      expect(fire.filterType).toBe(FilterType.LessThan);
      expect(fire.value).toBe(0);
      expect(fire.metricMonitorOptions?.onNoDataPolicy).toBe(
        NoDataPolicy.Trigger,
      );
      expect(fire.metricMonitorOptions?.metricAggregationType).toBe(
        EvaluateOverTimeType.AllValues,
      );

      // The recovery keeps the default Ignore: a silent window matches neither.
      expect(recover.filterType).toBe(FilterType.GreaterThanOrEqualTo);
      expect(recover.value).toBe(0);
      expect(recover.metricMonitorOptions?.onNoDataPolicy).toBeUndefined();

      expect(offline!.data!.createIncidents).toBe(true);
      expect(offline!.data!.incidents[0]!.autoResolveIncident).toBe(true);
      expect(offline!.data!.alerts[0]!.autoResolveAlert).toBe(true);
    },
  );

  test.each(TYPE_CASES)(
    "%s: a silent window opens the incident",
    async (_type: string, testCase: StoppedReportingCase) => {
      expect(await evaluate(testCase, [])).toEqual({
        breached: true,
        healthy: false,
      });
    },
  );

  test.each(TYPE_CASES)(
    "%s: a resource that keeps reporting never fires, whatever it reports",
    async (_type: string, testCase: StoppedReportingCase) => {
      const random: SeededRandom = seededRandom(5407);

      for (let draw: number = 0; draw < 25; draw++) {
        // Ten per-minute counts of 1 to 12 rows: any amount of data at all.
        const counts: Array<number> = Array.from({ length: 10 }, (): number => {
          return 1 + random(12);
        });

        expect(await evaluate(testCase, counts)).toEqual({
          breached: false,
          healthy: true,
        });
      }
    },
  );

  test.each(TYPE_CASES)(
    "%s: data coming back resolves the incident at once, and the status once it covers the window",
    async (_type: string, testCase: StoppedReportingCase) => {
      /*
       * Two minutes of data after the silence: the firing criteria no longer
       * holds (so the incident, which auto-resolves on that, closes), while
       * the sustained recovery waits for the data to cover the window
       * before it calls the resource healthy again.
       */
      expect(await evaluate(testCase, [2, 2])).toEqual({
        breached: false,
        healthy: false,
      });
    },
  );

  test("IoT's default is Device Offline, which already reads a silent device as down", () => {
    expect(getIoTDefaultAlertTemplateId()).toBe("iot-device-offline");
    expect(
      getAllIoTAlertTemplates().map((template: { id: string }): string => {
        return template.id;
      }),
    ).toContain(getIoTDefaultAlertTemplateId());
  });

  test("a storage array whose platform is not known yet starts on the FlashArray heartbeat", () => {
    for (const system of [undefined, null, "", "netapp.ontap"]) {
      expect(getStorageArrayDefaultAlertTemplateId(system)).toBe(
        "purefa-array-stopped-reporting",
      );
    }
  });

  /*
   * The container heartbeats rely on docker_stats reporting the agent's OWN
   * container: docker_stats only reports running containers, and a host
   * with nothing else running must not look silent. That holds because each
   * agent runs as a named container and its config enables the heartbeat
   * metric. If either changes, these templates would page on idle hosts.
   */
  test.each([
    ["DockerAgent", "oneuptime-docker-agent"],
    ["PodmanAgent", "oneuptime-podman-agent"],
    ["DockerSwarmAgent", "oneuptime-docker-swarm-agent"],
  ])(
    "the %s runs as a container and reports container.memory.percent",
    (agent: string, containerName: string) => {
      const compose: string = fs.readFileSync(
        path.join(REPO_ROOT, "agents", agent, "docker-compose.yml"),
        "utf8",
      );
      const config: string = fs.readFileSync(
        path.join(REPO_ROOT, "agents", agent, "otel-collector-config.yaml"),
        "utf8",
      );

      expect(compose).toContain(`container_name: ${containerName}`);
      expect(config).toMatch(
        /\n\s+container\.memory\.percent:\n\s+enabled: true\n/,
      );
      // Nothing keeps the agent's own container out of the receiver.
      expect(config).not.toMatch(/excluded_images/);
    },
  );
});
