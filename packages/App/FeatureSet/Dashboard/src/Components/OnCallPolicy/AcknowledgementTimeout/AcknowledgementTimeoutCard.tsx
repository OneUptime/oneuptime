import {
  ACKNOWLEDGEMENT_TIMEOUT_CHOICES,
  ACKNOWLEDGEMENT_TIMEOUT_CHOICE_FIELD_KEY,
  ACKNOWLEDGEMENT_TIMEOUT_COLUMN,
  ACKNOWLEDGEMENT_TIMEOUT_MAX_MINUTES,
  ACKNOWLEDGEMENT_TIMEOUT_MIN_MINUTES,
  ACKNOWLEDGEMENT_TIMEOUT_TEST_ID,
  AcknowledgementTimeoutChoice,
  AcknowledgementTimeoutCopy,
  getAcknowledgementTimeoutChoiceInForm,
  getAcknowledgementTimeoutMinutes,
  getValuesForAcknowledgementTimeoutChoice,
  isAcknowledgementTimeoutChoice,
  isAcknowledgementTimeoutMinutesValid,
} from "./AcknowledgementTimeout";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import ObjectID from "Common/Types/ObjectID";
import type { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import Radio, {
  RadioOption,
  RadioValue,
} from "Common/UI/Components/Radio/Radio";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The Acknowledgement Timeout card of a policy's Escalation Rules page,
 * under More settings, and the dialog that changes it: "Don't page again" or
 * "Page again", and after how many minutes only once it pages again
 * (AcknowledgementTimeout.ts). Drawn on the shared detail card, so it looks,
 * locks and opens its dialog like the Repeat Policy card above it.
 */

const asValues: (values: unknown) => Record<string, unknown> = (
  values: unknown,
): Record<string, unknown> => {
  return values && typeof values === "object"
    ? (values as Record<string, unknown>)
    : {};
};

export interface ChoiceFieldProps {
  value: AcknowledgementTimeoutChoice;
  onChange: (choice: AcknowledgementTimeoutChoice) => void;
  error?: string | undefined;
  ariaLabelledby?: string | undefined;
}

// Don't page again, or page again: two answers, each saying what it means.
export const AcknowledgementTimeoutChoiceField: FunctionComponent<
  ChoiceFieldProps
> = (props: ChoiceFieldProps): ReactElement => {
  const translator: Translator = useTranslator();

  const options: Array<RadioOption> = ACKNOWLEDGEMENT_TIMEOUT_CHOICES.map(
    (choice: AcknowledgementTimeoutChoice): RadioOption => {
      const copy: { title: string; description: string } =
        AcknowledgementTimeoutCopy.choices[choice];

      return {
        value: choice,
        label: translator.translateText(copy.title) || copy.title,
        description:
          translator.translateText(copy.description) || copy.description,
      };
    },
  );

  return (
    <Radio
      className="mt-0"
      dataTestId={`${ACKNOWLEDGEMENT_TIMEOUT_TEST_ID}-choice`}
      ariaLabelledby={props.ariaLabelledby}
      options={options}
      value={props.value}
      error={props.error}
      onChange={(value: RadioValue | null): void => {
        if (isAcknowledgementTimeoutChoice(value)) {
          props.onChange(value);
        }
      }}
    />
  );
};

/*
 * The dialog's fields: the choice (form-only, written into the one column)
 * and the minutes, shown once Page again is picked. Hidden, the minutes are
 * still saved: empty, which turns the timeout off. The translator words the
 * minutes box's one refusal.
 */
export const getAcknowledgementTimeoutFormFields: (
  translator: Translator,
) => Array<ModelField<OnCallDutyPolicy>> = (
  translator: Translator,
): Array<ModelField<OnCallDutyPolicy>> => {
  const isPagingAgain: (values: FormValues<OnCallDutyPolicy>) => boolean = (
    values: FormValues<OnCallDutyPolicy>,
  ): boolean => {
    return (
      getAcknowledgementTimeoutChoiceInForm(values) ===
      AcknowledgementTimeoutChoice.PageAgain
    );
  };

  return [
    {
      overrideField: {
        acknowledgementTimeoutInMinutes: true,
      },
      overrideFieldKey: ACKNOWLEDGEMENT_TIMEOUT_CHOICE_FIELD_KEY,
      formOnly: true,
      title: AcknowledgementTimeoutCopy.fieldTitle,
      fieldType: FormFieldSchemaType.CustomComponent,
      required: false,
      hideOptionalLabel: true,
      // Each answer says what it means.
      hideColumnDescription: true,
      dataTestId: `${ACKNOWLEDGEMENT_TIMEOUT_TEST_ID}-choice-field`,
      onChange: (
        value: unknown,
        currentValues: FormValues<OnCallDutyPolicy>,
        setNewFormValues: (values: FormValues<OnCallDutyPolicy>) => void,
      ): void => {
        if (!isAcknowledgementTimeoutChoice(value)) {
          return;
        }

        setNewFormValues(
          getValuesForAcknowledgementTimeoutChoice({
            values: currentValues,
            choice: value,
          }) as FormValues<OnCallDutyPolicy>,
        );
      },
      getCustomElement: (
        values: FormValues<OnCallDutyPolicy>,
        props: CustomElementProps,
      ): ReactElement => {
        return (
          <AcknowledgementTimeoutChoiceField
            value={getAcknowledgementTimeoutChoiceInForm(values)}
            error={props.error}
            ariaLabelledby={props.ariaLabelledby}
            onChange={(choice: AcknowledgementTimeoutChoice): void => {
              props.onChange?.(choice);
            }}
          />
        );
      },
    },
    {
      field: {
        acknowledgementTimeoutInMinutes: true,
      },
      title: AcknowledgementTimeoutCopy.minutesTitle,
      description: AcknowledgementTimeoutCopy.minutesDescription,
      fieldType: FormFieldSchemaType.Number,
      required: isPagingAgain,
      hideColumnDescription: true,
      validation: {
        minValue: ACKNOWLEDGEMENT_TIMEOUT_MIN_MINUTES,
        maxValue: ACKNOWLEDGEMENT_TIMEOUT_MAX_MINUTES,
      },
      /*
       * One refusal for everything the box may not hold - empty, a
       * fraction, too few or too many minutes - that says what to type.
       * Checked last, it takes the place of the form's own words, which
       * name the question ("After how many minutes? is required.").
       */
      customValidation: (
        values: FormValues<OnCallDutyPolicy>,
      ): string | null => {
        if (
          !isPagingAgain(values) ||
          isAcknowledgementTimeoutMinutesValid(
            asValues(values)[ACKNOWLEDGEMENT_TIMEOUT_COLUMN],
          )
        ) {
          return null;
        }

        return translator.translateTemplate(
          AcknowledgementTimeoutCopy.minutesRefusal,
          {
            min: ACKNOWLEDGEMENT_TIMEOUT_MIN_MINUTES,
            max: ACKNOWLEDGEMENT_TIMEOUT_MAX_MINUTES,
          },
        );
      },
      showIf: isPagingAgain,
      /*
       * Typing in the box - emptying it to type another number included -
       * keeps Page again picked: read from the stored minutes alone, an
       * empty box would read as Don't page again, and the box would vanish
       * under the cursor.
       */
      onChange: (
        _value: unknown,
        currentValues: FormValues<OnCallDutyPolicy>,
        setNewFormValues: (values: FormValues<OnCallDutyPolicy>) => void,
      ): void => {
        if (
          asValues(currentValues)[ACKNOWLEDGEMENT_TIMEOUT_CHOICE_FIELD_KEY] ===
          AcknowledgementTimeoutChoice.PageAgain
        ) {
          return;
        }

        setNewFormValues({
          ...asValues(currentValues),
          [ACKNOWLEDGEMENT_TIMEOUT_CHOICE_FIELD_KEY]:
            AcknowledgementTimeoutChoice.PageAgain,
        } as FormValues<OnCallDutyPolicy>);
      },
      dataTestId: `${ACKNOWLEDGEMENT_TIMEOUT_TEST_ID}-minutes-field`,
    },
  ];
};

export interface SummaryProps {
  item: unknown;
}

/*
 * The card's row: "Don't page again", or "Page again if not resolved within
 * 30 minutes" - what the stored policy does.
 */
export const AcknowledgementTimeoutSummary: FunctionComponent<SummaryProps> = (
  props: SummaryProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const minutes: number | null = getAcknowledgementTimeoutMinutes(props.item);

  if (minutes === null) {
    const title: string =
      AcknowledgementTimeoutCopy.choices[AcknowledgementTimeoutChoice.Off]
        .title;

    return (
      <span data-testid={`${ACKNOWLEDGEMENT_TIMEOUT_TEST_ID}-summary`}>
        {translator.translateText(title) || title}
      </span>
    );
  }

  return (
    <span data-testid={`${ACKNOWLEDGEMENT_TIMEOUT_TEST_ID}-summary`}>
      {translator.translatePlural(
        AcknowledgementTimeoutCopy.pageAgainSummary,
        minutes,
      )}
    </span>
  );
};

export interface ComponentProps {
  onCallDutyPolicyId: ObjectID;
  /*
   * The minutes the policy pages again after, or null while it does not -
   * each time the card reads or saves them: what More settings says while
   * it is folded.
   */
  onLoaded?: ((minutes: number | null) => void) | undefined;
}

const AcknowledgementTimeoutCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <CardModelDetail<OnCallDutyPolicy>
      name="On-Call Policy > Acknowledgement Timeout"
      editButtonText="Edit"
      editModalTitle={AcknowledgementTimeoutCopy.dialogTitle}
      cardProps={{
        title: AcknowledgementTimeoutCopy.cardTitle,
        description: AcknowledgementTimeoutCopy.cardDescription,
      }}
      isEditable={true}
      formFields={getAcknowledgementTimeoutFormFields(translator)}
      modelDetailProps={{
        modelType: OnCallDutyPolicy,
        id: `${ACKNOWLEDGEMENT_TIMEOUT_TEST_ID}-detail`,
        modelId: props.onCallDutyPolicyId,
        showDetailsInNumberOfColumns: 1,
        selectMoreFields: {
          acknowledgementTimeoutInMinutes: true,
        },
        onItemLoaded: (item: OnCallDutyPolicy): void => {
          props.onLoaded?.(
            getAcknowledgementTimeoutMinutes({
              [ACKNOWLEDGEMENT_TIMEOUT_COLUMN]:
                item.acknowledgementTimeoutInMinutes,
            }),
          );
        },
        fields: [
          {
            field: {
              acknowledgementTimeoutInMinutes: true,
            },
            title: AcknowledgementTimeoutCopy.rowTitle,
            getElement: (item: OnCallDutyPolicy): ReactElement => {
              return <AcknowledgementTimeoutSummary item={item} />;
            },
          },
        ],
      }}
    />
  );
};

export default AcknowledgementTimeoutCard;
