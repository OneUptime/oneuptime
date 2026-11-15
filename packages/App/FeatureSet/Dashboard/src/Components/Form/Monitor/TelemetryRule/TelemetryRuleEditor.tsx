import TelemetryRuleActions from "./TelemetryRuleActions";
import TelemetryRulePreview from "./TelemetryRulePreview";
import { IncidentRoleOption } from "../MonitorCriteriaIncidentForm";
import { JSONObject } from "Common/Types/JSON";
import {
  ANOMALY_WINDOW_DAYS_OPTIONS,
  AnomalyDetectionSensitivity,
  CheckOn,
  DEFAULT_ANOMALY_WINDOW_DAYS,
  DEFAULT_FORECAST_HORIZON_IN_HOURS,
  EvaluateOverTimeType,
  FilterType,
  MetricAnomalyDetectionOptions,
  NoDataPolicy,
} from "Common/Types/Monitor/CriteriaFilter";
import {
  ExceptionAnomalySettings,
  getExceptionAnomalySettings,
  isExceptionMeasure,
} from "Common/Types/Monitor/ExceptionMonitor/ExceptionMonitorEvaluation";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import { MonitorStepExceptionMonitorUtil } from "Common/Types/Monitor/MonitorStepExceptionMonitor";
import { MonitorStepLogMonitorUtil } from "Common/Types/Monitor/MonitorStepLogMonitor";
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
import { UnitOption } from "Common/Utils/MetricUnitUtil";
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
  getForecastHorizonChoices,
  getRollingTimeInSeconds,
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
  getMetricAliasLabel,
  getRuleMetricAlias,
  getRuleSentenceForStep,
  getRuleUnits,
} from "../../../../Utils/Form/Monitor/TelemetryRule/TelemetryRuleMetric";
import {
  applyActionChange,
  applyConditionChange,
  getMeasureChange,
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
 * What an Exceptions rule can alert on (ExceptionMonitorEvaluation), in the
 * order the choice offers them.
 */
const EXCEPTION_MEASURE_CHOICES: Array<{ value: CheckOn; label: string }> = [
  {
    value: CheckOn.ExceptionCount,
    label: TelemetryRuleCopy.exceptionMeasureCount,
  },
  {
    value: CheckOn.NewExceptionCount,
    label: TelemetryRuleCopy.exceptionMeasureNew,
  },
  {
    value: CheckOn.RegressedExceptionCount,
    label: TelemetryRuleCopy.exceptionMeasureRegressed,
  },
  {
    value: CheckOn.ExceptionCountIncreasePercent,
    label: TelemetryRuleCopy.exceptionMeasureIncrease,
  },
];

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

/*
 * What a rule switched to a forecast starts with: a week ahead, and - when
 * it read a window under an hour, which holds no trend worth following - the
 * last 7 days to draw the trend through. A rule that already forecast keeps
 * the window it was given.
 */
export const getForecastStart: (data: {
  rule: Pick<TelemetryAlertRule, "filterType" | "rollingTime" | "forecast">;
  filterType: FilterType;
}) => Partial<TelemetryAlertRule> = (data: {
  rule: Pick<TelemetryAlertRule, "filterType" | "rollingTime" | "forecast">;
  filterType: FilterType;
}): Partial<TelemetryAlertRule> => {
  const start: Partial<TelemetryAlertRule> = {
    forecast: data.rule.forecast || {
      horizonInHours: DEFAULT_FORECAST_HORIZON_IN_HOURS,
    },
  };

  if (
    !TelemetryAlertRuleUtil.isForecast(data.rule.filterType) &&
    getRollingTimeInSeconds(data.rule.rollingTime || RollingTime.Past1Minute) <
      3600
  ) {
    start.rollingTime = RollingTime.Past7Days;
  }

  return start;
};

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

/*
 * A number a rule can leave to its default: empty means the placeholder's.
 * The text as typed, as the value box keeps it: "2." is not a number yet.
 */
const OptionalNumberField: FunctionComponent<{
  title: string;
  description: string;
  value: number | undefined;
  placeholder: number;
  dataTestId: string;
  onChange: (value: number | undefined) => void;
}> = (props: {
  title: string;
  description: string;
  value: number | undefined;
  placeholder: number;
  dataTestId: string;
  onChange: (value: number | undefined) => void;
}): ReactElement => {
  const inputId: string = useId();
  const [text, setText] = useState<string>(
    props.value === undefined ? "" : String(props.value),
  );

  useEffect(() => {
    if (TelemetryAlertRuleUtil.toNumber(text) !== props.value) {
      setText(props.value === undefined ? "" : String(props.value));
    }
  }, [props.value]);

  return (
    <div>
      <FieldLabelElement
        title={props.title}
        description={props.description}
        htmlFor={inputId}
        hideOptionalLabel={true}
      />
      <Input
        id={inputId}
        dataTestId={props.dataTestId}
        type={InputType.NUMBER}
        value={text}
        placeholder={String(props.placeholder)}
        onChange={(value: string) => {
          setText(value);

          const parsed: number | undefined =
            TelemetryAlertRuleUtil.toNumber(value);

          if (parsed !== props.value) {
            props.onChange(parsed);
          }
        }}
      />
    </div>
  );
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
  const measureLabelId: string = useId();
  const baselineWindowLabelId: string = useId();
  const horizonLabelId: string = useId();

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
  const [isAnomalyMoreCollapsed, setIsAnomalyMoreCollapsed] =
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
        /*
         * The way back to the simple rule is a switch of what the card
         * shows, so it sits at the header's right edge, where every card
         * keeps what it offers - not under Add Criteria, a second button
         * of the same weight beside the editor's own.
         */
        buttons={
          rule && isCustom
            ? [
                <Button
                  key="back-to-simple-rule"
                  title={TelemetryRuleCopy.backToSimpleRule}
                  buttonSize={ButtonSize.Small}
                  buttonStyle={ButtonStyleType.NORMAL}
                  icon={IconProp.ArrowCircleLeft}
                  dataTestId="telemetry-rule-back-to-simple"
                  onClick={() => {
                    setIsCustom(false);
                  }}
                />,
              ]
            : undefined
        }
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
        </div>
      </Card>
    );
  }

  const isAnomaly: boolean = TelemetryAlertRuleUtil.isAnomaly(rule.filterType);
  const isForecast: boolean = TelemetryAlertRuleUtil.isForecast(
    rule.filterType,
  );

  const comparisonOptions: Array<DropdownOption> = toDropdownOptions(
    getComparisonChoices({
      monitorType,
      measure: rule.measure,
      current: rule.filterType,
    }),
  );

  const metricAliases: Array<string> = isMetric
    ? TelemetryAlertRuleUtil.getMetricAliases(monitorStep)
    : [];
  const effectiveAlias: string | undefined = isMetric
    ? getRuleMetricAlias({ monitorStep, rule })
    : undefined;
  const units: { options: Array<UnitOption>; value: string | undefined } =
    isMetric
      ? getRuleUnits({ monitorStep, rule })
      : { options: [], value: undefined };
  const unitOptions: Array<UnitOption> = units.options;
  const unitValue: string | undefined = units.value;

  const valueError: string | undefined =
    !isAnomaly &&
    rule.threshold === undefined &&
    (isValueTouched || props.showErrors)
      ? translator.translateText(TelemetryRuleCopy.valueRequired)
      : undefined;

  // A rule on new, regressed or rising exceptions: the count chart is not it.
  const isOtherExceptionMeasure: boolean =
    monitorType === MonitorType.Exceptions &&
    Boolean(rule.measure) &&
    rule.measure !== CheckOn.ExceptionCount;

  const previewSettings: JSONObject | null = getPreviewSettings({
    monitorType,
    monitorStep,
  });

  const sentence: string = getRuleSentenceForStep({
    monitorType,
    monitorStep,
    rule,
    translator,
  });

  /*
   * The fields of "When to alert", each on its own: a count rule lays
   * them out in one row (Condition, the number, the window), a metric
   * rule in two - what is measured over which window, then how it
   * compares - so no column is left empty beside them.
   */
  const metricField: ReactElement =
    isMetric && metricAliases.length > 1 ? (
      /*
       * Which metric, only when the step reads more than one: a query alone
       * is the metric the rule reads.
       */
      <div className="sm:col-span-2" data-testid="telemetry-rule-metric">
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
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            if (value) {
              changeCondition({ metricAlias: value.toString() });
            }
          }}
        />
      </div>
    ) : (
      <></>
    );

  // A forecast reads every value of the window into one trend.
  const aggregationField: ReactElement =
    isMetric && !isForecast ? (
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
                (rule.metricAggregationType || EvaluateOverTimeType.AllValues)
              );
            },
          )}
          options={toDropdownOptions(METRIC_AGGREGATION_CHOICES)}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            if (value) {
              changeCondition({
                metricAggregationType: value as EvaluateOverTimeType,
              });
            }
          }}
        />
      </div>
    ) : (
      <></>
    );

  const windowField: ReactElement = isMetric
    ? renderWindowField({
        windowInSeconds: undefined,
        rollingTime: rule.rollingTime,
        onChange: (changes: { rollingTime?: RollingTime }) => {
          changeCondition({ rollingTime: changes.rollingTime });
        },
      })
    : renderWindowField({
        windowInSeconds: rule.windowInSeconds,
        rollingTime: undefined,
        onChange: (changes: { windowInSeconds?: number }) => {
          changeCondition({ windowInSeconds: changes.windowInSeconds });
        },
      });

  /*
   * What an Exceptions rule alerts on: how many exceptions, new ones,
   * ones that came back, or a rise over the usual count
   * (ExceptionMonitorEvaluation). Other monitor types have one measure.
   */
  const measure: CheckOn | null = TelemetryAlertRuleUtil.getRuleMeasure({
    monitorType,
    rule,
  });
  const measureOptions: Array<DropdownOption> = EXCEPTION_MEASURE_CHOICES.map(
    (choice: { value: CheckOn; label: string }): DropdownOption => {
      return {
        value: choice.value,
        label: translator.translateText(choice.label) || choice.label,
      };
    },
  );
  const measureField: ReactElement =
    monitorType === MonitorType.Exceptions ? (
      <div className="mb-4 sm:max-w-xs" data-testid="telemetry-rule-measure">
        <FieldLabelElement
          id={measureLabelId}
          title={TelemetryRuleCopy.exceptionMeasureTitle}
          hideOptionalLabel={true}
        />
        <Dropdown
          ariaLabelledby={measureLabelId}
          isClearable={false}
          value={measureOptions.find((option: DropdownOption) => {
            return option.value === measure;
          })}
          options={measureOptions}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            if (value && isExceptionMeasure(value)) {
              changeCondition(getMeasureChange({ rule, measure: value }));
            }
          }}
        />
      </div>
    ) : (
      <></>
    );

  const comparisonField: ReactElement = (
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
        onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
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
              ...(TelemetryAlertRuleUtil.isForecast(filterType)
                ? getForecastStart({ rule, filterType })
                : {}),
            });
          }
        }}
      />
    </div>
  );

  const valueField: ReactElement = isAnomaly ? (
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
        onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
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
        title={getCountTitle(monitorType, measure || undefined)}
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
              ariaLabel="Unit"
              id={unitLabelId}
              isClearable={false}
              value={unitOptions
                .map((option: UnitOption): DropdownOption => {
                  return { value: option.value, label: option.label };
                })
                .find((option: DropdownOption) => {
                  return option.value === unitValue;
                })}
              options={unitOptions.map((option: UnitOption): DropdownOption => {
                return { value: option.value, label: option.label };
              })}
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
  );

  // How far ahead a forecast rule follows the trend.
  const horizonInHours: number =
    rule.forecast?.horizonInHours || DEFAULT_FORECAST_HORIZON_IN_HOURS;
  const horizonOptions: Array<DropdownOption> = getForecastHorizonChoices({
    current: horizonInHours,
    translator,
  }).map((choice: TelemetryRuleChoice<number>): DropdownOption => {
    return { value: choice.value, label: choice.label };
  });
  const horizonField: ReactElement = isForecast ? (
    <div data-testid="telemetry-rule-forecast-horizon">
      <FieldLabelElement
        id={horizonLabelId}
        title={TelemetryRuleCopy.forecastHorizonTitle}
        hideOptionalLabel={true}
      />
      <Dropdown
        ariaLabelledby={horizonLabelId}
        isClearable={false}
        value={horizonOptions.find((option: DropdownOption) => {
          return option.value === horizonInHours;
        })}
        options={horizonOptions}
        onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
          if (value) {
            changeCondition({
              forecast: {
                ...(rule.forecast || {}),
                horizonInHours: Number(value),
              },
            });
          }
        }}
      />
    </div>
  ) : (
    <></>
  );

  /*
   * An exception rule's anomaly settings, for the few who need them. The
   * rule works without: a sensitivity says the rest. Cleared, each goes
   * back to what the sensitivity sets.
   */
  const changeAnomalyDetection: (
    changes: Partial<MetricAnomalyDetectionOptions>,
  ) => void = (changes: Partial<MetricAnomalyDetectionOptions>): void => {
    const next: MetricAnomalyDetectionOptions = {
      ...(rule.anomalyDetection || {}),
      ...changes,
    };

    for (const key of Object.keys(next) as Array<
      keyof MetricAnomalyDetectionOptions
    >) {
      if (next[key] === undefined) {
        delete next[key];
      }
    }

    changeCondition({ anomalyDetection: next });
  };

  const anomalySettings: ExceptionAnomalySettings = getExceptionAnomalySettings(
    rule.anomalyDetection,
  );
  const defaultAnomalySettings: ExceptionAnomalySettings =
    getExceptionAnomalySettings({ sensitivity: anomalySettings.sensitivity });

  const baselineWindowOptions: Array<DropdownOption> =
    ANOMALY_WINDOW_DAYS_OPTIONS.map((days: number): DropdownOption => {
      return {
        value: days,
        label: translator.translatePlural(
          { one: "{{count}} day", other: "{{count}} days" },
          days,
        ),
      };
    });

  const anomalyMoreFields: ReactElement =
    isAnomaly && monitorType === MonitorType.Exceptions ? (
      <FoldedSection
        title={MORE_FIELDS_SECTION_TITLE}
        className="mt-4"
        isCollapsed={isAnomalyMoreCollapsed}
        onToggle={(isCollapsed: boolean) => {
          setIsAnomalyMoreCollapsed(isCollapsed);
        }}
        items={[
          {
            key: "windowDays",
            title: TelemetryRuleCopy.baselineWindowTitle,
            isSet: anomalySettings.windowDays !== DEFAULT_ANOMALY_WINDOW_DAYS,
            value: String(anomalySettings.windowDays),
          },
          {
            key: "sigmaCount",
            title: TelemetryRuleCopy.sigmaCountTitle,
            isSet: rule.anomalyDetection?.sigmaCount !== undefined,
            value: String(anomalySettings.sigmaCount),
          },
          {
            key: "minimumCount",
            title: TelemetryRuleCopy.minimumCountTitle,
            isSet: rule.anomalyDetection?.minimumCount !== undefined,
            value: String(anomalySettings.minimumCount),
          },
        ]}
        dataTestId="telemetry-rule-anomaly-more-fields"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div data-testid="telemetry-rule-baseline-window">
            <FieldLabelElement
              id={baselineWindowLabelId}
              title={TelemetryRuleCopy.baselineWindowTitle}
              description={TelemetryRuleCopy.baselineWindowDescription}
              hideOptionalLabel={true}
            />
            <Dropdown
              ariaLabelledby={baselineWindowLabelId}
              isClearable={false}
              value={baselineWindowOptions.find((option: DropdownOption) => {
                return option.value === anomalySettings.windowDays;
              })}
              options={baselineWindowOptions}
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                if (value) {
                  changeAnomalyDetection({
                    windowDays:
                      Number(value) === DEFAULT_ANOMALY_WINDOW_DAYS
                        ? undefined
                        : Number(value),
                  });
                }
              }}
            />
          </div>
          <OptionalNumberField
            title={TelemetryRuleCopy.sigmaCountTitle}
            description={TelemetryRuleCopy.sigmaCountDescription}
            value={rule.anomalyDetection?.sigmaCount}
            placeholder={defaultAnomalySettings.sigmaCount}
            dataTestId="telemetry-rule-sigma-count"
            onChange={(value: number | undefined) => {
              changeAnomalyDetection({ sigmaCount: value });
            }}
          />
          <OptionalNumberField
            title={TelemetryRuleCopy.minimumCountTitle}
            description={TelemetryRuleCopy.minimumCountDescription}
            value={rule.anomalyDetection?.minimumCount}
            placeholder={defaultAnomalySettings.minimumCount}
            dataTestId="telemetry-rule-minimum-count"
            onChange={(value: number | undefined) => {
              changeAnomalyDetection({ minimumCount: value });
            }}
          />
        </div>
      </FoldedSection>
    ) : (
      <></>
    );

  return (
    <div className="space-y-6" data-testid="telemetry-rule-editor">
      <Card
        title={TelemetryRuleCopy.whenToAlertTitle}
        description={TelemetryRuleCopy.whenToAlertDescription}
      >
        <div className="mt-2" data-testid="telemetry-rule-condition">
          {measureField}
          {isMetric ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {metricField}
              {aggregationField}
              {windowField}
              {comparisonField}
              {valueField}
              {horizonField}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {comparisonField}
              {valueField}
              {windowField}
            </div>
          )}

          {/* The whole rule, said back right under the fields it reads. */}
          <p
            className="mt-5 rounded-md bg-gray-50 px-4 py-3 text-sm font-medium text-gray-900"
            data-testid="telemetry-rule-sentence"
          >
            {sentence}
          </p>

          {isForecast ? (
            <p
              className="mt-2 text-xs text-gray-500"
              data-testid="telemetry-rule-forecast-hint"
            >
              {translator.translateText(TelemetryRuleCopy.forecastHint)}
            </p>
          ) : (
            <></>
          )}

          {anomalyMoreFields}

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

          {isOtherExceptionMeasure ? (
            <p
              className="mt-3 text-xs text-gray-500"
              data-testid="telemetry-rule-no-preview"
            >
              {translator.translateText(
                TelemetryRuleCopy.exceptionMeasureNoPreview,
              )}
            </p>
          ) : (
            <></>
          )}

          {previewSettings && !isOtherExceptionMeasure ? (
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
