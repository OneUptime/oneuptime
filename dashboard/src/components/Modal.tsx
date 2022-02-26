import React, { Component } from 'react';
import PropTypes from 'prop-types';

const composableComponent = (ComposedComponent: $TSFixMe) => {
    class Modal extends Component {
        constructor(props: $TSFixMe) {
            super(props);
            // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'props' because it is a read-only... Remove this comment to see the full error message
            this.props = props;
            this.onClose = this.onClose.bind(this);
            this.onConfirm = this.onConfirm.bind(this);
        }
        onClose = (value: $TSFixMe) => {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'item' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            if (this.props.item.onClose) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'item' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                this.props.item.onClose(value);
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'onClose' does not exist on type 'Readonl... Remove this comment to see the full error message
                this.props.onClose(this.props.item);
            } else {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'onClose' does not exist on type 'Readonl... Remove this comment to see the full error message
                this.props.onClose(this.props.item);
            }
        };
        onConfirm = (value: $TSFixMe) => {
            const _this = this;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'item' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            if (this.props.item.onConfirm) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'item' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                this.props.item.onConfirm(value).then(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'onClose' does not exist on type 'Readonl... Remove this comment to see the full error message
                    () => _this.props.onClose(_this.props.item),
                    () => {}
                );
            } else {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'onClose' does not exist on type 'Readonl... Remove this comment to see the full error message
                this.props.onClose(this.props.item);
            }
        };
        render() {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'zIndex' does not exist on type 'Readonly... Remove this comment to see the full error message
            const { zIndex } = this.props;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'item' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            const { extraClasses } = this.props.item;

            const mainClass = `${extraClasses || ''} modal-dialog-view`;
            const modalContainerStyle = {
                overflowX: 'auto',
                overflowY: 'scroll',
                display: 'block',
                top: '0px',
            };
            return (
                <div
                    className={mainClass}
                    style={{
                        zIndex: (zIndex + 1) * 10000,
                    }}
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
                            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ overflowX: string; overflowY: string; disp... Remove this comment to see the full error message
                            style={modalContainerStyle}
                        >
                            <ComposedComponent
                                closeThisDialog={this.onClose}
                                confirmThisDialog={this.onConfirm}
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'title' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                title={this.props.title}
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'body' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                body={this.props.body}
                                propArr={
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'item' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                    this.props.item.propArr
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'item' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                        ? this.props.item.propArr
                                        : []
                                }
                            />
                        </div>
                    </div>
                </div>
            );
        }
    }
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
    Modal.propTypes = {
        onConfirm: PropTypes.func,
        item: PropTypes.object.isRequired,
        onClose: PropTypes.func.isRequired,
        extraClasses: PropTypes.string,
        zIndex: PropTypes.number.isRequired,
        title: PropTypes.string,
        body: PropTypes.object,
    };

    // @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
    Modal.displayName = 'Modal';

    return Modal;
};

export default composableComponent;
