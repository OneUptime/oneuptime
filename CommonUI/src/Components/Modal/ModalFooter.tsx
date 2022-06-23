import React, { FunctionComponent, ReactElement } from "react";
import Button, { ButtonStyleType } from "../Button/Button";

export interface ComponentProps {
    onClose?: (() => void) | undefined;
    submitButtonText?: string;
    onSubmit: () => void;
    submitButtonType?: ButtonStyleType
}

const ModalFooter: FunctionComponent<ComponentProps> = (props: ComponentProps): ReactElement => {


    return (<div className="modal-footer">
        {props.onClose ? <Button buttonStyle={ButtonStyleType.NORMAL} title={'Close'} data-dismiss="modal" onClick={() => {
            props.onClose && props.onClose();
        }} /> : <></>}

        {props.onSubmit ? <Button buttonStyle={props.submitButtonType ? props.submitButtonType : ButtonStyleType.PRIMARY} title={props.submitButtonText ? props.submitButtonText : 'Save Changes'} onClick={() => {
            props.onSubmit();
        }} /> : <></>}

    </div>
    )
}

export default ModalFooter;

