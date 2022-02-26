import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(2305) FIXME: Module '"prop-types"' has no exported member 'Prop... Remove this comment to see the full error message
import { PropTypes } from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import { openModal, closeModal } from '../../actions/modal';
import DataPathHoC from '../DataPathHoC';
import SubProjectApiKey from './SubProjectApiKey';

class ConfirmationDialog extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }
    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                return document.getElementById('cancelResetKey').click();
            case 'Enter':
                // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                return document.getElementById('confirmResetKey').click();
            default:
                return false;
        }
    };
    handleCloseModal = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
        this.props.closeModal({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            id: this.props.data.ConfirmationDialogId,
        });
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            data: {
                ConfirmationDialogId,
                SubProjectModalId,
                subProjectTitle,
                subProjectId,
                confirm,
            },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
            openModal,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
            closeModal,
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
                    <ClickOutside onClickOutside={this.handleCloseModal}>
                        <div className="bs-BIM">
                            <div className="bs-Modal bs-Modal--medium">
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span
                                            className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                            id="modalTitle"
                                        >
                                            Confirm API Reset
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        Resetting the API Key will break all
                                        your existing integrations with the API.
                                        Are you sure you want to continue?
                                    </span>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            id="cancelResetKey"
                                            className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                            type="button"
                                            onClick={() => {
                                                closeModal({
                                                    id: ConfirmationDialogId,
                                                });
                                                return openModal({
                                                    id: SubProjectModalId,
                                                    content: DataPathHoC(
                                                        SubProjectApiKey,
                                                        {
                                                            subProjectModalId: SubProjectModalId,
                                                            subProjectId,
                                                            subProjectTitle,
                                                        }
                                                    ),
                                                });
                                            }}
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="confirmResetKey"
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                            type="button"
                                            onClick={() => {
                                                confirm();
                                                closeModal({
                                                    id: ConfirmationDialogId,
                                                });
                                                return openModal({
                                                    id: SubProjectModalId,
                                                    content: DataPathHoC(
                                                        SubProjectApiKey,
                                                        {
                                                            subProjectModalId: SubProjectModalId,
                                                            subProjectId,
                                                            subProjectTitle,
                                                            subProjectResetToken: true,
                                                        }
                                                    ),
                                                });
                                            }}
                                        >
                                            <span>OK</span>
                                            <span className="create-btn__keycode">
                                                <span className="keycode__icon keycode__icon--enter" />
                                            </span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </ClickOutside>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ConfirmationDialog.displayName = 'ConfirmationDialog';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ConfirmationDialog.propTypes = {
    data: PropTypes.shape({
        ConfirmationDialogId: PropTypes.string,
        SubProjectModalId: PropTypes.string,
        subProjectTitle: PropTypes.string,
        subProjectId: PropTypes.string,
        confirm: PropTypes.func,
    }),
    openModal: PropTypes.func,
    closeModal: PropTypes.func,
};

const mapStateToProps = () => {
    return {};
};

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators({ openModal, closeModal }, dispatch);
};

export default connect(mapStateToProps, mapDispatchToProps)(ConfirmationDialog);
