import API from "../../Utils/API/API";
import UiAnalytics from "../../Utils/Analytics";
import Alert, { AlertType } from "../Alerts/Alert";
import Button, { ButtonStyleType } from "../Button/Button";
import ButtonTypes from "../Button/ButtonTypes";

import { DropdownOption, DropdownValue } from "../Dropdown/Dropdown";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import FormField from "./Fields/FormField";
import FormSummary from "./FormSummary";
import Steps from "./Steps/Steps";
import Field from "./Types/Field";
import Fields from "./Types/Fields";
import FormFieldSchemaType from "./Types/FormFieldSchemaType";
import { FormStep } from "./Types/FormStep";
import FormValues from "./Types/FormValues";
import Validation from "./Validation";
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
  MutableRefObject,
  ReactElement,
  Ref,
  forwardRef,
  useEffect,
  useImperativeHandle,
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
  onIsLastFormStep?: undefined | ((isLastFormStep: boolean) => void);
  onFormValidationErrorChanged?: ((hasError: boolean) => void) | undefined;
  showSubmitButtonOnlyIfSomethingChanged?: boolean | undefined;
  summary?: FormSummaryConfig | undefined;
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
    const isSubmitting: MutableRefObject<boolean> = useRef(false);

    const [didSomethingChange, setDidSomethingChange] =
      useState<boolean>(false);

    const [isLoading, setIsLoading] = useState<boolean | undefined>(
      props.isLoading,
    );

    const [formError, setFormError] = useState<string | null>(null);

    const [isDropdownOptionsLoading, setIsDropdownOptionsLoading] =
      useState<boolean>(false);

    useEffect(() => {
      setIsLoading(props.isLoading);
    }, [props.isLoading]);

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

    const [submitButtonText, setSubmitButtonText] = useState<string>(
      props.submitButtonText || "Submit",
    );

    const [formSteps, setFormSteps] = useState<Array<FormStep<T>> | undefined>(
      getFormSteps(),
    );

    const isInitialValuesSet: MutableRefObject<boolean> = useRef(false);

    const refCurrentValue: React.MutableRefObject<FormValues<T>> = useRef(
      props.initialValues || {},
    );

    const [currentFormStepId, setCurrentFormStepId] = useState<string | null>(
      null,
    );

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

    useEffect(() => {
      // if last step,

      if (
        formSteps &&
        formSteps.length > 0 &&
        ((formSteps as Array<FormStep<T>>)[formSteps.length - 1] as FormStep<T>)
          .id === currentFormStepId
      ) {
        setSubmitButtonText(props.submitButtonText || "Submit");
        if (props.onIsLastFormStep) {
          props.onIsLastFormStep(true);
        }
      } else {
        setSubmitButtonText("Next");
        if (props.onIsLastFormStep) {
          props.onIsLastFormStep(false);
        }
      }

      if (props.onFormStepChange && currentFormStepId) {
        props.onFormStepChange(currentFormStepId);
      }

      if (!currentFormStepId) {
        setSubmitButtonText(props.submitButtonText || "Submit");
        if (props.onIsLastFormStep) {
          props.onIsLastFormStep(true);
        }
      }
    }, [currentFormStepId, formSteps]);

    const [currentValue, setCurrentValue] = useState<FormValues<T>>(
      props.initialValues || {},
    );

    const [errors, setErrors] = useState<Dictionary<string>>({});
    const [touched, setTouched] = useState<Dictionary<boolean>>({});

    useEffect(() => {
      setFormSteps(
        getFormSteps()?.filter((step: FormStep<T>) => {
          if (!step.showIf) {
            return true;
          }

          return step.showIf(refCurrentValue.current);
        }),
      );
    }, [refCurrentValue.current]);

    const [formFields, setFormFields] = useState<Fields<T>>([]);

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

    useImperativeHandle(ref, () => {
      return {
        setFieldTouched,
        setFieldValue,
        submitForm,
      };
    }, [currentValue, errors, touched, formFields]);

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
            const options: Array<DropdownOption> =
              await item.fetchDropdownOptions(refCurrentValue.current);
            item.dropdownOptions = options;
          } catch (err) {
            setFormError(API.getFriendlyMessage(err));
          }
        }
      }

      setIsDropdownOptionsLoading(false);

      setFormFields(fields);
    }, [props.fields, currentFormStepId]);

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

      refCurrentValue.current = updatedValue;

      setCurrentValue(refCurrentValue.current);

      if (props.onChange && isInitialValuesSet.current) {
        props.onChange(refCurrentValue.current, (values: FormValues<T>) => {
          refCurrentValue.current = values;
          setCurrentValue(refCurrentValue.current);
        });
      }
    };

    const submitForm: () => void = (): void => {
      // check for any boolean values and if they don't exist in values - mark them as false.

      setAllTouched();

      const validationErrors: Dictionary<string> = validate(
        refCurrentValue.current,
      );

      isSubmitting.current = true;

      if (Object.keys(validationErrors).length > 0) {
        // errors on form, do not submit.
        return;
      }

      // if last step then submit.

      if (
        (formSteps &&
          formSteps.length > 0 &&
          (
            (formSteps as Array<FormStep<T>>)[
              formSteps.length - 1
            ] as FormStep<T>
          ).id === currentFormStepId) ||
        currentFormStepId === null
      ) {
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
              (values as any)[fieldName] = (
                (values as any)[fieldName] as string
              )
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

        UiAnalytics.capture("FORM SUBMIT: " + props.name);

        props.onSubmit(values, () => {
          setDidSomethingChange(false);
        });
      } else if (formSteps && formSteps.length > 0) {
        const steps: Array<FormStep<T>> = formSteps;

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

    useEffect(() => {
      if (isSubmitting.current) {
        return;
      }

      if (isInitialValuesSet.current) {
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
          const dropdownOption: DropdownOption | undefined =
            field.dropdownOptions?.find((option: DropdownOption) => {
              let valueToCompare: DropdownValue = (values as any)[fieldName];

              if ((valueToCompare as any) instanceof ObjectID) {
                valueToCompare = valueToCompare.toString();
              }

              return option.value === valueToCompare;
            });

          (values as any)[fieldName] = dropdownOption?.value || null;
        }

        if (
          field.fieldType === FormFieldSchemaType.MultiSelectDropdown &&
          (values as any)[fieldName]
        ) {
          const dropdownOptions: Array<DropdownOption> =
            field.dropdownOptions?.filter((option: DropdownOption) => {
              let valueToCompare: Array<DropdownValue> = [
                ...(values as any)[fieldName],
              ];

              valueToCompare = valueToCompare.map((item: DropdownValue) => {
                if ((item as any) instanceof ObjectID) {
                  return item.toString();
                }

                return item;
              });

              return valueToCompare.includes(option.value);
            }) || [];

          (values as any)[fieldName] = dropdownOptions.map(
            (option: DropdownOption) => {
              return option.value;
            },
          );
        }

        // if the field is still null but has a default value then... have the default initial value
        if (field.defaultValue && (values as any)[fieldName] === undefined) {
          (values as any)[fieldName] = field.defaultValue;
        }

        if (field.getDefaultValue && (values as any)[fieldName] === undefined) {
          (values as any)[fieldName] = field.getDefaultValue(values);
        }

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

    return (
      <div className="row">
        <div className="col-lg-1">
          <div>
            {props.title && (
              <h1 className="text-lg text-gray-700 mt-5">{props.title}</h1>
            )}

            {Boolean(props.description) && (
              <div className="text-sm text-gray-500 mb-5">
                {props.description}
              </div>
            )}

            <div className="flex">
              {formSteps && currentFormStepId && (
                <div
                  style={{ flex: "0 1 auto" }}
                  className="mr-10 hidden lg:block"
                >
                  {/* Form Steps */}

                  <Steps
                    currentFormStepId={currentFormStepId}
                    steps={formSteps}
                    formValues={refCurrentValue.current}
                    onClick={(step: FormStep<T>) => {
                      setCurrentFormStepId(step.id);
                    }}
                  />
                </div>
              )}
              <div
                className={`${
                  formSteps && currentFormStepId ? "w-auto pt-6" : "w-full pt-1"
                }`}
                style={{ flex: "1 1 auto" }}
              >
                {props.error && (
                  <div className="mb-3">
                    <Alert title={props.error} type={AlertType.DANGER} />
                  </div>
                )}

                <div>
                  <div
                    className={`grid md:grid-cols-${
                      props.showAsColumns || 1
                    } grid-cols-1 gap-4`}
                  >
                    {formFields &&
                      formFields
                        .filter((field: Field<T>) => {
                          if (currentFormStepId) {
                            return field.stepId === currentFormStepId;
                          }

                          return true;
                        })
                        .filter((field: Field<T>) => {
                          const currentValues: FormValues<T> =
                            refCurrentValue.current;
                          if (field.showIf && !field.showIf(currentValues)) {
                            return false;
                          }

                          return true;
                        })
                        .map((field: Field<T>, i: number) => {
                          return (
                            <div
                              key={getFieldName(field)}
                              className={
                                field.spanFullRow
                                  ? `md:col-span-${props.showAsColumns || 1}`
                                  : undefined
                              }
                            >
                              {
                                <FormField<T>
                                  field={field}
                                  fieldName={getFieldName(field)}
                                  index={i}
                                  error={errors[getFieldName(field)] || ""}
                                  touched={
                                    touched[getFieldName(field)] || false
                                  }
                                  isDisabled={
                                    isLoading ||
                                    isDropdownOptionsLoading ||
                                    false
                                  }
                                  currentValues={refCurrentValue.current}
                                  setFieldValue={setFieldValue}
                                  setFieldTouched={setFieldTouched}
                                  submitForm={submitForm}
                                  disableAutofocus={
                                    props.disableAutofocus || false
                                  }
                                  setFormValues={(values: FormValues<T>) => {
                                    refCurrentValue.current = values;
                                    setCurrentValue(refCurrentValue.current);
                                  }}
                                />
                              }
                              {field.footerElement}
                              {field.getFooterElement &&
                                field.getFooterElement(refCurrentValue.current)}
                            </div>
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
                </div>

                <div className="flex w-full justify-end">
                  {showSubmitButton && (
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
                          submitForm();
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
                        title={props.cancelButtonText || "Cancel"}
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
