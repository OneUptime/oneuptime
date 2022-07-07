import React, { ReactElement } from 'react';
import { ButtonStyleType } from '../Button/Button';
import Modal from '../Modal/Modal';
import ModelForm, { ComponentProps as ModelFormComponentProps} from '../Forms/ModelForm';
import BaseModel from 'Common/Models/BaseModel';
import ButtonType from '../Button/ButtonTypes';

export interface ComponentProps<TBaseModel extends BaseModel> {
    title: string;
    onClose?: () => void;
    submitButtonText?: string;
    onSubmit: () => void;
    submitButtonStyleType?: ButtonStyleType;
    formProps: ModelFormComponentProps<TBaseModel>;
}

const ModelFromModal: Function = <TBaseModel extends BaseModel> (
    props: ComponentProps<TBaseModel>
): ReactElement => {
    return (
        <Modal {...props} submitButtonType={ButtonType.Submit}>
            <ModelForm<TBaseModel> {...props.formProps} hideSubmitButton={true}/>
        </Modal>
    );
};

export default ModelFromModal;
