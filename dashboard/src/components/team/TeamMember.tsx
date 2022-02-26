import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm } from 'redux-form';
import {
    teamDelete,
    teamUpdateRole,
    resetTeamDelete,
} from '../../actions/team';
import { changeProjectRoles, exitProject } from '../../actions/project';
import { TeamListLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { User } from '../../config';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import DataPathHoC from '../DataPathHoC';
import RemoveTeamUserModal from '../modals/RemoveTeamUserModal.js';
import { openModal, closeModal } from '../../actions/modal';
import { history } from '../../store';

import ConfirmChangeRoleModal from '../modals/ConfirmChangeRole';
import DropDownMenu from '../basic/DropDownMenu';
import ExitProjectModal from '../settings/ExitProjectModal';
import RenderIfSubProjectMember from '../basic/RenderIfSubProjectMember';

export class TeamMember extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            removeUserModalId: uuidv4(),
            ConfirmationDialogId: uuidv4(),
        };
        this.removeTeamMember = this.removeTeamMember.bind(this);
        this.updateTeamMemberRole = this.updateTeamMemberRole.bind(this);
    }

    removeTeamMember(values: $TSFixMe) {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetTeamDelete' does not exist on type ... Remove this comment to see the full error message
            resetTeamDelete,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'teamDelete' does not exist on type 'Read... Remove this comment to see the full error message
            teamDelete,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectId' does not exist on type 'Re... Remove this comment to see the full error message
            subProjectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
            closeModal,
        } = this.props;
        teamDelete(subProjectId, values.userId).then((value: $TSFixMe) => {
            if (!value.error) {
                resetTeamDelete();
                return closeModal({
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'removeUserModalId' does not exist on typ... Remove this comment to see the full error message
                    id: this.state.removeUserModalId,
                });
            } else return null;
        });
    }

    updateTeamMemberRole(values: $TSFixMe, to: $TSFixMe) {
        const data = {};
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'teamMemberId' does not exist on type '{}... Remove this comment to see the full error message
        data.teamMemberId = values.userId;
        if (values.role === to) {
            return;
        } else {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'role' does not exist on type '{}'.
            data.role = to;
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'changeProjectRoles' does not exist on ty... Remove this comment to see the full error message
        const { changeProjectRoles } = this.props;
        this.props
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'teamUpdateRole' does not exist on type '... Remove this comment to see the full error message
            .teamUpdateRole(this.props.subProjectId, data)
            .then((team: $TSFixMe) => changeProjectRoles(team.data));
    }

    exitProject = () => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'userId' does not exist on type 'Readonly... Remove this comment to see the full error message
            userId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'nextProject' does not exist on type 'Rea... Remove this comment to see the full error message
            nextProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'exitProject' does not exist on type 'Rea... Remove this comment to see the full error message
            exitProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'dispatch' does not exist on type 'Readon... Remove this comment to see the full error message
            dispatch,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectId' does not exist on type 'Re... Remove this comment to see the full error message
            subProjectId,
        } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
        this.props.openModal({
            id: uuidv4(),
            onConfirm: () => {
                return exitProject(subProjectId, userId).then(function() {
                    window.location.reload();
                    !nextProject && dispatch({ type: 'CLEAR_STORE' });
                });
            },
            content: ExitProjectModal,
        });
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
            handleSubmit,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'userId' does not exist on type 'Readonly... Remove this comment to see the full error message
            userId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleting' does not exist on type 'Readon... Remove this comment to see the full error message
            deleting,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'team' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            team: { subProjectTeamMembers },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'updating' does not exist on type 'Readon... Remove this comment to see the full error message
            updating,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'exitingProject' does not exist on type '... Remove this comment to see the full error message
            exitingProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
        } = this.props;
        let teamMembers = subProjectTeamMembers.map((teamMembers: $TSFixMe) => {
            return teamMembers.teamMembers;
        });
        teamMembers = teamMembers.flat();
        const loggedInUser = User.getUserId();
        const loggedInUserIsOwner = teamMembers.some(
            (user: $TSFixMe) => user.userId === loggedInUser && user.role === 'Owner'
        );

        const isOwner = teamMembers.find(
            (user: $TSFixMe) => user.userId === loggedInUser &&
            user.role === 'Owner' &&
            user.name
        );
        const isAdmin = teamMembers.find(
            (user: $TSFixMe) => user.userId === loggedInUser &&
            user.role === 'Administrator' &&
            user.name
        );

        const mainUser = currentProject?.users.find(
            (user: $TSFixMe) => (user.userId._id || user.userId) === loggedInUser &&
            (user.role === 'Owner' || user.role === 'Administrator')
        );

        return (
            <div
                className="bs-ObjectList-row db-UserListRow db-UserListRow--withName"
                id="added_team_members"
            >
                <div
                    className="bs-ObjectList-cell bs-u-v-middle"
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type 'Readonly<... Remove this comment to see the full error message
                    id={`${this.props.email.split('@')[0]}-profile`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'userId' does not exist on type 'Readonly... Remove this comment to see the full error message
                        history.push('/dashboard/profile/' + this.props.userId);
                    }}
                >
                    <div className="bs-ObjectList-cell-row bs-ObjectList-copy">
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                        {this.props.name ? (
                            <div className="Flex-flex">
                                <img
                                    src="/dashboard/assets/img/profile-user.svg"
                                    className="userIcon--large"
                                    style={{ marginRight: '5px' }}
                                    alt=""
                                />
                                <div>
                                    <div className="bs-ObjectList-copy bs-is-highlighted">
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                        {this.props.name ? this.props.name : ''}
                                    </div>
                                    <div>
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                        {this.props.email
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                            ? this.props.email
                                            : ''}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            ''
                        )}
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                        {!this.props.name && this.props.email ? (
                            <span>
                                <img
                                    src="/dashboard/assets/img/profile-user.svg"
                                    className="userIcon"
                                    style={{ marginRight: '5px' }}
                                    alt=""
                                />
                                <span>
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                    {this.props.email ? this.props.email : ''}
                                </span>
                            </span>
                        ) : (
                            ''
                        )}
                    </div>
                </div>
                <div className="bs-ObjectList-cell bs-u-v-middle">
                    <div
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'role' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                        id={`${this.props.role}_${
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type 'Readonly<... Remove this comment to see the full error message
                            this.props.email.split('@')[0]
                        }`}
                        className="bs-ObjectList-cell-row"
                    >
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'role' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                        {this.props.role}
                    </div>
                </div>
                <div className="bs-ObjectList-cell bs-u-v-middle">
                    <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                        <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                            <span>
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                {this.props.name
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'lastActive' does not exist on type 'Read... Remove this comment to see the full error message
                                    ? 'Online ' + this.props.lastActive
                                    : 'Invitation Sent'}
                            </span>
                        </span>
                    </div>
                </div>
                <div className="bs-ObjectList-cell bs-u-v-middle"></div>
                <div className="bs-ObjectList-cell bs-u-right bs-u-shrink bs-u-v-middle Flex-alignContent--spaceBetween">
                    <div>
                        <RenderIfSubProjectMember currentUserId={userId}>
                            <button
                                id={`memberExit__${
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                    this.props.email.split('@')[0]
                                }`}
                                title="exit"
                                disabled={exitingProject}
                                className="bs-Button bs-DeprecatedButton Margin-left--8"
                                type="button"
                                onClick={this.exitProject}
                            >
                                Exit Project
                            </button>
                        </RenderIfSubProjectMember>
                        <ShouldRender if={isAdmin || isOwner || mainUser}>
                            <div className="Flex-flex Flex-alignContent--spaceBetween">
                                <ShouldRender if={!updating}>
                                    <DropDownMenu
                                        options={[
                                            {
                                                value: 'Owner',
                                                show: loggedInUserIsOwner,
                                            },
                                            {
                                                value: 'Administrator',
                                                show: true,
                                            },
                                            { value: 'Member', show: true },
                                            { value: 'Viewer', show: true },
                                        ]}
                                        value={'Change Role'}
                                        id={`changeRole_${
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                            this.props.email.split('@')[0]
                                        }`}
                                        updateState={(val: $TSFixMe) => {
                                            switch (val) {
                                                case 'Owner':
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
                                                    this.props.openModal({
                                                        id: this.state
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'ConfirmationDialogId' does not exist on ... Remove this comment to see the full error message
                                                            .ConfirmationDialogId,
                                                        content: DataPathHoC(
                                                            ConfirmChangeRoleModal,
                                                            {
                                                                ConfirmationDialogId: this
                                                                    .state
                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'ConfirmationDialogId' does not exist on ... Remove this comment to see the full error message
                                                                    .ConfirmationDialogId,
                                                                name:
                                                                    this.props
                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                                        .name ||
                                                                    this.props
                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                                        .email,
                                                                role: this.props
                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'role' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                                    .role,
                                                                userId: userId,
                                                                newRole:
                                                                    'Owner',
                                                                updating,
                                                                updateTeamMemberRole: this
                                                                    .updateTeamMemberRole,
                                                            }
                                                        ),
                                                    });
                                                    break;
                                                case 'Administrator':
                                                    this.updateTeamMemberRole(
                                                        {
                                                            role: this.props
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'role' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                                .role,
                                                            userId: userId,
                                                        },
                                                        'Administrator'
                                                    );
                                                    break;
                                                case 'Member':
                                                    this.updateTeamMemberRole(
                                                        {
                                                            role: this.props
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'role' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                                .role,
                                                            userId: userId,
                                                        },
                                                        'Member'
                                                    );
                                                    break;
                                                case 'Viewer':
                                                    this.updateTeamMemberRole(
                                                        {
                                                            role: this.props
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'role' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                                .role,
                                                            userId: userId,
                                                        },
                                                        'Viewer'
                                                    );
                                                    break;
                                                default:
                                                    null;
                                                    break;
                                            }
                                        }}
                                    />
                                </ShouldRender>
                                <ShouldRender if={updating}>
                                    <button
                                        disabled={updating}
                                        className="bs-Button bs-DeprecatedButton Margin-left--8"
                                        type="button"
                                    >
                                        <TeamListLoader />
                                    </button>
                                </ShouldRender>
                                <button
                                    id={`removeMember__${
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                        this.props.email.split('@')[0]
                                    }`}
                                    title="delete"
                                    disabled={deleting}
                                    className="bs-Button bs-DeprecatedButton Margin-left--8"
                                    type="button"
                                    onClick={handleSubmit((values: $TSFixMe) => {
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
                                        this.props.openModal({
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'removeUserModalId' does not exist on typ... Remove this comment to see the full error message
                                            id: this.state.removeUserModalId,
                                            content: DataPathHoC(
                                                RemoveTeamUserModal,
                                                {
                                                    removeUserModalId: this
                                                        .state
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'removeUserModalId' does not exist on typ... Remove this comment to see the full error message
                                                        .removeUserModalId,
                                                    values: {
                                                        ...values,
                                                        userId: userId,
                                                    },
                                                    displayName:
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                        this.props.name ||
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                                        this.props.email,
                                                    removeTeamMember: this
                                                        .removeTeamMember,
                                                }
                                            ),
                                        });
                                    })}
                                >
                                    {!deleting && <span>Remove</span>}
                                </button>
                            </div>
                        </ShouldRender>
                    </div>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
