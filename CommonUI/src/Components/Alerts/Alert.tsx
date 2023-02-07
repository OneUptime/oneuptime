import Color from 'Common/Types/Color';
import React, { FunctionComponent, ReactElement } from 'react';
import Icon from '../Icon/Icon';
import IconProp from 'Common/Types/Icon/IconProp';

export enum AlertType {
    INFO,
    SUCCESS,
    DANGER,
    WARNING,
}

export enum AlertSize {
    Normal,
    Large,
}

export interface ComponentProps {
    strongTitle?: undefined | string;
    title?: undefined | string;
    onClose?: undefined | (() => void);
    type?: undefined | AlertType;
    onClick?: (() => void) | undefined;
    doNotShowIcon?: boolean | undefined;
    dataTestId?: string;
    textClassName?: string | undefined;
    className?: string | undefined;
    color?: Color | undefined;
}

const Alert: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    let type: AlertType = AlertType.INFO;

    if (props.type) {
        type = props.type;
    }

    let className: string = 'text-blue';
    let bgClassName: string = 'bg-blue';

    if (AlertType.DANGER === type) {
        className = 'text-red';
        bgClassName = 'bg-red';
    } else if (AlertType.INFO === type) {
        className = 'text-blue';
        bgClassName = 'bg-blue';
    } else if (AlertType.WARNING === type) {
        className = 'text-yellow';
        bgClassName = 'bg-yellow';
    } else if (AlertType.SUCCESS === type) {
        className = 'text-green';
        bgClassName = 'bg-green';
    }

    return (
        <div
            className={`rounded-md ${bgClassName}-50 p-4`}
            data-testid={props.dataTestId}
            onClick={() => {
                props.onClick && props.onClick();
            }}
            role="alert"
            style={
                props.color
                    ? {
                        backgroundColor: props.color?.toString(),
                    }
                    : {}
            }
        >
            <div className="flex ">
                {!props.doNotShowIcon && (
                    <div className="flex-shrink-0">
                        {AlertType.DANGER === type && (
                            <Icon
                                icon={IconProp.Alert}
                                className="h-5 w-5 text-red-400"
                            />
                        )}
                        {AlertType.WARNING === type && (
                            <Icon
                                icon={IconProp.Alert}
                                className="h-5 w-5 text-yellow-400"
                            />
                        )}
                        {AlertType.SUCCESS === type && (
                            <Icon
                                icon={IconProp.CheckCircle}
                                className="h-5 w-5 text-green-400"
                            />
                        )}
                        {AlertType.INFO === type && (
                            <Icon
                                icon={IconProp.Info}
                                className="h-5 w-5 text-blue-400"
                            />
                        )}
                    </div>
                )}
                <div
                    className={
                        props.className ||
                        'ml-3 flex-1 md:flex md:justify-between'
                    }
                >
                    <p
                        className={
                            props.textClassName || `text-sm ${className}-600`
                        }
                    >
                        {props.strongTitle}{' '}
                        {props.title && props.strongTitle ? '-' : ''}{' '}
                        {props.title}
                    </p>
                    {props.onClose && (
                        <p className="mt-3 text-sm md:mt-0 md:ml-6">
                            <button
                                onClick={() => {
                                    props.onClose && props.onClose();
                                }}
                                role={'alert-close-button'}
                                className={`whitespace-nowrap font-medium ${className}-500 hover:${className}-600`}
                            >
                                Close
                                <span aria-hidden="true"> &rarr;</span>
                            </button>
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Alert;
