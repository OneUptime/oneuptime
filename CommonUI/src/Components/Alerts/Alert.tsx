import React, { FunctionComponent, ReactElement } from "react";
import Icon, { IconProp } from "../Icon/Icon";

export enum AlertType {
    INFO,
    SUCCESS,
    DANGER,
    WARNING
}

export interface ComponentProps {
    strongTitle?: string;
    title?: string;
    onClose?: () => void
    type?: AlertType
}

const Alert: FunctionComponent<ComponentProps> = (props: ComponentProps): ReactElement => {

    let type: AlertType = AlertType.INFO;

    if (props.type) {
        type = props.type;
    }

    let cssClass = "alert-info";

    if (type === AlertType.DANGER) {
        cssClass = "alert-danger";
    }

    if (type === AlertType.INFO) {
        cssClass = "alert-info";
    }

    if (type === AlertType.SUCCESS) {
        cssClass = "alert-success";
    }

    if (type === AlertType.WARNING) {
        cssClass = "alert-warning";
    }

    return (
        <div className="row">
            <div className="col-xl-12">
                <div className={`alert-label-icon label-arrow alert ${cssClass} alert-danger alert-dismissible fade show`} role="alert">
                    {props.onClose && <button type="button" className="close" onClick={() => {
                        props.onClose && props.onClose();
                    }} aria-label="Close"><span aria-hidden="true">×</span></button>}
                    {AlertType.DANGER === type && <Icon icon={IconProp.Error} />}
                    {AlertType.WARNING === type && <Icon icon={IconProp.Alert} />}
                    {AlertType.SUCCESS === type && <Icon icon={IconProp.Success} />}
                    {AlertType.INFO === type && <Icon icon={IconProp.Info} />}
                    <strong>{props.strongTitle}</strong> {props.title && props.strongTitle ? "-" : ''} {props.title}
                </div>
            </div>
        </div>
    )
}

export default Alert;

