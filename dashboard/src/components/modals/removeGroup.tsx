import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

import ClickOutside from 'react-click-outside';
import { FormLoader } from '../basic/Loader';
import { closeModal } from 'common-ui/actions/modal';
import ShouldRender from '../basic/ShouldRender';
import { deleteGroup } from '../../actions/group';

interface removeGroupProps {
    closeModal?: Function;
    closeThisDialog: Function;
    data?: object;
    deleteGroup?: Function;
    groupDelete?: object;
}

class removeGroup extends Component<removeGroupProps> {
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

        const { deleteGroup, data, closeModal } = this.props;
        deleteGroup(data.projectId, data.groupId).then((value: $TSFixMe) => {
            if (!value.error) {
                return closeModal({
                    id: data.groupModalId,
                });
            } else return null;
        });
    };

    render() {

        const { groupDelete, closeModal, data, closeThisDialog } = this.props;
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
                                        <ShouldRender if={groupDelete.error}>
                                            <p className="bs-Modal-message">
                                                {groupDelete.error}
                                            </p>
                                        </ShouldRender>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        Are you sure you want to remove
                                        {` '${data.groupName}'`}
                                    </span>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                            type="button"
                                            onClick={() => {
                                                return closeModal({
                                                    id: data.groupModalId,
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
                                            disabled={groupDelete.requesting}
                                            autoFocus={true}
                                        >
                                            {!groupDelete.requesting && (
                                                <>
                                                    <span>Remove</span>
                                                    <span className="delete-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </>
                                            )}
                                            {groupDelete.requesting && (
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


removeGroup.displayName = 'removeGroup';

const mapStateToProps = (state: $TSFixMe) => {
    return {
        currentProject: state.project.currentProject,
        groupDelete: state.groups.deleteGroup,
    };
};

const mapDispatchToProps = (dispatch: Dispatch) => {
    return bindActionCreators(
        {
            closeModal,
            deleteGroup,
        },
        dispatch
    );
};


removeGroup.propTypes = {
    closeModal: PropTypes.func,
    closeThisDialog: PropTypes.func.isRequired,
    data: PropTypes.object,
    deleteGroup: PropTypes.func,
    groupDelete: PropTypes.object,
};

export default connect(mapStateToProps, mapDispatchToProps)(removeGroup);
