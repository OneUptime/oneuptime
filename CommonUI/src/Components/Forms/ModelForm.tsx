import React, { MutableRefObject, ReactElement, useState } from 'react';
import { FormikErrors, FormikProps, FormikValues } from 'formik';
import BaseModel from 'Common/Models/BaseModel';
import FormValues from './Types/FormValues';
import Fields from './Types/Fields';
import BasicModelForm from './BasicModelForm';
import { JSONArray, JSONObject, JSONObjectOrArray } from 'Common/Types/JSON';
import URL from 'Common/Types/API/URL';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import ModelAPI from '../../Utils/ModelAPI/ModelAPI';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import Select from '../../Utils/ModelAPI/Select';
import Dictionary from 'Common/Types/Dictionary';
import useAsyncEffect from 'use-async-effect';
import ObjectID from 'Common/Types/ObjectID';
import Loader, { LoaderType } from '../Loader/Loader';
import { VeryLightGrey } from '../../Utils/BrandColors';

export enum FormType {
    Create,
    Update,
}

export interface ComponentProps<TBaseModel extends BaseModel> {
    type: { new(): TBaseModel };
    model: TBaseModel;
    id: string;
    onValidate?:
    | undefined
    | ((
        values: FormValues<TBaseModel>
    ) => FormikErrors<FormValues<TBaseModel>>);
    fields: Fields<TBaseModel>;
    submitButtonText?: undefined | string;
    title?: undefined | string;
    description?: undefined | string;
    showAsColumns?: undefined | number;
    footer: ReactElement;
    onCancel?: undefined | (() => void);
    onSuccess?:
    | undefined
    | ((data: TBaseModel | JSONObjectOrArray | Array<TBaseModel>) => void);
    cancelButtonText?: undefined | string;
    maxPrimaryButtonWidth?: undefined | boolean;
    apiUrl?: undefined | URL;
    formType: FormType;
    hideSubmitButton?: undefined | boolean;
    formRef?: undefined | MutableRefObject<FormikProps<FormikValues>>;
    onLoadingChange?: undefined | ((isLoading: boolean) => void);
    initialValues?: FormValues<TBaseModel> | undefined;
    modelIdToEdit?: ObjectID | undefined;
    onError?: ((error: string) => void) | undefined;
}

const ModelForm: Function = <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
): ReactElement => {
    const [isLoading, setLoading] = useState<boolean>(false);
    const [isFetching, setIsFetching] = useState<boolean>(false);
    const [error, setError] = useState<string>('');
    const [itemToEdit, setItemToEdit] = useState<TBaseModel | null>(null);

    const getSelectFields: Function = (): Select<TBaseModel> => {
        const select: Select<TBaseModel> = {};
        for (const field of props.fields) {
            const key: string | null = field.field
                ? (Object.keys(field.field)[0] as string)
                : null;

            if (key) {
                (select as Dictionary<boolean>)[key] = true;
            }
        }

        return select;
    };

    useAsyncEffect(async () => {
        if (
            props.modelIdToEdit &&
            props.formType === FormType.Update
        ) {
            // get item.
            setLoading(true);
            setIsFetching(true);
            setError('');
            try {
                const item: TBaseModel | null = await ModelAPI.getItem(
                    props.type,
                    props.modelIdToEdit,
                    getSelectFields()
                );

                if (!item) {
                    setError(
                        `Cannot edit ${(
                            props.model.singularName || 'item'
                        ).toLowerCase()}. It could be because you don't have enough permissions to read or edit this ${(
                            props.model.singularName || 'item'
                        ).toLowerCase()}.`
                    );
                }

                setItemToEdit(item);
            } catch (err) {
                let error: string = '';
                try {
                    error = ((err as HTTPErrorResponse).data as JSONObject)[
                        'error'
                    ] as string;

                } catch (e) {
                    error = 'Server Error. Please try again';
                }
                setError(
                    error
                );
                props.onError && props.onError(error)
            }

            setLoading(false);
            setIsFetching(false);
        }
    }, []);

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

            // strip data. 
            const valuesToSend: JSONObject = {};

            for (const key in getSelectFields()) {
                (valuesToSend as any)[key] = values[key];
            }

            if (props.formType == FormType.Update && props.modelIdToEdit) {
                (valuesToSend as any)["_id"] = props.modelIdToEdit.toString();
            }

            result = await ModelAPI.createOrUpdate<TBaseModel>(
                props.model.fromJSON(valuesToSend, props.type),
                props.formType,
                props.apiUrl
            );

            if (props.onSuccess) {
                props.onSuccess(result.data);
            }
        } catch (err) {
            setError(
                ((err as HTTPErrorResponse).data as JSONObject)[
                'error'
                ] as string
            );
        }

        setLoading(false);

        if (props.onLoadingChange) {
            props.onLoadingChange(false);
        }
    };

    if (isFetching) {
        return (
            <div
                className="row text-center"
                style={{
                    marginTop: '50px',
                    marginBottom: '50px',
                }}
            >
                <Loader
                    loaderType={LoaderType.Bar}
                    color={VeryLightGrey}
                    size={200}
                />
            </div>
        );
    }

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
            initialValues={itemToEdit || props.initialValues}
        ></BasicModelForm>
    );
};

export default ModelForm;
