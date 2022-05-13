import React, { FunctionComponent } from 'react';
import { Formik, Form, Field, ErrorMessage, FormikErrors } from 'formik';
import Button from '../Basic/Button/Button';
import FormValues from './Types/FormValues'
import RequiredFormFields from './Types/RequiredFormFields';

export interface ComponentProps<T> {
    id: string,
    initialValues: FormValues<T>,
    onSubmit: (values: FormValues<T>) => void 
    onValidate: (values: FormValues<T>) => FormikErrors<FormValues<T>>,
    requiredfields: RequiredFormFields<T>,
    fields: Array<keyof T>
}

const BasicForm = <T,>(props: ComponentProps<T>) => {

    return (<div>
        <Formik
            initialValues={props.initialValues}
            validate={(values: FormValues<T>) => {
                return props.onValidate(values);
            }}
            onSubmit={(values: FormValues<T>) => {
                props.onSubmit(values);
            }}
        >

            {({ isSubmitting }) => (
                <Form>
                    <Field type="email" name="email" />
                    <ErrorMessage name="email" component="div" />
                    <Field type="password" name="password" />
                    <ErrorMessage name="password" component="div" />
                    <Button title='Submit' disabled={isSubmitting} type={ButtonType.Submit} id={`${props.id}-submit-button`} />
                </Form>
            )}
        </Formik>
    </div>)
};

export default BasicForm;