import React from 'react';
import { Formik, Form, Field, ErrorMessage } from 'formik';
import Button from '../Basic/Button/Button';
import BaseModel from 'Common/Models/BaseModel';
import Columns from 'Common/Types/Database/Columns';

export interface ComponentProps {
    model: BaseModel,
    id: string
}

const BasicForm = (props: ComponentProps) => {

    const columns: Columns = props.model.getTableColumns();

    return (<div>
        <Formik
            initialValues={{ email: '', password: '' }}
            validate={values => {
                const errors = {};
                if (!values.email) {
                    errors.email = 'Required';
                } else if (
                    !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(values.email)
                ) {
                    errors.email = 'Invalid email address';
                }
                return errors;
            }}
            onSubmit={(values, { setSubmitting }) => {
                setTimeout(() => {
                    alert(JSON.stringify(values, null, 2));
                    setSubmitting(false);
                }, 400);
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