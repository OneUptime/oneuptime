import React from 'react';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import RegisterForm from '../components/auth/RegisterForm';
import queryString from 'query-string';
import { PricingPlan } from '../config';
import MessageBox from '../components/MessageBox';
import { savePlanId } from '../actions/register';

class RegisterPage extends React.Component {
    componentWillUnmount() {
        document.body.id = '';
        document.body.className = '';
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

    render() {
        return (
            <div id="wrap" style={{ paddingTop: 0 }}>
                {/* Header */}
                <div id="header">
                    <h1>
                        <a href="/">Fyipe</a>
                    </h1>
                </div>

                {/* REGISTRATION BOX */}
                {this.props.register.success ? (
                    <MessageBox
                        title="Activate your Fyipe account"
                        message="An email is on its way to you with a verification link. Please don't forget to check spam. "
                    />
                ) : (
                    <RegisterForm
                        planId={this.planId}
                        location={this.props.location}
                    />
                )}
                {/* END CONTENT */}
                <div className="below-box">
                    <p>
                        Already have an account?{' '}
                        <Link to="/login">Sign in</Link>.
                    </p>
                </div>
                <div id="footer_spacer" />
                <div id="bottom">
                    <ul>
                        <li>
                            <Link to="/forgot-password">Forgot Password</Link>
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
        register: state.register,
    };
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            savePlanId,
        },
        dispatch
    );
};

RegisterPage.propTypes = {
    location: PropTypes.object.isRequired,
    register: PropTypes.object,
    success: PropTypes.bool,
    savePlanId: PropTypes.func.isRequired,
};

RegisterPage.displayName = 'RegisterPage';

export default connect(mapStateToProps, mapDispatchToProps)(RegisterPage);
