import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { closeModal } from '../../actions/modal';
import { resetTeamDelete } from '../../actions/team';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';

class RemoveTeamUserModal extends Component {
    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                this.props.resetTeamDelete();
                return this.props.closeThisDialog();
            default:
                return false;
        }
    };

    render() {
        const {
            teamUserDelete,
            closeModal,
            data,
            resetTeamDelete,
            deleting,
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
                                        className="bs-Button bs-DeprecatedButton bs-Button--grey"
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
                                    </button>
                                    <button
                                        id="removeTeamUser"
                                        className="bs-Button bs-DeprecatedButton bs-Button--red"
                                        disabled={deleting}
                                        type="button"
                                        onClick={() =>
                                            data.removeTeamMember(data.values)
                                        }
                                    >
                                        {!deleting && <span>Remove</span>}
                                        {deleting && <FormLoader />}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

RemoveTeamUserModal.displayName = 'RemoveTeamUserModal';

const mapStateToProps = (state, props) => {
    const userId =
        props.data && props.data.values && props.data.values.userId
            ? props.data.values.userId
            : null;
    return {
        teamUserDelete: state.team.teamdelete,
        deleting: state.team.teamdelete.deleting.some(id => id === userId),
    };
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators({ closeModal, resetTeamDelete }, dispatch);
};

RemoveTeamUserModal.propTypes = {
    closeModal: PropTypes.func,
    closeThisDialog: PropTypes.func.isRequired,
    data: PropTypes.object,
    deleting: PropTypes.bool,
    resetTeamDelete: PropTypes.any,
    teamUserDelete: PropTypes.any,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(RemoveTeamUserModal);
