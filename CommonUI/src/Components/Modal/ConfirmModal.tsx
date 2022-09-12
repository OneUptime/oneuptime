import React, { FunctionComponent, ReactElement } from 'react';
import { ButtonStyleType } from '../Button/Button';
import Modal from './Modal';

export interface ComponentProps {
    title: string;
    description: string | ReactElement;
    onClose?: undefined | (() => void);
    submitButtonText?: undefined | string;
    onSubmit: () => void;
    submitButtonType?: undefined | ButtonStyleType;
    isLoading?: boolean;
}

const ConfirmModal: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <Modal
            title={props.title}
            isLoading={props.isLoading}
            onSubmit={props.onSubmit}
            onClose={props.onClose ? props.onClose : undefined}
            submitButtonText={
                props.submitButtonText ? props.submitButtonText : 'Confirm'
            }
            submitButtonStyleType={
                props.submitButtonType
                    ? props.submitButtonType
                    : ButtonStyleType.PRIMARY
            }
        >
            <div>{props.description}</div>
        </Modal>
    );
};

export default ConfirmModal;
