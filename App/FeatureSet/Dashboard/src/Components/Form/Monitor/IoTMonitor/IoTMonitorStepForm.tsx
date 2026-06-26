import MonitorStepIoTMonitor, {
  MonitorStepIoTMonitorUtil,
  IoTResourceScope,
} from "Common/Types/Monitor/MonitorStepIoTMonitor";
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
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import IoTTemplatePicker from "./IoTTemplatePicker";
import IoTMetricPicker from "./IoTMetricPicker";
import {
  IoTAlertTemplate,
  buildIoTMonitorConfig,
} from "Common/Types/Monitor/IotAlertTemplates";
import { IoTMetricDefinition } from "Common/Types/Monitor/IotMetricCatalog";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";

export interface ComponentProps {
  monitorStepIoTMonitor: MonitorStepIoTMonitor;
  onChange: (monitorStepIoTMonitor: MonitorStepIoTMonitor) => void;
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
 * Values are byte-equal to the `iot.scope` datapoint attribute stamped
 * by the IoT agent / gateway, so the monitor worker maps the filter to
 * attribute equality with no translation.
 */
const scopeOptions: Array<DropdownOption> = [
  { label: "Device", value: IoTResourceScope.Device },
  { label: "Fleet", value: IoTResourceScope.Fleet },
];

const IoTMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [rollingTime, setRollingTime] = React.useState<RollingTime | null>(
    null,
  );

  const monitorStepIoTMonitor: MonitorStepIoTMonitor =
    props.monitorStepIoTMonitor || MonitorStepIoTMonitorUtil.getDefault();

  const [startAndEndTime, setStartAndEndTime] =
    React.useState<InBetween<Date> | null>(null);

  const [fleetOptions, setFleetOptions] = React.useState<Array<DropdownOption>>(
    [],
  );

  const [, setIsLoadingFleets] = React.useState<boolean>(true);

  const [selectedTemplateId, setSelectedTemplateId] = React.useState<
    string | undefined
  >(undefined);

  const [selectedMetricId, setSelectedMetricId] = React.useState<
    string | undefined
  >(undefined);
  const [customAggregation, setCustomAggregation] =
    React.useState<MetricsAggregationType>(MetricsAggregationType.Avg);

  useEffect(() => {
    setIsLoadingFleets(true);
    ModelAPI.getList<IoTFleet>({
      modelType: IoTFleet,
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
      .then((result: ListResult<IoTFleet>) => {
        const options: Array<DropdownOption> = result.data.map(
          (fleet: IoTFleet) => {
            return {
              label: fleet.name || "Unknown",
              value: fleet.name || "",
            };
          },
        );
        setFleetOptions(options);
      })
      .catch(() => {
        setFleetOptions([]);
      })
      .finally(() => {
        setIsLoadingFleets(false);
      });
  }, []);

  useEffect(() => {
    if (rollingTime === monitorStepIoTMonitor.rollingTime) {
      return;
    }

    setRollingTime(monitorStepIoTMonitor.rollingTime);

    setStartAndEndTime(
      RollingTimeUtil.convertToStartAndEndDate(
        monitorStepIoTMonitor.rollingTime || RollingTime.Past1Minute,
      ),
    );
  }, [monitorStepIoTMonitor.rollingTime]);

  useEffect(() => {
    setStartAndEndTime(
      RollingTimeUtil.convertToStartAndEndDate(
        monitorStepIoTMonitor.rollingTime || RollingTime.Past1Minute,
      ),
    );
  }, []);

  const handleTemplateSelection: (template: IoTAlertTemplate) => void = (
    template: IoTAlertTemplate,
  ): void => {
    setSelectedTemplateId(template.id);

    const fleetIdentifier: string = monitorStepIoTMonitor.fleetIdentifier;

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
      fleetIdentifier: fleetIdentifier || "",
      onlineMonitorStatusId,
      offlineMonitorStatusId,
      defaultIncidentSeverityId,
      defaultAlertSeverityId,
      monitorName,
    });

    if (templateStep.data?.iotMonitor) {
      props.onChange({
        ...templateStep.data.iotMonitor,
        fleetIdentifier: fleetIdentifier || "",
      });
    }

    if (templateStep.data?.monitorCriteria && props.onMonitorCriteriaChange) {
      props.onMonitorCriteriaChange(templateStep.data.monitorCriteria);
    }
  };

  const handleCustomMetricSelection: (metric: IoTMetricDefinition) => void = (
    metric: IoTMetricDefinition,
  ): void => {
    setSelectedMetricId(metric.id);
    setCustomAggregation(metric.defaultAggregation);

    const fleetIdentifier: string = monitorStepIoTMonitor.fleetIdentifier;

    const config: MonitorStepIoTMonitor = buildIoTMonitorConfig({
      fleetIdentifier: fleetIdentifier || "",
      metricName: metric.metricName,
      metricAlias: metric.id.replace(/-/g, "_"),
      rollingTime:
        monitorStepIoTMonitor.rollingTime || RollingTime.Past5Minutes,
      aggregationType: metric.defaultAggregation,
    });

    /*
     * Pre-fill the scope filter from the catalog's defaultResourceScope.
     * Fleet means "spans the whole fleet; don't pre-filter" — leave the
     * filter empty in that case.
     */
    if (metric.defaultResourceScope !== IoTResourceScope.Fleet) {
      config.resourceFilters = {
        ...config.resourceFilters,
        scope: metric.defaultResourceScope,
      };
    }

    props.onChange(config);
  };

