import MonitorStepOpenStackMonitor, {
  MonitorStepOpenStackMonitorUtil,
  OpenStackResourceFilters,
} from "Common/Types/Monitor/MonitorStepOpenStackMonitor";
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
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import OpenStackTemplatePicker from "./OpenStackTemplatePicker";
import OpenStackMetricPicker from "./OpenStackMetricPicker";
import {
  OpenStackAlertTemplate,
  buildOpenStackMonitorConfig,
  getOpenStackAlertTemplateById,
  getAllOpenStackAlertTemplates,
  getOpenStackDefaultAlertTemplateId,
} from "Common/Types/Monitor/OpenStackAlertTemplates";
import AlertTemplateConfiguration from "../AlertTemplatePicker/AlertTemplateConfiguration";
import { OpenStackMetricDefinition } from "Common/Types/Monitor/OpenStackMetricCatalog";
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
import OPENSTACK_CLOUD_ONBOARDING from "../../../OpenStack/OpenStackCloudOnboarding";
import AddResourceModal from "../../../ResourceOnboarding/AddResourceModal";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

export interface ComponentProps {
  monitorStepOpenStackMonitor: MonitorStepOpenStackMonitor;
  onChange: (monitorStepOpenStackMonitor: MonitorStepOpenStackMonitor) => void;
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
 * The filters a monitor can be narrowed by, each equality on the exporter label it
 * maps to on a series (getOpenStackFilterAttributes). All optional, and folded under
 * Advanced and Custom Metric: most monitors watch the whole cloud.
 */
const FILTER_FIELDS: ReadonlyArray<{
  filter: keyof OpenStackResourceFilters;
  title: string;
  description: string;
  placeholder: string;
}> = [
  {
    filter: "regionName",
    title: "Region",
    description: "Only this region (optional).",
    placeholder: "e.g. RegionOne",
  },
  {
    filter: "availabilityZone",
    title: "Availability Zone",
    description: "Only this availability zone (optional).",
    placeholder: "e.g. nova",
  },
  {
    filter: "hypervisorName",
    title: "Hypervisor",
    description:
      "Only this host (optional), as each series spells it: Nova's workers say the short host name, and hypervisors, Placement and instances the full one.",
    placeholder: "e.g. compute-01",
  },
  {
    filter: "serviceName",
    title: "Service",
    description: "Only this worker's binary (optional).",
    placeholder: "e.g. nova-compute",
  },
  {
    filter: "projectId",
    title: "Project ID",
    description: "Only this project (optional), by its id.",
    placeholder: "e.g. 08907f6d83fd49e1b95271b34eba81b0",
  },
];

const OpenStackMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [rollingTime, setRollingTime] = React.useState<RollingTime | null>(
    null,
  );

  const monitorStepOpenStackMonitor: MonitorStepOpenStackMonitor =
    props.monitorStepOpenStackMonitor ||
    MonitorStepOpenStackMonitorUtil.getDefault();

  const [startAndEndTime, setStartAndEndTime] =
    React.useState<InBetween<Date> | null>(null);

  /*
   * The template a saved step was made from shows picked; a new step starts
   * on the type's default alert once drawn.
   */
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<
    string | undefined
  >(() => {
    return findTemplateIdForMetricsView<OpenStackAlertTemplate>({
      templates: getAllOpenStackAlertTemplates(),
      getMetricsViewConfig: (template: OpenStackAlertTemplate) => {
        return MonitorStep.getMetricsViewConfig(
          template.getMonitorStep({
            cloudIdentifier: monitorStepOpenStackMonitor.cloudIdentifier || "",
            onlineMonitorStatusId: ObjectID.generate(),
            offlineMonitorStatusId: ObjectID.generate(),
            defaultIncidentSeverityId: ObjectID.generate(),
            defaultAlertSeverityId: ObjectID.generate(),
            monitorName: template.name,
          }),
        );
      },
      current: monitorStepOpenStackMonitor.metricViewConfig,
    });
  });

