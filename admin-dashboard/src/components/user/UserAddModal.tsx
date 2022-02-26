import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { Field, reduxForm } from 'redux-form';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { RenderField } from '../basic/RenderField';
import { Validate } from '../../config';
import { addUser, resetAddUser } from '../../actions/user';

class UserAddModal extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = (values: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'addUser' does not exist on type 'Readonl... Remove this comment to see the full error message
        const { addUser, closeThisDialog, resetAddUser } = this.props;

        addUser(values).then(
            function(val: $TSFixMe) {
                if (val === 'ok') {
                    resetAddUser();
                    closeThisDialog();
                }
            },
            function() {
                //do nothing.
            }
        );
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetAddUser' does not exist on type 'Re... Remove this comment to see the full error message
                this.props.resetAddUser();
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
                return this.props.closeThisDialog();
            default:
                return false;
        }
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
            handleSubmit,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
            closeThisDialog,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'addUserState' does not exist on type 'Re... Remove this comment to see the full error message
            addUserState,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'users' does not exist on type 'Readonly<... Remove this comment to see the full error message
            users,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetAddUser' does not exist on type 'Re... Remove this comment to see the full error message
            resetAddUser,
        } = this.props;
        const disabled = addUserState.requesting || users.requesting;

        return (
            <div
                className="ModalLayer-contents"
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM">
                    <div className="bs-Modal bs-Modal--medium">
                        <ClickOutside onClickOutside={closeThisDialog}>
                            <div className="bs-Modal-header">
                                <div
                                    className="bs-Modal-header-copy"
                                    style={{
                                        marginBottom: '10px',
                                        marginTop: '10px',
                                    }}
                                >
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>Add New User</span>
                                    </span>
                                </div>
                            </div>
                            <form
                                id="frmUser"
                                onSubmit={handleSubmit(this.submitForm)}
                            >
                                <div className="bs-Modal-content bs-u-paddingless">
                                    <div className="bs-Modal-block bs-u-paddingless">
                                        <div className="bs-Modal-content">
                                            <span className="bs-Fieldset">
                                                <div className="bs-Fieldset-rows">
                                                    <div className="bs-Fieldset-row">
                                                        <label
                                                            htmlFor="email"
                                                            className="bs-Fieldset-label"
                                                        >
                                                            <span>Email</span>
                                                        </label>
                                                        <div className="bs-Fieldset-fields">
                                                            <Field
                                                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                component={
                                                                    RenderField
                                                                }
                                                                type="email"
                                                                name="email"
                                                                id="email"
                                                                placeholder="jeff@example.com"
                                                                required="required"
                                                                disabled={
                                                                    disabled
                                                                }
                                                                autoFocus={true}
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="bs-Fieldset-row">
                                                        <label
                                                            htmlFor="name"
                                                            className="bs-Fieldset-label"
                                                        >
                                                            <span>
                                                                Full Name
                                                            </span>
                                                        </label>
                                                        <div className="bs-Fieldset-fields">
                                                            <Field
                                                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                component={
                                                                    RenderField
                                                                }
                                                                type="text"
                                                                name="name"
                                                                id="name"
                                                                placeholder="Jeff Smith"
                                                                required="required"
                                                                disabled={
                                                                    disabled
                                                                }
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="bs-Fieldset-row">
                                                        <label
                                                            htmlFor="companyName"
                                                            className="bs-Fieldset-label"
                                                        >
                                                            <span>
                                                                Company Name
                                                            </span>
                                                        </label>
                                                        <div className="bs-Fieldset-fields">
                                                            <Field
                                                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                component={
                                                                    RenderField
                                                                }
                                                                type="text"
                                                                name="companyName"
                                                                id="companyName"
                                                                placeholder="Company Name"
                                                                disabled={
                                                                    disabled
                                                                }
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="bs-Fieldset-row">
                                                        <label
                                                            htmlFor="companyPhoneNumber"
                                                            className="bs-Fieldset-label"
                                                        >
                                                            <span>
                                                                Company Phone
                                                                Number
                                                            </span>
                                                        </label>
                                                        <div className="bs-Fieldset-fields">
                                                            <Field
                                                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                component={
                                                                    RenderField
                                                                }
                                                                type="tel"
                                                                name="companyPhoneNumber"
                                                                id="companyPhoneNumber"
                                                                placeholder="+1-123-456-7890"
                                                                disabled={
                                                                    disabled
                                                                }
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="bs-Fieldset-row">
                                                        <label
                                                            htmlFor="password"
                                                            className="bs-Fieldset-label"
                                                        >
                                                            <span>
                                                                Password
                                                            </span>
                                                        </label>
                                                        <div className="bs-Fieldset-fields">
                                                            <Field
                                                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                component={
                                                                    RenderField
                                                                }
                                                                type="password"
                                                                name="password"
                                                                id="password"
                                                                placeholder="Password"
                                                                required="required"
                                                                disabled={
                                                                    disabled
                                                                }
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="bs-Fieldset-row">
                                                        <label
                                                            htmlFor="confirmPassword"
                                                            className="bs-Fieldset-label"
                                                        >
                                                            <span>
                                                                Confirm Password
                                                            </span>
                                                        </label>
                                                        <div className="bs-Fieldset-fields">
                                                            <Field
                                                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                component={
                                                                    RenderField
                                                                }
                                                                type="password"
                                                                name="confirmPassword"
                                                                id="confirmPassword"
                                                                placeholder="Confirm Password"
                                                                required="required"
                                                                disabled={
                                                                    disabled
                                                                }
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <ShouldRender
                                            if={
                                                addUserState &&
                                                addUserState.error
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
                                                        >
                                                            {addUserState.error}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                        <button
                                            className="bs-Button bs-DeprecatedButton btn__modal"
                                            type="button"
                                            onClick={() => {
                                                resetAddUser();
                                                closeThisDialog();
                                            }}
                                            disabled={disabled}
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="add_user_btn"
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                            disabled={disabled}
                                            type="submit"
                                        >
                                            {addUserState &&
                                                !addUserState.requesting && (
                                                    <>
                                                        <span>Create</span>
                                                        <span className="create-btn__keycode">
                                                            <span className="keycode__icon keycode__icon--enter" />
                                                        </span>
                                                    </>
                                                )}
                                            {addUserState &&
                                                addUserState.requesting && (
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
UserAddModal.displayName = 'UserAddModalForm';

const validate = function(values: $TSFixMe) {
    const error = {};

    // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type '{}'.
    if (!Validate.text(values.name)) error.name = 'Name is required.';

    if (Validate.text(values.name) && !Validate.isValidName(values.name))
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type '{}'.
        error.name = 'Name is not valid.';

    // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type '{}'.
    if (!Validate.text(values.email)) error.email = 'Email is required.';

    if (Validate.text(values.email) && !Validate.email(values.email))
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type '{}'.
        error.email = 'Email is not valid.';

    if (
        !Validate.isValidBusinessEmail(values.email) &&
        Validate.email(values.email)
    )
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type '{}'.
        error.email = 'Please enter a business email address.';

    if (!Validate.text(values.companyName))
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'companyName' does not exist on type '{}'... Remove this comment to see the full error message
        error.companyName = 'Company name is required.';

    if (!Validate.text(values.companyPhoneNumber))
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'companyPhoneNumber' does not exist on ty... Remove this comment to see the full error message
        error.companyPhoneNumber = 'Phone number is required.';

    if (
        Validate.text(values.companyPhoneNumber) &&
        !Validate.isValidNumber(values.companyPhoneNumber)
    )
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'companyPhoneNumber' does not exist on ty... Remove this comment to see the full error message
        error.companyPhoneNumber = 'Phone number is invalid.';

    if (!Validate.text(values.password))
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'password' does not exist on type '{}'.
        error.password = 'Password is required.';
    if (
        Validate.text(values.password) &&
        !Validate.isStrongPassword(values.password)
    ) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'password' does not exist on type '{}'.
        error.password = 'Password should be atleast 8 characters long';
    }

    if (!Validate.text(values.confirmPassword))
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'confirmPassword' does not exist on type ... Remove this comment to see the full error message
        error.confirmPassword = 'Confirm Password is required.';

    if (!Validate.compare(values.password, values.confirmPassword)) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'confirmPassword' does not exist on type ... Remove this comment to see the full error message
        error.confirmPassword = 'Password and confirm password should match.';
    }

    return error;
};

const UserAddModalForm = reduxForm({
    form: 'AddUser', // a unique identifier for this form
    validate,
})(UserAddModal);

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators({ addUser, resetAddUser }, dispatch);
};

function mapStateToProps(state: $TSFixMe) {
    return {
        addUserState: state.user.addUser,
        users: state.user.users,
    };
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
UserAddModal.propTypes = {
    addUser: PropTypes.func,
    addUserState: PropTypes.object,
    closeThisDialog: PropTypes.func.isRequired,
    error: PropTypes.object,
    handleSubmit: PropTypes.func,
    users: PropTypes.object,
    requesting: PropTypes.bool,
    resetAddUser: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(UserAddModalForm);
