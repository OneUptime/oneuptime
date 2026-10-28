import TelemetryRuleActions from "./TelemetryRuleActions";
import TelemetryRulePreview from "./TelemetryRulePreview";
import { IncidentRoleOption } from "../MonitorCriteriaIncidentForm";
import { JSONObject } from "Common/Types/JSON";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import {
  AnomalyDetectionSensitivity,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "Common/Types/Monitor/CriteriaFilter";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import { MonitorStepExceptionMonitorUtil } from "Common/Types/Monitor/MonitorStepExceptionMonitor";
import { MonitorStepLogMonitorUtil } from "Common/Types/Monitor/MonitorStepLogMonitor";
import { MonitorStepMetricMonitorUtil } from "Common/Types/Monitor/MonitorStepMetricMonitor";
import { MonitorStepTraceMonitorUtil } from "Common/Types/Monitor/MonitorStepTraceMonitor";
import MonitorType from "Common/Types/Monitor/MonitorType";
import TelemetryAlertRuleUtil, {
  TelemetryAlertRule,
  TelemetryAlertRuleAction,
  TelemetryAlertRuleReadResult,
} from "Common/Types/Monitor/TelemetryAlertRule";
import ObjectID from "Common/Types/ObjectID";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import IconProp from "Common/Types/Icon/IconProp";
import MetricUnitUtil, { UnitOption } from "Common/Utils/MetricUnitUtil";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useState,
} from "react";
import {
  ANOMALY_SENSITIVITY_CHOICES,
  getComparisonChoices,
  getCountTitle,
  getRuleSentence,
  getShapeProblemText,
  getWindowOptions,
  METRIC_AGGREGATION_CHOICES,
  METRIC_RULE_WINDOW_OPTIONS,
  TelemetryRuleChoice,
  TelemetryRuleCopy,
  TelemetryRuleWindowOption,
} from "../../../../Utils/Form/Monitor/TelemetryRule/TelemetryRuleText";
import {
  getRuleNameFromFilter,
  TelemetryRuleSeeds,
} from "../../../../Utils/Form/Monitor/TelemetryRule/TelemetryRuleRecipes";
import {
  applyActionChange,
  applyConditionChange,
} from "../../../../Utils/Form/Monitor/TelemetryRule/TelemetryRuleEdits";

/*
 * A Logs, Traces, Exceptions or Metrics monitor's criteria, edited as the
 * one rule most of them are: "When to alert" (a condition, a value and a
 * window, said back in one sentence, over a preview of what the rule would
 * have caught) and "What happens" (an alert, an incident or both).
 *
 * The rule is read from the stored criteria and written back onto them
 * (TelemetryAlertRuleUtil): nothing new is stored, and a monitor saved
 * unchanged saves what it held. Criteria that are not one rule - several
 * criteria, a disabled one, a criteria with two filters - open in the full
 * criteria editor (`customCriteria`), as does anyone who asks for it.
 */

export interface ComponentProps {
  monitorType: MonitorType;
  monitorStep: MonitorStep;
  defaultMonitorStatusId: ObjectID | undefined;
  seeds: TelemetryRuleSeeds;
  monitorStatusDropdownOptions: Array<DropdownOption>;
  incidentSeverityDropdownOptions: Array<DropdownOption>;
  alertSeverityDropdownOptions: Array<DropdownOption>;
  onCallPolicyDropdownOptions: Array<DropdownOption>;
  labelDropdownOptions: Array<DropdownOption>;
  userDropdownOptions: Array<DropdownOption>;
  incidentRoleOptions?: Array<IncidentRoleOption> | undefined;
  seriesAttributeKeys: Array<string>;
  onChange: (monitorStep: MonitorStep) => void;
  // The full criteria editor, for criteria that are not one rule.
  customCriteria: ReactElement;
  /*
   * Whether the form was sent with an error in these steps (after Next or
   * Create): a field left empty says so then, or once it was changed.
   */
  showErrors?: boolean | undefined;
}

