import React, { ReactElement } from 'react';
import { ErrorMessage, Field, Form, Formik, FormikErrors } from 'formik';
import Button, { ButtonStyleType } from '../Button/Button';
import FormValues from './Types/FormValues';
import Fields from './Types/Fields';
import DataField from './Types/Field';
import ButtonTypes from '../Button/ButtonTypes';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { JSONObject } from 'Common/Types/JSON';
import FormFieldSchemaType from './Types/FormFieldSchemaType';
import Email from 'Common/Types/Email';

export const DefaultValidateFunction: Function = (
    _values: FormValues<JSONObject>
): JSONObject => {
    return {};
};

export interface ComponentProps<T extends Object> {
    id: string;
    initialValues: FormValues<T>;
    onSubmit: (values: FormValues<T>) => void;
    onValidate?: (values: FormValues<T>) => JSONObject;
    fields: Fields<T>;
    submitButtonText?: string;
    title?: string;
    description?: string;
    showAsColumns?: number;
    footer: ReactElement;
    isLoading?: boolean;
    onCancel?: (() => void) | null;
    cancelButtonText?: string | null
}

function getFieldType(fieldType: FormFieldSchemaType): string {
    switch (fieldType) {
        case FormFieldSchemaType.Email:
            return 'email';
        case FormFieldSchemaType.Password:
            return 'password';
        case FormFieldSchemaType.Date:
            return 'date';
        default:
            return 'text';
    }
}

