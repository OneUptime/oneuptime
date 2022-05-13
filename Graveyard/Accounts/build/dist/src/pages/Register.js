import React from 'react';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import RegisterForm from '../components/auth/RegisterForm';
import queryString from 'query-string';
import { PricingPlan, IS_SAAS_SERVICE } from '../config';
import MessageBox from '../components/MessageBox';
import { savePlanId, signUpReset } from '../actions/register';
class RegisterPage extends React.Component {
    componentWillUnmount() {
        document.body.id = '';
        document.body.className = '';
        this.props.signUpReset();
    }
    componentDidMount() {
        document.body.id = 'login';
        document.body.className = 'register-page';
        document.body.style.overflow = 'auto';
        this.planId =
            queryString.parse(this.props.location.search).planId || null;
        if (!this.planId) {
            this.planId = PricingPlan.getPlans()[0].planId;
        }
        this.props.savePlanId(this.planId);
    }
    componentDidUpdate() {
        if (this.props.masterAdminExists &&
            !this.props.register.success &&
            !IS_SAAS_SERVICE) {
            window.location.href = '/accounts/login';
        }
    }
    render() {
        const { register } = this.props;
        return (React.createElement("div", { id: "wrap", style: { paddingTop: 0 } },
            React.createElement("div", { id: "header" },
                React.createElement("h1", null,
                    React.createElement("a", { href: "/" }, "OneUptime"))),
            this.props.register.success &&
                !this.props.masterAdminExists &&
                !register.user.cardRegistered &&
                !register.user.token ? (React.createElement(MessageBox, { title: "Activate your OneUptime account", message: "An email is on its way to you with a verification link. Please don't forget to check spam. " })) : (React.createElement(RegisterForm, { planId: this.planId, location: this.props.location })),
            React.createElement("div", { id: "loginLink", className: "below-box" },
                React.createElement("p", null,
                    "Already have an account?",
                    ' ',
                    React.createElement(Link, { to: "/accounts/login" }, "Sign in"),
                    ".")),
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
                        React.createElement("a", { href: "https://hackerbay.io" }, "\u00A9 HackerBay, Inc."))))));
    }
}
const mapStateToProps = (state) => {
    return {
        register: state.register,
        masterAdminExists: state.login.masterAdmin.exists,
    };
};
const mapDispatchToProps = (dispatch) => {
    return bindActionCreators({
        savePlanId,
        signUpReset,
    }, dispatch);
};
RegisterPage.propTypes = {
    location: PropTypes.object.isRequired,
    register: PropTypes.object,
    success: PropTypes.bool,
    savePlanId: PropTypes.func.isRequired,
    signUpReset: PropTypes.func.isRequired,
    masterAdminExists: PropTypes.bool,
};
RegisterPage.displayName = 'RegisterPage';
export default connect(mapStateToProps, mapDispatchToProps)(RegisterPage);
