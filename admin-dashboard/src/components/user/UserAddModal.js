import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { Field, reduxForm } from 'redux-form';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { RenderField } from '../basic/RenderField';
import { Validate } from '../../config';
import { addUser, resetAddUser } from '../../actions/user';

class UserAddModal extends Component {
    submitForm = values => {
        const { addUser, closeThisDialog, resetAddUser } = this.props;

        addUser(values).then(
            function(val) {
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

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                this.props.resetAddUser();
                return this.props.closeThisDialog();
            default:
                return false;
        }
    };

    render() {
        const {
            handleSubmit,
            closeThisDialog,
            addUserState,
            users,
            resetAddUser,
        } = this.props;
        const disabled = addUserState.requesting || users.requesting;

        return (
            <div
                onKeyDown={this.handleKeyBoard}
                className="ModalLayer-contents"
                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM">
                    <div className="bs-Modal bs-Modal--medium">
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
                            id="frmIncident"
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
                                                            disabled={disabled}
                                                        />
                                                    </div>
                                                </div>
                                                <div className="bs-Fieldset-row">
                                                    <label
                                                        htmlFor="name"
                                                        className="bs-Fieldset-label"
                                                    >
                                                        <span>Full Name</span>
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
                                                            disabled={disabled}
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
                                                            disabled={disabled}
                                                        />
                                                    </div>
                                                </div>
                                                <div className="bs-Fieldset-row">
                                                    <label
                                                        htmlFor="companyPhoneNumber"
                                                        className="bs-Fieldset-label"
                                                    >
                                                        <span>
                                                            Company Phone Number
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
                                                            disabled={disabled}
                                                        />
                                                    </div>
                                                </div>
                                                <div className="bs-Fieldset-row">
                                                    <label
                                                        htmlFor="password"
                                                        className="bs-Fieldset-label"
                                                    >
                                                        <span>Password</span>
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
                                                            disabled={disabled}
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
                                                            disabled={disabled}
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
                                        if={addUserState && addUserState.error}
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
                                                        {addUserState.error}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </ShouldRender>
                                    <button
                                        className="bs-Button bs-DeprecatedButton"
                                        type="button"
                                        onClick={() => {
                                            resetAddUser();
                                            closeThisDialog();
                                        }}
                                        disabled={disabled}
                                    >
                                        <span>Cancel</span>
                                    </button>
                                    <button
                                        id="add_user_btn"
                                        className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                        disabled={disabled}
                                        type="submit"
                                    >
                                        {addUserState &&
                                            !addUserState.requesting && (
                                                <span>Create</span>
                                            )}
                                        {addUserState &&
                                            addUserState.requesting && (
                                                <FormLoader />
                                            )}
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

UserAddModal.displayName = 'UserAddModalForm';

const validate = function(values) {
    const error = {};

    if (!Validate.text(values.name)) error.name = 'Name is required.';

    if (Validate.text(values.name) && !Validate.isValidName(values.name))
        error.name = 'Name is not valid.';

    if (!Validate.text(values.email)) error.email = 'Email is required.';

    if (Validate.text(values.email) && !Validate.email(values.email))
        error.email = 'Email is not valid.';

    if (
        !Validate.isValidBusinessEmail(values.email) &&
        Validate.email(values.email)
    )
        error.email = 'Please enter a business email address.';

    if (!Validate.text(values.companyName))
        error.companyName = 'Company name is required.';

    if (!Validate.text(values.companyPhoneNumber))
        error.companyPhoneNumber = 'Phone number is required.';

    if (
        Validate.text(values.companyPhoneNumber) &&
        !Validate.isValidNumber(values.companyPhoneNumber)
    )
        error.companyPhoneNumber = 'Phone number is invalid.';

    if (!Validate.text(values.password))
        error.password = 'Password is required.';
    if (
        Validate.text(values.password) &&
        !Validate.isStrongPassword(values.password)
    ) {
        error.password = 'Password should be atleast 8 characters long';
    }

    if (!Validate.text(values.confirmPassword))
        error.confirmPassword = 'Confirm Password is required.';

    if (!Validate.compare(values.password, values.confirmPassword)) {
        error.confirmPassword = 'Password and confirm password should match.';
    }

    return error;
};

const UserAddModalForm = reduxForm({
    form: 'AddProbe', // a unique identifier for this form
    validate,
})(UserAddModal);

const mapDispatchToProps = dispatch => {
    return bindActionCreators({ addUser, resetAddUser }, dispatch);
};

function mapStateToProps(state) {
    return {
        addUserState: state.user.addUser,
        users: state.user.users,
    };
}

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
