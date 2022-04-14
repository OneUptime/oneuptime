import React from 'react';
import PropTypes from 'prop-types';

import { Link } from 'react-router-dom';
import { bindActionCreators, Dispatch } from 'redux';
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

interface LoginPageProps {
    loginUser: Function;
    loginUserSso: Function;
    loginMethod: string;
    login?: object;
    success?: boolean;
    error?: object;
    location?: object;
    masterAdminExists?: boolean;
    requestingMasterAdmin?: boolean;
    resendToken?: Function;
    resendTokenRequest?: object;
    resendTokenReset?: Function;
    changeLogin?: Function;
}

class LoginPage extends React.Component<LoginPageProps> {
    constructor(props: LoginPageProps) {
        super(props);
        this.props = props;
    }

    override componentDidMount() {
        document.body.id = 'login';
        document.body.style.overflow = 'auto';


        if (this.props.location?.pathname?.includes('/sso/')) {

            this.props.changeLogin('sso');
        }
    }

    submitHandler = (values: $TSFixMe) => {

        if (this.props.loginMethod === 'sso') {

            this.props.loginUserSso(values);
        } else {

            this.props.loginUser(values);
        }
    };

    override render() {

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

                    {!this.props.login.success &&

                        this.props.login.error &&

                        this.props.login.error === 'Verify your email first.' ? (
                        <div>
                            <MessageBox
                                title="Your email is not verified."
                                message={`${this.props.resendTokenRequest.requesting
                                    ? 'Resending verification link...'
                                    : "An email is on its way to you with new verification link. Please don't forget to check spam."
                                    }`}
                            >
                                <div className="below-box">

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

                                                        this.props.resendToken(
                                                            login.user
                                                        );
                                                    } else {

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

const mapStateToProps: Function = (state: RootState) => {
    return {
        login: state.login,
        masterAdminExists: state.login.masterAdmin.exists,
        requestingMasterAdmin: state.login.masterAdmin.requesting,
        loginMethod: state.login.loginMethod,
        resendTokenRequest: state.resendToken,
    };
};

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators(
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
