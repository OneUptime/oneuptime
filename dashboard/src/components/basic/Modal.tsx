import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { FormLoader } from '../basic/Loader';
import { connect } from 'react-redux';

class Modal extends Component {
    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape': {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
                if (this.props.closeThisDialog)
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
                    return this.props.closeThisDialog();
                break;
            }
            default:
                return false;
        }
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'title' does not exist on type 'Readonly<... Remove this comment to see the full error message
            title,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeButtonLabel' does not exist on type... Remove this comment to see the full error message
            closeButtonLabel,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'affirmativeButtonLabel' does not exist o... Remove this comment to see the full error message
            affirmativeButtonLabel,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isLoading' does not exist on type 'Reado... Remove this comment to see the full error message
            isLoading,
        } = this.props;

        return (
            <div
                onKeyDown={this.handleKeyBoard}
                className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center"
            >
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
                            <div className="bs-Modal-header">
                                <div className="bs-Modal-header-copy">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>{title}</span>
                                    </span>
                                </div>
                            </div>
                            <div className="bs-Modal-content">
                                {this.props.children}
                            </div>
                            <div className="bs-Modal-footer">
                                <div className="bs-Modal-footer-actions">
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
                                    {this.props.closeThisDialog && (
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--grey"
                                            type="button"
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
                                            onClick={this.props.closeThisDialog}
                                        >
                                            <span>
                                                {closeButtonLabel || 'Close'}
                                            </span>
                                        </button>
                                    )}
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'confirmThisDialog' does not exist on typ... Remove this comment to see the full error message
                                    {this.props.confirmThisDialog && (
                                        <button
                                            id="deleteMonitor"
                                            className="bs-Button bs-DeprecatedButton bs-Button--red"
                                            type="button"
                                            onClick={
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'confirmThisDialog' does not exist on typ... Remove this comment to see the full error message
                                                this.props.confirmThisDialog
                                            }
                                            disabled={isLoading}
                                        >
                                            {!isLoading && (
                                                <span>
                                                    {affirmativeButtonLabel}
                                                </span>
                                            )}
                                            {isLoading && <FormLoader />}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
Modal.displayName = 'Modal';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
Modal.propTypes = {
    confirmThisDialog: PropTypes.func,
    closeThisDialog: PropTypes.func,
    title: PropTypes.string,
    closeButtonLabel: PropTypes.string,
    affirmativeButtonLabel: PropTypes.string,
    children: PropTypes.object,
    isLoading: PropTypes.bool,
};

const mapStateToProps = () => {
    return {};
};

const mapDispatchToProps = () => {
    return {};
};

export default connect(mapStateToProps, mapDispatchToProps)(Modal);
