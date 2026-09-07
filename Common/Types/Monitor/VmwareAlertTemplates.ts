import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import ObjectID from "../ObjectID";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorStepVmwareMonitor, {
  MonitorStepVmwareMonitorUtil,
  VmwareResourceType,
} from "./MonitorStepVmwareMonitor";
import {
  buildHealthyCriteriaInstance,
  buildUnhealthyCriteriaInstance,
  getRecoveryFilterType,
} from "./Recommendation/RecommendationCriteriaBuilder";
import {
  FilterType,
  EvaluateOverTimeType,
  NoDataPolicy,
} from "./CriteriaFilter";
import RollingTime from "../RollingTime/RollingTime";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";
import { VmwareMetricCategory } from "./VmwareMetricCatalog";

export type VmwareAlertTemplateCategory = VmwareMetricCategory;
export type VmwareAlertTemplateSeverity = "Critical" | "Warning";
export interface VmwareAlertTemplateArgs {
  sourceIdentifier: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
}
export interface VmwareAlertTemplate {
  id: string;
  name: string;
  description: string;
  category: VmwareAlertTemplateCategory;
  severity: VmwareAlertTemplateSeverity;
  getMonitorStep: (args: VmwareAlertTemplateArgs) => MonitorStep;
}

export function buildVmwareMonitorConfig(args: {
  sourceIdentifier: string;
  metricName: string;
  metricAlias: string;
  rollingTime: RollingTime;
  aggregationType: MetricsAggregationType;
  attributes?: Record<string, string> | undefined;
  legendUnit?: string | undefined;
  resourceType?: VmwareResourceType | undefined;
  resourceIdentifier?: string | undefined;
}): MonitorStepVmwareMonitor {
  const config: MonitorStepVmwareMonitor = {
    sourceIdentifier: args.sourceIdentifier,
    resourceFilters: {
      resourceType: args.resourceType,
      resourceIdentifier: args.resourceIdentifier,
    },
    rollingTime: args.rollingTime,
    metricViewConfig: {
      queryConfigs: [
        {
          metricAliasData: {
            metricVariable: args.metricAlias,
            title: args.metricAlias,
            description: args.metricAlias,
            legend: args.metricAlias,
            legendUnit: args.legendUnit,
          },
          metricQueryData: {
            filterData: {
              metricName: args.metricName,
              attributes: args.attributes || {},
              aggegationType: args.aggregationType,
              aggregateBy: {},
            },
          },
        },
      ],
      formulaConfigs: [],
    },
  };
  config.metricViewConfig =
    MonitorStepVmwareMonitorUtil.toMetricMonitor(config).metricViewConfig;
  return config;
}

interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  category: VmwareMetricCategory;
  severity: VmwareAlertTemplateSeverity;
  metric: string;
  resourceType?: VmwareResourceType | undefined;
  threshold: number;
  lessThan?: boolean | undefined;
  binary?: boolean | undefined;
}

const definitions: Array<TemplateDefinition> = [
  {
    id: "vmware-collection-unavailable",
    name: "vSphere collection unavailable",
    description:
      "Alerts when the collector cannot read vSphere or stops delivering data. Resource failures remain separate.",
    category: "Collection",
    severity: "Critical",
    metric: "source.up",
    threshold: 1,
    lessThan: true,
    binary: true,
  },
  {
    id: "vmware-inventory-incomplete",
    name: "Incomplete VMware inventory",
    description:
      "Detects partial API failures or permissions that prevent a complete inventory read.",
    category: "Collection",
    severity: "Warning",
    metric: "source.inventory.complete",
    threshold: 1,
    lessThan: true,
    binary: true,
  },
  {
    id: "vmware-host-unavailable",
    name: "ESXi host unavailable",
    description:
      "An ESXi host is disconnected or not responding outside maintenance.",
    category: "Host",
    severity: "Critical",
    metric: "host.unavailable",
    resourceType: VmwareResourceType.Host,
    threshold: 0,
    binary: true,
  },
  {
    id: "vmware-vm-unexpected-off",
    name: "Expected VM not running",
    description:
      "Only VMs explicitly expected to run alert when powered off or suspended. Configure this expectation on a VM's resource page or in the agent.",
    category: "VM",
    severity: "Critical",
    metric: "vm.unexpected_power_off",
    resourceType: VmwareResourceType.VM,
    threshold: 0,
    binary: true,
  },
  {
    id: "vmware-resource-disappeared",
    name: "VMware resource no longer observed",
    description:
      "A known resource disappeared while inventory collection remains healthy. Retire decommissioned resources explicitly to stop this alert.",
    category: "Health",
    severity: "Warning",
    metric: "resource.observed",
    threshold: 1,
    lessThan: true,
    binary: true,
  },
  {
    id: "vmware-resource-critical",
    name: "Critical VMware resource health",
    description:
      "vSphere reports critical health for a resource. Unknown health never counts as recovery.",
    category: "Health",
    severity: "Critical",
    metric: "resource.state",
    threshold: 2,
  },
  {
    id: "vmware-datastore-capacity",
    name: "Datastore nearly full",
    description:
      "Datastore utilization remains above 90% over five minutes; recovers at or below 81% to avoid repeated notifications.",
    category: "Datastore",
    severity: "Critical",
    metric: "datastore.disk.utilization",
    resourceType: VmwareResourceType.Datastore,
    threshold: 90,
  },
  ...([VmwareResourceType.Host, VmwareResourceType.VM] as const).flatMap(
    (type: VmwareResourceType): Array<TemplateDefinition> => {
      return ["cpu", "memory"].map((signal: string): TemplateDefinition => {
        return {
          id: `vmware-${type}-${signal}`,
          name: `${type === VmwareResourceType.Host ? "Host" : "VM"} sustained ${signal === "cpu" ? "CPU" : "memory"} pressure`,
          description: `Utilization stays above 90% over five minutes. Review workload impact before escalating.`,
          category: type === VmwareResourceType.Host ? "Host" : "VM",
          severity: "Warning",
          metric: `${type}.${signal}.utilization`,
          resourceType: type,
          threshold: 90,
        };
      });
    },
  ),
];

