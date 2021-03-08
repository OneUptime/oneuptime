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
import { ValidateField } from '../../config';
import { createGroup, updateGroup } from '../../actions/group';

export class GroupForm extends React.Component {
    state = {
        teamMembers: [],
        teams: [],
        projectTeam: [],
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
                teamMembers: teamId,
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
                teams: this.state.teamMembers,
            });
            return closeModal({
                id: groupModalId,
            });
        } else {
            const { teamMembers } = this.state;
            updateGroup(this.props.projectId, this.props.groupId, {
                name: groupName,
                teams: teamMembers,
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
                return document.getElementById('btnAddGroups').click();
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
        if (value && !this.state.teamMembers.includes(value)) {
            const newTeam = [...this.state.teamMembers, value];
            const filteredTeamMember = this.state.teams.filter(
                user => user.userId === value
            );

            this.setState({
                teamMembers: newTeam,
                projectTeam: [...this.state.projectTeam, filteredTeamMember[0]],
            });
        }
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
                                                width: '250px',
                                                margin: '10px 0 10px 0',
                                            }}
                                            disabled={false}
                                            autoFocus={true}
                                            validate={ValidateField.required}
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
                                        </div>
                                        <div
                                            className="bs-Fieldset-row Margin-bottom--12"
                                            style={{
                                                display: 'flex',
                                                flexDirection: 'column',
                                                paddingTop: '0',
                                                width: '250px',
                                                paddingLeft: '0',
                                            }}
                                        >
                                            {this.state.projectTeam.map(
                                                user => (
                                                    <div key={user.userId}>
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
                                                    </div>
                                                )
                                            )}
                                        </div>
                                    </div>
                                    <div className="bs-Modal-footer">
                                        <div className="bs-Modal-footer-actions">
                                            <button
                                                className={`bs-Button bs-DeprecatedButton btn__modal ${requesting &&
                                                    'bs-is-disabled'}`}
                                                type="button"
                                                onClick={() => {
                                                    return closeModal({
                                                        id: groupModalId,
                                                    });
                                                }}
                                                disabled={requesting}
                                            >
                                                <span>Cancel</span>
                                                <span className="cancel-btn__keycode">
                                                    Esc
                                                </span>
                                            </button>
                                            <button
                                                id="btnAddGroup"
                                                className={`bs-Button bs-DeprecatedButton bs-Button--blue btn__modal ${requesting &&
                                                    'bs-is-disabled'}`}
                                                type="save"
                                                disabled={requesting}
                                            >
                                                <ShouldRender if={requesting}>
                                                    <FormLoader />
                                                </ShouldRender>
                                                <ShouldRender if={!requesting}>
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
