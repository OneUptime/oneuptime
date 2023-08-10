import React, { ReactElement, useEffect, useRef, useState } from 'react';
import { ButtonStyleType } from '../Button/Button';
import Modal from '../Modal/Modal';
import BasicForm, {
    ComponentProps as BasicFormComponentProps,
} from '../Forms/BasicForm';
import ButtonType from '../Button/ButtonTypes';
import ComponentLoader from '../ComponentLoader/ComponentLoader';

export interface ComponentProps<T extends Object> {
    title: string;
    isLoading?: boolean | undefined;
    onClose?: undefined | (() => void);
    submitButtonText?: undefined | string;
    onSubmit?: undefined | ((data: T) => void);
    submitButtonStyleType?: undefined | ButtonStyleType;
    formProps: BasicFormComponentProps<T>;
    description?: string | undefined;
}

const BasicFormModal: <T extends Object>(
    props: ComponentProps<T>
) => ReactElement = <T extends Object>(
    props: ComponentProps<T>
): ReactElement => {
    const [isLoading, setIsLoading] = useState<boolean>(
        Boolean(props.isLoading)
    );
    const formRef: any = useRef<any>(null);

    useEffect(() => {
        setIsLoading(Boolean(props.isLoading));
    }, [props.isLoading]);

    return (
        <Modal
            {...props}
            submitButtonType={ButtonType.Submit}
            isLoading={isLoading}
            onSubmit={() => {
                formRef.current.submitForm();
            }}
        >
            <>
                {isLoading && <ComponentLoader />}

                {!isLoading && (
                    <BasicForm
                        {...props.formProps}
                        hideSubmitButton={true}
                        ref={formRef}
                        onLoadingChange={(isFormLoading: boolean) => {
                            setIsLoading(isFormLoading);
                        }}
                        onSubmit={(data: T) => {
                            props.onSubmit && props.onSubmit(data);
                        }}
                    />
                )}
            </>
        </Modal>
    );
};

export default BasicFormModal;
