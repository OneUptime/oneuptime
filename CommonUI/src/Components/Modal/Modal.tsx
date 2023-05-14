import React, { FunctionComponent, ReactElement } from 'react';
import Button, { ButtonStyleType } from '../Button/Button';
import ModalFooter from './ModalFooter';
import ModalBody from './ModalBody';
import ButtonType from '../Button/ButtonTypes';
import Loader, { LoaderType } from '../Loader/Loader';
import Icon, { IconType, SizeProp, ThickProp } from '../Icon/Icon';
import IconProp from 'Common/Types/Icon/IconProp';
import { VeryLightGrey } from 'Common/Types/BrandColors';

export enum ModalWidth {
    Normal,
    Medium,
    Large,
}

export interface ComponentProps {
    title: string;
    description?: string | undefined;
    children: Array<ReactElement> | ReactElement;
    onClose?: undefined | (() => void);
    submitButtonText?: undefined | string;
    onSubmit: () => void;
    submitButtonStyleType?: undefined | ButtonStyleType;
    submitButtonType?: undefined | ButtonType;
    closeButtonStyleType?: undefined | ButtonStyleType;
    isLoading?: undefined | boolean;
    disableSubmitButton?: undefined | boolean;
    error?: string | undefined;
    isBodyLoading?: boolean | undefined;
    icon?: IconProp | undefined;
    iconType?: IconType | undefined;
    modalWidth?: ModalWidth | undefined;
    rightElement?: ReactElement | undefined;
}

const Modal: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    let iconBgColor: string = 'bg-indigo-100';

    if (props.iconType === IconType.Info) {
        iconBgColor = 'bg-indigo-100';
    } else if (props.iconType === IconType.Warning) {
        iconBgColor = 'bg-yellow-100';
    } else if (props.iconType === IconType.Success) {
        iconBgColor = 'bg-green-100';
    } else if (props.iconType === IconType.Danger) {
        iconBgColor = 'bg-red-100';
    }

    return (
        <div
            className="relative z-20"
            aria-labelledby="modal-title"
            role="dialog"
            aria-modal="true"
        >
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"></div>

            <div className="fixed inset-0 z-20 overflow-y-auto">
                <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
                    <div
                        className={`relative transform rounded-lg bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full ${
                            props.modalWidth &&
                            props.modalWidth === ModalWidth.Large
                                ? 'sm:max-w-7xl'
                                : ''
                        } ${
                            props.modalWidth &&
                            props.modalWidth === ModalWidth.Medium
                                ? 'sm:max-w-3xl'
                                : ''
                        } ${!props.modalWidth ? 'sm:max-w-lg' : ''} `}
                    >
                        {props.onClose && (
                            <div className="absolute top-0 right-0 hidden pt-4 pr-4 sm:block">
                                <Button
                                    buttonStyle={ButtonStyleType.ICON}
                                    icon={IconProp.Close}
                                    iconSize={SizeProp.Large}
                                    title="Close"
                                    onClick={props.onClose}
                                />
                            </div>
                        )}
                        <div className="sm:p-6">
                            {props.icon && (
                                <div
                                    className={`mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full ${iconBgColor} sm:mx-0 sm:h-10 sm:w-10`}
                                >
                                    <Icon
                                        thick={ThickProp.Thick}
                                        type={
                                            props.iconType === undefined
                                                ? IconType.Info
                                                : props.iconType
                                        }
                                        className={
                                            'text-red-600 h-6 w-6 stroke-2'
                                        }
                                        icon={props.icon}
                                        size={SizeProp.Large}
                                    />
                                </div>
                            )}
                            <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:mr-4 sm:text-left">
                                <div className="flex justify-between">
                                    <div>
                                        <h3
                                            className={`text-lg font-medium leading-6 text-gray-900 ${
                                                props.icon
                                                    ? 'ml-10 -mt-8 mb-5'
                                                    : ''
                                            }`}
                                            id="modal-title"
                                        >
                                            {props.title}
                                        </h3>
                                        {props.description && (
                                            <h3 className="text-sm leading-6 text-gray-500">
                                                {props.description}
                                            </h3>
                                        )}
                                    </div>
                                    {props.rightElement && (
                                        <div>{props.rightElement}</div>
                                    )}
                                </div>
                                <div className="mt-2">
                                    <ModalBody error={props.error}>
                                        {!props.isBodyLoading ? (
                                            props.children
                                        ) : (
                                            <div className="modal-body mt-20 mb-20 flex justify-center">
                                                <Loader
                                                    loaderType={LoaderType.Bar}
                                                    color={VeryLightGrey}
                                                    size={200}
                                                />
                                            </div>
                                        )}
                                    </ModalBody>
                                </div>
                            </div>
                        </div>
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
                            closeButtonStyleType={
                                props.closeButtonStyleType
                                    ? props.closeButtonStyleType
                                    : ButtonStyleType.NORMAL
                            }
                            submitButtonText={
                                props.submitButtonText
                                    ? props.submitButtonText
                                    : 'Save'
                            }
                            onSubmit={props.onSubmit}
                            onClose={props.onClose ? props.onClose : undefined}
                            isLoading={props.isLoading || false}
                            disableSubmitButton={
                                props.isBodyLoading || props.disableSubmitButton
                            }
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Modal;
