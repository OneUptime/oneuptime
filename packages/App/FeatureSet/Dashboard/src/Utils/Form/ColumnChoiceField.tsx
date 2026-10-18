import {
  ColumnChoiceConfig,
  ColumnChoiceOption,
  getColumnChoiceInForm,
  getValuesForColumnChoice,
  isColumnChoice,
} from "./ColumnChoice";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import type { ModelField } from "Common/UI/Components/Forms/ModelForm";
import {
  CustomElementProps,
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Radio, {
  RadioOption,
  RadioValue,
} from "Common/UI/Components/Radio/Radio";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The field that asks a ColumnChoiceConfig's question (ColumnChoice.ts):
 * its answers as radios, each with its one line, written into the columns
 * the config names. The columns themselves are registered by the form, each
 * with showIf () => false, so the form loads and saves them without drawing
 * them.
 */

export interface ColumnChoiceRadioProps<TChoice extends string> {
  config: ColumnChoiceConfig<TChoice>;
  value: TChoice;
  onChange: (choice: TChoice) => void;
  error?: string | undefined;
  ariaLabelledby?: string | undefined;
}

export const ColumnChoiceRadio: <TChoice extends string>(
  props: ColumnChoiceRadioProps<TChoice>,
) => ReactElement = <TChoice extends string>(
  props: ColumnChoiceRadioProps<TChoice>,
): ReactElement => {
  const translator: Translator = useTranslator();

  const options: Array<RadioOption> = props.config.options.map(
    (option: ColumnChoiceOption<TChoice>): RadioOption => {
      return {
        value: option.value,
        label: translator.translateText(option.title) || option.title,
        ...(option.description
          ? {
              description:
                translator.translateText(option.description) ||
                option.description,
            }
          : {}),
      };
    },
  );

  return (
    <Radio
      className="mt-0"
      dataTestId={props.config.dataTestId}
      ariaLabelledby={props.ariaLabelledby}
      options={options}
      value={props.value}
      error={props.error}
      onChange={(value: RadioValue | null): void => {
        if (isColumnChoice(props.config, value)) {
          props.onChange(value);
        }
      }}
    />
  );
};

export interface ColumnChoiceFieldOptions<
  TBaseModel extends BaseModel,
  TChoice extends string,
> {
  config: ColumnChoiceConfig<TChoice>;
  // The column the choice stands in for (the field's overrideField).
  column: string;
  stepId?: string | undefined;
  doNotShowWhenCreating?: boolean | undefined;
  doNotShowWhenEditing?: boolean | undefined;
  collapsibleSection?: FormFieldCollapsibleSection<TBaseModel> | undefined;
}

/**
 * The form field that asks the question: form-only, so what is sent is the
 * columns the answer writes, never the answer.
 */
export const getColumnChoiceField: <
  TBaseModel extends BaseModel,
  TChoice extends string,
>(
  options: ColumnChoiceFieldOptions<TBaseModel, TChoice>,
) => ModelField<TBaseModel> = <
  TBaseModel extends BaseModel,
  TChoice extends string,
>(
  options: ColumnChoiceFieldOptions<TBaseModel, TChoice>,
): ModelField<TBaseModel> => {
  const config: ColumnChoiceConfig<TChoice> = options.config;

  return {
    overrideField: {
      [options.column]: true,
    },
    overrideFieldKey: config.key,
    formOnly: true,
    title: config.title,
    stepId: options.stepId,
    doNotShowWhenCreating: options.doNotShowWhenCreating,
    doNotShowWhenEditing: options.doNotShowWhenEditing,
    collapsibleSection: options.collapsibleSection,
    fieldType: FormFieldSchemaType.CustomComponent,
    required: false,
    hideOptionalLabel: true,
    // Each answer says what it means; the column describes only one part.
    hideColumnDescription: true,
    dataTestId: `${config.dataTestId}-field`,
    onChange: (
      value: unknown,
      currentValues: FormValues<TBaseModel>,
      setNewFormValues: (values: FormValues<TBaseModel>) => void,
    ): void => {
      if (!isColumnChoice(config, value)) {
        return;
      }

      setNewFormValues(
        getValuesForColumnChoice({
          config: config,
          values: currentValues,
          choice: value,
        }) as FormValues<TBaseModel>,
      );
    },
    getCustomElement: (
      values: FormValues<TBaseModel>,
      props: CustomElementProps,
    ): ReactElement => {
      return (
        <ColumnChoiceRadio<TChoice>
          config={config}
          value={getColumnChoiceInForm(config, values)}
          error={props.error}
          ariaLabelledby={props.ariaLabelledby}
          onChange={(choice: TChoice): void => {
            props.onChange?.(choice);
          }}
        />
      );
    },
  };
};

// A choice's answer drawn on its own, for a card's row (read only).
export interface ColumnChoiceAnswerProps {
  title: string;
  dataTestId?: string | undefined;
}

export const ColumnChoiceAnswer: FunctionComponent<ColumnChoiceAnswerProps> = (
  props: ColumnChoiceAnswerProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span data-testid={props.dataTestId}>
      {translator.translateText(props.title) || props.title}
    </span>
  );
};

export default getColumnChoiceField;
