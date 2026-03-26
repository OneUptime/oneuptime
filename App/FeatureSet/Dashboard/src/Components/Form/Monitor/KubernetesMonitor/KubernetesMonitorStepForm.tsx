import MonitorStepKubernetesMonitor, {
  MonitorStepKubernetesMonitorUtil,
  KubernetesResourceScope,
} from "Common/Types/Monitor/MonitorStepKubernetesMonitor";
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
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import KubernetesTemplatePicker from "./KubernetesTemplatePicker";
import KubernetesMetricPicker from "./KubernetesMetricPicker";
import {
  KubernetesAlertTemplate,
  getKubernetesAlertTemplateById,
  buildKubernetesMonitorConfig,
} from "Common/Types/Monitor/KubernetesAlertTemplates";
import { KubernetesMetricDefinition } from "Common/Types/Monitor/KubernetesMetricCatalog";
import Navigation from "Common/UI/Utils/Navigation";

export type KubernetesFormMode = "quick" | "custom" | "advanced";

export interface ComponentProps {
  monitorStepKubernetesMonitor: MonitorStepKubernetesMonitor;
  onChange: (
    monitorStepKubernetesMonitor: MonitorStepKubernetesMonitor,
  ) => void;
  onModeChange?: ((mode: KubernetesFormMode) => void) | undefined;
  initialTemplateId?: string | undefined;
  initialClusterId?: string | undefined;
}

const resourceScopeOptions: Array<DropdownOption> = [
  {
    label: "Cluster",
    value: KubernetesResourceScope.Cluster,
  },
  {
    label: "Namespace",
    value: KubernetesResourceScope.Namespace,
  },
  {
    label: "Workload",
    value: KubernetesResourceScope.Workload,
  },
  {
    label: "Node",
    value: KubernetesResourceScope.Node,
  },
  {
    label: "Pod",
    value: KubernetesResourceScope.Pod,
  },
];

const aggregationOptions: Array<DropdownOption> = [
  { label: "Average", value: MetricsAggregationType.Avg },
  { label: "Maximum", value: MetricsAggregationType.Max },
  { label: "Minimum", value: MetricsAggregationType.Min },
  { label: "Sum", value: MetricsAggregationType.Sum },
  { label: "Count", value: MetricsAggregationType.Count },
];

const KubernetesMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  // Read query params for template/cluster pre-fill
  const urlTemplateId: string | undefined =
    props.initialTemplateId ||
    Navigation.getQueryStringByName("templateId") ||
    undefined;
  const urlClusterId: string | undefined =
    props.initialClusterId ||
    Navigation.getQueryStringByName("clusterId") ||
    undefined;

  const [, setMode] = React.useState<KubernetesFormMode>("quick");

  const [rollingTime, setRollingTime] = React.useState<RollingTime | null>(
    null,
  );

  const monitorStepKubernetesMonitor: MonitorStepKubernetesMonitor =
    props.monitorStepKubernetesMonitor ||
    MonitorStepKubernetesMonitorUtil.getDefault();

  const [startAndEndTime, setStartAndEndTime] =
    React.useState<InBetween<Date> | null>(null);

  const [clusterOptions, setClusterOptions] = React.useState<
    Array<DropdownOption>
  >([]);

  const [, setIsLoadingClusters] = React.useState<boolean>(true);

  // Quick Setup state
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<
    string | undefined
  >(urlTemplateId);

  // Custom Metric state
  const [selectedMetricId, setSelectedMetricId] = React.useState<
    string | undefined
  >(undefined);
  const [customAggregation, setCustomAggregation] =
    React.useState<MetricsAggregationType>(MetricsAggregationType.Avg);
  const [customResourceScope, setCustomResourceScope] =
    React.useState<KubernetesResourceScope>(KubernetesResourceScope.Cluster);

  useEffect(() => {
    // Load clusters
    setIsLoadingClusters(true);
    ModelAPI.getList<KubernetesCluster>({
      modelType: KubernetesCluster,
      query: {},
      select: {
        _id: true,
        name: true,
        clusterIdentifier: true,
      },
      sort: {
        name: SortOrder.Ascending,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
    })
      .then((result: ListResult<KubernetesCluster>) => {
        const options: Array<DropdownOption> = result.data.map(
          (cluster: KubernetesCluster) => {
            return {
              label: cluster.name || cluster.clusterIdentifier || "Unknown",
              value: cluster.clusterIdentifier || "",
            };
          },
        );
        setClusterOptions(options);

        // Auto-select cluster if initialClusterId or URL param is provided
        if (urlClusterId && !monitorStepKubernetesMonitor.clusterIdentifier) {
          const matchedCluster: DropdownOption | undefined = options.find(
            (o: DropdownOption) => {
              return o.value === urlClusterId;
            },
          );
          if (matchedCluster) {
            props.onChange({
              ...monitorStepKubernetesMonitor,
              clusterIdentifier: matchedCluster.value as string,
            });
          }
        }
      })
      .catch((_err: Error) => {
        setClusterOptions([]);
      })
      .finally(() => {
        setIsLoadingClusters(false);
      });
  }, []);

  // Handle initial template selection
  useEffect(() => {
    if (urlTemplateId && monitorStepKubernetesMonitor.clusterIdentifier) {
      const template: KubernetesAlertTemplate | undefined =
        getKubernetesAlertTemplateById(urlTemplateId);
      if (template) {
        handleTemplateSelection(template);
      }
    }
  }, [props.initialTemplateId, monitorStepKubernetesMonitor.clusterIdentifier]);

  useEffect(() => {
    if (rollingTime === monitorStepKubernetesMonitor.rollingTime) {
      return;
    }

    setRollingTime(monitorStepKubernetesMonitor.rollingTime);

    setStartAndEndTime(
      RollingTimeUtil.convertToStartAndEndDate(
        monitorStepKubernetesMonitor.rollingTime || RollingTime.Past1Minute,
      ),
    );
  }, [monitorStepKubernetesMonitor.rollingTime]);

  useEffect(() => {
    setStartAndEndTime(
      RollingTimeUtil.convertToStartAndEndDate(
        monitorStepKubernetesMonitor.rollingTime || RollingTime.Past1Minute,
      ),
    );
  }, []);

  const handleTemplateSelection: (template: KubernetesAlertTemplate) => void = (
    template: KubernetesAlertTemplate,
  ): void => {
    setSelectedTemplateId(template.id);

    /*
     * Build the kubernetes monitor config from the template's getMonitorStep
     * We need the cluster identifier to build the config
     */
    const clusterIdentifier: string =
      monitorStepKubernetesMonitor.clusterIdentifier;

    // Get a dummy monitor step from the template to extract the kubernetes config
    // Build even without a cluster so the metricViewConfig is populated for the METRIC dropdown
    const dummyStep: MonitorStep = template.getMonitorStep({
      clusterIdentifier: clusterIdentifier || "",
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      monitorName: template.name,
    });

    // Extract the kubernetes monitor config
    if (dummyStep.data?.kubernetesMonitor) {
      props.onChange({
        ...dummyStep.data.kubernetesMonitor,
        clusterIdentifier: clusterIdentifier || "",
      });
    }
  };

  const handleCustomMetricSelection: (
    metric: KubernetesMetricDefinition,
  ) => void = (metric: KubernetesMetricDefinition): void => {
    setSelectedMetricId(metric.id);
    setCustomAggregation(metric.defaultAggregation);
    setCustomResourceScope(metric.defaultResourceScope);

    const clusterIdentifier: string =
      monitorStepKubernetesMonitor.clusterIdentifier;

    const config: MonitorStepKubernetesMonitor = buildKubernetesMonitorConfig({
      clusterIdentifier: clusterIdentifier || "",
      metricName: metric.metricName,
      metricAlias: metric.id.replace(/-/g, "_"),
      resourceScope: metric.defaultResourceScope,
      rollingTime:
        monitorStepKubernetesMonitor.rollingTime || RollingTime.Past5Minutes,
      aggregationType: metric.defaultAggregation,
    });

    props.onChange(config);
  };

  const showNamespaceFilter: boolean =
    monitorStepKubernetesMonitor.resourceScope ===
      KubernetesResourceScope.Namespace ||
    monitorStepKubernetesMonitor.resourceScope ===
      KubernetesResourceScope.Workload ||
    monitorStepKubernetesMonitor.resourceScope === KubernetesResourceScope.Pod;

  const showWorkloadFilter: boolean =
    monitorStepKubernetesMonitor.resourceScope ===
    KubernetesResourceScope.Workload;

  const showNodeFilter: boolean =
    monitorStepKubernetesMonitor.resourceScope === KubernetesResourceScope.Node;

  const showPodFilter: boolean =
    monitorStepKubernetesMonitor.resourceScope === KubernetesResourceScope.Pod;

  const renderClusterDropdown: () => ReactElement = (): ReactElement => {
    return (
      <div className="mb-4">
        <FieldLabelElement
          title="Kubernetes Cluster"
          description={"Select the Kubernetes cluster to monitor."}
          required={true}
        />
        <Dropdown
          options={clusterOptions}
          value={clusterOptions.find((option: DropdownOption) => {
            return (
              option.value === monitorStepKubernetesMonitor.clusterIdentifier
            );
          })}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            props.onChange({
              ...monitorStepKubernetesMonitor,
              clusterIdentifier: (value as string) || "",
            });
          }}
          placeholder="Select a cluster..."
        />
      </div>
    );
  };

  const renderResourceFilters: () => ReactElement = (): ReactElement => {
    return (
      <>
        {showNamespaceFilter && (
          <div className="mt-3">
            <FieldLabelElement
              title="Namespace"
              description={"Filter by namespace (optional)."}
              required={false}
            />
            <Input
              value={
                monitorStepKubernetesMonitor.resourceFilters.namespace || ""
              }
              onChange={(value: string) => {
                props.onChange({
                  ...monitorStepKubernetesMonitor,
                  resourceFilters: {
                    ...monitorStepKubernetesMonitor.resourceFilters,
                    namespace: value || undefined,
                  },
                });
              }}
              placeholder="e.g. default, production"
            />
          </div>
        )}

        {showWorkloadFilter && (
          <div className="mt-3">
            <FieldLabelElement
              title="Workload Name"
              description={"Filter by workload name (optional)."}
              required={false}
            />
            <Input
              value={
                monitorStepKubernetesMonitor.resourceFilters.workloadName || ""
              }
              onChange={(value: string) => {
                props.onChange({
                  ...monitorStepKubernetesMonitor,
                  resourceFilters: {
                    ...monitorStepKubernetesMonitor.resourceFilters,
                    workloadName: value || undefined,
                  },
                });
              }}
              placeholder="e.g. my-deployment"
            />
          </div>
        )}

        {showNodeFilter && (
          <div className="mt-3">
            <FieldLabelElement
              title="Node Name"
              description={"Filter by node name (optional)."}
              required={false}
            />
            <Input
              value={
                monitorStepKubernetesMonitor.resourceFilters.nodeName || ""
              }
              onChange={(value: string) => {
                props.onChange({
                  ...monitorStepKubernetesMonitor,
                  resourceFilters: {
                    ...monitorStepKubernetesMonitor.resourceFilters,
                    nodeName: value || undefined,
                  },
                });
              }}
              placeholder="e.g. node-1"
            />
          </div>
        )}

        {showPodFilter && (
          <div className="mt-3">
            <FieldLabelElement
              title="Pod Name"
              description={"Filter by pod name (optional)."}
              required={false}
            />
            <Input
              value={monitorStepKubernetesMonitor.resourceFilters.podName || ""}
              onChange={(value: string) => {
                props.onChange({
                  ...monitorStepKubernetesMonitor,
                  resourceFilters: {
                    ...monitorStepKubernetesMonitor.resourceFilters,
                    podName: value || undefined,
                  },
                });
              }}
              placeholder="e.g. my-pod-abc123"
            />
          </div>
        )}
      </>
    );
  };

  const renderQuickSetup: () => ReactElement = (): ReactElement => {
    return (
      <div className="mt-4">
        <KubernetesTemplatePicker
          selectedTemplateId={selectedTemplateId}
          onTemplateSelected={(template: KubernetesAlertTemplate) => {
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
              value={monitorStepKubernetesMonitor.rollingTime}
              onChange={(value: RollingTime) => {
                if (value === monitorStepKubernetesMonitor.rollingTime) {
                  return;
                }

                props.onChange({
                  ...monitorStepKubernetesMonitor,
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
            title="Kubernetes Metric"
            description={
              "Select a Kubernetes metric to monitor. Metrics are organized by resource type."
            }
            required={true}
          />
          <KubernetesMetricPicker
            selectedMetricId={selectedMetricId}
            onMetricSelected={(metric: KubernetesMetricDefinition) => {
              handleCustomMetricSelection(metric);
            }}
          />
        </div>

        {selectedMetricId && (
          <>
            <div>
              <FieldLabelElement
                title="Resource Scope"
                description={"Select the scope of resources to monitor."}
                required={true}
              />
              <Dropdown
                options={resourceScopeOptions}
                value={resourceScopeOptions.find((option: DropdownOption) => {
                  return option.value === customResourceScope;
                })}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  const newScope: KubernetesResourceScope =
                    (value as KubernetesResourceScope) ||
                    KubernetesResourceScope.Cluster;
                  setCustomResourceScope(newScope);
                  props.onChange({
                    ...monitorStepKubernetesMonitor,
                    resourceScope: newScope,
                    resourceFilters: {},
                  });
                }}
                placeholder="Select resource scope..."
              />
            </div>

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

                  // Rebuild the config with updated aggregation
                  if (
                    monitorStepKubernetesMonitor.metricViewConfig.queryConfigs
                      .length > 0
                  ) {
                    const currentQueryConfig: MetricQueryConfigData =
                      monitorStepKubernetesMonitor.metricViewConfig
                        .queryConfigs[0]!;
                    if (currentQueryConfig) {
                      props.onChange({
                        ...monitorStepKubernetesMonitor,
                        metricViewConfig: {
                          ...monitorStepKubernetesMonitor.metricViewConfig,
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
                  "Select the time range for the Kubernetes monitor."
                }
                required={true}
              />
              <RollingTimePicker
                value={monitorStepKubernetesMonitor.rollingTime}
                onChange={(value: RollingTime) => {
                  if (value === monitorStepKubernetesMonitor.rollingTime) {
                    return;
                  }

                  props.onChange({
                    ...monitorStepKubernetesMonitor,
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
        <div>
          <FieldLabelElement
            title="Resource Scope"
            description={"Select the scope of resources to monitor."}
            required={true}
          />
          <Dropdown
            options={resourceScopeOptions}
            value={resourceScopeOptions.find((option: DropdownOption) => {
              return (
                option.value === monitorStepKubernetesMonitor.resourceScope
              );
            })}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              props.onChange({
                ...monitorStepKubernetesMonitor,
                resourceScope:
                  (value as KubernetesResourceScope) ||
                  KubernetesResourceScope.Cluster,
                resourceFilters: {},
              });
            }}
            placeholder="Select resource scope..."
          />
        </div>

        {renderResourceFilters()}

        <div className="mt-3">
          <FieldLabelElement
            title="Time Range"
            description={"Select the time range for the Kubernetes monitor."}
            required={true}
          />
          <RollingTimePicker
            value={monitorStepKubernetesMonitor.rollingTime}
            onChange={(value: RollingTime) => {
              if (value === monitorStepKubernetesMonitor.rollingTime) {
                return;
              }

              props.onChange({
                ...monitorStepKubernetesMonitor,
                rollingTime: value,
              });
            }}
          />
        </div>

        <div className="mt-3">
          <FieldLabelElement
            title="Select Metrics"
            description={
              "Select the Kubernetes metrics to monitor. Use the query builder for full control over metric selection and filtering."
            }
            required={true}
          />

          <div className="mt-3"></div>

          <MetricView
            hideStartAndEndDate={true}
            data={{
              startAndEndDate: startAndEndTime,
              queryConfigs:
                monitorStepKubernetesMonitor.metricViewConfig.queryConfigs,
              formulaConfigs:
                monitorStepKubernetesMonitor.metricViewConfig.formulaConfigs,
            }}
            hideCardInQueryElements={true}
            hideCardInCharts={true}
            chartCssClass="rounded-md border border-gray-200 mt-2 shadow-none"
            onChange={(data: MetricViewData) => {
              props.onChange({
                ...monitorStepKubernetesMonitor,
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

      <Tabs
        tabs={tabs}
        onTabChange={(tab: Tab) => {
          let newMode: KubernetesFormMode = "quick";
          if (tab.name === "Quick Setup") {
            newMode = "quick";
          } else if (tab.name === "Custom Metric") {
            newMode = "custom";
          } else if (tab.name === "Advanced") {
            newMode = "advanced";
          }
          setMode(newMode);
          props.onModeChange?.(newMode);
        }}
      />
    </div>
  );
};

export default KubernetesMonitorStepForm;
