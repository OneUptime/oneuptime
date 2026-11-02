import MonitorStepProxmoxMonitor, {
  MonitorStepProxmoxMonitorUtil,
  ProxmoxResourceScope,
} from "Common/Types/Monitor/MonitorStepProxmoxMonitor";
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
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import ProxmoxTemplatePicker from "./ProxmoxTemplatePicker";
import ProxmoxMetricPicker from "./ProxmoxMetricPicker";
import {
  ProxmoxAlertTemplate,
  buildProxmoxMonitorConfig,
  getProxmoxAlertTemplateById,
  getAllProxmoxAlertTemplates,
  getProxmoxDefaultAlertTemplateId,
} from "Common/Types/Monitor/ProxmoxAlertTemplates";
import AlertTemplateConfiguration from "../AlertTemplatePicker/AlertTemplateConfiguration";
import { ProxmoxMetricDefinition } from "Common/Types/Monitor/ProxmoxMetricCatalog";
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
import PROXMOX_CLUSTER_ONBOARDING from "../../../Proxmox/ProxmoxClusterOnboarding";
import AddResourceModal from "../../../ResourceOnboarding/AddResourceModal";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

export interface ComponentProps {
  monitorStepProxmoxMonitor: MonitorStepProxmoxMonitor;
  onChange: (monitorStepProxmoxMonitor: MonitorStepProxmoxMonitor) => void;
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
 * Values are byte-equal to the `pve.scope` datapoint attribute stamped
 * by the agent's OTTL transform, so the monitor worker maps the filter
 * to attribute equality with no translation.
 */
const scopeOptions: Array<DropdownOption> = [
  { label: "Node", value: ProxmoxResourceScope.Node },
  { label: "Guest (VM / container)", value: ProxmoxResourceScope.Guest },
  { label: "Storage", value: ProxmoxResourceScope.Storage },
  { label: "Cluster", value: ProxmoxResourceScope.Cluster },
];

const ProxmoxMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [rollingTime, setRollingTime] = React.useState<RollingTime | null>(
    null,
  );

  const monitorStepProxmoxMonitor: MonitorStepProxmoxMonitor =
    props.monitorStepProxmoxMonitor ||
    MonitorStepProxmoxMonitorUtil.getDefault();

  const [startAndEndTime, setStartAndEndTime] =
    React.useState<InBetween<Date> | null>(null);

  /*
   * The template a saved step was made from shows picked; a new step starts
   * on the type's default alert once drawn.
   */
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<
    string | undefined
  >(() => {
    return findTemplateIdForMetricsView<ProxmoxAlertTemplate>({
      templates: getAllProxmoxAlertTemplates(),
      getMetricsViewConfig: (template: ProxmoxAlertTemplate) => {
        return MonitorStep.getMetricsViewConfig(
          template.getMonitorStep({
            clusterIdentifier:
              monitorStepProxmoxMonitor.clusterIdentifier || "",
            onlineMonitorStatusId: ObjectID.generate(),
            offlineMonitorStatusId: ObjectID.generate(),
            defaultIncidentSeverityId: ObjectID.generate(),
            defaultAlertSeverityId: ObjectID.generate(),
            monitorName: template.name,
          }),
        );
      },
      current: monitorStepProxmoxMonitor.metricViewConfig,
    });
  });

