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

export interface ComponentProps<TBaseModel extends BaseModel> {
    title: string;
    onClose?: () => void;
    submitButtonText?: string;
    onSuccess?: (
        data: TBaseModel | JSONObjectOrArray | Array<TBaseModel>
    ) => void;
    submitButtonStyleType?: ButtonStyleType;
    formProps: ModelFormComponentProps<TBaseModel>;
}

const ModelFromModal: Function = <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
): ReactElement => {
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const formRef: any = useRef<FormikProps<FormikValues>>(null);

    return (
        <Modal
            {...props}
            submitButtonType={ButtonType.Submit}
            isLoading={isLoading}
            onSubmit={() => {
                formRef.current && formRef.current.handleSubmit();
            }}
        >
            <ModelForm<TBaseModel>
                {...props.formProps}
                hideSubmitButton={true}
                onLoadingChange={(isFormLoading: boolean) => {
                    setIsLoading(isFormLoading);
                }}
                formRef={formRef}
                onSuccess={(
                    data: TBaseModel | JSONObjectOrArray | Array<TBaseModel>
                ) => {
                    props.onSuccess && props.onSuccess(data);
                }}
            />
        </Modal>
    );
};

export default ModelFromModal;
