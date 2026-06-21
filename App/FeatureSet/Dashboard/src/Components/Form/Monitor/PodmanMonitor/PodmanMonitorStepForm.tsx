import MonitorStepPodmanMonitor, {
  MonitorStepPodmanMonitorUtil,
} from "Common/Types/Monitor/MonitorStepPodmanMonitor";
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
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import PodmanTemplatePicker from "./PodmanTemplatePicker";
import PodmanMetricPicker from "./PodmanMetricPicker";
import {
  PodmanAlertTemplate,
  buildPodmanMonitorConfig,
} from "Common/Types/Monitor/PodmanAlertTemplates";
import { PodmanMetricDefinition } from "Common/Types/Monitor/PodmanMetricCatalog";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";

export interface ComponentProps {
  monitorStepPodmanMonitor: MonitorStepPodmanMonitor;
  onChange: (monitorStepPodmanMonitor: MonitorStepPodmanMonitor) => void;
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

const PodmanMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [rollingTime, setRollingTime] = React.useState<RollingTime | null>(
    null,
  );

  const monitorStepPodmanMonitor: MonitorStepPodmanMonitor =
    props.monitorStepPodmanMonitor || MonitorStepPodmanMonitorUtil.getDefault();

  const [startAndEndTime, setStartAndEndTime] =
    React.useState<InBetween<Date> | null>(null);

  const [hostOptions, setHostOptions] = React.useState<Array<DropdownOption>>(
    [],
  );

  const [, setIsLoadingHosts] = React.useState<boolean>(true);

  const [selectedTemplateId, setSelectedTemplateId] = React.useState<
    string | undefined
  >(undefined);

  const [selectedMetricId, setSelectedMetricId] = React.useState<
    string | undefined
  >(undefined);
  const [customAggregation, setCustomAggregation] =
    React.useState<MetricsAggregationType>(MetricsAggregationType.Avg);

  useEffect(() => {
    setIsLoadingHosts(true);
    ModelAPI.getList<PodmanHost>({
      modelType: PodmanHost,
      query: {},
      select: {
        _id: true,
        name: true,
        hostIdentifier: true,
      },
      sort: {
        name: SortOrder.Ascending,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
    })
      .then((result: ListResult<PodmanHost>) => {
        const options: Array<DropdownOption> = result.data.map(
          (host: PodmanHost) => {
            return {
              label: host.name || host.hostIdentifier || "Unknown",
              value: host.hostIdentifier || "",
            };
          },
        );
        setHostOptions(options);
      })
      .catch(() => {
        setHostOptions([]);
      })
      .finally(() => {
        setIsLoadingHosts(false);
      });
  }, []);

  useEffect(() => {
    if (rollingTime === monitorStepPodmanMonitor.rollingTime) {
      return;
    }

    setRollingTime(monitorStepPodmanMonitor.rollingTime);

    setStartAndEndTime(
      RollingTimeUtil.convertToStartAndEndDate(
        monitorStepPodmanMonitor.rollingTime || RollingTime.Past1Minute,
      ),
    );
  }, [monitorStepPodmanMonitor.rollingTime]);

  useEffect(() => {
    setStartAndEndTime(
      RollingTimeUtil.convertToStartAndEndDate(
        monitorStepPodmanMonitor.rollingTime || RollingTime.Past1Minute,
      ),
    );
  }, []);

  const handleTemplateSelection: (template: PodmanAlertTemplate) => void = (
    template: PodmanAlertTemplate,
  ): void => {
    setSelectedTemplateId(template.id);

    const hostIdentifier: string = monitorStepPodmanMonitor.hostIdentifier;

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
      hostIdentifier: hostIdentifier || "",
      onlineMonitorStatusId,
      offlineMonitorStatusId,
      defaultIncidentSeverityId,
      defaultAlertSeverityId,
      monitorName,
    });

    if (templateStep.data?.podmanMonitor) {
      props.onChange({
        ...templateStep.data.podmanMonitor,
        hostIdentifier: hostIdentifier || "",
      });
    }

