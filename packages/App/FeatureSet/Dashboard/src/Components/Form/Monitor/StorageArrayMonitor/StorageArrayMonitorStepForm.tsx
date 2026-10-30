import MonitorStepStorageArrayMonitor, {
  MonitorStepStorageArrayMonitorUtil,
  StorageArrayResourceFilters,
  StorageArrayResourceScope,
} from "Common/Types/Monitor/MonitorStepStorageArrayMonitor";
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
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import StorageArrayTemplatePicker from "./StorageArrayTemplatePicker";
import StorageArrayMetricPicker from "./StorageArrayMetricPicker";
import {
  StorageArrayAlertTemplate,
  buildStorageArrayMonitorConfig,
  getStorageArrayAlertTemplateById,
  getStorageArrayAlertTemplatesForSystem,
  getStorageArrayDefaultAlertTemplateId,
} from "Common/Types/Monitor/StorageArrayAlertTemplates";
import AlertTemplateConfiguration from "../AlertTemplatePicker/AlertTemplateConfiguration";
import {
  StorageArrayMetricDefinition,
  getStorageArrayObjectLabel,
} from "Common/Types/Monitor/StorageArrayMetricCatalog";
import StorageSystem, {
  StorageSystemUtil,
} from "Common/Types/StorageArray/StorageSystem";
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
import STORAGE_ARRAY_ONBOARDING from "../../../StorageArray/StorageArrayOnboarding";
import AddResourceModal from "../../../ResourceOnboarding/AddResourceModal";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";

/*
 * Window used when a step arrives without one (a legacy step, or a config
 * built before the picker ran). Read from the Common default rather than
 * restated here so the form can never drift from what the API seeds.
 */
const DEFAULT_ROLLING_TIME: RollingTime =
  MonitorStepStorageArrayMonitorUtil.getDefault().rollingTime;

/*
 * The window a custom metric starts with, from how often the agent reads
 * its series: the array endpoint every 60 seconds and volumes, hosts and
 * pods every 2 minutes, so 5 minutes always holds a sample; a FlashBlade's
 * file systems and buckets every 5 minutes, so 15. A shorter window would
 * be empty on some evaluations and the monitor would flap. The user can
 * still change it below.
 */
export function getRecommendedRollingTime(
  metric: StorageArrayMetricDefinition,
): RollingTime {
  if (
    metric.defaultResourceScope === StorageArrayResourceScope.FileSystem ||
    metric.defaultResourceScope === StorageArrayResourceScope.Bucket
  ) {
    return RollingTime.Past15Minutes;
  }
  return RollingTime.Past5Minutes;
}

