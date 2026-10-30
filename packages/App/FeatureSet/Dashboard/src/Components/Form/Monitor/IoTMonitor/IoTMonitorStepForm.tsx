import MonitorStepIoTMonitor, {
  MonitorStepIoTMonitorUtil,
} from "Common/Types/Monitor/MonitorStepIoTMonitor";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import ObjectID from "Common/Types/ObjectID";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
} from "react";
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
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import IoTTemplatePicker from "./IoTTemplatePicker";
import IoTMetricPicker from "./IoTMetricPicker";
import {
  IoTAlertTemplate,
  buildIoTMonitorConfig,
  getIoTAlertTemplateById,
  getAllIoTAlertTemplates,
  getIoTDefaultAlertTemplateId,
} from "Common/Types/Monitor/IotAlertTemplates";
import AlertTemplateConfiguration from "../AlertTemplatePicker/AlertTemplateConfiguration";
import { IoTMetricDefinition } from "Common/Types/Monitor/IotMetricCatalog";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorType from "Common/Types/Monitor/MonitorType";
import InfrastructureMonitorSetup from "../InfrastructureMonitorSetup/InfrastructureMonitorSetup";
import InfrastructureResourceField from "../InfrastructureMonitorSetup/InfrastructureResourceField";
import useInfrastructureResources, {
  InfrastructureResources,
} from "../InfrastructureMonitorSetup/UseInfrastructureResources";
import {
  InfrastructureWatchWay,
  findTemplateIdForMetricsView,
  getInitialWatchWay,
} from "../InfrastructureMonitorSetup/InfrastructureMonitorSetupText";
import IOT_FLEET_ONBOARDING from "../../../IoT/IoTFleetOnboarding";
import AddResourceModal from "../../../ResourceOnboarding/AddResourceModal";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

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

  /*
   * The template a saved step was made from shows picked; a new step starts
   * on the type's default alert once drawn.
   */
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<
    string | undefined
  >(() => {
    return findTemplateIdForMetricsView<IoTAlertTemplate>({
      templates: getAllIoTAlertTemplates(),
      getMetricsViewConfig: (template: IoTAlertTemplate) => {
        return MonitorStep.getMetricsViewConfig(
          template.getMonitorStep({
            fleetIdentifier: monitorStepIoTMonitor.fleetIdentifier || "",
            onlineMonitorStatusId: ObjectID.generate(),
            offlineMonitorStatusId: ObjectID.generate(),
            defaultIncidentSeverityId: ObjectID.generate(),
            defaultAlertSeverityId: ObjectID.generate(),
            monitorName: template.name,
          }),
        );
      },
      current: monitorStepIoTMonitor.metricViewConfig,
    });
  });

  const [initialWay] = React.useState<InfrastructureWatchWay>(() => {
    return getInitialWatchWay({
      queryCount: monitorStepIoTMonitor.metricViewConfig.queryConfigs.length,
      isTemplatePicked: Boolean(selectedTemplateId),
    });
  });

  /*
   * A template applied before any resource was picked is applied again once
   * one is, so its incident titles name it.
   */
  const templateAppliedWithoutResourceRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const [selectedMetricId, setSelectedMetricId] = React.useState<
    string | undefined
  >(undefined);
  const [customAggregation, setCustomAggregation] =
    React.useState<MetricsAggregationType>(MetricsAggregationType.Avg);

  const resources: InfrastructureResources<IoTFleet> =
    useInfrastructureResources<IoTFleet>({
      modelType: IoTFleet,
      select: {
        _id: true,
        lastSeenAt: true,
        name: true,
      },
      toOption: (fleet: IoTFleet): DropdownOption => {
        return {
          label: fleet.name || "Unknown",
          value: fleet.name || "",
        };
      },
      getLastSeenAt: (fleet: IoTFleet): Date | undefined => {
        return fleet.lastSeenAt;
      },
    });

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

  const applyTemplate: (
    template: IoTAlertTemplate,
    fleetIdentifier: string,
  ) => void = (template: IoTAlertTemplate, fleetIdentifier: string): void => {
    templateAppliedWithoutResourceRef.current = !fleetIdentifier;
    setSelectedTemplateId(template.id);
    // The template replaces the metric the Custom Metric tab picked.
    setSelectedMetricId(undefined);

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

  const handleTemplateSelection: (template: IoTAlertTemplate) => void = (
    template: IoTAlertTemplate,
  ): void => {
    applyTemplate(template, monitorStepIoTMonitor.fleetIdentifier);
  };

  // A new monitor starts on the alert most people want first.
  useEffect(() => {
    if (monitorStepIoTMonitor.metricViewConfig.queryConfigs.length > 0) {
      return;
    }

    const template: IoTAlertTemplate | undefined = getIoTAlertTemplateById(
      getIoTDefaultAlertTemplateId(),
    );

    if (template) {
      applyTemplate(template, monitorStepIoTMonitor.fleetIdentifier);
    }
  }, []);

  const changeResource: (fleetIdentifier: string) => void = (
    fleetIdentifier: string,
  ): void => {
    const template: IoTAlertTemplate | undefined = selectedTemplateId
      ? getIoTAlertTemplateById(selectedTemplateId)
      : undefined;

    if (
      template &&
      templateAppliedWithoutResourceRef.current &&
      fleetIdentifier
    ) {
      applyTemplate(template, fleetIdentifier);
      return;
    }

    props.onChange({
      ...monitorStepIoTMonitor,
      fleetIdentifier: fleetIdentifier,
    });
  };

  const handleCustomMetricSelection: (metric: IoTMetricDefinition) => void = (
    metric: IoTMetricDefinition,
  ): void => {
    setSelectedMetricId(metric.id);
    // The metric replaces the one Quick Setup's template set.
    setSelectedTemplateId(undefined);
    templateAppliedWithoutResourceRef.current = false;
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
    /*
     * The template's criteria compared the template's own metric; kept, they
     * judged this one by another threshold and named another incident. A
     * metric of your own starts on the out-of-the-box criteria: offline
     * while it sends nothing, online while it does.
     */
    if (props.onMonitorCriteriaChange) {
      props.onMonitorCriteriaChange(
        MonitorCriteria.getDefaultMonitorCriteria({
          monitorType: MonitorType.IoTDevice,
          monitorName: props.monitorName || metric.friendlyName,
          onlineMonitorStatusId:
            props.onlineMonitorStatusId || ObjectID.generate(),
          offlineMonitorStatusId:
            props.offlineMonitorStatusId || ObjectID.generate(),
          defaultIncidentSeverityId:
            props.defaultIncidentSeverityId || ObjectID.generate(),
          defaultAlertSeverityId:
            props.defaultAlertSeverityId || ObjectID.generate(),
        }),
      );
    }
  };

  const renderFleetDropdown: () => ReactElement = (): ReactElement => {
    return (
      <InfrastructureResourceField
        title="IoT Fleet"
        placeholder="Select an IoT fleet..."
        options={resources.options}
        value={monitorStepIoTMonitor.fleetIdentifier}
        onChange={changeResource}
        isLoading={resources.isLoading}
        lastSeenAtByValue={resources.lastSeenAtByValue}
        addResource={{
          title: IOT_FLEET_ONBOARDING.addTitle,
          renderModal: (input: {
            onClose: () => void;
            onConnected: (value: string) => void;
          }): ReactElement => {
            return (
              <AddResourceModal
                onboarding={IOT_FLEET_ONBOARDING}
                onClose={input.onClose}
                onConnected={(record: BaseModel) => {
                  input.onConnected(String((record as IoTFleet).name || ""));
                }}
              />
            );
          },
        }}
        onResourceAdded={(fleetIdentifier: string) => {
          resources
            .reload()
            .then(() => {
              changeResource(fleetIdentifier);
            })
            .catch(() => {
              // The list keeps what it had; the new one can be picked from it.
            });
        }}
      />
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

  return (
    <InfrastructureMonitorSetup
      resourceField={renderFleetDropdown()}
      alertTemplates={renderQuickSetup()}
      customMetric={renderCustomMetric()}
      queryBuilder={renderAdvanced()}
      initialWay={initialWay}
    />
  );
};

export default IoTMonitorStepForm;
