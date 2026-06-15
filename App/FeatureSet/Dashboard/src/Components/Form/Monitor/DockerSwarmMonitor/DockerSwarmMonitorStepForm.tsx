import MonitorStepDockerSwarmMonitor, {
  MonitorStepDockerSwarmMonitorUtil,
} from "Common/Types/Monitor/MonitorStepDockerSwarmMonitor";
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
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import DockerSwarmTemplatePicker from "./DockerSwarmTemplatePicker";
import DockerSwarmMetricPicker from "./DockerSwarmMetricPicker";
import {
  DockerSwarmAlertTemplate,
  buildDockerSwarmMonitorConfig,
} from "Common/Types/Monitor/DockerSwarmAlertTemplates";
import { DockerSwarmMetricDefinition } from "Common/Types/Monitor/DockerSwarmMetricCatalog";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";

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
    ModelAPI.getList<DockerSwarmCluster>({
      modelType: DockerSwarmCluster,
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
      .then((result: ListResult<DockerSwarmCluster>) => {
        const options: Array<DropdownOption> = result.data.map(
          (cluster: DockerSwarmCluster) => {
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

  const handleTemplateSelection: (
    template: DockerSwarmAlertTemplate,
  ) => void = (template: DockerSwarmAlertTemplate): void => {
    setSelectedTemplateId(template.id);

    const clusterIdentifier: string =
      monitorStepDockerSwarmMonitor.clusterIdentifier;

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

  const handleCustomMetricSelection: (
    metric: DockerSwarmMetricDefinition,
  ) => void = (metric: DockerSwarmMetricDefinition): void => {
    setSelectedMetricId(metric.id);
    setCustomAggregation(metric.defaultAggregation);

    const clusterIdentifier: string =
      monitorStepDockerSwarmMonitor.clusterIdentifier;

    const config: MonitorStepDockerSwarmMonitor = buildDockerSwarmMonitorConfig(
      {
        clusterIdentifier: clusterIdentifier || "",
        metricName: metric.metricName,
        metricAlias: metric.id.replace(/-/g, "_"),
        rollingTime:
          monitorStepDockerSwarmMonitor.rollingTime ||
          RollingTime.Past5Minutes,
        aggregationType: metric.defaultAggregation,
        /*
         * Group by container.name so each Swarm task is evaluated
         * independently — one incident per task container.
         */
        groupByAttributeKey: "container.name",
      },
    );

    props.onChange(config);
  };

  const renderClusterDropdown: () => ReactElement = (): ReactElement => {
    return (
      <div className="mb-4">
        <FieldLabelElement
          title="Docker Swarm Cluster"
          description={"Select the Docker Swarm cluster to monitor."}
          required={true}
        />
        <Dropdown
          options={clusterOptions}
          value={clusterOptions.find((option: DropdownOption) => {
            return (
              option.value ===
              monitorStepDockerSwarmMonitor.clusterIdentifier
            );
          })}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            props.onChange({
              ...monitorStepDockerSwarmMonitor,
              clusterIdentifier: (value as string) || "",
            });
          }}
          placeholder="Select a Docker Swarm cluster..."
        />
      </div>
    );
  };

  /*
   * Optional resource filters. The docker_stats receiver keeps container
   * identity in datapoint labels: container.name (a Swarm task is
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
            description={
              "Filter to a single Swarm service's tasks (optional)."
            }
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
            value={
              monitorStepDockerSwarmMonitor.resourceFilters.nodeName || ""
            }
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
        )}
      </div>
    );
  };

  const renderCustomMetric: () => ReactElement = (): ReactElement => {
    return (
      <div className="mt-4 space-y-4">
        <div>
          <FieldLabelElement
            title="Docker Swarm Metric"
            description={
              "Select a Docker Swarm metric to monitor. Metrics are organized by category."
            }
            required={true}
          />
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
                description={
                  "Select the time range for the Docker Swarm monitor."
                }
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
            description={"Select the time range for the Docker Swarm monitor."}
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
          <FieldLabelElement
            title="Select Metrics"
            description={
              "Select the Docker Swarm metrics to monitor. Use the query builder for full control over metric selection and filtering."
            }
            required={true}
          />

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

export default DockerSwarmMonitorStepForm;