export function getVmwareAlertTemplates(): Array<VmwareAlertTemplate> {
  return definitions.map((definition: TemplateDefinition) => {
    return {
      ...definition,
      getMonitorStep: (args: VmwareAlertTemplateArgs): MonitorStep => {
        const filterType: FilterType = definition.lessThan
          ? FilterType.LessThan
          : FilterType.GreaterThan;
        const metricAlias: string = "A";
        const unhealthy: MonitorCriteriaInstance =
          buildUnhealthyCriteriaInstance({
            offlineMonitorStatusId: args.offlineMonitorStatusId,
            incidentSeverityId: args.defaultIncidentSeverityId,
            alertSeverityId: args.defaultAlertSeverityId,
            monitorName: args.monitorName,
            metricAlias,
            filterType,
            value: definition.threshold,
            resourceNoun: "VMware resource",
            metricAggregationType: EvaluateOverTimeType.AllValues,
          });
        const healthy: MonitorCriteriaInstance = buildHealthyCriteriaInstance({
          onlineMonitorStatusId: args.onlineMonitorStatusId,
          metricAlias: "B",
          filterType: getRecoveryFilterType(filterType),
          value: definition.threshold,
          isBinaryMetric: definition.binary,
          metricAggregationType: EvaluateOverTimeType.AllValues,
        });
        // Missing source data means lost collection. Missing entity metrics mean unknown, never zero/healthy.
        if (definition.category === "Collection") {
          for (const filter of unhealthy.data!.filters) {
            filter.metricMonitorOptions!.onNoDataPolicy = NoDataPolicy.Trigger;
          }
        }
        const criteria: MonitorCriteria = new MonitorCriteria();
        criteria.data = { monitorCriteriaInstanceArray: [unhealthy, healthy] };
        const step: MonitorStep = new MonitorStep();
        step.data!.monitorCriteria = criteria;
        step.data!.vmwareMonitor = buildVmwareMonitorConfig({
          sourceIdentifier: args.sourceIdentifier,
          metricName: `oneuptime.vmware.${definition.metric}`,
          metricAlias,
          rollingTime: RollingTime.Past5Minutes,
          aggregationType: definition.lessThan
            ? MetricsAggregationType.Max
            : MetricsAggregationType.Min,
          resourceType: definition.resourceType,
          legendUnit: definition.metric.endsWith("utilization")
            ? "%"
            : undefined,
        });
        /*
         * Firing and recovery must each account for every sample in a SQL
         * bucket. A low sample alongside a high sample must not affirm recovery.
         */
        const recovery: MonitorStepVmwareMonitor = buildVmwareMonitorConfig({
          sourceIdentifier: args.sourceIdentifier,
          metricName: `oneuptime.vmware.${definition.metric}`,
          metricAlias: "B",
          rollingTime: RollingTime.Past5Minutes,
          aggregationType: definition.lessThan
            ? MetricsAggregationType.Min
            : MetricsAggregationType.Max,
          resourceType: definition.resourceType,
          legendUnit: definition.metric.endsWith("utilization")
            ? "%"
            : undefined,
        });
        step.data!.vmwareMonitor.metricViewConfig.queryConfigs.push(
          ...recovery.metricViewConfig.queryConfigs,
        );
        return step;
      },
    };
  });
}

export const getAllVmwareAlertTemplates: () => Array<VmwareAlertTemplate> =
  getVmwareAlertTemplates;
export function getVmwareAlertTemplateById(
  id: string,
): VmwareAlertTemplate | undefined {
  return getVmwareAlertTemplates().find((template: VmwareAlertTemplate) => {
    return template.id === id;
  });
}
export function getVmwareAlertTemplatesByCategory(
  category: VmwareAlertTemplateCategory,
): Array<VmwareAlertTemplate> {
  return getVmwareAlertTemplates().filter((template: VmwareAlertTemplate) => {
    return template.category === category;
  });
}