TeamMember.displayName = 'TeamMember';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
TeamMember.propTypes = {
    changeProjectRoles: PropTypes.func.isRequired,
    closeModal: PropTypes.func.isRequired,
    deleting: PropTypes.oneOf([null, false, true]),
    email: PropTypes.string.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    lastActive: PropTypes.string.isRequired,
    name: PropTypes.string,
    openModal: PropTypes.func,
    resetTeamDelete: PropTypes.func.isRequired,
    role: PropTypes.string.isRequired,
    subProjectId: PropTypes.string.isRequired,
    team: PropTypes.object.isRequired,
    teamDelete: PropTypes.func.isRequired,
    teamUpdateRole: PropTypes.func.isRequired,
    updating: PropTypes.oneOf([null, false, true]),
    userId: PropTypes.string.isRequired,
    exitingProject: PropTypes.bool,
    exitProject: PropTypes.func,
    nextProject: PropTypes.object,
    dispatch: PropTypes.func.isRequired,
    currentProject: PropTypes.object,
};

const TeamMemberForm = reduxForm({
    form: 'TeamMember',
})(TeamMember);

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            teamDelete,
            teamUpdateRole,
            changeProjectRoles,
            openModal,
            closeModal,
            resetTeamDelete,
            exitProject,
        },
        dispatch
    );
};

function mapStateToProps(state: $TSFixMe, props: $TSFixMe) {
    const userId = User.getUserId();
    const projectId =
        state.project.currentProject && state.project.currentProject._id;

    const { projects } = state.project.projects;

    const nextProject =
        projects.length > 0
            ? projects.find(
                  (project: $TSFixMe) => project._id !== projectId &&
                  project.users.some((user: $TSFixMe) => user.userId === userId)
              )
            : null;
    return {
        team: state.team,
        deleting: state.team.teamdelete.deleting.some(
            (id: $TSFixMe) => id === props.userId
        ),
        updating: state.team.teamUpdateRole.updating.some(
            (id: $TSFixMe) => id === props.userId
        ),
        currentProject: state.project.currentProject,
        subProjects: state.subProject.subProjects.subProjects,
        exitingProject: state.project.exitProject.requesting,
        nextProject,
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(TeamMemberForm);
