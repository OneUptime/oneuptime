import MonitorStepHostMonitor, {
  MonitorStepHostMonitorUtil,
} from "Common/Types/Monitor/MonitorStepHostMonitor";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
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
import Host from "Common/Models/DatabaseModels/Host";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import HostTemplatePicker from "./HostTemplatePicker";
import HostMetricPicker from "./HostMetricPicker";
import {
  HostAlertTemplate,
  buildHostMonitorConfig,
  getAllHostAlertTemplates,
  getHostAlertTemplateById,
  getHostDefaultAlertTemplateId,
} from "Common/Types/Monitor/HostAlertTemplates";
import AlertTemplateConfiguration from "../AlertTemplatePicker/AlertTemplateConfiguration";
import { HostMetricDefinition } from "Common/Types/Monitor/HostMetricCatalog";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import AddHostModal from "../../../HostCollector/AddHostModal";
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

export interface ComponentProps {
  monitorStepHostMonitor: MonitorStepHostMonitor;
  onChange: (monitorStepHostMonitor: MonitorStepHostMonitor) => void;
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

const HostMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [rollingTime, setRollingTime] = React.useState<RollingTime | null>(
    null,
  );

  const monitorStepHostMonitor: MonitorStepHostMonitor =
    props.monitorStepHostMonitor || MonitorStepHostMonitorUtil.getDefault();

  const [startAndEndTime, setStartAndEndTime] =
    React.useState<InBetween<Date> | null>(null);

  const hosts: InfrastructureResources<Host> = useInfrastructureResources<Host>(
    {
      modelType: Host,
      select: {
        _id: true,
        name: true,
        hostIdentifier: true,
        lastSeenAt: true,
      },
      toOption: (host: Host): DropdownOption => {
        return {
          label: host.name || host.hostIdentifier || "Unknown",
          value: host.hostIdentifier || "",
        };
      },
      getLastSeenAt: (host: Host): Date | undefined => {
        return host.lastSeenAt;
      },
    },
  );

  /*
   * The template a saved step was made from shows picked; a new step starts
   * on the type's default (Host Stopped Reporting) once drawn.
   */
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<
    string | undefined
  >(() => {
    return findTemplateIdForMetricsView<HostAlertTemplate>({
      templates: getAllHostAlertTemplates(),
      getMetricsViewConfig: (template: HostAlertTemplate) => {
        return MonitorStep.getMetricsViewConfig(
          template.getMonitorStep({
            hostIdentifier: monitorStepHostMonitor.hostIdentifier || "",
            onlineMonitorStatusId: ObjectID.generate(),
            offlineMonitorStatusId: ObjectID.generate(),
            defaultIncidentSeverityId: ObjectID.generate(),
            defaultAlertSeverityId: ObjectID.generate(),
            monitorName: template.name,
          }),
        );
      },
      current: monitorStepHostMonitor.metricViewConfig,
    });
  });

  const [initialWay] = React.useState<InfrastructureWatchWay>(() => {
    return getInitialWatchWay({
      queryCount: monitorStepHostMonitor.metricViewConfig.queryConfigs.length,
      isTemplatePicked: Boolean(selectedTemplateId),
    });
  });

  /*
   * A template applied before any host was picked is applied again once one
   * is, so its incident titles name the host.
   */
  const templateAppliedWithoutHostRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const [selectedMetricId, setSelectedMetricId] = React.useState<
    string | undefined
  >(undefined);
  const [customAggregation, setCustomAggregation] =
    React.useState<MetricsAggregationType>(MetricsAggregationType.Avg);

  useEffect(() => {
    if (rollingTime === monitorStepHostMonitor.rollingTime) {
      return;
    }

    setRollingTime(monitorStepHostMonitor.rollingTime);

    setStartAndEndTime(
      RollingTimeUtil.convertToStartAndEndDate(
        monitorStepHostMonitor.rollingTime || RollingTime.Past1Minute,
      ),
    );
  }, [monitorStepHostMonitor.rollingTime]);

  useEffect(() => {
    setStartAndEndTime(
      RollingTimeUtil.convertToStartAndEndDate(
        monitorStepHostMonitor.rollingTime || RollingTime.Past1Minute,
      ),
    );
  }, []);

  const applyTemplate: (
    template: HostAlertTemplate,
    hostIdentifier: string,
  ) => void = (template: HostAlertTemplate, hostIdentifier: string): void => {
    setSelectedTemplateId(template.id);
    // The template replaces the metric the Custom Metric tab picked.
    setSelectedMetricId(undefined);
    templateAppliedWithoutHostRef.current = !hostIdentifier;

    const templateStep: MonitorStep = template.getMonitorStep({
      hostIdentifier: hostIdentifier || "",
      onlineMonitorStatusId: props.onlineMonitorStatusId || ObjectID.generate(),
      offlineMonitorStatusId:
        props.offlineMonitorStatusId || ObjectID.generate(),
      defaultIncidentSeverityId:
        props.defaultIncidentSeverityId || ObjectID.generate(),
      defaultAlertSeverityId:
        props.defaultAlertSeverityId || ObjectID.generate(),
      monitorName: props.monitorName || template.name,
    });

    if (templateStep.data?.hostMonitor) {
      props.onChange({
        ...templateStep.data.hostMonitor,
        hostIdentifier: hostIdentifier || "",
      });
    }

    if (templateStep.data?.monitorCriteria && props.onMonitorCriteriaChange) {
      props.onMonitorCriteriaChange(templateStep.data.monitorCriteria);
    }
  };

