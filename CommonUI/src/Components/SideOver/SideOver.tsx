import IconProp from 'Common/Types/Icon/IconProp';
import React, { FunctionComponent, ReactElement } from 'react';
import Button, { ButtonStyleType } from '../Button/Button';
import Icon from '../Icon/Icon';


export enum SideOverSize {
    Small = 'Small',
    Medium = 'Medium',
    Large = 'Large',
}

export interface ComponentProps {
    title: string;
    description: string;
    onClose: () => void;
    onSubmit?: (() => void) | undefined;
    children: ReactElement | Array<ReactElement>;
    submitButtonDisabled?: boolean | undefined;
    submitButtonText?: string | undefined;
    leftFooterElement?: ReactElement | undefined;
    size?: SideOverSize | undefined;
}

const SideOver: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {


    let widthClass: string = "max-w-2xl";

    if (props.size === SideOverSize.Small) {
        widthClass = "max-w-2xl";
    } else if (props.size === SideOverSize.Medium) {
        widthClass = "max-w-5xl";
    } else if (props.size === SideOverSize.Large) {
        widthClass = "max-w-7xl";
    }

    return (
        <div
            className="relative z-10"
            aria-labelledby="slide-over-title"
            role="dialog"
            aria-modal="true"
        >
            <div className="fixed inset-0"></div>

            <div className="fixed inset-0 overflow-hidden">
                <div className="absolute inset-0 overflow-hidden">
                    <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10 sm:pl-16">
                        <div className={`pointer-events-auto w-screen ${widthClass}`}>
                            <div className="flex h-full flex-col bg-white shadow-xl">
                                <div className="flex-shrink-0 flex flex-col bg-gray-50 px-4 py-6 sm:px-6">
                                    <div className="flex items-start justify-between space-x-3">
                                        <div className="space-y-1">
                                            <h2
                                                className="text-lg font-medium text-gray-900"
                                                id="slide-over-title"
                                            >
                                                {props.title}
                                            </h2>
                                            <p className="text-sm text-gray-500">
                                                {props.description}
                                            </p>
                                        </div>
                                        <div className="flex h-7 items-center">
                                            <button
                                                onClick={() => {
                                                    props.onClose();
                                                }}
                                                type="button"
                                                className="text-gray-400 hover:text-gray-500"
                                            >
                                                <span className="sr-only">
                                                    Close panel
                                                </span>

                                                <Icon
                                                    className="h-6 w-6"
                                                    icon={IconProp.Close}
                                                />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <div className="h-full overflow-y-scroll">
                                    <div className="space-y-6 py-6 sm:space-y-0 sm:divide-y sm:divide-gray-200 sm:py-0 p-5">
                                        {props.children}
                                    </div>
                                </div>
                                <div className="flex-shrink-0 border-t border-gray-200 px-4 py-5 sm:px-6 flex justify-between">
                                    <div className="flex justify-start space-x-3">
                                        {props.leftFooterElement}
                                    </div>
                                    <div className="flex justify-end space-x-3">
                                        <Button
                                            title="Close"
                                            onClick={() => {
                                                props.onClose();
                                            }}
                                            buttonStyle={ButtonStyleType.NORMAL}
                                        />

                                        {props.onSubmit && (
                                            <Button
                                                title={
                                                    props.submitButtonText ||
                                                    'Save'
                                                }
                                                disabled={
                                                    props.submitButtonDisabled
                                                }
                                                onClick={() => {
                                                    props.onSubmit!();
                                                }}
                                                buttonStyle={
                                                    ButtonStyleType.PRIMARY
                                                }
                                            />
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SideOver;
