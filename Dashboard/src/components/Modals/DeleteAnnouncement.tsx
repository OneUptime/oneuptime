import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

import ClickOutside from 'react-click-outside';
import ShouldRender from '../basic/ShouldRender';
import { closeModal } from 'CommonUI/actions/modal';
import { FormLoader } from '../basic/Loader';
import PropTypes from 'prop-types';
import {
    deleteAnnouncement,
    resetDeleteAnnouncement,
    fetchAnnouncements,
} from '../../actions/statusPage';

interface DeleteAnnouncementProps {
    closeThisDialog?: Function;
    data?: object;
    deleteAnnouncement?: Function;
    isRequesting?: boolean;
    deleteError?: string;
    modalId?: string;
    statusPage?: object;
    resetDeleteAnnouncement?: Function;
    fetchAnnouncements?: Function;
}

class DeleteAnnouncement extends Component<ComponentProps> {
    override componentDidMount() {

        this.props.resetDeleteAnnouncement();
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                return this.props.closeThisDialog();
            case 'Enter':
                return this.handleDelete();
            default:
                return false;
        }
    };

    handleDelete = () => {
        const {

            data: { projectId, announcementId },

            deleteAnnouncement,

            deleteError,

            modalId,

            statusPage,

            fetchAnnouncements,
        } = this.props;

        this.props.resetDeleteAnnouncement();
        closeModal({ id: modalId });
        deleteAnnouncement(projectId, announcementId).then(() => {
            if (!deleteError) {

                this.props.closeThisDialog();
                closeModal({ id: modalId });
                fetchAnnouncements(projectId, statusPage._id, 0, 10);
            }
        });
    };

    override render() {

        const { closeThisDialog, isRequesting, deleteError }: $TSFixMe = this.props;
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
                                        announcement ?
                                    </span>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div
                                        className="bs-Modal-footer-actions"
                                        style={{ width: 280 }}
                                    >
                                        <ShouldRender
                                            if={!isRequesting && deleteError}
                                        >
                                            <div
                                                id="deleteError"
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
                                                            {deleteError}
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
                                            disabled={isRequesting}
                                            autoFocus={true}
                                        >
                                            {!isRequesting && (
                                                <>
                                                    <span>Delete</span>
                                                    <span className="delete-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </>
                                            )}
                                            {isRequesting && <FormLoader />}
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


DeleteAnnouncement.displayName = 'DeleteAnnouncement';


DeleteAnnouncement.propTypes = {
    closeThisDialog: PropTypes.func,
    data: PropTypes.object,
    deleteAnnouncement: PropTypes.func,
    isRequesting: PropTypes.bool,
    deleteError: PropTypes.string,
    modalId: PropTypes.string,
    statusPage: PropTypes.object,
    resetDeleteAnnouncement: PropTypes.func,
    fetchAnnouncements: PropTypes.func,
};

const mapStateToProps: Function = (state: RootState) => {
    return {
        modalId: state.modal.modals[0].id,
        isRequesting: state.statusPage.updateAnnouncement.requesting,
        deleteError: state.statusPage.updateAnnouncement.error,
        statusPage: state.statusPage.status,
    };
};

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators(
    {
        closeModal,
        deleteAnnouncement,
        resetDeleteAnnouncement,
        fetchAnnouncements,
    },
    dispatch
);

export default connect(mapStateToProps, mapDispatchToProps)(DeleteAnnouncement);
