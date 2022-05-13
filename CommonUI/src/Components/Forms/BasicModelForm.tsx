import React, { FunctionComponent } from 'react';
import { Formik, Form, Field, ErrorMessage, FormikErrors } from 'formik';
import Button from '../Basic/Button/Button';
import BaseModel from 'Common/Models/BaseModel';
import Columns from 'Common/Types/Database/Columns';
import Dictionary from 'Common/Types/Dictionary';
import FormValues from './FormValues';

export interface ComponentProps<T extends BaseModel> {
    model: T,
    id: string,
    fieldsInForm: Dictionary<boolean>, 
    initialValues: Dictionary<string | number>,
    onSubmit: (values: FormValues) => void 
    onValidate: (values: FormValues) => FormikErrors<FormValues> 
}

const BasicForm: FunctionComponent = <TBaseModel extends BaseModel>(props: ComponentProps<TBaseModel>) => {

    const columns: Columns = props.model.getTableColumns();
    const requiredColumns: Columns = props.model.getTableColumns();

    return (<div>
        <Formik
            initialValues={{ email: '', password: '' }}
            validate={(values: FormValues) => {
                return props.onValidate(values);
            }}
            onSubmit={(values: FormValues) => {
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