import MonitorStepKubernetesMonitor, {
  DEFAULT_KUBERNETES_WORKLOAD_KIND,
  KUBERNETES_WORKLOAD_KINDS,
  MonitorStepKubernetesMonitorUtil,
  KubernetesResourceScope,
} from "Common/Types/Monitor/MonitorStepKubernetesMonitor";
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
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import KubernetesTemplatePicker from "./KubernetesTemplatePicker";
import KubernetesMetricPicker from "./KubernetesMetricPicker";
import {
  KubernetesAlertTemplate,
  getKubernetesAlertTemplateById,
  buildKubernetesMonitorConfig,
  getAllKubernetesAlertTemplates,
  getKubernetesDefaultAlertTemplateId,
} from "Common/Types/Monitor/KubernetesAlertTemplates";
import AlertTemplateConfiguration from "../AlertTemplatePicker/AlertTemplateConfiguration";
import { KubernetesMetricDefinition } from "Common/Types/Monitor/KubernetesMetricCatalog";
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
import KUBERNETES_CLUSTER_ONBOARDING from "../../../Kubernetes/KubernetesClusterOnboarding";
import AddResourceModal from "../../../ResourceOnboarding/AddResourceModal";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Navigation from "Common/UI/Utils/Navigation";

export interface ComponentProps {
  monitorStepKubernetesMonitor: MonitorStepKubernetesMonitor;
  onChange: (
    monitorStepKubernetesMonitor: MonitorStepKubernetesMonitor,
  ) => void;
  onMonitorCriteriaChange?: ((criteria: MonitorCriteria) => void) | undefined;
  initialTemplateId?: string | undefined;
  initialClusterId?: string | undefined;
  // These IDs are needed to build proper criteria from templates
  onlineMonitorStatusId?: ObjectID | undefined;
  offlineMonitorStatusId?: ObjectID | undefined;
  defaultIncidentSeverityId?: ObjectID | undefined;
  defaultAlertSeverityId?: ObjectID | undefined;
  monitorName?: string | undefined;
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

// The kinds of workload a Workload Name can name; Deployment first.
const workloadKindOptions: Array<DropdownOption> =
  KUBERNETES_WORKLOAD_KINDS.map(
    (kind: { label: string; value: string }): DropdownOption => {
      return { label: kind.label, value: kind.value };
    },
  );

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

  const [rollingTime, setRollingTime] = React.useState<RollingTime | null>(
    null,
  );

  const monitorStepKubernetesMonitor: MonitorStepKubernetesMonitor =
    props.monitorStepKubernetesMonitor ||
    MonitorStepKubernetesMonitorUtil.getDefault();

  const [startAndEndTime, setStartAndEndTime] =
    React.useState<InBetween<Date> | null>(null);

  /*
   * The template a saved step was made from shows picked; a new step starts
   * on the type's default alert once drawn.
   */
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<
    string | undefined
  >(() => {
    // A link names its template; else the one a saved step was made from.
    if (urlTemplateId) {
      return urlTemplateId;
    }

    return findTemplateIdForMetricsView<KubernetesAlertTemplate>({
      templates: getAllKubernetesAlertTemplates(),
      getMetricsViewConfig: (template: KubernetesAlertTemplate) => {
        return MonitorStep.getMetricsViewConfig(
          template.getMonitorStep({
            clusterIdentifier:
              monitorStepKubernetesMonitor.clusterIdentifier || "",
            onlineMonitorStatusId: ObjectID.generate(),
            offlineMonitorStatusId: ObjectID.generate(),
            defaultIncidentSeverityId: ObjectID.generate(),
            defaultAlertSeverityId: ObjectID.generate(),
            monitorName: template.name,
          }),
        );
      },
      current: monitorStepKubernetesMonitor.metricViewConfig,
    });
  });

  const [initialWay] = React.useState<InfrastructureWatchWay>(() => {
    return getInitialWatchWay({
      queryCount:
        monitorStepKubernetesMonitor.metricViewConfig.queryConfigs.length,
      isTemplatePicked: Boolean(selectedTemplateId),
    });
  });

