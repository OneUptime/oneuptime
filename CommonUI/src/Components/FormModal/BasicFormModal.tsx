import React, { ReactElement, useState } from 'react';
import { ButtonStyleType } from '../Button/Button';
import Modal from '../Modal/Modal';
import BasicForm, {
    ComponentProps as BasicFormComponentProps,
} from '../Forms/BasicForm';
import ButtonType from '../Button/ButtonTypes';

export interface ComponentProps<T extends Object> {
    title: string;
    onClose?: undefined | (() => void);
    submitButtonText?: undefined | string;
    onSubmit?: undefined | ((data: T) => void);
    submitButtonStyleType?: undefined | ButtonStyleType;
    formProps: BasicFormComponentProps<T>;
}

const BasicFormModal: Function = <T extends Object>(
    props: ComponentProps<T>
): ReactElement => {
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [formSubmitTrigger, setFormSubmitTrigger] = useState<boolean>(false);

    return (
        <Modal
            {...props}
            submitButtonType={ButtonType.Submit}
            isLoading={isLoading}
            onSubmit={() => {
                setFormSubmitTrigger(!formSubmitTrigger);
            }}
        >
            <BasicForm<T>
                {...props.formProps}
                hideSubmitButton={true}
                onLoadingChange={(isFormLoading: boolean) => {
                    setIsLoading(isFormLoading);
                }}
                onSubmit={(data: T) => {
                    props.onSubmit && props.onSubmit(data);
                }}
            />
        </Modal>
    );
};

export default BasicFormModal;
