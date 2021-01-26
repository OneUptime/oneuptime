import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import Dropdown, { MenuItem } from '@trendmicro/react-dropdown';
import moment from 'moment';
import uuid from 'uuid';
import { openModal, closeModal } from '../../actions/modal';
import {
    teamDelete,
    resetTeamDelete,
    changeUserProjectRole,
    userUpdateRole,
} from '../../actions/project';
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
            content: ProjectUserAddModal,
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
            this.props.users.teamMembers.map((user, i) => {
                if (
                    i >= pages * membersPerPage - membersPerPage &&
                    i < pages * membersPerPage
                ) {
                    return (
                        <tr
                            className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink"
                            key={user._id}
                        >
                            <td
                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                style={{
                                    height: '1px',
                                    minWidth: '270px',
                                }}
                            >
                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                    <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                        <div className="Box-root Margin-right--16">
                                            <span>{user && user.email}</span>
                                        </div>
                                    </span>
                                </div>
                            </td>
                            <td
                                className="Table-cell Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                style={{ height: '1px' }}
                            >
                                <div className="db-ListViewItem-link">
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                            <div className="Box-root">
                                                <span>{user.role}</span>
                                            </div>
                                        </span>
                                    </div>
                                </div>
                            </td>
                            <td
                                className="Table-cell Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                style={{ height: '1px' }}
                            >
                                <div className="db-ListViewItem-link">
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                            <div className="Box-root">
                                                {user && user.deleted ? (
                                                    <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                        <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                            <span>Deleted</span>
                                                        </span>
                                                    </div>
                                                ) : user && user.isBlocked ? (
                                                    <div className="Badge Badge--color--yellow Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                        <span className="Badge-text Text-color--yellow Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                            <span>Blocked</span>
                                                        </span>
                                                    </div>
                                                ) : (
                                                    <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                                        <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                            <span>
                                                                {user &&
                                                                user.name
                                                                    ? 'Online ' +
                                                                      moment(
                                                                          user.userId &&
                                                                              user
                                                                                  .userId
                                                                                  .lastActive
                                                                      ).fromNow()
                                                                    : 'Invitation Sent'}
                                                            </span>
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        </span>
                                    </div>
                                </div>
                            </td>
                            <td></td>
                            <td
                                className="Table-cell Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                style={{ height: '1px' }}
                            >
                                <div className="db-ListViewItem-link">
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                            <div className="Box-root Flex-flex Flex-justifyContent--flexEnd">
                                                <ShouldRender
                                                    if={user.role !== 'Owner'}
                                                >
                                                    <div className="Flex-flex Flex-alignContent--spaceBetween">
                                                        <Dropdown
                                                            disabled={false}
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
                                                                            false
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
                                                                user.email.split(
                                                                    '@'
                                                                )[0]
                                                            }`}
                                                            title="delete"
                                                            disabled={false}
                                                            className="bs-Button bs-DeprecatedButton Margin-left--8"
                                                            type="button"
                                                            onClick={handleSubmit(
                                                                values =>
                                                                    this.props.openModal(
                                                                        {
                                                                            id: this
                                                                                .state
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
                                                                        }
                                                                    )
                                                            )}
                                                        >
                                                            {!false && (
                                                                <span>
                                                                    Remove
                                                                </span>
                                                            )}
                                                        </button>
                                                    </div>
                                                </ShouldRender>
                                            </div>
                                        </span>
                                    </div>
                                </div>
                            </td>
                        </tr>
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
            paginate
        } = this.props;
        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Project Users</span>
                                </span>
                            </div>
                            <div
                                className="bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4"
                                onClick={this.handleClick}
                            >
                                <div className="Box-root Margin-right--8">
                                    <div className="SVGInline SVGInline--cleaned Button-icon ActionIcon ActionIcon--color--inherit Box-root Flex-flex"></div>
                                </div>

                                <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new keycode__wrapper">
                                    <span>Add User to Project</span>
                                    <span className="new-btn__keycode">N</span>
                                </span>
                            </div>
                        </div>
                        <div>
                            <div
                                style={{
                                    overflow: 'hidden',
                                    overflowX: 'auto',
                                }}
                            >
                                <table className="Table">
                                    <thead className="Table-body">
                                        <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                style={{
                                                    height: '1px',
                                                    minWidth: '270px',
                                                }}
                                            >
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                        <span>User</span>
                                                    </span>
                                                </div>
                                            </td>
                                            <td
                                                className="Table-cell Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                style={{ height: '1px' }}
                                            >
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    <span className="db-ListViewItem-text Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                        <span>Role</span>
                                                    </span>
                                                </div>
                                            </td>
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                style={{ height: '1px' }}
                                            >
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                        <span>Status</span>
                                                    </span>
                                                </div>
                                            </td>
                                            <td
                                                id="placeholder-right"
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                style={{
                                                    height: '1px',
                                                    maxWidth: '48px',
                                                    minWidth: '48px',
                                                    width: '48px',
                                                }}
                                            >
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span>
                                                </div>
                                            </td>
                                            <td
                                                id="overflow"
                                                type="action"
                                                className="Table-cell Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                style={{ height: '1px' }}
                                            >
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    <span className="db-ListViewItem-text Text-align--right Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                        Actions
                                                    </span>
                                                </div>
                                            </td>
                                        </tr>
                                    </thead>
                                    <tbody className="Table-body">
                                        {this.renderTable()}
                                    </tbody>
                                </table>
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
                                            {count} User
                                            {count > 1 ? 's' : ''}
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
};

function mapStateToProps(state) {
    return {
        updateUsers: state.project.updateUser,
        deleteError: state.project.teamdelete,
    };
}

const ProjectUsers = reduxForm({
    form: 'ProjectUsers',
})(ProjectUser);

export default connect(mapStateToProps, mapDispatchToProps)(ProjectUsers);
