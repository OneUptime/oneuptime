import React from 'react';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import LoginForm from '../components/auth/LoginForm';
import { loginUser, loginUserSso, loginError } from '../actions/login';
import MessageBox from '../components/MessageBox';
import { identify, setUserId, logEvent } from '../analytics';
import { SHOULD_LOG_ANALYTICS } from '../config';
import { history } from '../store';

class LoginPage extends React.Component {
    constructor(props) {
        super(props);
        this.props = props;
    }

    componentDidMount() {
        document.body.id = 'login';
        document.body.style.overflow = 'auto';
    }

    submitHandler = values => {
        if (this.props.loginMethod === 'sso') {
            this.props.loginUserSso(values);
        } else {
            this.props.loginUser(values).then(user => {
                if (user && user.data && user.data.id) {
                    if (SHOULD_LOG_ANALYTICS) {
                        identify(user.data.id);
                        setUserId(user.data.id);
                        logEvent('Log in user', { id: user.data.id });
                    }
                }
            });
        }
    };

    render() {
        const { login, masterAdminExists, requestingMasterAdmin } = this.props;

        if (login.success && !login.user.tokens) {
            history.push('/user-auth/token');
        }

        return (
            <div id="wrap">
                <div id="header">
                    <h1>
                        <a aria-hidden={false} href="/">
                            Fyipe
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
                            //eslint-disable-next-line
                            message={`An email is on its way to you with new verification link. Please don't forget to check spam.`}
                        >
                            <div className="below-box">
                                <p>
                                    Click{' '}
                                    <Link to="/accounts/user-verify/resend">
                                        here
                                    </Link>{' '}
                                    to resend verification link to your email.
                                </p>
                            </div>
                        </MessageBox>
                    </div>
                ) : (
                    <LoginForm onSubmit={this.submitHandler} {...this.props} />
                )}

                {/* FOOTER */}
                {!masterAdminExists && !requestingMasterAdmin && (
                    <div id="signUpLink" className="below-box">
                        <p>
                            Don&#39;t have an account?{' '}
                            <Link to="/accounts/register">Sign up</Link>.
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
        login: state.login,
        masterAdminExists: state.login.masterAdmin.exists,
        requestingMasterAdmin: state.login.masterAdmin.requesting,
        loginMethod: state.login.loginMethod,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ loginUser, loginUserSso, loginError }, dispatch);

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
};

LoginPage.displayName = 'LoginPage';

export default connect(mapStateToProps, mapDispatchToProps)(LoginPage);
