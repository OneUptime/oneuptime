import MonitorStepProxmoxMonitor, {
  MonitorStepProxmoxMonitorUtil,
} from "Common/Types/Monitor/MonitorStepProxmoxMonitor";
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
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import ProxmoxTemplatePicker from "./ProxmoxTemplatePicker";
import ProxmoxMetricPicker from "./ProxmoxMetricPicker";
import {
  ProxmoxAlertTemplate,
  buildProxmoxMonitorConfig,
} from "Common/Types/Monitor/ProxmoxAlertTemplates";
import { ProxmoxMetricDefinition } from "Common/Types/Monitor/ProxmoxMetricCatalog";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";

export interface ComponentProps {
  monitorStepProxmoxMonitor: MonitorStepProxmoxMonitor;
  onChange: (monitorStepProxmoxMonitor: MonitorStepProxmoxMonitor) => void;
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

const ProxmoxMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [rollingTime, setRollingTime] = React.useState<RollingTime | null>(
    null,
  );

  const monitorStepProxmoxMonitor: MonitorStepProxmoxMonitor =
    props.monitorStepProxmoxMonitor ||
    MonitorStepProxmoxMonitorUtil.getDefault();

  const [startAndEndTime, setStartAndEndTime] =
    React.useState<InBetween<Date> | null>(null);

  const [clusterOptions, setClusterOptions] = React.useState<
    Array<DropdownOption>
  >([]);

  const [, setIsLoadingClusters] = React.useState<boolean>(true);

  const [selectedTemplateId, setSelectedTemplateId] = React.useState<
    string | undefined
  >(undefined);

  const [selectedMetricId, setSelectedMetricId] = React.useState<
    string | undefined
  >(undefined);
  const [customAggregation, setCustomAggregation] =
    React.useState<MetricsAggregationType>(MetricsAggregationType.Avg);

  useEffect(() => {
    setIsLoadingClusters(true);
    ModelAPI.getList<ProxmoxCluster>({
      modelType: ProxmoxCluster,
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
      .then((result: ListResult<ProxmoxCluster>) => {
        const options: Array<DropdownOption> = result.data.map(
          (cluster: ProxmoxCluster) => {
            return {
              label: cluster.name || "Unknown",
              value: cluster.name || "",
            };
          },
        );
        setClusterOptions(options);
      })
      .catch(() => {
        setClusterOptions([]);
      })
      .finally(() => {
        setIsLoadingClusters(false);
      });
  }, []);

  useEffect(() => {
    if (rollingTime === monitorStepProxmoxMonitor.rollingTime) {
      return;
    }

    setRollingTime(monitorStepProxmoxMonitor.rollingTime);

    setStartAndEndTime(
      RollingTimeUtil.convertToStartAndEndDate(
        monitorStepProxmoxMonitor.rollingTime || RollingTime.Past1Minute,
      ),
    );
  }, [monitorStepProxmoxMonitor.rollingTime]);

  useEffect(() => {
    setStartAndEndTime(
      RollingTimeUtil.convertToStartAndEndDate(
        monitorStepProxmoxMonitor.rollingTime || RollingTime.Past1Minute,
      ),
    );
  }, []);

  const handleTemplateSelection: (template: ProxmoxAlertTemplate) => void = (
    template: ProxmoxAlertTemplate,
  ): void => {
    setSelectedTemplateId(template.id);

    const clusterIdentifier: string =
      monitorStepProxmoxMonitor.clusterIdentifier;

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
      clusterIdentifier: clusterIdentifier || "",
      onlineMonitorStatusId,
      offlineMonitorStatusId,
      defaultIncidentSeverityId,
      defaultAlertSeverityId,
      monitorName,
    });

    if (templateStep.data?.proxmoxMonitor) {
      props.onChange({
        ...templateStep.data.proxmoxMonitor,
        clusterIdentifier: clusterIdentifier || "",
      });
    }

    if (templateStep.data?.monitorCriteria && props.onMonitorCriteriaChange) {
      props.onMonitorCriteriaChange(templateStep.data.monitorCriteria);
    }
  };

  const handleCustomMetricSelection: (
    metric: ProxmoxMetricDefinition,
  ) => void = (metric: ProxmoxMetricDefinition): void => {
    setSelectedMetricId(metric.id);
    setCustomAggregation(metric.defaultAggregation);

    const clusterIdentifier: string =
      monitorStepProxmoxMonitor.clusterIdentifier;

    const config: MonitorStepProxmoxMonitor = buildProxmoxMonitorConfig({
      clusterIdentifier: clusterIdentifier || "",
      metricName: metric.metricName,
      metricAlias: metric.id.replace(/-/g, "_"),
      rollingTime:
        monitorStepProxmoxMonitor.rollingTime || RollingTime.Past5Minutes,
      aggregationType: metric.defaultAggregation,
    });

    props.onChange(config);
  };

