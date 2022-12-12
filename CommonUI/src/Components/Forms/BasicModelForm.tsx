import React, { MutableRefObject, ReactElement } from 'react';
import { FormikErrors, FormikProps, FormikValues } from 'formik';
import BaseModel from 'Common/Models/BaseModel';
import FormValues from './Types/FormValues';
import Fields from './Types/Fields';
import BasicForm, { DefaultValidateFunction } from './BasicForm';
import { ButtonStyleType } from '../Button/Button';

export interface ComponentProps<TBaseModel extends BaseModel> {
    model: TBaseModel;
    id: string;
    onSubmit: (values: FormValues<TBaseModel>) => void;
    onValidate?:
        | undefined
        | ((
              values: FormValues<TBaseModel>
          ) => FormikErrors<FormValues<TBaseModel>>);
    fields: Fields<TBaseModel>;
    submitButtonText?: undefined | string;
    submitButtonStyleType?: ButtonStyleType | undefined;
    title?: undefined | string;
    description?: undefined | string;
    showAsColumns?: undefined | number;
    footer: ReactElement;
    isLoading?: undefined | boolean;
    onCancel?: undefined | (() => void);
    cancelButtonText?: undefined | string;
    maxPrimaryButtonWidth?: undefined | boolean;
    error: string | null;
    hideSubmitButton?: undefined | boolean;
    formRef?: undefined | MutableRefObject<FormikProps<FormikValues>>;
    initialValues?: FormValues<TBaseModel> | undefined;
}

const BasicModelForm: Function = <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
): ReactElement => {
    let initialValues: FormValues<TBaseModel> = {};

    if (props.initialValues) {
        initialValues = { ...props.initialValues };
    }

    const fields: Fields<TBaseModel> = [];
    // Prep
    for (const field of props.fields) {
        if (Object.keys(field.field).length > 0) {
            if (
                props.model.getDisplayColumnTitleAs(
                    Object.keys(field.field)[0] as string
                ) &&
                !field.title
            ) {
                field.title = props.model.getDisplayColumnTitleAs(
                    Object.keys(field.field)[0] as string
                ) as string;
            }

            if (
                props.model.getDisplayColumnDescriptionAs(
                    Object.keys(field.field)[0] as string
                ) &&
                !field.description
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
            isLoading={props.isLoading || false}
            fields={fields}
            id={props.id}
            onValidate={
                props.onValidate ? props.onValidate : DefaultValidateFunction
            }
            submitButtonStyleType={props.submitButtonStyleType}
            onSubmit={props.onSubmit}
            initialValues={initialValues}
            submitButtonText={props.submitButtonText || 'Save'}
            title={props.title || ''}
            description={props.description || ''}
            footer={props.footer}
            showAsColumns={props.showAsColumns || 1}
            onCancel={props.onCancel}
            cancelButtonText={props.cancelButtonText}
            maxPrimaryButtonWidth={props.maxPrimaryButtonWidth || false}
            error={props.error}
            hideSubmitButton={props.hideSubmitButton}
            formRef={props.formRef}
        ></BasicForm>
    );
};

export default BasicModelForm;
