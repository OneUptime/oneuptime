import React, { FunctionComponent, ReactElement } from 'react';
import { ButtonStyleType } from '../Button/Button';
import Modal from './Modal';

export interface ComponentProps {
    title: string;
    description: string;
    onClose?: () => void;
    submitButtonText?: string;
    onSubmit: () => void;
    submitButtonType?: ButtonStyleType;
}

const ConfirmModal: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <Modal
            title={props.title}
            onSubmit={props.onSubmit}
            onClose={props.onClose ? props.onClose : undefined}
            submitButtonText={
                props.submitButtonText ? props.submitButtonText : 'Confirm'
            }
            submitButtonType={
                props.submitButtonType
                    ? props.submitButtonType
                    : ButtonStyleType.PRIMARY
            }
        >
            <p>{props.description}</p>
        </Modal>
    );
};

export default ConfirmModal;
