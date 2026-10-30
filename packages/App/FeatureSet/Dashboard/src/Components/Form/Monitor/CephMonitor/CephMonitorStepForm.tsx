import MonitorStepCephMonitor, {
  MonitorStepCephMonitorUtil,
} from "Common/Types/Monitor/MonitorStepCephMonitor";
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
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import CephTemplatePicker from "./CephTemplatePicker";
import CephMetricPicker from "./CephMetricPicker";
import {
  CephAlertTemplate,
  buildCephMonitorConfig,
  getCephAlertTemplateById,
  getAllCephAlertTemplates,
  getCephDefaultAlertTemplateId,
} from "Common/Types/Monitor/CephAlertTemplates";
import AlertTemplateConfiguration from "../AlertTemplatePicker/AlertTemplateConfiguration";
import { CephMetricDefinition } from "Common/Types/Monitor/CephMetricCatalog";
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
import CEPH_CLUSTER_ONBOARDING from "../../../Ceph/CephClusterOnboarding";
import AddResourceModal from "../../../ResourceOnboarding/AddResourceModal";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

export interface ComponentProps {
  monitorStepCephMonitor: MonitorStepCephMonitor;
  onChange: (monitorStepCephMonitor: MonitorStepCephMonitor) => void;
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

const CephMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [rollingTime, setRollingTime] = React.useState<RollingTime | null>(
    null,
  );

  const monitorStepCephMonitor: MonitorStepCephMonitor =
    props.monitorStepCephMonitor || MonitorStepCephMonitorUtil.getDefault();

  const [startAndEndTime, setStartAndEndTime] =
    React.useState<InBetween<Date> | null>(null);

  /*
   * The template a saved step was made from shows picked; a new step starts
   * on the type's default alert once drawn.
   */
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<
    string | undefined
  >(() => {
    return findTemplateIdForMetricsView<CephAlertTemplate>({
      templates: getAllCephAlertTemplates(),
      getMetricsViewConfig: (template: CephAlertTemplate) => {
        return MonitorStep.getMetricsViewConfig(
          template.getMonitorStep({
            clusterIdentifier: monitorStepCephMonitor.clusterIdentifier || "",
            onlineMonitorStatusId: ObjectID.generate(),
            offlineMonitorStatusId: ObjectID.generate(),
            defaultIncidentSeverityId: ObjectID.generate(),
            defaultAlertSeverityId: ObjectID.generate(),
            monitorName: template.name,
          }),
        );
      },
      current: monitorStepCephMonitor.metricViewConfig,
    });
  });

