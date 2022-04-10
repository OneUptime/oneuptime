import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

import ClickOutside from 'react-click-outside';
import { closeModal } from 'CommonUI/actions/modal';
import { resetTeamDelete } from '../../actions/team';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';

interface RemoveTeamUserModalProps {
    closeModal?: Function;
    data?: object;
    deleting?: boolean;
    resetTeamDelete?: any;
    teamUserDelete?: any;
}

class RemoveTeamUserModal extends Component<ComponentProps> {
    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {

        const { data, resetTeamDelete } = this.props;
        switch (e.key) {
            case 'Escape':
                resetTeamDelete();
                return this.handleCloseModal();
            case 'Enter':
                return data.removeTeamMember(data.values);
            default:
                return false;
        }
    };

    handleCloseModal = () => {

        this.props.closeModal({

            id: this.props.data.removeUserModalId,
        });
    };

    override render() {
        const {

            teamUserDelete,

            closeModal,

            data,

            resetTeamDelete,

            deleting,
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
                            <ClickOutside
                                onClickOutside={this.handleCloseModal}
                            >
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Confirm Removal</span>
                                        </span>
                                    </div>
                                    <div className="bs-Modal-messages">
                                        <ShouldRender if={teamUserDelete.error}>
                                            <p className="bs-Modal-message">
                                                {teamUserDelete.error}
                                            </p>
                                        </ShouldRender>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        Are you sure you want to remove{' '}
                                        {data.displayName
                                            ? data.displayName
                                            : 'this user'}{' '}
                                        from the team?
                                    </span>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                            disabled={deleting}
                                            type="button"
                                            onClick={() => {
                                                resetTeamDelete();
                                                return closeModal({
                                                    id: data.removeUserModalId,
                                                });
                                            }}
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="removeTeamUser"
                                            className="bs-Button bs-DeprecatedButton bs-Button--red btn__modal"
                                            disabled={deleting}
                                            type="button"
                                            onClick={() =>
                                                data.removeTeamMember(
                                                    data.values
                                                )
                                            }
                                            autoFocus={true}
                                        >
                                            {!deleting && (
                                                <>
                                                    <span>Remove</span>
                                                    <span className="delete-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </>
                                            )}
                                            {deleting && <FormLoader />}
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


RemoveTeamUserModal.displayName = 'RemoveTeamUserModal';

const mapStateToProps = (state: RootState, props: $TSFixMe) => {
    const userId =
        props.data && props.data.values && props.data.values.userId
            ? props.data.values.userId
            : null;
    return {
        teamUserDelete: state.team.teamdelete,
        deleting: state.team.teamdelete.deleting.some((id: $TSFixMe) => id === userId),
    };
};

const mapDispatchToProps = (dispatch: Dispatch) => {
    return bindActionCreators({ closeModal, resetTeamDelete }, dispatch);
};


RemoveTeamUserModal.propTypes = {
    closeModal: PropTypes.func,
    data: PropTypes.object,
    deleting: PropTypes.bool,
    resetTeamDelete: PropTypes.any,
    teamUserDelete: PropTypes.any,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(RemoveTeamUserModal);
