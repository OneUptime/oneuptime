import React, { Component } from 'react';
import PropTypes from 'prop-types'

const composableComponent = (ComposedComponent) => {
    class Modal extends Component {
        constructor(props){
            super(props);
            this.props = props;
            this.onClose = this.onClose.bind(this);
            this.onConfirm = this.onConfirm.bind(this);
        }
        onClose =(value)=> {
            if (this.props.item.onClose) {
                this.props.item.onClose(value);
                this.props.onClose(this.props.item);
            } else {
                this.props.onClose(this.props.item);
            }
        }
        onConfirm = (value)=> {
            const _this = this;
            if (this.props.item.onConfirm) {
                this.props.item.onConfirm(value)
                .then(() => _this.props.onClose(_this.props.item),
                ()=> {})
            } else {
                this.props.onClose(this.props.item)
            }
        }
        render() {
            const { zIndex } = this.props;
            const { extraClasses } = this.props.item;

            const mainClass = `${extraClasses || ''} modal-dialog-view`;
            const modalContainerStyle = {overflowX: 'auto', overflowY: 'scroll', display: 'block', top: '0px'};
            return (
                <div
                    className={mainClass}
                    style={{
                        zIndex: (zIndex + 1) * 10000
                    }}
                >
                    <div
                        className="modal_overlay"
                        style={{
                            top: 0,
                            opacity: 1,
                            transform: 'none',
                            display: 'block',
                            pointerEvents: 'auto'
                        }}
                    >

                        <div className="modal_container" style={modalContainerStyle}>
                            <ComposedComponent closeThisDialog={this.onClose} confirmThisDialog={this.onConfirm} />
                        </div>
                    </div>
                </div>
            );
        }
    }
    Modal.propTypes = {
        onConfirm: PropTypes.func,
        item: PropTypes.object.isRequired,
        onClose:PropTypes.func.isRequired,
        extraClasses: PropTypes.string,
        zIndex: PropTypes.number.isRequired
    }

    Modal.displayName = 'Modal'

    return Modal;
}


export default composableComponent;