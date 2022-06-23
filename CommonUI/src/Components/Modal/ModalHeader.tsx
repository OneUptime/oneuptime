import React, { FunctionComponent, ReactElement } from "react";
import Button, { ButtonStyleType } from "../Button/Button";
import { IconProp } from "../Icon/Icon";

export interface ComponentProps {
    title: string;
    onClose?: (() => void) | undefined
}

const ModalHeader: FunctionComponent<ComponentProps> = (props: ComponentProps): ReactElement => {


    return (<div className="modal-header">
        <h5 className="modal-title mt-0" id="myModalLabel">{props.title}</h5>
        {props.onClose ? <Button buttonStyle={ButtonStyleType.NORMAL} icon={IconProp.Close} onClick={() => {
            props.onClose && props.onClose();
        }} /> : <></>}
    </div>
    )
}

export default ModalHeader;

