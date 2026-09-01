import CriteriaFilterUiUtil from "../../../Utils/Form/Monitor/CriteriaFilter";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsViewConfig from "Common/Types/Metrics/MetricsViewConfig";
import MetricUnitUtil, { UnitOption } from "Common/Utils/MetricUnitUtil";
import {
  AnomalyDetectionSensitivity,
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil,
  EvaluateOverTimeOptions,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "Common/Types/Monitor/CriteriaFilter";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorStepMetricViewConfigUtil from "Common/Types/Monitor/MonitorStepMetricViewConfigUtil";
import MonitorType from "Common/Types/Monitor/MonitorType";
import SnmpOidListUtil from "Common/Types/Monitor/SnmpMonitor/SnmpOidListUtil";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import CheckboxElement from "Common/UI/Components/Checkbox/Checkbox";
import CollapsibleSection from "Common/UI/Components/CollapsibleSection/CollapsibleSection";
import FieldLabelElement from "Common/UI/Components/Detail/FieldLabel";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Input from "Common/UI/Components/Input/Input";
import Link from "Common/UI/Components/Link/Link";
import React, { FunctionComponent, ReactElement, useEffect } from "react";

/*
 * One entry of a network device's EFFECTIVE health-OID list - the list the
 * probe is actually handed on the next poll, which is the linked OID
 * Collection Template's OIDs merged with the device's own (see
 * SnmpOidListUtil.mergeOidLists).
 *
 * `templateName` is set only on the entries the template supplied, so an
 * operator building a criteria can tell an OID shared by every device on that
 * template from one that exists only on this device.
 */
export interface NetworkDeviceOidCatalogueEntry {
  oid: string;
  name?: string | undefined;
  templateName?: string | undefined;
}

export interface NetworkDeviceCriteriaCatalogue {
  oids: Array<NetworkDeviceOidCatalogueEntry>;
  // Names of the monitored interfaces the device's last walk found.
  interfaceNames: Array<string>;
}

export const EMPTY_NETWORK_DEVICE_CRITERIA_CATALOGUE: NetworkDeviceCriteriaCatalogue =
  {
    oids: [],
    interfaceNames: [],
  };

/*
 * The catalogue is fetched once per monitor step (MonitorStep.tsx) and read
 * here, three components down, by the OID and interface pickers.
 *
 * It travels the last hop by context because CriteriaFilters - the list
 * wrapper between MonitorCriteriaInstance and this component - has no use for
 * it at all. The provider sits in MonitorCriteriaInstance, which does take the
 * catalogue as an ordinary prop, so every component that has an opinion about
 * this data still receives it explicitly.
 */
export const NetworkDeviceCriteriaCatalogueContext: React.Context<NetworkDeviceCriteriaCatalogue> =
  React.createContext<NetworkDeviceCriteriaCatalogue>(
    EMPTY_NETWORK_DEVICE_CRITERIA_CATALOGUE,
  );

export interface ComponentProps {
  value: CriteriaFilter | undefined;
  onChange?: undefined | ((value: CriteriaFilter) => void);
  onDelete?: undefined | (() => void);
  monitorType: MonitorType;
  monitorStep: MonitorStep;
}

const CriteriaFilterElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const criteriaFilter: CriteriaFilter | undefined = props.value;

  const networkDeviceCatalogue: NetworkDeviceCriteriaCatalogue =
    React.useContext(NetworkDeviceCriteriaCatalogueContext);

  const [valuePlaceholder, setValuePlaceholder] = React.useState<string>("");

  const [checkOnOptions, setCheckOnOptions] = React.useState<
    Array<DropdownOption>
  >([]);

  const [isLoading, setIsLoading] = React.useState<boolean>(true);

  useEffect(() => {
    setCheckOnOptions(
      CriteriaFilterUiUtil.getCheckOnOptionsByMonitorType(props.monitorType),
    );
    setIsLoading(false);
  }, [props.monitorType]);

  const [filterTypeOptions, setFilterTypeOptions] = React.useState<
    Array<DropdownOption>
  >([]);

  useEffect(() => {
    setFilterTypeOptions(
      criteriaFilter?.checkOn
        ? CriteriaFilterUiUtil.getFilterTypeOptionsByCheckOn(
            criteriaFilter?.checkOn,
          )
        : [],
    );
    setValuePlaceholder(
      criteriaFilter?.checkOn
        ? CriteriaFilterUiUtil.getFilterTypePlaceholderValueByCheckOn({
            monitorType: props.monitorType,
            checkOn: criteriaFilter?.checkOn,
          })
        : "",
    );
  }, [criteriaFilter]);

  const isMetricOnly: boolean = CriteriaFilterUiUtil.isMetricOnlyMonitorType(
    props.monitorType,
  );

  // Auto-select MetricValue for metric-only monitor types (Kubernetes, Metrics)
  useEffect(() => {
    if (
      isMetricOnly &&
      criteriaFilter &&
      criteriaFilter.checkOn !== CheckOn.MetricValue
    ) {
      props.onChange?.({
        ...criteriaFilter,
        checkOn: CheckOn.MetricValue,
        /*
         * The condition travels with the check. A filter seeded elsewhere
         * (a brand new criteria starts on "Is Online") carries a condition
         * that a metric threshold has no use for, and the Condition
         * dropdown would render nothing at all - so carry it over only
         * when it still applies, and otherwise start on the default.
         */
        filterType: CriteriaFilterUiUtil.getFilterTypeOrDefault({
          checkOn: CheckOn.MetricValue,
          filterType: criteriaFilter.filterType,
        }),
      });
    }
  }, [isMetricOnly]);

  if (isLoading) {
    return <></>;
  }

  const filterConditionValue: DropdownOption | undefined =
    filterTypeOptions.find((i: DropdownOption) => {
      return i.value === criteriaFilter?.filterType;
    });

  const evaluateOverTimeMinutesValue: DropdownOption | undefined =
    CriteriaFilterUiUtil.getEvaluateOverTimeMinutesOptions().find(
      (item: DropdownOption) => {
        return (
          item.value ===
          criteriaFilter?.evaluateOverTimeOptions?.timeValueInMinutes
        );
      },
    );

  const evalOverTimeDropdownOptions: Array<DropdownOption> =
    CriteriaFilterUtil.getEvaluateOverTimeTypeByCriteriaFilter(
      criteriaFilter,
    ).map((item: EvaluateOverTimeType) => {
      return {
        value: item,
        label: item,
      };
    });

  const evaluateOverTimeTypeValue: DropdownOption | undefined =
    evalOverTimeDropdownOptions.find((item: DropdownOption) => {
      return (
        item.value ===
        criteriaFilter?.evaluateOverTimeOptions?.evaluateOverTimeType
      );
    });

  const metricAggregationOptions: Array<DropdownOption> = [
    ...evalOverTimeDropdownOptions,
  ]; // evalOverTimeDropdownOptions and metricAggregationOptions are same

  const metricAggregationValue: DropdownOption | undefined =
    metricAggregationOptions.find((i: DropdownOption) => {
      return (
        i.value === criteriaFilter?.metricMonitorOptions?.metricAggregationType
      );
    });

  /*
   * Collect metric variables from whichever metric-shaped monitor sub-config is
   * populated on this step (metricMonitor, hostMonitor, kubernetesMonitor,
   * dockerMonitor, dockerSwarmMonitor, podmanMonitor, proxmoxMonitor,
   * cephMonitor, iotMonitor). Centralized in MonitorStepMetricViewConfigUtil so
   * a new metric-shaped monitor type can't silently leave this dropdown empty.
   */
  const metricViewConfig: MetricsViewConfig | undefined =
    MonitorStepMetricViewConfigUtil.getMetricViewConfig(
      props.monitorStep?.data,
    );

  const metricVariables: Array<string> =
    MonitorStepMetricViewConfigUtil.getMetricVariables(props.monitorStep?.data);

  // now make this into dropdown options.
  const metricVariableOptions: Array<DropdownOption> = metricVariables.map(
    (item: string) => {
      return {
        value: item,
        label: item,
      };
    },
  );

  let selectedMetricVariableOption: DropdownOption | undefined =
    metricVariableOptions.find((i: DropdownOption) => {
      return i.value === criteriaFilter?.metricMonitorOptions?.metricAlias;
    });

  if (!selectedMetricVariableOption) {
    // select first varoable.
    selectedMetricVariableOption = metricVariableOptions[0];
  }

  /*
   * Resolve the native unit of the currently selected metric alias so the
   * threshold input can offer a compatible unit dropdown (e.g. ms/sec/min
   * when the metric is in ms). Checks queries first, then formulas.
   */
  const selectedMetricUnit: string | undefined = (() => {
    const alias: string | undefined =
      (selectedMetricVariableOption?.value as string | undefined) ||
      criteriaFilter?.metricMonitorOptions?.metricAlias;
    if (!alias) {
      return undefined;
    }

    const matchedQuery: MetricQueryConfigData | undefined =
      metricViewConfig?.queryConfigs?.find((q: MetricQueryConfigData) => {
        return q.metricAliasData?.metricVariable === alias;
      });
    if (matchedQuery?.metricAliasData?.legendUnit) {
      return matchedQuery.metricAliasData.legendUnit;
    }

    const matchedFormula: MetricFormulaConfigData | undefined =
      metricViewConfig?.formulaConfigs?.find((f: MetricFormulaConfigData) => {
        return f.metricAliasData?.metricVariable === alias;
      });
    return matchedFormula?.metricAliasData?.legendUnit || undefined;
  })();

  const thresholdUnitOptions: Array<UnitOption> =
    MetricUnitUtil.getCompatibleUnits(selectedMetricUnit);

  /*
   * Default the dropdown to the metric's own unit when the user hasn't
   * picked one yet, so the label next to the value always reads the way
   * they configured the metric.
   */
  const currentThresholdUnitValue: string | undefined =
    criteriaFilter?.metricMonitorOptions?.thresholdUnit ||
    MetricUnitUtil.getCanonicalUnitValue(selectedMetricUnit);

  const selectedThresholdUnitOption: DropdownOption | undefined =
    thresholdUnitOptions.find((o: UnitOption) => {
      return o.value === currentThresholdUnitValue;
    });

  return (
    <div>
      <div className="rounded-md p-2 bg-gray-50 my-5 border-gray-200 border-solid border-2">
        {/* Hide Filter Type dropdown for metric-only monitors since MetricValue is the only option */}
        {!isMetricOnly && (
          <div className="">
            <FieldLabelElement title="Filter Type" />
            <Dropdown
              value={checkOnOptions.find((i: DropdownOption) => {
                return i.value === criteriaFilter?.checkOn;
              })}
              options={checkOnOptions}
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                const checkOn: CheckOn = value?.toString() as CheckOn;

                props.onChange?.({
                  checkOn: checkOn,
                  /*
                   * Start the new check on its default condition rather
                   * than clearing it. An empty Filter Condition sits
                   * unnoticed next to fields that are all filled in, and
                   * a criteria saved without one never matches anything.
                   */
                  filterType:
                    CriteriaFilterUiUtil.getDefaultFilterTypeByCheckOn(checkOn),
                  value: undefined,
                  evaluateOverTime: false,
                  evaluateOverTimeOptions: undefined,
                });
              }}
            />
          </div>
        )}

        {criteriaFilter?.checkOn &&
          criteriaFilter?.checkOn === CheckOn.DiskUsagePercent && (
            <div className="mt-1">
              <FieldLabelElement
                title="Disk Path"
                description="The mount point or device to check. Enter * to check every disk the agent reports and raise a separate alert for each one — otherwise a second disk filling up is silenced while the first disk's alert is open."
              />

              <Input
                placeholder={"* or C:\\ or /mnt/data or /dev/sda1"}
                value={criteriaFilter?.serverMonitorOptions?.diskPath?.toString()}
                onChange={(value: string) => {
                  props.onChange?.({
                    ...criteriaFilter,
                    serverMonitorOptions: {
                      diskPath: value,
                    },
                  });
                }}
              />
            </div>
          )}

        {criteriaFilter?.checkOn &&
          (criteriaFilter.checkOn === CheckOn.SnmpOidValue ||
            criteriaFilter.checkOn === CheckOn.SnmpOidExists) &&
          (() => {
            /*
             * The options are the device's effective OID list, fetched once
             * per step. This used to read monitorStep.data.snmpMonitor.oids -
             * a field belonging to the retired standalone SNMP monitor type,
             * which a Network Device step never populates. The dropdown was
             * therefore empty for everyone, snmpMonitorOptions.oid was never
             * set, and both OID criteria bailed out server-side with no OID
             * to evaluate. Nobody could alert on a health OID at all.
             */
            const oidOptions: Array<DropdownOption> =
              networkDeviceCatalogue.oids.map(
                (entry: NetworkDeviceOidCatalogueEntry): DropdownOption => {
                  const oidLabel: string = entry.name
                    ? `${entry.name} (${entry.oid})`
                    : entry.oid;

                  return {
                    value: entry.oid,
                    label: entry.templateName
                      ? `${oidLabel} - from template ${entry.templateName}`
                      : oidLabel,
                  };
                },
              );

            const savedOid: string = SnmpOidListUtil.normalizeOid(
              criteriaFilter?.snmpMonitorOptions?.oid,
            );

            let selectedOidOption: DropdownOption | undefined = oidOptions.find(
              (option: DropdownOption) => {
                return (
                  SnmpOidListUtil.normalizeOid(option.value.toString()) ===
                  savedOid
                );
              },
            );

            /*
             * A saved OID that is no longer in the catalogue - a template
             * dropped it, or this step was pointed at a different device -
             * used to render a blank Dropdown while the stale value stayed in
             * the criteria: the form claimed nothing was selected while the
             * monitor still evaluated an OID nothing polls. Now it is listed,
             * selected, and labelled with why it will never match.
             */
            if (savedOid && !selectedOidOption) {
              selectedOidOption = {
                value: savedOid,
                label: `${savedOid} - no longer collected by this device`,
              };
              oidOptions.push(selectedOidOption);
            }

            const isDeviceSelected: boolean = Boolean(
              props.monitorStep.data?.networkDeviceMonitor?.networkDeviceId,
            );

            return (
              <div className="mt-1">
                <FieldLabelElement
                  title="OID"
                  description="Which of the health OIDs this device collects should this criteria evaluate?"
                />
                {oidOptions.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    {isDeviceSelected
                      ? "This device collects no health OIDs yet. Link an OID Collection Template, or add device-specific Health OIDs, on the device's Settings page - CPU, memory, temperature, fans and power supplies live there. Per-port traffic, errors and up/down are already collected by the interface walk, so they need no OID here."
                      : "Choose the network device for this monitor in the configuration above, and the health OIDs it collects are listed here."}
                  </p>
                ) : (
                  <Dropdown
                    value={selectedOidOption}
                    options={oidOptions}
                    onChange={(
                      value: DropdownValue | Array<DropdownValue> | null,
                    ) => {
                      props.onChange?.({
                        ...criteriaFilter,
                        snmpMonitorOptions: {
                          ...criteriaFilter?.snmpMonitorOptions,
                          oid: value?.toString(),
                        },
                      });
                    }}
                  />
                )}
              </div>
            );
          })()}

        {criteriaFilter?.checkOn &&
          (criteriaFilter?.checkOn === CheckOn.SnmpInterfaceIsDown ||
            criteriaFilter?.checkOn ===
              CheckOn.SnmpInterfaceUtilizationPercent ||
            criteriaFilter?.checkOn === CheckOn.SnmpInterfaceErrorsPerSecond) &&
          (() => {
            const savedInterfaceName: string =
              criteriaFilter?.snmpMonitorOptions?.interfaceName || "";

            /*
             * "*" first, then the interfaces the device's last walk actually
             * reported. The free-text input below stays, and has to: "*" is
             * not an interface, and a port that has not been walked yet - a
             * device registered minutes ago, a line card about to go in - is
             * a legitimate thing to write a criteria against before it shows
             * up here.
             */
            const interfaceOptions: Array<DropdownOption> = [
              {
                value: "*",
                label: "* - every monitored interface, alerting separately",
              },
              ...networkDeviceCatalogue.interfaceNames.map(
                (interfaceName: string): DropdownOption => {
                  return {
                    value: interfaceName,
                    label: interfaceName,
                  };
                },
              ),
            ];

            /*
             * The server matches interfaceName against name and alias
             * case-insensitively, so the picker resolves the saved value the
             * same way rather than showing "nothing selected" for a name that
             * does in fact match.
             */
            let selectedInterfaceOption: DropdownOption | undefined =
              interfaceOptions.find((option: DropdownOption) => {
                return (
                  option.value.toString().toLowerCase() ===
                  savedInterfaceName.toLowerCase()
                );
              });

            /*
             * Same rule as the OID picker: never show an empty control next
             * to a value that is saved. A hand-typed alias, or a port that
             * has since dropped off the walk, is shown as selected and said
             * to be off the list.
             */
            if (savedInterfaceName && !selectedInterfaceOption) {
              selectedInterfaceOption = {
                value: savedInterfaceName,
                label: `${savedInterfaceName} - not on this device's last interface walk`,
              };
            }

            return (
              <div className="mt-1">
                <FieldLabelElement
                  title="Interface (Optional)"
                  description="Scope this criteria to one interface, matched by name or alias (e.g. Gi0/1 or 'Uplink to core'). Leave empty to evaluate every monitored interface as one combined alert, or pick * to evaluate every interface and raise a separate alert for each one."
                />
                <Dropdown
                  value={selectedInterfaceOption}
                  options={interfaceOptions}
                  placeholder="Every monitored interface (combined)"
                  onChange={(
                    value: DropdownValue | Array<DropdownValue> | null,
                  ) => {
                    props.onChange?.({
                      ...criteriaFilter,
                      snmpMonitorOptions: {
                        ...criteriaFilter?.snmpMonitorOptions,
                        interfaceName: value?.toString() || undefined,
                      },
                    });
                  }}
                />
                <p className="text-xs text-gray-500 mt-2">
                  Or type a name or alias - for an interface this device has not
                  walked yet.
                </p>
                <Input
                  value={savedInterfaceName}
                  placeholder="* or Gi0/1"
                  onChange={(value: string) => {
                    props.onChange?.({
                      ...criteriaFilter,
                      snmpMonitorOptions: {
                        ...criteriaFilter?.snmpMonitorOptions,
                        interfaceName: value || undefined,
                      },
                    });
                  }}
                />
              </div>
            );
          })()}

        {criteriaFilter?.checkOn &&
          criteriaFilter?.checkOn === CheckOn.MetricValue && (
            <div className="mt-1">
              <FieldLabelElement
                title={isMetricOnly ? "Metric" : "Select Metric Variable"}
                description={
                  isMetricOnly
                    ? "Which metric query should this alert rule check?"
                    : undefined
                }
              />
              <Dropdown
                value={selectedMetricVariableOption}
                options={metricVariableOptions}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  /*
                   * Reset thresholdUnit when the metric changes — the new
                   * metric may be in a different unit family, and keeping a
                   * stale unit would silently mis-scale the threshold.
                   */
                  props.onChange?.({
                    ...criteriaFilter,
                    metricMonitorOptions: {
                      ...criteriaFilter?.metricMonitorOptions,
                      metricAlias: value?.toString(),
                      thresholdUnit: undefined,
                    },
                  });
                }}
              />
            </div>
          )}

        {criteriaFilter?.checkOn &&
          criteriaFilter?.checkOn === CheckOn.MetricValue && (
            <div className="mt-1">
              <FieldLabelElement
                title={isMetricOnly ? "Aggregation" : "Select Aggregation"}
                description={
                  isMetricOnly
                    ? "How to combine multiple data points (e.g. Average, Max, Min)."
                    : undefined
                }
              />
              <Dropdown
                value={metricAggregationValue}
                options={metricAggregationOptions}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  props.onChange?.({
                    ...criteriaFilter,
                    metricMonitorOptions: {
                      ...criteriaFilter?.metricMonitorOptions,
                      metricAggregationType:
                        value?.toString() as EvaluateOverTimeType,
                    },
                  });
                }}
              />
            </div>
          )}

        {/** checkbox for evaluateOverTime */}

        {criteriaFilter?.checkOn &&
          CriteriaFilterUtil.isEvaluateOverTimeFilter(
            criteriaFilter?.checkOn,
          ) && (
            <div className="mt-3">
              <CheckboxElement
                value={criteriaFilter?.evaluateOverTime}
                title={"Evaluate this criteria over a period of time"}
                onChange={(value: boolean) => {
                  props.onChange?.({
                    ...criteriaFilter,
                    evaluateOverTime: value,
                  });
                }}
              />
            </div>
          )}

        {criteriaFilter?.checkOn &&
        criteriaFilter?.checkOn &&
        CriteriaFilterUtil.isEvaluateOverTimeFilter(criteriaFilter?.checkOn) &&
        criteriaFilter.evaluateOverTime ? (
          <div className="mt-1">
            <FieldLabelElement title="Evaluate" />
            <Dropdown
              value={evaluateOverTimeTypeValue}
              options={evalOverTimeDropdownOptions}
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                const evaluateOverTimeOption: EvaluateOverTimeOptions =
                  criteriaFilter?.evaluateOverTimeOptions
                    ? {
                        ...criteriaFilter?.evaluateOverTimeOptions,
                      }
                    : {
                        timeValueInMinutes: 5,
                        evaluateOverTimeType: EvaluateOverTimeType.AllValues,
                      };

                props.onChange?.({
                  ...criteriaFilter,
                  evaluateOverTime: true,
                  evaluateOverTimeOptions: {
                    ...evaluateOverTimeOption,
                    evaluateOverTimeType:
                      value?.toString() as EvaluateOverTimeType,
                  },
                });
              }}
            />
          </div>
        ) : (
          <></>
        )}

        {criteriaFilter?.checkOn &&
        criteriaFilter?.checkOn &&
        CriteriaFilterUtil.isEvaluateOverTimeFilter(criteriaFilter?.checkOn) &&
        criteriaFilter.evaluateOverTime ? (
          <div className="mt-1">
            <FieldLabelElement title="For the last (in minutes)" />
            <Dropdown
              value={evaluateOverTimeMinutesValue}
              options={CriteriaFilterUiUtil.getEvaluateOverTimeMinutesOptions()}
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                const evaluateOverTimeOption: EvaluateOverTimeOptions =
                  criteriaFilter?.evaluateOverTimeOptions
                    ? {
                        ...criteriaFilter?.evaluateOverTimeOptions,
                      }
                    : {
                        timeValueInMinutes: 5,
                        evaluateOverTimeType: EvaluateOverTimeType.AllValues,
                      };

                props.onChange?.({
                  ...criteriaFilter,
                  evaluateOverTime: true,
                  evaluateOverTimeOptions: {
                    ...evaluateOverTimeOption,
                    timeValueInMinutes: value as number,
                  },
                });
              }}
            />
          </div>
        ) : (
          <></>
        )}

        {criteriaFilter?.checkOn &&
        CriteriaFilterUtil.isEvaluateOverTimeFilter(criteriaFilter?.checkOn) &&
        criteriaFilter.evaluateOverTime ? (
          <div className="mt-1">
            <FieldLabelElement
              title="If No Data"
              description={
                "What should happen while the window does not have enough data yet — for example a monitor that has only just started, or one whose checks stopped being recorded?"
              }
            />
            <Dropdown
              value={(() => {
                const policy: NoDataPolicy =
                  criteriaFilter?.evaluateOverTimeOptions?.onNoDataPolicy ||
                  NoDataPolicy.Ignore;
                return { value: policy, label: policy };
              })()}
              options={[
                {
                  value: NoDataPolicy.Ignore,
                  label: NoDataPolicy.Ignore,
                },
                {
                  value: NoDataPolicy.TreatAsZero,
                  label: NoDataPolicy.TreatAsZero,
                },
                {
                  value: NoDataPolicy.Trigger,
                  label: NoDataPolicy.Trigger,
                },
              ]}
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                const evaluateOverTimeOption: EvaluateOverTimeOptions =
                  criteriaFilter?.evaluateOverTimeOptions
                    ? {
                        ...criteriaFilter?.evaluateOverTimeOptions,
                      }
                    : {
                        timeValueInMinutes: 5,
                        evaluateOverTimeType: EvaluateOverTimeType.AllValues,
                      };

                props.onChange?.({
                  ...criteriaFilter,
                  evaluateOverTime: true,
                  evaluateOverTimeOptions: {
                    ...evaluateOverTimeOption,
                    onNoDataPolicy: value?.toString() as NoDataPolicy,
                  },
                });
              }}
            />
          </div>
        ) : (
          <></>
        )}

        {!criteriaFilter?.checkOn ||
          (criteriaFilter?.checkOn && (
            <div className="mt-1">
              <FieldLabelElement
                title={isMetricOnly ? "Condition" : "Filter Condition"}
                description={
                  isMetricOnly ? "When should this alert trigger?" : undefined
                }
              />
              <Dropdown
                value={filterConditionValue}
                options={filterTypeOptions}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  props.onChange?.({
                    ...criteriaFilter,
                    filterType: value?.toString() as FilterType,
                    value: undefined,
                  });
                }}
              />
            </div>
          ))}

        {!criteriaFilter?.checkOn ||
          (criteriaFilter?.checkOn &&
            CriteriaFilterUtil.hasValueField({
              checkOn: criteriaFilter?.checkOn,
              filterType: criteriaFilter?.filterType,
            }) &&
            !CriteriaFilterUiUtil.isDropdownValueField({
              checkOn: criteriaFilter?.checkOn,
            }) && (
              <div className="mt-1">
                <FieldLabelElement
                  title={isMetricOnly ? "Threshold" : "Value"}
                  description={
                    isMetricOnly
                      ? thresholdUnitOptions.length > 0
                        ? "The value and unit to compare against."
                        : "The value to compare against."
                      : undefined
                  }
                />
                {criteriaFilter?.checkOn === CheckOn.MetricValue &&
                thresholdUnitOptions.length > 0 ? (
                  <div className="flex gap-2 items-start">
                    <div className="flex-1">
                      <Input
                        placeholder={valuePlaceholder}
                        value={criteriaFilter?.value?.toString()}
                        onChange={(value: string) => {
                          props.onChange?.({
                            ...criteriaFilter,
                            value: value || "",
                            metricMonitorOptions: {
                              ...criteriaFilter?.metricMonitorOptions,
                              thresholdUnit: currentThresholdUnitValue,
                            },
                          });
                        }}
                      />
                    </div>
                    <div className="w-56">
                      <Dropdown
                        value={selectedThresholdUnitOption}
                        options={thresholdUnitOptions.map((o: UnitOption) => {
                          return { value: o.value, label: o.label };
                        })}
                        onChange={(
                          value: DropdownValue | Array<DropdownValue> | null,
                        ) => {
                          props.onChange?.({
                            ...criteriaFilter,
                            metricMonitorOptions: {
                              ...criteriaFilter?.metricMonitorOptions,
                              thresholdUnit: value?.toString(),
                            },
                          });
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <Input
                    placeholder={valuePlaceholder}
                    value={criteriaFilter?.value?.toString()}
                    onChange={(value: string) => {
                      props.onChange?.({
                        ...criteriaFilter,
                        value: value || "",
                      });
                    }}
                  />
                )}
              </div>
            ))}

        {!criteriaFilter?.checkOn ||
          (criteriaFilter?.checkOn &&
            CriteriaFilterUtil.hasValueField({
              checkOn: criteriaFilter?.checkOn,
              filterType: criteriaFilter?.filterType,
            }) &&
            CriteriaFilterUiUtil.isDropdownValueField({
              checkOn: criteriaFilter?.checkOn,
            }) && (
              <div className="mt-1">
                <FieldLabelElement title="Value" />
                <Dropdown
                  options={CriteriaFilterUiUtil.getDropdownOptionsByCheckOn({
                    checkOn: criteriaFilter?.checkOn,
                  })}
                  value={CriteriaFilterUiUtil.getDropdownOptionsByCheckOn({
                    checkOn: criteriaFilter?.checkOn,
                  }).find((i: DropdownOption) => {
                    return i.value === criteriaFilter?.value;
                  })}
                  onChange={(
                    value: DropdownValue | Array<DropdownValue> | null,
                  ) => {
                    props.onChange?.({
                      ...criteriaFilter,
                      value: value?.toString(),
                    });
                  }}
                />
              </div>
            ))}

        {(criteriaFilter?.checkOn === CheckOn.MetricValue ||
          criteriaFilter?.checkOn === CheckOn.SpanCount ||
          criteriaFilter?.checkOn === CheckOn.LogCount ||
          criteriaFilter?.checkOn ===
            CheckOn.SnmpInterfaceUtilizationPercent) &&
          CriteriaFilterUtil.isAnomalyFilterType(
            criteriaFilter?.filterType,
          ) && (
            <div className="mt-1">
              <FieldLabelElement
                title="Sensitivity"
                description="Lower sensitivity = larger expected range, fewer alerts. Compares each sample to the same-hour-of-week baseline computed from the configured Baseline Window below."
              />
              <Dropdown
                value={(() => {
                  const v: AnomalyDetectionSensitivity =
                    (criteriaFilter?.metricMonitorOptions?.anomalyDetection
                      ?.sensitivity as
                      | AnomalyDetectionSensitivity
                      | undefined) || AnomalyDetectionSensitivity.Medium;
                  return {
                    value: v,
                    label:
                      v === AnomalyDetectionSensitivity.Low
                        ? "Low (4σ — egregious deviations only)"
                        : v === AnomalyDetectionSensitivity.High
                          ? "High (2σ — noisier, very stable services)"
                          : "Medium (3σ — recommended)",
                  };
                })()}
                options={[
                  {
                    value: AnomalyDetectionSensitivity.Low,
                    label: "Low (4σ — egregious deviations only)",
                  },
                  {
                    value: AnomalyDetectionSensitivity.Medium,
                    label: "Medium (3σ — recommended)",
                  },
                  {
                    value: AnomalyDetectionSensitivity.High,
                    label: "High (2σ — noisier, very stable services)",
                  },
                ]}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  props.onChange?.({
                    ...criteriaFilter,
                    metricMonitorOptions: {
                      ...criteriaFilter?.metricMonitorOptions,
                      anomalyDetection: {
                        ...criteriaFilter?.metricMonitorOptions
                          ?.anomalyDetection,
                        sensitivity:
                          value?.toString() as AnomalyDetectionSensitivity,
                      },
                    },
                  });
                }}
              />
              <div className="mt-3">
                <FieldLabelElement
                  title="Baseline Window"
                  description="How many days of history to compare against. Longer windows capture monthly seasonality (billing/payroll cycles); shorter windows respond faster to genuine drift in the underlying metric."
                />
                <Dropdown
                  value={(() => {
                    const days: number =
                      criteriaFilter?.metricMonitorOptions?.anomalyDetection
                        ?.windowDays || 14;
                    return {
                      value: days,
                      label:
                        days === 14
                          ? "14 days (default)"
                          : days === 28
                            ? "28 days (longer warm-up, smoother)"
                            : days === 60
                              ? "60 days (monthly seasonality)"
                              : days === 90
                                ? "90 days (quarterly cycles)"
                                : `${days} days`,
                    };
                  })()}
                  options={[
                    { value: 14, label: "14 days (default)" },
                    { value: 28, label: "28 days (longer warm-up, smoother)" },
                    { value: 60, label: "60 days (monthly seasonality)" },
                    { value: 90, label: "90 days (quarterly cycles)" },
                  ]}
                  onChange={(
                    value: DropdownValue | Array<DropdownValue> | null,
                  ) => {
                    const parsed: number = Number(value?.toString() || "14");
                    props.onChange?.({
                      ...criteriaFilter,
                      metricMonitorOptions: {
                        ...criteriaFilter?.metricMonitorOptions,
                        anomalyDetection: {
                          ...criteriaFilter?.metricMonitorOptions
                            ?.anomalyDetection,
                          windowDays: Number.isFinite(parsed) ? parsed : 14,
                        },
                      },
                    });
                  }}
                />
              </div>
              <p className="mt-2 text-xs text-gray-500">
                Anomaly detection requires at least the chosen window of
                telemetry history before firing — until then the rule sits in
                &quot;Learning&quot; state and produces no alerts.
              </p>
            </div>
          )}

        {criteriaFilter?.checkOn &&
          criteriaFilter?.checkOn === CheckOn.MetricValue && (
            <div className="mt-4">
              <CollapsibleSection
                title="Advanced"
                variant="default"
                defaultCollapsed={
                  !criteriaFilter?.metricMonitorOptions?.onNoDataPolicy ||
                  criteriaFilter?.metricMonitorOptions?.onNoDataPolicy ===
                    NoDataPolicy.Ignore
                }
                headerClassName="text-xs text-gray-500"
              >
                <div className="pl-6">
                  <FieldLabelElement
                    title="If No Data"
                    description="What should happen when the query returns no data points in the evaluation window?"
                  />
                  <Dropdown
                    value={(() => {
                      const v: NoDataPolicy =
                        criteriaFilter?.metricMonitorOptions?.onNoDataPolicy ||
                        NoDataPolicy.Ignore;
                      return { value: v, label: v };
                    })()}
                    options={[
                      {
                        value: NoDataPolicy.Ignore,
                        label: NoDataPolicy.Ignore,
                      },
                      {
                        value: NoDataPolicy.TreatAsZero,
                        label: NoDataPolicy.TreatAsZero,
                      },
                      {
                        value: NoDataPolicy.Trigger,
                        label: NoDataPolicy.Trigger,
                      },
                    ]}
                    onChange={(
                      value: DropdownValue | Array<DropdownValue> | null,
                    ) => {
                      props.onChange?.({
                        ...criteriaFilter,
                        metricMonitorOptions: {
                          ...criteriaFilter?.metricMonitorOptions,
                          onNoDataPolicy: value?.toString() as NoDataPolicy,
                        },
                      });
                    }}
                  />
                </div>
              </CollapsibleSection>
            </div>
          )}

        <div className="mt-3 -mr-2 w-full flex justify-end">
          <Button
            title={isMetricOnly ? "Delete Rule" : "Delete Filter"}
            buttonStyle={ButtonStyleType.DANGER_OUTLINE}
            icon={IconProp.Trash}
            buttonSize={ButtonSize.Small}
            onClick={() => {
              props.onDelete?.();
            }}
          />
        </div>
      </div>
      {criteriaFilter?.checkOn === CheckOn.JavaScriptExpression ? (
        <div className="mt-1 text-sm text-gray-500 underline">
          <Link
            to={Route.fromString("/docs/monitor/javascript-expression")}
            openInNewTab={true}
          >
            <p> Read documentation for using JavaScript expressions here. </p>
          </Link>{" "}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default CriteriaFilterElement;
