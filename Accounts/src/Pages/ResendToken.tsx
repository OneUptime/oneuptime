import React, { Component } from 'react';
import PropTypes from 'prop-types';

import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { Validate } from '../config';
import { ButtonSpinner } from '../components/basic/Loader';
import { resendToken } from '../actions/resendToken';
import { bindActionCreators, Dispatch } from 'redux';
import { RenderField } from '../components/basic/RenderField';

import { Link } from 'react-router-dom';

import queryString from 'query-string';
import { removeQuery } from '../store';

const errorStyle: $TSFixMe = {
    color: '#c23d4b',
};

interface ResendTokenFormProps {
    handleSubmit: Function;
    resendTokenState: object;
    resendToken: Function;
    location: object;
    masterAdminExists?: boolean;
    requestingMasterAdmin?: boolean;
}

export class ResendTokenForm extends Component<ResendTokenFormProps>{
    public static displayName = '';
    public static propTypes = {};
    state = {
        serverResponse: '',
    };

    submitForm = (values: $TSFixMe) => {

        this.props.resendToken(values);
    };

    override componentDidMount() {
        document.body.id = 'login';
        document.body.style.overflow = 'auto';

        const query = queryString.parse(this.props.location.search).status;
        if (query === 'link-expired') {
            this.setState({
                serverResponse: 'Verification link expired.',
            });
        } else if (query === 'invalid-verification-link') {
            this.setState({
                serverResponse: 'Invalid Verification link.',
            });
        }

        removeQuery();
    }
    override render() {

        const { masterAdminExists, requestingMasterAdmin } = this.props;
        const { serverResponse } = this.state;

        const { success } = this.props.resendTokenState;

        const resendTokenError = this.props.resendTokenState.error;

        let header;
        if (success) {
            header = <span>Verification Email Sent</span>;
        } else if (resendTokenError) {
            header = (
                <span style={errorStyle} id="error-msg">
                    {resendTokenError}
                </span>
            );
        } else if (serverResponse) {
            header = (
                <span style={errorStyle} id="error-msg">
                    {serverResponse}
                </span>
            );
        } else {
            header = <span>Resend verification email.</span>;
        }

        return (
            <div id="wrap" style={{ paddingTop: 0 }}>
                <div id="header">
                    <h1>
                        <a href="/">OneUptime</a>
                    </h1>
                </div>
                <div id="main-body" className="box css">
                    <div className="inner">
                        <form

                            onSubmit={this.props.handleSubmit(this.submitForm)}
                            className="request-reset"
                        >
                            <div className="request-reset-step">
                                <div className="title">
                                    <h2>{header}</h2>
                                </div>


                                {this.props.resendTokenState.success && (
                                    <p
                                        id="resend-verification-success"
                                        className="message"
                                    >
                                        {' '}
                                        An email is on its way to you with new
                                        verification link. Please don&apos;t
                                        forget to check spam.{' '}
                                    </p>
                                )}

                                {!this.props.resendTokenState.success && (
                                    <p className="message">
                                        {' '}
                                        Enter your email address below and we
                                        will resend you a verification link to
                                        activate your oneuptime account.
                                    </p>
                                )}


                                {!this.props.resendTokenState.success && (
                                    <div>
                                        {' '}
                                        <p className="text">
                                            <span>
                                                <label htmlFor="email">
                                                    Your Email
                                                </label>
                                                <Field
                                                    component={RenderField}
                                                    type="email"
                                                    name="email"
                                                    id="email"
                                                    placeholder="Your Email"
                                                />
                                            </span>
                                        </p>
                                        <p className="submit">
                                            <button
                                                type="submit"
                                                className="button blue medium"
                                                disabled={

                                                    this.props.resendTokenState
                                                        .requesting
                                                }
                                            >

                                                {!this.props.resendTokenState
                                                    .requesting && (
                                                        <span>
                                                            Send Verification Link
                                                        </span>
                                                    )}

                                                {this.props.resendTokenState
                                                    .requesting && (
                                                        <ButtonSpinner />
                                                    )}
                                            </button>
                                        </p>{' '}
                                    </div>
                                )}
                            </div>
                        </form>
                    </div>
                </div>
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


ResendTokenForm.displayName = 'ResendTokenForm';

function validate(values: $TSFixMe) {
    const errors: $TSFixMe = {};
    if (!Validate.text(values.email)) {

        errors.email = 'Email is required.';
    } else if (!Validate.email(values.email)) {

        errors.email = 'Email is invalid.';
    }
    return errors;
}

const resendTokenForm = reduxForm({
    form: 'resendTokenForm',
    validate,
})(ResendTokenForm);

const mapDispatchToProps: Function = (dispatch: Dispatch) => {
    return bindActionCreators(
        {
            resendToken,
        },
        dispatch
    );
};

function mapStateToProps(state: RootState) {
    return {
        resendTokenState: state.resendToken,
        masterAdminExists: state.login.masterAdmin.exists,
        requestingMasterAdmin: state.login.masterAdmin.requesting,
    };
}


ResendTokenForm.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    resendTokenState: PropTypes.object.isRequired,
    resendToken: PropTypes.func.isRequired,
    location: PropTypes.object.isRequired,
    masterAdminExists: PropTypes.bool,
    requestingMasterAdmin: PropTypes.bool,
};

export default connect(mapStateToProps, mapDispatchToProps)(resendTokenForm);
