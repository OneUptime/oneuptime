import React, { Component } from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { Field, reduxForm } from 'redux-form';
import { RenderField } from '../basic/RenderField';
import { connect } from 'react-redux';
import { Validate } from '../../config';
import { ButtonSpinner } from '../basic/Loader.js';
import {
    loginError,
    loginSuccess,
    loginUser,
    resetLogin,
    changeLogin,
} from '../../actions/login';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'quer... Remove this comment to see the full error message
import queryString from 'query-string';
import { removeQuery } from '../../store';

const errorStyle = {
    color: '#c23d4b',
};
export class LoginForm extends Component {
    state = {
        serverResponse: '',
    };

    componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
        const query = queryString.parse(this.props.location.search).status;
        let serverResponse = '';
        if (query === 'already-verified') {
            serverResponse = 'Email already verified. You can now login.';
        } else if (query === 'verified') {
            serverResponse =
                'Thank you for verifying your email. You can now login.';
        }
        this.setState({
            serverResponse,
        });
        removeQuery('status');
    }
    handleClick(data: $TSFixMe) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'changeLogin' does not exist on type 'Rea... Remove this comment to see the full error message
        this.props.changeLogin(data);
    }
    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
        const { handleSubmit } = this.props;
        const { serverResponse } = this.state;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'login' does not exist on type 'Readonly<... Remove this comment to see the full error message
        const loginError = this.props.login.error;
        let header;
        if (loginError) {
            header = (
                <span id="loginError" style={errorStyle}>
                    {loginError}
                </span>
            );
        } else if (serverResponse) {
            header = <span>{serverResponse}</span>;
        } else {
            header = <span>Welcome back!</span>;
        }

        return (
            <div id="main-body" className="box css">
                <div className="inner login">
                    <div>
                        <form
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'onSubmit' does not exist on type 'Readon... Remove this comment to see the full error message
                            onSubmit={handleSubmit(this.props.onSubmit)}
                            id="login-form"
                        >
                            <div className="step email-password-step">
                                <h2>{header}</h2>
                                <p className="text">
                                    <span>
                                        <label htmlFor="email">
                                            <span>Email</span>
                                        </label>
                                        <Field
                                            className="error"
                                            component={RenderField}
                                            type="email"
                                            name="email"
                                            id="email"
                                            placeholder="jeff@example.com"
                                            required="required"
                                        />
                                    </span>
                                </p>
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'loginMethod' does not exist on type 'Rea... Remove this comment to see the full error message
                                {this.props.loginMethod === 'standard' ? (
                                    <p className="text">
                                        <span>
                                            <label htmlFor="password">
                                                <span>Password</span>
                                            </label>
                                            <Field
                                                component={RenderField}
                                                type="password"
                                                name="password"
                                                id="password"
                                                placeholder="Your Password"
                                                required="required"
                                            />
                                        </span>
                                    </p>
                                ) : (
                                    ''
                                )}
                                <p className="submit">
                                    <button
                                        type="submit"
                                        className="button blue medium"
                                        id="login-button"
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'login' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                        disabled={this.props.login.requesting}
                                    >
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'login' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                        {!this.props.login.requesting && (
                                            <span>Sign in</span>
                                        )}
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'login' does not exist on type 'Readonly<... Remove this comment to see the full error message
                                        {this.props.login.requesting && (
                                            <ButtonSpinner />
                                        )}
                                    </button>
                                </p>

                                <p className="text">
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'loginMethod' does not exist on type 'Rea... Remove this comment to see the full error message
                                    {this.props.loginMethod === 'standard' ? (
                                        <span
                                            id="sso-login"
                                            className="loginoption"
                                            onClick={() => {
                                                this.handleClick('sso');
                                            }}
                                        >
                                            Log in with SSO
                                        </span>
                                    ) : (
                                        <span
                                            id="standard-login"
                                            className="loginoption"
                                            onClick={() => {
                                                this.handleClick('standard');
                                            }}
                                        >
                                            Log in with password
                                        </span>
                                    )}
                                </p>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
LoginForm.displayName = 'LoginForm';

const validate = function(values: $TSFixMe, props: $TSFixMe) {
    const errors = {};
    if (!Validate.text(values.email)) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type '{}'.
        errors.email = 'Email is required.';
    } else {
        if (!Validate.email(values.email)) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type '{}'.
            errors.email = 'Email is invalid.';
        }
    }

    if (!Validate.text(values.password) && props.loginMethod === 'standard') {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'password' does not exist on type '{}'.
        errors.password = 'Password is required.';
    }

    return errors;
};

const loginForm = reduxForm({
    form: 'LoginForm', // a unique identifier for this form
    validate,
    destroyOnUnmount: true,
})(LoginForm);

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            loginError,
            loginSuccess,
            loginUser,
            resetLogin,
            changeLogin,
        },
        dispatch
    );
};

function mapStateToProps(state: $TSFixMe) {
    return {
        login: state.login,
        loginMethod: state.login.loginMethod,
    };
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
LoginForm.propTypes = {
    onSubmit: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    login: PropTypes.object.isRequired,
    location: PropTypes.object.isRequired,
    loginMethod: PropTypes.string,
    changeLogin: PropTypes.func.isRequired,
};

export default connect(mapStateToProps, mapDispatchToProps)(loginForm);
