import React from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { reduxForm, Field } from 'redux-form';
import { bindActionCreators } from 'redux';
import ClickOutside from 'react-click-outside';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import { closeModal } from '../../actions/modal';
import { RenderSelect } from '../basic/RenderSelect';
import { createGroup, updateGroup } from '../../actions/group';

export class GroupForm extends React.Component {
    state = {
        teamMemberIds: [],
        teams: [],
        projectTeam: [],
        teamMemberId: '',
    };
    componentDidMount() {
        const projectTeam = this.props.teamMembers.filter(project => {
            return project._id === this.props.projectId;
        });
        this.setState({
            teams:
                projectTeam &&
                projectTeam[0] &&
                projectTeam[0].teamMembers &&
                projectTeam[0].teamMembers.length > 0
                    ? projectTeam[0].teamMembers
                    : [],
        });

        if (this.props.editGroup) {
            const teamId = this.props.teams.map(team => team._id);
            this.setState({
                projectTeam: this.props.teams,
                teamMemberIds: teamId,
            });
        }

        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = values => {
        const { groupName } = values;
        const {
            editGroup,
            createGroup,
            updateGroup,
            closeModal,
            groupModalId,
        } = this.props;

        if (!editGroup) {
            createGroup(this.props.projectId, {
                name: groupName,
                teams: this.state.teamMemberIds,
            }).then(data => {
                if (!data.error) {
                    return closeModal({
                        id: groupModalId,
                    });
                }
            });
        } else {
            const { teamMemberIds } = this.state;
            updateGroup(this.props.projectId, this.props.groupId, {
                name: groupName,
                teams: teamMemberIds,
            }).then(data => {
                if (!data.error) {
                    return closeModal({
                        id: groupModalId,
                    });
                } else return null;
            });
        }
    };

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.handleCloseModal();
            case 'Enter':
                return document.getElementById('btnAddGroup').click();
            default:
                return false;
        }
    };

    handleCloseModal = () => {
        this.props.closeModal({
            id: this.props.groupModalId,
        });
    };
    handleChange = value => {
        if (value) {
            this.setState({
                teamMemberId: value,
            });
        }
    };

    //this adds a team member to the group
    handleAddTeam = () => {
        const { teamMemberId } = this.state;
        if (teamMemberId && !this.state.teamMemberIds.includes(teamMemberId)) {
            const newTeamMemberIds = [
                ...this.state.teamMemberIds,
                teamMemberId,
            ];
            const filteredTeamMember = this.state.teams.filter(
                user => user.userId === teamMemberId
            );

            this.setState({
                teamMemberIds: newTeamMemberIds,
                projectTeam: [...this.state.projectTeam, filteredTeamMember[0]],
            });
        }
    };
    //it removes the team members from the list
    handleRemoveTeamMember = id => {
        const newProjectTeam = this.state.projectTeam.filter(
            user => user._id !== id
        );
        const newTeamMemberIds = this.state.teamMemberIds.filter(
            userId => userId !== id
        );
        this.setState({
            projectTeam: newProjectTeam,
            teamMemberIds: newTeamMemberIds,
        });
    };
    render() {
        const {
            handleSubmit,
            editGroup,
            groupName,
            closeModal,
            groupModalId,
            requesting,
            errorMessage,
            groupId,
        } = this.props;
        return (
            <form
                onSubmit={handleSubmit(this.submitForm.bind(this))}
                id="frmGroup"
            >
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
                                                <span>
                                                    {editGroup
                                                        ? `Edit Group ${groupName}`
                                                        : 'Add New Group'}
                                                </span>
                                            </span>
                                        </div>
                                        <div className="bs-Modal-messages">
                                            <ShouldRender if={errorMessage}>
                                                <p
                                                    className="bs-Modal-message"
                                                    id="groupErrorMessage"
                                                >
                                                    {errorMessage}
                                                </p>
                                            </ShouldRender>
                                        </div>
                                    </div>
                                    <div
                                        className="bs-Modal-body"
                                        style={{
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'center',
                                        }}
                                    >
                                        <Field
                                            component="input"
                                            name="groupName"
                                            placeholder="Group name"
                                            id="groupName"
                                            className="bs-TextInput"
                                            style={{
                                                width: '67%',
                                                margin: '10px 0 10px 0',
                                            }}
                                            disabled={false}
                                            autoFocus={true}
                                        />
                                        <div
                                            className="bs-Fieldset-row Margin-bottom--12"
                                            style={{
                                                marginBottom: '0',
                                            }}
                                        >
                                            <Field
                                                id="componentList"
                                                name="teamMembers"
                                                component={RenderSelect}
                                                className="db-select-nw"
                                                options={[
                                                    {
                                                        value: '',
                                                        label:
                                                            'Add team member',
                                                    },
                                                    ...this.state.teams.map(
                                                        user => ({
                                                            value: user.userId,
                                                            label: user.name
                                                                ? user.name
                                                                : user.email,
                                                        })
                                                    ),
                                                ]}
                                                onChange={(event, value) => {
                                                    this.handleChange(value);
                                                }}
                                            />
                                            <button
                                                title="add-team-member"
                                                id={`group_member-add`}
                                                className="bs-Button bs-DeprecatedButton Margin-left--8"
                                                type="button"
                                                onClick={this.handleAddTeam}
                                            >
                                                <span>Add</span>
                                            </button>
                                        </div>
                                        <div
                                            className="bs-Fieldset-row Margin-bottom--12"
                                            style={{
                                                display: 'flex',
                                                flexDirection: 'column',
                                                paddingTop: '0',
                                                width: '298px',
                                                paddingLeft: '0',
                                                paddingRight: '0',
                                            }}
                                        >
                                            {this.state.projectTeam.map(
                                                user => (
                                                    <div
                                                        key={user.userId}
                                                        style={{
                                                            display: 'flex',
                                                            alignItems:
                                                                'flex-end',
                                                            justifyContent:
                                                                'space-between',
                                                        }}
                                                    >
                                                        <span>
                                                            <img
                                                                src="/dashboard/assets/img/profile-user.svg"
                                                                className="userIcon"
                                                                style={{
                                                                    marginRight:
                                                                        '5px',
                                                                }}
                                                                alt=""
                                                            />
                                                            <span>
                                                                {user.name
                                                                    ? user.name
                                                                    : user.email}
                                                            </span>
                                                        </span>
                                                        <div
                                                            className="Remove-team-btn"
                                                            style={{
                                                                marginRight:
                                                                    '0',
                                                                cursor:
                                                                    'pointer',
                                                            }}
                                                            onClick={() =>
                                                                this.handleRemoveTeamMember(
                                                                    user._id
                                                                )
                                                            }
                                                        >
                                                            x
                                                        </div>
                                                    </div>
                                                )
                                            )}
                                        </div>
                                    </div>
                                    <div className="bs-Modal-footer">
                                        <div className="bs-Modal-footer-actions">
                                            <button
                                                className={`bs-Button bs-DeprecatedButton btn__modal ${
                                                    editGroup
                                                        ? requesting[groupId]
                                                        : requesting &&
                                                          'bs-is-disabled'
                                                }`}
                                                type="button"
                                                onClick={() => {
                                                    return closeModal({
                                                        id: groupModalId,
                                                    });
                                                }}
                                                disabled={
                                                    editGroup
                                                        ? requesting[groupId]
                                                        : requesting
                                                }
                                            >
                                                <span>Cancel</span>
                                                <span className="cancel-btn__keycode">
                                                    Esc
                                                </span>
                                            </button>
                                            <button
                                                id="btnAddGroup"
                                                className={`bs-Button bs-DeprecatedButton bs-Button--blue btn__modal ${
                                                    editGroup
                                                        ? requesting[groupId]
                                                        : requesting &&
                                                          'bs-is-disabled'
                                                }`}
                                                type="save"
                                                disabled={
                                                    editGroup
                                                        ? requesting[groupId]
                                                        : requesting
                                                }
                                            >
                                                <ShouldRender
                                                    if={
                                                        editGroup
                                                            ? requesting[
                                                                  groupId
                                                              ]
                                                            : requesting
                                                    }
                                                >
                                                    <FormLoader />
                                                </ShouldRender>
                                                <ShouldRender
                                                    if={
                                                        !(editGroup
                                                            ? requesting[
                                                                  groupId
                                                              ]
                                                            : requesting)
                                                    }
                                                >
                                                    <span>Save</span>
                                                    <span className="create-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </ShouldRender>
                                            </button>
                                        </div>
                                    </div>
                                </ClickOutside>
                            </div>
                        </div>
                    </div>
                </div>
            </form>
        );
    }
}

