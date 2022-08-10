import React, { FunctionComponent, ReactElement } from 'react';
import Icon, { IconProp, SizeProp, ThickProp } from '../Icon/Icon';

export enum AlertType {
    INFO,
    SUCCESS,
    DANGER,
    WARNING,
}

export interface ComponentProps {
    strongTitle?: undefined | string;
    title?: undefined | string;
    onClose?: undefined | (() => void);
    type?: undefined | AlertType;
    onClick?:(() => void) | undefined;
}

const Alert: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    let type: AlertType = AlertType.INFO;

    if (props.type) {
        type = props.type;
    }

    let cssClass: string = 'alert-info';

    if (type === AlertType.DANGER) {
        cssClass = 'alert-danger';
    }

    if (type === AlertType.INFO) {
        cssClass = 'alert-info';
    }

    if (type === AlertType.SUCCESS) {
        cssClass = 'alert-success';
    }

    if (type === AlertType.WARNING) {
        cssClass = 'alert-warning';
    }

    return (
        <div className="row">
            <div className="col-xl-12">
                <div
                    className={`alert-label-icon flex label-arrow alert ${cssClass} alert-dismissible fade show ${props.onClick ? 'pointer' : ''}`}
                    role="alert"
                    onClick={() => {
                        props.onClick && props.onClick();
                    }}
                >
                    {props.onClose && (
                        <button
                            type="button"
                            className="close"
                            onClick={() => {
                                props.onClose && props.onClose();
                            }}
                            aria-label="Close"
                        >
                            <span aria-hidden="true">×</span>
                        </button>
                    )}
                    <span style={{ marginLeft: '-45px', height: '10px' }}>
                        {AlertType.DANGER === type && (
                            <Icon
                                thick={ThickProp.LessThick}
                                icon={IconProp.Error}
                                size={SizeProp.Large}
                            />
                        )}
                        {AlertType.WARNING === type && (
                            <Icon
                                thick={ThickProp.LessThick}
                                icon={IconProp.Alert}
                                size={SizeProp.Large}
                            />
                        )}
                        {AlertType.SUCCESS === type && (
                            <Icon
                                thick={ThickProp.LessThick}
                                icon={IconProp.Success}
                                size={SizeProp.Large}
                            />
                        )}
                        {AlertType.INFO === type && (
                            <Icon
                                thick={ThickProp.LessThick}
                                icon={IconProp.Info}
                                size={SizeProp.Large}
                            />
                        )}
                        &nbsp;&nbsp;
                    </span>
                    <div
                        className={`flex ${props.onClick ? 'pointer' : ''}`}
                        style={{
                            marginLeft: '5px',
                            marginTop: '1px',
                        }}
                    >
                        <div>
                            <strong>{props.strongTitle}</strong>{' '}
                        </div>
                        <div>
                            {props.title && props.strongTitle ? '-' : ''}{' '}
                            {props.title}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Alert;
