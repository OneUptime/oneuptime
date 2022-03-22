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
    planId: $TSFixMe;
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
        if (

            this.props.masterAdminExists &&

            !this.props.register.success &&
            !IS_SAAS_SERVICE
        ) {
            window.location.href = '/accounts/login';
        }
    }

    render() {

        const { register } = this.props;

        return (
            <div id="wrap" style={{ paddingTop: 0 }}>
                {/* Header */}
                <div id="header">
                    <h1>
                        <a href="/">OneUptime</a>
                    </h1>
                </div>

                {/* REGISTRATION BOX */}

                {this.props.register.success &&

                    !this.props.masterAdminExists &&
                    !register.user.cardRegistered &&
                    !register.user.token ? (
                    <MessageBox
                        title="Activate your OneUptime account"
                        message="An email is on its way to you with a verification link. Please don't forget to check spam. "
                    />
                ) : (
                    <RegisterForm

                        planId={this.planId}

                        location={this.props.location}
                    />
                )}
                {/* END CONTENT */}
                <div id="loginLink" className="below-box">
                    <p>
                        Already have an account?{' '}
                        <Link to="/accounts/login">Sign in</Link>.
                    </p>
                </div>
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
        register: state.register,
        masterAdminExists: state.login.masterAdmin.exists,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            savePlanId,
            signUpReset,
        },
        dispatch
    );
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
