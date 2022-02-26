import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { Field, reduxForm } from 'redux-form';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
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
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import { openModal, closeModal } from '../../actions/modal';

import { Validate } from '../../config';
import DataPathHoC from '../DataPathHoC';
import MessageBox from './MessageBox';
import formatEmails from '../../utils/formatEmails';
import HasProjectOwner from '../basic/HasProjectOwner';
import Badge from '../common/Badge';
import { IS_SAAS_SERVICE } from '../../config';

function validate(values: $TSFixMe) {
    const errors = {};

    // remove white spaces
    values.emails = values.emails ? values.emails.replace(/\s/g, '') : '';
    const emails = values.emails ? values.emails.split(',') : [];
    if (!Validate.isValidBusinessEmails(emails)) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'emails' does not exist on type '{}'.
        errors.emails = 'Please enter business emails of the members.';
    }

    return errors;
}

export class FormModal extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            notificationModalId: uuidv4(),
            messageModalId: uuidv4(),
        };
    }

    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = (values: $TSFixMe) => {
        values.emails = formatEmails(values.emails);
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'teamCreate' does not exist on type 'Read... Remove this comment to see the full error message
            teamCreate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
            closeThisDialog,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            data,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
            closeModal,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
            subProjects,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
            openModal,
        } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'notificationModalId' does not exist on t... Remove this comment to see the full error message
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
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'notificationModalId' does not exist on t... Remove this comment to see the full error message
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
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
                this.props.closeModal({ id: this.state.notificationModalId });
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
                this.props.closeThisDialog();
                return true;
            case 'Enter':
                // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                return document
                    .getElementById(
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                        `btn_modal_${this.props.data.subProjectName}`
                    )
                    .click();
            default:
                return false;
        }
    };

    showMessageBox = () =>
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
        this.props.openModal({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'messageModalId' does not exist on type '... Remove this comment to see the full error message
            id: this.state.messageModalId,
            content: DataPathHoC(MessageBox, {
                message: (
                    <span>
                        Please{' '}
                        <a
                            href="mailto: sales@oneuptime.com"
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
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'messageModalId' does not exist on type '... Remove this comment to see the full error message
                messageBoxId: this.state.messageModalId,
            }),
        });

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
        const { handleSubmit, closeThisDialog, data } = this.props;
        return (
            <div
                className="ModalLayer-contents"
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM db-InviteSetting">
                    <div className="bs-Modal bs-Modal--team">
                        <ClickOutside
                            onClickOutside={(e: $TSFixMe) => {
                                if (
                                    e.target.className ===
                                    'bs-BIM db-InviteSetting'
                                ) {
                                    closeThisDialog();
                                }
                            }}
                        >
                            <form
                                id={`frm_${data.subProjectName}`}
                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: Element[]; id: string; lpformnum... Remove this comment to see the full error message
                                lpformnum="2"
                                onSubmit={handleSubmit(this.submitForm)}
                            >
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <div className="db-InviteSetting-header">
                                            <h2>
                                                <span>
                                                    Invite new team member
                                                </span>
                                            </h2>
                                            <p className="db-InviteSetting-headerDescription">
                                                <span>
                                                    Enter the email addresses of
                                                    the users you&#39;d like to
                                                    invite, and choose the role
                                                    they should have.
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
                                                                                autoFocus={
                                                                                    true
                                                                                }
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
                                                    id="viewer"
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
                                                                <span>
                                                                    Status Page
                                                                    Viewer
                                                                </span>
                                                                {IS_SAAS_SERVICE && (
                                                                    <Badge color="green">
                                                                        Free
                                                                    </Badge>
                                                                )}
                                                            </div>
                                                            <div className="db-RoleRadioListLabel-description">
                                                                <span>
                                                                    Viewers are
                                                                    your
                                                                    internal
                                                                    team members
                                                                    or your
                                                                    customers
                                                                    who can only
                                                                    view private
                                                                    status page
                                                                    of this
                                                                    project.{' '}
                                                                    {IS_SAAS_SERVICE && (
                                                                        <span>
                                                                            Viewers
                                                                            are
                                                                            free.
                                                                        </span>
                                                                    )}
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
                                                    id="member"
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
                                                                <span>
                                                                    Member
                                                                </span>
                                                            </div>
                                                            <div className="db-RoleRadioListLabel-description">
                                                                <span>
                                                                    Best for
                                                                    developers,
                                                                    SRE, and
                                                                    people might
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
                                                    id="administrator"
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
                                                                    have
                                                                    complete
                                                                    control over
                                                                    project they
                                                                    are invited
                                                                    to. They can
                                                                    manage
                                                                    resources
                                                                    and invite
                                                                    new members.
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
                                                    !HasProjectOwner(
                                                        this.props
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                                                            .currentProject,
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                        this.props.data
                                                            .subProjectId,
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
                                                        this.props.subProjects
                                                    )
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
                                                                        Owners
                                                                        have
                                                                        complete
                                                                        control
                                                                        over
                                                                        this
                                                                        OneUptime
                                                                        project
                                                                        including
                                                                        all the
                                                                        sub-projects.
                                                                        Owners
                                                                        can
                                                                        create
                                                                        and
                                                                        delete
                                                                        sub-projects
                                                                        and
                                                                        manage
                                                                        everything
                                                                        in
                                                                        OneUptime.{' '}
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
                                            if={
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'team' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                this.props.team.teamCreate.error
                                            }
                                        >
                                            <div className="bs-Tail-copy">
                                                <div
                                                    className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                    style={{
                                                        marginTop: '10px',
                                                    }}
                                                >
                                                    <div className="Box-root Margin-right--8">
                                                        <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                    </div>
                                                    <div className="Box-root">
                                                        <span
                                                            style={{
                                                                color: 'red',
                                                            }}
                                                            id="businessEmailError"
                                                        >
                                                            {
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'team' does not exist on type 'Readonly<{... Remove this comment to see the full error message
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
                                            className="bs-Button bs-DeprecatedButton btn__modal"
                                            type="button"
                                            onClick={closeThisDialog}
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id={`btn_modal_${data.subProjectName}`}
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                            disabled={
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'team' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                this.props.team &&
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'team' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                this.props.team.teamCreate
                                                    .requesting
                                            }
                                            type="submit"
                                        >
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'team' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                            {!this.props.team.teamCreate
                                                .requesting && (
                                                <>
                                                    <span>Invite</span>
                                                    <span className="create-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </>
                                            )}
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'team' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                            {this.props.team &&
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'team' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                this.props.team.teamCreate
                                                    .requesting && (
                                                    <FormLoader />
                                                )}
                                        </button>
                                    </div>
                                </div>
                            </form>
                        </ClickOutside>
                    </div>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
FormModal.displayName = 'InviteMemberFormModal';

const InviteTeamMemberForm = reduxForm({
    form: 'InviteTeamMember', // a unique identifier for this form
    validate,
})(FormModal);

const mapDispatchToProps = (dispatch: $TSFixMe) => {
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

function mapStateToProps(state: $TSFixMe) {
    return {
        team: state.team,
        currentProject: state.project.currentProject,
        subProjects: state.subProject.subProjects.subProjects,
    };
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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
