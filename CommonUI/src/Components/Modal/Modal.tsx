import React, { FunctionComponent, ReactElement } from 'react';
import { ButtonStyleType } from '../Button/Button';
import ModalHeader from './ModalHeader';
import ModalFooter from './ModalFooter';
import ModalBody from './ModalBody';
import ButtonType from '../Button/ButtonTypes';
import Loader from '../Loader/Loader';

export interface ComponentProps {
    title: string;
    children: Array<ReactElement> | ReactElement;
    onClose?: undefined | (() => void);
    submitButtonText?: undefined | string;
    onSubmit: () => void;
    submitButtonStyleType?: undefined | ButtonStyleType;
    submitButtonType?: undefined | ButtonType;
    isLoading?: undefined | boolean;
    disableSubmitButton?: undefined | boolean;
    error?: string | undefined;
    isBodyLoading?: boolean | undefined;
}

const Modal: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div style={{ position: 'relative', zIndex: '1050', display: 'block' }}>
            <div className="">
                <div
                    className="modal fade show"
                    role="dialog"
                    style={{ display: 'block' }}
                >
                    <div className="modal-dialog" role="document">
                        <div className="modal-content">
                            <ModalHeader
                                title={props.title}
                                onClose={
                                    props.onClose ? props.onClose : undefined
                                }
                            />
                            <ModalBody error={props.error}>
                                {!props.isBodyLoading ? (
                                    props.children
                                ) : (
                                    <Loader />
                                )}
                            </ModalBody>
                            <ModalFooter
                                submitButtonType={
                                    props.submitButtonType
                                        ? props.submitButtonType
                                        : ButtonType.Button
                                }
                                submitButtonStyleType={
                                    props.submitButtonStyleType
                                        ? props.submitButtonStyleType
                                        : ButtonStyleType.PRIMARY
                                }
                                submitButtonText={
                                    props.submitButtonText
                                        ? props.submitButtonText
                                        : 'Save'
                                }
                                onSubmit={props.onSubmit}
                                onClose={
                                    props.onClose ? props.onClose : undefined
                                }
                                isLoading={props.isLoading || false}
                                disableSubmitButton={
                                    props.isBodyLoading ||
                                    props.disableSubmitButton
                                }
                            />
                        </div>
                    </div>
                </div>
                <div className="modal-backdrop fade show"></div>
            </div>
        </div>
    );
};

export default Modal;
