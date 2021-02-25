import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import Dropdown, { MenuItem } from '@trendmicro/react-dropdown';
import moment from 'moment';
import { history } from '../../store';
import uuid from 'uuid';
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
import '@trendmicro/react-dropdown/dist/react-dropdown.css';

class ProjectUser extends Component {
    constructor(props) {
        super(props);
        this.state = {
            addUserId: uuid.v4(),
            removeUserModalId: uuid.v4(),
        };
    }
    handleClick = () => {
        const { addUserId } = this.state;
        this.props.openModal({
            id: addUserId,
            onConfirm: () => true,
            content: DataPathHoC(ProjectUserAddModal, {
                projectId: this.props.projectId,
                projectName: this.props.projectName,
            }),
        });
    };
    updateTeamMemberRole = (values, to) => {
        const data = {};
        data.teamMemberId = values.userId;
        if (values.role === to) {
            return;
        } else {
            data.role = to;
        }
        const { changeUserProjectRole, projectId, userUpdateRole } = this.props;
        userUpdateRole(projectId, data).then(team =>
            changeUserProjectRole(team.data)
        );
    };
    removeTeamMember = values => {
        const {
            resetTeamDelete,
            teamDelete,
            projectId,
            closeModal,
        } = this.props;
        teamDelete(projectId, values.userId).then(value => {
            if (!value.error) {
                resetTeamDelete();
                return closeModal({
                    id: this.state.removeUserModalId,
                });
            } else return null;
        });
    };
    renderTable = () => {
        const { handleSubmit, updateUsers, pages, membersPerPage } = this.props;
        return (
            this.props.users &&
            this.props.users.teamMembers &&
            this.props.users.teamMembers.map((user, i) => {
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
                                            <Dropdown
                                                disabled={
                                                    updateUsers.requesting &&
                                                    updateUsers.updating.includes(
                                                        user.userId
                                                    )
                                                }
                                            >
                                                {!(
                                                    updateUsers.requesting &&
                                                    updateUsers.updating.includes(
                                                        user.userId
                                                    )
                                                ) && (
                                                    <Dropdown.Toggle
                                                        id={`changeRole_${
                                                            user.email.split(
                                                                '@'
                                                            )[0]
                                                        }`}
                                                        title="Change Role"
                                                        className="bs-Button bs-DeprecatedButton"
                                                    />
                                                )}
                                                {updateUsers.requesting &&
                                                    updateUsers.updating.includes(
                                                        user.userId
                                                    ) && (
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
                                                    )}

                                                <Dropdown.Menu>
                                                    <MenuItem
                                                        title="Owner"
                                                        onClick={handleSubmit(
                                                            values =>
                                                                this.updateTeamMemberRole(
                                                                    {
                                                                        ...values,
                                                                        role:
                                                                            user.role,
                                                                        userId:
                                                                            user.userId,
                                                                    },
                                                                    'Owner'
                                                                )
                                                        )}
                                                    >
                                                        Owner
                                                    </MenuItem>
                                                    <MenuItem
                                                        title="Administrator"
                                                        onClick={handleSubmit(
                                                            values =>
                                                                this.updateTeamMemberRole(
                                                                    {
                                                                        ...values,
                                                                        role:
                                                                            user.role,
                                                                        userId:
                                                                            user.userId,
                                                                    },
                                                                    'Administrator'
                                                                )
                                                        )}
                                                    >
                                                        Administrator
                                                    </MenuItem>
                                                    <MenuItem
                                                        title="Member"
                                                        onClick={handleSubmit(
                                                            values =>
                                                                this.updateTeamMemberRole(
                                                                    {
                                                                        ...values,
                                                                        role:
                                                                            user.role,
                                                                        userId:
                                                                            user.userId,
                                                                    },
                                                                    'Member'
                                                                )
                                                        )}
                                                    >
                                                        Member
                                                    </MenuItem>
                                                    <MenuItem
                                                        title="Viewer"
                                                        onClick={handleSubmit(
                                                            values =>
                                                                this.updateTeamMemberRole(
                                                                    {
                                                                        ...values,
                                                                        role:
                                                                            user.role,
                                                                        userId:
                                                                            user.userId,
                                                                    },
                                                                    'Viewer'
                                                                )
                                                        )}
                                                    >
                                                        Viewer
                                                    </MenuItem>
                                                </Dropdown.Menu>
                                            </Dropdown>
                                            <button
                                                id={`removeMember__${
                                                    user.email.split('@')[0]
                                                }`}
                                                title="delete"
                                                disabled={false}
                                                className="bs-Button bs-DeprecatedButton Margin-left--8"
                                                type="button"
                                                onClick={handleSubmit(values =>
                                                    this.props.openModal({
                                                        id: this.state
                                                            .removeUserModalId,
                                                        content: DataPathHoC(
                                                            ProjectRemoveUserModal,
                                                            {
                                                                removeUserModalId: this
                                                                    .state
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
            })
        );
    };
    render() {
        const {
            count,
            updateUsers,
            deleteError,
            canPaginateBackward,
            canPaginateForward,
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

ProjectUser.displayName = 'ProjectUser';

const mapDispatchToProps = dispatch => {
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

function mapStateToProps(state) {
    return {
        updateUsers: state.project.updateUser,
        deleteError: state.project.teamDelete,
    };
}

const ProjectUsers = reduxForm({
    form: 'ProjectUsers',
})(ProjectUser);

export default connect(mapStateToProps, mapDispatchToProps)(ProjectUsers);
