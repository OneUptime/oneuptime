import React, { ReactElement } from 'react';
import { ErrorMessage, Field, Form, Formik, FormikErrors } from 'formik';
import Button from '../Basic/Button/Button';
import FormValues from './Types/FormValues';
import RequiredFormFields from './Types/RequiredFormFields';
import Fields from './Types/Fields';
import DataField from './Types/Field';
import ButtonTypes from '../Basic/Button/ButtonTypes';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { JSONObject } from 'Common/Types/JSON';

export interface ComponentProps<T extends Object> {
    id: string;
    initialValues: FormValues<T>;
    onSubmit: (values: FormValues<T>) => void;
    onValidate?: (values: FormValues<T>) => FormikErrors<FormValues<T>>;
    requiredfields: RequiredFormFields<T>;
    fields: Fields<T>;
    model: T;
    submitButtonText?: string;
    title?: string;
    description?: string;
    showAsColumns?: number;
    footer: ReactElement;
}

const BasicForm = <T extends Object>(
    props: ComponentProps<T>
): ReactElement => {
    const getFormField = (field: DataField<T>, index: number): ReactElement => {

        const fieldType = 'text';
        if (Object.keys(field.field).length === 0) {
            throw new BadDataException('Object cannot be without Field');
        }
        return (
            <div key={index}>
                <label>
                    <span>{field.title}</span>
                    {
                        <span>
                            <a
                                href={field.sideLink?.url.toString()}
                                target={`${
                                    field.sideLink?.openLinkInNewTab
                                        ? '_blank'
                                        : '_self'
                                }`}
                            >
                                {field.sideLink?.text}
                            </a>
                        </span>
                    }
                </label>
                <p>{field.description}</p>
                <Field
                    autoFocus={index === 0 ? true : false}
                    placeholder={field.placeholder}
                    type={fieldType}
                    name={Object.keys(field.field)[0] as string}
                />
                <ErrorMessage
                    name={Object.keys(field.field)[0] as string}
                    component="div"
                />
            </div>
        );
    };

    const validate = (values: FormValues<T>): object => {

        const errors: JSONObject = {};
        const entries: JSONObject = { ...values } as JSONObject;

        // Check Required fields. 
        for (const field of props.fields) {
            const name = Object.keys(field.field)[0] as string;
            if (name in values) {
                if (entries[name]?.toString().trim().length === 0) {
                    errors[name] = `${field.title || name} is required.`;
                }
            } else if (field.required && !(name in values)) {
                errors[name] = `${field.title || name} is required.`;
            }
        }

        // Check for valid data. 

        return errors;
    };

    return (
        <div>
            <Formik
                initialValues={props.initialValues}
                validate={(values: FormValues<T>) => {
                    if (props.onValidate) {
                        return props.onValidate(values);
                    }

                    return validate(values);
                }}
                validateOnChange={true}
                validateOnBlur={true}
                onSubmit={(values: FormValues<T>) => {
                    props.onSubmit(values);
                }}
            >
                {({ isSubmitting, isValidating, isValid }) => {
                    return (
                        <Form
                            autoComplete="off"
                            className={`grid_form_${props.showAsColumns}`}
                        >
                            <h1>{props.title}</h1>

                            <p className="description">{props.description}</p>

                            <div className={`grid_${props.showAsColumns}`}>
                                {props.fields &&
                                    props.fields.map(
                                        (field: DataField<T>, i) => {
                                            return getFormField(field, i);
                                        }
                                    )}
                            </div>

                            <Button
                                title={props.submitButtonText || 'Submit'}
                                disabled={
                                    isSubmitting || !isValid || isValidating
                                }
                                type={ButtonTypes.Submit}
                                id={`${props.id}-submit-button`}
                            />
                            {props.footer}
                        </Form>
                    );
                }}
            </Formik>
        </div>
    );
};

export default BasicForm;
