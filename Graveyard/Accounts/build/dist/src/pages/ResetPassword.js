import React from 'react';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import { connect } from 'react-redux';
import ResetPasswordForm from '../components/auth/ResetPasswordForm';
class ResetPasswordPage extends React.Component {
    componentDidMount() {
        document.body.id = 'login';
        document.body.style.overflow = 'auto';
    }
    render() {
        const { masterAdminExists, requestingMasterAdmin } = this.props;
        return (React.createElement("div", { id: "wrap", style: { paddingTop: 0 } },
            React.createElement("div", { id: "header" },
                React.createElement("h1", null,
                    React.createElement("a", { href: "/" }, "OneUptime"))),
            React.createElement(ResetPasswordForm, null),
            React.createElement("div", { className: "below-box" },
                React.createElement("p", null,
                    React.createElement(Link, { to: "/accounts/login" },
                        "Know your password? ",
                        React.createElement("strong", null, "Sign in"),
                        "."))),
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
ResetPasswordPage.displayName = 'ResetPasswordPage';
const mapStateToProps = (state) => {
    return {
        masterAdminExists: state.login.masterAdmin.exists,
        requestingMasterAdmin: state.login.masterAdmin.requesting,
    };
};
ResetPasswordPage.propTypes = {
    masterAdminExists: PropTypes.bool,
    requestingMasterAdmin: PropTypes.bool,
};
export default connect(mapStateToProps, null)(ResetPasswordPage);
