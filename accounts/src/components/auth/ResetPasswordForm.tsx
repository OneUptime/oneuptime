import React, { Component } from 'react';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-reveal/Fade';
import { Validate } from '../../config';
import { ButtonSpinner } from '../basic/Loader.js';
import {
    resetPasswordError,
    resetPasswordSuccess,
    resetPassword,
    resetResetPassword,
} from '../../actions/resetPassword';
import { bindActionCreators } from 'redux';
import { RenderField } from '../basic/RenderField';

const errorStyle = {
    color: '#c23d4b',
};

export class ResetPasswordForm extends Component {
    submitForm = (values: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetPassword' does not exist on type 'R... Remove this comment to see the full error message
        this.props.resetPassword(values);
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetPasswordState' does not exist on ty... Remove this comment to see the full error message
        const resetPasswordError = this.props.resetPasswordState.error;
        let header;
        if (resetPasswordError) {
            header = (
                <span style={errorStyle} id="error-msg">
                    {resetPasswordError}
                </span>
            );
        } else {
            header = <span>Reset Password.</span>;
        }

        return (
            <Fade>
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
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetPasswordState' does not exist on ty... Remove this comment to see the full error message
                                {this.props.resetPasswordState.success && (
                                    <p
                                        id="reset-password-success"
                                        className="message"
                                    >
                                        {' '}
                                        An email is on its way to you. Follow
                                        the instructions to reset your password.
                                        Please don&apos;t forget to check spam.{' '}
                                    </p>
                                )}
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetPasswordState' does not exist on ty... Remove this comment to see the full error message
                                {!this.props.resetPasswordState.success && (
                                    <p className="message">
                                        {' '}
                                        Enter your email address below and we
                                        will send you a link to reset your
                                        password.{' '}
                                    </p>
                                )}

                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetPasswordState' does not exist on ty... Remove this comment to see the full error message
                                {!this.props.resetPasswordState.success && (
                                    <div>
                                        {' '}
                                        <p className="text">
                                            <span>
                                                <label htmlFor="email">
                                                    {' '}
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
                                                    this.props
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetPasswordState' does not exist on ty... Remove this comment to see the full error message
                                                        .resetPasswordState
                                                        .requesting
                                                }
                                            >
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetPasswordState' does not exist on ty... Remove this comment to see the full error message
                                                {!this.props.resetPasswordState
                                                    .requesting && (
                                                    <span>Reset Password</span>
                                                )}
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetPasswordState' does not exist on ty... Remove this comment to see the full error message
                                                {this.props.resetPasswordState
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
            </Fade>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ResetPasswordForm.displayName = 'ResetPasswordForm';

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

const resetPasswordForm = reduxForm({
    form: 'resetPasswordForm', // a unique identifier for this form
    validate,
})(ResetPasswordForm);

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            resetPasswordError,
            resetPasswordSuccess,
            resetPassword,
            resetResetPassword,
        },
        dispatch
    );
};

function mapStateToProps(state: $TSFixMe) {
    return {
        resetPasswordState: state.resetPassword,
    };
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ResetPasswordForm.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    resetPasswordState: PropTypes.object.isRequired,
    resetPassword: PropTypes.func.isRequired,
};

export default connect(mapStateToProps, mapDispatchToProps)(resetPasswordForm);
