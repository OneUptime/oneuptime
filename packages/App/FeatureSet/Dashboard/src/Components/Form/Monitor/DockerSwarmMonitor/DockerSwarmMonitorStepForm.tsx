import MonitorStepDockerSwarmMonitor, {
  MonitorStepDockerSwarmMonitorUtil,
} from "Common/Types/Monitor/MonitorStepDockerSwarmMonitor";
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
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import DockerSwarmTemplatePicker from "./DockerSwarmTemplatePicker";
import DockerSwarmMetricPicker from "./DockerSwarmMetricPicker";
import {
  DockerSwarmAlertTemplate,
  buildDockerSwarmMonitorConfig,
  getDockerSwarmAlertTemplateById,
  getAllDockerSwarmAlertTemplates,
  getDockerSwarmDefaultAlertTemplateId,
} from "Common/Types/Monitor/DockerSwarmAlertTemplates";
import AlertTemplateConfiguration from "../AlertTemplatePicker/AlertTemplateConfiguration";
import { DockerSwarmMetricDefinition } from "Common/Types/Monitor/DockerSwarmMetricCatalog";
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
import DOCKER_SWARM_CLUSTER_ONBOARDING from "../../../DockerSwarm/DockerSwarmClusterOnboarding";
import AddResourceModal from "../../../ResourceOnboarding/AddResourceModal";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

export interface ComponentProps {
  monitorStepDockerSwarmMonitor: MonitorStepDockerSwarmMonitor;
  onChange: (
    monitorStepDockerSwarmMonitor: MonitorStepDockerSwarmMonitor,
  ) => void;
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

const DockerSwarmMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [rollingTime, setRollingTime] = React.useState<RollingTime | null>(
    null,
  );

  const monitorStepDockerSwarmMonitor: MonitorStepDockerSwarmMonitor =
    props.monitorStepDockerSwarmMonitor ||
    MonitorStepDockerSwarmMonitorUtil.getDefault();

  const [startAndEndTime, setStartAndEndTime] =
    React.useState<InBetween<Date> | null>(null);

  /*
   * The template a saved step was made from shows picked; a new step starts
   * on the type's default alert once drawn.
   */
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<
    string | undefined
  >(() => {
    return findTemplateIdForMetricsView<DockerSwarmAlertTemplate>({
      templates: getAllDockerSwarmAlertTemplates(),
      getMetricsViewConfig: (template: DockerSwarmAlertTemplate) => {
        return MonitorStep.getMetricsViewConfig(
          template.getMonitorStep({
            clusterIdentifier:
              monitorStepDockerSwarmMonitor.clusterIdentifier || "",
            onlineMonitorStatusId: ObjectID.generate(),
            offlineMonitorStatusId: ObjectID.generate(),
            defaultIncidentSeverityId: ObjectID.generate(),
            defaultAlertSeverityId: ObjectID.generate(),
            monitorName: template.name,
          }),
        );
      },
      current: monitorStepDockerSwarmMonitor.metricViewConfig,
    });
  });

