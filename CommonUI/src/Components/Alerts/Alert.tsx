import { Black, White } from 'Common/Types/BrandColors';
import Color, { RGB } from 'Common/Types/Color';
import React, { FunctionComponent, ReactElement } from 'react';
import Icon, { IconProp, SizeProp, ThickProp } from '../Icon/Icon';

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
    size?: undefined | AlertSize;
    color?: undefined | Color;
    dataTestId?: string;
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


    let sizeCssClass: string = '';

    if (props.size && props.size === AlertSize.Large) {
        sizeCssClass = 'alert-large';
    }

    const rgb: RGB = Color.colorToRgb(props.color || Black);

    return (
        <div className="row">
            <div className="col-xl-12">
                <div
                    data-testid={props.dataTestId}
                    className={`alert-label-icon flex label-arrow alert ${cssClass}  ${sizeCssClass}  alert-dismissible fade show ${props.onClick ? 'pointer' : ''
                        }`}
                    style={props.color ? {
                        backgroundColor: props.color?.toString(), color: rgb.red * 0.299 + rgb.green * 0.587 + rgb.blue * 0.114 > 186
                            ? '#000000'
                            : '#ffffff',
                    } : {}}
                    role="alert"
                    onClick={() => {
                        props.onClick && props.onClick();
                    }}
                >
                    {props.onClose && (
                        <button
                            role={'alert-close-button'}
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
                    {!props.doNotShowIcon && <span style={{ marginLeft: '-45px', height: '10px' }}>
                        {AlertType.DANGER === type && (
                            <Icon
                                thick={ThickProp.LessThick}
                                icon={IconProp.Error}
                                size={SizeProp.Large}
                                color={White}
                            />
                        )}
                        {AlertType.WARNING === type && (
                            <Icon
                                thick={ThickProp.LessThick}
                                icon={IconProp.Alert}
                                size={SizeProp.Large}
                                color={White}
                            />
                        )}
                        {AlertType.SUCCESS === type && (
                            <Icon
                                thick={ThickProp.LessThick}
                                icon={IconProp.Success}
                                size={SizeProp.Large}
                                color={White}
                            />
                        )}
                        {AlertType.INFO === type && (
                            <Icon
                                thick={ThickProp.LessThick}
                                icon={IconProp.Info}
                                size={SizeProp.Large}
                                color={White}
                            />
                        )}
                        &nbsp;&nbsp;
                    </span>}
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