  /*
   * A template applied before any resource was picked is applied again once
   * one is, so its incident titles name it.
   */
  const templateAppliedWithoutResourceRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  // Custom Metric state
  const [selectedMetricId, setSelectedMetricId] = React.useState<
    string | undefined
  >(undefined);
  const [customAggregation, setCustomAggregation] =
    React.useState<MetricsAggregationType>(MetricsAggregationType.Avg);
  const [customResourceScope, setCustomResourceScope] =
    React.useState<KubernetesResourceScope>(KubernetesResourceScope.Cluster);

  const resources: InfrastructureResources<KubernetesCluster> =
    useInfrastructureResources<KubernetesCluster>({
      modelType: KubernetesCluster,
      select: {
        _id: true,
        lastSeenAt: true,
        name: true,
        clusterIdentifier: true,
      },
      toOption: (cluster: KubernetesCluster): DropdownOption => {
        return {
          label: cluster.name || cluster.clusterIdentifier || "Unknown",
          value: cluster.clusterIdentifier || "",
        };
      },
      getLastSeenAt: (cluster: KubernetesCluster): Date | undefined => {
        return cluster.lastSeenAt;
      },
    });

  // Pick the cluster a link named, once the list is in.
  useEffect(() => {
    if (!urlClusterId || monitorStepKubernetesMonitor.clusterIdentifier) {
      return;
    }

    const matchedCluster: DropdownOption | undefined = resources.options.find(
      (option: DropdownOption) => {
        return option.value === urlClusterId;
      },
    );

    if (matchedCluster) {
      props.onChange({
        ...monitorStepKubernetesMonitor,
        clusterIdentifier: matchedCluster.value as string,
      });
    }
  }, [resources.options.length]);

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

  const applyTemplate: (
    template: KubernetesAlertTemplate,
    clusterIdentifier: string,
  ) => void = (
    template: KubernetesAlertTemplate,
    clusterIdentifier: string,
  ): void => {
    templateAppliedWithoutResourceRef.current = !clusterIdentifier;
    setSelectedTemplateId(template.id);
    // The template replaces the metric the Custom Metric tab picked.
    setSelectedMetricId(undefined);

    /*
     * Build the kubernetes monitor config from the template's getMonitorStep
     * We need the cluster identifier to build the config
     */

    /*
     * Use real monitor status and severity IDs if available,
     * so the template criteria are properly configured
     */
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

    // Extract the kubernetes monitor config
    if (templateStep.data?.kubernetesMonitor) {
      props.onChange({
        ...templateStep.data.kubernetesMonitor,
        clusterIdentifier: clusterIdentifier || "",
      });
    }

    // Also apply the template's criteria (alert rules, thresholds, incidents, etc.)
    if (templateStep.data?.monitorCriteria && props.onMonitorCriteriaChange) {
      props.onMonitorCriteriaChange(templateStep.data.monitorCriteria);
    }
  };

  const handleTemplateSelection: (template: KubernetesAlertTemplate) => void = (
    template: KubernetesAlertTemplate,
  ): void => {
    applyTemplate(template, monitorStepKubernetesMonitor.clusterIdentifier);
  };

  // A new monitor starts on the alert most people want first.
  useEffect(() => {
    if (
      urlTemplateId ||
      monitorStepKubernetesMonitor.metricViewConfig.queryConfigs.length > 0
    ) {
      return;
    }

    const template: KubernetesAlertTemplate | undefined =
      getKubernetesAlertTemplateById(getKubernetesDefaultAlertTemplateId());

    if (template) {
      applyTemplate(template, monitorStepKubernetesMonitor.clusterIdentifier);
    }
  }, []);

