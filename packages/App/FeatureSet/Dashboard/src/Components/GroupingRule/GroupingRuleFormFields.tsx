import {
  DEFAULT_INACTIVITY_TIMEOUT_MINUTES,
  DEFAULT_REOPEN_WINDOW_MINUTES,
  DEFAULT_RESOLVE_DELAY_MINUTES,
  DEFAULT_TIME_WINDOW_MINUTES,
  ENGINE_FALLBACK_TIME_WINDOW_MINUTES,
  GROUPING_MODE_FIELD_KEY,
  GROUPING_RULE_COPY,
  GroupingMode,
  GroupingRuleKind,
  GroupingRuleValues,
  INACTIVITY_TIMEOUT_SETTING_FIELD_KEY,
  REOPEN_WINDOW_SETTING_FIELD_KEY,
  RESOLVE_DELAY_SETTING_FIELD_KEY,
  SHOW_ADVANCED_SETTINGS_FIELD_KEY,
  TIME_WINDOW_SETTING_FIELD_KEY,
  getGroupingMode,
  getMinutesSettingDisplay,
  getMinutesValidationError,
  getSelectedGroupingMode,
  getValuesForGroupingModeChange,
  hasAdvancedSettings,
  isGroupingMode,
} from "../../Utils/GroupingRule/GroupingRuleSetup";
import GroupingModeField from "./GroupingModeField";
import { translateGroupingRuleText } from "./GroupingRuleTranslate";
import MinutesSettingField, {
  MinutesSettingValue,
} from "./MinutesSettingField";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import type { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import SelectFormFields from "Common/UI/Types/SelectEntityField";
import React, { ReactElement } from "react";

/*
 * The fields the Incident and Alert Grouping Rules forms share: the question
 * that replaced the five group-by switches, and the four settings that are a
 * switch and some minutes, each drawn as one control. They are form-only -
 * what they change is written into the rule's own columns, which are
 * registered below (getGroupingRuleColumnFormFields) so the form loads and
 * saves them.
 *
 * Every step id is written out as a string so the form step guards
 * (Common/Tests/Helpers/FormStepsScan.ts) can place each field.
 */

type Values = GroupingRuleValues;

type AsValuesFunction = <TModel extends BaseModel>(
  values: FormValues<TModel>,
) => Values;

const asValues: AsValuesFunction = <TModel extends BaseModel>(
  values: FormValues<TModel>,
): Values => {
  return values as unknown as Values;
};

export const isCustomGroupingSelected: (
  values: Values,
  kind: GroupingRuleKind,
) => boolean = (values: Values, kind: GroupingRuleKind): boolean => {
  return getSelectedGroupingMode(values, kind) === GroupingMode.Custom;
};

export const isShowingAdvancedSettings: (values: Values) => boolean = (
  values: Values,
): boolean => {
  return values[SHOW_ADVANCED_SETTINGS_FIELD_KEY] === true;
};

interface MinutesSetting {
  enabledField: string;
  minutesField: string;
  defaultMinutes: number;
  /*
   * What the engines use when the switch is on with no usable minutes saved:
   * the time window falls back to an hour; the other three do nothing.
   */
  fallbackMinutes: number | null;
}

const TIME_WINDOW: MinutesSetting = {
  enabledField: "enableTimeWindow",
  minutesField: "timeWindowMinutes",
  defaultMinutes: DEFAULT_TIME_WINDOW_MINUTES,
  fallbackMinutes: ENGINE_FALLBACK_TIME_WINDOW_MINUTES,
};

const REOPEN_WINDOW: MinutesSetting = {
  enabledField: "enableReopenWindow",
  minutesField: "reopenWindowMinutes",
  defaultMinutes: DEFAULT_REOPEN_WINDOW_MINUTES,
  fallbackMinutes: null,
};

const RESOLVE_DELAY: MinutesSetting = {
  enabledField: "enableResolveDelay",
  minutesField: "resolveDelayMinutes",
  defaultMinutes: DEFAULT_RESOLVE_DELAY_MINUTES,
  fallbackMinutes: null,
};

const INACTIVITY_TIMEOUT: MinutesSetting = {
  enabledField: "enableInactivityTimeout",
  minutesField: "inactivityTimeoutMinutes",
  defaultMinutes: DEFAULT_INACTIVITY_TIMEOUT_MINUTES,
  fallbackMinutes: null,
};

type MinutesSettingValidationFunction = <TModel extends BaseModel>(
  setting: MinutesSetting,
) => (values: FormValues<TModel>) => string | null;

const validateMinutesSetting: MinutesSettingValidationFunction = <
  TModel extends BaseModel,
>(
  setting: MinutesSetting,
): ((values: FormValues<TModel>) => string | null) => {
  return (values: FormValues<TModel>): string | null => {
    return getMinutesValidationError({
      enabled: asValues(values)[setting.enabledField],
      minutes: asValues(values)[setting.minutesField],
      translate: translateGroupingRuleText,
    });
  };
};

type MinutesSettingChangeFunction = <TModel extends BaseModel>(
  setting: MinutesSetting,
) => (
  value: MinutesSettingValue,
  currentValues: FormValues<TModel>,
  setNewFormValues: (values: FormValues<TModel>) => void,
) => void;

/*
 * The control hands over its switch and minutes together; they land in the
 * rule's two columns.
 */
const changeMinutesSetting: MinutesSettingChangeFunction = <
  TModel extends BaseModel,
>(
  setting: MinutesSetting,
): ((
  value: MinutesSettingValue,
  currentValues: FormValues<TModel>,
  setNewFormValues: (values: FormValues<TModel>) => void,
) => void) => {
  return (
    value: MinutesSettingValue,
    currentValues: FormValues<TModel>,
    setNewFormValues: (values: FormValues<TModel>) => void,
  ): void => {
    setNewFormValues({
      ...currentValues,
      [setting.enabledField]: value.enabled,
      [setting.minutesField]: value.minutes,
    } as FormValues<TModel>);
  };
};

interface MinutesSettingCopy {
  setting: MinutesSetting;
  title: string;
  description: string;
  sentence: string;
  minutesLabel: string;
  dataTestId: string;
}

type RenderMinutesSettingFunction = <TModel extends BaseModel>(
  copy: MinutesSettingCopy,
  values: FormValues<TModel>,
  props: CustomElementProps,
) => ReactElement;

const renderMinutesSetting: RenderMinutesSettingFunction = <
  TModel extends BaseModel,
>(
  copy: MinutesSettingCopy,
  values: FormValues<TModel>,
  props: CustomElementProps,
): ReactElement => {
  const display: { enabled: boolean; minutes: unknown } =
    getMinutesSettingDisplay({
      enabled: asValues(values)[copy.setting.enabledField],
      minutes: asValues(values)[copy.setting.minutesField],
      fallbackMinutes: copy.setting.fallbackMinutes,
    });

  return (
    <MinutesSettingField
      title={copy.title}
      description={copy.description}
      sentence={copy.sentence}
      minutesLabel={copy.minutesLabel}
      enabled={display.enabled}
      minutes={display.minutes}
      defaultMinutes={copy.setting.defaultMinutes}
      error={props.error}
      dataTestId={copy.dataTestId}
      onBlur={props.onBlur}
      onChange={(value: MinutesSettingValue): void => {
        props.onChange?.(value);
      }}
    />
  );
};

// A form-only control's value is a carrier: present, so its check runs.
const carrierDefaultValue: () => boolean = (): boolean => {
  return true;
};

/*
 * "Group incidents by": monitor, everything together, severity, title or
 * custom. Picking one sets the five group-by switches (Custom leaves them for
 * the Group By step), keeps a suggested name in step with the answer, and
 * moves an untouched time window to the answer's own starting value.
 */
export const getGroupingModeFormField: <TModel extends BaseModel>(
  kind: GroupingRuleKind,
) => ModelField<TModel> = <TModel extends BaseModel>(
  kind: GroupingRuleKind,
): ModelField<TModel> => {
  return {
    overrideField: {
      groupByMonitor: true,
    },
    overrideFieldKey: GROUPING_MODE_FIELD_KEY,
    formOnly: true,
    title: GROUPING_RULE_COPY.modeFieldTitle[kind],
    description: GROUPING_RULE_COPY.modeFieldDescription[kind],
    stepId: "grouping",
    fieldType: FormFieldSchemaType.CustomComponent,
    required: false,
    hideOptionalLabel: true,
    spanFullRow: true,
    dataTestId: "grouping-mode",
    getDefaultValue: (values: FormValues<TModel>): string => {
      return getGroupingMode(asValues(values), kind);
    },
    onChange: (
      value: unknown,
      currentValues: FormValues<TModel>,
      setNewFormValues: (values: FormValues<TModel>) => void,
    ): void => {
      if (!isGroupingMode(value)) {
        return;
      }

      setNewFormValues({
        ...currentValues,
        ...getValuesForGroupingModeChange({
          values: asValues(currentValues),
          mode: value,
          kind,
          translate: translateGroupingRuleText,
        }),
      } as FormValues<TModel>);
    },
    getCustomElement: (
      values: FormValues<TModel>,
      props: CustomElementProps,
    ): ReactElement => {
      return (
        <GroupingModeField
          kind={kind}
          value={getSelectedGroupingMode(asValues(values), kind)}
          error={props.error}
          ariaLabelledby={props.ariaLabelledby}
          onChange={(mode: GroupingMode): void => {
            props.onChange?.(mode);
          }}
        />
      );
    },
  };
};

// "Only group incidents that arrive close together", within N minutes.
export const getTimeWindowFormField: <TModel extends BaseModel>(
  kind: GroupingRuleKind,
) => ModelField<TModel> = <TModel extends BaseModel>(
  kind: GroupingRuleKind,
): ModelField<TModel> => {
  return {
    overrideField: {
      timeWindowMinutes: true,
    },
    overrideFieldKey: TIME_WINDOW_SETTING_FIELD_KEY,
    formOnly: true,
    title: GROUPING_RULE_COPY.timeWindowTitle[kind],
    stepId: "grouping",
    fieldType: FormFieldSchemaType.CustomComponent,
    customElementDrawsOwnLabel: true,
    required: false,
    spanFullRow: true,
    getDefaultValue: carrierDefaultValue,
    customValidation: validateMinutesSetting<TModel>(TIME_WINDOW),
    onChange: changeMinutesSetting<TModel>(TIME_WINDOW),
    getCustomElement: (
      values: FormValues<TModel>,
      props: CustomElementProps,
    ): ReactElement => {
      return renderMinutesSetting<TModel>(
        {
          setting: TIME_WINDOW,
          title: GROUPING_RULE_COPY.timeWindowTitle[kind],
          description: GROUPING_RULE_COPY.timeWindowDescription[kind],
          sentence: GROUPING_RULE_COPY.timeWindowSentence[kind],
          minutesLabel: "Time Window",
          dataTestId: "time-window-setting",
        },
        values,
        props,
      );
    },
  };
};

/*
 * Everything a rule can do beyond grouping - reopening and auto-resolving
 * episodes, episode titles and labels, on-call and owners - lives on steps
 * this switch shows. A rule that already uses any of it opens with it on.
 */
export const getShowAdvancedSettingsFormField: <
  TModel extends BaseModel,
>() => ModelField<TModel> = <
  TModel extends BaseModel,
>(): ModelField<TModel> => {
  return {
    overrideField: {
      isEnabled: true,
    },
    overrideFieldKey: SHOW_ADVANCED_SETTINGS_FIELD_KEY,
    formOnly: true,
    title: GROUPING_RULE_COPY.showAdvancedTitle,
    description: GROUPING_RULE_COPY.showAdvancedDescription,
    stepId: "grouping",
    fieldType: FormFieldSchemaType.Toggle,
    required: false,
    dataTestId: "show-advanced-settings",
    getDefaultValue: (values: FormValues<TModel>): boolean => {
      return hasAdvancedSettings(asValues(values));
    },
  };
};

export const getReopenWindowFormField: <TModel extends BaseModel>(
  kind: GroupingRuleKind,
) => ModelField<TModel> = <TModel extends BaseModel>(
  kind: GroupingRuleKind,
): ModelField<TModel> => {
  return {
    overrideField: {
      reopenWindowMinutes: true,
    },
    overrideFieldKey: REOPEN_WINDOW_SETTING_FIELD_KEY,
    formOnly: true,
    title: GROUPING_RULE_COPY.reopenWindowTitle,
    stepId: "episode-lifecycle",
    fieldType: FormFieldSchemaType.CustomComponent,
    customElementDrawsOwnLabel: true,
    required: false,
    spanFullRow: true,
    getDefaultValue: carrierDefaultValue,
    customValidation: validateMinutesSetting<TModel>(REOPEN_WINDOW),
    onChange: changeMinutesSetting<TModel>(REOPEN_WINDOW),
    getCustomElement: (
      values: FormValues<TModel>,
      props: CustomElementProps,
    ): ReactElement => {
      return renderMinutesSetting<TModel>(
        {
          setting: REOPEN_WINDOW,
          title: GROUPING_RULE_COPY.reopenWindowTitle,
          description: GROUPING_RULE_COPY.reopenWindowDescription[kind],
          sentence: GROUPING_RULE_COPY.reopenWindowSentence,
          minutesLabel: "Reopen Window",
          dataTestId: "reopen-window-setting",
        },
        values,
        props,
      );
    },
  };
};

export const getResolveDelayFormField: <TModel extends BaseModel>(
  kind: GroupingRuleKind,
) => ModelField<TModel> = <TModel extends BaseModel>(
  kind: GroupingRuleKind,
): ModelField<TModel> => {
  return {
    overrideField: {
      resolveDelayMinutes: true,
    },
    overrideFieldKey: RESOLVE_DELAY_SETTING_FIELD_KEY,
    formOnly: true,
    title: GROUPING_RULE_COPY.resolveDelayTitle,
    stepId: "episode-lifecycle",
    fieldType: FormFieldSchemaType.CustomComponent,
    customElementDrawsOwnLabel: true,
    required: false,
    spanFullRow: true,
    getDefaultValue: carrierDefaultValue,
    customValidation: validateMinutesSetting<TModel>(RESOLVE_DELAY),
    onChange: changeMinutesSetting<TModel>(RESOLVE_DELAY),
    getCustomElement: (
      values: FormValues<TModel>,
      props: CustomElementProps,
    ): ReactElement => {
      return renderMinutesSetting<TModel>(
        {
          setting: RESOLVE_DELAY,
          title: GROUPING_RULE_COPY.resolveDelayTitle,
          description: GROUPING_RULE_COPY.resolveDelayDescription[kind],
          sentence: GROUPING_RULE_COPY.resolveDelaySentence,
          minutesLabel: "Resolve Delay",
          dataTestId: "resolve-delay-setting",
        },
        values,
        props,
      );
    },
  };
};

export const getInactivityTimeoutFormField: <TModel extends BaseModel>(
  kind: GroupingRuleKind,
) => ModelField<TModel> = <TModel extends BaseModel>(
  kind: GroupingRuleKind,
): ModelField<TModel> => {
  return {
    overrideField: {
      inactivityTimeoutMinutes: true,
    },
    overrideFieldKey: INACTIVITY_TIMEOUT_SETTING_FIELD_KEY,
    formOnly: true,
    title: GROUPING_RULE_COPY.inactivityTimeoutTitle,
    stepId: "episode-lifecycle",
    fieldType: FormFieldSchemaType.CustomComponent,
    customElementDrawsOwnLabel: true,
    required: false,
    spanFullRow: true,
    getDefaultValue: carrierDefaultValue,
    customValidation: validateMinutesSetting<TModel>(INACTIVITY_TIMEOUT),
    onChange: changeMinutesSetting<TModel>(INACTIVITY_TIMEOUT),
    getCustomElement: (
      values: FormValues<TModel>,
      props: CustomElementProps,
    ): ReactElement => {
      return renderMinutesSetting<TModel>(
        {
          setting: INACTIVITY_TIMEOUT,
          title: GROUPING_RULE_COPY.inactivityTimeoutTitle,
          description: GROUPING_RULE_COPY.inactivityTimeoutDescription[kind],
          sentence: GROUPING_RULE_COPY.inactivityTimeoutSentence[kind],
          minutesLabel: "Inactivity Timeout",
          dataTestId: "inactivity-timeout-setting",
        },
        values,
        props,
      );
    },
  };
};

type SelectColumnFunction = <TModel extends BaseModel>(
  column: string,
) => SelectFormFields<TModel>;

const selectColumn: SelectColumnFunction = <TModel extends BaseModel>(
  column: string,
): SelectFormFields<TModel> => {
  return { [column]: true } as unknown as SelectFormFields<TModel>;
};

/*
 * The rule's own columns behind the controls above. Never drawn - the
 * controls draw them - but registered, so the form reads them when it opens a
 * rule and sends them when it saves one.
 */
export const getGroupingRuleColumnFormFields: <
  TModel extends BaseModel,
>() => Array<ModelField<TModel>> = <TModel extends BaseModel>(): Array<
  ModelField<TModel>
> => {
  return [
    {
      field: selectColumn<TModel>("enableTimeWindow"),
      title: "Enable Time Window",
      stepId: "grouping",
      fieldType: FormFieldSchemaType.Checkbox,
      required: false,
      showIf: (): boolean => {
        return false;
      },
    },
    {
      field: selectColumn<TModel>("timeWindowMinutes"),
      title: "Time Window (minutes)",
      stepId: "grouping",
      fieldType: FormFieldSchemaType.Number,
      required: false,
      showIf: (): boolean => {
        return false;
      },
    },
    {
      field: selectColumn<TModel>("enableReopenWindow"),
      title: "Enable Reopen Window",
      stepId: "episode-lifecycle",
      fieldType: FormFieldSchemaType.Checkbox,
      required: false,
      showIf: (): boolean => {
        return false;
      },
    },
    {
      field: selectColumn<TModel>("reopenWindowMinutes"),
      title: "Reopen Window (minutes)",
      stepId: "episode-lifecycle",
      fieldType: FormFieldSchemaType.Number,
      required: false,
      showIf: (): boolean => {
        return false;
      },
    },
    {
      field: selectColumn<TModel>("enableResolveDelay"),
      title: "Enable Resolve Delay",
      stepId: "episode-lifecycle",
      fieldType: FormFieldSchemaType.Checkbox,
      required: false,
      showIf: (): boolean => {
        return false;
      },
    },
    {
      field: selectColumn<TModel>("resolveDelayMinutes"),
      title: "Resolve Delay (minutes)",
      stepId: "episode-lifecycle",
      fieldType: FormFieldSchemaType.Number,
      required: false,
      showIf: (): boolean => {
        return false;
      },
    },
    {
      field: selectColumn<TModel>("enableInactivityTimeout"),
      title: "Enable Inactivity Timeout",
      stepId: "episode-lifecycle",
      fieldType: FormFieldSchemaType.Checkbox,
      required: false,
      showIf: (): boolean => {
        return false;
      },
    },
    {
      field: selectColumn<TModel>("inactivityTimeoutMinutes"),
      title: "Inactivity Timeout (minutes)",
      stepId: "episode-lifecycle",
      fieldType: FormFieldSchemaType.Number,
      required: false,
      showIf: (): boolean => {
        return false;
      },
    },
  ];
};
