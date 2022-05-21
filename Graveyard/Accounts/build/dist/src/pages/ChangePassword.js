import React from 'react';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import { connect } from 'react-redux';
import ChangePasswordForm from '../components/auth/ChangePasswordForm';
import { history } from '../store';
class ChangePasswordPage extends React.Component {
    constructor(props) {
        super(props);
        this.token = this.props.match.params.token;
        //if token is not present. Redirect to login page.
        if (!this.token) {
            history.push('/login');
        }
    }
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
            React.createElement(ChangePasswordForm, { token: this.token }),
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
const mapStateToProps = (state) => {
    return {
        masterAdminExists: state.login.masterAdmin.exists,
        requestingMasterAdmin: state.login.masterAdmin.requesting,
    };
};
const mapDispatchToProps = () => {
    return null;
};
ChangePasswordPage.propTypes = {
    match: PropTypes.object.isRequired,
    masterAdminExists: PropTypes.bool,
    requestingMasterAdmin: PropTypes.bool,
};
ChangePasswordPage.displayName = 'ChangePasswordPage';
export default connect(mapStateToProps, mapDispatchToProps)(ChangePasswordPage);
