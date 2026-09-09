import MonitorStepVMwareMonitor, {
  MonitorStepVMwareMonitorUtil,
  VMwareResourceFilters,
  VMwareResourceScope,
} from "Common/Types/Monitor/MonitorStepVMwareMonitor";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import MetricView from "../../../Metrics/MetricView";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import RollingTimePicker from "Common/UI/Components/RollingTimePicker/RollingTimePicker";
import RollingTimeUtil from "Common/Types/RollingTime/RollingTimeUtil";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Input from "Common/UI/Components/Input/Input";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import VMwareTemplatePicker from "./VMwareTemplatePicker";
import VMwareMetricPicker from "./VMwareMetricPicker";
import {
  VMwareAlertTemplate,
  VMwareGroupByKey,
  buildVMwareMonitorConfig,
} from "Common/Types/Monitor/VMwareAlertTemplates";
import { VMwareMetricDefinition } from "Common/Types/Monitor/VMwareMetricCatalog";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";

/*
 * Window used when a step arrives without one (a legacy step, or a config
 * built before the picker ran). Read from the Common default rather than
 * restated here so the form can never drift from what the API / Terraform
 * seed: the VMware Agent polls vCenter every VCENTER_COLLECTION_INTERVAL
 * (2 minutes by default) and emits one sample per object per collection, so
 * anything shorter than 5 minutes evaluates on an empty window every other
 * tick and flaps.
 */
const DEFAULT_ROLLING_TIME: RollingTime =
  MonitorStepVMwareMonitorUtil.getDefault().rollingTime;

export interface ComponentProps {
  monitorStepVMwareMonitor: MonitorStepVMwareMonitor;
  onChange: (monitorStepVMwareMonitor: MonitorStepVMwareMonitor) => void;
  onMonitorCriteriaChange?: ((criteria: MonitorCriteria) => void) | undefined;
  onlineMonitorStatusId?: ObjectID | undefined;
  offlineMonitorStatusId?: ObjectID | undefined;
  defaultIncidentSeverityId?: ObjectID | undefined;
  defaultAlertSeverityId?: ObjectID | undefined;
  monitorName?: string | undefined;
}

const aggregationOptions: Array<DropdownOption> = [
  { label: "Average", value: MetricsAggregationType.Avg },
  { label: "Maximum", value: MetricsAggregationType.Max },
  { label: "Minimum", value: MetricsAggregationType.Min },
  { label: "Sum", value: MetricsAggregationType.Sum },
  { label: "Count", value: MetricsAggregationType.Count },
];

/*
 * The identity attribute a custom metric is grouped by, per vSphere object.
 * The vcenter receiver emits one OTLP resource per object, so without a
 * group-by an "average host CPU" monitor would average EVERY ESXi host in
 * the vCenter into one number and never fire for the single host that is
 * pegged. Grouping by the object's own identity attribute — the same key
 * the Quick Setup templates use — yields one series, and one alert, per
 * object. The vCenter-level scope has no per-object identity and is left
 * ungrouped.
 */
const groupByKeyForScope: Partial<Record<VMwareResourceScope, string>> = {
  [VMwareResourceScope.Datacenter]: VMwareGroupByKey.Datacenter,
  [VMwareResourceScope.Cluster]: VMwareGroupByKey.Cluster,
  [VMwareResourceScope.Host]: VMwareGroupByKey.Host,
  [VMwareResourceScope.VirtualMachine]: VMwareGroupByKey.VirtualMachine,
  [VMwareResourceScope.Datastore]: VMwareGroupByKey.Datastore,
  [VMwareResourceScope.ResourcePool]: VMwareGroupByKey.ResourcePool,
};

/*
 * One text input per VMwareResourceFilters key, in vSphere inventory order
 * (Datacenter → Cluster → Host → VM, then the two non-compute objects).
 * Every value is an equality on the `resource.`-prefixed attribute named in
 * the description; the worker (MonitorTelemetryMonitor) does the mapping
 * and always scopes on `resource.vmware.vcenter.name` on top.
 */
interface ResourceFilterField {
  key: keyof VMwareResourceFilters;
  title: string;
  description: string;
  placeholder: string;
}

