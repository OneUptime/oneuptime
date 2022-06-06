import React, { FunctionComponent, ReactElement } from 'react';

const Modal: FunctionComponent = (): ReactElement => {
    const mainClass: string = `modal-dialog-view`;

    return (
        <div className={mainClass}>
            <div
                className="modal_overlay"
                style={{
                    top: 0,
                    opacity: 1,
                    transform: 'none',
                    display: 'block',
                    pointerEvents: 'auto',
                    zIndex: 20,
                }}
            >
                <div
                    className="modal_container"
                    style={{
                        overflowX: 'auto',
                        overflowY: 'scroll',
                        display: 'block',
                        top: '0px',
                    }}
                ></div>
            </div>
        </div>
    );
};

export default Modal;
