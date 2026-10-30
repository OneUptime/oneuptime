import MonitorStepDockerMonitor, {
  MonitorStepDockerMonitorUtil,
} from "Common/Types/Monitor/MonitorStepDockerMonitor";
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
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import DockerTemplatePicker from "./DockerTemplatePicker";
import DockerMetricPicker from "./DockerMetricPicker";
import {
  DockerAlertTemplate,
  buildDockerMonitorConfig,
  getDockerAlertTemplateById,
  getAllDockerAlertTemplates,
  getDockerDefaultAlertTemplateId,
} from "Common/Types/Monitor/DockerAlertTemplates";
import AlertTemplateConfiguration from "../AlertTemplatePicker/AlertTemplateConfiguration";
import { DockerMetricDefinition } from "Common/Types/Monitor/DockerMetricCatalog";
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
import DOCKER_HOST_ONBOARDING from "../../../Docker/DockerHostOnboarding";
import AddResourceModal from "../../../ResourceOnboarding/AddResourceModal";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

export interface ComponentProps {
  monitorStepDockerMonitor: MonitorStepDockerMonitor;
  onChange: (monitorStepDockerMonitor: MonitorStepDockerMonitor) => void;
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

const DockerMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [rollingTime, setRollingTime] = React.useState<RollingTime | null>(
    null,
  );

  const monitorStepDockerMonitor: MonitorStepDockerMonitor =
    props.monitorStepDockerMonitor || MonitorStepDockerMonitorUtil.getDefault();

  const [startAndEndTime, setStartAndEndTime] =
    React.useState<InBetween<Date> | null>(null);

  /*
   * The template a saved step was made from shows picked; a new step starts
   * on the type's default alert once drawn.
   */
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<
    string | undefined
  >(() => {
    return findTemplateIdForMetricsView<DockerAlertTemplate>({
      templates: getAllDockerAlertTemplates(),
      getMetricsViewConfig: (template: DockerAlertTemplate) => {
        return MonitorStep.getMetricsViewConfig(
          template.getMonitorStep({
            hostIdentifier: monitorStepDockerMonitor.hostIdentifier || "",
            onlineMonitorStatusId: ObjectID.generate(),
            offlineMonitorStatusId: ObjectID.generate(),
            defaultIncidentSeverityId: ObjectID.generate(),
            defaultAlertSeverityId: ObjectID.generate(),
            monitorName: template.name,
          }),
        );
      },
      current: monitorStepDockerMonitor.metricViewConfig,
    });
  });