  const renderFleetDropdown: () => ReactElement = (): ReactElement => {
    return (
      <div className="mb-4">
        <FieldLabelElement
          title="IoT Fleet"
          description={"Select the IoT fleet to monitor."}
          required={true}
        />
        <Dropdown
          options={fleetOptions}
          value={fleetOptions.find((option: DropdownOption) => {
            return option.value === monitorStepIoTMonitor.fleetIdentifier;
          })}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            props.onChange({
              ...monitorStepIoTMonitor,
              fleetIdentifier: (value as string) || "",
            });
          }}
          placeholder="Select an IoT fleet..."
        />
      </div>
    );
  };

  /*
   * Filter precedence in the worker (MonitorTelemetryMonitor): deviceId
   * (raw `device.id` label) wins over everything; scope and deviceType map
   * to their `iot.scope` / `iot.device.type` attributes independently.
   */
  const renderResourceFilters: () => ReactElement = (): ReactElement => {
    return (
      <>
        <div className="mt-3">
          <FieldLabelElement
            title="Resource Scope"
            description={
              "Filter by resource type — the whole fleet or individual devices (optional)."
            }
            required={false}
          />
          <Dropdown
            options={scopeOptions}
            value={scopeOptions.find((option: DropdownOption) => {
              return (
                option.value === monitorStepIoTMonitor.resourceFilters.scope
              );
            })}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              props.onChange({
                ...monitorStepIoTMonitor,
                resourceFilters: {
                  ...monitorStepIoTMonitor.resourceFilters,
                  scope: (value as IoTResourceScope) || undefined,
                },
              });
            }}
            placeholder="All resource types"
          />
        </div>

        <div className="mt-3">
          <FieldLabelElement
            title="Device ID"
            description={
              "Filter by the device id — the raw `device.id` datapoint label (optional). Wins over the other filters when set."
            }
            required={false}
          />
          <Input
            value={monitorStepIoTMonitor.resourceFilters.deviceId || ""}
            onChange={(value: string) => {
              props.onChange({
                ...monitorStepIoTMonitor,
                resourceFilters: {
                  ...monitorStepIoTMonitor.resourceFilters,
                  deviceId: value || undefined,
                },
              });
            }}
            placeholder="e.g. sensor-001"
          />
        </div>

        <div className="mt-3">
          <FieldLabelElement
            title="Device Type"
            description={
              "Filter by the `iot.device.type` attribute — e.g. sensor, gateway, camera (optional)."
            }
            required={false}
          />
          <Input
            value={monitorStepIoTMonitor.resourceFilters.deviceType || ""}
            onChange={(value: string) => {
              props.onChange({
                ...monitorStepIoTMonitor,
                resourceFilters: {
                  ...monitorStepIoTMonitor.resourceFilters,
                  deviceType: value || undefined,
                },
              });
            }}
            placeholder="e.g. sensor, gateway"
          />
        </div>
      </>
    );
  };

  const renderQuickSetup: () => ReactElement = (): ReactElement => {
    return (
      <div className="mt-4">
        <IoTTemplatePicker
          selectedTemplateId={selectedTemplateId}
          onTemplateSelected={(template: IoTAlertTemplate) => {
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
              value={monitorStepIoTMonitor.rollingTime}
              onChange={(value: RollingTime) => {
                if (value === monitorStepIoTMonitor.rollingTime) {
                  return;
                }

                props.onChange({
                  ...monitorStepIoTMonitor,
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
            title="IoT Metric"
            description={
              "Select an IoT metric to monitor. Metrics are organized by category."
            }
            required={true}
          />
          <IoTMetricPicker
            selectedMetricId={selectedMetricId}
            onMetricSelected={(metric: IoTMetricDefinition) => {
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
                    monitorStepIoTMonitor.metricViewConfig.queryConfigs.length >
                    0
                  ) {
                    const currentQueryConfig: MetricQueryConfigData =
                      monitorStepIoTMonitor.metricViewConfig.queryConfigs[0]!;
                    if (currentQueryConfig) {
                      props.onChange({
                        ...monitorStepIoTMonitor,
                        metricViewConfig: {
                          ...monitorStepIoTMonitor.metricViewConfig,
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
                description={"Select the time range for the IoT monitor."}
                required={true}
              />
              <RollingTimePicker
                value={monitorStepIoTMonitor.rollingTime}
                onChange={(value: RollingTime) => {
                  if (value === monitorStepIoTMonitor.rollingTime) {
                    return;
                  }

                  props.onChange({
                    ...monitorStepIoTMonitor,
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
            description={"Select the time range for the IoT monitor."}
            required={true}
          />
          <RollingTimePicker
            value={monitorStepIoTMonitor.rollingTime}
            onChange={(value: RollingTime) => {
              if (value === monitorStepIoTMonitor.rollingTime) {
                return;
              }

              props.onChange({
                ...monitorStepIoTMonitor,
                rollingTime: value,
              });
            }}
          />
        </div>

        <div className="mt-3">
          <FieldLabelElement
            title="Select Metrics"
            description={
              "Select the IoT metrics to monitor. Use the query builder for full control over metric selection and filtering."
            }
            required={true}
          />

          <div className="mt-3"></div>

          <MetricView
            hideStartAndEndDate={true}
            data={{
              startAndEndDate: startAndEndTime,
              queryConfigs: monitorStepIoTMonitor.metricViewConfig.queryConfigs,
              formulaConfigs:
                monitorStepIoTMonitor.metricViewConfig.formulaConfigs,
            }}
            hideCardInQueryElements={true}
            hideCardInCharts={true}
            chartCssClass="rounded-lg border border-gray-200 shadow-sm"
            onChange={(data: MetricViewData) => {
              props.onChange({
                ...monitorStepIoTMonitor,
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
      {renderFleetDropdown()}

      <Tabs tabs={tabs} onTabChange={() => {}} />
    </div>
  );
};

export default IoTMonitorStepForm;
