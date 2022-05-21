import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { Fade } from 'react-awesome-reveal';
import { Validate } from '../../config';
import { ButtonSpinner } from '../basic/Loader.js';
import { resetPasswordError, resetPasswordSuccess, resetPassword, resetResetPassword, } from '../../actions/resetPassword';
import { bindActionCreators } from 'redux';
import { RenderField } from '../basic/RenderField';
const errorStyle = {
    color: '#c23d4b',
};
export class ResetPasswordForm extends Component {
    constructor() {
        super(...arguments);
        this.submitForm = (values) => {
            this.props.resetPassword(values);
        };
    }
    render() {
        const resetPasswordError = this.props.resetPasswordState.error;
        let header;
        if (resetPasswordError) {
            header = (React.createElement("span", { style: errorStyle, id: "error-msg" }, resetPasswordError));
        }
        else {
            header = React.createElement("span", null, "Reset Password.");
        }
        return (React.createElement(Fade, null,
            React.createElement("div", { id: "main-body", className: "box css" },
                React.createElement("div", { className: "inner" },
                    React.createElement("form", { onSubmit: this.props.handleSubmit(this.submitForm), className: "request-reset" },
                        React.createElement("div", { className: "request-reset-step" },
                            React.createElement("div", { className: "title" },
                                React.createElement("h2", null, header)),
                            this.props.resetPasswordState.success && (React.createElement("p", { id: "reset-password-success", className: "message" },
                                ' ',
                                "An email is on its way to you. Follow the instructions to reset your password. Please don't forget to check spam.",
                                ' ')),
                            !this.props.resetPasswordState.success && (React.createElement("p", { className: "message" },
                                ' ',
                                "Enter your email address below and we will send you a link to reset your password.",
                                ' ')),
                            !this.props.resetPasswordState.success && (React.createElement("div", null,
                                ' ',
                                React.createElement("p", { className: "text" },
                                    React.createElement("span", null,
                                        React.createElement("label", { htmlFor: "email" },
                                            ' ',
                                            "Your Email"),
                                        React.createElement(Field, { component: RenderField, type: "email", name: "email", id: "email", placeholder: "Your Email" }))),
                                React.createElement("p", { className: "submit" },
                                    React.createElement("button", { type: "submit", className: "button blue medium", disabled: this.props
                                            .resetPasswordState
                                            .requesting },
                                        !this.props.resetPasswordState
                                            .requesting && (React.createElement("span", null, "Reset Password")),
                                        this.props.resetPasswordState
                                            .requesting && (React.createElement(ButtonSpinner, null)))),
                                ' '))))))));
    }
}
ResetPasswordForm.displayName = '';
ResetPasswordForm.propTypes = {};
ResetPasswordForm.displayName = 'ResetPasswordForm';
function validate(values) {
    const errors = {};
    if (!Validate.text(values.email)) {
        errors.email = 'Email is required.';
    }
    else if (!Validate.email(values.email)) {
        errors.email = 'Email is invalid.';
    }
    return errors;
}
const resetPasswordForm = reduxForm({
    form: 'resetPasswordForm',
    validate,
})(ResetPasswordForm);
const mapDispatchToProps = (dispatch) => {
    return bindActionCreators({
        resetPasswordError,
        resetPasswordSuccess,
        resetPassword,
        resetResetPassword,
    }, dispatch);
};
function mapStateToProps(state) {
    return {
        resetPasswordState: state.resetPassword,
    };
}
ResetPasswordForm.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    resetPasswordState: PropTypes.object.isRequired,
    resetPassword: PropTypes.func.isRequired,
};
export default connect(mapStateToProps, mapDispatchToProps)(resetPasswordForm);
