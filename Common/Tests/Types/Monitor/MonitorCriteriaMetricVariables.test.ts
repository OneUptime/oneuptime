import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import { CheckOn, CriteriaFilter } from "../../../Types/Monitor/CriteriaFilter";
import { getAllCephAlertTemplates } from "../../../Types/Monitor/CephAlertTemplates";
import { getAllDockerAlertTemplates } from "../../../Types/Monitor/DockerAlertTemplates";
import { getAllDockerSwarmAlertTemplates } from "../../../Types/Monitor/DockerSwarmAlertTemplates";
import {
  buildHostMonitorConfig,
  getAllHostAlertTemplates,
} from "../../../Types/Monitor/HostAlertTemplates";
import { getAllIoTAlertTemplates } from "../../../Types/Monitor/IotAlertTemplates";
import { getAllKubernetesAlertTemplates } from "../../../Types/Monitor/KubernetesAlertTemplates";
import { getAllPodmanAlertTemplates } from "../../../Types/Monitor/PodmanAlertTemplates";
import { getAllProxmoxAlertTemplates } from "../../../Types/Monitor/ProxmoxAlertTemplates";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep, {
  MonitorStepType,
} from "../../../Types/Monitor/MonitorStep";
import MonitorStepHostMonitor from "../../../Types/Monitor/MonitorStepHostMonitor";
import MonitorStepMetricViewConfigUtil from "../../../Types/Monitor/MonitorStepMetricViewConfigUtil";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import ObjectID from "../../../Types/ObjectID";

/*
 * End-to-end regression guard for the blank "METRIC" dropdown (Issues 1 & 2).
 *
 * For EVERY metric-shaped monitor type, a Quick Setup alert template must
 * produce a monitor step whose metric variables are discoverable through
 * MonitorStepMetricViewConfigUtil — the same resolver the criteria UI uses to
 * fill the "Which metric query should this alert rule check?" dropdown. And
 * every MetricValue criteria the template emits must reference a variable that
 * the dropdown actually offers, otherwise the alert rule points at a metric the
 * user can never (re)select.
 *
 * Before the fix, Host / Podman / DockerSwarm / IoT would all fail the
 * "surfaces at least one metric variable" assertion because the criteria UI
 * never read their metricViewConfig.
 */

// Superset of every template's Args — excess fields are ignored per type.
interface UniversalTemplateArgs {
  hostIdentifier: string;
  clusterIdentifier: string;
  fleetIdentifier: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
}

interface AnyAlertTemplate {
  id: string;
  name: string;
  getMonitorStep: (args: UniversalTemplateArgs) => MonitorStep;
}

interface ResourceDescriptor {
  name: string;
  subConfigKey: keyof MonitorStepType;
  templates: Array<AnyAlertTemplate>;
}

function buildArgs(): UniversalTemplateArgs {
  return {
    hostIdentifier: "host-identifier-1",
    clusterIdentifier: "cluster-identifier-1",
    fleetIdentifier: "fleet-identifier-1",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Test Monitor",
  };
}

const RESOURCES: Array<ResourceDescriptor> = [
  {
    name: "Host",
    subConfigKey: "hostMonitor",
    templates: getAllHostAlertTemplates() as unknown as Array<AnyAlertTemplate>,
  },
  {
    name: "Kubernetes",
    subConfigKey: "kubernetesMonitor",
    templates:
      getAllKubernetesAlertTemplates() as unknown as Array<AnyAlertTemplate>,
  },
  {
    name: "Docker",
    subConfigKey: "dockerMonitor",
    templates:
      getAllDockerAlertTemplates() as unknown as Array<AnyAlertTemplate>,
  },
  {
    name: "DockerSwarm",
    subConfigKey: "dockerSwarmMonitor",
    templates:
      getAllDockerSwarmAlertTemplates() as unknown as Array<AnyAlertTemplate>,
  },
  {
    name: "Podman",
    subConfigKey: "podmanMonitor",
    templates:
      getAllPodmanAlertTemplates() as unknown as Array<AnyAlertTemplate>,
  },
  {
    name: "Proxmox",
    subConfigKey: "proxmoxMonitor",
    templates:
      getAllProxmoxAlertTemplates() as unknown as Array<AnyAlertTemplate>,
  },
  {
    name: "Ceph",
    subConfigKey: "cephMonitor",
    templates: getAllCephAlertTemplates() as unknown as Array<AnyAlertTemplate>,
  },
  {
    name: "IoT",
    subConfigKey: "iotMonitor",
    templates: getAllIoTAlertTemplates() as unknown as Array<AnyAlertTemplate>,
  },
];

