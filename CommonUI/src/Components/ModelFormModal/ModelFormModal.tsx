import React, { ReactElement, useRef, useState } from 'react';
import { ButtonStyleType } from '../Button/Button';
import Modal from '../Modal/Modal';
import ModelForm, {
    ComponentProps as ModelFormComponentProps, FormType,
} from '../Forms/ModelForm';
import BaseModel from 'Common/Models/BaseModel';
import ButtonType from '../Button/ButtonTypes';
import { JSONObject, JSONObjectOrArray } from 'Common/Types/JSON';
import { FormikProps, FormikValues } from 'formik';
import ObjectID from 'Common/Types/ObjectID';
import ModelAPI from '../../Utils/ModelAPI/ModelAPI';
import Select from '../../Utils/ModelAPI/Select';
import Dictionary from 'Common/Types/Dictionary';
import useAsyncEffect from 'use-async-effect';
import Loader, { LoaderType } from '../Loader/Loader';
import { VeryLightGrey } from '../../Utils/BrandColors';
import Alert, { AlertType } from '../Alerts/Alert';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';

export interface ComponentProps<TBaseModel extends BaseModel> {
    title: string;
    type: { new(): TBaseModel };
    onClose?: undefined | (() => void);
    submitButtonText?: undefined | string;
    onSuccess?: undefined | ((
        data: TBaseModel | JSONObjectOrArray | Array<TBaseModel>
    ) => void);
    submitButtonStyleType?: undefined | ButtonStyleType;
    formProps: ModelFormComponentProps<TBaseModel>;
    modelIdToEdit?: ObjectID | undefined;
}

const ModelFromModal: Function = <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
): ReactElement => {

    const model: TBaseModel = new props.type();
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [isFormLoading, setIsFormLoading] = useState<boolean>(false);
    const [error, setError] = useState<string>('');
    const [itemToEdit, setItemToEdit] = useState<TBaseModel | null>(null);

    const formRef: any = useRef<FormikProps<FormikValues>>(null);

    const getSelectFields = (): Select<TBaseModel> => {

        const select: Select<TBaseModel> = {};
        for (const field of props.formProps.fields) {

            let key: string | null = field.field
                ? (Object.keys(field.field)[0] as string)
                : null;

            if (key) {
                (select as Dictionary<boolean>)[key] = true;
            }
        }

        return select;
    }

    useAsyncEffect(async () => {

        if (props.modelIdToEdit && props.formProps.formType === FormType.Update) {
            // get item. 
            setIsLoading(true);
            setError('');
            try {
                const item: TBaseModel | null = await ModelAPI.getItem(props.type, props.modelIdToEdit, getSelectFields());

                if (!item) {
                    setError(`Cannot edit ${(model.singularName || 'item').toLowerCase()}. It could be because you don't have enough permissions to read or edit this ${(model.singularName || 'item').toLowerCase()}.`)
                }

                setItemToEdit(item);
            } catch (err) {
                try {
                    setError(
                        ((err as HTTPErrorResponse).data as JSONObject)[
                        'error'
                        ] as string
                    );
                } catch (e) {
                    setError(
                        "Server Error. Please try again"
                    );
                }
            }

            setIsLoading(false);
        }
    }, []);

    return (
        <Modal
            {...props}
            submitButtonType={ButtonType.Submit}
            isLoading={isFormLoading}
            disableSubmitButton={isLoading}
            onSubmit={() => {
                formRef.current && formRef.current.handleSubmit();
            }}
            error={error}
        >
            {!isLoading && !error ? <ModelForm<TBaseModel>
                {...props.formProps}
                type={props.type}
                initialValues={itemToEdit || {}}
                hideSubmitButton={true}
                onLoadingChange={(isFormLoading: boolean) => {
                    setIsFormLoading(isFormLoading);
                }}
                formRef={formRef}
                
                onSuccess={(
                    data: TBaseModel | JSONObjectOrArray | Array<TBaseModel>
                ) => {
                    props.onSuccess && props.onSuccess(data);
                }}
            /> : <></>}

            {isLoading ? <div className="row text-center" style={{
                marginTop: "50px",
                marginBottom: "50px"
            }}>
                <Loader loaderType={LoaderType.Bar} color={VeryLightGrey} size={200} />
            </div> : <></>}

            {error ? (
                <Alert
                    title={error}
                    type={AlertType.DANGER}
                />
            ) : <></>}

        </Modal>
    );
};

export default ModelFromModal;
