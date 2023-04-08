import React, { ReactElement, useRef, useState } from 'react';
import { ButtonStyleType } from '../Button/Button';
import Modal, { ModalWidth } from '../Modal/Modal';
import ModelForm, {
    ComponentProps as ModelFormComponentProps,
} from '../Forms/ModelForm';
import BaseModel from 'Common/Models/BaseModel';
import ButtonType from '../Button/ButtonTypes';
import { JSONObjectOrArray } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import Alert, { AlertType } from '../Alerts/Alert';
import FormValues from '../Forms/Types/FormValues';

export interface ComponentProps<TBaseModel extends BaseModel> {
    title: string;
    description: string;
    name: string;
    modelType: { new (): TBaseModel };
    initialValues?: FormValues<TBaseModel> | undefined;
    onClose?: undefined | (() => void);
    submitButtonText?: undefined | string;
    modalWidth?: ModalWidth | undefined;
    onSuccess?:
        | undefined
        | ((data: TBaseModel | JSONObjectOrArray | Array<TBaseModel>) => void);
    submitButtonStyleType?: undefined | ButtonStyleType;
    formProps: ModelFormComponentProps<TBaseModel>;
    modelIdToEdit?: ObjectID | undefined;
    onBeforeCreate?: ((item: TBaseModel) => Promise<TBaseModel>) | undefined;
    footer?: ReactElement | undefined;
}

const ModelFormModal: Function = <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
): ReactElement => {
    const [isFormLoading, setIsFormLoading] = useState<boolean>(false);

    const [error, setError] = useState<string>('');

    const formRef: any = useRef<any>(null);

    let modalWidth: ModalWidth = props.modalWidth || ModalWidth.Normal;

    if(props.formProps.steps && props.formProps.steps.length > 0) {
        modalWidth = ModalWidth.Large;
    }

    return (
        <Modal
            {...props}
            modalWidth={modalWidth}
            submitButtonType={ButtonType.Submit}
            isLoading={isFormLoading}
            description={props.description}
            disableSubmitButton={isFormLoading}
            onSubmit={() => {
                formRef.current.submitForm();
            }}
            error={error}
        >
            {!error ? (
                <>
                    <ModelForm<TBaseModel>
                        {...props.formProps}
                        name={props.name}
                        modelType={props.modelType}
                        modelIdToEdit={props.modelIdToEdit}
                        hideSubmitButton={true}
                        formRef={formRef}
                        onLoadingChange={(isFormLoading: boolean) => {
                            setIsFormLoading(isFormLoading);
                        }}
                        initialValues={props.initialValues}
                        onSuccess={(
                            data:
                                | TBaseModel
                                | JSONObjectOrArray
                                | Array<TBaseModel>
                        ) => {
                            props.onSuccess && props.onSuccess(data);
                        }}
                        onError={(error: string) => {
                            setError(error);
                        }}
                        onBeforeCreate={props.onBeforeCreate}
                    />

                    {props.footer}
                </>
            ) : (
                <></>
            )}

            {error ? <Alert title={error} type={AlertType.DANGER} /> : <></>}
        </Modal>
    );
};

export default ModelFormModal;
