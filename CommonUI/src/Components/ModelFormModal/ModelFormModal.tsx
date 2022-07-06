import React, { ReactElement } from 'react';
import { ButtonStyleType } from '../Button/Button';
import Modal from '../Modal/Modal';
import ModelForm, { ComponentProps as ModelFormComponentProps} from '../Forms/ModelForm';
import BaseModel from 'Common/Models/BaseModel';

export interface ComponentProps<TBaseModel extends BaseModel> {
    title: string;
    children: Array<ReactElement> | ReactElement;
    onClose?: () => void;
    submitButtonText?: string;
    onSubmit: () => void;
    submitButtonType?: ButtonStyleType;
    formProps: ModelFormComponentProps<TBaseModel>;
}

const ModelFromModal: Function = <TBaseModel extends BaseModel> (
    props: ComponentProps<TBaseModel>
): ReactElement => {
    return (
        <Modal {...props}>
            <ModelForm<TBaseModel> {...props.formProps} hideSubmitButton={true}/>
        </Modal>
    );
};

export default ModelFromModal;
