import {
  REPEAT_CHOICE_FIELD_KEY,
  RepeatChoice,
  RepeatChoiceConfig,
  getRepeatChoice,
  getRepeatTimes,
  getValuesForRepeatChoice,
  isRepeatChoice,
} from "./RepeatChoice";
import RepeatChoiceField from "./RepeatChoiceField";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "Common/Types/ObjectID";
import type { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import SelectFormFields from "Common/UI/Types/SelectEntityField";
import Select from "Common/Types/BaseDatabase/Select";
import React, { ReactElement } from "react";

/*
 * The card that says what happens after a policy's last level, and the
 * dialog that changes it: "Stop paging" or "Start again from Level 1", and
 * how many more times only once it starts again (RepeatChoice.ts). The
 * same card for an on-call policy (its Escalation Rules page) and an
 * incoming call policy (its Settings page), each with its own words and
 * columns. Drawn on the shared detail card, so it looks, locks and opens
 * its dialog like every other.
 */

const asValues: (values: unknown) => Record<string, unknown> = (
  values: unknown,
): Record<string, unknown> => {
  return values && typeof values === "object"
    ? (values as Record<string, unknown>)
    : {};
};

/*
 * The answer the form shows: the one picked in it, once one is - so
 * emptying the number box to type another one does not flip the choice
 * back to Stop - and otherwise the one the stored pair makes.
 */
export const getRepeatChoiceInForm: (
  config: RepeatChoiceConfig,
  values: unknown,
) => RepeatChoice = (
  config: RepeatChoiceConfig,
  values: unknown,
): RepeatChoice => {
  const picked: unknown = asValues(values)[REPEAT_CHOICE_FIELD_KEY];

  if (isRepeatChoice(picked)) {
    return picked;
  }

  return getRepeatChoice(config, values);
};

/*
 * The dialog's fields: the choice (form-only, written into the two
 * columns), the number of times once Start again is picked, and the
 * switch's column registered unseen so the form loads and saves it.
 */
export const getRepeatChoiceFormFields: <TBaseModel extends BaseModel>(
  config: RepeatChoiceConfig,
) => Array<ModelField<TBaseModel>> = <TBaseModel extends BaseModel>(
  config: RepeatChoiceConfig,
): Array<ModelField<TBaseModel>> => {
  const isStartingAgain: (values: FormValues<TBaseModel>) => boolean = (
    values: FormValues<TBaseModel>,
  ): boolean => {
    return (
      getRepeatChoiceInForm(config, values) === RepeatChoice.StartAgain
    );
  };

  return [
    {
      overrideField: {
        [config.columns.repeat]: true as const,
      },
      overrideFieldKey: REPEAT_CHOICE_FIELD_KEY,
      formOnly: true,
      title: config.copy.fieldTitle,
      fieldType: FormFieldSchemaType.CustomComponent,
      required: false,
      hideOptionalLabel: true,
      /*
       * Each answer says what it means; the switch's column describes only
       * half of the choice.
       */
      hideColumnDescription: true,
      dataTestId: `${config.dataTestId}-choice-field`,
      onChange: (
        value: unknown,
        currentValues: FormValues<TBaseModel>,
        setNewFormValues: (values: FormValues<TBaseModel>) => void,
      ): void => {
        if (!isRepeatChoice(value)) {
          return;
        }

        setNewFormValues(
          getValuesForRepeatChoice({
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
          <RepeatChoiceField
            config={config}
            value={getRepeatChoiceInForm(config, values)}
            error={props.error}
            ariaLabelledby={props.ariaLabelledby}
            onChange={(choice: RepeatChoice): void => {
              props.onChange?.(choice);
            }}
          />
        );
      },
    },
    {
      field: {
        [config.columns.times]: true,
      } as SelectFormFields<TBaseModel>,
      title: config.copy.timesTitle,
      description: config.copy.timesDescription,
      fieldType: FormFieldSchemaType.Number,
      required: isStartingAgain,
      hideColumnDescription: true,
      validation: {
        minValue: 1,
      },
      showIf: isStartingAgain,
      /*
       * The box is there only while Start again is the answer. Typing in it -
       * emptying it to type another number included - keeps that answer,
       * which a stored pair would otherwise read again from the number: on
       * an on-call policy an empty box reads as 0 repeats, which is Stop,
       * and the box would vanish under the cursor.
       */
      onChange: (
        _value: unknown,
        currentValues: FormValues<TBaseModel>,
        setNewFormValues: (values: FormValues<TBaseModel>) => void,
      ): void => {
        if (
          asValues(currentValues)[REPEAT_CHOICE_FIELD_KEY] ===
          RepeatChoice.StartAgain
        ) {
          return;
        }

        setNewFormValues({
          ...asValues(currentValues),
          [REPEAT_CHOICE_FIELD_KEY]: RepeatChoice.StartAgain,
        } as FormValues<TBaseModel>);
      },
      dataTestId: `${config.dataTestId}-times-field`,
    },
    {
      field: {
        [config.columns.repeat]: true,
      } as SelectFormFields<TBaseModel>,
      title: config.copy.fieldTitle,
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      hideColumnDescription: true,
      showIf: (): boolean => {
        return false;
      },
    },
  ];
};

export interface RepeatChoiceSummaryProps {
  config: RepeatChoiceConfig;
  item: unknown;
}

/*
 * The card's row: "Stop paging", or "Start again from Level 1, up to 2 more
 * times" - what the stored pair does.
 */
export const RepeatChoiceSummary: (
  props: RepeatChoiceSummaryProps,
) => ReactElement = (props: RepeatChoiceSummaryProps): ReactElement => {
  const translator: Translator = useTranslator();
  const choice: RepeatChoice = getRepeatChoice(props.config, props.item);

  if (choice === RepeatChoice.Stop) {
    const title: string = props.config.copy.choices[RepeatChoice.Stop].title;

    return (
      <span data-testid={`${props.config.dataTestId}-summary`}>
        {translator.translateText(title) || title}
      </span>
    );
  }

  return (
    <span data-testid={`${props.config.dataTestId}-summary`}>
      {translator.translateTemplate(props.config.copy.startAgainSummary, {
        times: translator.translatePlural(
          { one: "{{count}} more time", other: "{{count}} more times" },
          getRepeatTimes(props.config, props.item),
        ),
      })}
    </span>
  );
};

export interface ComponentProps<TBaseModel extends BaseModel> {
  config: RepeatChoiceConfig;
  modelType: { new (): TBaseModel };
  modelId: ObjectID;
  // The detail card's name, for its form and analytics.
  name: string;
}

const RepeatChoiceCard: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  return (
    <CardModelDetail<TBaseModel>
      name={props.name}
      editButtonText="Edit"
      editModalTitle={props.config.copy.dialogTitle}
      cardProps={{
        title: props.config.copy.cardTitle,
        description: props.config.copy.cardDescription,
      }}
      isEditable={true}
      formFields={getRepeatChoiceFormFields<TBaseModel>(props.config)}
      modelDetailProps={{
        modelType: props.modelType,
        id: `${props.config.dataTestId}-detail`,
        modelId: props.modelId,
        showDetailsInNumberOfColumns: 1,
        selectMoreFields: {
          [props.config.columns.repeat]: true,
          [props.config.columns.times]: true,
        } as Select<TBaseModel>,
        fields: [
          {
            field: {
              [props.config.columns.repeat]: true,
            } as Select<TBaseModel>,
            title: props.config.copy.rowTitle,
            getElement: (item: TBaseModel): ReactElement => {
              return (
                <RepeatChoiceSummary config={props.config} item={item} />
              );
            },
          },
        ],
      }}
    />
  );
};

export default RepeatChoiceCard;
