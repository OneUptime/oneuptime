import React, { MutableRefObject, ReactElement, useState } from 'react';
import { FormikErrors, FormikProps, FormikValues } from 'formik';
import BaseModel from 'Common/Models/BaseModel';
import FormValues from './Types/FormValues';
import Fields from './Types/Fields';
import BasicModelForm from './BasicModelForm';
import { JSONArray, JSONObject, JSONObjectOrArray } from 'Common/Types/JSON';
import URL from 'Common/Types/API/URL';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import { ModelAPI } from '../../Utils/ModelAPI/ModelAPI';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';

export enum FormType {
    Create,
    Update,
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
    onCancel?: () => void;
    onSuccess?: (
        data: TBaseModel | JSONObjectOrArray | Array<TBaseModel>
    ) => void;
    cancelButtonText?: string;
    maxPrimaryButtonWidth?: boolean;
    apiUrl?: URL;
    formType: FormType;
    hideSubmitButton?: boolean;
    formRef?: MutableRefObject<FormikProps<FormikValues>>;
    onLoadingChange?: (isLoading: boolean) => void;
}

const ModelForm: Function = <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
): ReactElement => {
    const [isLoading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string>('');

    const onSubmit: Function = async (values: JSONObject): Promise<void> => {
        // Ping an API here.
        setError('');
        setLoading(true);
        if (props.onLoadingChange) {
            props.onLoadingChange(true);
        }

        let result: HTTPResponse<
            JSONObject | JSONArray | TBaseModel | Array<TBaseModel>
        >;

        try {
            result = await ModelAPI.createOrUpdate<TBaseModel>(props.model.fromJSON(values), props.formType, props.apiUrl);
        } catch (err: Error | HTTPErrorResponse) {

        }

        setLoading(false);
        if (props.onLoadingChange) {
            props.onLoadingChange(false);
        }

        if (result.isSuccess()) {
            if (props.onSuccess) {
                props.onSuccess(result.data);
            }
        } else {
            setError((result.data as JSONObject)['error'] as string);
        }
    };

    return (
        <BasicModelForm<TBaseModel>
            title={props.title}
            description={props.description}
            model={props.model}
            id={props.id}
            fields={props.fields}
            showAsColumns={props.showAsColumns}
            footer={props.footer}
            isLoading={isLoading}
            submitButtonText={props.submitButtonText}
            cancelButtonText={props.cancelButtonText}
            onSubmit={onSubmit}
            onValidate={props.onValidate}
            onCancel={props.onCancel}
            maxPrimaryButtonWidth={props.maxPrimaryButtonWidth}
            error={error}
            hideSubmitButton={props.hideSubmitButton}
            formRef={props.formRef}
        ></BasicModelForm>
    );
};

export default ModelForm;
