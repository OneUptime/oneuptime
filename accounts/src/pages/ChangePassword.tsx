import React from 'react';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Link } from 'react-router-dom';
import { connect } from 'react-redux';
import ChangePasswordForm from '../components/auth/ChangePasswordForm';
import { history } from '../store';

class ChangePasswordPage extends React.Component {
    token: $TSFixMe;
    constructor(props: $TSFixMe) {
        super(props);
        // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'props' because it is a read-only... Remove this comment to see the full error message
        this.props = props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'match' does not exist on type 'Readonly<... Remove this comment to see the full error message
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
                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ token: any; }' is not assignable to type '... Remove this comment to see the full error message
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

const mapStateToProps = (state: $TSFixMe) => {
    return {
        masterAdminExists: state.login.masterAdmin.exists,
        requestingMasterAdmin: state.login.masterAdmin.requesting,
    };
};

const mapDispatchToProps = () => {
    return null;
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ChangePasswordPage.propTypes = {
    match: PropTypes.object.isRequired,
    masterAdminExists: PropTypes.bool,
    requestingMasterAdmin: PropTypes.bool,
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ChangePasswordPage.displayName = 'ChangePasswordPage';

export default connect(mapStateToProps, mapDispatchToProps)(ChangePasswordPage);
