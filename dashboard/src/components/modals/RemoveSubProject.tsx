import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';

import ClickOutside from 'react-click-outside';
import { FormLoader } from '../basic/Loader';
import { closeModal } from '../../actions/modal';
import {
    deleteSubProject,
    resetDeleteSubProject,
} from '../../actions/subProject';
import ShouldRender from '../basic/ShouldRender';
import { resetProjectNotification } from '../../actions/notification';

class RemoveSubProject extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                return this.props.closeThisDialog();
            case 'Enter':
                return this.deleteSubProject();
            default:
                return false;
        }
    };

    deleteSubProject = () => {
        const {

            resetDeleteSubProject,

            deleteSubProject,

            currentProject,

            data,

            closeModal,

            resetProjectNotification,
        } = this.props;
        deleteSubProject(currentProject._id, data.subProjectId).then((value: $TSFixMe) => {
            if (!value.error) {
                resetDeleteSubProject();
                resetProjectNotification(data.subProjectId);
                return closeModal({
                    id: data.subProjectModalId,
                });
            } else return null;
        });
    };

    render() {
        const {

            subProjectDelete,

            closeModal,

            data,

            resetDeleteSubProject,

            closeThisDialog,
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
                                            <span>Confirm Removal</span>
                                        </span>
                                    </div>
                                    <div className="bs-Modal-messages">
                                        <ShouldRender
                                            if={subProjectDelete.error}
                                        >
                                            <p className="bs-Modal-message">
                                                {subProjectDelete.error}
                                            </p>
                                        </ShouldRender>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        Are you sure you want to remove this
                                        sub-project?
                                    </span>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                            type="button"
                                            onClick={() => {
                                                resetDeleteSubProject();
                                                return closeModal({
                                                    id: data.subProjectModalId,
                                                });
                                            }}
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="removeSubProject"
                                            className="bs-Button bs-DeprecatedButton bs-Button--red btn__modal"
                                            type="button"
                                            onClick={() =>
                                                this.deleteSubProject()
                                            }
                                            disabled={
                                                subProjectDelete.requesting
                                            }
                                            autoFocus={true}
                                        >
                                            {!subProjectDelete.requesting && (
                                                <>
                                                    <span>Remove</span>
                                                    <span className="delete-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </>
                                            )}
                                            {subProjectDelete.requesting && (
                                                <FormLoader />
                                            )}
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


RemoveSubProject.displayName = 'RemoveSubProjectFormModal';

const mapStateToProps = (state: $TSFixMe) => {
    return {
        currentProject: state.project.currentProject,
        subProjectDelete: state.subProject.deleteSubProject,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            closeModal,
            deleteSubProject,
            resetDeleteSubProject,
            resetProjectNotification,
        },
        dispatch
    );
};


RemoveSubProject.propTypes = {
    closeModal: PropTypes.func,
    closeThisDialog: PropTypes.func.isRequired,
    currentProject: PropTypes.object,
    data: PropTypes.object,
    deleteSubProject: PropTypes.func,
    resetDeleteSubProject: PropTypes.func,
    subProjectDelete: PropTypes.func,
    resetProjectNotification: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(RemoveSubProject);