// What the preview endpoint reads for this step: the signal's settings.
export const getPreviewSettings: (data: {
  monitorType: MonitorType;
  monitorStep: MonitorStep;
}) => JSONObject | null = (data: {
  monitorType: MonitorType;
  monitorStep: MonitorStep;
}): JSONObject | null => {
  switch (data.monitorType) {
    case MonitorType.Logs:
      return MonitorStepLogMonitorUtil.toJSON({
        ...(data.monitorStep.data?.logMonitor ||
          MonitorStepLogMonitorUtil.getDefault()),
        // Grouping and resolving do not change which logs are counted.
        groupByAttributes: [],
        resolvedByAttributes: {},
      });
    case MonitorType.Traces:
      return MonitorStepTraceMonitorUtil.toJSON(
        data.monitorStep.data?.traceMonitor ||
          MonitorStepTraceMonitorUtil.getDefault(),
      );
    case MonitorType.Exceptions:
      return MonitorStepExceptionMonitorUtil.toJSON(
        data.monitorStep.data?.exceptionMonitor ||
          MonitorStepExceptionMonitorUtil.getDefault(),
      );
    default:
      return null;
  }
};

/*
 * The metric a rule's alias reads, by the name a person knows it by: its
 * title, else its metric's name, else the formula - else the alias.
 */
export const getMetricAliasLabel: (data: {
  monitorStep: MonitorStep;
  alias: string;
}) => string = (data: { monitorStep: MonitorStep; alias: string }): string => {
  return getMetricAliasName(data) || data.alias;
};

/*
 * The name a rule's alias goes by, as getMetricAliasLabel; undefined for a
 * query with no metric picked yet.
 */
export const getMetricAliasName: (data: {
  monitorStep: MonitorStep;
  alias: string;
}) => string | undefined = (data: {
  monitorStep: MonitorStep;
  alias: string;
}): string | undefined => {
  const viewConfig: {
    queryConfigs: Array<MetricQueryConfigData>;
    formulaConfigs: Array<MetricFormulaConfigData>;
  } = MonitorStepMetricMonitorUtil.getMetricViewConfig(
    data.monitorStep.data?.metricMonitor,
  );

  const query: MetricQueryConfigData | undefined = viewConfig.queryConfigs.find(
    (candidate: MetricQueryConfigData) => {
      return candidate.metricAliasData?.metricVariable === data.alias;
    },
  );

  if (query) {
    const metricName: unknown = query.metricQueryData?.filterData?.metricName;

    return (
      query.metricAliasData?.title?.trim() ||
      (typeof metricName === "string" ? metricName : "") ||
      undefined
    );
  }

  const formula: MetricFormulaConfigData | undefined =
    viewConfig.formulaConfigs.find((candidate: MetricFormulaConfigData) => {
      return candidate.metricAliasData?.metricVariable === data.alias;
    });

  return (
    formula?.metricAliasData?.title?.trim() ||
    formula?.metricFormulaData?.metricFormula ||
    undefined
  );
};

// The unit the metric a rule's alias reads is shown in.
const getMetricAliasUnit: (data: {
  monitorStep: MonitorStep;
  alias: string | undefined;
}) => string | undefined = (data: {
  monitorStep: MonitorStep;
  alias: string | undefined;
}): string | undefined => {
  const viewConfig: {
    queryConfigs: Array<MetricQueryConfigData>;
    formulaConfigs: Array<MetricFormulaConfigData>;
  } = MonitorStepMetricMonitorUtil.getMetricViewConfig(
    data.monitorStep.data?.metricMonitor,
  );

  const aliasData:
    | MetricQueryConfigData["metricAliasData"]
    | MetricFormulaConfigData["metricAliasData"]
    | undefined =
    viewConfig.queryConfigs.find((query: MetricQueryConfigData) => {
      return query.metricAliasData?.metricVariable === data.alias;
    })?.metricAliasData ||
    viewConfig.formulaConfigs.find((formula: MetricFormulaConfigData) => {
      return formula.metricAliasData?.metricVariable === data.alias;
    })?.metricAliasData;

  return aliasData?.legendUnit || undefined;
};

const ROLLING_TIME_OPTIONS: Array<DropdownOption> =
  METRIC_RULE_WINDOW_OPTIONS.map(
    (option: { value: RollingTime; label: string }): DropdownOption => {
      return { value: option.value, label: option.label };
    },
  );