const resourceFilterFields: Array<ResourceFilterField> = [
  {
    key: "datacenterName",
    title: "Datacenter",
    description:
      "Filter to one vSphere datacenter — `resource.vcenter.datacenter.name` (optional). Every object the receiver reports carries this attribute.",
    placeholder: "e.g. DC-East",
  },
  {
    key: "clusterName",
    title: "Cluster",
    description:
      "Filter to one vSphere cluster — `resource.vcenter.cluster.name` (optional). Matches the cluster's own series plus the hosts, VMs and resource pools inside it; standalone ESXi hosts carry no cluster name and will not match.",
    placeholder: "e.g. Prod-Cluster",
  },
  {
    key: "hostName",
    title: "ESXi Host",
    description:
      "Filter to one ESXi host — `resource.vcenter.host.name` (optional). Matches the host's own series AND every VM running on it, because the receiver stamps the parent host on VM resources; add a VM name to target one VM.",
    placeholder: "e.g. esxi-01.example.com",
  },
  {
    key: "vmName",
    title: "Virtual Machine",
    description:
      "Filter to one virtual machine — `resource.vcenter.vm.name` (optional). VM names are not guaranteed unique across a vCenter; combine with a host or cluster if two VMs share a name.",
    placeholder: "e.g. web-01",
  },
  {
    key: "datastoreName",
    title: "Datastore",
    description:
      "Filter to one datastore — `resource.vcenter.datastore.name` (optional). Only datastore series carry this attribute.",
    placeholder: "e.g. vsanDatastore",
  },
  {
    key: "resourcePoolPath",
    title: "Resource Pool Path",
    description:
      "Filter to one resource pool by its full inventory path — `resource.vcenter.resource_pool.inventory_path` (optional). The path is used rather than the pool name because pool names are only unique within their parent.",
    placeholder: "e.g. /DC-East/host/Prod-Cluster/Resources/web-tier",
  },
];

const VMwareMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [rollingTime, setRollingTime] = React.useState<RollingTime | null>(
    null,
  );

  const monitorStepVMwareMonitor: MonitorStepVMwareMonitor =
    props.monitorStepVMwareMonitor || MonitorStepVMwareMonitorUtil.getDefault();

  const [startAndEndTime, setStartAndEndTime] =
    React.useState<InBetween<Date> | null>(null);

  const [vcenterOptions, setVCenterOptions] = React.useState<
    Array<DropdownOption>
  >([]);

  const [, setIsLoadingVCenters] = React.useState<boolean>(true);

  const [selectedTemplateId, setSelectedTemplateId] = React.useState<
    string | undefined
  >(undefined);

  const [selectedMetricId, setSelectedMetricId] = React.useState<
    string | undefined
  >(undefined);
  const [customAggregation, setCustomAggregation] =
    React.useState<MetricsAggregationType>(MetricsAggregationType.Avg);

  useEffect(() => {
    setIsLoadingVCenters(true);
    ModelAPI.getList<VMwareVCenter>({
      modelType: VMwareVCenter,
      query: {},
      select: {
        _id: true,
        name: true,
      },
      sort: {
        name: SortOrder.Ascending,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
    })
      .then((result: ListResult<VMwareVCenter>) => {
        /*
         * The dropdown VALUE is the vCenter's `name`, not its id: `name`
         * is the `vmware.vcenter.name` resource attribute the agent stamps
         * on every metric, and the worker scopes the query on it.
         */
        const options: Array<DropdownOption> = result.data.map(
          (vcenter: VMwareVCenter) => {
            return {
              label: vcenter.name || "Unknown",
              value: vcenter.name || "",
            };
          },
        );
        setVCenterOptions(options);
      })
      .catch(() => {
        setVCenterOptions([]);
      })
      .finally(() => {
        setIsLoadingVCenters(false);
      });
  }, []);

  useEffect(() => {
    if (rollingTime === monitorStepVMwareMonitor.rollingTime) {
      return;
    }

    setRollingTime(monitorStepVMwareMonitor.rollingTime);

    setStartAndEndTime(
      RollingTimeUtil.convertToStartAndEndDate(
        monitorStepVMwareMonitor.rollingTime || DEFAULT_ROLLING_TIME,
      ),
    );
  }, [monitorStepVMwareMonitor.rollingTime]);

  useEffect(() => {
    setStartAndEndTime(
      RollingTimeUtil.convertToStartAndEndDate(
        monitorStepVMwareMonitor.rollingTime || DEFAULT_ROLLING_TIME,
      ),
    );
  }, []);

  const handleTemplateSelection: (template: VMwareAlertTemplate) => void = (
    template: VMwareAlertTemplate,
  ): void => {
    setSelectedTemplateId(template.id);

    const vcenterIdentifier: string =
      monitorStepVMwareMonitor.vcenterIdentifier;

    const onlineMonitorStatusId: ObjectID =
      props.onlineMonitorStatusId || ObjectID.generate();
    const offlineMonitorStatusId: ObjectID =
      props.offlineMonitorStatusId || ObjectID.generate();
    const defaultIncidentSeverityId: ObjectID =
      props.defaultIncidentSeverityId || ObjectID.generate();
    const defaultAlertSeverityId: ObjectID =
      props.defaultAlertSeverityId || ObjectID.generate();
    const monitorName: string = props.monitorName || template.name;

    const templateStep: MonitorStep = template.getMonitorStep({
      vcenterIdentifier: vcenterIdentifier || "",
      onlineMonitorStatusId,
      offlineMonitorStatusId,
      defaultIncidentSeverityId,
      defaultAlertSeverityId,
      monitorName,
    });

    if (templateStep.data?.vmwareMonitor) {
      props.onChange({
        ...templateStep.data.vmwareMonitor,
        vcenterIdentifier: vcenterIdentifier || "",
      });
    }

    if (templateStep.data?.monitorCriteria && props.onMonitorCriteriaChange) {
      props.onMonitorCriteriaChange(templateStep.data.monitorCriteria);
    }
  };

  const handleCustomMetricSelection: (
    metric: VMwareMetricDefinition,
  ) => void = (metric: VMwareMetricDefinition): void => {
    setSelectedMetricId(metric.id);
    setCustomAggregation(metric.defaultAggregation);

    const vcenterIdentifier: string =
      monitorStepVMwareMonitor.vcenterIdentifier;

    const config: MonitorStepVMwareMonitor = buildVMwareMonitorConfig({
      vcenterIdentifier: vcenterIdentifier || "",
      metricName: metric.metricName,
      metricAlias: metric.id.replace(/-/g, "_"),
      rollingTime: monitorStepVMwareMonitor.rollingTime || DEFAULT_ROLLING_TIME,
      aggregationType: metric.defaultAggregation,
      groupByAttributeKey: groupByKeyForScope[metric.defaultResourceScope],
      /*
       * Pin the display unit to the receiver's declared unit so the
       * threshold the user writes next keeps meaning "%" / "ms" / "MiBy"
       * even if a future receiver build changes its unit string.
       */
      legendUnit: metric.unit,
    });

    /*
     * Unlike Proxmox there is no scope attribute to pre-fill: the vcenter
     * receiver distinguishes objects by metric name and resource
     * attributes, so the user narrows by name (below) rather than by kind.
     * Keep whatever filters were already typed.
     */
    config.resourceFilters = {
      ...monitorStepVMwareMonitor.resourceFilters,
    };

    props.onChange(config);
  };

  const renderVCenterDropdown: () => ReactElement = (): ReactElement => {
    return (
      <div className="mb-4">
        <FieldLabelElement
          title="vCenter"
          description={
            "Select the vCenter Server (or standalone ESXi host) to monitor."
          }
          required={true}
        />
        <Dropdown
          options={vcenterOptions}
          value={vcenterOptions.find((option: DropdownOption) => {
            return option.value === monitorStepVMwareMonitor.vcenterIdentifier;
          })}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            props.onChange({
              ...monitorStepVMwareMonitor,
              vcenterIdentifier: (value as string) || "",
            });
          }}
          placeholder="Select a vCenter..."
        />
      </div>
    );
  };

  const renderResourceFilters: () => ReactElement = (): ReactElement => {
    return (
      <>
        {resourceFilterFields.map((field: ResourceFilterField) => {
          return (
            <div className="mt-3" key={field.key}>
              <FieldLabelElement
                title={field.title}
                description={field.description}
                required={false}
              />
              <Input
                value={
                  monitorStepVMwareMonitor.resourceFilters[field.key] || ""
                }
                onChange={(value: string) => {
                  props.onChange({
                    ...monitorStepVMwareMonitor,
                    resourceFilters: {
                      ...monitorStepVMwareMonitor.resourceFilters,
                      [field.key]: value || undefined,
                    },
                  });
                }}
                placeholder={field.placeholder}
              />
            </div>
          );
        })}
      </>
    );
  };

  const renderQuickSetup: () => ReactElement = (): ReactElement => {
    return (
      <div className="mt-4">
        <VMwareTemplatePicker
          selectedTemplateId={selectedTemplateId}
          onTemplateSelected={(template: VMwareAlertTemplate) => {
            handleTemplateSelection(template);
          }}
        />

        {selectedTemplateId && (
          <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
            <h4 className="text-sm font-medium text-blue-900 mb-2">
              Template Configuration
            </h4>
            <p className="text-xs text-blue-700 mb-3">
              The following settings have been auto-configured. You can adjust
              the time range below.
            </p>

            <FieldLabelElement
              title="Time Range"
              description={"Adjust the monitoring time range."}
              required={true}
            />
            <RollingTimePicker
              value={monitorStepVMwareMonitor.rollingTime}
              onChange={(value: RollingTime) => {
                if (value === monitorStepVMwareMonitor.rollingTime) {
                  return;
                }

                props.onChange({
                  ...monitorStepVMwareMonitor,
                  rollingTime: value,
                });
              }}
            />
          </div>
        )}
      </div>
    );
  };

  const renderCustomMetric: () => ReactElement = (): ReactElement => {
    return (
      <div className="mt-4 space-y-4">
        <div>
          <FieldLabelElement
            title="VMware Metric"
            description={
              "Select a vCenter metric to monitor. Metrics are organized by vSphere object — datacenter, cluster, ESXi host, virtual machine, datastore, resource pool and vSAN."
            }
            required={true}
          />
          <VMwareMetricPicker
            selectedMetricId={selectedMetricId}
            onMetricSelected={(metric: VMwareMetricDefinition) => {
              handleCustomMetricSelection(metric);
            }}
          />
        </div>

        {selectedMetricId && (
          <>
            {renderResourceFilters()}

            <div>
              <FieldLabelElement
                title="Aggregation"
                description={
                  "How should the metric values be aggregated over the time range."
                }
                required={true}
              />
              <Dropdown
                options={aggregationOptions}
                value={aggregationOptions.find((option: DropdownOption) => {
                  return option.value === customAggregation;
                })}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  const newAgg: MetricsAggregationType =
                    (value as MetricsAggregationType) ||
                    MetricsAggregationType.Avg;
                  setCustomAggregation(newAgg);

                  if (
                    monitorStepVMwareMonitor.metricViewConfig.queryConfigs
                      .length > 0
                  ) {
                    const currentQueryConfig: MetricQueryConfigData =
                      monitorStepVMwareMonitor.metricViewConfig
                        .queryConfigs[0]!;
                    if (currentQueryConfig) {
                      props.onChange({
                        ...monitorStepVMwareMonitor,
                        metricViewConfig: {
                          ...monitorStepVMwareMonitor.metricViewConfig,
                          queryConfigs: [
                            {
                              ...currentQueryConfig,
                              metricQueryData: {
                                ...currentQueryConfig.metricQueryData,
                                filterData: {
                                  ...currentQueryConfig.metricQueryData
                                    .filterData,
                                  aggegationType: newAgg,
                                },
                              },
                            },
                          ],
                        },
                      });
                    }
                  }
                }}
                placeholder="Select aggregation..."
              />
            </div>

            <div>
              <FieldLabelElement
                title="Time Range"
                description={"Select the time range for the VMware monitor."}
                required={true}
              />
              <RollingTimePicker
                value={monitorStepVMwareMonitor.rollingTime}
                onChange={(value: RollingTime) => {
                  if (value === monitorStepVMwareMonitor.rollingTime) {
                    return;
                  }

                  props.onChange({
                    ...monitorStepVMwareMonitor,
                    rollingTime: value,
                  });
                }}
              />
            </div>
          </>
        )}
      </div>
    );
  };

  const renderAdvanced: () => ReactElement = (): ReactElement => {
    return (
      <div className="mt-4">
        {renderResourceFilters()}

        <div className="mt-3">
          <FieldLabelElement
            title="Time Range"
            description={"Select the time range for the VMware monitor."}
            required={true}
          />
          <RollingTimePicker
            value={monitorStepVMwareMonitor.rollingTime}
            onChange={(value: RollingTime) => {
              if (value === monitorStepVMwareMonitor.rollingTime) {
                return;
              }

              props.onChange({
                ...monitorStepVMwareMonitor,
                rollingTime: value,
              });
            }}
          />
        </div>

        <div className="mt-3">
          <FieldLabelElement
            title="Select Metrics"
            description={
              "Select the vCenter metrics to monitor. Use the query builder for full control over metric selection, attribute filters (for example `disk_state`, `power_state`, `status`) and grouping."
            }
            required={true}
          />

          <div className="mt-3"></div>

          <MetricView
            hideStartAndEndDate={true}
            data={{
              startAndEndDate: startAndEndTime,
              queryConfigs:
                monitorStepVMwareMonitor.metricViewConfig.queryConfigs,
              formulaConfigs:
                monitorStepVMwareMonitor.metricViewConfig.formulaConfigs,
            }}
            hideCardInQueryElements={true}
            hideCardInCharts={true}
            chartCssClass="rounded-lg border border-gray-200 shadow-sm"
            // onChange below drops startAndEndDate, so drag-zoom can't apply.
            disableChartZoom={true}
            onChange={(data: MetricViewData) => {
              props.onChange({
                ...monitorStepVMwareMonitor,
                metricViewConfig: {
                  queryConfigs: data.queryConfigs,
                  formulaConfigs: data.formulaConfigs,
                },
              });
            }}
          />
        </div>
      </div>
    );
  };

  const tabs: Array<Tab> = [
    {
      name: "Quick Setup",
      children: renderQuickSetup(),
    },
    {
      name: "Custom Metric",
      children: renderCustomMetric(),
    },
    {
      name: "Advanced",
      children: renderAdvanced(),
    },
  ];

  return (
    <div>
      {renderVCenterDropdown()}

      <Tabs tabs={tabs} onTabChange={() => {}} />
    </div>
  );
};

export default VMwareMonitorStepForm;