  const [initialWay] = React.useState<InfrastructureWatchWay>(() => {
    return getInitialWatchWay({
      queryCount:
        monitorStepOpenStackMonitor.metricViewConfig.queryConfigs.length,
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

  const resources: InfrastructureResources<OpenStackCloud> =
    useInfrastructureResources<OpenStackCloud>({
      modelType: OpenStackCloud,
      select: {
        _id: true,
        lastSeenAt: true,
        name: true,
      },
      toOption: (cloud: OpenStackCloud): DropdownOption => {
        return {
          label: cloud.name || "Unknown",
          value: cloud.name || "",
        };
      },
      getLastSeenAt: (cloud: OpenStackCloud): Date | undefined => {
        return cloud.lastSeenAt;
      },
    });

  useEffect(() => {
    if (rollingTime === monitorStepOpenStackMonitor.rollingTime) {
      return;
    }

    setRollingTime(monitorStepOpenStackMonitor.rollingTime);

    setStartAndEndTime(
      RollingTimeUtil.convertToStartAndEndDate(
        monitorStepOpenStackMonitor.rollingTime || RollingTime.Past15Minutes,
      ),
    );
  }, [monitorStepOpenStackMonitor.rollingTime]);

  useEffect(() => {
    setStartAndEndTime(
      RollingTimeUtil.convertToStartAndEndDate(
        monitorStepOpenStackMonitor.rollingTime || RollingTime.Past15Minutes,
      ),
    );
  }, []);

  const applyTemplate: (
    template: OpenStackAlertTemplate,
    cloudIdentifier: string,
  ) => void = (
    template: OpenStackAlertTemplate,
    cloudIdentifier: string,
  ): void => {
    templateAppliedWithoutResourceRef.current = !cloudIdentifier;
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
      cloudIdentifier: cloudIdentifier || "",
      onlineMonitorStatusId,
      offlineMonitorStatusId,
      defaultIncidentSeverityId,
      defaultAlertSeverityId,
      monitorName,
    });

    if (templateStep.data?.openstackMonitor) {
      props.onChange({
        ...templateStep.data.openstackMonitor,
        cloudIdentifier: cloudIdentifier || "",
      });
    }

    if (templateStep.data?.monitorCriteria && props.onMonitorCriteriaChange) {
      props.onMonitorCriteriaChange(templateStep.data.monitorCriteria);
    }
  };

  const handleTemplateSelection: (template: OpenStackAlertTemplate) => void = (
    template: OpenStackAlertTemplate,
  ): void => {
    applyTemplate(template, monitorStepOpenStackMonitor.cloudIdentifier);
  };

  // A new monitor starts on the alert most people want first.
  useEffect(() => {
    if (monitorStepOpenStackMonitor.metricViewConfig.queryConfigs.length > 0) {
      return;
    }

    const template: OpenStackAlertTemplate | undefined =
      getOpenStackAlertTemplateById(getOpenStackDefaultAlertTemplateId());

    if (template) {
      applyTemplate(template, monitorStepOpenStackMonitor.cloudIdentifier);
    }
  }, []);

  const changeResource: (cloudIdentifier: string) => void = (
    cloudIdentifier: string,
  ): void => {
    const template: OpenStackAlertTemplate | undefined = selectedTemplateId
      ? getOpenStackAlertTemplateById(selectedTemplateId)
      : undefined;

    if (
      template &&
      templateAppliedWithoutResourceRef.current &&
      cloudIdentifier
    ) {
      applyTemplate(template, cloudIdentifier);
      return;
    }

    props.onChange({
      ...monitorStepOpenStackMonitor,
      cloudIdentifier: cloudIdentifier,
    });
  };

  const handleCustomMetricSelection: (
    metric: OpenStackMetricDefinition,
  ) => void = (metric: OpenStackMetricDefinition): void => {
    setSelectedMetricId(metric.id);
    // The metric replaces the one Quick Setup's template set.
    setSelectedTemplateId(undefined);
    templateAppliedWithoutResourceRef.current = false;
    setCustomAggregation(metric.defaultAggregation);

    const cloudIdentifier: string = monitorStepOpenStackMonitor.cloudIdentifier;

    const config: MonitorStepOpenStackMonitor = buildOpenStackMonitorConfig({
      cloudIdentifier: cloudIdentifier || "",
      metricName: metric.metricName,
      metricAlias: metric.id.replace(/-/g, "_"),
      rollingTime:
        monitorStepOpenStackMonitor.rollingTime || RollingTime.Past15Minutes,
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
          monitorType: MonitorType.OpenStack,
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

  const renderCloudDropdown: () => ReactElement = (): ReactElement => {
    return (
      <InfrastructureResourceField
        title="OpenStack Cloud"
        placeholder="Select an OpenStack cloud..."
        options={resources.options}
        value={resources.valueOf({
          value: monitorStepOpenStackMonitor.cloudIdentifier,
          resourceId: monitorStepOpenStackMonitor.resourceId,
        })}
        onChange={changeResource}
        isLoading={resources.isLoading}
        lastSeenAtByValue={resources.lastSeenAtByValue}
        addResource={{
          title: OPENSTACK_CLOUD_ONBOARDING.addTitle,
          renderModal: (input: {
            onClose: () => void;
            onConnected: (value: string) => void;
          }): ReactElement => {
            return (
              <AddResourceModal
                onboarding={OPENSTACK_CLOUD_ONBOARDING}
                onClose={input.onClose}
                onConnected={(record: BaseModel) => {
                  input.onConnected(
                    String((record as OpenStackCloud).name || ""),
                  );
                }}
              />
            );
          },
        }}
        onResourceAdded={(cloudIdentifier: string) => {
          resources
            .reload()
            .then(() => {
              changeResource(cloudIdentifier);
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
        {FILTER_FIELDS.map(
          (field: {
            filter: keyof OpenStackResourceFilters;
            title: string;
            description: string;
            placeholder: string;
          }): ReactElement => {
            return (
              <div className="mt-3" key={field.filter}>
                <FieldLabelElement
                  title={field.title}
                  description={field.description}
                  required={false}
                />
                <Input
                  value={
                    monitorStepOpenStackMonitor.resourceFilters[field.filter] ||
                    ""
                  }
                  onChange={(value: string) => {
                    props.onChange({
                      ...monitorStepOpenStackMonitor,
                      resourceFilters: {
                        ...monitorStepOpenStackMonitor.resourceFilters,
                        [field.filter]: value || undefined,
                      },
                    });
                  }}
                  placeholder={field.placeholder}
                />
              </div>
            );
          },
        )}
      </>
    );
  };

  const renderQuickSetup: () => ReactElement = (): ReactElement => {
    return (
      <div className="mt-4">
        <OpenStackTemplatePicker
          selectedTemplateId={selectedTemplateId}
          onTemplateSelected={(template: OpenStackAlertTemplate) => {
            handleTemplateSelection(template);
          }}
        >
          <AlertTemplateConfiguration
            rollingTime={monitorStepOpenStackMonitor.rollingTime}
            onRollingTimeChange={(value: RollingTime) => {
              props.onChange({
                ...monitorStepOpenStackMonitor,
                rollingTime: value,
              });
            }}
          />
        </OpenStackTemplatePicker>
      </div>
    );
  };

  const renderCustomMetric: () => ReactElement = (): ReactElement => {
    return (
      <div className="mt-4 space-y-4">
        <div>
          <FieldLabelElement title="OpenStack Metric" required={true} />
          <OpenStackMetricPicker
            selectedMetricId={selectedMetricId}
            onMetricSelected={(metric: OpenStackMetricDefinition) => {
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
                    monitorStepOpenStackMonitor.metricViewConfig.queryConfigs
                      .length > 0
                  ) {
                    const currentQueryConfig: MetricQueryConfigData =
                      monitorStepOpenStackMonitor.metricViewConfig
                        .queryConfigs[0]!;
                    if (currentQueryConfig) {
                      props.onChange({
                        ...monitorStepOpenStackMonitor,
                        metricViewConfig: {
                          ...monitorStepOpenStackMonitor.metricViewConfig,
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
                value={monitorStepOpenStackMonitor.rollingTime}
                onChange={(value: RollingTime) => {
                  if (value === monitorStepOpenStackMonitor.rollingTime) {
                    return;
                  }

                  props.onChange({
                    ...monitorStepOpenStackMonitor,
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
            value={monitorStepOpenStackMonitor.rollingTime}
            onChange={(value: RollingTime) => {
              if (value === monitorStepOpenStackMonitor.rollingTime) {
                return;
              }

              props.onChange({
                ...monitorStepOpenStackMonitor,
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
                monitorStepOpenStackMonitor.metricViewConfig.queryConfigs,
              formulaConfigs:
                monitorStepOpenStackMonitor.metricViewConfig.formulaConfigs,
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
                ...monitorStepOpenStackMonitor,
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
      resourceField={renderCloudDropdown()}
      alertTemplates={renderQuickSetup()}
      customMetric={renderCustomMetric()}
      queryBuilder={renderAdvanced()}
      initialWay={initialWay}
    />
  );
};

export default OpenStackMonitorStepForm;
