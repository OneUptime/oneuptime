import API from "../../Utils/API/API";
import UiAnalytics from "../../Utils/Analytics";
import DropdownUtil from "../../Utils/Dropdown";
import useTranslateValue from "../../Utils/Translation";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import Alert, { AlertType } from "../Alerts/Alert";
import Button, { ButtonStyleType } from "../Button/Button";
import ButtonTypes from "../Button/ButtonTypes";

import {
  DropdownOption,
  DropdownOptionGroup,
  DropdownValue,
} from "../Dropdown/Dropdown";
import { getDropdownChange } from "../Dropdown/DropdownChange";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import CollapsibleFormSection from "./CollapsibleFormSection";
import FormField from "./Fields/FormField";
import FormSummary from "./FormSummary";
import Steps from "./Steps/Steps";
import Field, { FormFieldCollapsibleSection } from "./Types/Field";
import Fields from "./Types/Fields";
import FormFieldSchemaType from "./Types/FormFieldSchemaType";
import { FormStep } from "./Types/FormStep";
import FormValues from "./Types/FormValues";
import Validation from "./Validation";
import { isFormSectionConfigured } from "./Utils/AdvancedFormSection";
import { getFoldedFormFieldItems } from "./Utils/FoldedFormFields";
import FormAnalyticsName from "./Utils/FormAnalyticsName";
import {
  FORM_NEXT_BUTTON_TEST_ID,
  NEXT_BUTTON_STYLE,
  NEXT_BUTTON_TEXT,
  SteppedFormFooter,
  getSteppedFormFooter,
} from "./Utils/SteppedFormFooter";
import {
  getPeoplePickerValueKeys,
  toPeoplePickerFormValue,
} from "../PeoplePicker/PeoplePickerTypes";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import { VoidFunction } from "../../../Types/FunctionTypes";
import GenericObject from "../../../Types/GenericObject";
import HashedString from "../../../Types/HashedString";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Typeof from "../../../Types/Typeof";
import { FormikErrors, FormikProps } from "formik";
import React, {
  ForwardRefExoticComponent,
  Fragment,
  MutableRefObject,
  ReactElement,
  Ref,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import useAsyncEffect from "use-async-effect";

export type FormProps<T> = FormikProps<T>;
export type FormErrors<T> = FormikErrors<T>;

type DefaultValidateFunctionType = (
  values: FormValues<JSONObject>,
) => JSONObject;

export const DefaultValidateFunction: DefaultValidateFunctionType = (
  _values: FormValues<JSONObject>,
): JSONObject => {
  return {};
};

export interface FormSummaryConfig {
  enabled: boolean;
  defaultStepName?: string | undefined;
}

/*
 * What a form's ref offers beyond Formik's shape. A dialog that owns the
 * buttons (hideSubmitButton) drives the form through it.
 */
export interface BasicFormHandle {
  setFieldTouched: (fieldName: string, value: boolean) => void;
  setFieldValue: (fieldName: string, value: JSONValue) => void;
  /*
   * What Enter in a field does: validates the current step, then moves on -
   * or, on the last step, submits as submitAllSteps does.
   */
  submitForm: () => void;
  /*
   * Validates the current step, then moves on. Never submits: on the last
   * step it does nothing. What Next calls, so a second click that lands
   * after the last step opened cannot submit.
   */
  goToNextStep: () => void;
  /*
   * The form's action, which a stepped form offers on its last step only
   * (Utils/SteppedFormFooter.ts): validates every step and submits. A field
   * that fails sends the user to the first step it is on, with its error
   * showing. On a form without steps it validates the form and submits.
   */
  submitAllSteps: () => void;
}

export interface BaseComponentProps<T> {
  submitButtonStyleType?: ButtonStyleType | undefined;
  initialValues?: FormValues<T> | undefined;
  values?: FormValues<T> | undefined;
  onValidate?: undefined | ((values: FormValues<T>) => JSONObject);
  onChange?:
    | undefined
    | ((
        values: FormValues<T>,
        setNewFormValues: (newValues: FormValues<T>) => void,
      ) => void);
  fields: Fields<T>;
  steps?: undefined | Array<FormStep<T>>;
  submitButtonText?: undefined | string;
  title?: undefined | string;
  description?: undefined | string;
  showAsColumns?: undefined | number;
  isLoading?: undefined | boolean;
  id?: string | undefined;
  name?: string | undefined;
  onCancel?: undefined | (() => void) | null;
  cancelButtonText?: undefined | string | null;
  maxPrimaryButtonWidth?: undefined | boolean;
  disableAutofocus?: undefined | boolean;
  hideSubmitButton?: undefined | boolean;
  error?: string | undefined;
  onFormStepChange?: undefined | ((stepId: string) => void);
  /*
   * Whether the step on screen is the last one. A host that draws its own
   * buttons (hideSubmitButton) offers the form's action there only, and a
   * plain Next on every other step (Utils/SteppedFormFooter.ts).
   */
  onIsLastFormStep?: undefined | ((isLastFormStep: boolean) => void);
  onFormValidationErrorChanged?: ((hasError: boolean) => void) | undefined;
  showSubmitButtonOnlyIfSomethingChanged?: boolean | undefined;
  summary?: FormSummaryConfig | undefined;
  /*
   * Every step can be opened from the step list, not only the ones already
   * walked through. For a form whose steps are all filled in already - an
   * edit form - so a change on the third step does not mean clicking Next
   * twice to reach it, and the last step, where Save is, is one click away.
   * The action validates the steps the user skipped (submitAllSteps).
   */
  allowAnyStepNavigation?: boolean | undefined;
}

export interface ComponentProps<T extends GenericObject>
  extends BaseComponentProps<T> {
  onSubmit: (values: FormValues<T>, onSubmitSuccessful?: () => void) => void;
  footer: ReactElement;
}

const BasicForm: ForwardRefExoticComponent<any> = forwardRef(
  <T extends GenericObject>(
    props: ComponentProps<T>,
    ref: Ref<any>,
  ): ReactElement => {
    const { translateString } = useTranslateValue();
    const translator: Translator = useTranslator();
    const isSubmitting: MutableRefObject<boolean> = useRef(false);

    const [didSomethingChange, setDidSomethingChange] =
      useState<boolean>(false);

    /*
     * Read straight from the prop, never copied into state: a copy kept in
     * step by an effect lagged one render behind it, so a failed save drew
     * its error (props.error) while the fields were still disabled, and a
     * save that had just started still left the form enabled for that
     * render.
     */
    const isLoading: boolean | undefined = props.isLoading;

    const [formError, setFormError] = useState<string | null>(null);

    const [isDropdownOptionsLoading, setIsDropdownOptionsLoading] =
      useState<boolean>(false);

    const getFormSteps: () => Array<FormStep<T>> | undefined = () => {
      if (props.summary && props.summary.enabled) {
        // add to last step
        return [
          ...(props.steps || [
            {
              id: props.summary.defaultStepName || "basic",
              title: props.summary.defaultStepName || "Basic",
              isSummaryStep: false,
            },
          ]),
          {
            id: "summary",
            title: "Summary",
            isSummaryStep: true,
          },
        ];
      }
      return props.steps;
    };

    const [formSteps, setFormSteps] = useState<Array<FormStep<T>> | undefined>(
      getFormSteps(),
    );

    const isInitialValuesSet: MutableRefObject<boolean> = useRef(false);

    /*
     * Nothing may re-seed a form the user has already typed into. The guard
     * above latches once, which is enough on its own, but "the value the user
     * entered survives" is the one property of a form that must never quietly
     * regress - so it is asserted directly rather than inferred from the order
     * two effects happen to run in.
     */
    const hasUserEdited: MutableRefObject<boolean> = useRef(false);

    const refCurrentValue: React.MutableRefObject<FormValues<T>> = useRef(
      props.initialValues || {},
    );

    const getVisibleFormSteps: () => Array<FormStep<T>> | undefined = () => {
      return getFormSteps()?.filter((step: FormStep<T>): boolean => {
        return !step.showIf || step.showIf(refCurrentValue.current);
      });
    };

    const [currentFormStepId, setCurrentFormStepId] = useState<string | null>(
      null,
    );

    const activeStepIndex: number =
      formSteps?.findIndex((step: FormStep<T>) => {
        return step.id === currentFormStepId;
      }) ?? -1;
    const activeStep: FormStep<T> | undefined = formSteps?.[activeStepIndex];

    /*
     * Whether the step on screen is the last one, worked out on every render
     * from the values as they are now - not from the step list, which an
     * effect updates a frame later: an answer that brings a later step into
     * view takes the form's action away in the same pass, and one that hides
     * the steps after this one brings it in.
     *
     * Before the first step opens (a mount effect opens it) the form is about
     * to show its first step, so a form of several steps is not on its last
     * one yet: a host's footer starts on Next, never on the form's action.
     */
    const visibleFormSteps: Array<FormStep<T>> = getVisibleFormSteps() || [];

    const isOnLastFormStep: boolean =
      visibleFormSteps.length === 0 ||
      (currentFormStepId
        ? (visibleFormSteps[visibleFormSteps.length - 1] as FormStep<T>).id ===
          currentFormStepId
        : visibleFormSteps.length === 1);

    useEffect(() => {
      if (props.values) {
        refCurrentValue.current = props.values || {};
      }
    }, [props.values]);

    useEffect(() => {
      if (formSteps && formSteps.length > 0 && formSteps[0]) {
        setCurrentFormStepId(formSteps[0].id);
      }
    }, []);

    /*
     * A layout effect: a host that draws the buttons (a dialog's footer)
     * learns where the form is in the same pass that moved it, before
     * anything is painted. With a plain effect the footer said what the step
     * before wanted for a frame - long enough for a quick second click meant
     * as Next to land on the form's action, which the last step had just
     * brought in.
     */
    useLayoutEffect(() => {
      if (props.onIsLastFormStep) {
        props.onIsLastFormStep(isOnLastFormStep);
      }

      if (props.onFormStepChange && currentFormStepId) {
        props.onFormStepChange(currentFormStepId);
      }
    }, [currentFormStepId, formSteps, isOnLastFormStep]);

    const [currentValue, setCurrentValue] = useState<FormValues<T>>(
      props.initialValues || {},
    );

    const [errors, setErrors] = useState<Dictionary<string>>({});
    const [touched, setTouched] = useState<Dictionary<boolean>>({});
    const [validationAttempt, setValidationAttempt] = useState<number>(0);

    useEffect(() => {
      setFormSteps(getVisibleFormSteps());
    }, [refCurrentValue.current]);

    const [formFields, setFormFields] = useState<Fields<T>>([]);

    /*
     * Next on every step but the last; the form's action - its one primary
     * button - on the last step only (Utils/SteppedFormFooter.ts).
     */
    const footer: SteppedFormFooter = getSteppedFormFooter({
      hasSteps: visibleFormSteps.length > 0,
      isOnLastStep: isOnLastFormStep,
    });

    const actionText: string = props.submitButtonText || "Submit";

    const submitButtonText: string = translateString(actionText) ?? actionText;

    const nextButtonText: string =
      translateString(NEXT_BUTTON_TEXT) ?? NEXT_BUTTON_TEXT;

    const setFieldTouched: (fieldName: string, value: boolean) => void = (
      fieldName: string,
      value: boolean,
    ): void => {
      setTouched({ ...touched, [fieldName]: value });
    };

    const validate: (values: FormValues<T>) => Dictionary<string> = (
      values: FormValues<T>,
    ): Dictionary<string> => {
      const totalValidationErrors: Dictionary<string> = Validation.validate({
        values,
        formFields,
        currentFormStepId,
        onValidate: props.onValidate || undefined,
      });

      if (props.onFormValidationErrorChanged) {
        props.onFormValidationErrorChanged(
          Object.keys(totalValidationErrors).length !== 0,
        );
      }

      setErrors(totalValidationErrors);

      return totalValidationErrors;
    };

    useEffect(() => {
      setDidSomethingChange(true);
      validate(currentValue);
    }, [currentValue]);

    useImperativeHandle(ref, (): BasicFormHandle => {
      return {
        setFieldTouched,
        setFieldValue,
        submitForm,
        goToNextStep,
        submitAllSteps,
      };
    }, [
      currentValue,
      errors,
      touched,
      formFields,
      currentFormStepId,
      formSteps,
    ]);

    useAsyncEffect(async () => {
      const fields: Fields<T> = [
        ...props.fields.map((field: Field<T>) => {
          return {
            name: getFieldName(field),
            ...field,
          };
        }),
      ];

      for (const item of fields) {
        // if this field is not the current step.

        let shouldSkip: boolean = false;
        if (
          currentFormStepId &&
          item.stepId &&
          item.stepId !== currentFormStepId
        ) {
          shouldSkip = true;
        }

        if (
          props.summary?.enabled &&
          (!props.steps || props.steps.length === 0)
        ) {
          // if summary is enabled and no steps are provided, then all fields belong to the same step and should not be skipped.
          shouldSkip = false;
          item.stepId = props.summary.defaultStepName || "basic";
        }

        if (shouldSkip) {
          continue;
        }

        if (item.fetchDropdownOptions) {
          setIsDropdownOptionsLoading(true);
          // If a dropdown has fetch optiosn then we need to fetch them
          try {
            const options: Array<DropdownOption | DropdownOptionGroup> =
              await item.fetchDropdownOptions(refCurrentValue.current);
            /*
             * The field's own list replaces the one the form fetched for its
             * dropdown model, but never the colours that list carried: a
             * state picked from a re-sorted list still shows its colour.
             */
            item.dropdownOptions = DropdownUtil.keepKnownOptionColors(
              options,
              item.dropdownOptions,
            );
          } catch (err) {
            setFormError(API.getFriendlyMessage(err));
          }
        }
      }

      setIsDropdownOptionsLoading(false);

      setFormFields(fields);
    }, [props.fields, currentFormStepId]);

    /*
     * A field is only worth disabling while options are being fetched if it is
     * one of the fields those options belong to. Disabling everything meant a
     * Text or Email field went read-only because some unrelated dropdown was
     * refreshing - and Input renders `disabled` as `readOnly`, so it stays
     * focusable and simply swallows the keystrokes with no visible reason.
     */
    type IsDropdownFieldFunction = (field: Field<T>) => boolean;

    const isDropdownField: IsDropdownFieldFunction = (
      field: Field<T>,
    ): boolean => {
      return (
        field.fieldType === FormFieldSchemaType.Dropdown ||
        field.fieldType === FormFieldSchemaType.MultiSelectDropdown
      );
    };

    type GetFieldNameFunction = (field: Field<T>) => string;

    const getFieldName: GetFieldNameFunction = (field: Field<T>): string => {
      const fieldName: string = field.overrideFieldKey
        ? field.overrideFieldKey
        : (Object.keys(field.field || {})[0] as string);

      return fieldName;
    };

    const setAllTouched: VoidFunction = (): void => {
      const touchedObj: Dictionary<boolean> = {};

      for (const field of formFields) {
        if (
          currentFormStepId &&
          field.stepId &&
          field.stepId !== currentFormStepId
        ) {
          continue;
        }

        touchedObj[field.name!] = true;
      }

      setTouched({ ...touched, ...touchedObj });
    };

    const setFieldValue: (fieldName: string, value: JSONValue) => void = (
      fieldName: string,
      value: JSONValue,
    ): void => {
      const updatedValue: FormValues<T> = {
        ...refCurrentValue.current,
        [fieldName]: value as any,
      };

      hasUserEdited.current = true;

      refCurrentValue.current = updatedValue;

      setCurrentValue(refCurrentValue.current);

      if (props.onChange && isInitialValuesSet.current) {
        props.onChange(refCurrentValue.current, (values: FormValues<T>) => {
          refCurrentValue.current = values;
          setCurrentValue(refCurrentValue.current);
        });
      }
    };

    /*
     * A field's footer setting the field's value (FieldFooterProps): the way
     * FormField stores a pick - the field's own onChange first, with the
     * values as they are and, for a dropdown, what the pick changed as its
     * options name it (DropdownChange) - then the value itself.
     */
    const setFieldValueFromFooter: (
      field: Field<T>,
      fieldName: string,
      value: JSONValue,
    ) => void = (
      field: Field<T>,
      fieldName: string,
      value: JSONValue,
    ): void => {
      if (field.onChange) {
        field.onChange(
          value,
          refCurrentValue.current,
          (values: FormValues<T>) => {
            refCurrentValue.current = values;
            setCurrentValue(refCurrentValue.current);
          },
          isDropdownField(field)
            ? getDropdownChange({
                options: field.dropdownOptions,
                value: value,
                previousValue: (
                  refCurrentValue.current as Record<string, unknown>
                )[fieldName],
              })
            : undefined,
        );
      }

      setFieldValue(fieldName, value);
    };

    /*
     * Hands the form's values to onSubmit, normalised for the API. Called once
     * every step that is going to be validated has been.
     */
    const submitValues: () => void = (): void => {
      const values: FormValues<T> = refCurrentValue.current;

      for (const field of formFields) {
        if (field.fieldType === FormFieldSchemaType.Toggle) {
          const fieldName: string = field.name!;
          if (!(values as any)[fieldName]) {
            (values as any)[fieldName] = false;
          }
        }

        if (field.fieldType === FormFieldSchemaType.Email) {
          const fieldName: string = field.name!;
          if ((values as any)[fieldName]) {
            (values as any)[fieldName] = ((values as any)[fieldName] as string)
              .toString()
              .toLowerCase();
          }
        }

        if (field.fieldType === FormFieldSchemaType.MultiSelectDropdown) {
          const fieldName: string = field.name!;

          if (
            (values as any)[fieldName] &&
            (values as any)[fieldName].length > 0 &&
            (values as any)[fieldName][0]["value"]
          ) {
            (values as any)[fieldName] = (
              (values as any)[fieldName] as Array<DropdownOption>
            ).map((item: DropdownOption) => {
              return item.value;
            });
          }
        }

        if (field.fieldType === FormFieldSchemaType.Dropdown) {
          const fieldName: string = field.name!;
          if (
            (values as any)[fieldName] &&
            (values as any)[fieldName]["value"]
          ) {
            (values as any)[fieldName] = (values as any)[fieldName]["value"];
          }
        }

        if (field.fieldType === FormFieldSchemaType.Password) {
          const fieldName: string = field.name!;
          if (
            (values as any)[fieldName] &&
            typeof (values as any)[fieldName] === Typeof.String
          ) {
            (values as any)[fieldName] = new HashedString(
              (values as any)[fieldName],
              false,
            );
          }
        }
      }

      const analyticsName: string | undefined = FormAnalyticsName.resolve(
        props.name,
      );

      /*
       * Unnamed forms are embedded sub-forms (filter builders, argument
       * editors) rather than conversions. Skip them instead of reporting an
       * event named after a missing prop.
       */
      if (analyticsName) {
        UiAnalytics.capture("FORM SUBMIT: " + analyticsName);
      }

      props.onSubmit(values, () => {
        setDidSomethingChange(false);
      });
    };

    /*
     * Checks the step on screen, then walks on to the next one. On the last
     * step it submits, unless told not to - after checking every step, as
     * the form's action does - and a form without steps submits once it is
     * checked.
     */
    const validateStepAndWalkOn: (data: {
      submitOnLastStep: boolean;
    }) => void = (data: { submitOnLastStep: boolean }): void => {
      setValidationAttempt((attempt: number) => {
        return attempt + 1;
      });
      setAllTouched();

      const validationErrors: Dictionary<string> = validate(
        refCurrentValue.current,
      );

      isSubmitting.current = true;

      if (Object.keys(validationErrors).length > 0) {
        // errors on form, do not submit.
        return;
      }

      // Use current values because conditional-step state can lag a field edit.

      const steps: Array<FormStep<T>> | undefined = getVisibleFormSteps();

      if (currentFormStepId === null || !steps || steps.length === 0) {
        if (data.submitOnLastStep) {
          submitValues();
        }
        return;
      }

      if ((steps[steps.length - 1] as FormStep<T>).id === currentFormStepId) {
        if (data.submitOnLastStep) {
          submitAllSteps();
        }
      } else {
        const currentStepIndex: number = steps.findIndex(
          (step: FormStep<T>) => {
            return step.id === currentFormStepId;
          },
        );

        if (currentStepIndex > -1) {
          setCurrentFormStepId((steps[currentStepIndex + 1] as FormStep<T>).id);
        }
      }
    };

    const submitForm: () => void = (): void => {
      validateStepAndWalkOn({ submitOnLastStep: true });
    };

    const goToNextStep: () => void = (): void => {
      validateStepAndWalkOn({ submitOnLastStep: false });
    };

    const submitAllSteps: () => void = (): void => {
      const steps: Array<FormStep<T>> | undefined = getVisibleFormSteps();

      if (!steps || steps.length === 0 || currentFormStepId === null) {
        validateStepAndWalkOn({ submitOnLastStep: true });
        return;
      }

      setValidationAttempt((attempt: number) => {
        return attempt + 1;
      });

      /*
       * Every field on a step the user can reach - a step hidden by its
       * showIf is not one, and neither are its fields - validated as if it
       * were the step on screen.
       */
      const fieldsOnVisibleSteps: Fields<T> = formFields.filter(
        (field: Field<T>): boolean => {
          return steps.some((step: FormStep<T>): boolean => {
            return step.id === field.stepId;
          });
        },
      );

      const validationErrors: Dictionary<string> = Validation.validate({
        values: refCurrentValue.current,
        formFields: fieldsOnVisibleSteps,
        currentFormStepId: null,
        onValidate: props.onValidate || undefined,
      });

      if (props.onFormValidationErrorChanged) {
        props.onFormValidationErrorChanged(
          Object.keys(validationErrors).length !== 0,
        );
      }

      isSubmitting.current = true;

      const failingFieldNames: Array<string> = Object.keys(validationErrors);

      if (failingFieldNames.length === 0) {
        submitValues();
        return;
      }

      // Show every failing field's error, on whichever step it is.
      const touchedFields: Dictionary<boolean> = {};

      for (const fieldName of failingFieldNames) {
        touchedFields[fieldName] = true;
      }

      setTouched({ ...touched, ...touchedFields });
      setErrors(validationErrors);

      // And go to the first step that has one, unless the user is on it.
      const firstStepWithAnError: FormStep<T> | undefined = steps.find(
        (step: FormStep<T>): boolean => {
          return fieldsOnVisibleSteps.some((field: Field<T>): boolean => {
            return (
              field.stepId === step.id &&
              failingFieldNames.includes(getFieldName(field))
            );
          });
        },
      );

      if (
        firstStepWithAnError &&
        firstStepWithAnError.id !== currentFormStepId
      ) {
        setCurrentFormStepId(firstStepWithAnError.id);
      }
    };

    useEffect(() => {
      if (isSubmitting.current) {
        return;
      }

      if (isInitialValuesSet.current) {
        return;
      }

      /*
       * A field wrote a value before the defaults were filled in: a custom
       * element that reports what it holds as soon as it is drawn (its
       * effect runs before this one). Nothing it wrote, and nothing typed,
       * is re-seeded - the form keeps every value it holds - but the fields
       * still empty get their defaults, as they would have without it.
       * Skipping them drew a switch on (its default) and sent it off, and
       * never sent a hidden field's default at all.
       */
      if (hasUserEdited.current) {
        if (formFields.length === 0) {
          return;
        }

        const filledIn: FormValues<T> = {
          ...refCurrentValue.current,
        } as FormValues<T>;
        let didFillIn: boolean = false;

        for (const field of formFields) {
          const fieldName: string = field.name!;

          if ((filledIn as any)[fieldName] !== undefined) {
            continue;
          }

          if (field.defaultValue) {
            (filledIn as any)[fieldName] = field.defaultValue;
            didFillIn = true;
          } else if (field.getDefaultValue) {
            (filledIn as any)[fieldName] = field.getDefaultValue(filledIn);
            didFillIn = true;
          }
        }

        isInitialValuesSet.current = true;

        if (didFillIn) {
          refCurrentValue.current = filledIn;
          setCurrentValue(refCurrentValue.current);
        }

        return;
      }

      const values: FormValues<T> = {
        ...props.initialValues,
      } as FormValues<T>;
      for (const field of formFields) {
        const fieldName: string = field.name!;

        if (
          field.fieldType === FormFieldSchemaType.Date &&
          (values as any)[fieldName]
        ) {
          (values as any)[fieldName] = OneUptimeDate.asDateForDatabaseQuery(
            (values as any)[fieldName],
          );
        }

        if (
          field.fieldType === FormFieldSchemaType.Dropdown &&
          (values as any)[fieldName]
        ) {
          const flatDropdownOptions: Array<DropdownOption> =
            field.dropdownOptions?.flatMap(
              (item: DropdownOption | DropdownOptionGroup) => {
                if (
                  "options" in item &&
                  Array.isArray((item as DropdownOptionGroup).options)
                ) {
                  return (item as DropdownOptionGroup).options;
                }
                return [item as DropdownOption];
              },
            ) || [];

          /*
           * An ObjectID initial value arrives as an instance while options
           * hold the string form, so canonicalize once — before comparing and
           * before storing back.
           */
          let normalizedValue: DropdownValue = (values as any)[fieldName];

          if ((normalizedValue as any) instanceof ObjectID) {
            normalizedValue = normalizedValue.toString();
          }

          const dropdownOption: DropdownOption | undefined =
            flatDropdownOptions.find((option: DropdownOption) => {
              return option.value === normalizedValue;
            });

          /*
           * Keep the stored value when no option matches; do not null it.
           * Submit sends every selected field, so a value wiped here is PUT
           * back as null and clears a column the user never touched. Options
           * legitimately fail to contain a valid value: a permission-scoped
           * or truncated entity list, a failed options fetch, or a column
           * holding a spelling the options don't list verbatim. An unmatched
           * value renders as the placeholder either way, so preserving costs
           * nothing visually and stops the form destroying data it can't
           * display.
           */
          (values as any)[fieldName] = dropdownOption
            ? dropdownOption.value
            : normalizedValue;
        }

        if (
          field.fieldType === FormFieldSchemaType.MultiSelectDropdown &&
          (values as any)[fieldName]
        ) {
          /*
           * Options can be loaded lazily for a later step or omit entities the
           * user cannot browse. Preserve every stored selection just as a single
           * dropdown does; an option list is not an authorization to clear IDs.
           */
          (values as any)[fieldName] = (
            (values as any)[fieldName] as Array<DropdownValue | ObjectID>
          ).map((value: DropdownValue | ObjectID): DropdownValue => {
            return value instanceof ObjectID ? value.toString() : value;
          });
        }

        /*
         * A people picker keeps its picks in form values of its own (owners
         * in ownerUsers and ownerTeams). Whatever the form started with -
         * ObjectIDs, related rows, ids - is held as plain ids, which is what
         * the picker writes, so an untouched picker sends what it shows. A
         * picker that takes one pick holds one id: an edit form's userId
         * column arrives as an ObjectID and is sent back as its id.
         */
        if (
          field.fieldType === FormFieldSchemaType.PeoplePicker &&
          field.peoplePicker
        ) {
          for (const valueKey of getPeoplePickerValueKeys(field.peoplePicker)) {
            const startValue: unknown = (values as any)[valueKey];

            if (startValue !== undefined && startValue !== null) {
              (values as any)[valueKey] = toPeoplePickerFormValue(
                field.peoplePicker,
                startValue,
              );
            }
          }
        }

        // if the field is still null but has a default value then... have the default initial value
        if (field.defaultValue && (values as any)[fieldName] === undefined) {
          (values as any)[fieldName] = field.defaultValue;
        }

        if (field.getDefaultValue && (values as any)[fieldName] === undefined) {
          (values as any)[fieldName] = field.getDefaultValue(values);
        }
      }

      /*
       * Latch only once the field list has actually arrived. formFields starts
       * empty and is filled in by an effect, so latching before then would
       * skip every default value and every dropdown/date normalisation above.
       * (This used to be written as an assignment inside the loop, which had
       * the same effect by accident.)
       */
      if (formFields.length > 0) {
        isInitialValuesSet.current = true;
      }

      refCurrentValue.current = values;
      setCurrentValue(refCurrentValue.current);
    }, [props.initialValues, formFields]);

    const primaryButtonStyle: React.CSSProperties = {};

    if (props.maxPrimaryButtonWidth) {
      primaryButtonStyle.marginLeft = "0px";
      primaryButtonStyle.width = "100%";
    }

    if (formError) {
      return <ErrorMessage message={formError} />;
    }

    let showSubmitButton: boolean = !props.hideSubmitButton;

    if (props.showSubmitButtonOnlyIfSomethingChanged && didSomethingChange) {
      showSubmitButton = true;
    }

    /*
     * Next, on every step but the last, where the form's action will be.
     * Plain, like Cancel: Next commits nothing, so it never wears the
     * primary colour (Utils/SteppedFormFooter.ts). Where the action spans
     * the form (a status page's Subscribe), Next spans it too.
     */
    const nextButtonElement: ReactElement | null =
      showSubmitButton && footer.showNextButton ? (
        <div
          className="mt-3"
          style={{
            width: props.maxPrimaryButtonWidth ? "100%" : "auto",
          }}
        >
          <Button
            title={nextButtonText}
            dataTestId={FORM_NEXT_BUTTON_TEST_ID}
            id={`${props.id}-next-button`}
            onClick={() => {
              goToNextStep();
            }}
            disabled={isLoading || isDropdownOptionsLoading || false}
            buttonStyle={NEXT_BUTTON_STYLE}
            style={primaryButtonStyle}
          />
        </div>
      ) : null;

    /*
     * The step list - the Progress list beside the form and, on a narrow
     * screen, "Step 1 of 3" above it - is drawn only while there is more
     * than one step to walk. A form whose steps come down to one, the
     * others hidden by their showIf (a Server ingestion key's Browser
     * Settings step), is the one page it is, not "Step 1 of 1". A step
     * shown later brings the list back.
     */
    const showsStepList: boolean = Boolean(
      currentFormStepId && formSteps && formSteps.length > 1,
    );

    return (
      <div className="row" id={props.id}>
        <div className="col-lg-1">
          <div>
            {props.title && (
              <h1 className="text-lg text-gray-700 mt-5">
                {translateString(props.title) ?? props.title}
              </h1>
            )}

            {Boolean(props.description) && (
              <div className="text-sm text-gray-500 mb-5">
                {typeof props.description === "string"
                  ? translateString(props.description) ?? props.description
                  : props.description}
              </div>
            )}

            <div className="flex">
              {showsStepList && formSteps && currentFormStepId && (
                <div
                  style={{ flex: "0 1 auto" }}
                  className="mr-10 max-lg:hidden lg:block"
                >
                  {/* Form Steps */}

                  <Steps
                    currentFormStepId={currentFormStepId}
                    steps={formSteps}
                    formValues={refCurrentValue.current}
                    allowAnyStep={props.allowAnyStepNavigation || false}
                    onClick={(step: FormStep<T>) => {
                      setCurrentFormStepId(step.id);
                    }}
                  />
                </div>
              )}
              <div
                className={`${showsStepList ? "w-auto pt-6" : "w-full pt-1"}`}
                style={{ flex: "1 1 auto" }}
              >
                {showsStepList && activeStep && (
                  <div className="mb-5 flex items-center justify-between gap-3 lg:hidden">
                    <p
                      className="ml-auto text-right text-sm text-gray-500 lg:hidden"
                      role="status"
                    >
                      {translator.translateTemplate(
                        "Step {{current}} of {{total}}",
                        {
                          current: activeStepIndex + 1,
                          total: formSteps?.length || 0,
                        },
                      )}
                      <span className="block font-medium text-gray-900">
                        {translateString(activeStep.title) ?? activeStep.title}
                      </span>
                    </p>
                  </div>
                )}
                {props.error && (
                  <div className="mb-3">
                    <Alert title={props.error} type={AlertType.DANGER} />
                  </div>
                )}

                <div>
                  {(() => {
                    const currentStep: FormStep<T> | undefined =
                      formSteps?.find((step: FormStep<T>) => {
                        return step.id === currentFormStepId;
                      });
                    const activeColumns: number =
                      currentStep?.columns || props.showAsColumns || 1;
                    const fullRowSpan: string = `md:col-span-${activeColumns}`;
                    const visibleFields: Fields<T> = formFields.filter(
                      (field: Field<T>): boolean => {
                        return (
                          (!currentFormStepId ||
                            field.stepId === currentFormStepId) &&
                          (!field.showIf ||
                            field.showIf(refCurrentValue.current))
                        );
                      },
                    );
                    const fieldGroups: Array<Fields<T>> = [];

                    for (const field of visibleFields) {
                      const previousGroup: Fields<T> | undefined =
                        fieldGroups[fieldGroups.length - 1];
                      if (
                        field.collapsibleSection &&
                        previousGroup?.[0]?.collapsibleSection?.id ===
                          field.collapsibleSection.id
                      ) {
                        previousGroup.push(field);
                      } else {
                        fieldGroups.push([field]);
                      }
                    }

                    const renderField: (
                      field: Field<T>,
                      index: number,
                    ) => ReactElement = (
                      field: Field<T>,
                      index: number,
                    ): ReactElement => {
                      const fieldName: string = getFieldName(field);
                      return (
                        <Fragment key={fieldName}>
                          {field.sectionTitle && (
                            <div
                              className={`${fullRowSpan} mt-4 pt-5 first:mt-0 first:pt-0 border-t first:border-t-0 border-gray-200`}
                            >
                              <h3 className="text-base font-semibold text-gray-900">
                                {translateString(field.sectionTitle) ??
                                  field.sectionTitle}
                              </h3>
                              {field.sectionDescription && (
                                <p className="mt-1 text-sm text-gray-500">
                                  {typeof field.sectionDescription === "string"
                                    ? translateString(
                                        field.sectionDescription,
                                      ) ?? field.sectionDescription
                                    : field.sectionDescription}
                                </p>
                              )}
                            </div>
                          )}
                          <div
                            className={
                              field.spanFullRow ? fullRowSpan : undefined
                            }
                          >
                            <FormField<T>
                              field={field}
                              fieldName={fieldName}
                              index={index}
                              error={errors[fieldName] || ""}
                              touched={touched[fieldName] || false}
                              isDisabled={
                                isLoading ||
                                (isDropdownOptionsLoading &&
                                  isDropdownField(field)) ||
                                false
                              }
                              currentValues={refCurrentValue.current}
                              setFieldValue={setFieldValue}
                              setFieldTouched={setFieldTouched}
                              submitForm={submitForm}
                              disableAutofocus={props.disableAutofocus || false}
                              setFormValues={(values: FormValues<T>) => {
                                refCurrentValue.current = values;
                                setCurrentValue(refCurrentValue.current);
                              }}
                            />
                            {field.footerElement}
                            {field.getFooterElement &&
                              field.getFooterElement(
                                refCurrentValue.current,
                                touched[fieldName]
                                  ? errors[fieldName] || undefined
                                  : undefined,
                                {
                                  setValue: (value: JSONValue): void => {
                                    setFieldValueFromFooter(
                                      field,
                                      fieldName,
                                      value,
                                    );
                                  },
                                },
                              )}
                          </div>
                        </Fragment>
                      );
                    };
                    let fieldIndex: number = 0;

                    return (
                      <div
                        className={`grid md:grid-cols-${activeColumns} grid-cols-1 gap-x-4 gap-y-3`}
                      >
                        {fieldGroups.map((group: Fields<T>): ReactElement => {
                          const firstField: Field<T> = group[0]!;
                          const fields: Array<ReactElement> = group.map(
                            (field: Field<T>): ReactElement => {
                              return renderField(field, fieldIndex++);
                            },
                          );

                          if (!firstField.collapsibleSection) {
                            return fields[0]!;
                          }

                          const section: FormFieldCollapsibleSection<T> =
                            firstField.collapsibleSection;

                          /*
                           * The section's own answer, or - without one -
                           * whether a field in it that is on screen holds a
                           * value other than empty or its default.
                           */
                          const isSectionConfigured: boolean =
                            isFormSectionConfigured({
                              section: section,
                              fields: group,
                              values: refCurrentValue.current,
                            });

                          return (
                            <CollapsibleFormSection
                              key={`${section.id}-${getFieldName(firstField)}`}
                              title={section.title}
                              description={section.description}
                              sectionId={section.id}
                              isConfigured={isSectionConfigured}
                              openWhenConfigured={
                                section.openWhenConfigured !== false
                              }
                              summary={section.getSummary?.(
                                refCurrentValue.current,
                              )}
                              /*
                               * What the folded header lists: the fields on
                               * screen, the set ones with what they are set
                               * to.
                               */
                              items={getFoldedFormFieldItems(
                                group,
                                refCurrentValue.current,
                                { isSectionConfigured: isSectionConfigured },
                              )}
                              listFieldsWhileFolded={Boolean(
                                section.listFieldsWhileFolded,
                              )}
                              icon={section.icon}
                              hasError={group.some(
                                (field: Field<T>): boolean => {
                                  const fieldName: string = getFieldName(field);
                                  return Boolean(
                                    touched[fieldName] && errors[fieldName],
                                  );
                                },
                              )}
                              validationAttempt={validationAttempt}
                              className={fullRowSpan}
                            >
                              <div
                                className={`grid md:grid-cols-${activeColumns} grid-cols-1 gap-x-4 gap-y-3`}
                              >
                                {fields}
                              </div>
                            </CollapsibleFormSection>
                          );
                        })}

                        {/* If Summary, show Model detail  */}

                        {currentFormStepId === "summary" && (
                          <FormSummary
                            formValues={refCurrentValue.current}
                            formFields={formFields}
                            formSteps={formSteps || undefined}
                          />
                        )}
                      </div>
                    );
                  })()}
                </div>

                <div className="flex w-full justify-end">
                  {nextButtonElement}
                  {showSubmitButton && footer.showActionButton && (
                    <div
                      className="mt-3"
                      style={{
                        width: props.maxPrimaryButtonWidth ? "100%" : " auto",
                      }}
                    >
                      <Button
                        title={submitButtonText}
                        dataTestId={props.submitButtonText!}
                        onClick={() => {
                          // Checks every step, and opens one with a problem.
                          submitAllSteps();
                        }}
                        id={`${props.id}-submit-button`}
                        isLoading={
                          isLoading || isDropdownOptionsLoading || false
                        }
                        buttonStyle={
                          props.submitButtonStyleType || ButtonStyleType.PRIMARY
                        }
                        style={primaryButtonStyle}
                      />
                    </div>
                  )}
                  {props.onCancel && (
                    <div>
                      <Button
                        title={
                          translateString(props.cancelButtonText || "Cancel") ??
                          (props.cancelButtonText || "Cancel")
                        }
                        type={ButtonTypes.Button}
                        id={`${props.id}-cancel-button`}
                        disabled={
                          isLoading || isDropdownOptionsLoading || false
                        }
                        buttonStyle={ButtonStyleType.NORMAL}
                        onClick={() => {
                          props.onCancel?.();
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
            {props.footer}
          </div>
        </div>
      </div>
    );
  },
);

BasicForm.displayName = "BasicForm";

export default BasicForm;
