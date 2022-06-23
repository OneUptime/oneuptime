import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
    children: Array<ReactElement> | ReactElement;
}

const ModalBody: FunctionComponent<ComponentProps> = (props: ComponentProps): ReactElement => {

    return (<div className="modal-body">
        {props.children}
    </div>
    )
}

export default ModalBody;