    if (templateStep.data?.monitorCriteria && props.onMonitorCriteriaChange) {
      props.onMonitorCriteriaChange(templateStep.data.monitorCriteria);
    }
  };

  const handleCustomMetricSelection: (
    metric: PodmanMetricDefinition,
  ) => void = (metric: PodmanMetricDefinition): void => {
    setSelectedMetricId(metric.id);
    setCustomAggregation(metric.defaultAggregation);

    const hostIdentifier: string = monitorStepPodmanMonitor.hostIdentifier;

    const config: MonitorStepPodmanMonitor = buildPodmanMonitorConfig({
      hostIdentifier: hostIdentifier || "",
      metricName: metric.metricName,
      metricAlias: metric.id.replace(/-/g, "_"),
      rollingTime:
        monitorStepPodmanMonitor.rollingTime || RollingTime.Past5Minutes,
      aggregationType: metric.defaultAggregation,
    });

    props.onChange(config);
  };

  const renderHostDropdown: () => ReactElement = (): ReactElement => {
    return (
      <div className="mb-4">
        <FieldLabelElement
          title="Podman Host"
          description={"Select the Podman host to monitor."}
          required={true}
        />
        <Dropdown
          options={hostOptions}
          value={hostOptions.find((option: DropdownOption) => {
            return option.value === monitorStepPodmanMonitor.hostIdentifier;
          })}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            props.onChange({
              ...monitorStepPodmanMonitor,
              hostIdentifier: (value as string) || "",
            });
          }}
          placeholder="Select a Podman host..."
        />
      </div>
    );
  };

  const renderContainerFilters: () => ReactElement = (): ReactElement => {
    return (
      <>
        <div className="mt-3">
          <FieldLabelElement
            title="Container Name"
            description={"Filter by container name (optional)."}
            required={false}
          />
          <Input
            value={
              monitorStepPodmanMonitor.containerFilters.containerName || ""
            }
            onChange={(value: string) => {
              props.onChange({
                ...monitorStepPodmanMonitor,
                containerFilters: {
                  ...monitorStepPodmanMonitor.containerFilters,
                  containerName: value || undefined,
                },
              });
            }}
            placeholder="e.g. my-container"
          />
        </div>

        <div className="mt-3">
          <FieldLabelElement
            title="Container Image"
            description={"Filter by container image (optional)."}
            required={false}
          />
          <Input
            value={
              monitorStepPodmanMonitor.containerFilters.containerImage || ""
            }
            onChange={(value: string) => {
              props.onChange({
                ...monitorStepPodmanMonitor,
                containerFilters: {
                  ...monitorStepPodmanMonitor.containerFilters,
                  containerImage: value || undefined,
                },
              });
            }}
            placeholder="e.g. nginx:latest"
          />
        </div>
      </>
    );
  };

  const renderQuickSetup: () => ReactElement = (): ReactElement => {
    return (
      <div className="mt-4">
        <PodmanTemplatePicker
          selectedTemplateId={selectedTemplateId}
          onTemplateSelected={(template: PodmanAlertTemplate) => {
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
              value={monitorStepPodmanMonitor.rollingTime}
              onChange={(value: RollingTime) => {
                if (value === monitorStepPodmanMonitor.rollingTime) {
                  return;
                }

                props.onChange({
                  ...monitorStepPodmanMonitor,
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
            title="Podman Metric"
            description={
              "Select a Podman metric to monitor. Metrics are organized by resource type."
            }
            required={true}
          />
          <PodmanMetricPicker
            selectedMetricId={selectedMetricId}
            onMetricSelected={(metric: PodmanMetricDefinition) => {
              handleCustomMetricSelection(metric);
            }}
          />
        </div>

        {selectedMetricId && (
          <>
            {renderContainerFilters()}

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
                    monitorStepPodmanMonitor.metricViewConfig.queryConfigs
                      .length > 0
                  ) {
                    const currentQueryConfig: MetricQueryConfigData =
                      monitorStepPodmanMonitor.metricViewConfig
                        .queryConfigs[0]!;
                    if (currentQueryConfig) {
                      props.onChange({
                        ...monitorStepPodmanMonitor,
                        metricViewConfig: {
                          ...monitorStepPodmanMonitor.metricViewConfig,
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
                description={"Select the time range for the Podman monitor."}
                required={true}
              />
              <RollingTimePicker
                value={monitorStepPodmanMonitor.rollingTime}
                onChange={(value: RollingTime) => {
                  if (value === monitorStepPodmanMonitor.rollingTime) {
                    return;
                  }

                  props.onChange({
                    ...monitorStepPodmanMonitor,
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
        {renderContainerFilters()}

        <div className="mt-3">
          <FieldLabelElement
            title="Time Range"
            description={"Select the time range for the Podman monitor."}
            required={true}
          />
          <RollingTimePicker
            value={monitorStepPodmanMonitor.rollingTime}
            onChange={(value: RollingTime) => {
              if (value === monitorStepPodmanMonitor.rollingTime) {
                return;
              }

              props.onChange({
                ...monitorStepPodmanMonitor,
                rollingTime: value,
              });
            }}
          />
        </div>

        <div className="mt-3">
          <FieldLabelElement
            title="Select Metrics"
            description={
              "Select the Podman metrics to monitor. Use the query builder for full control over metric selection and filtering."
            }
            required={true}
          />

          <div className="mt-3"></div>

          <MetricView
            hideStartAndEndDate={true}
            data={{
              startAndEndDate: startAndEndTime,
              queryConfigs:
                monitorStepPodmanMonitor.metricViewConfig.queryConfigs,
              formulaConfigs:
                monitorStepPodmanMonitor.metricViewConfig.formulaConfigs,
            }}
            hideCardInQueryElements={true}
            hideCardInCharts={true}
            chartCssClass="rounded-lg border border-gray-200 shadow-sm"
            onChange={(data: MetricViewData) => {
              props.onChange({
                ...monitorStepPodmanMonitor,
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
      {renderHostDropdown()}

      <Tabs tabs={tabs} onTabChange={() => {}} />
    </div>
  );
};

export default PodmanMonitorStepForm;
