import React, { Component } from 'react';
import PropTypes from 'prop-types';

import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';

import { Fade } from 'react-awesome-reveal';
import { Validate } from '../../config';
import { ButtonSpinner } from '../basic/Loader.js';
import {
    resetPasswordError,
    resetPasswordSuccess,
    resetPassword,
    resetResetPassword,
} from '../../actions/resetPassword';
import { bindActionCreators, Dispatch } from 'redux';
import { RenderField } from '../basic/RenderField';

const errorStyle: $TSFixMe = {
    color: '#c23d4b',
};

interface ResetPasswordFormProps {
    handleSubmit: Function;
    resetPasswordState: object;
    resetPassword: Function;
}

export class ResetPasswordForm extends Component<ResetPasswordFormProps>{
    public static displayName = '';
    public static propTypes = {};
    submitForm = (values: $TSFixMe) => {

        this.props.resetPassword(values);
    };

    override render() {

        const resetPasswordError: $TSFixMe = this.props.resetPasswordState.error;
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
                                        An email is on its way to you. Follow
                                        the instructions to reset your password.
                                        Please don&apos;t forget to check spam.{' '}
                                    </p>
                                )}

                                {!this.props.resetPasswordState.success && (
                                    <p className="message">
                                        {' '}
                                        Enter your email address below and we
                                        will send you a link to reset your
                                        password.{' '}
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
                                                    this.props

                                                        .resetPasswordState
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
            </Fade>
        );
    }
}


ResetPasswordForm.displayName = 'ResetPasswordForm';

function validate(values: $TSFixMe) {
    const errors: $TSFixMe = {};
    if (!Validate.text(values.email)) {

        errors.email = 'Email is required.';
    } else if (!Validate.email(values.email)) {

        errors.email = 'Email is invalid.';
    }
    return errors;
}

const resetPasswordForm: $TSFixMe = reduxForm({
    form: 'resetPasswordForm', // a unique identifier for this form
    validate,
})(ResetPasswordForm);

const mapDispatchToProps: Function = (dispatch: Dispatch) => {
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

function mapStateToProps(state: RootState) {
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
