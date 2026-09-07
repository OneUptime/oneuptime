import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import VMwareSource from "Common/Models/DatabaseModels/VMwareSource";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import MonitorStepVmwareMonitor, {
  MonitorStepVmwareMonitorUtil,
  VmwareResourceType,
} from "Common/Types/Monitor/MonitorStepVmwareMonitor";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import {
  buildVmwareMonitorConfig,
  getVmwareAlertTemplates,
  VmwareAlertTemplate,
} from "Common/Types/Monitor/VmwareAlertTemplates";
import {
  getVmwareMetricCatalog,
  VmwareMetricDefinition,
} from "Common/Types/Monitor/VmwareMetricCatalog";
import RollingTimePicker from "Common/UI/Components/RollingTimePicker/RollingTimePicker";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import RollingTimeUtil from "Common/Types/RollingTime/RollingTimeUtil";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import MetricView from "../../../Metrics/MetricView";

export interface ComponentProps {
  monitorStepVmwareMonitor: MonitorStepVmwareMonitor;
  onChange: (config: MonitorStepVmwareMonitor) => void;
  onMonitorCriteriaChange?: ((criteria: MonitorCriteria) => void) | undefined;
  onlineMonitorStatusId?: ObjectID | undefined;
  offlineMonitorStatusId?: ObjectID | undefined;
  defaultIncidentSeverityId?: ObjectID | undefined;
  defaultAlertSeverityId?: ObjectID | undefined;
  monitorName?: string | undefined;
}

const fieldClass: string =
  "mt-2 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100";

const VmwareMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const config: MonitorStepVmwareMonitor =
    props.monitorStepVmwareMonitor || MonitorStepVmwareMonitorUtil.getDefault();
  const [sources, setSources] = useState<Array<VMwareSource>>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  useEffect(() => {
    let disposed: boolean = false;
    ModelAPI.getList({
      modelType: VMwareSource,
      query: { isArchived: false },
      select: { _id: true, name: true, sourceIdentifier: true },
      sort: { name: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    })
      .then((result: ListResult<VMwareSource>) => {
        if (!disposed) {
          setSources(result.data);
        }
      })
      .catch((err: unknown) => {
        if (!disposed) {
          setError(API.getFriendlyMessage(err));
        }
      })
      .finally(() => {
        if (!disposed) {
          setLoading(false);
        }
      });
    if (!config.sourceIdentifier) {
      const sourceIdentifier: string | null =
        Navigation.getQueryStringByName("vmwareSource");
      const resourceIdentifier: string | null =
        Navigation.getQueryStringByName("vmwareResource");
      const type: string | null =
        Navigation.getQueryStringByName("vmwareResourceType");
      if (sourceIdentifier) {
        props.onChange({
          ...config,
          sourceIdentifier,
          resourceFilters: {
            resourceIdentifier: resourceIdentifier || undefined,
            resourceType:
              type &&
              Object.values(VmwareResourceType).includes(
                type as VmwareResourceType,
              )
                ? (type as VmwareResourceType)
                : undefined,
          },
        });
      }
    }
    return () => {
      disposed = true;
    };
  }, []);

  const update: (next: MonitorStepVmwareMonitor) => void = (
    next: MonitorStepVmwareMonitor,
  ): void => {
    props.onChange({
      ...next,
      metricViewConfig:
        MonitorStepVmwareMonitorUtil.toMetricMonitor(next).metricViewConfig,
    });
  };
  const templateDefaultsReady: boolean = Boolean(
    props.onlineMonitorStatusId &&
      props.offlineMonitorStatusId &&
      props.defaultIncidentSeverityId &&
      props.defaultAlertSeverityId,
  );
  const selectTemplate: (template: VmwareAlertTemplate) => void = (
    template: VmwareAlertTemplate,
  ): void => {
    if (
      !props.onlineMonitorStatusId ||
      !props.offlineMonitorStatusId ||
      !props.defaultIncidentSeverityId ||
      !props.defaultAlertSeverityId
    ) {
      return;
    }
    const step: MonitorStep = template.getMonitorStep({
      sourceIdentifier: config.sourceIdentifier,
      onlineMonitorStatusId: props.onlineMonitorStatusId,
      offlineMonitorStatusId: props.offlineMonitorStatusId,
      defaultIncidentSeverityId: props.defaultIncidentSeverityId,
      defaultAlertSeverityId: props.defaultAlertSeverityId,
      monitorName: props.monitorName || template.name,
    });
    if (step.data?.vmwareMonitor) {
      const next: MonitorStepVmwareMonitor = step.data.vmwareMonitor;
      if (
        !MonitorStepVmwareMonitorUtil.isSourceMonitor(next) &&
        (!next.resourceFilters.resourceType ||
          config.resourceFilters.resourceType ===
            next.resourceFilters.resourceType)
      ) {
        next.resourceFilters.resourceType =
          next.resourceFilters.resourceType ||
          config.resourceFilters.resourceType;
        next.resourceFilters.resourceIdentifier =
          config.resourceFilters.resourceIdentifier;
      }
      update(next);
    }
    if (step.data?.monitorCriteria) {
      props.onMonitorCriteriaChange?.(step.data.monitorCriteria);
    }
    setSelectedTemplate(template.id);
  };
  const validation: string | undefined = config.metricViewConfig.queryConfigs
    .length
    ? MonitorStepVmwareMonitorUtil.getValidationError(config)
    : undefined;
  return (
    <div className="space-y-5">
      {error && <ErrorMessage message={error} />}
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
        VMware source
        <select
          aria-label="VMware source"
          className={fieldClass}
          value={config.sourceIdentifier}
          disabled={loading}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
            update({
              ...config,
              sourceIdentifier: event.target.value,
              resourceFilters: {
                resourceType: config.resourceFilters.resourceType,
              },
            });
          }}
        >
          <option value="">
            {loading ? "Loading sources…" : "Select a source"}
          </option>
          {config.sourceIdentifier &&
            !sources.some((source: VMwareSource) => {
              return source.sourceIdentifier === config.sourceIdentifier;
            }) && (
              <option value={config.sourceIdentifier}>
                {config.sourceIdentifier}
              </option>
            )}
          {sources.map((source: VMwareSource) => {
            return (
              <option key={source._id} value={source.sourceIdentifier}>
                {source.name || source.sourceIdentifier} (
                {source.sourceIdentifier})
              </option>
            );
          })}
        </select>
      </label>
      {!loading && !sources.length && (
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Connect a VMware source from the VMware section before enabling this
          monitor.
        </p>
      )}
      {config.sourceIdentifier && !templateDefaultsReady && (
        <p role="status" className="text-sm text-gray-500">
          Waiting for project status and severity settings before enabling alert
          templates.
        </p>
      )}
      <Tabs
        onTabChange={() => {}}
        tabs={[
          {
            name: "Alert templates",
            children: (
              <div>
                <p className="py-3 text-sm text-gray-600 dark:text-gray-300">
                  Generated alerts and incidents use your project’s default
                  severities. Review them in the criteria below.
                </p>
                <div className="grid grid-cols-1 gap-3 py-4 md:grid-cols-2">
                  {getVmwareAlertTemplates().map(
                    (template: VmwareAlertTemplate) => {
                      return (
                        <button
                          key={template.id}
                          type="button"
                          aria-pressed={selectedTemplate === template.id}
                          disabled={
                            !config.sourceIdentifier || !templateDefaultsReady
                          }
                          onClick={() => {
                            selectTemplate(template);
                          }}
                          className={`rounded-lg border p-4 text-left transition-colors disabled:opacity-50 ${selectedTemplate === template.id ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950" : "border-gray-200 bg-white hover:border-indigo-300 dark:border-gray-700 dark:bg-gray-900"}`}
                        >
                          <span className="text-xs font-medium text-indigo-600 dark:text-indigo-300">
                            {template.category} · Recommended severity:{" "}
                            {template.severity}
                          </span>
                          <span className="mt-1 block text-sm font-semibold text-gray-900 dark:text-gray-100">
                            {template.name}
                          </span>
                          <span className="mt-2 block text-sm leading-5 text-gray-600 dark:text-gray-300">
                            {template.description}
                          </span>
                        </button>
                      );
                    },
                  )}
                </div>
              </div>
            ),
          },
          {
            name: "Custom metric",
            children: (
              <label className="block py-4 text-sm font-medium text-gray-700 dark:text-gray-200">
                Metric
                <select
                  aria-label="VMware metric"
                  className={fieldClass}
                  defaultValue=""
                  onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                    const metric: VmwareMetricDefinition | undefined =
                      getVmwareMetricCatalog().find(
                        (item: VmwareMetricDefinition) => {
                          return item.id === event.target.value;
                        },
                      );
                    if (metric) {
                      const isSourceMetric: boolean =
                        metric.metricName.startsWith(
                          "oneuptime.vmware.source.",
                        );
                      update(
                        buildVmwareMonitorConfig({
                          sourceIdentifier: config.sourceIdentifier,
                          metricName: metric.metricName,
                          metricAlias: metric.id.replace(/-/g, "_"),
                          rollingTime: config.rollingTime,
                          aggregationType: metric.defaultAggregation,
                          resourceType: isSourceMetric
                            ? undefined
                            : metric.defaultResourceType ||
                              config.resourceFilters.resourceType,
                          resourceIdentifier:
                            !isSourceMetric &&
                            (!metric.defaultResourceType ||
                              config.resourceFilters.resourceType ===
                                metric.defaultResourceType)
                              ? config.resourceFilters.resourceIdentifier
                              : undefined,
                          legendUnit: metric.unit,
                        }),
                      );
                      setSelectedTemplate("");
                    }
                  }}
                >
                  <option value="" disabled>
                    Select a VMware metric
                  </option>
                  {getVmwareMetricCatalog().map(
                    (metric: VmwareMetricDefinition) => {
                      return (
                        <option key={metric.id} value={metric.id}>
                          {metric.category} · {metric.friendlyName}
                        </option>
                      );
                    },
                  )}
                </select>
                <span className="mt-2 block font-normal text-gray-500">
                  Set the threshold and incident actions in the monitor criteria
                  below.
                </span>
              </label>
            ),
          },
          {
            name: "Advanced query",
            children: (
              <MetricView
                hideStartAndEndDate={true}
                hideCardInQueryElements={true}
                hideCardInCharts={true}
                disableChartZoom={true}
                data={{
                  startAndEndDate: RollingTimeUtil.convertToStartAndEndDate(
                    config.rollingTime,
                  ),
                  queryConfigs: config.metricViewConfig.queryConfigs,
                  formulaConfigs: config.metricViewConfig.formulaConfigs,
                }}
                onChange={(data: MetricViewData) => {
                  update({
                    ...config,
                    metricViewConfig: {
                      queryConfigs: data.queryConfigs || [],
                      formulaConfigs: data.formulaConfigs || [],
                    },
                  });
                }}
              />
            ),
          },
        ]}
      />
      {!MonitorStepVmwareMonitorUtil.isSourceMonitor(config) && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
            Resource type
            <select
              aria-label="Resource type"
              className={fieldClass}
              value={config.resourceFilters.resourceType || ""}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                update({
                  ...config,
                  resourceFilters: {
                    resourceType:
                      (event.target.value as VmwareResourceType) || undefined,
                  },
                });
              }}
            >
              <option value="">All resource types</option>
              <option value="host">ESXi host</option>
              <option value="vm">Virtual machine</option>
              <option value="datastore">Datastore</option>
              <option value="cluster">Cluster</option>
            </select>
          </label>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
            Resource identifier (optional)
            <input
              aria-label="Resource identifier"
              className={fieldClass}
              value={config.resourceFilters.resourceIdentifier || ""}
              placeholder="All resources of this type"
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                update({
                  ...config,
                  resourceFilters: {
                    ...config.resourceFilters,
                    resourceIdentifier: event.target.value || undefined,
                  },
                });
              }}
            />
          </label>
        </div>
      )}
      <div>
        <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-200">
          Evaluation window
        </p>
        <RollingTimePicker
          value={config.rollingTime}
          onChange={(value: RollingTime) => {
            update({ ...config, rollingTime: value });
          }}
        />
      </div>
      {validation && (
        <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">
          {validation}
        </p>
      )}
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Collection and resource health use separate monitors. Resource alerts
        are grouped by stable identity, so renames do not create new incidents.
      </p>
    </div>
  );
};
export default VmwareMonitorStepForm;