  const renderClusterDropdown: () => ReactElement = (): ReactElement => {
    return (
      <div className="mb-4">
        <FieldLabelElement
          title="Proxmox Cluster"
          description={"Select the Proxmox cluster to monitor."}
          required={true}
        />
        <Dropdown
          options={clusterOptions}
          value={clusterOptions.find((option: DropdownOption) => {
            return (
              option.value === monitorStepProxmoxMonitor.clusterIdentifier
            );
          })}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            props.onChange({
              ...monitorStepProxmoxMonitor,
              clusterIdentifier: (value as string) || "",
            });
          }}
          placeholder="Select a Proxmox cluster..."
        />
      </div>
    );
  };

  const renderResourceFilters: () => ReactElement = (): ReactElement => {
    return (
      <>
        <div className="mt-3">
          <FieldLabelElement
            title="Node Name"
            description={"Filter by Proxmox node name (optional)."}
            required={false}
          />
          <Input
            value={monitorStepProxmoxMonitor.resourceFilters.nodeName || ""}
            onChange={(value: string) => {
              props.onChange({
                ...monitorStepProxmoxMonitor,
                resourceFilters: {
                  ...monitorStepProxmoxMonitor.resourceFilters,
                  nodeName: value || undefined,
                },
              });
            }}
            placeholder="e.g. pve1"
          />
        </div>

        <div className="mt-3">
          <FieldLabelElement
            title="Guest ID"
            description={
              "Filter by guest id — the `id` datapoint label (optional)."
            }
            required={false}
          />
          <Input
            value={monitorStepProxmoxMonitor.resourceFilters.guestId || ""}
            onChange={(value: string) => {
              props.onChange({
                ...monitorStepProxmoxMonitor,
                resourceFilters: {
                  ...monitorStepProxmoxMonitor.resourceFilters,
                  guestId: value || undefined,
                },
              });
            }}
            placeholder="e.g. qemu/100 or lxc/101"
          />
        </div>

        <div className="mt-3">
          <FieldLabelElement
            title="Guest Name"
            description={"Filter by guest name (optional)."}
            required={false}
          />
          <Input
            value={monitorStepProxmoxMonitor.resourceFilters.guestName || ""}
            onChange={(value: string) => {
              props.onChange({
                ...monitorStepProxmoxMonitor,
                resourceFilters: {
                  ...monitorStepProxmoxMonitor.resourceFilters,
                  guestName: value || undefined,
                },
              });
            }}
            placeholder="e.g. web-server-1"
          />
        </div>
      </>
    );
  };

  const renderQuickSetup: () => ReactElement = (): ReactElement => {
    return (
      <div className="mt-4">
        <ProxmoxTemplatePicker
          selectedTemplateId={selectedTemplateId}
          onTemplateSelected={(template: ProxmoxAlertTemplate) => {
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
              value={monitorStepProxmoxMonitor.rollingTime}
              onChange={(value: RollingTime) => {
                if (value === monitorStepProxmoxMonitor.rollingTime) {
                  return;
                }

                props.onChange({
                  ...monitorStepProxmoxMonitor,
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
            title="Proxmox Metric"
            description={
              "Select a Proxmox metric to monitor. Metrics are organized by resource type."
            }
            required={true}
          />
          <ProxmoxMetricPicker
            selectedMetricId={selectedMetricId}
            onMetricSelected={(metric: ProxmoxMetricDefinition) => {
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
                    monitorStepProxmoxMonitor.metricViewConfig.queryConfigs
                      .length > 0
                  ) {
                    const currentQueryConfig: MetricQueryConfigData =
                      monitorStepProxmoxMonitor.metricViewConfig
                        .queryConfigs[0]!;
                    if (currentQueryConfig) {
                      props.onChange({
                        ...monitorStepProxmoxMonitor,
                        metricViewConfig: {
                          ...monitorStepProxmoxMonitor.metricViewConfig,
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
                description={"Select the time range for the Proxmox monitor."}
                required={true}
              />
              <RollingTimePicker
                value={monitorStepProxmoxMonitor.rollingTime}
                onChange={(value: RollingTime) => {
                  if (value === monitorStepProxmoxMonitor.rollingTime) {
                    return;
                  }

                  props.onChange({
                    ...monitorStepProxmoxMonitor,
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
            description={"Select the time range for the Proxmox monitor."}
            required={true}
          />
          <RollingTimePicker
            value={monitorStepProxmoxMonitor.rollingTime}
            onChange={(value: RollingTime) => {
              if (value === monitorStepProxmoxMonitor.rollingTime) {
                return;
              }

              props.onChange({
                ...monitorStepProxmoxMonitor,
                rollingTime: value,
              });
            }}
          />
        </div>

        <div className="mt-3">
          <FieldLabelElement
            title="Select Metrics"
            description={
              "Select the Proxmox metrics to monitor. Use the query builder for full control over metric selection and filtering."
            }
            required={true}
          />

          <div className="mt-3"></div>

          <MetricView
            hideStartAndEndDate={true}
            data={{
              startAndEndDate: startAndEndTime,
              queryConfigs:
                monitorStepProxmoxMonitor.metricViewConfig.queryConfigs,
              formulaConfigs:
                monitorStepProxmoxMonitor.metricViewConfig.formulaConfigs,
            }}
            hideCardInQueryElements={true}
            hideCardInCharts={true}
            chartCssClass="rounded-lg border border-gray-200 shadow-sm"
            onChange={(data: MetricViewData) => {
              props.onChange({
                ...monitorStepProxmoxMonitor,
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
      {renderClusterDropdown()}

      <Tabs tabs={tabs} onTabChange={() => {}} />
    </div>
  );
};

export default ProxmoxMonitorStepForm;
