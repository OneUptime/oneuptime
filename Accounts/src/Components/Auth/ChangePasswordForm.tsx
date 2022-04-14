import React, { Component } from 'react';
import PropTypes from 'prop-types';

import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { Validate } from '../../config';
import { ButtonSpinner } from '../basic/Loader.js';
import {
    changePasswordError,
    changePasswordSuccess,
    changePassword,
    resetChangePassword,
} from '../../actions/changePassword';
import { bindActionCreators, Dispatch } from 'redux';
import { RenderField } from '../basic/RenderField';

import { Link } from 'react-router-dom';

const errorStyle: $TSFixMe = {
    color: '#c23d4b',
};

interface ChangePasswordFormProps {
    changePassword: Function;
    handleSubmit: Function;
    changePasswordState: object;
    token?: any;
}

export class ChangePasswordForm extends Component<ChangePasswordFormProps>{
    public static displayName = '';
    public static propTypes = {};
    submitForm = (values: $TSFixMe) => {

        values.token = this.props.token || '';

        this.props.changePassword(values);
    };

    override render() {

        const changePasswordStateError: $TSFixMe = this.props.changePasswordState.error;
        let header;
        if (changePasswordStateError) {
            header = <span style={errorStyle}>{changePasswordStateError}</span>;
        } else {
            header = <span>Reset Password</span>;
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

                            <p className="error-message hidden" />


                            {this.props.changePasswordState.success && (
                                <p className="message">
                                    {' '}
                                    Your password is changed. Please{' '}
                                    <Link to="/accounts/login">
                                        {' '}
                                        click here to login{' '}
                                    </Link>{' '}
                                </p>
                            )}

                            {!this.props.changePasswordState.success && (
                                <p className="message">
                                    {' '}
                                    Please enter a new password to continue
                                </p>
                            )}


                            {!this.props.changePasswordState.success && (
                                <div>
                                    {' '}
                                    <p className="text">
                                        <span id="passwordField">
                                            <label htmlFor="password">
                                                {' '}
                                                New Password{' '}
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
                                        <span id="confirmPasswordField">
                                            <label htmlFor="confirmPassword">
                                                {' '}
                                                Confirm New Password{' '}
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

                                                this.props.changePasswordState
                                                    .requesting
                                            }
                                        >

                                            {!this.props.changePasswordState
                                                .requesting && (
                                                    <span>Change Password</span>
                                                )}

                                            {this.props.changePasswordState
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


ChangePasswordForm.displayName = 'ChangePasswordForm';

function validate(values: $TSFixMe) {
    const errors: $TSFixMe = {};
    if (!Validate.text(values.password)) {

        errors.password = 'Password is required.';
    }
    if (
        Validate.text(values.password) &&
        !Validate.isStrongPassword(values.password)
    ) {

        errors.password = 'Password should be atleast 8 characters long';
    }
    if (!Validate.text(values.confirmPassword)) {

        errors.confirmPassword = 'Confirm Password is required.';
    }
    if (!Validate.compare(values.password, values.confirmPassword)) {

        errors.confirmPassword = 'Password and confirm password should match.';
    }
    return errors;
}

const changePasswordForm: $TSFixMe = reduxForm({
    form: 'changePasswordForm', // a unique identifier for this form
    validate,
})(ChangePasswordForm);

const mapDispatchToProps: Function = (dispatch: Dispatch) => {
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

function mapStateToProps(state: RootState) {
    return {
        changePasswordState: state.changePassword,
    };
}


ChangePasswordForm.propTypes = {
    changePassword: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    changePasswordState: PropTypes.object.isRequired,
    token: PropTypes.any,
};

export default connect(mapStateToProps, mapDispatchToProps)(changePasswordForm);