  const [initialWay] = React.useState<InfrastructureWatchWay>(() => {
    return getInitialWatchWay({
      queryCount: monitorStepDockerMonitor.metricViewConfig.queryConfigs.length,
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

  const resources: InfrastructureResources<DockerHost> =
    useInfrastructureResources<DockerHost>({
      modelType: DockerHost,
      select: {
        _id: true,
        lastSeenAt: true,
        name: true,
        hostIdentifier: true,
      },
      toOption: (host: DockerHost): DropdownOption => {
        return {
          label: host.name || host.hostIdentifier || "Unknown",
          value: host.hostIdentifier || "",
        };
      },
      getLastSeenAt: (host: DockerHost): Date | undefined => {
        return host.lastSeenAt;
      },
    });

  useEffect(() => {
    if (rollingTime === monitorStepDockerMonitor.rollingTime) {
      return;
    }

    setRollingTime(monitorStepDockerMonitor.rollingTime);

    setStartAndEndTime(
      RollingTimeUtil.convertToStartAndEndDate(
        monitorStepDockerMonitor.rollingTime || RollingTime.Past1Minute,
      ),
    );
  }, [monitorStepDockerMonitor.rollingTime]);

  useEffect(() => {
    setStartAndEndTime(
      RollingTimeUtil.convertToStartAndEndDate(
        monitorStepDockerMonitor.rollingTime || RollingTime.Past1Minute,
      ),
    );
  }, []);

  const applyTemplate: (
    template: DockerAlertTemplate,
    hostIdentifier: string,
  ) => void = (template: DockerAlertTemplate, hostIdentifier: string): void => {
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

    if (templateStep.data?.dockerMonitor) {
      props.onChange({
        ...templateStep.data.dockerMonitor,
        hostIdentifier: hostIdentifier || "",
      });
    }

    if (templateStep.data?.monitorCriteria && props.onMonitorCriteriaChange) {
      props.onMonitorCriteriaChange(templateStep.data.monitorCriteria);
    }
  };

  const handleTemplateSelection: (template: DockerAlertTemplate) => void = (
    template: DockerAlertTemplate,
  ): void => {
    applyTemplate(template, monitorStepDockerMonitor.hostIdentifier);
  };

  // A new monitor starts on the alert most people want first.
  useEffect(() => {
    if (monitorStepDockerMonitor.metricViewConfig.queryConfigs.length > 0) {
      return;
    }

    const template: DockerAlertTemplate | undefined =
      getDockerAlertTemplateById(getDockerDefaultAlertTemplateId());

    if (template) {
      applyTemplate(template, monitorStepDockerMonitor.hostIdentifier);
    }
  }, []);

  const changeResource: (hostIdentifier: string) => void = (
    hostIdentifier: string,
  ): void => {
    const template: DockerAlertTemplate | undefined = selectedTemplateId
      ? getDockerAlertTemplateById(selectedTemplateId)
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
      ...monitorStepDockerMonitor,
      hostIdentifier: hostIdentifier,
    });
  };

  const handleCustomMetricSelection: (
    metric: DockerMetricDefinition,
  ) => void = (metric: DockerMetricDefinition): void => {
    setSelectedMetricId(metric.id);
    // The metric replaces the one Quick Setup's template set.
    setSelectedTemplateId(undefined);
    templateAppliedWithoutResourceRef.current = false;
    setCustomAggregation(metric.defaultAggregation);

    const hostIdentifier: string = monitorStepDockerMonitor.hostIdentifier;

    const config: MonitorStepDockerMonitor = buildDockerMonitorConfig({
      hostIdentifier: hostIdentifier || "",
      metricName: metric.metricName,
      metricAlias: metric.id.replace(/-/g, "_"),
      rollingTime:
        monitorStepDockerMonitor.rollingTime || RollingTime.Past5Minutes,
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
          monitorType: MonitorType.Docker,
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
        title="Docker Host"
        placeholder="Select a Docker host..."
        options={resources.options}
        value={monitorStepDockerMonitor.hostIdentifier}
        onChange={changeResource}
        isLoading={resources.isLoading}
        lastSeenAtByValue={resources.lastSeenAtByValue}
        addResource={{
          title: DOCKER_HOST_ONBOARDING.addTitle,
          renderModal: (input: {
            onClose: () => void;
            onConnected: (value: string) => void;
          }): ReactElement => {
            return (
              <AddResourceModal
                onboarding={DOCKER_HOST_ONBOARDING}
                onClose={input.onClose}
                onConnected={(record: BaseModel) => {
                  input.onConnected(
                    String((record as DockerHost).hostIdentifier || ""),
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
              monitorStepDockerMonitor.containerFilters.containerName || ""
            }
            onChange={(value: string) => {
              props.onChange({
                ...monitorStepDockerMonitor,
                containerFilters: {
                  ...monitorStepDockerMonitor.containerFilters,
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
              monitorStepDockerMonitor.containerFilters.containerImage || ""
            }
            onChange={(value: string) => {
              props.onChange({
                ...monitorStepDockerMonitor,
                containerFilters: {
                  ...monitorStepDockerMonitor.containerFilters,
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
        <DockerTemplatePicker
          selectedTemplateId={selectedTemplateId}
          onTemplateSelected={(template: DockerAlertTemplate) => {
            handleTemplateSelection(template);
          }}
        >
          <AlertTemplateConfiguration
            rollingTime={monitorStepDockerMonitor.rollingTime}
            onRollingTimeChange={(value: RollingTime) => {
              props.onChange({
                ...monitorStepDockerMonitor,
                rollingTime: value,
              });
            }}
          />
        </DockerTemplatePicker>
      </div>
    );
  };

  const renderCustomMetric: () => ReactElement = (): ReactElement => {
    return (
      <div className="mt-4 space-y-4">
        <div>
          <FieldLabelElement title="Docker Metric" required={true} />
          <DockerMetricPicker
            selectedMetricId={selectedMetricId}
            onMetricSelected={(metric: DockerMetricDefinition) => {
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
                    monitorStepDockerMonitor.metricViewConfig.queryConfigs
                      .length > 0
                  ) {
                    const currentQueryConfig: MetricQueryConfigData =
                      monitorStepDockerMonitor.metricViewConfig
                        .queryConfigs[0]!;
                    if (currentQueryConfig) {
                      props.onChange({
                        ...monitorStepDockerMonitor,
                        metricViewConfig: {
                          ...monitorStepDockerMonitor.metricViewConfig,
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
                value={monitorStepDockerMonitor.rollingTime}
                onChange={(value: RollingTime) => {
                  if (value === monitorStepDockerMonitor.rollingTime) {
                    return;
                  }

                  props.onChange({
                    ...monitorStepDockerMonitor,
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
            value={monitorStepDockerMonitor.rollingTime}
            onChange={(value: RollingTime) => {
              if (value === monitorStepDockerMonitor.rollingTime) {
                return;
              }

              props.onChange({
                ...monitorStepDockerMonitor,
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
                monitorStepDockerMonitor.metricViewConfig.queryConfigs,
              formulaConfigs:
                monitorStepDockerMonitor.metricViewConfig.formulaConfigs,
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
                ...monitorStepDockerMonitor,
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

export default DockerMonitorStepForm;