  const [initialWay] = React.useState<InfrastructureWatchWay>(() => {
    return getInitialWatchWay({
      queryCount:
        monitorStepDockerSwarmMonitor.metricViewConfig.queryConfigs.length,
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

  const resources: InfrastructureResources<DockerSwarmCluster> =
    useInfrastructureResources<DockerSwarmCluster>({
      modelType: DockerSwarmCluster,
      select: {
        _id: true,
        lastSeenAt: true,
        name: true,
      },
      toOption: (cluster: DockerSwarmCluster): DropdownOption => {
        return {
          label: cluster.name || "Unknown",
          value: cluster.name || "",
        };
      },
      getLastSeenAt: (cluster: DockerSwarmCluster): Date | undefined => {
        return cluster.lastSeenAt;
      },
    });

  useEffect(() => {
    if (rollingTime === monitorStepDockerSwarmMonitor.rollingTime) {
      return;
    }

    setRollingTime(monitorStepDockerSwarmMonitor.rollingTime);

    setStartAndEndTime(
      RollingTimeUtil.convertToStartAndEndDate(
        monitorStepDockerSwarmMonitor.rollingTime || RollingTime.Past1Minute,
      ),
    );
  }, [monitorStepDockerSwarmMonitor.rollingTime]);

  useEffect(() => {
    setStartAndEndTime(
      RollingTimeUtil.convertToStartAndEndDate(
        monitorStepDockerSwarmMonitor.rollingTime || RollingTime.Past1Minute,
      ),
    );
  }, []);

  const applyTemplate: (
    template: DockerSwarmAlertTemplate,
    clusterIdentifier: string,
  ) => void = (
    template: DockerSwarmAlertTemplate,
    clusterIdentifier: string,
  ): void => {
    templateAppliedWithoutResourceRef.current = !clusterIdentifier;
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
      clusterIdentifier: clusterIdentifier || "",
      onlineMonitorStatusId,
      offlineMonitorStatusId,
      defaultIncidentSeverityId,
      defaultAlertSeverityId,
      monitorName,
    });

    if (templateStep.data?.dockerSwarmMonitor) {
      props.onChange({
        ...templateStep.data.dockerSwarmMonitor,
        clusterIdentifier: clusterIdentifier || "",
      });
    }

    if (templateStep.data?.monitorCriteria && props.onMonitorCriteriaChange) {
      props.onMonitorCriteriaChange(templateStep.data.monitorCriteria);
    }
  };

  const handleTemplateSelection: (
    template: DockerSwarmAlertTemplate,
  ) => void = (template: DockerSwarmAlertTemplate): void => {
    applyTemplate(template, monitorStepDockerSwarmMonitor.clusterIdentifier);
  };

  // A new monitor starts on the alert most people want first.
  useEffect(() => {
    if (
      monitorStepDockerSwarmMonitor.metricViewConfig.queryConfigs.length > 0
    ) {
      return;
    }

    const template: DockerSwarmAlertTemplate | undefined =
      getDockerSwarmAlertTemplateById(getDockerSwarmDefaultAlertTemplateId());

    if (template) {
      applyTemplate(template, monitorStepDockerSwarmMonitor.clusterIdentifier);
    }
  }, []);

  const changeResource: (clusterIdentifier: string) => void = (
    clusterIdentifier: string,
  ): void => {
    const template: DockerSwarmAlertTemplate | undefined = selectedTemplateId
      ? getDockerSwarmAlertTemplateById(selectedTemplateId)
      : undefined;

    if (
      template &&
      templateAppliedWithoutResourceRef.current &&
      clusterIdentifier
    ) {
      applyTemplate(template, clusterIdentifier);
      return;
    }

    props.onChange({
      ...monitorStepDockerSwarmMonitor,
      clusterIdentifier: clusterIdentifier,
    });
  };

  const handleCustomMetricSelection: (
    metric: DockerSwarmMetricDefinition,
  ) => void = (metric: DockerSwarmMetricDefinition): void => {
    setSelectedMetricId(metric.id);
    // The metric replaces the one Quick Setup's template set.
    setSelectedTemplateId(undefined);
    templateAppliedWithoutResourceRef.current = false;
    setCustomAggregation(metric.defaultAggregation);

    const clusterIdentifier: string =
      monitorStepDockerSwarmMonitor.clusterIdentifier;

    const config: MonitorStepDockerSwarmMonitor = buildDockerSwarmMonitorConfig(
      {
        clusterIdentifier: clusterIdentifier || "",
        metricName: metric.metricName,
        metricAlias: metric.id.replace(/-/g, "_"),
        rollingTime:
          monitorStepDockerSwarmMonitor.rollingTime || RollingTime.Past5Minutes,
        aggregationType: metric.defaultAggregation,
        /*
         * Group by `resource.container.name` so each Swarm task is
         * evaluated independently — one incident per task container.
         * docker_stats emits container identity as an OTLP RESOURCE
         * attribute, so ClickHouse stores it `resource.`-prefixed; the
         * unprefixed key matches nothing and collapses every task in the
         * cluster into a single unnamed series.
         */
        groupByAttributeKey: "resource.container.name",
      },
    );

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
          monitorType: MonitorType.DockerSwarm,
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

  const renderClusterDropdown: () => ReactElement = (): ReactElement => {
    return (
      <InfrastructureResourceField
        title="Docker Swarm Cluster"
        placeholder="Select a Docker Swarm cluster..."
        options={resources.options}
        value={resources.valueOf({
          value: monitorStepDockerSwarmMonitor.clusterIdentifier,
          resourceId: monitorStepDockerSwarmMonitor.resourceId,
        })}
        onChange={changeResource}
        isLoading={resources.isLoading}
        lastSeenAtByValue={resources.lastSeenAtByValue}
        addResource={{
          title: DOCKER_SWARM_CLUSTER_ONBOARDING.addTitle,
          renderModal: (input: {
            onClose: () => void;
            onConnected: (value: string) => void;
          }): ReactElement => {
            return (
              <AddResourceModal
                onboarding={DOCKER_SWARM_CLUSTER_ONBOARDING}
                onClose={input.onClose}
                onConnected={(record: BaseModel) => {
                  input.onConnected(
                    String((record as DockerSwarmCluster).name || ""),
                  );
                }}
              />
            );
          },
        }}
        onResourceAdded={(clusterIdentifier: string) => {
          resources
            .reload()
            .then(() => {
              changeResource(clusterIdentifier);
            })
            .catch(() => {
              // The list keeps what it had; the new one can be picked from it.
            });
        }}
      />
    );
  };

  /*
   * Optional resource filters. The docker_stats receiver carries container
   * identity as RESOURCE attributes: container.name (a Swarm task is
   * `<service>.<slot>.<taskid>`) and container.image.name. The
   * node/service hints map to docker.swarm.node.name /
   * docker.swarm.service.name when the agent stamps them.
   */
  const renderResourceFilters: () => ReactElement = (): ReactElement => {
    return (
      <>
        <div className="mt-3">
          <FieldLabelElement
            title="Service Name"
            description={"Filter to a single Swarm service's tasks (optional)."}
            required={false}
          />
          <Input
            value={
              monitorStepDockerSwarmMonitor.resourceFilters.serviceName || ""
            }
            onChange={(value: string) => {
              props.onChange({
                ...monitorStepDockerSwarmMonitor,
                resourceFilters: {
                  ...monitorStepDockerSwarmMonitor.resourceFilters,
                  serviceName: value || undefined,
                },
              });
            }}
            placeholder="e.g. web"
          />
        </div>

        <div className="mt-3">
          <FieldLabelElement
            title="Node Name"
            description={
              "Filter to containers running on a single Swarm node (optional)."
            }
            required={false}
          />
          <Input
            value={monitorStepDockerSwarmMonitor.resourceFilters.nodeName || ""}
            onChange={(value: string) => {
              props.onChange({
                ...monitorStepDockerSwarmMonitor,
                resourceFilters: {
                  ...monitorStepDockerSwarmMonitor.resourceFilters,
                  nodeName: value || undefined,
                },
              });
            }}
            placeholder="e.g. swarm-node-1"
          />
        </div>

        <div className="mt-3">
          <FieldLabelElement
            title="Container Name"
            description={
              "Filter to a single task's container — a Swarm task container is named `<service>.<slot>.<taskid>` (optional)."
            }
            required={false}
          />
          <Input
            value={
              monitorStepDockerSwarmMonitor.resourceFilters.containerName || ""
            }
            onChange={(value: string) => {
              props.onChange({
                ...monitorStepDockerSwarmMonitor,
                resourceFilters: {
                  ...monitorStepDockerSwarmMonitor.resourceFilters,
                  containerName: value || undefined,
                },
              });
            }}
            placeholder="e.g. web.1.abc123"
          />
        </div>

        <div className="mt-3">
          <FieldLabelElement
            title="Container Image"
            description={
              "Filter to tasks running a given container image (optional)."
            }
            required={false}
          />
          <Input
            value={
              monitorStepDockerSwarmMonitor.resourceFilters.containerImage || ""
            }
            onChange={(value: string) => {
              props.onChange({
                ...monitorStepDockerSwarmMonitor,
                resourceFilters: {
                  ...monitorStepDockerSwarmMonitor.resourceFilters,
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
        <DockerSwarmTemplatePicker
          selectedTemplateId={selectedTemplateId}
          onTemplateSelected={(template: DockerSwarmAlertTemplate) => {
            handleTemplateSelection(template);
          }}
        >
          <AlertTemplateConfiguration
            rollingTime={monitorStepDockerSwarmMonitor.rollingTime}
            onRollingTimeChange={(value: RollingTime) => {
              props.onChange({
                ...monitorStepDockerSwarmMonitor,
                rollingTime: value,
              });
            }}
          />
        </DockerSwarmTemplatePicker>
      </div>
    );
  };

  const renderCustomMetric: () => ReactElement = (): ReactElement => {
    return (
      <div className="mt-4 space-y-4">
        <div>
          <FieldLabelElement title="Docker Swarm Metric" required={true} />
          <DockerSwarmMetricPicker
            selectedMetricId={selectedMetricId}
            onMetricSelected={(metric: DockerSwarmMetricDefinition) => {
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
                    monitorStepDockerSwarmMonitor.metricViewConfig.queryConfigs
                      .length > 0
                  ) {
                    const currentQueryConfig: MetricQueryConfigData =
                      monitorStepDockerSwarmMonitor.metricViewConfig
                        .queryConfigs[0]!;
                    if (currentQueryConfig) {
                      props.onChange({
                        ...monitorStepDockerSwarmMonitor,
                        metricViewConfig: {
                          ...monitorStepDockerSwarmMonitor.metricViewConfig,
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
                value={monitorStepDockerSwarmMonitor.rollingTime}
                onChange={(value: RollingTime) => {
                  if (value === monitorStepDockerSwarmMonitor.rollingTime) {
                    return;
                  }

                  props.onChange({
                    ...monitorStepDockerSwarmMonitor,
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
            value={monitorStepDockerSwarmMonitor.rollingTime}
            onChange={(value: RollingTime) => {
              if (value === monitorStepDockerSwarmMonitor.rollingTime) {
                return;
              }

              props.onChange({
                ...monitorStepDockerSwarmMonitor,
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
                monitorStepDockerSwarmMonitor.metricViewConfig.queryConfigs,
              formulaConfigs:
                monitorStepDockerSwarmMonitor.metricViewConfig.formulaConfigs,
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
            onChange={(viewData: MetricViewData) => {
              props.onChange({
                ...monitorStepDockerSwarmMonitor,
                metricViewConfig: {
                  queryConfigs: viewData.queryConfigs,
                  formulaConfigs: viewData.formulaConfigs,
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
      resourceField={renderClusterDropdown()}
      alertTemplates={renderQuickSetup()}
      customMetric={renderCustomMetric()}
      queryBuilder={renderAdvanced()}
      initialWay={initialWay}
    />
  );
};

export default DockerSwarmMonitorStepForm;
