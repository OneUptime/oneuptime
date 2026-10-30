import MonitorStepIoTMonitor, {
  MonitorStepIoTMonitorUtil,
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
import AlertTemplateConfiguration from "../AlertTemplatePicker/AlertTemplateConfiguration";
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
    // The template replaces the metric the Custom Metric tab picked.
    setSelectedMetricId(undefined);

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
    // The metric replaces the one Quick Setup's template set.
    setSelectedTemplateId(undefined);
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
     * No Resource Scope filter: nothing stamps the `iot.scope` attribute it
     * matched on (MQTT and OTLP ingest add `device.id` and the device's own
     * attributes only), so picking a metric used to set Scope = Device and
     * leave the monitor reading no data at all.
     */
    props.onChange(config);
  };

  const renderFleetDropdown: () => ReactElement = (): ReactElement => {
    return (
      <div className="mb-4">
        <FieldLabelElement title="IoT Fleet" required={true} />
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
   * The worker (MonitorTelemetryMonitor.monitorIoT) turns every filter that
   * is set into its own equality on the datapoints, next to the fleet:
   * Device ID on the raw `device.id` label, Device Type on the
   * `iot.device.type` attribute. So a datapoint must match every filter
   * set. Nothing takes precedence: unlike the Proxmox form's guest ID, a
   * Device ID does not set the other filters aside.
   */
  const renderResourceFilters: () => ReactElement = (): ReactElement => {
    return (
      <>
        <div className="mt-3">
          <FieldLabelElement
            title="Device ID"
            description={
              "Filter by the device id — the raw `device.id` datapoint label (optional). Every filter you set must match."
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
        >
          <AlertTemplateConfiguration
            rollingTime={monitorStepIoTMonitor.rollingTime}
            onRollingTimeChange={(value: RollingTime) => {
              props.onChange({
                ...monitorStepIoTMonitor,
                rollingTime: value,
              });
            }}
          />
        </IoTTemplatePicker>
      </div>
    );
  };

  const renderCustomMetric: () => ReactElement = (): ReactElement => {
    return (
      <div className="mt-4 space-y-4">
        <div>
          <FieldLabelElement title="IoT Metric" required={true} />
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
                  "How the metric values are combined over the time range."
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
                description={"How far back each check looks."}
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
            description={"How far back each check looks."}
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
          <FieldLabelElement title="Select Metrics" required={true} />

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
            /*
             * The preview charts the monitor's rolling window, which the
             * form saves with the monitor. A drag zooms the preview alone
             * and never reaches the form; a double-click (or Reset zoom)
             * brings the rolling window back.
             */
            localChartZoom={true}
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
