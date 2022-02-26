import React, { Component } from 'react';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { Validate } from '../../config';
import { FlatLoader } from '../basic/Loader.js';
import {
    changePasswordError,
    changePasswordSuccess,
    changePassword,
    resetChangePassword,
} from '../../actions/changePassword';
import { bindActionCreators } from 'redux';
import { RenderField } from '../basic/RenderField';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Link } from 'react-router-dom';

export class ChangePasswordForm extends Component {
    submitForm = (values: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'token' does not exist on type 'Readonly<... Remove this comment to see the full error message
        values.token = this.props.token || '';
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'changePassword' does not exist on type '... Remove this comment to see the full error message
        this.props.changePassword(values);
    };

    render() {
        return (
            <div id="main-body" className="box css">
                <div className="inner">
                    <form
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
                        onSubmit={this.props.handleSubmit(this.submitForm)}
                        className="request-reset"
                    >
                        <div className="request-reset-step step">
                            <div className="title">
                                <h2>
                                    <span>
                                        {' '}
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'changePasswordState' does not exist on t... Remove this comment to see the full error message
                                        {this.props.changePasswordState
                                            .error ? (
                                            <span className="error">
                                                {
                                                    this.props
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'changePasswordState' does not exist on t... Remove this comment to see the full error message
                                                        .changePasswordState
                                                        .error
                                                }
                                            </span>
                                        ) : (
                                            'Reset Password'
                                        )}{' '}
                                    </span>
                                </h2>
                            </div>

                            <p className="error-message hidden" />

                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'changePasswordState' does not exist on t... Remove this comment to see the full error message
                            {this.props.changePasswordState.success && (
                                <p className="message">
                                    {' '}
                                    Your password is changed. Please{' '}
                                    <Link to="/login">
                                        {' '}
                                        click here to login{' '}
                                    </Link>{' '}
                                </p>
                            )}
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'changePasswordState' does not exist on t... Remove this comment to see the full error message
                            {!this.props.changePasswordState.success && (
                                <p className="message">
                                    {' '}
                                    Enter your email address below and we will
                                    send you a link to reset your password.{' '}
                                </p>
                            )}

                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'changePasswordState' does not exist on t... Remove this comment to see the full error message
                            {!this.props.changePasswordState.success && (
                                <div>
                                    {' '}
                                    <p className="text">
                                        <span>
                                            <label htmlFor="password">
                                                {' '}
                                                Password{' '}
                                            </label>
                                            <Field
                                                component={RenderField}
                                                type="password"
                                                name="password"
                                                id="password"
                                                placeholder="Password"
                                            />
                                        </span>
                                    </p>
                                    <p className="text">
                                        <span>
                                            <label htmlFor="confirmPassword">
                                                {' '}
                                                Confirm Password{' '}
                                            </label>
                                            <Field
                                                component={RenderField}
                                                type="password"
                                                name="confirmPassword"
                                                id="confirmPassword"
                                                placeholder="Confirm Password"
                                            />
                                        </span>
                                    </p>
                                    <p className="submit">
                                        <button
                                            type="submit"
                                            className="button blue medium"
                                            disabled={
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'changePasswordState' does not exist on t... Remove this comment to see the full error message
                                                this.props.changePasswordState
                                                    .requesting
                                            }
                                        >
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'changePasswordState' does not exist on t... Remove this comment to see the full error message
                                            {!this.props.changePasswordState
                                                .requesting && (
                                                <span>Change Password</span>
                                            )}
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'changePasswordState' does not exist on t... Remove this comment to see the full error message
                                            {this.props.changePasswordState
                                                .requesting && <FlatLoader />}
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ChangePasswordForm.displayName = 'ChangePasswordForm';

function validate(values: $TSFixMe) {
    const errors = {};
    if (!Validate.text(values.password)) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'password' does not exist on type '{}'.
        errors.password = 'Password is required.';
    }
    if (!Validate.text(values.confirmPassword)) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'confirmPassword' does not exist on type ... Remove this comment to see the full error message
        errors.confirmPassword = 'Confirm Password is invalid.';
    }
    return errors;
}

const changePasswordForm = reduxForm({
    form: 'changePasswordForm', // a unique identifier for this form
    validate,
})(ChangePasswordForm);

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            changePasswordError,
            changePasswordSuccess,
            changePassword,
            resetChangePassword,
        },
        dispatch
    );
};

function mapStateToProps(state: $TSFixMe) {
    return {
        changePasswordState: state.changePassword,
    };
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ChangePasswordForm.propTypes = {
    changePassword: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    changePasswordState: PropTypes.object.isRequired,
    token: PropTypes.any,
};

export default connect(mapStateToProps, mapDispatchToProps)(changePasswordForm);
