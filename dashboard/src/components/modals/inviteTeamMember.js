import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { Field, reduxForm } from 'redux-form';
import {
    teamCreate,
    teamCreateRequest,
    teamCreateSuccess,
    teamCreateError,
} from '../../actions/team';
import { RenderField } from '../basic/RenderField';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import projectTeamMemberNotification from './projectTeamMemberNotification.js';
import uuid from 'uuid';
import { openModal, closeModal } from '../../actions/modal';
import { logEvent } from '../../analytics';
import { SHOULD_LOG_ANALYTICS, Validate } from '../../config';
import DataPathHoC from '../DataPathHoC';
import MessageBox from './MessageBox';

function validate(values) {
    const errors = {};

    const emails = values.emails ? values.emails.split(',') : [];
    if (!Validate.isValidBusinessEmails(emails)) {
        errors.emails = 'Please enter business emails of the members.';
    }

    return errors;
}

export class FormModal extends Component {
    constructor(props) {
        super(props);
        this.state = {
            notificationModalId: uuid.v4(),
            messageModalId: uuid.v4(),
        };
    }

    submitForm = values => {
        const {
            teamCreate,
            closeThisDialog,
            data,
            closeModal,
            subProjects,
            currentProject,
            openModal,
        } = this.props;
        const { notificationModalId } = this.state;
        values.projectId = data.subProjectId;

        const { role, emails } = values;
        const emailArray = emails ? emails.split(',') : [];

        if (role !== 'Viewer' && emailArray.length > 100) {
            this.showMessageBox();
        }

        if (
            subProjects &&
            subProjects.length >= 1 &&
            data.subProjectId === currentProject._id
        ) {
            openModal({
                id: this.state.notificationModalId,
                onClose: () => closeModal({ id: notificationModalId }),
                onConfirm: () =>
                    teamCreate(data.subProjectId, values).then(
                        function() {
                            closeThisDialog();
                            closeModal({ id: notificationModalId });
                        },
                        function() {
                            //do nothing.
                        }
                    ),
                content: projectTeamMemberNotification,
            });
        } else {
            teamCreate(data.subProjectId, values).then(
                function() {
                    closeThisDialog();
                },
                function() {
                    //do nothing.
                }
            );
        }
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > TEAM MEMBER > INVITED',
                values
            );
        }
    };

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                this.props.closeModal({ id: this.state.notificationModalId });
                this.props.closeThisDialog();
                return true;
            default:
                return false;
        }
    };

    showMessageBox = () =>
        this.props.openModal({
            id: this.state.messageModalId,
            content: DataPathHoC(MessageBox, {
                message: (
                    <span>
                        Please{' '}
                        <a
                            href="mailto: sales@fyipe.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ textDecoration: 'underline' }}
                        >
                            contact sales
                        </a>{' '}
                        if you wish to add more than 100 members to the project
                    </span>
                ),
                title: 'You cannot add more than 100 members',
                messageBoxId: this.state.messageModalId,
            }),
        });

    render() {
        const { handleSubmit, closeThisDialog, data } = this.props;
        return (
            <div
                onKeyDown={this.handleKeyBoard}
                className="ModalLayer-contents"
                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM db-InviteSetting">
                    <div className="bs-Modal bs-Modal--large">
                        <form
                            id={`frm_${data.subProjectName}`}
                            lpformnum="2"
                            onSubmit={handleSubmit(this.submitForm)}
                        >
                            <div className="bs-Modal-header">
                                <div className="bs-Modal-header-copy">
                                    <div className="db-InviteSetting-header">
                                        <h2>
                                            <span>Invite new team members</span>
                                        </h2>
                                        <p className="db-InviteSetting-headerDescription">
                                            <span>
                                                Enter the email addresses of the
                                                users you&#39;d like to invite,
                                                and choose the role they should
                                                have.
                                            </span>
                                        </p>
                                        <div className="db-MultiEmailInput bs-TextInput">
                                            <div className="DraftEditor-root">
                                                <div className="public-DraftEditorPlaceholder-root">
                                                    <div></div>
                                                </div>
                                                <div className="DraftEditor-editorContainer">
                                                    <div
                                                        aria-describedby="placeholder-ek1bp"
                                                        className="notranslate public-DraftEditor-content"
                                                        role="textbox"
                                                        spellCheck="false"
                                                        style={{
                                                            outline: 'none',
                                                            whiteSpace:
                                                                'pre-wrap',
                                                            wordWrap:
                                                                'break-word',
                                                        }}
                                                    >
                                                        <div data-contents="true">
                                                            <div
                                                                data-block="true"
                                                                data-editor="ek1bp"
                                                                data-offset-key="chvmc-0-0"
                                                            >
                                                                <div
                                                                    data-offset-key="chvmc-0-0"
                                                                    className="public-DraftStyleDefault-block public-DraftStyleDefault-ltr"
                                                                >
                                                                    <span data-offset-key="chvmc-0-0">
                                                                        <Field
                                                                            data-offset-key="chvmc-0-0"
                                                                            className="public-DraftStyleDefault-block public-DraftStyleDefault-ltr"
                                                                            type="text"
                                                                            name="emails"
                                                                            id={`emails_${data.subProjectName}`}
                                                                            placeholder="bob@example.com, alice@example.com, etc."
                                                                            component={
                                                                                RenderField
                                                                            }
                                                                            style={{
                                                                                border:
                                                                                    '0px',
                                                                                width:
                                                                                    '100%',
                                                                            }}
                                                                        />
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="bs-Modal-messages"></div>
                            </div>
                            <div className="bs-Modal-content bs-u-paddingless">
                                <div className="bs-Modal-block bs-u-paddingless">
                                    <div className="db-RoleRadioList">
                                        <div className="db-RoleRadioList-row">
                                            <label
                                                className="bs-Radio"
                                                htmlFor={`Viewer_${data.subProjectName}`}
                                            >
                                                <Field
                                                    id={`Viewer_${data.subProjectName}`}
                                                    className="bs-Radio-source"
                                                    name="role"
                                                    component="input"
                                                    type="radio"
                                                    value="Viewer"
                                                />
                                                <span className="bs-Radio-button"></span>
                                                <span className="bs-Radio-label">
                                                    <div className="db-RoleRadioListLabel">
                                                        <div className="db-RoleRadioListLabel-name">
                                                            <span>Viewer</span>
                                                        </div>
                                                        <div className="db-RoleRadioListLabel-description">
                                                            <span>
                                                                Viewers are your
                                                                internal team
                                                                members or your
                                                                customers who
                                                                can only view
                                                                private status
                                                                page of this
                                                                project.
                                                            </span>
                                                        </div>
                                                        <div className="db-RoleRadioListLabel-info">
                                                            <div className="Box-root Flex-inlineFlex">
                                                                <div className="Box-root Flex-flex">
                                                                    <div className="Box-root Flex-flex"></div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </span>
                                            </label>
                                        </div>
                                        <div className="db-RoleRadioList-row">
                                            <label
                                                className="bs-Radio"
                                                htmlFor={`Member_${data.subProjectName}`}
                                            >
                                                <Field
                                                    id={`Member_${data.subProjectName}`}
                                                    className="bs-Radio-source"
                                                    name="role"
                                                    component="input"
                                                    type="radio"
                                                    value="Member"
                                                />
                                                <span className="bs-Radio-button"></span>
                                                <span className="bs-Radio-label">
                                                    <div className="db-RoleRadioListLabel">
                                                        <div className="db-RoleRadioListLabel-name">
                                                            <span>Member</span>
                                                        </div>
                                                        <div className="db-RoleRadioListLabel-description">
                                                            <span>
                                                                Best for
                                                                developers, SRE,
                                                                and people might
                                                                be concerned
                                                                about the
                                                                downtime.
                                                            </span>
                                                        </div>
                                                        <div className="db-RoleRadioListLabel-info">
                                                            <div className="Box-root Flex-inlineFlex">
                                                                <div className="Box-root Flex-flex">
                                                                    <div className="Box-root Flex-flex"></div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </span>
                                            </label>
                                        </div>
                                        <div className="db-RoleRadioList-row">
                                            <label
                                                className="bs-Radio"
                                                htmlFor={`Administrator_${data.subProjectName}`}
                                            >
                                                <Field
                                                    id={`Administrator_${data.subProjectName}`}
                                                    className="bs-Radio-source"
                                                    name="role"
                                                    component="input"
                                                    type="radio"
                                                    value="Administrator"
                                                />
                                                <span className="bs-Radio-button"></span>
                                                <span className="bs-Radio-label">
                                                    <div className="db-RoleRadioListLabel">
                                                        <div className="db-RoleRadioListLabel-name">
                                                            <span>
                                                                Administrator
                                                            </span>
                                                        </div>
                                                        <div className="db-RoleRadioListLabel-description">
                                                            <span>
                                                                Administrators
                                                                have complete
                                                                control over
                                                                project they are
                                                                invited to. They
                                                                can manage
                                                                resources and
                                                                invite new
                                                                members.
                                                            </span>
                                                        </div>
                                                        <div className="db-RoleRadioListLabel-info">
                                                            <div className="Box-root Flex-inlineFlex">
                                                                <div className="Box-root Flex-flex">
                                                                    <div className="Box-root Flex-flex"></div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </span>
                                            </label>
                                        </div>
                                        <ShouldRender
                                            if={
                                                this.props.data.subProjectId ===
                                                this.props.currentProject._id
                                            }
                                        >
                                            <div className="db-RoleRadioList-row">
                                                <label
                                                    className="bs-Radio"
                                                    htmlFor={`Owner_${data.subProjectName}`}
                                                >
                                                    <Field
                                                        id={`Owner_${data.subProjectName}`}
                                                        className="bs-Radio-source"
                                                        name="role"
                                                        component="input"
                                                        type="radio"
                                                        value="Owner"
                                                    />
                                                    <span className="bs-Radio-button"></span>
                                                    <span className="bs-Radio-label">
                                                        <div className="db-RoleRadioListLabel">
                                                            <div className="db-RoleRadioListLabel-name">
                                                                <span>
                                                                    Owner
                                                                </span>
                                                            </div>
                                                            <div className="db-RoleRadioListLabel-description">
                                                                <span>
                                                                    Owners have
                                                                    complete
                                                                    control over
                                                                    this Fyipe
                                                                    project
                                                                    including
                                                                    all the
                                                                    sub-projects.
                                                                    Owners can
                                                                    create and
                                                                    delete
                                                                    sub-projects
                                                                    and manage
                                                                    everything
                                                                    in Fyipe.{' '}
                                                                </span>
                                                            </div>
                                                            <div className="db-RoleRadioListLabel-info">
                                                                <div className="Box-root Flex-inlineFlex">
                                                                    <div className="Box-root Flex-flex">
                                                                        <div className="Box-root Flex-flex"></div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </span>
                                                </label>
                                            </div>
                                        </ShouldRender>
                                    </div>
                                </div>
                            </div>
                            <div className="bs-Modal-footer">
                                <div className="bs-Modal-footer-actions">
                                    <ShouldRender
                                        if={this.props.team.teamCreate.error}
                                    >
                                        <div className="bs-Tail-copy">
                                            <div
                                                className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                style={{ marginTop: '10px' }}
                                            >
                                                <div className="Box-root Margin-right--8">
                                                    <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                </div>
                                                <div className="Box-root">
                                                    <span
                                                        style={{ color: 'red' }}
                                                    >
                                                        {
                                                            this.props.team
                                                                .teamCreate
                                                                .error
                                                        }
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </ShouldRender>
                                    <button
                                        className="bs-Button bs-DeprecatedButton"
                                        type="button"
                                        onClick={closeThisDialog}
                                    >
                                        <span>Cancel</span>
                                    </button>
                                    <button
                                        id={`btn_modal_${data.subProjectName}`}
                                        className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                        disabled={
                                            this.props.team &&
                                            this.props.team.teamCreate
                                                .requesting
                                        }
                                        type="submit"
                                    >
                                        {!this.props.team.teamCreate
                                            .requesting && <span>Invite</span>}
                                        {this.props.team &&
                                            this.props.team.teamCreate
                                                .requesting && <FormLoader />}
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        );
    }
}

FormModal.displayName = 'InviteMemberFormModal';

const InviteTeamMemberForm = reduxForm({
    form: 'InviteTeamMember', // a unique identifier for this form
    validate,
})(FormModal);

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            teamCreate,
            teamCreateRequest,
            teamCreateSuccess,
            teamCreateError,
            openModal,
            closeModal,
        },
        dispatch
    );
};

function mapStateToProps(state) {
    return {
        team: state.team,
        currentProject: state.project.currentProject,
        subProjects: state.subProject.subProjects.subProjects,
    };
}

FormModal.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    team: PropTypes.object.isRequired,
    teamCreate: PropTypes.oneOfType([PropTypes.func]).isRequired,
    closeThisDialog: PropTypes.func.isRequired,
    data: PropTypes.object.isRequired,
    currentProject: PropTypes.object.isRequired,
    openModal: PropTypes.func.isRequired,
    closeModal: PropTypes.func.isRequired,
    subProjects: PropTypes.array.isRequired,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(InviteTeamMemberForm);
