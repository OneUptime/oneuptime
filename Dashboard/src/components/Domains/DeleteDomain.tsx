import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { FormLoader } from '../basic/Loader';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

import ClickOutside from 'react-click-outside';
import ShouldRender from '../basic/ShouldRender';
import { closeModal } from 'CommonUI/actions/modal';
import {
    deleteProjectDomain,
    fetchProjectDomains,
    resetDeleteProjectDomain,
} from '../../actions/project';

interface DeleteDomainProps {
    isRequesting?: boolean;
    deleteError?: string;
    closeModal?: Function;
    resetDeleteProjectDomain?: Function;
    deleteProjectDomain?: Function;
    fetchProjectDomains?: Function;
    domainId?: string;
    projectId?: string;
    currentProject?: object;
}

class DeleteDomain extends Component<ComponentProps> {
    override componentDidMount() {

        this.props.resetDeleteProjectDomain();
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                return this.handleCloseModal();
            case 'Enter':
                return this.handleDelete();
            default:
                return false;
        }
    };

    handleCloseModal = () => {

        this.props.closeModal({

            id: this.props.domainId,
        });
    };

    handleDelete = () => {
        const {

            deleteError,

            domainId,

            projectId,

            deleteProjectDomain,

            fetchProjectDomains,

            currentProject,
        } = this.props;

        deleteProjectDomain({ projectId, domainId }).then(() => {
            if (!deleteError) {
                fetchProjectDomains(currentProject._id, 0, 10);
                this.handleCloseModal();
            }
        });
    };

    override render() {

        const { isRequesting, deleteError }: $TSFixMe = this.props;
        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
                            <ClickOutside
                                onClickOutside={this.handleCloseModal}
                            >
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
                                        domain?
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
                                            onClick={this.handleCloseModal}
                                            id="cancelDeleteDomainBtn"
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="deleteDomainBtn"
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


DeleteDomain.displayName = 'DeleteDomain';


DeleteDomain.propTypes = {
    isRequesting: PropTypes.bool,
    deleteError: PropTypes.string,
    closeModal: PropTypes.func,
    resetDeleteProjectDomain: PropTypes.func,
    deleteProjectDomain: PropTypes.func,
    fetchProjectDomains: PropTypes.func,
    domainId: PropTypes.string,
    projectId: PropTypes.string,
    currentProject: PropTypes.object,
};

const mapStateToProps: Function = (state: RootState) => {
    return {
        isRequesting: state.project.deleteDomain.requesting,
        deleteError: state.project.deleteDomain.error,
        domainId: state.modal.modals[0].id,
        projectId: state.modal.modals[0].projectId,
        currentProject: state.modal.modals[0].currentProject,
    };
};

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators(
    {
        closeModal,
        deleteProjectDomain,
        fetchProjectDomains,
        resetDeleteProjectDomain,
    },
    dispatch
);

export default connect(mapStateToProps, mapDispatchToProps)(DeleteDomain);
