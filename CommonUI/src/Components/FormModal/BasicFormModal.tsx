import type { ReactElement } from 'react';
import React, { useRef, useState } from 'react';
import type { ButtonStyleType } from '../Button/Button';
import Modal from '../Modal/Modal';
import type { ComponentProps as BasicFormComponentProps } from '../Forms/BasicForm';
import BasicForm from '../Forms/BasicForm';
import ButtonType from '../Button/ButtonTypes';
import type { FormikProps, FormikValues } from 'formik';

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
            <BasicForm<T>
                {...props.formProps}
                hideSubmitButton={true}
                onLoadingChange={(isFormLoading: boolean) => {
                    setIsLoading(isFormLoading);
                }}
                formRef={formRef}
                onSubmit={(data: T) => {
                    props.onSubmit && props.onSubmit(data);
                }}
            />
        </Modal>
    );
};

export default BasicFormModal;
