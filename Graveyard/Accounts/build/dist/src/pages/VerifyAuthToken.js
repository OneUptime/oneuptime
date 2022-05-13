import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { ButtonSpinner } from '../components/basic/Loader';
import { verifyAuthToken } from '../actions/login';
import { bindActionCreators } from 'redux';
import { RenderField } from '../components/basic/RenderField';
import { Link } from 'react-router-dom';
import { ACCOUNTS_URL } from '../config';
const errorStyle = { color: '#c23d4b' };
export class VerifyAuthToken extends Component {
    constructor(props) {
        super(props);
        this.submitForm = (values) => {
            const email = this.props.login.user.email;
            this.props.verifyAuthToken(Object.assign(Object.assign({}, values), { email }));
        };
    }
    componentDidMount() {
        document.body.id = 'login';
        document.body.style.overflow = 'auto';
    }
    render() {
        if (!this.props.login.user.email)
            window.location.href = ACCOUNTS_URL + '/login';
        const { error } = this.props.login.authToken;
        let header;
        if (error) {
            header = React.createElement("span", { style: errorStyle }, error);
        }
        else {
            header = React.createElement("span", null, "Two Factor Auth token.");
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
                            React.createElement("p", { className: "message" }, "Enter your auth token below to login."),
                            React.createElement("div", null,
                                React.createElement("p", { className: "text" },
                                    React.createElement("span", null,
                                        React.createElement("label", { htmlFor: "token" }, "Verification Token"),
                                        React.createElement(Field, { component: RenderField, type: "text", name: "token", id: "token", placeholder: "Token" }))),
                                React.createElement("p", { className: "submit" },
                                    React.createElement("button", { type: "submit", className: "button blue medium", disabled: this.props.login.authToken
                                            .requesting },
                                        !this.props.login.authToken
                                            .requesting && (React.createElement("span", null, "Verify token")),
                                        this.props.login.authToken
                                            .requesting && (React.createElement(ButtonSpinner, null))))))))),
            React.createElement("div", { className: "below-box" },
                React.createElement("p", null,
                    "Don't have your app authenticator?",
                    ' ',
                    React.createElement(Link, { to: "/accounts/user-auth/backup" }, "Use Backup code"),
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
VerifyAuthToken.displayName = '';
VerifyAuthToken.propTypes = {};
VerifyAuthToken.displayName = 'VerifyAuthToken';
function validate(values) {
    const errors = {};
    if (!values.token) {
        errors.token = 'Please provide token.';
    }
    return errors;
}
const verifyAuthTokenForm = reduxForm({
    form: 'verifyAuthToken',
    validate,
})(VerifyAuthToken);
const mapStateToProps = (state) => {
    return { login: state.login };
};
const mapDispatchToProps = (dispatch) => bindActionCreators({ verifyAuthToken }, dispatch);
VerifyAuthToken.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    verifyAuthToken: PropTypes.func.isRequired,
    login: PropTypes.object,
};
export default connect(mapStateToProps, mapDispatchToProps)(verifyAuthTokenForm);
