import React from 'react';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { Fade } from 'react-awesome-reveal';
import LoginForm from '../components/auth/LoginForm';
import { loginUser, loginUserSso, loginError } from '../actions/login';
import MessageBox from '../components/MessageBox';
import { DISABLE_SIGNUP } from '../config';
import { history } from '../store';
import { resendTokenReset, resendToken } from '../actions/resendToken';
import { ButtonSpinner } from '../components/basic/Loader';
import { changeLogin } from '../actions/login';
class LoginPage extends React.Component {
    constructor(props) {
        super(props);
        this.submitHandler = (values) => {
            if (this.props.loginMethod === 'sso') {
                this.props.loginUserSso(values);
            }
            else {
                this.props.loginUser(values);
            }
        };
        this.props = props;
    }
    componentDidMount() {
        var _a, _b;
        document.body.id = 'login';
        document.body.style.overflow = 'auto';
        if ((_b = (_a = this.props.location) === null || _a === void 0 ? void 0 : _a.pathname) === null || _b === void 0 ? void 0 : _b.includes('/sso/')) {
            this.props.changeLogin('sso');
        }
    }
    render() {
        const { login, masterAdminExists, requestingMasterAdmin } = this.props;
        if (login.success && !login.user.tokens) {
            history.push('/user-auth/token');
        }
        return (React.createElement(Fade, null,
            React.createElement("div", { id: "wrap" },
                React.createElement("div", { id: "header" },
                    React.createElement("h1", null,
                        React.createElement("a", { "aria-hidden": false, href: "/" }, "OneUptime"))),
                !this.props.login.success &&
                    this.props.login.error &&
                    this.props.login.error === 'Verify your email first.' ? (React.createElement("div", null,
                    React.createElement(MessageBox, { title: "Your email is not verified.", message: `${this.props.resendTokenRequest.requesting
                            ? 'Resending verification link...'
                            : "An email is on its way to you with new verification link. Please don't forget to check spam."}` },
                        React.createElement("div", { className: "below-box" }, this.props.resendTokenRequest
                            .requesting ? (React.createElement(ButtonSpinner, { color: "black" })) : (React.createElement("p", null,
                            "Click",
                            ' ',
                            React.createElement("span", { style: {
                                    cursor: 'pointer',
                                    fontWeight: 'bold',
                                    textDecoration: 'underline',
                                }, onClick: () => {
                                    if (login.user &&
                                        login.user.email) {
                                        this.props.resendToken(login.user);
                                    }
                                    else {
                                        this.props.resendTokenReset();
                                        history.push('/accounts/user-verify/resend');
                                    }
                                } }, "here"),
                            ' ',
                            "to resend verification link to your email.")))))) : (React.createElement(LoginForm, Object.assign({ onSubmit: this.submitHandler }, this.props))),
                !masterAdminExists &&
                    !requestingMasterAdmin &&
                    !DISABLE_SIGNUP && (React.createElement("div", { id: "signUpLink", className: "below-box" },
                    React.createElement("p", null,
                        "Don't have an account?",
                        ' ',
                        React.createElement(Link, { to: "/accounts/register" }, "Sign up"),
                        "."))),
                React.createElement("div", { id: "footer_spacer" }),
                React.createElement("div", { id: "bottom" },
                    React.createElement("ul", null,
                        React.createElement("li", null,
                            React.createElement(Link, { to: "/accounts/forgot-password" }, "Forgot Password")),
                        React.createElement("li", null,
                            React.createElement("a", { href: "http://oneuptime.com/legal/privacy" }, "Privacy Policy")),
                        React.createElement("li", null,
                            React.createElement("a", { href: "http://oneuptime.com/support" }, "Support")),
                        React.createElement("li", { className: "last" },
                            React.createElement("a", { href: "https://hackerbay.io" }, "\u00A9 HackerBay, Inc.")))))));
    }
}
const mapStateToProps = (state) => {
    return {
        login: state.login,
        masterAdminExists: state.login.masterAdmin.exists,
        requestingMasterAdmin: state.login.masterAdmin.requesting,
        loginMethod: state.login.loginMethod,
        resendTokenRequest: state.resendToken,
    };
};
const mapDispatchToProps = (dispatch) => bindActionCreators({
    loginUser,
    loginUserSso,
    loginError,
    resendTokenReset,
    resendToken,
    changeLogin,
}, dispatch);
LoginPage.propTypes = {
    loginUser: PropTypes.func.isRequired,
    loginUserSso: PropTypes.func.isRequired,
    loginMethod: PropTypes.string.isRequired,
    login: PropTypes.object,
    success: PropTypes.bool,
    error: PropTypes.object,
    location: PropTypes.object,
    masterAdminExists: PropTypes.bool,
    requestingMasterAdmin: PropTypes.bool,
    resendToken: PropTypes.func,
    resendTokenRequest: PropTypes.object,
    resendTokenReset: PropTypes.func,
    changeLogin: PropTypes.func,
};
LoginPage.displayName = 'LoginPage';
export default connect(mapStateToProps, mapDispatchToProps)(LoginPage);