GroupForm.displayName = 'GroupForm';

const CreateGroupForm = reduxForm({
    form: 'GroupModalForm',
    enableReinitialize: true,
})(GroupForm);

const mapStateToProps = (state, props) => {
    const initval = props.data.editGroup
        ? { groupName: props.data.groupName }
        : {};
    const teamMembers = state.team.subProjectTeamMembers;
    const requesting = props.data.editGroup
        ? state.groups.updateGroup.requesting
        : state.groups.createGroup.requesting;
    const errorMessage = props.data.editGroup
        ? state.groups.updateGroup.error
        : state.groups.createGroup.error;
    return {
        initialValues: initval,
        currentProject: state.project.currentProject,
        subProject: state.subProject.subProjects,
        groupModalId: props.data.groupModalId,
        editGroup: props.data.editGroup,
        projectId: props.data.projectId,
        groupName: props.data.groupName,
        groupId: props.data.groupId,
        teams: props.data.teams,
        teamMembers,
        requesting,
        errorMessage,
    };
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            closeModal,
            createGroup,
            updateGroup,
        },
        dispatch
    );
};

GroupForm.propTypes = {
    closeModal: PropTypes.func,
    editGroup: PropTypes.bool,
    handleSubmit: PropTypes.func,
    groupModalId: PropTypes.string,
    groupName: PropTypes.string,
    createGroup: PropTypes.func,
    projectId: PropTypes.object,
    teamMembers: PropTypes.array,
    requesting: PropTypes.bool,
    updateGroup: PropTypes.func,
    groupId: PropTypes.string,
    teams: PropTypes.array,
    errorMessage: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null]),
    ]),
};

export default connect(mapStateToProps, mapDispatchToProps)(CreateGroupForm);
