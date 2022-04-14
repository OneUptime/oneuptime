import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

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

import { v4 as uuidv4 } from 'uuid';
import DataPathHoC from '../DataPathHoC';
import RemoveTeamUserModal from '../modals/RemoveTeamUserModal.js';
import { openModal, closeModal } from 'CommonUI/actions/modal';
import { history, RootState } from '../../store';

import ConfirmChangeRoleModal from '../modals/ConfirmChangeRole';
import DropDownMenu from '../basic/DropDownMenu';
import ExitProjectModal from '../settings/ExitProjectModal';
import RenderIfSubProjectMember from '../basic/RenderIfSubProjectMember';

export class TeamMember extends Component<ComponentProps>{
    public static displayName = '';
    public static propTypes = {};

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

            resetTeamDelete,

            teamDelete,

            subProjectId,

            closeModal,
        } = this.props;
        teamDelete(subProjectId, values.userId).then((value: $TSFixMe) => {
            if (!value.error) {
                resetTeamDelete();
                return closeModal({

                    id: this.state.removeUserModalId,
                });
            } else return null;
        });
    }

    updateTeamMemberRole(values: $TSFixMe, to: $TSFixMe) {
        const data: $TSFixMe = {};

        data.teamMemberId = values.userId;
        if (values.role === to) {
            return;
        } else {

            data.role = to;
        }

        const { changeProjectRoles }: $TSFixMe = this.props;
        this.props

            .teamUpdateRole(this.props.subProjectId, data)
            .then((team: $TSFixMe) => changeProjectRoles(team.data));
    }

    exitProject = () => {
        const {

            userId,

            nextProject,

            exitProject,

            dispatch,

            subProjectId,
        } = this.props;

        this.props.openModal({
            id: uuidv4(),
            onConfirm: () => {
                return exitProject(subProjectId, userId).then(function () {
                    window.location.reload();
                    !nextProject && dispatch({ type: 'CLEAR_STORE' });
                });
            },
            content: ExitProjectModal,
        });
    };

    override render() {
        const {

            handleSubmit,

            userId,

            deleting,

            team: { subProjectTeamMembers },

            updating,

            exitingProject,

            currentProject,
        } = this.props;
        let teamMembers = subProjectTeamMembers.map((teamMembers: $TSFixMe) => {
            return teamMembers.teamMembers;
        });
        teamMembers = teamMembers.flat();
        const loggedInUser: $TSFixMe = User.getUserId();
        const loggedInUserIsOwner: $TSFixMe = teamMembers.some(
            (user: $TSFixMe) => user.userId === loggedInUser && user.role === 'Owner'
        );

        const isOwner: $TSFixMe = teamMembers.find(
            (user: $TSFixMe) => user.userId === loggedInUser &&
                user.role === 'Owner' &&
                user.name
        );
        const isAdmin: $TSFixMe = teamMembers.find(
            (user: $TSFixMe) => user.userId === loggedInUser &&
                user.role === 'Administrator' &&
                user.name
        );

        const mainUser: $TSFixMe = currentProject?.users.find(
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

                    id={`${this.props.email.split('@')[0]}-profile`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => {

                        history.push('/dashboard/profile/' + this.props.userId);
                    }}
                >
                    <div className="bs-ObjectList-cell-row bs-ObjectList-copy">

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

                                        {this.props.name ? this.props.name : ''}
                                    </div>
                                    <div>

                                        {this.props.email

                                            ? this.props.email
                                            : ''}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            ''
                        )}

                        {!this.props.name && this.props.email ? (
                            <span>
                                <img
                                    src="/dashboard/assets/img/profile-user.svg"
                                    className="userIcon"
                                    style={{ marginRight: '5px' }}
                                    alt=""
                                />
                                <span>

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

                        id={`${this.props.role}_${this.props.email.split('@')[0]
                            }`}
                        className="bs-ObjectList-cell-row"
                    >

                        {this.props.role}
                    </div>
                </div>
                <div className="bs-ObjectList-cell bs-u-v-middle">
                    <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                        <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                            <span>

                                {this.props.name

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
                                id={`memberExit__${this.props.email.split('@')[0]
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
                                        id={`changeRole_${this.props.email.split('@')[0]
                                            }`}
                                        updateState={(val: $TSFixMe) => {
                                            switch (val) {
                                                case 'Owner':

                                                    this.props.openModal({
                                                        id: this.state

                                                            .ConfirmationDialogId,
                                                        content: DataPathHoC(
                                                            ConfirmChangeRoleModal,
                                                            {
                                                                ConfirmationDialogId: this
                                                                    .state

                                                                    .ConfirmationDialogId,
                                                                name:
                                                                    this.props

                                                                        .name ||
                                                                    this.props

                                                                        .email,
                                                                role: this.props

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
                                    id={`removeMember__${this.props.email.split('@')[0]
                                        }`}
                                    title="delete"
                                    disabled={deleting}
                                    className="bs-Button bs-DeprecatedButton Margin-left--8"
                                    type="button"
                                    onClick={handleSubmit((values: $TSFixMe) => {

                                        this.props.openModal({

                                            id: this.state.removeUserModalId,
                                            content: DataPathHoC(
                                                RemoveTeamUserModal,
                                                {
                                                    removeUserModalId: this
                                                        .state

                                                        .removeUserModalId,
                                                    values: {
                                                        ...values,
                                                        userId: userId,
                                                    },
                                                    displayName:

                                                        this.props.name ||

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


TeamMember.displayName = 'TeamMember';


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

const TeamMemberForm: $TSFixMe = reduxForm({
    form: 'TeamMember',
})(TeamMember);

const mapDispatchToProps: Function = (dispatch: Dispatch) => {
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

function mapStateToProps(state: RootState, props: $TSFixMe) {
    const userId: $TSFixMe = User.getUserId();
    const projectId: $TSFixMe =
        state.project.currentProject && state.project.currentProject._id;

    const { projects }: $TSFixMe = state.project.projects;

    const nextProject: $TSFixMe =
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
