import React, {
    forwardRef,
    ForwardRefExoticComponent,
    MutableRefObject,
    ReactElement,
    Ref,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from 'react';
import Button, { ButtonStyleType } from '../Button/Button';
import FormValues from './Types/FormValues';
import Fields from './Types/Fields';
import ButtonTypes from '../Button/ButtonTypes';
import { JSONObject, JSONValue } from 'Common/Types/JSON';
import FormFieldSchemaType from './Types/FormFieldSchemaType';
import Alert, { AlertType } from '../Alerts/Alert';
import { DropdownOption } from '../Dropdown/Dropdown';
import OneUptimeDate from 'Common/Types/Date';
import HashedString from 'Common/Types/HashedString';
import Typeof from 'Common/Types/Typeof';
import UiAnalytics from '../../Utils/Analytics';
import Dictionary from 'Common/Types/Dictionary';
import Field from './Types/Field';
import { FormStep } from './Types/FormStep';
import Steps from './Steps/Steps';
import FormField from './Fields/FormField';
import Validation from './Validation';

export const DefaultValidateFunction: Function = (
    _values: FormValues<JSONObject>
): JSONObject => {
    return {};
};

export interface ComponentProps<T extends Object> {
    id: string;
    name: string;
    submitButtonStyleType?: ButtonStyleType | undefined;
    initialValues: FormValues<T>;
    onSubmit: (values: FormValues<T>) => void;
    onValidate?: undefined | ((values: FormValues<T>) => JSONObject);
    onChange?: undefined | ((values: FormValues<T>) => void);
    fields: Fields<T>;
    steps?: undefined | Array<FormStep<T>>;
    submitButtonText?: undefined | string;
    title?: undefined | string;
    description?: undefined | string;
    showAsColumns?: undefined | number;
    footer: ReactElement;
    isLoading?: undefined | boolean;
    onCancel?: undefined | (() => void) | null;
    cancelButtonText?: undefined | string | null;
    maxPrimaryButtonWidth?: undefined | boolean;
    error: string | null;
    disableAutofocus?: undefined | boolean;
    hideSubmitButton?: undefined | boolean;
    onFormStepChange?: undefined | ((stepId: string) => void);
    onIsLastFormStep?: undefined | ((isLastFormStep: boolean) => void);
    onFormValidationErrorChanged?: ((hasError: boolean) => void) | undefined;
}

const BasicForm: ForwardRefExoticComponent<any> = forwardRef(
    <T extends Object>(
        props: ComponentProps<T>,
        ref: Ref<any>
    ): ReactElement => {
        const isSubmitting: MutableRefObject<boolean> = useRef(false);

        const [submitButtonText, setSubmitButtonText] = useState<string>(
            props.submitButtonText || 'Submit'
        );

        const isInitialValuesSet: MutableRefObject<boolean> = useRef(false);

        const refCurrentValue: MutableRefObject<FormValues<T>> = useRef(
            props.initialValues
        );

        const [currentFormStepId, setCurrentFormStepId] = useState<
            string | null
        >(null);

        useEffect(() => {
            if (props.steps && props.steps.length > 0 && props.steps[0]) {
                setCurrentFormStepId(props.steps[0].id);
            }
        }, []);

        useEffect(() => {
            // if last step,

            if (
                props.steps &&
                props.steps.length > 0 &&
                (
                    (props.steps as Array<FormStep<T>>)[
                        props.steps.length - 1
                    ] as FormStep<T>
                ).id === currentFormStepId
            ) {
                setSubmitButtonText(props.submitButtonText || 'Submit');
                if (props.onIsLastFormStep) {
                    props.onIsLastFormStep(true);
                }
            } else {
                setSubmitButtonText('Next');
                if (props.onIsLastFormStep) {
                    props.onIsLastFormStep(false);
                }
            }

            if (props.onFormStepChange && currentFormStepId) {
                props.onFormStepChange(currentFormStepId);
            }

            if (!currentFormStepId) {
                setSubmitButtonText(props.submitButtonText || 'Submit');
                if (props.onIsLastFormStep) {
                    props.onIsLastFormStep(true);
                }
            }
        }, [currentFormStepId]);

        const [currentValue, setCurrentValue] = useState<FormValues<T>>(
            props.initialValues
        );

        const [errors, setErrors] = useState<Dictionary<string>>({});
        const [touched, setTouched] = useState<Dictionary<boolean>>({});

        const [formFields, setFormFields] = useState<Fields<T>>([]);

        const setFieldTouched: Function = (
            fieldName: string,
            value: boolean
        ): void => {
            setTouched({ ...touched, [fieldName]: value });
        };

        const validate: Function = (
            values: FormValues<T>
        ): Dictionary<string> => {
            const totalValidationErrors: Dictionary<string> =
                Validation.validate({
                    values,
                    formFields,
                    currentFormStepId,
                    onValidate: props.onValidate || undefined,
                });

            if (props.onFormValidationErrorChanged) {
                props.onFormValidationErrorChanged(
                    Object.keys(totalValidationErrors).length !== 0
                );
            }

            setErrors(totalValidationErrors);

            return totalValidationErrors;
        };

        useEffect(() => {
            validate(currentValue);
        }, [currentValue]);

        useImperativeHandle(
            ref,
            () => {
                return {
                    setFieldTouched,
                    setFieldValue,
                    submitForm,
                };
            },
            [currentValue, errors, touched, formFields]
        );

        useEffect(() => {
            setFormFields([
                ...props.fields.map((field: Field<T>) => {
                    return {
                        name: getFieldName(field),
                        ...field,
                    };
                }),
            ]);
        }, [props.fields]);

        const getFieldName: Function = (field: Field<T>): string => {
            const fieldName: string = field.overideFieldKey
                ? field.overideFieldKey
                : (Object.keys(field.field)[0] as string);

            return fieldName;
        };

        const setAllTouched: Function = (): void => {
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

        const setFieldValue: Function = (
            fieldName: string,
            value: JSONValue
        ): void => {
            const updatedValue: FormValues<T> = {
                ...refCurrentValue.current,
                [fieldName]: value as any,
            };

            refCurrentValue.current = updatedValue;

            setCurrentValue(refCurrentValue.current);

            if (props.onChange && isInitialValuesSet.current) {
                props.onChange(refCurrentValue.current);
            }
        };

        const submitForm: Function = (): void => {
            // check for any boolean values and if they dont exist in values - mark them as false.

            setAllTouched();

            const validationErrors: Dictionary<string> = validate(
                refCurrentValue.current
            );

            isSubmitting.current = true;

            if (Object.keys(validationErrors).length > 0) {
                // errors on form, do not submit.
                return;
            }

            // if last step then submit.

            if (
                (props.steps &&
                    props.steps.length > 0 &&
                    (
                        (props.steps as Array<FormStep<T>>)[
                            props.steps.length - 1
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

                    if (field.fieldType === FormFieldSchemaType.Password) {
                        const fieldName: string = field.name!;
                        if (
                            (values as any)[fieldName] &&
                            typeof (values as any)[fieldName] === Typeof.String
                        ) {
                            (values as any)[fieldName] = new HashedString(
                                (values as any)[fieldName],
                                false
                            );
                        }
                    }
                }

                UiAnalytics.capture('FORM SUBMIT: ' + props.name);

                props.onSubmit(values);
            } else if (props.steps && props.steps.length > 0) {
                const steps: Array<FormStep<T>> = props.steps.filter(
                    (step: FormStep<T>) => {
                        if (!step.showIf) {
                            return true;
                        }

                        return step.showIf(refCurrentValue.current);
                    }
                );

                const currentStepIndex: number = steps.findIndex(
                    (step: FormStep<T>) => {
                        return step.id === currentFormStepId;
                    }
                );

                if (currentStepIndex > -1) {
                    setCurrentFormStepId(
                        (steps[currentStepIndex + 1] as FormStep<T>).id
                    );
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

            const values: FormValues<T> = { ...props.initialValues };
            for (const field of formFields) {
                const fieldName: string = field.name!;

                if (
                    field.fieldType === FormFieldSchemaType.Date &&
                    (values as any)[fieldName]
                ) {
                    (values as any)[fieldName] =
                        OneUptimeDate.asDateForDatabaseQuery(
                            (values as any)[fieldName]
                        );
                }

                if (
                    field.fieldType === FormFieldSchemaType.Dropdown &&
                    (values as any)[fieldName]
                ) {
                    (values as any)[fieldName] = field.dropdownOptions?.filter(
                        (option: DropdownOption) => {
                            return option.value === (values as any)[fieldName];
                        }
                    )[0];
                }

                if (
                    field.fieldType ===
                        FormFieldSchemaType.MultiSelectDropdown &&
                    (values as any)[fieldName]
                ) {
                    (values as any)[fieldName] = field.dropdownOptions?.filter(
                        (option: DropdownOption) => {
                            return (values as any)[fieldName].includes(
                                option.value
                            );
                        }
                    );
                }

                // if the field is still null but has a default value then... have the default inital value
                if (
                    field.defaultValue &&
                    (values as any)[fieldName] === undefined
                ) {
                    (values as any)[fieldName] = field.defaultValue;
                }

                isInitialValuesSet.current = true;
            }

            refCurrentValue.current = values;
            setCurrentValue(refCurrentValue.current);
        }, [props.initialValues, formFields]);

        const primaryButtonStyle: React.CSSProperties = {};

        if (props.maxPrimaryButtonWidth) {
            primaryButtonStyle.marginLeft = '0px';
            primaryButtonStyle.width = '100%';
        }

        return (
            <div className="row">
                <div className="col-lg-1">
                    <div>
                        {props.title && (
                            <h1 className="text-lg text-gray-700 mt-5">
                                {props.title}
                            </h1>
                        )}

                        {Boolean(props.description) && (
                            <p className="text-sm text-gray-500 mb-5">
                                {props.description}
                            </p>
                        )}

                        <div className="flex">
                            {props.steps && currentFormStepId && (
                                <div className="w-1/3">
                                    {/* Form Steps */}

                                    <Steps
                                        currentFormStepId={currentFormStepId}
                                        steps={props.steps}
                                        formValues={refCurrentValue.current}
                                        onClick={(step: FormStep<T>) => {
                                            setCurrentFormStepId(step.id);
                                        }}
                                    />
                                </div>
                            )}
                            <div
                                className={`${
                                    props.steps && currentFormStepId
                                        ? 'w-2/3 pt-6'
                                        : 'w-full pt-1'
                                }`}
                            >
                                {props.error && (
                                    <div className="mb-3">
                                        <Alert
                                            title={props.error}
                                            type={AlertType.DANGER}
                                        />
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
                                                        return (
                                                            field.stepId ===
                                                            currentFormStepId
                                                        );
                                                    }

                                                    return true;
                                                })
                                                .map(
                                                    (
                                                        field: Field<T>,
                                                        i: number
                                                    ) => {
                                                        return (
                                                            <div
                                                                key={getFieldName(
                                                                    field
                                                                )}
                                                            >
                                                                {
                                                                    <FormField
                                                                        field={
                                                                            field
                                                                        }
                                                                        fieldName={getFieldName(
                                                                            field
                                                                        )}
                                                                        index={
                                                                            i
                                                                        }
                                                                        error={
                                                                            errors[
                                                                                getFieldName(
                                                                                    field
                                                                                )
                                                                            ] ||
                                                                            ''
                                                                        }
                                                                        touched={
                                                                            touched[
                                                                                getFieldName(
                                                                                    field
                                                                                )
                                                                            ] ||
                                                                            false
                                                                        }
                                                                        isDisabled={
                                                                            props.isLoading ||
                                                                            false
                                                                        }
                                                                        currentValues={
                                                                            refCurrentValue.current
                                                                        }
                                                                        setFieldValue={
                                                                            setFieldValue
                                                                        }
                                                                        setFieldTouched={
                                                                            setFieldTouched
                                                                        }
                                                                        submitform={
                                                                            submitForm
                                                                        }
                                                                        disableAutofocus={
                                                                            props.disableAutofocus ||
                                                                            false
                                                                        }
                                                                    />
                                                                }
                                                                {
                                                                    field.footerElement
                                                                }
                                                            </div>
                                                        );
                                                    }
                                                )}
                                    </div>
                                </div>

                                <div className="flex w-full justify-end">
                                    {!props.hideSubmitButton && (
                                        <div
                                            className="mt-3"
                                            style={{
                                                width: props.maxPrimaryButtonWidth
                                                    ? '100%'
                                                    : ' auto',
                                            }}
                                        >
                                            <Button
                                                title={submitButtonText}
                                                dataTestId={
                                                    props.submitButtonText!
                                                }
                                                onClick={() => {
                                                    submitForm();
                                                }}
                                                id={`${props.id}-submit-button`}
                                                isLoading={
                                                    props.isLoading || false
                                                }
                                                buttonStyle={
                                                    props.submitButtonStyleType ||
                                                    ButtonStyleType.PRIMARY
                                                }
                                                style={primaryButtonStyle}
                                            />
                                        </div>
                                    )}
                                    {props.onCancel && (
                                        <div>
                                            <Button
                                                title={
                                                    props.cancelButtonText ||
                                                    'Cancel'
                                                }
                                                type={ButtonTypes.Button}
                                                id={`${props.id}-cancel-button`}
                                                disabled={
                                                    props.isLoading || false
                                                }
                                                buttonStyle={
                                                    ButtonStyleType.NORMAL
                                                }
                                                onClick={() => {
                                                    props.onCancel &&
                                                        props.onCancel();
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
    }
);

BasicForm.displayName = 'BasicForm';

export default BasicForm;