/*
 * What a window with no values does. The same three policies the full
 * criteria editor offers under their stored names, said plainly.
 */
const NO_DATA_OPTIONS: Array<TelemetryRuleChoice<NoDataPolicy>> = [
  { value: NoDataPolicy.Ignore, label: translationKey("Nothing") },
  {
    value: NoDataPolicy.TreatAsZero,
    label: translationKey("Count it as zero"),
  },
  {
    value: NoDataPolicy.Trigger,
    label: translationKey("Alert, as if it matched"),
  },
];

const toDropdownOptions: <T extends string>(
  choices: Array<TelemetryRuleChoice<T>>,
) => Array<DropdownOption> = <T extends string>(
  choices: Array<TelemetryRuleChoice<T>>,
): Array<DropdownOption> => {
  return choices.map((choice: TelemetryRuleChoice<T>): DropdownOption => {
    return {
      value: choice.value,
      label: choice.label,
      ...(choice.description ? { description: choice.description } : {}),
    };
  });
};

const TelemetryRuleEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { monitorType, monitorStep } = props;

  const [isCustom, setIsCustom] = useState<boolean>(false);

  const read: TelemetryAlertRuleReadResult = TelemetryAlertRuleUtil.read({
    monitorType,
    monitorStep,
    defaultMonitorStatusId: props.defaultMonitorStatusId,
  });

  const rule: TelemetryAlertRule | null = read.rule;
  const isMetric: boolean = monitorType === MonitorType.Metrics;

  const conditionLabelId: string = useId();
  const valueInputId: string = useId();
  const windowLabelId: string = useId();
  const metricLabelId: string = useId();
  const aggregationLabelId: string = useId();
  const unitLabelId: string = useId();
  const sensitivityLabelId: string = useId();
  const noDataLabelId: string = useId();

  /*
   * The value as typed: a box holding "1." or "-" while someone types is
   * not a number yet, and must not be replaced by one.
   */
  const [valueText, setValueText] = useState<string>(
    rule?.threshold === undefined ? "" : String(rule.threshold),
  );

  useEffect(() => {
    const typed: number | undefined =
      TelemetryAlertRuleUtil.toNumber(valueText);

    if (rule && typed !== rule.threshold) {
      setValueText(rule.threshold === undefined ? "" : String(rule.threshold));
    }
  }, [rule?.threshold]);

  const [isMetricMoreCollapsed, setIsMetricMoreCollapsed] =
    useState<boolean>(true);

  // The value box says it is empty once changed, or once the form is sent.
  const [isValueTouched, setIsValueTouched] = useState<boolean>(false);

  const writeRule: (next: TelemetryAlertRule) => void = (
    next: TelemetryAlertRule,
  ): void => {
    props.onChange(
      TelemetryAlertRuleUtil.write({
        monitorType,
        monitorStep,
        rule: next,
      }),
    );
  };

  const changeCondition: (changes: Partial<TelemetryAlertRule>) => void = (
    changes: Partial<TelemetryAlertRule>,
  ): void => {
    if (!rule) {
      return;
    }

    writeRule(
      applyConditionChange({
        monitorType,
        previous: rule,
        next: { ...rule, ...changes },
        monitorName: props.seeds.monitorName,
        translator,
      }),
    );
  };

  /*
   * The window the full criteria editor counts over: the same one the rule
   * holds, set apart above the criteria.
   */
  const renderCustomWindowField: () => ReactElement = (): ReactElement => {
    const windowChange: (changes: {
      windowInSeconds?: number;
      rollingTime?: RollingTime;
    }) => void = (changes: {
      windowInSeconds?: number;
      rollingTime?: RollingTime;
    }): void => {
      const step: MonitorStep = MonitorStep.clone(monitorStep);
      TelemetryAlertRuleUtil.writeWindow({
        monitorType,
        monitorStep: step,
        rule: {
          windowInSeconds: changes.windowInSeconds,
          rollingTime: changes.rollingTime,
        },
      });
      props.onChange(step);
    };

    return renderWindowField({
      windowInSeconds: TelemetryAlertRuleUtil.getWindowInSeconds({
        monitorType,
        monitorStep,
      }),
      rollingTime: TelemetryAlertRuleUtil.getRollingTime(monitorStep),
      onChange: windowChange,
      description: isMetric
        ? TelemetryRuleCopy.metricWindowFieldDescription
        : TelemetryRuleCopy.windowFieldDescription,
    });
  };

  const renderWindowField: (data: {
    windowInSeconds: number | undefined;
    rollingTime: RollingTime | undefined;
    onChange: (changes: {
      windowInSeconds?: number;
      rollingTime?: RollingTime;
    }) => void;
    description?: string | undefined;
  }) => ReactElement = (data: {
    windowInSeconds: number | undefined;
    rollingTime: RollingTime | undefined;
    onChange: (changes: {
      windowInSeconds?: number;
      rollingTime?: RollingTime;
    }) => void;
    description?: string | undefined;
  }): ReactElement => {
    if (isMetric) {
      return (
        <div data-testid="telemetry-rule-window">
          <FieldLabelElement
            id={windowLabelId}
            title={TelemetryRuleCopy.windowTitle}
            description={data.description}
            hideOptionalLabel={true}
          />
          <Dropdown
            ariaLabelledby={windowLabelId}
            isClearable={false}
            value={ROLLING_TIME_OPTIONS.find((option: DropdownOption) => {
              return (
                option.value === (data.rollingTime || RollingTime.Past1Minute)
              );
            })}
            options={ROLLING_TIME_OPTIONS}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              if (value) {
                data.onChange({ rollingTime: value as RollingTime });
              }
            }}
          />
        </div>
      );
    }

    const windowOptions: Array<TelemetryRuleWindowOption> = getWindowOptions(
      data.windowInSeconds,
    );

    return (
      <div data-testid="telemetry-rule-window">
        <FieldLabelElement
          id={windowLabelId}
          title={TelemetryRuleCopy.windowTitle}
          description={data.description}
          hideOptionalLabel={true}
        />
        <Dropdown
          ariaLabelledby={windowLabelId}
          isClearable={false}
          value={
            windowOptions
              .map((option: TelemetryRuleWindowOption): DropdownOption => {
                return { value: option.value, label: option.label };
              })
              .find((option: DropdownOption) => {
                return option.value === data.windowInSeconds;
              }) || undefined
          }
          options={windowOptions.map(
            (option: TelemetryRuleWindowOption): DropdownOption => {
              return { value: option.value, label: option.label };
            },
          )}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            if (value) {
              data.onChange({ windowInSeconds: Number(value) });
            }
          }}
        />
      </div>
    );
  };

  // Criteria that are not one rule, or someone who asked for all of them.
  if (!rule || isCustom) {
    return (
      <Card
        title={TelemetryRuleCopy.customCriteriaTitle}
        description={TelemetryRuleCopy.customCriteriaDescription}
      >
        <div data-testid="telemetry-rule-custom-criteria">
          <div className="mt-2 max-w-md">{renderCustomWindowField()}</div>

          {!rule ? (
            <div className="mt-4">
              <Alert
                type={AlertType.INFO}
                title={getShapeProblemText(read.problem)}
                dataTestId="telemetry-rule-shape-problem"
              />
            </div>
          ) : (
            <></>
          )}

          {props.customCriteria}

          {rule && isCustom ? (
            /* md:-ml-3 takes back the Button's own md:ml-3. */
            <div className="mt-2 md:-ml-3">
              <Button
                title={TelemetryRuleCopy.backToSimpleRule}
                buttonSize={ButtonSize.Small}
                buttonStyle={ButtonStyleType.NORMAL}
                icon={IconProp.ArrowCircleLeft}
                dataTestId="telemetry-rule-back-to-simple"
                onClick={() => {
                  setIsCustom(false);
                }}
              />
            </div>
          ) : (
            <></>
          )}
        </div>
      </Card>
    );
  }

  const isAnomaly: boolean = TelemetryAlertRuleUtil.isAnomaly(rule.filterType);

  const comparisonOptions: Array<DropdownOption> = toDropdownOptions(
    getComparisonChoices({ monitorType, current: rule.filterType }),
  );

  const metricAliases: Array<string> = isMetric
    ? TelemetryAlertRuleUtil.getMetricAliases(monitorStep)
    : [];
  const effectiveAlias: string | undefined =
    rule.metricAlias || metricAliases[0];
  const metricName: string | undefined = effectiveAlias
    ? getMetricAliasName({ monitorStep, alias: effectiveAlias })
    : undefined;
  const metricUnit: string | undefined = isMetric
    ? getMetricAliasUnit({ monitorStep, alias: effectiveAlias })
    : undefined;
  const unitOptions: Array<UnitOption> = isMetric
    ? MetricUnitUtil.getCompatibleUnits(metricUnit)
    : [];
  const unitValue: string | undefined =
    rule.thresholdUnit || MetricUnitUtil.getCanonicalUnitValue(metricUnit);

  const valueError: string | undefined =
    !isAnomaly &&
    rule.threshold === undefined &&
    (isValueTouched || props.showErrors)
      ? translator.translateText(TelemetryRuleCopy.valueRequired)
      : undefined;

  const previewSettings: JSONObject | null = getPreviewSettings({
    monitorType,
    monitorStep,
  });

  const unitLabel: string | undefined = unitOptions.find(
    (option: UnitOption) => {
      return option.value === unitValue;
    },
  )?.label;

  const sentence: string = getRuleSentence({
    monitorType,
    rule,
    translator,
    metricName,
    // An annotation ("{message}") names what is counted: it is no unit.
    unit:
      unitLabel && !(unitLabel.startsWith("{") && unitLabel.endsWith("}"))
        ? unitLabel
        : undefined,
  });

  return (
    <div className="space-y-6" data-testid="telemetry-rule-editor">
      <Card
        title={TelemetryRuleCopy.whenToAlertTitle}
        description={TelemetryRuleCopy.whenToAlertDescription}
      >
        <div className="mt-2" data-testid="telemetry-rule-condition">
          {isMetric ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {/*
               * Which metric, only when the step reads more than one: a
               * query alone is the metric the rule reads.
               */}
              {metricAliases.length > 1 ? (
                <div data-testid="telemetry-rule-metric">
                  <FieldLabelElement
                    id={metricLabelId}
                    title={TelemetryRuleCopy.metricTitle}
                    hideOptionalLabel={true}
                  />
                  <Dropdown
                    ariaLabelledby={metricLabelId}
                    isClearable={false}
                    placeholder="Pick a metric above first"
                    value={
                      effectiveAlias
                        ? {
                            value: effectiveAlias,
                            label: getMetricAliasLabel({
                              monitorStep,
                              alias: effectiveAlias,
                            }),
                          }
                        : undefined
                    }
                    options={metricAliases.map((alias: string) => {
                      return {
                        value: alias,
                        label: getMetricAliasLabel({ monitorStep, alias }),
                      };
                    })}
                    onChange={(
                      value: DropdownValue | Array<DropdownValue> | null,
                    ) => {
                      if (value) {
                        changeCondition({ metricAlias: value.toString() });
                      }
                    }}
                  />
                </div>
              ) : (
                <></>
              )}
              <div data-testid="telemetry-rule-aggregation">
                <FieldLabelElement
                  id={aggregationLabelId}
                  title={TelemetryRuleCopy.aggregationTitle}
                  hideOptionalLabel={true}
                />
                <Dropdown
                  ariaLabelledby={aggregationLabelId}
                  isClearable={false}
                  value={toDropdownOptions(METRIC_AGGREGATION_CHOICES).find(
                    (option: DropdownOption) => {
                      return (
                        option.value ===
                        (rule.metricAggregationType ||
                          EvaluateOverTimeType.AllValues)
                      );
                    },
                  )}
                  options={toDropdownOptions(METRIC_AGGREGATION_CHOICES)}
                  onChange={(
                    value: DropdownValue | Array<DropdownValue> | null,
                  ) => {
                    if (value) {
                      changeCondition({
                        metricAggregationType: value as EvaluateOverTimeType,
                      });
                    }
                  }}
                />
              </div>
              {renderWindowField({
                windowInSeconds: undefined,
                rollingTime: rule.rollingTime,
                onChange: (changes: { rollingTime?: RollingTime }) => {
                  changeCondition({ rollingTime: changes.rollingTime });
                },
              })}
            </div>
          ) : (
            <></>
          )}

          <div
            className={`grid grid-cols-1 gap-4 sm:grid-cols-3 ${
              isMetric ? "mt-4" : ""
            }`}
          >
            <div data-testid="telemetry-rule-comparison">
              <FieldLabelElement
                id={conditionLabelId}
                title={TelemetryRuleCopy.conditionTitle}
                hideOptionalLabel={true}
              />
              <Dropdown
                ariaLabelledby={conditionLabelId}
                isClearable={false}
                value={comparisonOptions.find((option: DropdownOption) => {
                  return option.value === rule.filterType;
                })}
                options={comparisonOptions}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  if (value) {
                    const filterType: FilterType = value as FilterType;

                    changeCondition({
                      filterType,
                      ...(TelemetryAlertRuleUtil.isAnomaly(filterType)
                        ? {
                            anomalyDetection: rule.anomalyDetection || {
                              sensitivity: AnomalyDetectionSensitivity.Medium,
                            },
                          }
                        : {}),
                    });
                  }
                }}
              />
            </div>

            {isAnomaly ? (
              <div data-testid="telemetry-rule-sensitivity">
                <FieldLabelElement
                  id={sensitivityLabelId}
                  title={TelemetryRuleCopy.sensitivityTitle}
                  hideOptionalLabel={true}
                />
                <Dropdown
                  ariaLabelledby={sensitivityLabelId}
                  isClearable={false}
                  value={toDropdownOptions(ANOMALY_SENSITIVITY_CHOICES).find(
                    (option: DropdownOption) => {
                      return (
                        option.value ===
                        (rule.anomalyDetection?.sensitivity ||
                          AnomalyDetectionSensitivity.Medium)
                      );
                    },
                  )}
                  options={toDropdownOptions(ANOMALY_SENSITIVITY_CHOICES)}
                  onChange={(
                    value: DropdownValue | Array<DropdownValue> | null,
                  ) => {
                    if (value) {
                      changeCondition({
                        anomalyDetection: {
                          ...(rule.anomalyDetection || {}),
                          sensitivity: value as AnomalyDetectionSensitivity,
                        },
                      });
                    }
                  }}
                />
              </div>
            ) : (
              <div data-testid="telemetry-rule-value">
                <FieldLabelElement
                  title={getCountTitle(monitorType)}
                  htmlFor={valueInputId}
                  hideOptionalLabel={true}
                />
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <Input
                      id={valueInputId}
                      dataTestId="telemetry-rule-threshold"
                      type={InputType.NUMBER}
                      value={valueText}
                      error={valueError}
                      onBlur={() => {
                        setIsValueTouched(true);
                      }}
                      onChange={(value: string) => {
                        setValueText(value);
                        setIsValueTouched(true);

                        const parsed: number | undefined =
                          TelemetryAlertRuleUtil.toNumber(value);

                        if (parsed !== rule.threshold) {
                          changeCondition({ threshold: parsed });
                        }
                      }}
                    />
                  </div>
                  {isMetric && unitOptions.length > 1 ? (
                    <div className="w-28 flex-none">
                      <Dropdown
                        ariaLabel={translator.translateText("Unit") || "Unit"}
                        id={unitLabelId}
                        isClearable={false}
                        value={unitOptions
                          .map((option: UnitOption): DropdownOption => {
                            return { value: option.value, label: option.label };
                          })
                          .find((option: DropdownOption) => {
                            return option.value === unitValue;
                          })}
                        options={unitOptions.map(
                          (option: UnitOption): DropdownOption => {
                            return { value: option.value, label: option.label };
                          },
                        )}
                        onChange={(
                          value: DropdownValue | Array<DropdownValue> | null,
                        ) => {
                          if (value) {
                            changeCondition({
                              thresholdUnit: value.toString(),
                            });
                          }
                        }}
                      />
                    </div>
                  ) : (
                    <></>
                  )}
                </div>
              </div>
            )}

            {isMetric ? (
              <></>
            ) : (
              renderWindowField({
                windowInSeconds: rule.windowInSeconds,
                rollingTime: undefined,
                onChange: (changes: { windowInSeconds?: number }) => {
                  changeCondition({ windowInSeconds: changes.windowInSeconds });
                },
              })
            )}
          </div>

          {isMetric ? (
            <FoldedSection
              title={MORE_FIELDS_SECTION_TITLE}
              className="mt-4"
              isCollapsed={isMetricMoreCollapsed}
              onToggle={(isCollapsed: boolean) => {
                setIsMetricMoreCollapsed(isCollapsed);
              }}
              items={[
                {
                  key: "onNoDataPolicy",
                  title: TelemetryRuleCopy.noDataTitle,
                  isSet: Boolean(
                    rule.onNoDataPolicy &&
                      rule.onNoDataPolicy !== NoDataPolicy.Ignore,
                  ),
                  value: rule.onNoDataPolicy,
                  translateValue: true,
                },
              ]}
              dataTestId="telemetry-rule-condition-more-fields"
            >
              <div className="max-w-md">
                <FieldLabelElement
                  id={noDataLabelId}
                  title={TelemetryRuleCopy.noDataTitle}
                  description={TelemetryRuleCopy.noDataDescription}
                  hideOptionalLabel={true}
                />
                <Dropdown
                  ariaLabelledby={noDataLabelId}
                  isClearable={false}
                  value={toDropdownOptions(NO_DATA_OPTIONS).find(
                    (option: DropdownOption) => {
                      return (
                        option.value ===
                        (rule.onNoDataPolicy || NoDataPolicy.Ignore)
                      );
                    },
                  )}
                  options={toDropdownOptions(NO_DATA_OPTIONS)}
                  onChange={(
                    value: DropdownValue | Array<DropdownValue> | null,
                  ) => {
                    if (value) {
                      changeCondition({
                        onNoDataPolicy: value as NoDataPolicy,
                      });
                    }
                  }}
                />
              </div>
            </FoldedSection>
          ) : (
            <></>
          )}

          <p
            className="mt-5 rounded-md bg-gray-50 px-4 py-3 text-sm font-medium text-gray-900"
            data-testid="telemetry-rule-sentence"
          >
            {sentence}
          </p>

          {previewSettings ? (
            <TelemetryRulePreview
              monitorType={monitorType}
              settings={previewSettings}
              filterType={rule.filterType}
              threshold={rule.threshold}
              isGrouped={
                monitorType === MonitorType.Logs &&
                MonitorStepLogMonitorUtil.getGroupByAttributes(
                  monitorStep.data?.logMonitor,
                ).length > 0
              }
              onUseSuggestedThreshold={(value: number) => {
                setValueText(String(value));
                changeCondition({ threshold: value });
              }}
            />
          ) : (
            <></>
          )}
        </div>
      </Card>

      <Card
        title={TelemetryRuleCopy.whatHappensTitle}
        description={TelemetryRuleCopy.whatHappensDescription}
      >
        <div className="mt-2">
          <TelemetryRuleActions
            monitorType={monitorType}
            rule={rule}
            monitorStatusDropdownOptions={props.monitorStatusDropdownOptions}
            incidentSeverityDropdownOptions={
              props.incidentSeverityDropdownOptions
            }
            alertSeverityDropdownOptions={props.alertSeverityDropdownOptions}
            onCallPolicyDropdownOptions={props.onCallPolicyDropdownOptions}
            labelDropdownOptions={props.labelDropdownOptions}
            userDropdownOptions={props.userDropdownOptions}
            incidentRoleOptions={props.incidentRoleOptions}
            seriesAttributeKeys={props.seriesAttributeKeys}
            nameFromRule={getRuleNameFromFilter({
              monitorType,
              filterType: rule.filterType,
              threshold: rule.threshold,
              metricAlias: rule.metricAlias,
            })}
            onActionChange={(action: TelemetryAlertRuleAction) => {
              writeRule(
                applyActionChange({
                  monitorType,
                  rule,
                  action,
                  seeds: props.seeds,
                  translator,
                }),
              );
            }}
            onChange={(next: TelemetryAlertRule) => {
              writeRule(next);
            }}
            onEditAsCustomCriteria={() => {
              setIsCustom(true);
            }}
          />
        </div>
      </Card>
    </div>
  );
};

export default TelemetryRuleEditor;
