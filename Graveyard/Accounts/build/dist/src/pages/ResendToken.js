import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { Validate } from '../config';
import { ButtonSpinner } from '../components/basic/Loader';
import { resendToken } from '../actions/resendToken';
import { bindActionCreators } from 'redux';
import { RenderField } from '../components/basic/RenderField';
import { Link } from 'react-router-dom';
import queryString from 'query-string';
import { removeQuery } from '../store';
const errorStyle = {
    color: '#c23d4b',
};
export class ResendTokenForm extends Component {
    constructor() {
        super(...arguments);
        this.state = {
            serverResponse: '',
        };
        this.submitForm = (values) => {
            this.props.resendToken(values);
        };
    }
    componentDidMount() {
        document.body.id = 'login';
        document.body.style.overflow = 'auto';
        const query = queryString.parse(this.props.location.search).status;
        if (query === 'link-expired') {
            this.setState({
                serverResponse: 'Verification link expired.',
            });
        }
        else if (query === 'invalid-verification-link') {
            this.setState({
                serverResponse: 'Invalid Verification link.',
            });
        }
        removeQuery();
    }
    render() {
        const { masterAdminExists, requestingMasterAdmin } = this.props;
        const { serverResponse } = this.state;
        const { success } = this.props.resendTokenState;
        const resendTokenError = this.props.resendTokenState.error;
        let header;
        if (success) {
            header = React.createElement("span", null, "Verification Email Sent");
        }
        else if (resendTokenError) {
            header = (React.createElement("span", { style: errorStyle, id: "error-msg" }, resendTokenError));
        }
        else if (serverResponse) {
            header = (React.createElement("span", { style: errorStyle, id: "error-msg" }, serverResponse));
        }
        else {
            header = React.createElement("span", null, "Resend verification email.");
        }
        return (React.createElement("div", { id: "wrap", style: { paddingTop: 0 } },
            React.createElement("div", { id: "header" },
                React.createElement("h1", null,
                    React.createElement("a", { href: "/" }, "OneUptime"))),
            React.createElement("div", { id: "main-body", className: "box css" },
                React.createElement("div", { className: "inner" },
                    React.createElement("form", { onSubmit: this.props.handleSubmit(this.submitForm), className: "request-reset" },
                        React.createElement("div", { className: "request-reset-step" },
                            React.createElement("div", { className: "title" },
                                React.createElement("h2", null, header)),
                            this.props.resendTokenState.success && (React.createElement("p", { id: "resend-verification-success", className: "message" },
                                ' ',
                                "An email is on its way to you with new verification link. Please don't forget to check spam.",
                                ' ')),
                            !this.props.resendTokenState.success && (React.createElement("p", { className: "message" },
                                ' ',
                                "Enter your email address below and we will resend you a verification link to activate your oneuptime account.")),
                            !this.props.resendTokenState.success && (React.createElement("div", null,
                                ' ',
                                React.createElement("p", { className: "text" },
                                    React.createElement("span", null,
                                        React.createElement("label", { htmlFor: "email" }, "Your Email"),
                                        React.createElement(Field, { component: RenderField, type: "email", name: "email", id: "email", placeholder: "Your Email" }))),
                                React.createElement("p", { className: "submit" },
                                    React.createElement("button", { type: "submit", className: "button blue medium", disabled: this.props.resendTokenState
                                            .requesting },
                                        !this.props.resendTokenState
                                            .requesting && (React.createElement("span", null, "Send Verification Link")),
                                        this.props.resendTokenState
                                            .requesting && (React.createElement(ButtonSpinner, null)))),
                                ' ')))))),
            React.createElement("div", { id: "footer_spacer" }),
            React.createElement("div", { id: "bottom" },
                React.createElement("ul", null,
                    !masterAdminExists && !requestingMasterAdmin && (React.createElement("li", null,
                        React.createElement(Link, { to: "/accounts/register" }, "Sign Up"))),
                    React.createElement("li", null,
                        React.createElement("a", { href: "http://oneuptime.com/legal/privacy" }, "Privacy Policy")),
                    React.createElement("li", null,
                        React.createElement("a", { href: "http://oneuptime.com/support" }, "Support")),
                    React.createElement("li", { className: "last" },
                        React.createElement("a", { href: "https://hackerbay.io" }, "\u00A9 HackerBay, Inc."))))));
    }
}
ResendTokenForm.displayName = '';
ResendTokenForm.propTypes = {};
ResendTokenForm.displayName = 'ResendTokenForm';
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
const resendTokenForm = reduxForm({
    form: 'resendTokenForm',
    validate,
})(ResendTokenForm);
const mapDispatchToProps = (dispatch) => {
    return bindActionCreators({
        resendToken,
    }, dispatch);
};
function mapStateToProps(state) {
    return {
        resendTokenState: state.resendToken,
        masterAdminExists: state.login.masterAdmin.exists,
        requestingMasterAdmin: state.login.masterAdmin.requesting,
    };
}
ResendTokenForm.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    resendTokenState: PropTypes.object.isRequired,
    resendToken: PropTypes.func.isRequired,
    location: PropTypes.object.isRequired,
    masterAdminExists: PropTypes.bool,
    requestingMasterAdmin: PropTypes.bool,
};
export default connect(mapStateToProps, mapDispatchToProps)(resendTokenForm);
