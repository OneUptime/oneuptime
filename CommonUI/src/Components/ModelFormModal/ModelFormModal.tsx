import React, { ReactElement, useRef, useState } from 'react';
import { ButtonStyleType } from '../Button/Button';
import Modal from '../Modal/Modal';
import ModelForm, {
    ComponentProps as ModelFormComponentProps,
} from '../Forms/ModelForm';
import BaseModel from 'Common/Models/BaseModel';
import ButtonType from '../Button/ButtonTypes';
import { JSONObjectOrArray } from 'Common/Types/JSON';
import { FormikProps, FormikValues } from 'formik';
import ObjectID from 'Common/Types/ObjectID';
import Alert, { AlertType } from '../Alerts/Alert';

export interface ComponentProps<TBaseModel extends BaseModel> {
    title: string;
    type: { new (): TBaseModel };
    onClose?: undefined | (() => void);
    submitButtonText?: undefined | string;
    onSuccess?:
        | undefined
        | ((data: TBaseModel | JSONObjectOrArray | Array<TBaseModel>) => void);
    submitButtonStyleType?: undefined | ButtonStyleType;
    formProps: ModelFormComponentProps<TBaseModel>;
    modelIdToEdit?: ObjectID | undefined;
}

const ModelFromModal: Function = <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
): ReactElement => {
    const [isFormLoading, setIsFormLoading] = useState<boolean>(false);
    const formRef: any = useRef<FormikProps<FormikValues>>(null);
    const [error, setError] = useState<string>('');

    return (
        <Modal
            {...props}
            submitButtonType={ButtonType.Submit}
            isLoading={isFormLoading}
            disableSubmitButton={isFormLoading}
            onSubmit={() => {
                formRef.current && formRef.current.handleSubmit();
            }}
            error={error}
        >
            {!error ? (
                <ModelForm<TBaseModel>
                    {...props.formProps}
                    type={props.type}
                    modelIdToEdit={props.modelIdToEdit}
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
                    onError={(error: string) => {
                        setError(error);
                    }}
                />
            ) : (
                <></>
            )}

            {error ? <Alert title={error} type={AlertType.DANGER} /> : <></>}
        </Modal>
    );
};

export default ModelFromModal;
