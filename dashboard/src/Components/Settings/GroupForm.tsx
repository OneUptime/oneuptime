import React from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';

import { reduxForm, Field } from 'redux-form';
import { bindActionCreators, Dispatch } from 'redux';

import ClickOutside from 'react-click-outside';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import { closeModal } from 'common-ui/actions/modal';
import { RenderSelect } from '../basic/RenderSelect';
import {
    createGroup,
    updateGroup,
    resetErrorMessage,
} from '../../actions/group';

export class GroupForm extends Component<ComponentProps>{
    public static displayName = '';
    public static propTypes = {};
    state = {
        teamMemberIds: [],
        teams: [],
        projectTeam: [],
        teamMemberId: '',
    };
    override componentDidMount() {

        const projectTeam = this.props.teamMembers.filter((project: $TSFixMe) => {

            return project._id === this.props.projectId;
        });


        if (this.props.editGroup) {

            const teamId = this.props.teams.map((team: $TSFixMe) => team._id);
            this.setState({

                projectTeam: this.props.teams,
                teamMemberIds: teamId,
            });
            const filteredTeam =
                projectTeam &&
                projectTeam[0] &&
                projectTeam[0].teamMembers &&
                projectTeam[0].teamMembers.filter(

                    (member: $TSFixMe) => !this.props.teams.some(
                        (team: $TSFixMe) => team._id === member.userId
                    )
                );
            this.setState({
                teams:
                    projectTeam &&
                        projectTeam[0] &&
                        projectTeam[0].teamMembers &&
                        projectTeam[0].teamMembers.length > 0
                        ? filteredTeam
                        : [],
            });
        } else {
            this.setState({
                teams:
                    projectTeam &&
                        projectTeam[0] &&
                        projectTeam[0].teamMembers &&
                        projectTeam[0].teamMembers.length > 0
                        ? projectTeam[0].teamMembers
                        : [],
            });
        }

        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = (values: $TSFixMe) => {
        const { groupName } = values;
        const {

            editGroup,

            createGroup,

            updateGroup,

            closeModal,

            groupModalId,

            resetErrorMessage,
        } = this.props;

        if (!editGroup) {

            createGroup(this.props.projectId, {
                name: groupName,
                teams: this.state.teamMemberIds,
            }).then((data: $TSFixMe) => {
                if (!data.error) {
                    closeModal({
                        id: groupModalId,
                    });
                    resetErrorMessage();
                }
            });
        } else {
            const { teamMemberIds } = this.state;

            updateGroup(this.props.projectId, this.props.groupId, {
                name: groupName,
                teams: teamMemberIds,
            }).then((data: $TSFixMe) => {
                if (!data.error) {
                    closeModal({
                        id: groupModalId,
                    });
                    resetErrorMessage();
                } else return null;
            });
        }
    };

    handleKeyBoard = (e: $TSFixMe) => {
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

        this.props.resetErrorMessage();
    };
    handleChange = (value: $TSFixMe) => {
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
            const filteredTeamMember = this.state.teams

                .filter(user => user.userId === teamMemberId)
                .map(user => {
                    return {

                        ...user,
                        _id: user.userId,
                    };
                });
            const newTeam = this.state.teams

                .filter(user => user.userId !== teamMemberId)
                .map(user => {
                    return {

                        ...user,
                        _id: user.userId,
                    };
                });
            this.setState({
                teamMemberIds: newTeamMemberIds,
                projectTeam: [...this.state.projectTeam, filteredTeamMember[0]],
                teams: newTeam,
            });
        }
    };
    //it removes the team members from the list
    handleRemoveTeamMember = (id: $TSFixMe) => {
        //get the user being removed from the list
        const userRemoved = this.state.projectTeam.filter(

            user => user._id === id
        );
        //add the user back to the teams list
        const newTeam = [...this.state.teams, ...userRemoved];
        //remove the user from the project teams
        const newProjectTeam = this.state.projectTeam.filter(

            user => user._id !== id
        );
        //also remove the user id from list of user id to submit
        const newTeamMemberIds = this.state.teamMemberIds.filter(
            userId => userId !== id
        );
        this.setState({
            projectTeam: newProjectTeam,
            teamMemberIds: newTeamMemberIds,
            teams: newTeam,
        });
    };
    override render() {
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
                                        <div
                                            style={{
                                                width: '67%',
                                                marginTop: '20px',
                                                fontWeight: '500',
                                            }}
                                        >
                                            <label className=".bs-Fieldset-label">
                                                Name
                                            </label>
                                        </div>
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
                                        {this.state.projectTeam.length > 0 ? (
                                            <div
                                                className="bs-Fieldset-row"
                                                style={{
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    paddingTop: '10px',
                                                    width: '298px',
                                                    paddingLeft: '0',
                                                    paddingRight: '0',
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        width: '67%',
                                                        fontWeight: '500',
                                                    }}
                                                >
                                                    <label className=".bs-Fieldset-label">
                                                        Members
                                                    </label>
                                                </div>
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
                                                                className="clear_times"
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
                                                            ></div>
                                                        </div>
                                                    )
                                                )}
                                            </div>
                                        ) : null}
                                        <div
                                            className="bs-Fieldset-row Margin-bottom--12"
                                            style={{
                                                marginBottom: '0',
                                                padding: '25px 20px 38px 20px',
                                            }}
                                        >
                                            <Field
                                                id="componentList"
                                                name="teamMembers"
                                                component={RenderSelect}
                                                className="db-select-nw"
                                                placeholder="Add team member"
                                                options={[
                                                    ...this.state.teams.map(
                                                        user => ({

                                                            value: user.userId,

                                                            label: user.name

                                                                ? user.name

                                                                : user.email,
                                                        })
                                                    ),
                                                ]}
                                                onChange={(event: $TSFixMe, value: $TSFixMe) => {
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
                                    </div>
                                    <div className="bs-Modal-footer">
                                        <div className="bs-Modal-footer-actions">
                                            <button
                                                className={`bs-Button bs-DeprecatedButton btn__modal ${editGroup
                                                    ? requesting[groupId]
                                                    : requesting &&
                                                    'bs-is-disabled'
                                                    }`}
                                                type="button"
                                                onClick={() => {
                                                    closeModal({
                                                        id: groupModalId,
                                                    });

                                                    this.props.resetErrorMessage();
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
                                                className={`bs-Button bs-DeprecatedButton bs-Button--blue btn__modal ${editGroup
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

const mapStateToProps = (state: RootState, props: $TSFixMe) => {
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

const mapDispatchToProps = (dispatch: Dispatch) => {
    return bindActionCreators(
        {
            closeModal,
            createGroup,
            updateGroup,
            resetErrorMessage,
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
    resetErrorMessage: PropTypes.func,
    errorMessage: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null]),
    ]),
};

export default connect(mapStateToProps, mapDispatchToProps)(CreateGroupForm);