  const [initialWay] = React.useState<InfrastructureWatchWay>(() => {
    return getInitialWatchWay({
      queryCount:
        monitorStepProxmoxMonitor.metricViewConfig.queryConfigs.length,
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

  const resources: InfrastructureResources<ProxmoxCluster> =
    useInfrastructureResources<ProxmoxCluster>({
      modelType: ProxmoxCluster,
      select: {
        _id: true,
        lastSeenAt: true,
        name: true,
      },
      toOption: (cluster: ProxmoxCluster): DropdownOption => {
        return {
          label: cluster.name || "Unknown",
          value: cluster.name || "",
        };
      },
      getLastSeenAt: (cluster: ProxmoxCluster): Date | undefined => {
        return cluster.lastSeenAt;
      },
    });

  useEffect(() => {
    if (rollingTime === monitorStepProxmoxMonitor.rollingTime) {
      return;
    }

    setRollingTime(monitorStepProxmoxMonitor.rollingTime);

    setStartAndEndTime(
      RollingTimeUtil.convertToStartAndEndDate(
        monitorStepProxmoxMonitor.rollingTime || RollingTime.Past1Minute,
      ),
    );
  }, [monitorStepProxmoxMonitor.rollingTime]);

  useEffect(() => {
    setStartAndEndTime(
      RollingTimeUtil.convertToStartAndEndDate(
        monitorStepProxmoxMonitor.rollingTime || RollingTime.Past1Minute,
      ),
    );
  }, []);

  const applyTemplate: (
    template: ProxmoxAlertTemplate,
    clusterIdentifier: string,
  ) => void = (
    template: ProxmoxAlertTemplate,
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

    if (templateStep.data?.proxmoxMonitor) {
      props.onChange({
        ...templateStep.data.proxmoxMonitor,
        clusterIdentifier: clusterIdentifier || "",
      });
    }

    if (templateStep.data?.monitorCriteria && props.onMonitorCriteriaChange) {
      props.onMonitorCriteriaChange(templateStep.data.monitorCriteria);
    }
  };

  const handleTemplateSelection: (template: ProxmoxAlertTemplate) => void = (
    template: ProxmoxAlertTemplate,
  ): void => {
    applyTemplate(template, monitorStepProxmoxMonitor.clusterIdentifier);
  };

  // A new monitor starts on the alert most people want first.
  useEffect(() => {
    if (monitorStepProxmoxMonitor.metricViewConfig.queryConfigs.length > 0) {
      return;
    }

    const template: ProxmoxAlertTemplate | undefined =
      getProxmoxAlertTemplateById(getProxmoxDefaultAlertTemplateId());

    if (template) {
      applyTemplate(template, monitorStepProxmoxMonitor.clusterIdentifier);
    }
  }, []);

  const changeResource: (clusterIdentifier: string) => void = (
    clusterIdentifier: string,
  ): void => {
    const template: ProxmoxAlertTemplate | undefined = selectedTemplateId
      ? getProxmoxAlertTemplateById(selectedTemplateId)
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
      ...monitorStepProxmoxMonitor,
      clusterIdentifier: clusterIdentifier,
    });
  };

  const handleCustomMetricSelection: (
    metric: ProxmoxMetricDefinition,
  ) => void = (metric: ProxmoxMetricDefinition): void => {
    setSelectedMetricId(metric.id);
    // The metric replaces the one Quick Setup's template set.
    setSelectedTemplateId(undefined);
    templateAppliedWithoutResourceRef.current = false;
    setCustomAggregation(metric.defaultAggregation);

    const clusterIdentifier: string =
      monitorStepProxmoxMonitor.clusterIdentifier;

    const config: MonitorStepProxmoxMonitor = buildProxmoxMonitorConfig({
      clusterIdentifier: clusterIdentifier || "",
      metricName: metric.metricName,
      metricAlias: metric.id.replace(/-/g, "_"),
      rollingTime:
        monitorStepProxmoxMonitor.rollingTime || RollingTime.Past5Minutes,
      aggregationType: metric.defaultAggregation,
    });

    /*
     * Pre-fill the scope filter from the catalog's
     * defaultResourceScope. Cluster means "spans multiple scopes;
     * don't pre-filter" — leave the filter empty in that case.
     */
    if (metric.defaultResourceScope !== ProxmoxResourceScope.Cluster) {
      config.resourceFilters = {
        ...config.resourceFilters,
        scope: metric.defaultResourceScope,
      };
    }

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
          monitorType: MonitorType.Proxmox,
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
        title="Proxmox Cluster"
        placeholder="Select a Proxmox cluster..."
        options={resources.options}
        value={resources.valueOf({
          value: monitorStepProxmoxMonitor.clusterIdentifier,
          resourceId: monitorStepProxmoxMonitor.resourceId,
        })}
        onChange={changeResource}
        isLoading={resources.isLoading}
        lastSeenAtByValue={resources.lastSeenAtByValue}
        addResource={{
          title: PROXMOX_CLUSTER_ONBOARDING.addTitle,
          renderModal: (input: {
            onClose: () => void;
            onConnected: (value: string) => void;
          }): ReactElement => {
            return (
              <AddResourceModal
                onboarding={PROXMOX_CLUSTER_ONBOARDING}
                onClose={input.onClose}
                onConnected={(record: BaseModel) => {
                  input.onConnected(
                    String((record as ProxmoxCluster).name || ""),
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
   * Filter precedence in the worker (MonitorTelemetryMonitor): guestId
   * (raw `id` label) wins over everything; nodeName maps to
   * pve.scope=node + pve.id; scope and pveId map to their attributes
   * independently. No name-based filter is offered — pve-exporter only
   * carries `name` on the *_info metadata series, so a name filter
   * would silently match zero rows on every data metric.
   */
  const renderResourceFilters: () => ReactElement = (): ReactElement => {
    return (
      <>
        <div className="mt-3">
          <FieldLabelElement
            title="Resource Scope"
            description={
              "Filter by resource type — nodes, guests, or storage volumes (optional)."
            }
            required={false}
          />
          <Dropdown
            options={scopeOptions}
            value={scopeOptions.find((option: DropdownOption) => {
              return (
                option.value === monitorStepProxmoxMonitor.resourceFilters.scope
              );
            })}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              props.onChange({
                ...monitorStepProxmoxMonitor,
                resourceFilters: {
                  ...monitorStepProxmoxMonitor.resourceFilters,
                  scope: (value as ProxmoxResourceScope) || undefined,
                },
              });
            }}
            placeholder="All resource types"
          />
        </div>

        <div className="mt-3">
          <FieldLabelElement
            title="PVE ID"
            description={
              "A node name (`pve1`), a VMID (`100`) or `<node>/<storage>` (`pve1/local`). Pair it with a scope to target one resource."
            }
            required={false}
          />
          <Input
            value={monitorStepProxmoxMonitor.resourceFilters.pveId || ""}
            onChange={(value: string) => {
              props.onChange({
                ...monitorStepProxmoxMonitor,
                resourceFilters: {
                  ...monitorStepProxmoxMonitor.resourceFilters,
                  pveId: value || undefined,
                },
              });
            }}
            placeholder="e.g. pve1, 100, or pve1/local"
          />
        </div>

        <div className="mt-3">
          <FieldLabelElement
            title="Node Name"
            description={
              "Filter to a single node's OWN series (optional). This cannot scope guests/storage by their parent node."
            }
            required={false}
          />
          <Input
            value={monitorStepProxmoxMonitor.resourceFilters.nodeName || ""}
            onChange={(value: string) => {
              props.onChange({
                ...monitorStepProxmoxMonitor,
                resourceFilters: {
                  ...monitorStepProxmoxMonitor.resourceFilters,
                  nodeName: value || undefined,
                },
              });
            }}
            placeholder="e.g. pve1"
          />
        </div>

        <div className="mt-3">
          <FieldLabelElement
            title="Guest ID"
            description={
              "Filter by guest id — the raw `id` datapoint label (optional). Wins over the other filters when set."
            }
            required={false}
          />
          <Input
            value={monitorStepProxmoxMonitor.resourceFilters.guestId || ""}
            onChange={(value: string) => {
              props.onChange({
                ...monitorStepProxmoxMonitor,
                resourceFilters: {
                  ...monitorStepProxmoxMonitor.resourceFilters,
                  guestId: value || undefined,
                },
              });
            }}
            placeholder="e.g. qemu/100 or lxc/101"
          />
        </div>
      </>
    );
  };

  const renderQuickSetup: () => ReactElement = (): ReactElement => {
    return (
      <div className="mt-4">
        <ProxmoxTemplatePicker
          selectedTemplateId={selectedTemplateId}
          onTemplateSelected={(template: ProxmoxAlertTemplate) => {
            handleTemplateSelection(template);
          }}
        >
          <AlertTemplateConfiguration
            rollingTime={monitorStepProxmoxMonitor.rollingTime}
            onRollingTimeChange={(value: RollingTime) => {
              props.onChange({
                ...monitorStepProxmoxMonitor,
                rollingTime: value,
              });
            }}
          />
        </ProxmoxTemplatePicker>
      </div>
    );
  };

  const renderCustomMetric: () => ReactElement = (): ReactElement => {
    return (
      <div className="mt-4 space-y-4">
        <div>
          <FieldLabelElement title="Proxmox Metric" required={true} />
          <ProxmoxMetricPicker
            selectedMetricId={selectedMetricId}
            onMetricSelected={(metric: ProxmoxMetricDefinition) => {
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
                    monitorStepProxmoxMonitor.metricViewConfig.queryConfigs
                      .length > 0
                  ) {
                    const currentQueryConfig: MetricQueryConfigData =
                      monitorStepProxmoxMonitor.metricViewConfig
                        .queryConfigs[0]!;
                    if (currentQueryConfig) {
                      props.onChange({
                        ...monitorStepProxmoxMonitor,
                        metricViewConfig: {
                          ...monitorStepProxmoxMonitor.metricViewConfig,
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
                value={monitorStepProxmoxMonitor.rollingTime}
                onChange={(value: RollingTime) => {
                  if (value === monitorStepProxmoxMonitor.rollingTime) {
                    return;
                  }

                  props.onChange({
                    ...monitorStepProxmoxMonitor,
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
            value={monitorStepProxmoxMonitor.rollingTime}
            onChange={(value: RollingTime) => {
              if (value === monitorStepProxmoxMonitor.rollingTime) {
                return;
              }

              props.onChange({
                ...monitorStepProxmoxMonitor,
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
                monitorStepProxmoxMonitor.metricViewConfig.queryConfigs,
              formulaConfigs:
                monitorStepProxmoxMonitor.metricViewConfig.formulaConfigs,
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
                ...monitorStepProxmoxMonitor,
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

export default ProxmoxMonitorStepForm;