export interface ComponentProps {
  monitorStepStorageArrayMonitor: MonitorStepStorageArrayMonitor;
  onChange: (
    monitorStepStorageArrayMonitor: MonitorStepStorageArrayMonitor,
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

/*
 * One text input per StorageArrayResourceFilters key. Each value becomes
 * an equality filter on the datapoint label that names that object on the
 * platform (getStorageArrayObjectLabel); the worker always scopes on
 * `resource.storage.array.name` on top. `storageSystems` is where the
 * field means something: an array whose platform is not known yet shows
 * them all.
 */
export interface ResourceFilterField {
  key: keyof StorageArrayResourceFilters;
  title: string;
  description: string;
  placeholder: string;
  storageSystems: Array<StorageSystem>;
}

export const resourceFilterFields: Array<ResourceFilterField> = [
  {
    key: "volumeName",
    title: "Volume",
    description:
      "Filter to one FlashArray volume — the `name` label of the purefa_volume_* series (optional). Volumes in a pod or volume group are named pod::volume or group/volume.",
    placeholder: "e.g. vol-db-01",
    storageSystems: [StorageSystem.PureStorageFlashArray],
  },
  {
    key: "hostName",
    title: "Host",
    description:
      "Filter to one host defined on the FlashArray — the `host` label of the purefa_host_* series (optional).",
    placeholder: "e.g. esxi-01",
    storageSystems: [StorageSystem.PureStorageFlashArray],
  },
  {
    key: "podName",
    title: "Pod",
    description:
      "Filter to one pod — the `name` label of the purefa_pod_* series, and `local_pod` on the replica link series (optional).",
    placeholder: "e.g. pod-prod",
    storageSystems: [StorageSystem.PureStorageFlashArray],
  },
  {
    key: "componentName",
    title: "Hardware Component",
    description:
      "Filter to one hardware part — the `component_name` label on a FlashArray, `name` on a FlashBlade (optional).",
    placeholder: "e.g. CH0.BAY1",
    storageSystems: [
      StorageSystem.PureStorageFlashArray,
      StorageSystem.PureStorageFlashBlade,
    ],
  },
  {
    key: "fileSystemName",
    title: "File System",
    description:
      "Filter to one FlashBlade file system — the `name` label of the purefb_file_systems_* series (optional).",
    placeholder: "e.g. fs-home",
    storageSystems: [StorageSystem.PureStorageFlashBlade],
  },
  {
    key: "bucketName",
    title: "Bucket",
    description:
      "Filter to one FlashBlade S3 bucket — the `name` label of the purefb_buckets_* series (optional).",
    placeholder: "e.g. backups",
    storageSystems: [StorageSystem.PureStorageFlashBlade],
  },
];

export function getResourceFilterFields(
  storageSystem: string | null | undefined,
): Array<ResourceFilterField> {
  if (!StorageSystemUtil.isKnownSystem(storageSystem)) {
    return resourceFilterFields;
  }
  return resourceFilterFields.filter((field: ResourceFilterField): boolean => {
    return field.storageSystems.includes(storageSystem);
  });
}

const StorageArrayMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [rollingTime, setRollingTime] = React.useState<RollingTime | null>(
    null,
  );

  const monitorStepStorageArrayMonitor: MonitorStepStorageArrayMonitor =
    props.monitorStepStorageArrayMonitor ||
    MonitorStepStorageArrayMonitorUtil.getDefault();

  const [startAndEndTime, setStartAndEndTime] =
    React.useState<InBetween<Date> | null>(null);

  const resources: InfrastructureResources<StorageArray> =
    useInfrastructureResources<StorageArray>({
      modelType: StorageArray,
      select: {
        _id: true,
        lastSeenAt: true,
        name: true,
        storageSystem: true,
      },
      toOption: (storageArray: StorageArray): DropdownOption => {
        return {
          label: storageArray.name || "Unknown",
          value: storageArray.name || "",
        };
      },
      getLastSeenAt: (storageArray: StorageArray): Date | undefined => {
        return storageArray.lastSeenAt;
      },
    });

  // What each array is (FlashArray or FlashBlade), by the name it is picked by.
  const storageSystemByArray: Record<string, string> = {};
  for (const storageArray of resources.records) {
    if (storageArray.name && storageArray.storageSystem) {
      storageSystemByArray[storageArray.name] = storageArray.storageSystem;
    }
  }

  /*
   * The template a saved step was made from shows picked; a new step starts
   * on the type's default alert once drawn.
   */
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<
    string | undefined
  >(() => {
    return findTemplateIdForMetricsView<StorageArrayAlertTemplate>({
      templates: getStorageArrayAlertTemplatesForSystem(
        monitorStepStorageArrayMonitor.storageSystem,
      ),
      getMetricsViewConfig: (template: StorageArrayAlertTemplate) => {
        return MonitorStep.getMetricsViewConfig(
          template.getMonitorStep({
            arrayIdentifier:
              monitorStepStorageArrayMonitor.arrayIdentifier || "",
            onlineMonitorStatusId: ObjectID.generate(),
            offlineMonitorStatusId: ObjectID.generate(),
            defaultIncidentSeverityId: ObjectID.generate(),
            defaultAlertSeverityId: ObjectID.generate(),
            monitorName: template.name,
          }),
        );
      },
      current: monitorStepStorageArrayMonitor.metricViewConfig,
    });
  });

  const [initialWay] = React.useState<InfrastructureWatchWay>(() => {
    return getInitialWatchWay({
      queryCount:
        monitorStepStorageArrayMonitor.metricViewConfig.queryConfigs.length,
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

  /*
   * The platform the catalog and templates are picked for: the one stored
   * with the step, else the picked array's (a step saved before its array
   * reported a platform).
   */
  const storageSystem: string | undefined =
    monitorStepStorageArrayMonitor.storageSystem ||
    storageSystemByArray[monitorStepStorageArrayMonitor.arrayIdentifier] ||
    undefined;

  useEffect(() => {
    if (rollingTime === monitorStepStorageArrayMonitor.rollingTime) {
      return;
    }

    setRollingTime(monitorStepStorageArrayMonitor.rollingTime);

    setStartAndEndTime(
      RollingTimeUtil.convertToStartAndEndDate(
        monitorStepStorageArrayMonitor.rollingTime || DEFAULT_ROLLING_TIME,
      ),
    );
  }, [monitorStepStorageArrayMonitor.rollingTime]);

  useEffect(() => {
    setStartAndEndTime(
      RollingTimeUtil.convertToStartAndEndDate(
        monitorStepStorageArrayMonitor.rollingTime || DEFAULT_ROLLING_TIME,
      ),
    );
  }, []);

  const applyTemplate: (
    template: StorageArrayAlertTemplate,
    arrayIdentifier: string,
  ) => void = (
    template: StorageArrayAlertTemplate,
    arrayIdentifier: string,
  ): void => {
    templateAppliedWithoutResourceRef.current = !arrayIdentifier;
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
      arrayIdentifier: arrayIdentifier || "",
      onlineMonitorStatusId,
      offlineMonitorStatusId,
      defaultIncidentSeverityId,
      defaultAlertSeverityId,
      monitorName,
    });

    if (templateStep.data?.storageArrayMonitor) {
      props.onChange({
        ...templateStep.data.storageArrayMonitor,
        arrayIdentifier: arrayIdentifier || "",
        storageSystem:
          storageSystem || templateStep.data.storageArrayMonitor.storageSystem,
      });
    }

    if (templateStep.data?.monitorCriteria && props.onMonitorCriteriaChange) {
      props.onMonitorCriteriaChange(templateStep.data.monitorCriteria);
    }
  };

  const handleTemplateSelection: (
    template: StorageArrayAlertTemplate,
  ) => void = (template: StorageArrayAlertTemplate): void => {
    applyTemplate(template, monitorStepStorageArrayMonitor.arrayIdentifier);
  };

  // A new monitor starts on the alert most people want first.
  useEffect(() => {
    if (
      monitorStepStorageArrayMonitor.metricViewConfig.queryConfigs.length > 0
    ) {
      return;
    }

    const template: StorageArrayAlertTemplate | undefined =
      getStorageArrayAlertTemplateById(
        getStorageArrayDefaultAlertTemplateId(storageSystem),
      );

    if (template) {
      applyTemplate(template, monitorStepStorageArrayMonitor.arrayIdentifier);
    }
  }, []);

  const changeResource: (arrayIdentifier: string) => void = (
    arrayIdentifier: string,
  ): void => {
    const template: StorageArrayAlertTemplate | undefined = selectedTemplateId
      ? getStorageArrayAlertTemplateById(selectedTemplateId)
      : undefined;

    if (
      template &&
      templateAppliedWithoutResourceRef.current &&
      arrayIdentifier
    ) {
      applyTemplate(template, arrayIdentifier);
      return;
    }

    props.onChange({
      ...monitorStepStorageArrayMonitor,
      arrayIdentifier: arrayIdentifier,
      storageSystem: storageSystemByArray[arrayIdentifier] || undefined,
    });
  };

  const handleCustomMetricSelection: (
    metric: StorageArrayMetricDefinition,
  ) => void = (metric: StorageArrayMetricDefinition): void => {
    setSelectedMetricId(metric.id);
    // The metric replaces the one Quick Setup's template set.
    setSelectedTemplateId(undefined);
    templateAppliedWithoutResourceRef.current = false;
    setCustomAggregation(metric.defaultAggregation);

    const arrayIdentifier: string =
      monitorStepStorageArrayMonitor.arrayIdentifier;

    /*
     * Group per object (volume, host, pod, component, file system, bucket)
     * by the datapoint label that names it on this platform, so "volume
     * write latency > 5 ms" fires for the one slow volume instead of the
     * average of every volume on the array. Array-wide metrics have no
     * object label and stay ungrouped.
     */
    const groupByAttributeKey: string | null = getStorageArrayObjectLabel(
      metric.defaultResourceScope,
      storageSystem || metric.storageSystems[0],
      metric.metricName,
    );

    const config: MonitorStepStorageArrayMonitor =
      buildStorageArrayMonitorConfig({
        arrayIdentifier: arrayIdentifier || "",
        storageSystem: StorageSystemUtil.isKnownSystem(storageSystem)
          ? storageSystem
          : metric.storageSystems[0],
        metricName: metric.metricName,
        metricAlias: metric.id.replace(/-/g, "_"),
        rollingTime: getRecommendedRollingTime(metric),
        aggregationType: metric.defaultAggregation,
        // Pure tells read from write only by these labels (`dimension`).
        attributes: { ...(metric.attributes || {}) },
        groupByAttributeKey: groupByAttributeKey || undefined,
      });

    /*
     * Keep whatever filters were already typed: picking another metric of
     * the same volume should not forget the volume.
     */
    config.resourceFilters = {
      ...monitorStepStorageArrayMonitor.resourceFilters,
    };

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
          monitorType: MonitorType.StorageArray,
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

  const renderArrayDropdown: () => ReactElement = (): ReactElement => {
    return (
      <InfrastructureResourceField
        title="Storage Array"
        placeholder="Select a storage array..."
        options={resources.options}
        value={monitorStepStorageArrayMonitor.arrayIdentifier}
        onChange={changeResource}
        isLoading={resources.isLoading}
        lastSeenAtByValue={resources.lastSeenAtByValue}
        addResource={{
          title: STORAGE_ARRAY_ONBOARDING.addTitle,
          renderModal: (input: {
            onClose: () => void;
            onConnected: (value: string) => void;
          }): ReactElement => {
            return (
              <AddResourceModal
                onboarding={STORAGE_ARRAY_ONBOARDING}
                onClose={input.onClose}
                onConnected={(record: BaseModel) => {
                  input.onConnected(
                    String((record as StorageArray).name || ""),
                  );
                }}
              />
            );
          },
        }}
        onResourceAdded={(arrayIdentifier: string) => {
          resources
            .reload()
            .then(() => {
              changeResource(arrayIdentifier);
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
        {getResourceFilterFields(storageSystem).map(
          (field: ResourceFilterField) => {
            return (
              <div className="mt-3" key={field.key}>
                <FieldLabelElement
                  title={field.title}
                  description={field.description}
                  required={false}
                />
                <Input
                  value={
                    monitorStepStorageArrayMonitor.resourceFilters[field.key] ||
                    ""
                  }
                  onChange={(value: string) => {
                    props.onChange({
                      ...monitorStepStorageArrayMonitor,
                      resourceFilters: {
                        ...monitorStepStorageArrayMonitor.resourceFilters,
                        [field.key]: value || undefined,
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
        <StorageArrayTemplatePicker
          storageSystem={storageSystem}
          selectedTemplateId={selectedTemplateId}
          onTemplateSelected={(template: StorageArrayAlertTemplate) => {
            handleTemplateSelection(template);
          }}
        >
          <AlertTemplateConfiguration
            rollingTime={monitorStepStorageArrayMonitor.rollingTime}
            onRollingTimeChange={(value: RollingTime) => {
              props.onChange({
                ...monitorStepStorageArrayMonitor,
                rollingTime: value,
              });
            }}
          />
        </StorageArrayTemplatePicker>
      </div>
    );
  };

  const renderCustomMetric: () => ReactElement = (): ReactElement => {
    return (
      <div className="mt-4 space-y-4">
        <div>
          <FieldLabelElement title="Storage Array Metric" required={true} />
          <StorageArrayMetricPicker
            storageSystem={storageSystem}
            selectedMetricId={selectedMetricId}
            onMetricSelected={(metric: StorageArrayMetricDefinition) => {
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
                    monitorStepStorageArrayMonitor.metricViewConfig.queryConfigs
                      .length > 0
                  ) {
                    const currentQueryConfig: MetricQueryConfigData =
                      monitorStepStorageArrayMonitor.metricViewConfig
                        .queryConfigs[0]!;
                    if (currentQueryConfig) {
                      props.onChange({
                        ...monitorStepStorageArrayMonitor,
                        metricViewConfig: {
                          ...monitorStepStorageArrayMonitor.metricViewConfig,
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
                value={monitorStepStorageArrayMonitor.rollingTime}
                onChange={(value: RollingTime) => {
                  if (value === monitorStepStorageArrayMonitor.rollingTime) {
                    return;
                  }

                  props.onChange({
                    ...monitorStepStorageArrayMonitor,
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
            value={monitorStepStorageArrayMonitor.rollingTime}
            onChange={(value: RollingTime) => {
              if (value === monitorStepStorageArrayMonitor.rollingTime) {
                return;
              }

              props.onChange({
                ...monitorStepStorageArrayMonitor,
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
                monitorStepStorageArrayMonitor.metricViewConfig.queryConfigs,
              formulaConfigs:
                monitorStepStorageArrayMonitor.metricViewConfig.formulaConfigs,
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
                ...monitorStepStorageArrayMonitor,
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
      resourceField={renderArrayDropdown()}
      alertTemplates={renderQuickSetup()}
      customMetric={renderCustomMetric()}
      queryBuilder={renderAdvanced()}
      initialWay={initialWay}
    />
  );
};

export default StorageArrayMonitorStepForm;
