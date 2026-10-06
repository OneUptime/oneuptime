import MonitorStepStorageArrayMonitor, {
  MonitorStepStorageArrayMonitorUtil,
  StorageArrayResourceFilters,
  StorageArrayResourceScope,
} from "Common/Types/Monitor/MonitorStepStorageArrayMonitor";
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
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import StorageArrayTemplatePicker from "./StorageArrayTemplatePicker";
import StorageArrayMetricPicker from "./StorageArrayMetricPicker";
import {
  StorageArrayAlertTemplate,
  buildStorageArrayMonitorConfig,
} from "Common/Types/Monitor/StorageArrayAlertTemplates";
import {
  StorageArrayMetricDefinition,
  getStorageArrayObjectLabel,
} from "Common/Types/Monitor/StorageArrayMetricCatalog";
import StorageSystem, {
  StorageSystemUtil,
} from "Common/Types/StorageArray/StorageSystem";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

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
  const translator: Translator = useTranslator();
  const [rollingTime, setRollingTime] = React.useState<RollingTime | null>(
    null,
  );

  const monitorStepStorageArrayMonitor: MonitorStepStorageArrayMonitor =
    props.monitorStepStorageArrayMonitor ||
    MonitorStepStorageArrayMonitorUtil.getDefault();

  const [startAndEndTime, setStartAndEndTime] =
    React.useState<InBetween<Date> | null>(null);

  const [arrayOptions, setArrayOptions] = React.useState<Array<DropdownOption>>(
    [],
  );

  // StorageArray.name -> its platform, for the array picked in the dropdown.
  const [storageSystemByArray, setStorageSystemByArray] = React.useState<
    Record<string, string>
  >({});

  const [, setIsLoadingArrays] = React.useState<boolean>(true);

  const [selectedTemplateId, setSelectedTemplateId] = React.useState<
    string | undefined
  >(undefined);

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
    setIsLoadingArrays(true);
    ModelAPI.getList<StorageArray>({
      modelType: StorageArray,
      query: {},
      select: {
        _id: true,
        name: true,
        storageSystem: true,
      },
      sort: {
        name: SortOrder.Ascending,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
    })
      .then((result: ListResult<StorageArray>) => {
        /*
         * The dropdown VALUE is the array's `name`, not its id: `name` is
         * the `storage.array.name` resource attribute the agent stamps on
         * every metric, and the worker scopes the query on it.
         */
        const options: Array<DropdownOption> = result.data.map(
          (storageArray: StorageArray) => {
            return {
              label: storageArray.name || "Unknown",
              value: storageArray.name || "",
            };
          },
        );
        const systems: Record<string, string> = {};
        for (const storageArray of result.data) {
          if (storageArray.name && storageArray.storageSystem) {
            systems[storageArray.name] = storageArray.storageSystem;
          }
        }
        setArrayOptions(options);
        setStorageSystemByArray(systems);
      })
      .catch(() => {
        setArrayOptions([]);
      })
      .finally(() => {
        setIsLoadingArrays(false);
      });
  }, []);

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

  const handleTemplateSelection: (
    template: StorageArrayAlertTemplate,
  ) => void = (template: StorageArrayAlertTemplate): void => {
    setSelectedTemplateId(template.id);

    const arrayIdentifier: string =
      monitorStepStorageArrayMonitor.arrayIdentifier;

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

  const handleCustomMetricSelection: (
    metric: StorageArrayMetricDefinition,
  ) => void = (metric: StorageArrayMetricDefinition): void => {
    setSelectedMetricId(metric.id);
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
  };

  const renderArrayDropdown: () => ReactElement = (): ReactElement => {
    return (
      <div className="mb-4">
        <FieldLabelElement
          title="Storage Array"
          description={
            "Select the storage array to monitor. Its platform decides which metrics and templates are offered."
          }
          required={true}
        />
        <Dropdown
          options={arrayOptions}
          value={arrayOptions.find((option: DropdownOption) => {
            return (
              option.value === monitorStepStorageArrayMonitor.arrayIdentifier
            );
          })}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            const arrayIdentifier: string = (value as string) || "";
            props.onChange({
              ...monitorStepStorageArrayMonitor,
              arrayIdentifier: arrayIdentifier,
              storageSystem: storageSystemByArray[arrayIdentifier] || undefined,
            });
          }}
          placeholder="Select a storage array..."
        />
      </div>
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
        />

        {selectedTemplateId && (
          <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
            <h4 className="text-sm font-medium text-blue-900 mb-2">
              {translator.translateText("Template Configuration")}
            </h4>
            <p className="text-xs text-blue-700 mb-3">
              {translator.translateText(
                "The following settings have been auto-configured. You can adjust the time range below.",
              )}
            </p>

            <FieldLabelElement
              title="Time Range"
              description={"Adjust the monitoring time range."}
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
        )}
      </div>
    );
  };

  const renderCustomMetric: () => ReactElement = (): ReactElement => {
    return (
      <div className="mt-4 space-y-4">
        <div>
          <FieldLabelElement
            title="Storage Array Metric"
            description={
              "Select a metric the array exports. Metrics are organized by what they describe — array health, capacity, performance, volumes, hosts, replication, hardware, file systems and buckets."
            }
            required={true}
          />
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
                description={
                  "Select the time range for the storage array monitor."
                }
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
            description={"Select the time range for the storage array monitor."}
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
          <FieldLabelElement
            title="Select Metrics"
            description={
              "Select the storage array metrics to monitor. Use the query builder for full control over metric selection, label filters (for example `dimension`, `severity`, `component_status`) and grouping."
            }
            required={true}
          />

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
      {renderArrayDropdown()}

      <Tabs tabs={tabs} onTabChange={() => {}} />
    </div>
  );
};

export default StorageArrayMonitorStepForm;
