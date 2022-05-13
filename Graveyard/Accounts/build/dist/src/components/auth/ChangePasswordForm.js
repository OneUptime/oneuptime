import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { Validate } from '../../config';
import { ButtonSpinner } from '../basic/Loader.js';
import { changePasswordError, changePasswordSuccess, changePassword, resetChangePassword, } from '../../actions/changePassword';
import { bindActionCreators } from 'redux';
import { RenderField } from '../basic/RenderField';
import { Link } from 'react-router-dom';
const errorStyle = {
    color: '#c23d4b',
};
export class ChangePasswordForm extends Component {
    constructor() {
        super(...arguments);
        this.submitForm = (values) => {
            values.token = this.props.token || '';
            this.props.changePassword(values);
        };
    }
    render() {
        const changePasswordStateError = this.props.changePasswordState.error;
        let header;
        if (changePasswordStateError) {
            header = React.createElement("span", { style: errorStyle }, changePasswordStateError);
        }
        else {
            header = React.createElement("span", null, "Reset Password");
        }
        return (React.createElement("div", { id: "main-body", className: "box css" },
            React.createElement("div", { className: "inner" },
                React.createElement("form", { onSubmit: this.props.handleSubmit(this.submitForm), className: "request-reset" },
                    React.createElement("div", { className: "request-reset-step" },
                        React.createElement("div", { className: "title" },
                            React.createElement("h2", null, header)),
                        React.createElement("p", { className: "error-message hidden" }),
                        this.props.changePasswordState.success && (React.createElement("p", { className: "message" },
                            ' ',
                            "Your password is changed. Please",
                            ' ',
                            React.createElement(Link, { to: "/accounts/login" },
                                ' ',
                                "click here to login",
                                ' '),
                            ' ')),
                        !this.props.changePasswordState.success && (React.createElement("p", { className: "message" },
                            ' ',
                            "Please enter a new password to continue")),
                        !this.props.changePasswordState.success && (React.createElement("div", null,
                            ' ',
                            React.createElement("p", { className: "text" },
                                React.createElement("span", { id: "passwordField" },
                                    React.createElement("label", { htmlFor: "password" },
                                        ' ',
                                        "New Password",
                                        ' '),
                                    React.createElement(Field, { component: RenderField, type: "password", name: "password", id: "password", placeholder: "Password" }))),
                            React.createElement("p", { className: "text" },
                                React.createElement("span", { id: "confirmPasswordField" },
                                    React.createElement("label", { htmlFor: "confirmPassword" },
                                        ' ',
                                        "Confirm New Password",
                                        ' '),
                                    React.createElement(Field, { component: RenderField, type: "password", name: "confirmPassword", id: "confirmPassword", placeholder: "Confirm Password" }))),
                            React.createElement("p", { className: "submit" },
                                React.createElement("button", { type: "submit", className: "button blue medium", disabled: this.props.changePasswordState
                                        .requesting },
                                    !this.props.changePasswordState
                                        .requesting && (React.createElement("span", null, "Change Password")),
                                    this.props.changePasswordState
                                        .requesting && (React.createElement(ButtonSpinner, null)))),
                            ' ')))))));
    }
}
ChangePasswordForm.displayName = '';
ChangePasswordForm.propTypes = {};
ChangePasswordForm.displayName = 'ChangePasswordForm';
function validate(values) {
    const errors = {};
    if (!Validate.text(values.password)) {
        errors.password = 'Password is required.';
    }
    if (Validate.text(values.password) &&
        !Validate.isStrongPassword(values.password)) {
        errors.password = 'Password should be atleast 8 characters long';
    }
    if (!Validate.text(values.confirmPassword)) {
        errors.confirmPassword = 'Confirm Password is required.';
    }
    if (!Validate.compare(values.password, values.confirmPassword)) {
        errors.confirmPassword = 'Password and confirm password should match.';
    }
    return errors;
}
const changePasswordForm = reduxForm({
    form: 'changePasswordForm',
    validate,
})(ChangePasswordForm);
const mapDispatchToProps = (dispatch) => {
    return bindActionCreators({
        changePasswordError,
        changePasswordSuccess,
        changePassword,
        resetChangePassword,
    }, dispatch);
};
function mapStateToProps(state) {
    return {
        changePasswordState: state.changePassword,
    };
}
ChangePasswordForm.propTypes = {
    changePassword: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    changePasswordState: PropTypes.object.isRequired,
    token: PropTypes.any,
};
export default connect(mapStateToProps, mapDispatchToProps)(changePasswordForm);
