import MonitorStepXcpNgMonitor, {
  MonitorStepXcpNgMonitorUtil,
  XcpNgResourceFilters,
} from "Common/Types/Monitor/MonitorStepXcpNgMonitor";
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
import XcpNgPool from "Common/Models/DatabaseModels/XcpNgPool";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import XcpNgTemplatePicker from "./XcpNgTemplatePicker";
import XcpNgMetricPicker from "./XcpNgMetricPicker";
import {
  XcpNgAlertTemplate,
  buildXcpNgMonitorConfig,
  getXcpNgAlertTemplateById,
  getAllXcpNgAlertTemplates,
  getXcpNgDefaultAlertTemplateId,
} from "Common/Types/Monitor/XcpNgAlertTemplates";
import AlertTemplateConfiguration from "../AlertTemplatePicker/AlertTemplateConfiguration";
import { XcpNgMetricDefinition } from "Common/Types/Monitor/XcpNgMetricCatalog";
import {
  XCP_NG_ID_ATTRIBUTE,
  XcpNgScope,
} from "Common/Types/XcpNg/XcpNgTelemetry";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitorStepMetricQueries from "Common/Utils/Monitor/MonitorStepMetricQueries";
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
import XCP_NG_POOL_ONBOARDING from "../../../XcpNg/XcpNgPoolOnboarding";
import AddResourceModal from "../../../ResourceOnboarding/AddResourceModal";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

export interface ComponentProps {
  monitorStepXcpNgMonitor: MonitorStepXcpNgMonitor;
  onChange: (monitorStepXcpNgMonitor: MonitorStepXcpNgMonitor) => void;
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
 * Values are byte-equal to the `xcp_ng.scope` datapoint attribute stamped
 * at ingest (XcpNgSeriesNormalizer), so the monitor worker maps the filter
 * to attribute equality with no translation. The pool's own series (its
 * connection heartbeat) come last, as Proxmox lists its cluster last.
 * Never the bare "Pool": that key is a Ceph or OpenStack storage pool,
 * which some languages word apart from a pool of hosts.
 */
export const XCP_NG_SCOPE_OPTIONS: Array<DropdownOption> = [
  { label: "Host", value: XcpNgScope.Host },
  { label: "VM", value: XcpNgScope.VM },
  { label: "Storage Repository", value: XcpNgScope.StorageRepository },
  { label: "Virtual Disk", value: XcpNgScope.VDI },
  { label: "XOSTOR", value: XcpNgScope.Xostor },
  { label: "XCP-ng Pool", value: XcpNgScope.Pool },
];

// How far back a metric of your own reads when the step names no window.
const DEFAULT_ROLLING_TIME: RollingTime = RollingTime.Past5Minutes;

/*
 * The step a metric of your own starts as. One series - and so one
 * incident - per object: Xen Orchestra reports every host, VM, storage
 * repository and virtual disk of the pool from one scrape, and a monitor
 * that averaged them all would never fire for the one host that is pegged.
 * Every XCP-ng datapoint carries its object's UUID in `xcp_ng.id`, the key
 * the alert templates group by too. A pool's own series (one per pool) are
 * read whole. The scope filter starts on the kind of object the metric
 * describes; the host name typed already is kept, and a UUID typed for the
 * same kind of object, which names nothing of any other kind.
 */
export function buildXcpNgCustomMetricStep(input: {
  current: MonitorStepXcpNgMonitor;
  metric: XcpNgMetricDefinition;
}): MonitorStepXcpNgMonitor {
  const metric: XcpNgMetricDefinition = input.metric;
  const previousFilters: XcpNgResourceFilters =
    input.current.resourceFilters || {};

  const config: MonitorStepXcpNgMonitor = buildXcpNgMonitorConfig({
    poolIdentifier: input.current.poolIdentifier || "",
    queries: [
      {
        alias: metric.id.replace(/-/g, "_"),
        metricName: metric.metricName,
        /*
         * The unit the stored values are in, so the threshold written next
         * keeps meaning bytes per second, seconds or watts.
         */
        legendUnit: metric.unit || undefined,
      },
    ],
    rollingTime: input.current.rollingTime || DEFAULT_ROLLING_TIME,
    aggregationType: metric.defaultAggregation,
    groupByAttributeKey:
      metric.defaultResourceScope === XcpNgScope.Pool
        ? undefined
        : XCP_NG_ID_ATTRIBUTE,
  });

  const isSameScope: boolean =
    previousFilters.scope === metric.defaultResourceScope;

  config.resourceFilters = {
    scope: metric.defaultResourceScope,
    ...(isSameScope && previousFilters.xcpNgId
      ? { xcpNgId: previousFilters.xcpNgId }
      : {}),
    ...(previousFilters.hostName ? { hostName: previousFilters.hostName } : {}),
  };

  if (input.current.resourceId) {
    config.resourceId = input.current.resourceId;
  }

  return config;
}

const XcpNgMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [rollingTime, setRollingTime] = React.useState<RollingTime | null>(
    null,
  );

  const monitorStepXcpNgMonitor: MonitorStepXcpNgMonitor =
    props.monitorStepXcpNgMonitor || MonitorStepXcpNgMonitorUtil.getDefault();

  const resourceFilters: XcpNgResourceFilters =
    monitorStepXcpNgMonitor.resourceFilters || {};

  const [startAndEndTime, setStartAndEndTime] =
    React.useState<InBetween<Date> | null>(null);

  /*
   * The template a saved step was made from shows picked; a new step starts
   * on the type's default alert once drawn.
   */
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<
    string | undefined
  >(() => {
    return findTemplateIdForMetricsView<XcpNgAlertTemplate>({
      templates: getAllXcpNgAlertTemplates(),
      getMetricsViewConfig: (template: XcpNgAlertTemplate) => {
        return MonitorStep.getMetricsViewConfig(
          template.getMonitorStep({
            poolIdentifier: monitorStepXcpNgMonitor.poolIdentifier || "",
            onlineMonitorStatusId: ObjectID.generate(),
            offlineMonitorStatusId: ObjectID.generate(),
            defaultIncidentSeverityId: ObjectID.generate(),
            defaultAlertSeverityId: ObjectID.generate(),
            monitorName: template.name,
          }),
        );
      },
      current: monitorStepXcpNgMonitor.metricViewConfig,
    });
  });

  const [initialWay] = React.useState<InfrastructureWatchWay>(() => {
    return getInitialWatchWay({
      queryCount: monitorStepXcpNgMonitor.metricViewConfig.queryConfigs.length,
      isTemplatePicked: Boolean(selectedTemplateId),
    });
  });

  /*
   * A template applied before any pool was picked is applied again once
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
   * A pool is matched on its XAPI UUID (XcpNgPool.poolIdentifier), which is
   * what its telemetry carries: two Xen Orchestras can each manage a pool
   * called "Production", and a pool renamed in Xen Orchestra keeps its
   * monitors. The field shows the pool's name, and finds a pool by either.
   */
  const resources: InfrastructureResources<XcpNgPool> =
    useInfrastructureResources<XcpNgPool>({
      valueField: "poolIdentifier",
      searchFields: ["name", "poolIdentifier"],
      heldValue: monitorStepXcpNgMonitor.poolIdentifier,
      modelType: XcpNgPool,
      select: {
        _id: true,
        lastSeenAt: true,
        name: true,
        poolIdentifier: true,
      },
      toOption: (pool: XcpNgPool): DropdownOption => {
        return {
          label: pool.name || pool.poolIdentifier || "Unknown",
          // Its own name as written; "Unknown" in the reader's words.
          isUserContent: Boolean(pool.name || pool.poolIdentifier),
          value: pool.poolIdentifier || "",
        };
      },
      getLastSeenAt: (pool: XcpNgPool): Date | undefined => {
        return pool.lastSeenAt;
      },
    });

  useEffect(() => {
    if (rollingTime === monitorStepXcpNgMonitor.rollingTime) {
      return;
    }

    setRollingTime(monitorStepXcpNgMonitor.rollingTime);

    setStartAndEndTime(
      RollingTimeUtil.convertToStartAndEndDate(
        monitorStepXcpNgMonitor.rollingTime || RollingTime.Past1Minute,
      ),
    );
  }, [monitorStepXcpNgMonitor.rollingTime]);

  useEffect(() => {
    setStartAndEndTime(
      RollingTimeUtil.convertToStartAndEndDate(
        monitorStepXcpNgMonitor.rollingTime || RollingTime.Past1Minute,
      ),
    );
  }, []);

  const applyTemplate: (
    template: XcpNgAlertTemplate,
    poolIdentifier: string,
  ) => void = (template: XcpNgAlertTemplate, poolIdentifier: string): void => {
    templateAppliedWithoutResourceRef.current = !poolIdentifier;
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
      poolIdentifier: poolIdentifier || "",
      onlineMonitorStatusId,
      offlineMonitorStatusId,
      defaultIncidentSeverityId,
      defaultAlertSeverityId,
      monitorName,
    });

    if (templateStep.data?.xcpNgMonitor) {
      props.onChange({
        ...templateStep.data.xcpNgMonitor,
        poolIdentifier: poolIdentifier || "",
      });
    }

    if (templateStep.data?.monitorCriteria && props.onMonitorCriteriaChange) {
      props.onMonitorCriteriaChange(templateStep.data.monitorCriteria);
    }
  };

  const handleTemplateSelection: (template: XcpNgAlertTemplate) => void = (
    template: XcpNgAlertTemplate,
  ): void => {
    applyTemplate(template, monitorStepXcpNgMonitor.poolIdentifier);
  };

  // A new monitor starts on the alert most people want first.
  useEffect(() => {
    if (monitorStepXcpNgMonitor.metricViewConfig.queryConfigs.length > 0) {
      return;
    }

    const template: XcpNgAlertTemplate | undefined = getXcpNgAlertTemplateById(
      getXcpNgDefaultAlertTemplateId(),
    );

    if (template) {
      applyTemplate(template, monitorStepXcpNgMonitor.poolIdentifier);
    }
  }, []);

  const changeResource: (poolIdentifier: string) => void = (
    poolIdentifier: string,
  ): void => {
    const template: XcpNgAlertTemplate | undefined = selectedTemplateId
      ? getXcpNgAlertTemplateById(selectedTemplateId)
      : undefined;

    if (
      template &&
      templateAppliedWithoutResourceRef.current &&
      poolIdentifier
    ) {
      applyTemplate(template, poolIdentifier);
      return;
    }

    props.onChange({
      ...monitorStepXcpNgMonitor,
      poolIdentifier: poolIdentifier,
    });
  };

  const handleCustomMetricSelection: (metric: XcpNgMetricDefinition) => void = (
    metric: XcpNgMetricDefinition,
  ): void => {
    setSelectedMetricId(metric.id);
    // The metric replaces the one Quick Setup's template set.
    setSelectedTemplateId(undefined);
    templateAppliedWithoutResourceRef.current = false;
    setCustomAggregation(metric.defaultAggregation);

    props.onChange(
      buildXcpNgCustomMetricStep({
        current: monitorStepXcpNgMonitor,
        metric: metric,
      }),
    );

    /*
     * The template's criteria compared the template's own metric; kept, they
     * judged this one by another threshold and named another incident. A
     * metric of your own starts on the out-of-the-box criteria: offline
     * while it sends nothing, online while it does.
     */
    if (props.onMonitorCriteriaChange) {
      props.onMonitorCriteriaChange(
        MonitorCriteria.getDefaultMonitorCriteria({
          monitorType: MonitorType.XcpNg,
          monitorName: props.monitorName || metric.friendlyName,
          onlineMonitorStatusId:
            props.onlineMonitorStatusId || ObjectID.generate(),
          offlineMonitorStatusId:
            props.offlineMonitorStatusId || ObjectID.generate(),
          defaultIncidentSeverityId:
            props.defaultIncidentSeverityId || ObjectID.generate(),
          defaultAlertSeverityId:
            props.defaultAlertSeverityId || ObjectID.generate(),
          translator: translator,
        }),
      );
    }
  };

  const renderPoolDropdown: () => ReactElement = (): ReactElement => {
    return (
      <InfrastructureResourceField
        title="XCP-ng Pool"
        placeholder="Select an XCP-ng pool..."
        options={resources.options}
        value={resources.valueOf({
          value: monitorStepXcpNgMonitor.poolIdentifier,
          resourceId: monitorStepXcpNgMonitor.resourceId,
        })}
        onChange={changeResource}
        isLoading={resources.isLoading}
        lastSeenAtByValue={resources.lastSeenAtByValue}
        onSearchTextChange={resources.onSearchTextChange}
        addResource={{
          title: XCP_NG_POOL_ONBOARDING.addTitle,
          renderModal: (input: {
            onClose: () => void;
            onConnected: (value: string) => void;
          }): ReactElement => {
            return (
              <AddResourceModal
                onboarding={XCP_NG_POOL_ONBOARDING}
                onClose={input.onClose}
                onConnected={(record: BaseModel) => {
                  input.onConnected(
                    String((record as XcpNgPool).poolIdentifier || ""),
                  );
                }}
              />
            );
          },
        }}
        onResourceAdded={(poolIdentifier: string) => {
          resources
            .reload()
            .then(() => {
              changeResource(poolIdentifier);
            })
            .catch(() => {
              // The list keeps what it had; the new one can be picked from it.
            });
        }}
      />
    );
  };

  const changeResourceFilters: (
    filters: Partial<XcpNgResourceFilters>,
  ) => void = (filters: Partial<XcpNgResourceFilters>): void => {
    props.onChange({
      ...monitorStepXcpNgMonitor,
      resourceFilters: {
        ...resourceFilters,
        ...filters,
      },
    });
  };

  /*
   * Each filter is one equality the worker adds to every query
   * (MonitorStepMetricQueries.applyXcpNgResourceFilters): the scope and
   * the UUID on the `xcp_ng.scope` / `xcp_ng.id` attributes ingest stamps
   * on every datapoint, whichever of Xen Orchestra's labels named the
   * object; the host name on Xen Orchestra's own `host_name` label, which
   * a host's series and the series of every VM it runs carry.
   */
  const renderResourceFilters: () => ReactElement = (): ReactElement => {
    return (
      <>
        <div className="mt-3">
          <FieldLabelElement
            title="Resource Scope"
            description={
              "Only one kind of object: hosts, VMs, storage repositories, virtual disks or XOSTOR."
            }
            required={false}
          />
          <Dropdown
            options={XCP_NG_SCOPE_OPTIONS}
            value={XCP_NG_SCOPE_OPTIONS.find((option: DropdownOption) => {
              return option.value === resourceFilters.scope;
            })}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              changeResourceFilters({
                scope: (value as XcpNgScope) || undefined,
              });
            }}
            placeholder="All resource types"
          />
        </div>

        <div className="mt-3">
          <FieldLabelElement
            title="UUID"
            description={
              "One host, VM, storage repository or virtual disk, by the UUID Xen Orchestra shows for it. Pair it with a scope."
            }
            required={false}
          />
          <Input
            value={resourceFilters.xcpNgId || ""}
            onChange={(value: string) => {
              changeResourceFilters({
                xcpNgId: value || undefined,
              });
            }}
            placeholder="e.g. 5c6d7e8f-1a2b-4c3d-9e8f-0a1b2c3d4e5f"
          />
        </div>

        <div className="mt-3">
          <FieldLabelElement
            title="Host Name"
            description={
              "Only this host's own series and those of the VMs running on it."
            }
            required={false}
          />
          <Input
            value={resourceFilters.hostName || ""}
            onChange={(value: string) => {
              changeResourceFilters({
                hostName: value || undefined,
              });
            }}
            placeholder="e.g. xcp-host-01"
          />
        </div>
      </>
    );
  };

  const renderQuickSetup: () => ReactElement = (): ReactElement => {
    return (
      <div className="mt-4">
        <XcpNgTemplatePicker
          selectedTemplateId={selectedTemplateId}
          onTemplateSelected={(template: XcpNgAlertTemplate) => {
            handleTemplateSelection(template);
          }}
        >
          <AlertTemplateConfiguration
            rollingTime={monitorStepXcpNgMonitor.rollingTime}
            onRollingTimeChange={(value: RollingTime) => {
              props.onChange({
                ...monitorStepXcpNgMonitor,
                rollingTime: value,
              });
            }}
          />
        </XcpNgTemplatePicker>
      </div>
    );
  };

  const renderCustomMetric: () => ReactElement = (): ReactElement => {
    return (
      <div className="mt-4 space-y-4">
        <div>
          <FieldLabelElement title="XCP-ng Metric" required={true} />
          <XcpNgMetricPicker
            selectedMetricId={selectedMetricId}
            onMetricSelected={(metric: XcpNgMetricDefinition) => {
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
                    monitorStepXcpNgMonitor.metricViewConfig.queryConfigs
                      .length > 0
                  ) {
                    const currentQueryConfig: MetricQueryConfigData =
                      monitorStepXcpNgMonitor.metricViewConfig.queryConfigs[0]!;
                    if (currentQueryConfig) {
                      props.onChange({
                        ...monitorStepXcpNgMonitor,
                        metricViewConfig: {
                          ...monitorStepXcpNgMonitor.metricViewConfig,
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
                value={monitorStepXcpNgMonitor.rollingTime}
                onChange={(value: RollingTime) => {
                  if (value === monitorStepXcpNgMonitor.rollingTime) {
                    return;
                  }

                  props.onChange({
                    ...monitorStepXcpNgMonitor,
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
            value={monitorStepXcpNgMonitor.rollingTime}
            onChange={(value: RollingTime) => {
              if (value === monitorStepXcpNgMonitor.rollingTime) {
                return;
              }

              props.onChange({
                ...monitorStepXcpNgMonitor,
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
                monitorStepXcpNgMonitor.metricViewConfig.queryConfigs,
              formulaConfigs:
                monitorStepXcpNgMonitor.metricViewConfig.formulaConfigs,
            }}
            /*
             * Charted as the monitor reads them: narrowed to the pool
             * picked above and its filters, which the worker adds before
             * each check and the step never saves (issue #6264).
             */
            chartQueryConfigs={MonitorStepMetricQueries.getReadQueryConfigs({
              monitorType: MonitorType.XcpNg,
              settings: monitorStepXcpNgMonitor,
            })}
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
                ...monitorStepXcpNgMonitor,
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
      resourceField={renderPoolDropdown()}
      alertTemplates={renderQuickSetup()}
      customMetric={renderCustomMetric()}
      queryBuilder={renderAdvanced()}
      initialWay={initialWay}
    />
  );
};

export default XcpNgMonitorStepForm;
