import React, { Component } from 'react';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { Validate } from '../config';
import { ButtonSpinner } from '../components/basic/Loader';
import { resendToken } from '../actions/resendToken';
import { bindActionCreators } from 'redux';
import { RenderField } from '../components/basic/RenderField';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Link } from 'react-router-dom';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'quer... Remove this comment to see the full error message
import queryString from 'query-string';
import { removeQuery } from '../store';

const errorStyle = {
    color: '#c23d4b',
};
export class ResendTokenForm extends Component {
    state = {
        serverResponse: '',
    };

    submitForm = (values: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'resendToken' does not exist on type 'Rea... Remove this comment to see the full error message
        this.props.resendToken(values);
    };

    componentDidMount() {
        document.body.id = 'login';
        document.body.style.overflow = 'auto';
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
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
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 1 arguments, but got 0.
        removeQuery();
    }
    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'masterAdminExists' does not exist on typ... Remove this comment to see the full error message
        const { masterAdminExists, requestingMasterAdmin } = this.props;
        const { serverResponse } = this.state;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'resendTokenState' does not exist on type... Remove this comment to see the full error message
        const { success } = this.props.resendTokenState;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'resendTokenState' does not exist on type... Remove this comment to see the full error message
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
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
                            onSubmit={this.props.handleSubmit(this.submitForm)}
                            className="request-reset"
                        >
                            <div className="request-reset-step">
                                <div className="title">
                                    <h2>{header}</h2>
                                </div>

                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'resendTokenState' does not exist on type... Remove this comment to see the full error message
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
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'resendTokenState' does not exist on type... Remove this comment to see the full error message
                                {!this.props.resendTokenState.success && (
                                    <p className="message">
                                        {' '}
                                        Enter your email address below and we
                                        will resend you a verification link to
                                        activate your oneuptime account.
                                    </p>
                                )}

                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'resendTokenState' does not exist on type... Remove this comment to see the full error message
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
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'resendTokenState' does not exist on type... Remove this comment to see the full error message
                                                    this.props.resendTokenState
                                                        .requesting
                                                }
                                            >
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'resendTokenState' does not exist on type... Remove this comment to see the full error message
                                                {!this.props.resendTokenState
                                                    .requesting && (
                                                    <span>
                                                        Send Verification Link
                                                    </span>
                                                )}
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'resendTokenState' does not exist on type... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ResendTokenForm.displayName = 'ResendTokenForm';

function validate(values: $TSFixMe) {
    const errors = {};
    if (!Validate.text(values.email)) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type '{}'.
        errors.email = 'Email is required.';
    } else if (!Validate.email(values.email)) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type '{}'.
        errors.email = 'Email is invalid.';
    }
    return errors;
}

const resendTokenForm = reduxForm({
    form: 'resendTokenForm',
    validate,
})(ResendTokenForm);

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            resendToken,
        },
        dispatch
    );
};

function mapStateToProps(state: $TSFixMe) {
    return {
        resendTokenState: state.resendToken,
        masterAdminExists: state.login.masterAdmin.exists,
        requestingMasterAdmin: state.login.masterAdmin.requesting,
    };
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ResendTokenForm.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    resendTokenState: PropTypes.object.isRequired,
    resendToken: PropTypes.func.isRequired,
    location: PropTypes.object.isRequired,
    masterAdminExists: PropTypes.bool,
    requestingMasterAdmin: PropTypes.bool,
};

export default connect(mapStateToProps, mapDispatchToProps)(resendTokenForm);