function getCriteriaInstances(
  step: MonitorStep,
): Array<MonitorCriteriaInstance> {
  return step.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || [];
}

describe("Monitor criteria metric-variable resolution (all resource types)", () => {
  test("every resource type exposes at least one alert template", () => {
    for (const resource of RESOURCES) {
      expect(resource.templates.length).toBeGreaterThan(0);
    }
  });

  describe.each(RESOURCES)(
    "$name alert templates",
    (resource: ResourceDescriptor) => {
      test("the resolver reads this resource's metricViewConfig", () => {
        const step: MonitorStep =
          resource.templates[0]!.getMonitorStep(buildArgs());

        const stepRecord: Record<
          string,
          { metricViewConfig?: unknown } | undefined
        > = step.data as unknown as Record<
          string,
          { metricViewConfig?: unknown } | undefined
        >;

        const expectedConfig: unknown =
          stepRecord[resource.subConfigKey as string]?.metricViewConfig;

        expect(expectedConfig).toBeDefined();
        expect(
          MonitorStepMetricViewConfigUtil.getMetricViewConfig(step.data),
        ).toBe(expectedConfig);
      });

      test.each(
        resource.templates.map(
          (t: AnyAlertTemplate): [string, AnyAlertTemplate] => {
            return [t.id, t];
          },
        ),
      )(
        "%s surfaces metric variables and resolves its criteria aliases",
        (_id: string, template: AnyAlertTemplate) => {
          const step: MonitorStep = template.getMonitorStep(buildArgs());

          // 1. The dropdown would offer at least one option (the actual bug).
          const variables: Array<string> =
            MonitorStepMetricViewConfigUtil.getMetricVariables(step.data);
          expect(variables.length).toBeGreaterThan(0);
          // No blank options leak through.
          expect(variables).not.toContain("");

          // 2. Every MetricValue criteria references an offered variable.
          const referencedAliases: Set<string> = new Set<string>();
          for (const instance of getCriteriaInstances(step)) {
            for (const filter of (instance.data?.filters ||
              []) as Array<CriteriaFilter>) {
              if (
                filter.checkOn === CheckOn.MetricValue &&
                filter.metricMonitorOptions?.metricAlias
              ) {
                referencedAliases.add(filter.metricMonitorOptions.metricAlias);
              }
            }
          }

          // These templates must produce at least one metric criteria.
          expect(referencedAliases.size).toBeGreaterThan(0);

          for (const alias of referencedAliases) {
            expect(variables).toContain(alias);
          }
        },
      );
    },
  );
});

describe("Custom Metric flow (buildHostMonitorConfig)", () => {
  test("a long descriptive alias is surfaced by the resolver", () => {
    const config: MonitorStepHostMonitor = buildHostMonitorConfig({
      hostIdentifier: "host-1",
      metricName: "process.cpu.utilization",
      metricAlias: "process_cpu_utilization",
      rollingTime: RollingTime.Past5Minutes,
      aggregationType: MetricsAggregationType.Max,
    });

    const stepData: MonitorStepType = {
      hostMonitor: config,
    } as unknown as MonitorStepType;

    expect(
      MonitorStepMetricViewConfigUtil.getMetricVariables(stepData),
    ).toEqual(["process_cpu_utilization"]);

    // The alias also lands on the query config so the criteria join key holds.
    expect(
      config.metricViewConfig.queryConfigs[0]?.metricAliasData?.metricVariable,
    ).toBe("process_cpu_utilization");
  });
});