const BasicForm: Function = <T extends Object>(
    props: ComponentProps<T>
): ReactElement => {
    const getFormField: Function = (
        field: DataField<T>,
        index: number
    ): ReactElement => {
        const fieldType: string = field.fieldType
            ? getFieldType(field.fieldType)
            : 'text';

        if (Object.keys(field.field).length === 0) {
            throw new BadDataException('Object cannot be without Field');
        }
        return (
            <div className="mb-3" key={index}>
                <label className='form-Label form-label'>
                    <span>{field.title}</span>
                    {
                        <span>
                            <a
                                href={field.sideLink?.url.toString()}
                                target={`${field.sideLink?.openLinkInNewTab
                                    ? '_blank'
                                    : '_self'
                                    }`}
                            >
                                {field.sideLink?.text}
                            </a>
                        </span>
                    }
                </label>
                {field.description && <p>{field.description}</p>}
                <Field
                    className="form-control form-control"
                    autoFocus={index === 0 ? true : false}
                    placeholder={field.placeholder}
                    type={fieldType}
                    name={
                        field.overideFieldKey
                            ? field.overideFieldKey
                            : (Object.keys(field.field)[0] as string)
                    }
                />
                <ErrorMessage
                    name={
                        field.overideFieldKey
                            ? field.overideFieldKey
                            : (Object.keys(field.field)[0] as string)
                    }
                    component="div"
                />
            </div>
        );
    };

    const validateLength: Function = (
        content: string,
        field: DataField<T>
    ): string | null => {
        if (field.validation) {
            if (field.validation.minLength) {
                if (content.trim().length < field.validation?.minLength) {
                    return `${field.title || name} cannot be less than ${field.validation.minLength
                        } characters.`;
                }
            }

            if (field.validation.maxLength) {
                if (content.trim().length > field.validation?.maxLength) {
                    return `${field.title || name} cannot be more than ${field.validation.maxLength
                        } characters.`;
                }
            }
        }
        return null;
    };

    const validateRequired: Function = (
        content: string,
        field: DataField<T>
    ): string | null => {
        if (field.required && content.length === 0) {
            return `${field.title} is required.`;
        }
        return null;
    };

    const validateMatchField: Function = (
        content: string,
        field: DataField<T>,
        entity: JSONObject
    ): string | null => {
        if (
            content &&
            field.validation?.toMatchField &&
            entity[field.validation?.toMatchField] &&
            (entity[field.validation?.toMatchField] as string).trim() !==
            content.trim()
        ) {
            return `${field.title} should match ${field.validation?.toMatchField}`;
        }
        return null;
    };

    const validateData: Function = (
        content: string,
        field: DataField<T>
    ): string | null => {
        if (field.fieldType === FormFieldSchemaType.Email) {
            if (!Email.isValid(content!)) {
                return 'Email is not valid.';
            }
        }
        return null;
    };

    const validate: ((
        values: FormValues<T>
    ) => void | object | Promise<FormikErrors<FormValues<T>>>) &
        Function = (values: FormValues<T>): FormikErrors<FormValues<T>> => {
            const errors: JSONObject = {};
            const entries: JSONObject = { ...values } as JSONObject;

            for (const field of props.fields) {
                const name: string = field.overideFieldKey
                    ? field.overideFieldKey
                    : (Object.keys(field.field)[0] as string);
                if (name in values) {
                    const content: string | undefined = entries[name]?.toString();

                    if (content) {
                        // Check Required fields.
                        const resultRequired: string | null = validateRequired(
                            content,
                            field
                        );
                        if (resultRequired) {
                            errors[name] = resultRequired;
                        }

                        // Check for valid email data.
                        const resultValidateData: string | null = validateData(
                            content,
                            field
                        );
                        if (resultValidateData) {
                            errors[name] = resultValidateData;
                        }

                        const resultMatch: string | null = validateMatchField(
                            content,
                            field,
                            entries
                        );

                        if (resultMatch) {
                            errors[name] = resultMatch;
                        }

                        // check for length of content
                        const result: string | null = validateLength(
                            content,
                            field
                        );
                        if (result) {
                            errors[name] = result;
                        }
                    }
                } else if (field.required) {
                    errors[name] = `${field.title || name} is required.`;
                }
            }

            let customValidateResult: JSONObject = {};

            if (props.onValidate) {
                customValidateResult = props.onValidate(values);
            }

            return { ...errors, ...customValidateResult } as FormikErrors<
                FormValues<T>
            >;
        };

    return (
        <div className="row">
            <div className='col-lg-12'>
                <Formik
                    initialValues={props.initialValues}
                    validate={validate}
                    validateOnChange={true}
                    validateOnBlur={true}
                    onSubmit={(
                        values: FormValues<T>,
                        { setSubmitting }: { setSubmitting: Function }
                    ) => {
                        props.onSubmit(values);
                        setSubmitting(false);
                    }}
                >
                    <Form
                        autoComplete="off"
                    >
                        <h1>{props.title}</h1>

                        {!!props.description && <p className="description">{props.description}</p>}

                        <div className={`col-lg-${12 / (props.showAsColumns || 1)}`}>
                            {props.fields &&
                                props.fields.map(
                                    (field: DataField<T>, i: number) => {
                                        return getFormField(field, i);
                                    }
                                )}
                        </div>

                        <div className='row' style={{
                            "display": "flex"
                        }}>
                            <div style={{ "width": "auto" }}>
                                <Button
                                    title={props.submitButtonText || 'Submit'}
                                    type={ButtonTypes.Submit}
                                    id={`${props.id}-submit-button`}
                                    isLoading={props.isLoading || false}
                                    buttonStyle={ButtonStyleType.PRIMARY}
                                />
                            </div>
                            <div style={{ "width": "auto" }}>
                                <Button
                                    title={props.cancelButtonText || 'Cancel'}
                                    type={ButtonTypes.Button}
                                    id={`${props.id}-cancel-button`}
                                    disabled={props.isLoading || false}
                                    buttonStyle={ButtonStyleType.NORMAL}
                                    onClick={() => {
                                        props.onCancel && props.onCancel();
                                    }}
                                />
                            </div>
                        </div>
                        {props.footer}
                    </Form>
                </Formik>
            </div>
        </div>
    );
};

export default BasicForm;
