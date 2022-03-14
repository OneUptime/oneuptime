import React from 'react';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Link } from 'react-router-dom';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-awesome-reveal/Fade';
import LoginForm from '../components/auth/LoginForm';
import { loginUser, loginUserSso, loginError } from '../actions/login';
import MessageBox from '../components/MessageBox';

import { DISABLE_SIGNUP } from '../config';
import { history } from '../store';
import { resendTokenReset, resendToken } from '../actions/resendToken';
import { ButtonSpinner } from '../components/basic/Loader';
import { changeLogin } from '../actions/login';

class LoginPage extends React.Component {
    constructor(props: $TSFixMe) {
        super(props);
        // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'props' because it is a read-only... Remove this comment to see the full error message
        this.props = props;
    }

    componentDidMount() {
        document.body.id = 'login';
        document.body.style.overflow = 'auto';

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
        if (this.props.location?.pathname?.includes('/sso/')) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'changeLogin' does not exist on type 'Rea... Remove this comment to see the full error message
            this.props.changeLogin('sso');
        }
    }

    submitHandler = (values: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'loginMethod' does not exist on type 'Rea... Remove this comment to see the full error message
        if (this.props.loginMethod === 'sso') {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'loginUserSso' does not exist on type 'Re... Remove this comment to see the full error message
            this.props.loginUserSso(values);
        } else {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'loginUser' does not exist on type 'Reado... Remove this comment to see the full error message
            this.props.loginUser(values);
        }
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'login' does not exist on type 'Readonly<... Remove this comment to see the full error message
        const { login, masterAdminExists, requestingMasterAdmin } = this.props;

        if (login.success && !login.user.tokens) {
            history.push('/user-auth/token');
        }

        return (
            <Fade>
                <div id="wrap">
                    <div id="header">
                        <h1>
                            <a aria-hidden={false} href="/">
                                OneUptime
                            </a>
                        </h1>
                    </div>

                    {/* LOGIN BOX */}
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'login' does not exist on type 'Readonly<... Remove this comment to see the full error message
                    {!this.props.login.success &&
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'login' does not exist on type 'Readonly<... Remove this comment to see the full error message
                        this.props.login.error &&
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'login' does not exist on type 'Readonly<... Remove this comment to see the full error message
                        this.props.login.error === 'Verify your email first.' ? (
                        <div>
                            <MessageBox
                                title="Your email is not verified."
                                message={`${
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'resendTokenRequest' does not exist on ty... Remove this comment to see the full error message
                                    this.props.resendTokenRequest.requesting
                                        ? 'Resending verification link...'
                                        : "An email is on its way to you with new verification link. Please don't forget to check spam."
                                    }`}
                            >
                                <div className="below-box">
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'resendTokenRequest' does not exist on ty... Remove this comment to see the full error message
                                    {this.props.resendTokenRequest
                                        .requesting ? (
                                        <ButtonSpinner color="black" />
                                    ) : (
                                        <p>
                                            Click{' '}
                                            <span
                                                style={{
                                                    cursor: 'pointer',
                                                    fontWeight: 'bold',
                                                    textDecoration: 'underline',
                                                }}
                                                onClick={() => {
                                                    if (
                                                        login.user &&
                                                        login.user.email
                                                    ) {
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'resendToken' does not exist on type 'Rea... Remove this comment to see the full error message
                                                        this.props.resendToken(
                                                            login.user
                                                        );
                                                    } else {
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'resendTokenReset' does not exist on type... Remove this comment to see the full error message
                                                        this.props.resendTokenReset();
                                                        history.push(
                                                            '/accounts/user-verify/resend'
                                                        );
                                                    }
                                                }}
                                            >
                                                here
                                            </span>{' '}
                                            to resend verification link to your
                                            email.
                                        </p>
                                    )}
                                </div>
                            </MessageBox>
                        </div>
                    ) : (
                        <LoginForm
                            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children?: ReactNode; onSubmit: (values: a... Remove this comment to see the full error message
                            onSubmit={this.submitHandler}
                            {...this.props}
                        />
                    )}

                    {/* FOOTER */}
                    {!masterAdminExists &&
                        !requestingMasterAdmin &&
                        !DISABLE_SIGNUP && (
                            <div id="signUpLink" className="below-box">
                                <p>
                                    Don&#39;t have an account?{' '}
                                    <Link to="/accounts/register">Sign up</Link>
                                    .
                                </p>
                            </div>
                        )}

                    {/* END FOOTER */}
                    <div id="footer_spacer" />
                    <div id="bottom">
                        <ul>
                            <li>
                                <Link to="/accounts/forgot-password">
                                    Forgot Password
                                </Link>
                            </li>
                            <li>
                                <a href="http://oneuptime.com/legal/privacy">
                                    Privacy Policy
                                </a>
                            </li>
                            <li>
                                <a href="http://oneuptime.com/support">
                                    Support
                                </a>
                            </li>
                            <li className="last">
                                <a href="https://hackerbay.io">
                                    © HackerBay, Inc.
                                </a>
                            </li>
                        </ul>
                    </div>
                </div>
            </Fade>
        );
    }
}

const mapStateToProps = (state: $TSFixMe) => {
    return {
        login: state.login,
        masterAdminExists: state.login.masterAdmin.exists,
        requestingMasterAdmin: state.login.masterAdmin.requesting,
        loginMethod: state.login.loginMethod,
        resendTokenRequest: state.resendToken,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        loginUser,
        loginUserSso,
        loginError,
        resendTokenReset,
        resendToken,
        changeLogin,
    },
    dispatch
);

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
LoginPage.propTypes = {
    loginUser: PropTypes.func.isRequired,
    loginUserSso: PropTypes.func.isRequired,
    loginMethod: PropTypes.string.isRequired,
    login: PropTypes.object,
    success: PropTypes.bool,
    error: PropTypes.oneOfType([PropTypes.object, PropTypes.bool]),
    location: PropTypes.object,
    masterAdminExists: PropTypes.bool,
    requestingMasterAdmin: PropTypes.bool,
    resendToken: PropTypes.func,
    resendTokenRequest: PropTypes.object,
    resendTokenReset: PropTypes.func,
    changeLogin: PropTypes.func,
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
LoginPage.displayName = 'LoginPage';

export default connect(mapStateToProps, mapDispatchToProps)(LoginPage);
