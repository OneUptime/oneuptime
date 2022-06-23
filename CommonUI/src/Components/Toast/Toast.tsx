import React, { FunctionComponent, ReactElement, useState } from 'react';

export interface ComponentProps {
    title: string;
    description: string;
    onClose?: () => void
}

const Component: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    const [show, setShow] = useState<boolean>(true);

    if (show) {
        return (<div className="position-fixed top-0 end-0 p-3" style={{ "zIndex": "1005" }}>
            <div className="toast fade show" role="alert">
                <div className="toast-header">
                    <div role="status" className="spinner-grow-sm spinner-grow text-danger"><span className="visually-hidden">Loading...</span></div>
                    <strong className="me-auto ms-2">{props.title}</strong><button onClick={() => {
                        setShow(false);
                        props.onClose && props.onClose();
                    }} type="button" className="btn-close" aria-label="Close"></button>
                </div>
                <div className="toast-body">{props.description}</div>
            </div>
        </div>
        );
    } else {
        return <></>
    }
};

export default Component;
