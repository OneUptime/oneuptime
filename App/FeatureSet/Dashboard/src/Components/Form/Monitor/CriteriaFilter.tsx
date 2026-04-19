import CriteriaFilterUiUtil from "../../../Utils/Form/Monitor/CriteriaFilter";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsViewConfig from "Common/Types/Metrics/MetricsViewConfig";
import MetricUnitUtil, { UnitOption } from "Common/Utils/MetricUnitUtil";
import {
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil,
  EvaluateOverTimeOptions,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "Common/Types/Monitor/CriteriaFilter";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
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

export interface ComponentProps {
  value: CriteriaFilter | undefined;
  onChange?: undefined | ((value: CriteriaFilter) => void);
  onDelete?: undefined | (() => void);
  monitorType: MonitorType;
  monitorStep: MonitorStep;
}

const isMetricOnlyMonitorType: (monitorType: MonitorType) => boolean = (
  monitorType: MonitorType,
): boolean => {
  return (
    monitorType === MonitorType.Kubernetes ||
    monitorType === MonitorType.Docker ||
    monitorType === MonitorType.Metrics
  );
};

const CriteriaFilterElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const criteriaFilter: CriteriaFilter | undefined = props.value;

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

  const isMetricOnly: boolean = isMetricOnlyMonitorType(props.monitorType);

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

  // Collect metric variables from metricMonitor, kubernetesMonitor, and dockerMonitor configs
  const metricViewConfig: MetricsViewConfig | undefined =
    props.monitorStep.data?.metricMonitor?.metricViewConfig ||
    props.monitorStep.data?.kubernetesMonitor?.metricViewConfig ||
    props.monitorStep.data?.dockerMonitor?.metricViewConfig;

  let metricVariables: Array<string> =
    metricViewConfig?.queryConfigs?.map(
      (queryConfig: MetricQueryConfigData) => {
        return queryConfig.metricAliasData?.metricVariable || "";
      },
    ) || [];

  // push formula variables as well.
  metricViewConfig?.formulaConfigs?.forEach(
    (formulaConfig: MetricFormulaConfigData) => {
      metricVariables.push(formulaConfig.metricAliasData.metricVariable || "");
    },
  );

  // remove duplicates and empty strings

  metricVariables = metricVariables.filter((item: string, index: number) => {
    return metricVariables.indexOf(item) === index && item !== "";
  });

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
                props.onChange?.({
                  checkOn: value?.toString() as CheckOn,
                  filterType: undefined,
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
              <FieldLabelElement title="Disk Path" />

              <Input
                placeholder={"C:\\ or /mnt/data or /dev/sda1"}
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
