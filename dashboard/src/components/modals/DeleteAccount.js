import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { FormLoader } from '../basic/Loader';
import { connect } from 'react-redux';
import ShouldRender from '../basic/ShouldRender';
import { SHOULD_LOG_ANALYTICS } from '../../config';
import { logEvent } from '../../analytics';
import { bindActionCreators } from 'redux';
import { deleteAccount } from '../../actions/profile';
import { logoutUser } from '../../actions/logout';
import { teamLoading, subProjectTeamLoading } from '../../actions/team';

class DeleteAccount extends Component {
    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeThisDialog();
            default:
                return false;
        }
    };

    deleteAccount = () => {
        const userId = this.props.profileSettings.data.id;
        const promise = this.props.deleteAccount(userId);
        this.props.logoutUser();
        if (SHOULD_LOG_ANALYTICS) {
            logEvent('EVENT: DASHBOARD > PROFILE > ACCOUNT DELETED', {
                userId,
            });
        }
        return promise;
    };

    ownProjects = userId => {
        const { projects } = this.props;
        return projects.filter(project => {
            return project.users.find(
                user =>
                    user.userId === userId &&
                    user.role === 'Owner' &&
                    project.users.length > 1
            );
        });
    };

    projectsWithoutMultipleOwners = userId => {
        const projects = this.ownProjects(userId);
        return projects.filter(project => {
            const otherOwner = project.users.find(
                user => user.userId !== userId && user.role === 'Owner'
            );
            return otherOwner ? false : true;
        });
    };

    renderOwnProjects = userId => {
        const projects = this.projectsWithoutMultipleOwners(userId);
        return projects.map(project => {
            return <li key={project._id}>{project.name}</li>;
        });
    };

    render() {
        const deleting = this.props.deleteAccountSetting.requesting;
        const { profileSettings } = this.props;
        const userId = profileSettings.data.id;
        const shouldRender =
            this.projectsWithoutMultipleOwners(userId).length > 0;

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
                                        <span>Confirm Deletion</span>
                                    </span>
                                </div>
                            </div>
                            <div className="bs-Modal-content">
                                <ShouldRender if={shouldRender}>
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        You are the owner of the following
                                        projects, you need to make someone else
                                        the owner of these projects before you
                                        can delete your account.
                                    </span>
                                    <div className="bs-Fieldset-row">
                                        <ul>
                                            {this.renderOwnProjects(userId)}
                                        </ul>
                                    </div>
                                </ShouldRender>
                                <ShouldRender if={!shouldRender}>
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        Are you sure you want to delete your
                                        account?
                                    </span>
                                </ShouldRender>
                            </div>
                            <div className="bs-Modal-footer">
                                <div className="bs-Modal-footer-actions">
                                    <button
                                        className="bs-Button bs-DeprecatedButton bs-Button--grey"
                                        type="button"
                                        onClick={this.props.closeThisDialog}
                                    >
                                        <span>Cancel</span>
                                    </button>
                                    <ShouldRender if={!shouldRender}>
                                        <button
                                            id="btn_confirm_delete"
                                            className="bs-Button bs-DeprecatedButton bs-Button--red"
                                            type="button"
                                            disabled={deleting}
                                            onClick={this.deleteAccount}
                                        >
                                            {!deleting && <span>Delete</span>}
                                            {deleting && <FormLoader />}
                                        </button>
                                    </ShouldRender>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

DeleteAccount.displayName = 'DeleteAccount';

DeleteAccount.propTypes = {
    closeThisDialog: PropTypes.func.isRequired,
    deleteAccountSetting: PropTypes.shape({ requesting: PropTypes.bool }),
    profileSettings: PropTypes.shape({
        data: PropTypes.shape({ id: PropTypes.string }),
    }),
    currentProject: PropTypes.shape({ _id: PropTypes.string }),
    deleteAccount: PropTypes.func,
    logoutUser: PropTypes.func,
    projects: PropTypes.array,
};

const mapStateToProps = state => {
    return {
        deleteAccountSetting: state.profileSettings.deleteAccount,
        profileSettings: state.profileSettings.profileSetting,
        currentProject: state.project.currentProject,
        projects: state.project.projects.projects,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        { deleteAccount, logoutUser, teamLoading, subProjectTeamLoading },
        dispatch
    );

export default connect(mapStateToProps, mapDispatchToProps)(DeleteAccount);
