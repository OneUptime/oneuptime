import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import ShouldRender from '../basic/ShouldRender';
import { closeModal } from '../../actions/modal';
import { FormLoader } from '../basic/Loader';
import PropTypes from 'prop-types';
import {
    updateAnnouncement,
    resetDeleteAnnouncement,
    fetchAnnouncements,
    fetchAnnouncementLogs,
} from '../../actions/statusPage';

class HideAnnouncement extends Component {
    componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetDeleteAnnouncement' does not exist ... Remove this comment to see the full error message
        this.props.resetDeleteAnnouncement();
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
                return this.handleDelete();
            default:
                return false;
        }
    };

    handleDelete = () => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            data: { projectId, announcement },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateAnnouncement' does not exist on ty... Remove this comment to see the full error message
            updateAnnouncement,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'modalId' does not exist on type 'Readonl... Remove this comment to see the full error message
            modalId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
            statusPage,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchAnnouncements' does not exist on ty... Remove this comment to see the full error message
            fetchAnnouncements,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchAnnouncementLogs' does not exist on... Remove this comment to see the full error message
            fetchAnnouncementLogs,
        } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetDeleteAnnouncement' does not exist ... Remove this comment to see the full error message
        this.props.resetDeleteAnnouncement();
        closeModal({ id: modalId });
        const data = {
            hideAnnouncement: announcement.hideAnnouncement ? false : true,
            announcementToggle: true,
        };
        updateAnnouncement(
            projectId,
            announcement.statusPageId,
            announcement._id,
            { data }
        )
            .then((res: $TSFixMe) => {
                if (res) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
                    this.props.closeThisDialog();
                    closeModal({ id: modalId });
                    fetchAnnouncements(projectId, statusPage._id, 0, 10);
                    fetchAnnouncementLogs(projectId, statusPage._id, 0, 10);
                }
            })
            .catch((err: $TSFixMe) => {
                if (!err) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
                    this.props.closeThisDialog();
                    closeModal({ id: modalId });
                }
            });
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
            closeThisDialog,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'requesting' does not exist on type 'Read... Remove this comment to see the full error message
            requesting,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateError' does not exist on type 'Rea... Remove this comment to see the full error message
            updateError,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            data: { announcement },
        } = this.props;
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
                                            <span>
                                                {' '}
                                                {announcement.hideAnnouncement
                                                    ? 'Show Announcement'
                                                    : 'Hide Announcement'}
                                            </span>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        Are you sure you want to{' '}
                                        {announcement.hideAnnouncement
                                            ? 'show'
                                            : 'hide'}{' '}
                                        this announcement ?
                                    </span>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div
                                        className="bs-Modal-footer-actions"
                                        style={{ width: 280 }}
                                    >
                                        <ShouldRender
                                            if={!requesting && updateError}
                                        >
                                            <div
                                                id="updateError"
                                                className="bs-Tail-copy"
                                            >
                                                <div
                                                    className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                    style={{
                                                        marginTop: '10px',
                                                        display: 'flex',
                                                        justifyContent:
                                                            'center',
                                                    }}
                                                >
                                                    <div className="Box-root Margin-right--8">
                                                        <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                    </div>
                                                    <div className="Box-root">
                                                        <span
                                                            style={{
                                                                color: 'red',
                                                            }}
                                                        >
                                                            {updateError}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                    </div>
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                            type="button"
                                            onClick={closeThisDialog}
                                            id="cancelDeleteAnnouncementBtn"
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="deleteAnnouncementModalBtn"
                                            className="bs-Button bs-DeprecatedButton bs-Button--red btn__modal"
                                            type="button"
                                            onClick={this.handleDelete}
                                            disabled={requesting}
                                            autoFocus={true}
                                            style={{
                                                backgroundColor: '#000000',
                                            }}
                                        >
                                            {!requesting && (
                                                <>
                                                    <span>Update</span>
                                                    <span className="create-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </>
                                            )}
                                            {requesting && <FormLoader />}
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
HideAnnouncement.displayName = 'HideAnnouncement';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
HideAnnouncement.propTypes = {
    closeThisDialog: PropTypes.func,
    data: PropTypes.object,
    updateAnnouncement: PropTypes.func,
    requesting: PropTypes.bool,
    updateError: PropTypes.string,
    modalId: PropTypes.string,
    statusPage: PropTypes.object,
    resetDeleteAnnouncement: PropTypes.func,
    fetchAnnouncements: PropTypes.func,
    fetchAnnouncementLogs: PropTypes.func,
};

const mapStateToProps = (state: $TSFixMe) => {
    return {
        modalId: state.modal.modals[0].id,
        requesting: state.statusPage.createAnnouncement.requesting,
        updateError: state.statusPage.createAnnouncement.error,
        statusPage: state.statusPage.status,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        closeModal,
        updateAnnouncement,
        resetDeleteAnnouncement,
        fetchAnnouncements,
        fetchAnnouncementLogs,
    },
    dispatch
);

export default connect(mapStateToProps, mapDispatchToProps)(HideAnnouncement);
