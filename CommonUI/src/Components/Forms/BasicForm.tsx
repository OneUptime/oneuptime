import React, { FunctionComponent, ReactElement } from 'react';
import { Formik, Form, Field, ErrorMessage, FormikErrors } from 'formik';
import Button from '../Basic/Button/Button';
import FormValues from './Types/FormValues'
import RequiredFormFields from './Types/RequiredFormFields';
import Fields from './Types/Fields';
import DataField from './Types/Field';
import ButtonTypes from '../Basic/Button/ButtonTypes';
import BadDataException from 'Common/Types/Exception/BadDataException';

export interface ComponentProps<T> {
    id: string,
    initialValues: FormValues<T>,
    onSubmit: (values: FormValues<T>) => void
    onValidate?: (values: FormValues<T>) => FormikErrors<FormValues<T>>,
    requiredfields: RequiredFormFields<T>,
    fields: Fields<T>,
    model: T
}

const BasicForm: FunctionComponent<ComponentProps<Object>> = <T,>(props: ComponentProps<T>) => {

    const getFormField = (field: DataField<T>): ReactElement => {

        let fieldType = "text"; 
        if (Object.keys(field.field).length === 0) {
            throw new BadDataException("Object cannot be without Field")
        } 
        return (<div>
            <Field type={fieldType} name={Object.keys(field.field)[0] as string} />
            <ErrorMessage name={Object.keys(field.field)[0] as string} component="div" />
        </div>)
    }

    return (<div>
        <Formik
            initialValues={props.initialValues}
            validate={(values: FormValues<T>) => {
                if (props.onValidate) {
                    return props.onValidate(values);
                }

                return {};
            }}
            onSubmit={(values: FormValues<T>) => {
                props.onSubmit(values);
            }}
        >

            {({ isSubmitting }) => (
                <Form>
                    {props.fields && props.fields.map((field: DataField<T>) => {
                        return getFormField(field);
                    })}
                    <Button title='Submit' disabled={isSubmitting} type={ButtonTypes.Submit} id={`${props.id}-submit-button`} />
                </Form>
            )}
        </Formik>
    </div>)
};

export default BasicForm;