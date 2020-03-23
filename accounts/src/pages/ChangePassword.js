import React from 'react';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import { connect } from 'react-redux';
import ChangePasswordForm from '../components/auth/ChangePasswordForm';
import { history } from '../store';

class ChangePasswordPage extends React.Component {
    constructor(props) {
        super(props);
        this.props = props;
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

        return (
            <div id="wrap" style={{ paddingTop: 0 }}>
                {/* Header */}
                <div id="header">
                    <h1>
                        <a href="/">Fyipe</a>
                    </h1>
                </div>
                {/* RESET PASSWORD BOX */}
                <ChangePasswordForm token={this.token} />
                <div className="below-box">
                    <p>
                        <Link to="/accounts/login">
                            Know your password? <strong>Sign in</strong>.
                        </Link>
                    </p>
                </div>
                {/* END CONTENT */}
                <div id="footer_spacer" />
                <div id="bottom">
                    <ul>
                        {!masterAdminExists && !requestingMasterAdmin && (
                            <li>
                                <Link to="/accounts/register">Sign Up</Link>
                            </li>
                        )}
                        <li>
                            <a href="http://fyipe.com/legal/privacy">
                                Privacy Policy
                            </a>
                        </li>
                        <li>
                            <a href="http://fyipe.com/support">Support</a>
                        </li>
                        <li className="last">
                            <a href="https://hackerbay.io">© HackerBay, Inc.</a>
                        </li>
                    </ul>
                </div>
            </div>
        );
    }
}

const mapStateToProps = state => {
    return {
        masterAdminExists: state.login.masterAdmin.exists,
        requestingMasterAdmin: state.login.masterAdmin.requesting,
    };
};

const mapDispatchToProps = dispatch_Ignored => {
    return null;
};

ChangePasswordPage.propTypes = {
    match: PropTypes.object.isRequired,
    masterAdminExists: PropTypes.bool,
    requestingMasterAdmin: PropTypes.bool,
};

ChangePasswordPage.displayName = 'ChangePasswordPage';

export default connect(mapStateToProps, mapDispatchToProps)(ChangePasswordPage);
