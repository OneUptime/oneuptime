import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import { FormLoader } from '../basic/Loader';
import { deleteScheduledEventNote } from '../../actions/scheduledEvent';
import { closeModal } from '../../actions/modal';

class DeleteNoteModal extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
                return this.props.closeThisDialog();
            case 'Enter':
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'deletingNote' does not exist on type 'Re... Remove this comment to see the full error message
                return !this.props.deletingNote && this.handleDeleteNote();
            default:
                return false;
        }
    };

    handleDeleteNote = () => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            data: { projectId, scheduledEventId, scheduledEventNoteId },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
            closeModal,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteScheduledEventNote' does not exist... Remove this comment to see the full error message
            deleteScheduledEventNote,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'modalId' does not exist on type 'Readonl... Remove this comment to see the full error message
            modalId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteError' does not exist on type 'Rea... Remove this comment to see the full error message
            deleteError,
        } = this.props;

        deleteScheduledEventNote(
            projectId,
            scheduledEventId,
            scheduledEventNoteId
        ).then(() => {
            if (!deleteError) {
                return closeModal({ id: modalId });
            }
        });
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'deletingNote' does not exist on type 'Re... Remove this comment to see the full error message
        const { deletingNote, closeThisDialog } = this.props;

        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
                            <ClickOutside onClickOutside={closeThisDialog}>
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Confirm Deletion</span>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        Are you sure you want to delete this
                                        note ?
                                    </span>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                            type="button"
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
                                            onClick={this.props.closeThisDialog}
                                            disabled={deletingNote}
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="deleteNote"
                                            className="bs-Button bs-DeprecatedButton bs-Button--red btn__modal"
                                            type="button"
                                            onClick={this.handleDeleteNote}
                                            disabled={deletingNote}
                                            autoFocus={true}
                                        >
                                            {!deletingNote && (
                                                <>
                                                    <span>Delete</span>
                                                    <span className="delete-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </>
                                            )}
                                            {deletingNote && <FormLoader />}
                                        </button>
                                    </div>
                                </div>
                            </ClickOutside>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
DeleteNoteModal.displayName = 'DeleteNoteModal';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
DeleteNoteModal.propTypes = {
    closeThisDialog: PropTypes.func.isRequired,
    data: PropTypes.object,
    deletingNote: PropTypes.bool,
    deleteScheduledEventNote: PropTypes.func,
    deleteError: PropTypes.string,
    closeModal: PropTypes.func,
    modalId: PropTypes.string,
};

const mapStateToProps = (state: $TSFixMe) => {
    return {
        deletingNote: state.scheduledEvent.deleteScheduledEventNote.requesting,
        deleteError: state.scheduledEvent.deleteScheduledEventNote.error,
        modalId: state.modal.modals[0].id,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators({ deleteScheduledEventNote, closeModal }, dispatch);

export default connect(mapStateToProps, mapDispatchToProps)(DeleteNoteModal);