  const changeResource: (clusterIdentifier: string) => void = (
    clusterIdentifier: string,
  ): void => {
    const template: KubernetesAlertTemplate | undefined = selectedTemplateId
      ? getKubernetesAlertTemplateById(selectedTemplateId)
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
      ...monitorStepKubernetesMonitor,
      clusterIdentifier: clusterIdentifier,
    });
  };

  const handleCustomMetricSelection: (
    metric: KubernetesMetricDefinition,
  ) => void = (metric: KubernetesMetricDefinition): void => {
    setSelectedMetricId(metric.id);
    // The metric replaces the one Quick Setup's template set.
    setSelectedTemplateId(undefined);
    templateAppliedWithoutResourceRef.current = false;
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
    /*
     * The template's criteria compared the template's own metric; kept, they
     * judged this one by another threshold and named another incident. A
     * metric of your own starts on the out-of-the-box criteria: offline
     * while it sends nothing, online while it does.
     */
    if (props.onMonitorCriteriaChange) {
      props.onMonitorCriteriaChange(
        MonitorCriteria.getDefaultMonitorCriteria({
          monitorType: MonitorType.Kubernetes,
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
      <InfrastructureResourceField
        title="Kubernetes Cluster"
        placeholder="Select a cluster..."
        options={resources.options}
        value={resources.valueOf({
          value: monitorStepKubernetesMonitor.clusterIdentifier,
          resourceId: monitorStepKubernetesMonitor.resourceId,
        })}
        onChange={changeResource}
        isLoading={resources.isLoading}
        lastSeenAtByValue={resources.lastSeenAtByValue}
        addResource={{
          title: KUBERNETES_CLUSTER_ONBOARDING.addTitle,
          renderModal: (input: {
            onClose: () => void;
            onConnected: (value: string) => void;
          }): ReactElement => {
            return (
              <AddResourceModal
                onboarding={KUBERNETES_CLUSTER_ONBOARDING}
                onClose={input.onClose}
                onConnected={(record: BaseModel) => {
                  input.onConnected(
                    String(
                      (record as KubernetesCluster).clusterIdentifier || "",
                    ),
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

  const renderResourceFilters: () => ReactElement = (): ReactElement => {
    return (
      <>
        {showNamespaceFilter && (
          <div className="mt-3">
            <FieldLabelElement title="Namespace" required={false} />
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
            <FieldLabelElement title="Workload Kind" required={false} />
            <Dropdown
              options={workloadKindOptions}
              value={workloadKindOptions.find((option: DropdownOption) => {
                return (
                  option.value ===
                  (
                    monitorStepKubernetesMonitor.resourceFilters.workloadType ||
                    DEFAULT_KUBERNETES_WORKLOAD_KIND
                  ).toLowerCase()
                );
              })}
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                props.onChange({
                  ...monitorStepKubernetesMonitor,
                  resourceFilters: {
                    ...monitorStepKubernetesMonitor.resourceFilters,
                    workloadType:
                      (value as string) || DEFAULT_KUBERNETES_WORKLOAD_KIND,
                  },
                });
              }}
            />
          </div>
        )}

        {showWorkloadFilter && (
          <div className="mt-3">
            <FieldLabelElement title="Workload Name" required={false} />
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
                    /*
                     * The kind travels with the name: the worker reads a
                     * name as the kind's (Deployment unless picked).
                     */
                    workloadType:
                      monitorStepKubernetesMonitor.resourceFilters
                        .workloadType || DEFAULT_KUBERNETES_WORKLOAD_KIND,
                  },
                });
              }}
              placeholder="e.g. my-deployment"
            />
          </div>
        )}

        {showNodeFilter && (
          <div className="mt-3">
            <FieldLabelElement title="Node Name" required={false} />
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
            <FieldLabelElement title="Pod Name" required={false} />
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
        >
          <AlertTemplateConfiguration
            rollingTime={monitorStepKubernetesMonitor.rollingTime}
            onRollingTimeChange={(value: RollingTime) => {
              props.onChange({
                ...monitorStepKubernetesMonitor,
                rollingTime: value,
              });
            }}
          />
        </KubernetesTemplatePicker>
      </div>
    );
  };

  const renderCustomMetric: () => ReactElement = (): ReactElement => {
    return (
      <div className="mt-4 space-y-4">
        <div>
          <FieldLabelElement title="Kubernetes Metric" required={true} />
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
                description={
                  "The level the metric is watched at. It decides which filters you see."
                }
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
                description={"How far back each check looks."}
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
            description={
              "The level the metric is watched at. It decides which filters you see."
            }
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
            description={"How far back each check looks."}
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
          <FieldLabelElement title="Select Metrics" required={true} />

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

export default KubernetesMonitorStepForm;
