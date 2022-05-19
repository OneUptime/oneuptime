import React, { ReactElement } from 'react';
import { FormikErrors } from 'formik';
import BaseModel from 'Common/Models/BaseModel';
import FormValues from './Types/FormValues';
import Fields from './Types/Fields';
import BasicForm from './BasicForm';

export interface ComponentProps<T extends BaseModel> {
    model: T;
    id: string;
    onSubmit: (values: FormValues<T>) => void;
    onValidate?: (values: FormValues<T>) => FormikErrors<FormValues<T>>;
    fields: Fields<T>;
    submitButtonText?: string;
    title?: string;
    children: ReactElement;
}

const BasicModelForm = <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
): ReactElement => {
    const initialValues: FormValues<TBaseModel> = {};

    const fields = [];
    // Prep
    for (const field of props.fields) {
        if (Object.keys(field.field).length > 0) {
            if (
                props.model.getDisplayColumnTitleAs(
                    Object.keys(field.field)[0] as string
                )
            ) {
                field.title = props.model.getDisplayColumnTitleAs(
                    Object.keys(field.field)[0] as string
                ) as string;
            }

            if (
                props.model.getDisplayColumnDescriptionAs(
                    Object.keys(field.field)[0] as string
                )
            ) {
                field.description = props.model.getDisplayColumnDescriptionAs(
                    Object.keys(field.field)[0] as string
                ) as string;
            }
        }

        fields.push(field);
    }

    return (
        <BasicForm<TBaseModel>
            fields={fields}
            id={props.id}
            onSubmit={props.onSubmit}
            initialValues={initialValues}
            requiredfields={{}}
            model={props.model}
            submitButtonText={props.submitButtonText || 'Save'}
            title={props.title || ''}
        >
            {props.children}
        </BasicForm>
    );
};

export default BasicModelForm;
