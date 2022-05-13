import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { ButtonSpinner } from '../components/basic/Loader';
import { verifyBackupCode } from '../actions/login';
import { bindActionCreators } from 'redux';
import { RenderField } from '../components/basic/RenderField';
import { Link } from 'react-router-dom';
import { ACCOUNTS_URL } from '../config';
const errorStyle = { color: '#c23d4b' };
export class VerifyBackupCode extends Component {
    constructor(props) {
        super(props);
        this.submitForm = (values) => {
            const email = this.props.login.user.email;
            this.props.verifyBackupCode(Object.assign(Object.assign({}, values), { email }));
        };
    }
    componentDidMount() {
        document.body.id = 'login';
        document.body.style.overflow = 'auto';
    }
    render() {
        if (!this.props.login.user.email)
            window.location.href = ACCOUNTS_URL + '/login';
        const { backupCode } = this.props.login;
        let header;
        if (backupCode.error) {
            header = React.createElement("span", { style: errorStyle }, backupCode.error);
        }
        else {
            header = React.createElement("span", null, "Backup Code.");
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
                            React.createElement("p", { className: "error-message hidden" }),
                            React.createElement("p", { className: "message" }, "Enter your backup code below to login."),
                            React.createElement("div", null,
                                React.createElement("p", { className: "text" },
                                    React.createElement("span", null,
                                        React.createElement("label", { htmlFor: "code" }, "Backup Code"),
                                        React.createElement(Field, { component: RenderField, type: "text", name: "code", id: "code", placeholder: "Backup Code" }))),
                                React.createElement("p", { className: "submit" },
                                    React.createElement("button", { type: "submit", className: "button blue medium", disabled: backupCode.requesting },
                                        !backupCode.requesting && (React.createElement("span", null, "Verify Code")),
                                        backupCode.requesting && (React.createElement(ButtonSpinner, null))))))))),
            React.createElement("div", { className: "below-box" },
                React.createElement("p", null,
                    "Have a google app authenticator?",
                    ' ',
                    React.createElement(Link, { to: "/accounts/user-auth/token" }, "Enter Auth Token"),
                    ".")),
            React.createElement("div", { id: "footer_spacer" }),
            React.createElement("div", { id: "bottom" },
                React.createElement("ul", null,
                    React.createElement("li", null,
                        React.createElement(Link, { to: "/accounts/login" }, "Sign In")),
                    React.createElement("li", null,
                        React.createElement("a", { href: "http://oneuptime.com/legal/privacy" }, "Privacy Policy")),
                    React.createElement("li", null,
                        React.createElement("a", { href: "http://oneuptime.com/support" }, "Support")),
                    React.createElement("li", { className: "last" },
                        React.createElement("a", { href: "https://hackerbay.io" }, "\u00A9 HackerBay, Inc."))))));
    }
}
VerifyBackupCode.displayName = '';
VerifyBackupCode.propTypes = {};
VerifyBackupCode.displayName = 'VerifyBackupCode';
function validate(values) {
    const errors = {};
    if (!values.code) {
        errors.code = 'Please provide a backup code.';
    }
    return errors;
}
const verifyBackupCodeForm = reduxForm({
    form: 'verifyBackupCode',
    validate,
})(VerifyBackupCode);
const mapStateToProps = (state) => {
    return { login: state.login };
};
const mapDispatchToProps = (dispatch) => bindActionCreators({ verifyBackupCode }, dispatch);
VerifyBackupCode.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    verifyBackupCode: PropTypes.func,
    login: PropTypes.object,
};
export default connect(mapStateToProps, mapDispatchToProps)(verifyBackupCodeForm);
