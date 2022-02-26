import React from 'react';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Link } from 'react-router-dom';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import RegisterForm from '../components/auth/RegisterForm';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'quer... Remove this comment to see the full error message
import queryString from 'query-string';
import { PricingPlan, IS_SAAS_SERVICE } from '../config';
import MessageBox from '../components/MessageBox';
import { savePlanId, signUpReset } from '../actions/register';

class RegisterPage extends React.Component {
    planId: $TSFixMe;
    componentWillUnmount() {
        document.body.id = '';
        document.body.className = '';
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'signUpReset' does not exist on type 'Rea... Remove this comment to see the full error message
        this.props.signUpReset();
    }

    componentDidMount() {
        document.body.id = 'login';
        document.body.className = 'register-page';
        document.body.style.overflow = 'auto';
        this.planId =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
            queryString.parse(this.props.location.search).planId || null;

        if (!this.planId) {
            this.planId = PricingPlan.getPlans()[0].planId;
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'savePlanId' does not exist on type 'Read... Remove this comment to see the full error message
        this.props.savePlanId(this.planId);
    }

    componentDidUpdate() {
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'masterAdminExists' does not exist on typ... Remove this comment to see the full error message
            this.props.masterAdminExists &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'register' does not exist on type 'Readon... Remove this comment to see the full error message
            !this.props.register.success &&
            !IS_SAAS_SERVICE
        ) {
            window.location.href = '/accounts/login';
        }
    }

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'register' does not exist on type 'Readon... Remove this comment to see the full error message
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
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'register' does not exist on type 'Readon... Remove this comment to see the full error message
                {this.props.register.success &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'masterAdminExists' does not exist on typ... Remove this comment to see the full error message
                !this.props.masterAdminExists &&
                !register.user.cardRegistered &&
                !register.user.token ? (
                    <MessageBox
                        title="Activate your OneUptime account"
                        message="An email is on its way to you with a verification link. Please don't forget to check spam. "
                    />
                ) : (
                    <RegisterForm
                        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ planId: any; location: any; }' is not assi... Remove this comment to see the full error message
                        planId={this.planId}
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
RegisterPage.propTypes = {
    location: PropTypes.object.isRequired,
    register: PropTypes.object,
    success: PropTypes.bool,
    savePlanId: PropTypes.func.isRequired,
    signUpReset: PropTypes.func.isRequired,
    masterAdminExists: PropTypes.bool,
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
RegisterPage.displayName = 'RegisterPage';

export default connect(mapStateToProps, mapDispatchToProps)(RegisterPage);