  // A new monitor starts on the alert most people want first.
  useEffect(() => {
    if (monitorStepHostMonitor.metricViewConfig.queryConfigs.length > 0) {
      return;
    }

    const template: HostAlertTemplate | undefined = getHostAlertTemplateById(
      getHostDefaultAlertTemplateId(),
    );

    if (template) {
      applyTemplate(template, monitorStepHostMonitor.hostIdentifier);
    }
  }, []);

  const changeHost: (hostIdentifier: string) => void = (
    hostIdentifier: string,
  ): void => {
    const template: HostAlertTemplate | undefined = selectedTemplateId
      ? getHostAlertTemplateById(selectedTemplateId)
      : undefined;

    if (template && templateAppliedWithoutHostRef.current && hostIdentifier) {
      applyTemplate(template, hostIdentifier);
      return;
    }

    props.onChange({
      ...monitorStepHostMonitor,
      hostIdentifier: hostIdentifier,
    });
  };

  const handleCustomMetricSelection: (metric: HostMetricDefinition) => void = (
    metric: HostMetricDefinition,
  ): void => {
    setSelectedMetricId(metric.id);
    // The metric replaces the one Quick Setup's template set.
    setSelectedTemplateId(undefined);
    templateAppliedWithoutHostRef.current = false;
    setCustomAggregation(metric.defaultAggregation);

    const config: MonitorStepHostMonitor = buildHostMonitorConfig({
      hostIdentifier: monitorStepHostMonitor.hostIdentifier || "",
      metricName: metric.metricName,
      metricAlias: metric.id.replace(/-/g, "_"),
      rollingTime:
        monitorStepHostMonitor.rollingTime || RollingTime.Past5Minutes,
      aggregationType: metric.defaultAggregation,
      ...(metric.attributes ? { attributes: metric.attributes } : {}),
      groupByAttributeKeys: metric.groupByAttributeKeys,
    });

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
          monitorType: MonitorType.Host,
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

  const renderHostField: () => ReactElement = (): ReactElement => {
    return (
      <InfrastructureResourceField
        title="Host"
        placeholder="Select a host..."
        options={hosts.options}
        value={monitorStepHostMonitor.hostIdentifier}
        onChange={changeHost}
        isLoading={hosts.isLoading}
        lastSeenAtByValue={hosts.lastSeenAtByValue}
        addResource={{
          title: "Add Host",
          renderModal: (input: {
            onClose: () => void;
            onConnected: (value: string) => void;
          }): ReactElement => {
            return (
              <AddHostModal
                onClose={input.onClose}
                onHostConnected={(host: Host) => {
                  input.onConnected(host.hostIdentifier || "");
                }}
              />
            );
          },
        }}
        onResourceAdded={(hostIdentifier: string) => {
          hosts
            .reload()
            .then(() => {
              changeHost(hostIdentifier);
            })
            .catch(() => {
              // The list keeps what it had; the host can be picked from it.
            });
        }}
      />
    );
  };

  const renderQuickSetup: () => ReactElement = (): ReactElement => {
    return (
      <HostTemplatePicker
        selectedTemplateId={selectedTemplateId}
        onTemplateSelected={(template: HostAlertTemplate) => {
          applyTemplate(template, monitorStepHostMonitor.hostIdentifier);
        }}
      >
        <AlertTemplateConfiguration
          rollingTime={monitorStepHostMonitor.rollingTime}
          onRollingTimeChange={(value: RollingTime) => {
            props.onChange({
              ...monitorStepHostMonitor,
              rollingTime: value,
            });
          }}
        />
      </HostTemplatePicker>
    );
  };

  const renderCustomMetric: () => ReactElement = (): ReactElement => {
    return (
      <div className="mt-4 space-y-4">
        <div>
          <FieldLabelElement title="Host Metric" required={true} />
          <HostMetricPicker
            selectedMetricId={selectedMetricId}
            onMetricSelected={(metric: HostMetricDefinition) => {
              handleCustomMetricSelection(metric);
            }}
          />
        </div>

        {selectedMetricId && (
          <>
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
                    monitorStepHostMonitor.metricViewConfig.queryConfigs
                      .length > 0
                  ) {
                    const currentQueryConfig: MetricQueryConfigData =
                      monitorStepHostMonitor.metricViewConfig.queryConfigs[0]!;
                    if (currentQueryConfig) {
                      props.onChange({
                        ...monitorStepHostMonitor,
                        metricViewConfig: {
                          ...monitorStepHostMonitor.metricViewConfig,
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
                value={monitorStepHostMonitor.rollingTime}
                onChange={(value: RollingTime) => {
                  if (value === monitorStepHostMonitor.rollingTime) {
                    return;
                  }

                  props.onChange({
                    ...monitorStepHostMonitor,
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
        <div className="mt-3">
          <FieldLabelElement
            title="Time Range"
            description={"How far back each check looks."}
            required={true}
          />
          <RollingTimePicker
            value={monitorStepHostMonitor.rollingTime}
            onChange={(value: RollingTime) => {
              if (value === monitorStepHostMonitor.rollingTime) {
                return;
              }

              props.onChange({
                ...monitorStepHostMonitor,
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
              queryConfigs:
                monitorStepHostMonitor.metricViewConfig.queryConfigs,
              formulaConfigs:
                monitorStepHostMonitor.metricViewConfig.formulaConfigs,
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
                ...monitorStepHostMonitor,
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
      resourceField={renderHostField()}
      alertTemplates={renderQuickSetup()}
      customMetric={renderCustomMetric()}
      queryBuilder={renderAdvanced()}
      initialWay={initialWay}
    />
  );
};

export default HostMonitorStepForm;
