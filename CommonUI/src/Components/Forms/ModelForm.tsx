import React, { ReactElement } from 'react';
import { FormikErrors } from 'formik';
import BaseModel from 'Common/Models/BaseModel';
import FormValues from './Types/FormValues';
import Fields from './Types/Fields';
import BasicModelForm from './BasicModelForm';

export enum FormType {
    Create, Update
}

export interface ComponentProps<TBaseModel extends BaseModel> {
    model: TBaseModel;
    id: string;
    onValidate?: (
        values: FormValues<TBaseModel>
    ) => FormikErrors<FormValues<TBaseModel>>;
    fields: Fields<TBaseModel>;
    submitButtonText?: string;
    title?: string;
    description?: string;
    showAsColumns?: number;
    footer: ReactElement;
    isLoading?: boolean;
    onCancel?: () => void;
    onSuccess?: (data: TBaseModel) => void;
    cancelButtonText?: string;
    formType: FormType
    
}

const CreateModelForm: Function = <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
): ReactElement => {


    return (
        <BasicModelForm<TBaseModel>
            title={props.title}
            description={props.description}
            model={props.model}
            id={props.id}
            fields={props.fields}
            submitButtonText={props.submitButtonText}
            onSubmit={async (_values: any) => {
                // Ping POST an API here. 
                if (props.onSuccess) {
                    props.onSuccess(props.model);
                }
            }}
            
            onValidate={props.onValidate}
            onCancel={props.onCancel}

        ></BasicModelForm>
    );
};

export default CreateModelForm;