  const [initialWay] = React.useState<InfrastructureWatchWay>(() => {
    return getInitialWatchWay({
      queryCount: monitorStepCephMonitor.metricViewConfig.queryConfigs.length,
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

  const resources: InfrastructureResources<CephCluster> =
    useInfrastructureResources<CephCluster>({
      modelType: CephCluster,
      select: {
        _id: true,
        lastSeenAt: true,
        name: true,
      },
      toOption: (cluster: CephCluster): DropdownOption => {
        return {
          label: cluster.name || "Unknown",
          value: cluster.name || "",
        };
      },
      getLastSeenAt: (cluster: CephCluster): Date | undefined => {
        return cluster.lastSeenAt;
      },
    });

  useEffect(() => {
    if (rollingTime === monitorStepCephMonitor.rollingTime) {
      return;
    }

    setRollingTime(monitorStepCephMonitor.rollingTime);

    setStartAndEndTime(
      RollingTimeUtil.convertToStartAndEndDate(
        monitorStepCephMonitor.rollingTime || RollingTime.Past1Minute,
      ),
    );
  }, [monitorStepCephMonitor.rollingTime]);

  useEffect(() => {
    setStartAndEndTime(
      RollingTimeUtil.convertToStartAndEndDate(
        monitorStepCephMonitor.rollingTime || RollingTime.Past1Minute,
      ),
    );
  }, []);

  const applyTemplate: (
    template: CephAlertTemplate,
    clusterIdentifier: string,
  ) => void = (
    template: CephAlertTemplate,
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

    if (templateStep.data?.cephMonitor) {
      props.onChange({
        ...templateStep.data.cephMonitor,
        clusterIdentifier: clusterIdentifier || "",
      });
    }

    if (templateStep.data?.monitorCriteria && props.onMonitorCriteriaChange) {
      props.onMonitorCriteriaChange(templateStep.data.monitorCriteria);
    }
  };

  const handleTemplateSelection: (template: CephAlertTemplate) => void = (
    template: CephAlertTemplate,
  ): void => {
    applyTemplate(template, monitorStepCephMonitor.clusterIdentifier);
  };

  // A new monitor starts on the alert most people want first.
  useEffect(() => {
    if (monitorStepCephMonitor.metricViewConfig.queryConfigs.length > 0) {
      return;
    }

    const template: CephAlertTemplate | undefined = getCephAlertTemplateById(
      getCephDefaultAlertTemplateId(),
    );

    if (template) {
      applyTemplate(template, monitorStepCephMonitor.clusterIdentifier);
    }
  }, []);

  const changeResource: (clusterIdentifier: string) => void = (
    clusterIdentifier: string,
  ): void => {
    const template: CephAlertTemplate | undefined = selectedTemplateId
      ? getCephAlertTemplateById(selectedTemplateId)
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
      ...monitorStepCephMonitor,
      clusterIdentifier: clusterIdentifier,
    });
  };

  const handleCustomMetricSelection: (metric: CephMetricDefinition) => void = (
    metric: CephMetricDefinition,
  ): void => {
    setSelectedMetricId(metric.id);
    // The metric replaces the one Quick Setup's template set.
    setSelectedTemplateId(undefined);
    templateAppliedWithoutResourceRef.current = false;
    setCustomAggregation(metric.defaultAggregation);

    const clusterIdentifier: string = monitorStepCephMonitor.clusterIdentifier;

    const config: MonitorStepCephMonitor = buildCephMonitorConfig({
      clusterIdentifier: clusterIdentifier || "",
      metricName: metric.metricName,
      metricAlias: metric.id.replace(/-/g, "_"),
      rollingTime:
        monitorStepCephMonitor.rollingTime || RollingTime.Past5Minutes,
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
          monitorType: MonitorType.Ceph,
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
        title="Ceph Cluster"
        placeholder="Select a Ceph cluster..."
        options={resources.options}
        value={monitorStepCephMonitor.clusterIdentifier}
        onChange={changeResource}
        isLoading={resources.isLoading}
        lastSeenAtByValue={resources.lastSeenAtByValue}
        addResource={{
          title: CEPH_CLUSTER_ONBOARDING.addTitle,
          renderModal: (input: {
            onClose: () => void;
            onConnected: (value: string) => void;
          }): ReactElement => {
            return (
              <AddResourceModal
                onboarding={CEPH_CLUSTER_ONBOARDING}
                onClose={input.onClose}
                onConnected={(record: BaseModel) => {
                  input.onConnected(String((record as CephCluster).name || ""));
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
        <div className="mt-3">
          <FieldLabelElement
            title="OSD"
            description={
              "Filter by OSD daemon — the ceph_daemon label (optional)."
            }
            required={false}
          />
          <Input
            value={monitorStepCephMonitor.resourceFilters.osdId || ""}
            onChange={(value: string) => {
              props.onChange({
                ...monitorStepCephMonitor,
                resourceFilters: {
                  ...monitorStepCephMonitor.resourceFilters,
                  osdId: value || undefined,
                },
              });
            }}
            placeholder="e.g. osd.3"
          />
        </div>

        <div className="mt-3">
          <FieldLabelElement
            title="Pool ID"
            description={
              "Filter by pool id — the pool_id label (optional). Pool data series carry only pool_id; the pool name exists solely on ceph_pool_metadata."
            }
            required={false}
          />
          <Input
            value={monitorStepCephMonitor.resourceFilters.poolId || ""}
            onChange={(value: string) => {
              props.onChange({
                ...monitorStepCephMonitor,
                resourceFilters: {
                  ...monitorStepCephMonitor.resourceFilters,
                  poolId: value || undefined,
                },
              });
            }}
            placeholder="e.g. 2"
          />
        </div>
      </>
    );
  };

  const renderQuickSetup: () => ReactElement = (): ReactElement => {
    return (
      <div className="mt-4">
        <CephTemplatePicker
          selectedTemplateId={selectedTemplateId}
          onTemplateSelected={(template: CephAlertTemplate) => {
            handleTemplateSelection(template);
          }}
        >
          <AlertTemplateConfiguration
            rollingTime={monitorStepCephMonitor.rollingTime}
            onRollingTimeChange={(value: RollingTime) => {
              props.onChange({
                ...monitorStepCephMonitor,
                rollingTime: value,
              });
            }}
          />
        </CephTemplatePicker>
      </div>
    );
  };

  const renderCustomMetric: () => ReactElement = (): ReactElement => {
    return (
      <div className="mt-4 space-y-4">
        <div>
          <FieldLabelElement title="Ceph Metric" required={true} />
          <CephMetricPicker
            selectedMetricId={selectedMetricId}
            onMetricSelected={(metric: CephMetricDefinition) => {
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
                    monitorStepCephMonitor.metricViewConfig.queryConfigs
                      .length > 0
                  ) {
                    const currentQueryConfig: MetricQueryConfigData =
                      monitorStepCephMonitor.metricViewConfig.queryConfigs[0]!;
                    if (currentQueryConfig) {
                      props.onChange({
                        ...monitorStepCephMonitor,
                        metricViewConfig: {
                          ...monitorStepCephMonitor.metricViewConfig,
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
                value={monitorStepCephMonitor.rollingTime}
                onChange={(value: RollingTime) => {
                  if (value === monitorStepCephMonitor.rollingTime) {
                    return;
                  }

                  props.onChange({
                    ...monitorStepCephMonitor,
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
            value={monitorStepCephMonitor.rollingTime}
            onChange={(value: RollingTime) => {
              if (value === monitorStepCephMonitor.rollingTime) {
                return;
              }

              props.onChange({
                ...monitorStepCephMonitor,
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
                monitorStepCephMonitor.metricViewConfig.queryConfigs,
              formulaConfigs:
                monitorStepCephMonitor.metricViewConfig.formulaConfigs,
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
                ...monitorStepCephMonitor,
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

export default CephMonitorStepForm;
