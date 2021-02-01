import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { Field, reduxForm } from 'redux-form';
import ClickOutside from 'react-click-outside';
import uuid from 'uuid';
import {
    userCreate,
    userCreateRequest,
    userCreateSuccess,
    userCreateError,
} from '../../actions/project';
import { RenderField } from '../basic/RenderField';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import { Validate } from '../../config';
import DataPathHoC from '../DataPathHoC';
import MessageBox from '../modals/MessageBox';
import formatEmails from '../../utils/formatEmails';

function validate(values) {
    const errors = {};
    // remove white spaces
    values.emails = values.emails ? values.emails.replace(/\s/g, '') : '';
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
            messageModalId: uuid.v4(),
        };
    }
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = values => {
        values.emails = formatEmails(values.emails);
        const { userCreate, closeThisDialog, data } = this.props;
        values.projectId = data.projectId;

        const { role, emails } = values;
        const emailArray = emails ? emails.split(',') : [];

        if (role !== 'Viewer' && emailArray.length > 100) {
            this.showMessageBox();
        }
        userCreate(data.projectId, values).then(
            function() {
                closeThisDialog();
            },
            function() {
                //do nothing.
            }
        );
    };

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                this.props.closeThisDialog();
                return true;
            case 'Enter':
                return document
                    .getElementById(`btn_modal_${this.props.data.projectName}`)
                    .click();
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
                className="ModalLayer-contents"
                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM db-InviteSetting">
                    <div className="bs-Modal bs-Modal--large project-user-modal">
                        <ClickOutside onClickOutside={closeThisDialog}>
                            <form
                                id={`frm_${data.projectName}`}
                                lpformnum="2"
                                onSubmit={handleSubmit(this.submitForm)}
                            >
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <div className="db-InviteSetting-header">
                                            <h2>
                                                <span>
                                                    Invite new team members
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
                                                                                id={`emails_${data.projectName}`}
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
                                                    htmlFor={`Viewer_${data.projectName}`}
                                                >
                                                    <Field
                                                        id={`Viewer_${data.projectName}`}
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
                                                                    Viewer
                                                                </span>
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
                                                    htmlFor={`Member_${data.projectName}`}
                                                >
                                                    <Field
                                                        id={`Member_${data.projectName}`}
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
                                                    htmlFor={`Administrator_${data.projectName}`}
                                                >
                                                    <Field
                                                        id={`Administrator_${data.projectName}`}
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

                                            <div className="db-RoleRadioList-row">
                                                <label
                                                    className="bs-Radio"
                                                    htmlFor={`Owner_${data.projectName}`}
                                                >
                                                    <Field
                                                        id={`Owner_${data.projectName}`}
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
                                        </div>
                                    </div>
                                </div>
                                <div
                                    className="bs-Modal-footer"
                                    style={{
                                        flexDirection: 'column',
                                    }}
                                >
                                    <div
                                        className="bs-Modal-footer-actions"
                                        style={{ width: '100%' }}
                                    >
                                        <ShouldRender
                                            if={this.props.createUser.error}
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
                                                        >
                                                            {
                                                                this.props
                                                                    .createUser
                                                                    .error
                                                            }
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                        <div
                                            style={{
                                                display: 'flex',
                                                justifyContent: 'flex-end',
                                            }}
                                        >
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
                                                id={`btn_modal_${data.projectName}`}
                                                className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                                disabled={
                                                    this.props.createUser
                                                        .requesting
                                                }
                                                type="submit"
                                            >
                                                {this.props.createUser
                                                    .requesting ? (
                                                    <FormLoader />
                                                ) : (
                                                    <>
                                                        <span>Add User</span>
                                                        <span className="create-btn__keycode">
                                                            <span className="keycode__icon keycode__icon--enter" />
                                                        </span>
                                                    </>
                                                )}
                                            </button>
                                        </div>
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

FormModal.displayName = 'InviteMemberFormModal';

const ProjectUserAddModal = reduxForm({
    form: 'ProjectUserAddModal', // a unique identifier for this form
    validate,
})(FormModal);

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        { userCreate, userCreateRequest, userCreateSuccess, userCreateError },
        dispatch
    );
};

function mapStateToProps(state) {
    return {
        createUser: state.project.createUser,
    };
}

FormModal.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    createUser: PropTypes.object.isRequired,
    userCreate: PropTypes.oneOfType([PropTypes.func]).isRequired,
    closeThisDialog: PropTypes.func.isRequired,
    data: PropTypes.object.isRequired,
    openModal: PropTypes.func.isRequired,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ProjectUserAddModal);
