import React from 'react';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Link } from 'react-router-dom';
import { connect } from 'react-redux';
import ResetPasswordForm from '../components/auth/ResetPasswordForm';

class ResetPasswordPage extends React.Component {
    componentDidMount() {
        document.body.id = 'login';
        document.body.style.overflow = 'auto';
    }

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'masterAdminExists' does not exist on typ... Remove this comment to see the full error message
        const { masterAdminExists, requestingMasterAdmin } = this.props;

        return (
            <div id="wrap" style={{ paddingTop: 0 }}>
                {/* Header */}
                <div id="header">
                    <h1>
                        <a href="/">OneUptime</a>
                    </h1>
                </div>
                {/* RESET PASSWORD BOX */}
                <ResetPasswordForm />
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
                            <a href="http://oneuptime.com/legal/privacy">
                                Privacy Policy
                            </a>
                        </li>
                        <li>
                            <a href="http://oneuptime.com/support">Support</a>
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ResetPasswordPage.displayName = 'ResetPasswordPage';

const mapStateToProps = (state: $TSFixMe) => {
    return {
        masterAdminExists: state.login.masterAdmin.exists,
        requestingMasterAdmin: state.login.masterAdmin.requesting,
    };
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ResetPasswordPage.propTypes = {
    masterAdminExists: PropTypes.bool,
    requestingMasterAdmin: PropTypes.bool,
};

export default connect(mapStateToProps, null)(ResetPasswordPage);
