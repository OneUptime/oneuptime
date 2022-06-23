import React, { FunctionComponent, ReactElement } from "react";
import { ButtonStyleType } from "../Button/Button";
import ModalHeader from "./ModalHeader";
import ModalFooter from "./ModalFooter";
import ModalBody from "./ModalBody";

export interface ComponentProps {
    title: string;
    children: Array<ReactElement> | ReactElement;
    onClose?: (() => void) | undefined;
    submitButtonText?: string;
    onSubmit: () => void;
    submitButtonType?: ButtonStyleType
}

const Modal: FunctionComponent<ComponentProps> = (props: ComponentProps): ReactElement => {


    return (<div style={{ "position": "relative", "zIndex": "1050", "display": "block" }}>
        <div className="">
            <div className="modal fade show" role="dialog" style={{ "display": "block" }}>
                <div className="modal-dialog" role="document">
                    <div className="modal-content">
                        <ModalHeader title={props.title} onClose={props.onClose ? props.onClose : undefined} />
                        <ModalBody>
                            {props.children}
                        </ModalBody>
                        <ModalFooter submitButtonType={props.submitButtonType ? props.submitButtonType : ButtonStyleType.PRIMARY} submitButtonText={props.submitButtonText ? props.submitButtonText : 'Save'} onSubmit={props.onSubmit} onClose={props.onClose ? props.onClose : undefined} />
                    </div>
                </div>
            </div>
            <div className="modal-backdrop fade show"></div>
        </div>
    </div>
    )
}

export default Modal;

