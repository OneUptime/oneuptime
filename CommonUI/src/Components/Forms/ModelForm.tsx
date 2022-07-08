import React, { MutableRefObject, ReactElement, useState } from 'react';
import { FormikErrors, FormikProps, FormikValues } from 'formik';
import BaseModel from 'Common/Models/BaseModel';
import FormValues from './Types/FormValues';
import Fields from './Types/Fields';
import BasicModelForm from './BasicModelForm';
import { JSONArray, JSONObject, JSONObjectOrArray } from 'Common/Types/JSON';
import URL from 'Common/Types/API/URL';
import HTTPMethod from 'Common/Types/API/HTTPMethod';
import API from '../../Utils/API/API';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import Route from 'Common/Types/API/Route';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { DASHBOARD_API_URL } from '../../Config';

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
        let apiUrl: URL | null = props.apiUrl || null;

        if (!apiUrl) {
            const apiPath: Route | null = props.model.getCrudApiPath();
            if (!apiPath) {
                throw new BadDataException(
                    'This model does not support CRUD operations.'
                );
            }

            apiUrl = URL.fromURL(DASHBOARD_API_URL).addRoute(apiPath);
        }

        const result: HTTPResponse<
            JSONObject | JSONArray | TBaseModel | Array<TBaseModel>
        > = await API.fetch<
            JSONObject | JSONArray | TBaseModel | Array<TBaseModel>
        >(
            props.formType === FormType.Create
                ? HTTPMethod.POST
                : HTTPMethod.PUT,
            apiUrl,
            values
        );

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
