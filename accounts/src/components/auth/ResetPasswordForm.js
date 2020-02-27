import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
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
    submitForm = values => {
        this.props.resetPassword(values);
    };

    render() {
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
                            {this.props.resetPasswordState.success && (
                                <p
                                    id="reset-password-success"
                                    className="message"
                                >
                                    {' '}
                                    An email is on its way to you. Follow the
                                    instructions to reset your password. Please
                                    don&apos;t forget to check spam.{' '}
                                </p>
                            )}
                            {!this.props.resetPasswordState.success && (
                                <p className="message">
                                    {' '}
                                    Enter your email address below and we will
                                    send you a link to reset your password.{' '}
                                </p>
                            )}

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
                                                this.props.resetPasswordState
                                                    .requesting
                                            }
                                        >
                                            {!this.props.resetPasswordState
                                                .requesting && (
                                                <span>Reset Password</span>
                                            )}
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
        );
    }
}

ResetPasswordForm.displayName = 'ResetPasswordForm';

function validate(values) {
    const errors = {};
    if (!Validate.text(values.email)) {
        errors.email = 'Email is required.';
    } else if (!Validate.email(values.email)) {
        errors.email = 'Email is invalid.';
    }
    return errors;
}

const resetPasswordForm = reduxForm({
    form: 'resetPasswordForm', // a unique identifier for this form
    validate,
})(ResetPasswordForm);

const mapDispatchToProps = dispatch => {
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

function mapStateToProps(state) {
    return {
        resetPasswordState: state.resetPassword,
    };
}

ResetPasswordForm.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    resetPasswordState: PropTypes.object.isRequired,
    resetPassword: PropTypes.func.isRequired,
};

export default connect(mapStateToProps, mapDispatchToProps)(resetPasswordForm);
