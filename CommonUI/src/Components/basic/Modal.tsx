import React from 'react';
import PropTypes from 'prop-types';
import BaseComponent from '../BaseComponent';

export interface ComponentProps {
    onConfirm?: Function;
    onClose: Function;
    zIndex: number;
    title: string;
    body: object;
}

class Modal extends BaseComponent<ComponentProps> {

    constructor(props: ComponentProps) {
        super(props);
        this.onClose = this.onClose.bind(this);
        this.onConfirm = this.onConfirm.bind(this);
    }

    onClose = () => {
        this.props.onClose();
    }

    onConfirm = () => {
        if (this.props.onConfirm) {
            this.props.onConfirm();
        }
    };

    override render() {

        const mainClass: string = `modal-dialog-view`;

        return (
            <div
                className={mainClass}
            >
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
                    >

                    </div>
                </div>
            </div>
        );
    }
}

Modal.propTypes = {
    onConfirm: PropTypes.func,
    item: PropTypes.object.isRequired,
    onClose: PropTypes.func.isRequired,
    extraClasses: PropTypes.string,
    zIndex: PropTypes.number.isRequired,
    title: PropTypes.string,
    body: PropTypes.object,
};


Modal.displayName = 'Modal';

export default Modal;

