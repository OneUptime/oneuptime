import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import moment from 'moment';
import { history } from '../../store';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import { openModal, closeModal } from '../../actions/modal';
import {
    teamDelete,
    resetTeamDelete,
    changeUserProjectRole,
    userUpdateRole,
} from '../../actions/project';
import { User } from '../../config';
import ProjectUserAddModal from './ProjectUserAddModal';
import ProjectRemoveUserModal from './ProjectRemoveUserModal';
import ShouldRender from '../basic/ShouldRender';
import DataPathHoC from '../DataPathHoC';
import { TeamListLoader } from '../basic/Loader';
import DropDownMenu from '../basic/DropDownMenu';

class ProjectUser extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            addUserId: uuidv4(),
            removeUserModalId: uuidv4(),
        };
    }
    handleClick = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'addUserId' does not exist on type 'Reado... Remove this comment to see the full error message
        const { addUserId } = this.state;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
        this.props.openModal({
            id: addUserId,
            onConfirm: () => true,
            content: DataPathHoC(ProjectUserAddModal, {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
                projectId: this.props.projectId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectName' does not exist on type 'Rea... Remove this comment to see the full error message
                projectName: this.props.projectName,
            }),
        });
    };
    updateTeamMemberRole = (values: $TSFixMe, to: $TSFixMe) => {
        const data = {};
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'teamMemberId' does not exist on type '{}... Remove this comment to see the full error message
        data.teamMemberId = values.userId;
        if (values.role === to) {
            return;
        } else {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'role' does not exist on type '{}'.
            data.role = to;
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
        const { projectId, changeUserProjectRole, userUpdateRole } = this.props;
        userUpdateRole(projectId, data).then((team: $TSFixMe) => changeUserProjectRole(team.data)
        );
    };
    removeTeamMember = (values: $TSFixMe) => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetTeamDelete' does not exist on type ... Remove this comment to see the full error message
            resetTeamDelete,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'teamDelete' does not exist on type 'Read... Remove this comment to see the full error message
            teamDelete,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
            closeModal,
        } = this.props;
        teamDelete(projectId, values.userId).then((value: $TSFixMe) => {
            if (!value.error) {
                resetTeamDelete();
                return closeModal({
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'removeUserModalId' does not exist on typ... Remove this comment to see the full error message
                    id: this.state.removeUserModalId,
                });
            } else return null;
        });
    };
    renderTable = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
        const { handleSubmit, updateUsers, pages, membersPerPage } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'users' does not exist on type 'Readonly<... Remove this comment to see the full error message
        return this.props.users &&
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'users' does not exist on type 'Readonly<... Remove this comment to see the full error message
        this.props.users.teamMembers &&
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'users' does not exist on type 'Readonly<... Remove this comment to see the full error message
        this.props.users.teamMembers.map((user: $TSFixMe, i: $TSFixMe) => {
            if (
                i >= pages * membersPerPage - membersPerPage &&
                i < pages * membersPerPage
            ) {
                return (
                    <div className="bs-ObjectList-row db-UserListRow db-UserListRow--withName">
                        <div
                            className="bs-ObjectList-cell bs-u-v-middle"
                            style={{ cursor: 'pointer' }}
                            onClick={() => {
                                history.push('/admin/users/' + user.userId);
                            }}
                        >
                            <div className="bs-ObjectList-cell-row bs-ObjectList-copy bs-is-highlighted">
                                {user.name ? (
                                    <span>
                                        <span>
                                            {user.name ? user.name : ''}
                                        </span>
                                    </span>
                                ) : (
                                    ''
                                )}
                                {!user.name && user.email ? (
                                    <span>
                                        <span>
                                            {user.email ? user.email : ''}
                                        </span>
                                    </span>
                                ) : (
                                    ''
                                )}
                            </div>
                        </div>
                        <div className="bs-ObjectList-cell bs-u-v-middle">
                            <div
                                id={`${user.role}_${
                                    user.email.split('@')[0]
                                }`}
                                className="bs-ObjectList-cell-row"
                            >
                                {user.role}
                            </div>
                        </div>
                        <div className="bs-ObjectList-cell bs-u-v-middle">
                            <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                    <span>
                                        {user && user.name
                                            ? 'Online ' +
                                              moment(
                                                  user && user.lastActive
                                              ).fromNow()
                                            : 'Invitation Sent'}
                                    </span>
                                </span>
                            </div>
                        </div>
                        <div className="bs-ObjectList-cell bs-u-v-middle"></div>
                        <div className="bs-ObjectList-cell bs-u-right bs-u-shrink bs-u-v-middle Flex-alignContent--spaceBetween">
                            <div>
                                <ShouldRender
                                    if={
                                        !(
                                            User.getUserId() ===
                                                user.userId &&
                                            user.role === 'Owner'
                                        )
                                    }
                                >
                                    <div className="Flex-flex Flex-alignContent--spaceBetween">
                                        <ShouldRender
                                            if={
                                                !(
                                                    updateUsers.requesting &&
                                                    updateUsers.updating.includes(
                                                        user.userId
                                                    )
                                                )
                                            }
                                        >
                                            <DropDownMenu
                                                options={[
                                                    {
                                                        value: 'Owner',
                                                        show: true,
                                                    },
                                                    {
                                                        value:
                                                            'Administrator',
                                                        show: true,
                                                    },
                                                    {
                                                        value: 'Member',
                                                        show: true,
                                                    },
                                                    {
                                                        value: 'Viewer',
                                                        show: true,
                                                    },
                                                ]}
                                                value={'Change Role'}
                                                id={`changeRole_${
                                                    user.email.split('@')[0]
                                                }`}
                                                title="Change Role"
                                                updateState={(val: $TSFixMe) => {
                                                    switch (val) {
                                                        case 'Owner':
                                                            this.updateTeamMemberRole(
                                                                {
                                                                    role:
                                                                        user.role,
                                                                    userId:
                                                                        user.userId,
                                                                },
                                                                'Owner'
                                                            );
                                                            break;
                                                        case 'Administrator':
                                                            this.updateTeamMemberRole(
                                                                {
                                                                    role:
                                                                        user.role,
                                                                    userId:
                                                                        user.userId,
                                                                },
                                                                'Administrator'
                                                            );
                                                            break;
                                                        case 'Member':
                                                            this.updateTeamMemberRole(
                                                                {
                                                                    role:
                                                                        user.role,
                                                                    userId:
                                                                        user.userId,
                                                                },
                                                                'Member'
                                                            );
                                                            break;
                                                        case 'Viewer':
                                                            this.updateTeamMemberRole(
                                                                {
                                                                    role:
                                                                        user.role,
                                                                    userId:
                                                                        user.userId,
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
                                        <ShouldRender
                                            if={
                                                updateUsers.requesting &&
                                                updateUsers.updating.includes(
                                                    user.userId
                                                )
                                            }
                                        >
                                            <button
                                                disabled={
                                                    updateUsers.requesting &&
                                                    updateUsers.updating.includes(
                                                        user.userId
                                                    )
                                                }
                                                className="bs-Button bs-DeprecatedButton Margin-left--8"
                                                type="button"
                                            >
                                                <TeamListLoader />
                                            </button>
                                        </ShouldRender>
                                        <button
                                            id={`removeMember__${
                                                user.email.split('@')[0]
                                            }`}
                                            title="delete"
                                            disabled={false}
                                            className="bs-Button bs-DeprecatedButton Margin-left--8"
                                            type="button"
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
                                            onClick={handleSubmit((values: $TSFixMe) => this.props.openModal({
                                                id: this.state
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'removeUserModalId' does not exist on typ... Remove this comment to see the full error message
                                                    .removeUserModalId,
                                                content: DataPathHoC(
                                                    ProjectRemoveUserModal,
                                                    {
                                                        removeUserModalId: this
                                                            .state
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'removeUserModalId' does not exist on typ... Remove this comment to see the full error message
                                                            .removeUserModalId,
                                                        values: {
                                                            ...values,
                                                            userId:
                                                                user.userId,
                                                        },
                                                        displayName:
                                                            user.name ||
                                                            user.email,
                                                        removeTeamMember: this
                                                            .removeTeamMember,
                                                    }
                                                ),
                                            })
                                            )}
                                        >
                                            {!false && <span>Remove</span>}
                                        </button>
                                    </div>
                                </ShouldRender>
                            </div>
                        </div>
                    </div>
                );
            } else {
                return null;
            }
        });
    };
    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type 'Readonly<... Remove this comment to see the full error message
            count,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateUsers' does not exist on type 'Rea... Remove this comment to see the full error message
            updateUsers,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteError' does not exist on type 'Rea... Remove this comment to see the full error message
            deleteError,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'canPaginateBackward' does not exist on t... Remove this comment to see the full error message
            canPaginateBackward,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'canPaginateForward' does not exist on ty... Remove this comment to see the full error message
            canPaginateForward,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'paginate' does not exist on type 'Readon... Remove this comment to see the full error message
            paginate,
        } = this.props;
        const numberOfPages = Math.ceil(parseInt(count) / 10);
        return (
            <div className="Box-root">
                <div className="ContentHeader Box-root Card-shadow--medium Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-vertical--16">
                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                        <div
                            className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center"
                            style={{ paddingLeft: '20px' }}
                        >
                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                <span
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectName' does not exist on type 'Rea... Remove this comment to see the full error message
                                    id={`project_${this.props.projectName}`}
                                    style={{ textTransform: 'capitalize' }}
                                >
                                    Project Users
                                </span>
                            </span>
                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                <span>
                                    Here are all the users who belong to{' '}
                                    <span
                                        style={{ textTransform: 'lowercase' }}
                                    >
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectName' does not exist on type 'Rea... Remove this comment to see the full error message
                                        {this.props.projectName}
                                    </span>
                                </span>
                            </span>
                        </div>
                        <div
                            className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16"
                            style={{ paddingRight: '10px' }}
                        >
                            <div className="Box-root">
                                <button
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectName' does not exist on type 'Rea... Remove this comment to see the full error message
                                    id={`btn_${this.props.projectName}`}
                                    onClick={this.handleClick}
                                    className="Button bs-ButtonLegacy ActionIconParent"
                                    type="button"
                                >
                                    <div className="bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                        <div className="Box-root Margin-right--8">
                                            <div className="SVGInline SVGInline--cleaned Button-icon ActionIcon ActionIcon--color--inherit Box-root Flex-flex"></div>
                                        </div>

                                        <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new keycode__wrapper">
                                            <span>Add User</span>
                                            <span className="new-btn__keycode">
                                                N
                                            </span>
                                        </span>
                                    </div>
                                </button>
                            </div>
                        </div>
                    </div>
                    <div>
                        <div className="bs-ContentSection-content Box-root">
                            <div className="bs-ObjectList db-UserList">
                                <div>
                                    <div className="bs-ObjectList-rows">
                                        <header className="bs-ObjectList-row bs-ObjectList-row--header">
                                            <div className="bs-ObjectList-cell">
                                                Users
                                            </div>
                                            <div className="bs-ObjectList-cell">
                                                Role
                                            </div>
                                            <div className="bs-ObjectList-cell">
                                                Status
                                            </div>
                                            <div className="bs-ObjectList-cell"></div>
                                            <div
                                                className="bs-ObjectList-cell"
                                                style={{
                                                    float: 'right',
                                                    marginRight: '10px',
                                                }}
                                            >
                                                Action
                                            </div>
                                        </header>
                                        {this.renderTable()}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <ShouldRender if={deleteError.error}>
                                    <div className="bs-Tail-copy">
                                        <div
                                            className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                            style={{
                                                textAlign: 'center',
                                                marginTop: '10px',
                                                padding: '0 10px',
                                            }}
                                        >
                                            <div className="Box-root Margin-right--8">
                                                <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                            </div>
                                            <div className="Box-root">
                                                <span style={{ color: 'red' }}>
                                                    {deleteError.error}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </ShouldRender>
                                <ShouldRender if={updateUsers.error}>
                                    <div className="bs-Tail-copy">
                                        <div
                                            className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                            style={{
                                                textAlign: 'center',
                                                marginTop: '10px',
                                                padding: '0 10px',
                                            }}
                                        >
                                            <div className="Box-root Margin-right--8">
                                                <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                            </div>
                                            <div className="Box-root">
                                                <span style={{ color: 'red' }}>
                                                    {updateUsers.error}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </ShouldRender>
                                <ShouldRender
                                    if={
                                        !updateUsers.error && !deleteError.error
                                    }
                                >
                                    <div className="bs-Tail-copy">
                                        <span id={`count_kolawole`}>
                                            {count
                                                ? `Page ${
                                                      // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                      this.props.page
                                                  } of ${numberOfPages} (${count} User${
                                                      count === 1 ? '' : 's'
                                                  })`
                                                : null}
                                        </span>
                                    </div>
                                </ShouldRender>
                            </div>
                            <div className="ButtonGroup Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                <div className="Box-root Margin-right--8">
                                    <button
                                        data-test="TeamSettings-paginationButton"
                                        className={`Button bs-ButtonLegacy ${
                                            !canPaginateBackward
                                                ? 'Is--disabled'
                                                : ''
                                        }`}
                                        disabled={!canPaginateBackward}
                                        type="button"
                                        onClick={() => paginate('prev')}
                                    >
                                        <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                            <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                <span>Previous</span>
                                            </span>
                                        </div>
                                    </button>
                                </div>
                                <div className="Box-root">
                                    <button
                                        data-test="TeamSettings-paginationButton"
                                        className={`Button bs-ButtonLegacy ${
                                            !canPaginateForward
                                                ? 'Is--disabled'
                                                : ''
                                        }`}
                                        disabled={!canPaginateForward}
                                        type="button"
                                        onClick={() => paginate('next')}
                                    >
                                        <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                            <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                <span>Next</span>
                                            </span>
                                        </div>
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ProjectUser.displayName = 'ProjectUser';

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            openModal,
            closeModal,
            teamDelete,
            resetTeamDelete,
            changeUserProjectRole,
            userUpdateRole,
        },
        dispatch
    );
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ProjectUser.propTypes = {
    users: PropTypes.oneOfType([
        PropTypes.array,
        PropTypes.oneOf([null, undefined]),
    ]),
    openModal: PropTypes.func.isRequired,
    closeModal: PropTypes.func.isRequired,
    teamDelete: PropTypes.func.isRequired,
    resetTeamDelete: PropTypes.func,
    projectId: PropTypes.string.isRequired,
    handleSubmit: PropTypes.func,
    changeUserProjectRole: PropTypes.func,
    userUpdateRole: PropTypes.func,
    updateUsers: PropTypes.object.isRequired,
    pages: PropTypes.number,
    membersPerPage: PropTypes.number,
    count: PropTypes.number,
    deleteError: PropTypes.object,
    canPaginateBackward: PropTypes.bool.isRequired,
    canPaginateForward: PropTypes.bool.isRequired,
    paginate: PropTypes.func.isRequired,
    projectName: PropTypes.string,
    page: PropTypes.number,
};

function mapStateToProps(state: $TSFixMe) {
    return {
        updateUsers: state.project.updateUser,
        deleteError: state.project.teamDelete,
    };
}

const ProjectUsers = reduxForm({
    form: 'ProjectUsers',
})(ProjectUser);

export default connect(mapStateToProps, mapDispatchToProps)(ProjectUsers);
