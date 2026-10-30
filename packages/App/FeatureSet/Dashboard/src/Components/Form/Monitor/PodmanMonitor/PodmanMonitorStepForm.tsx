import MonitorStepPodmanMonitor, {
  MonitorStepPodmanMonitorUtil,
} from "Common/Types/Monitor/MonitorStepPodmanMonitor";
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
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import PodmanTemplatePicker from "./PodmanTemplatePicker";
import PodmanMetricPicker from "./PodmanMetricPicker";
import {
  PodmanAlertTemplate,
  buildPodmanMonitorConfig,
  getPodmanAlertTemplateById,
  getAllPodmanAlertTemplates,
  getPodmanDefaultAlertTemplateId,
} from "Common/Types/Monitor/PodmanAlertTemplates";
import AlertTemplateConfiguration from "../AlertTemplatePicker/AlertTemplateConfiguration";
import { PodmanMetricDefinition } from "Common/Types/Monitor/PodmanMetricCatalog";
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
import PODMAN_HOST_ONBOARDING from "../../../Podman/PodmanHostOnboarding";
import AddResourceModal from "../../../ResourceOnboarding/AddResourceModal";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

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

  /*
   * The template a saved step was made from shows picked; a new step starts
   * on the type's default alert once drawn.
   */
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<
    string | undefined
  >(() => {
    return findTemplateIdForMetricsView<PodmanAlertTemplate>({
      templates: getAllPodmanAlertTemplates(),
      getMetricsViewConfig: (template: PodmanAlertTemplate) => {
        return MonitorStep.getMetricsViewConfig(
          template.getMonitorStep({
            hostIdentifier: monitorStepPodmanMonitor.hostIdentifier || "",
            onlineMonitorStatusId: ObjectID.generate(),
            offlineMonitorStatusId: ObjectID.generate(),
            defaultIncidentSeverityId: ObjectID.generate(),
            defaultAlertSeverityId: ObjectID.generate(),
            monitorName: template.name,
          }),
        );
      },
      current: monitorStepPodmanMonitor.metricViewConfig,
    });
  });

  const [initialWay] = React.useState<InfrastructureWatchWay>(() => {
    return getInitialWatchWay({
      queryCount: monitorStepPodmanMonitor.metricViewConfig.queryConfigs.length,
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

  const resources: InfrastructureResources<PodmanHost> =
    useInfrastructureResources<PodmanHost>({
      modelType: PodmanHost,
      select: {
        _id: true,
        lastSeenAt: true,
        name: true,
        hostIdentifier: true,
      },
      toOption: (host: PodmanHost): DropdownOption => {
        return {
          label: host.name || host.hostIdentifier || "Unknown",
          value: host.hostIdentifier || "",
        };
      },
      getLastSeenAt: (host: PodmanHost): Date | undefined => {
        return host.lastSeenAt;
      },
    });

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

  const applyTemplate: (
    template: PodmanAlertTemplate,
    hostIdentifier: string,
  ) => void = (template: PodmanAlertTemplate, hostIdentifier: string): void => {
    templateAppliedWithoutResourceRef.current = !hostIdentifier;
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

  const handleTemplateSelection: (template: PodmanAlertTemplate) => void = (
    template: PodmanAlertTemplate,
  ): void => {
    applyTemplate(template, monitorStepPodmanMonitor.hostIdentifier);
  };

  // A new monitor starts on the alert most people want first.
  useEffect(() => {
    if (monitorStepPodmanMonitor.metricViewConfig.queryConfigs.length > 0) {
      return;
    }

    const template: PodmanAlertTemplate | undefined =
      getPodmanAlertTemplateById(getPodmanDefaultAlertTemplateId());

    if (template) {
      applyTemplate(template, monitorStepPodmanMonitor.hostIdentifier);
    }
  }, []);

  const changeResource: (hostIdentifier: string) => void = (
    hostIdentifier: string,
  ): void => {
    const template: PodmanAlertTemplate | undefined = selectedTemplateId
      ? getPodmanAlertTemplateById(selectedTemplateId)
      : undefined;

    if (
      template &&
      templateAppliedWithoutResourceRef.current &&
      hostIdentifier
    ) {
      applyTemplate(template, hostIdentifier);
      return;
    }

    props.onChange({
      ...monitorStepPodmanMonitor,
      hostIdentifier: hostIdentifier,
    });
  };

  const handleCustomMetricSelection: (
    metric: PodmanMetricDefinition,
  ) => void = (metric: PodmanMetricDefinition): void => {
    setSelectedMetricId(metric.id);
    // The metric replaces the one Quick Setup's template set.
    setSelectedTemplateId(undefined);
    templateAppliedWithoutResourceRef.current = false;
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
    /*
     * The template's criteria compared the template's own metric; kept, they
     * judged this one by another threshold and named another incident. A
     * metric of your own starts on the out-of-the-box criteria: offline
     * while it sends nothing, online while it does.
     */
    if (props.onMonitorCriteriaChange) {
      props.onMonitorCriteriaChange(
        MonitorCriteria.getDefaultMonitorCriteria({
          monitorType: MonitorType.Podman,
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

  const renderHostDropdown: () => ReactElement = (): ReactElement => {
    return (
      <InfrastructureResourceField
        title="Podman Host"
        placeholder="Select a Podman host..."
        options={resources.options}
        value={monitorStepPodmanMonitor.hostIdentifier}
        onChange={changeResource}
        isLoading={resources.isLoading}
        lastSeenAtByValue={resources.lastSeenAtByValue}
        addResource={{
          title: PODMAN_HOST_ONBOARDING.addTitle,
          renderModal: (input: {
            onClose: () => void;
            onConnected: (value: string) => void;
          }): ReactElement => {
            return (
              <AddResourceModal
                onboarding={PODMAN_HOST_ONBOARDING}
                onClose={input.onClose}
                onConnected={(record: BaseModel) => {
                  input.onConnected(
                    String((record as PodmanHost).hostIdentifier || ""),
                  );
                }}
              />
            );
          },
        }}
        onResourceAdded={(hostIdentifier: string) => {
          resources
            .reload()
            .then(() => {
              changeResource(hostIdentifier);
            })
            .catch(() => {
              // The list keeps what it had; the new one can be picked from it.
            });
        }}
      />
    );
  };

  const renderContainerFilters: () => ReactElement = (): ReactElement => {
    return (
      <>
        <div className="mt-3">
          <FieldLabelElement title="Container Name" required={false} />
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
          <FieldLabelElement title="Container Image" required={false} />
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
        >
          <AlertTemplateConfiguration
            rollingTime={monitorStepPodmanMonitor.rollingTime}
            onRollingTimeChange={(value: RollingTime) => {
              props.onChange({
                ...monitorStepPodmanMonitor,
                rollingTime: value,
              });
            }}
          />
        </PodmanTemplatePicker>
      </div>
    );
  };

  const renderCustomMetric: () => ReactElement = (): ReactElement => {
    return (
      <div className="mt-4 space-y-4">
        <div>
          <FieldLabelElement title="Podman Metric" required={true} />
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
                description={"How far back each check looks."}
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
            description={"How far back each check looks."}
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
          <FieldLabelElement title="Select Metrics" required={true} />

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
            /*
             * The preview charts the monitor's rolling window, which the
             * form saves with the monitor. A drag zooms the preview alone
             * and never reaches the form; a double-click (or Reset zoom)
             * brings the rolling window back.
             */
            localChartZoom={true}
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

  return (
    <InfrastructureMonitorSetup
      resourceField={renderHostDropdown()}
      alertTemplates={renderQuickSetup()}
      customMetric={renderCustomMetric()}
      queryBuilder={renderAdvanced()}
      initialWay={initialWay}
    />
  );
};

export default PodmanMonitorStepForm;
