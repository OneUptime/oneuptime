import React, { Component } from 'react';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { Validate } from '../../config';
import { RenderField } from '../basic/RenderField';
import { ButtonSpinner } from '../basic/Loader.js';
import { removeQuery } from '../../store';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'quer... Remove this comment to see the full error message
import queryString from 'query-string';

import { getEmailFromToken } from '../../actions/register';

class UserForm extends Component {
    state = {
        serverResponse: '',
    };

    componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
        const query = queryString.parse(this.props.location.search);

        if (query && query.status === 'user-not-found') {
            this.setState({
                serverResponse: 'No user found for this token',
            });
        }

        // @ts-expect-error ts-migrate(2554) FIXME: Expected 1 arguments, but got 0.
        removeQuery();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'getEmailFromToken' does not exist on typ... Remove this comment to see the full error message
        this.props.getEmailFromToken(query.token);
    }

    render() {
        const { serverResponse } = this.state;
        return (
            <div id="main-body" className="box css" style={{ width: 500 }}>
                <div className="inner">
                    <div className="title extra">
                        <h2>
                            {serverResponse ? (
                                <span>{serverResponse}</span>
                            ) : (
                                <span>
                                    {' '}
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'register' does not exist on type 'Readon... Remove this comment to see the full error message
                                    {this.props.register.error ? (
                                        <span id="error-msg" className="error">
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'register' does not exist on type 'Readon... Remove this comment to see the full error message
                                            {this.props.register.error}
                                        </span>
                                    ) : (
                                        'Create your OneUptime account'
                                    )}{' '}
                                </span>
                            )}
                        </h2>
                    </div>
                    <form
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
                        onSubmit={this.props.handleSubmit(
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'submitForm' does not exist on type 'Read... Remove this comment to see the full error message
                            this.props.submitForm
                        )}
                    >
                        <div
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                            }}
                        >
                            <p
                                className="text"
                                style={{
                                    display: 'block',
                                    maxWidth: '50%',
                                    marginTop: 0,
                                }}
                            >
                                <span>
                                    <label htmlFor="email">Email</label>
                                    <Field
                                        type="email"
                                        id="email"
                                        name="email"
                                        component={RenderField}
                                        placeholder="jeff@example.com"
                                        required="required"
                                        value={
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'register' does not exist on type 'Readon... Remove this comment to see the full error message
                                            this.props.register.user.email || ''
                                        }
                                        disabled={
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'initialValues' does not exist on type 'R... Remove this comment to see the full error message
                                            this.props.initialValues &&
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'initialValues' does not exist on type 'R... Remove this comment to see the full error message
                                            this.props.initialValues.email
                                        }
                                    />
                                </span>
                            </p>
                            <p
                                className="text"
                                style={{
                                    display: 'block',
                                    maxWidth: '50%',
                                    marginTop: 0,
                                }}
                            >
                                <span>
                                    <label htmlFor="name">Full Name</label>
                                    <Field
                                        type="text"
                                        component={RenderField}
                                        name="name"
                                        id="name"
                                        placeholder="Jeff Smith"
                                        required="required"
                                        value={
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'register' does not exist on type 'Readon... Remove this comment to see the full error message
                                            this.props.register.user.name || ''
                                        }
                                    />
                                </span>
                            </p>
                        </div>
                        <div
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                            }}
                        >
                            <p
                                className="text"
                                style={{
                                    display: 'block',
                                    maxWidth: '50%',
                                    marginTop: 0,
                                }}
                            >
                                <span>
                                    <label htmlFor="companyName">
                                        Company Name
                                    </label>
                                    <Field
                                        type="text"
                                        name="companyName"
                                        id="companyName"
                                        component={RenderField}
                                        placeholder="Company Name"
                                    />
                                </span>
                            </p>
                            <p
                                className="text"
                                style={{
                                    display: 'block',
                                    maxWidth: '50%',
                                    marginTop: 0,
                                }}
                            >
                                <span>
                                    <label htmlFor="companyPhoneNumber">
                                        Phone Number
                                    </label>
                                    <Field
                                        type="text"
                                        component={RenderField}
                                        name="companyPhoneNumber"
                                        id="companyPhoneNumber"
                                        placeholder="+1-123-456-7890"
                                    />
                                </span>
                            </p>
                        </div>
                        <div
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                            }}
                        >
                            <p
                                className="text"
                                style={{
                                    display: 'block',
                                    maxWidth: '50%',
                                    marginTop: 0,
                                }}
                            >
                                <span>
                                    <label htmlFor="password">Password</label>
                                    <Field
                                        type="password"
                                        component={RenderField}
                                        name="password"
                                        id="password"
                                        placeholder="Your Password"
                                        className="password-strength-input"
                                        required="required"
                                        value={
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'register' does not exist on type 'Readon... Remove this comment to see the full error message
                                            this.props.register.user.password ||
                                            ''
                                        }
                                    />
                                </span>
                            </p>
                            <p
                                className="text"
                                style={{
                                    display: 'block',
                                    maxWidth: '50%',
                                    marginTop: 0,
                                }}
                            >
                                <span>
                                    <label htmlFor="confirmPassword">
                                        Confirm Password
                                    </label>
                                    <Field
                                        type="password"
                                        component={RenderField}
                                        name="confirmPassword"
                                        id="confirmPassword"
                                        placeholder="Confirm Password"
                                        required="required"
                                        value={
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'register' does not exist on type 'Readon... Remove this comment to see the full error message
                                            this.props.register.user
                                                .confirmPassword || ''
                                        }
                                    />
                                </span>
                            </p>
                        </div>

                        <p
                            className="submit"
                            style={{ width: '100%', maxWidth: '100%' }}
                        >
                            <button
                                style={{ width: '100%' }}
                                type="submit"
                                className="button blue medium"
                                id="create-account-button"
                                disabled={
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'register' does not exist on type 'Readon... Remove this comment to see the full error message
                                    this.props.register &&
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'register' does not exist on type 'Readon... Remove this comment to see the full error message
                                    ((this.props.register.isUserInvited &&
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'register' does not exist on type 'Readon... Remove this comment to see the full error message
                                        this.props.register.isUserInvited
                                            .requesting) ||
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'register' does not exist on type 'Readon... Remove this comment to see the full error message
                                        this.props.register.requesting)
                                }
                            >
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'register' does not exist on type 'Readon... Remove this comment to see the full error message
                                {this.props.register &&
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'register' does not exist on type 'Readon... Remove this comment to see the full error message
                                ((this.props.register.isUserInvited &&
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'register' does not exist on type 'Readon... Remove this comment to see the full error message
                                    this.props.register.isUserInvited
                                        .requesting) ||
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'register' does not exist on type 'Readon... Remove this comment to see the full error message
                                    this.props.register.requesting) ? (
                                    <ButtonSpinner />
                                ) : (
                                    <span>Sign Up</span>
                                )}
                            </button>
                        </p>
                    </form>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
UserForm.displayName = 'UserForm';

const validate = function(values: $TSFixMe) {
    const error = {};

    // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type '{}'.
    if (!Validate.text(values.name)) error.name = 'Name is required.';

    if (Validate.text(values.name) && !Validate.isValidName(values.name))
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type '{}'.
        error.name = 'Name is not valid.';

    // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type '{}'.
    if (!Validate.text(values.email)) error.email = 'Email is required.';

    if (Validate.text(values.email) && !Validate.email(values.email))
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type '{}'.
        error.email = 'Email is not valid.';

    if (
        !Validate.isValidBusinessEmail(values.email) &&
        Validate.email(values.email)
    )
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type '{}'.
        error.email = 'Please enter a business email address.';

    if (!Validate.text(values.companyName))
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'companyName' does not exist on type '{}'... Remove this comment to see the full error message
        error.companyName = 'Company name is required.';

    if (!Validate.text(values.companyPhoneNumber))
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'companyPhoneNumber' does not exist on ty... Remove this comment to see the full error message
        error.companyPhoneNumber = 'Phone number is required.';

    if (
        Validate.text(values.companyPhoneNumber) &&
        !Validate.isValidNumber(values.companyPhoneNumber)
    )
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'companyPhoneNumber' does not exist on ty... Remove this comment to see the full error message
        error.companyPhoneNumber = 'Phone number is invalid.';

    if (!Validate.text(values.password))
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'password' does not exist on type '{}'.
        error.password = 'Password is required.';
    if (
        Validate.text(values.password) &&
        !Validate.isStrongPassword(values.password)
    ) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'password' does not exist on type '{}'.
        error.password = 'Password should be atleast 8 characters long';
    }

    if (!Validate.text(values.confirmPassword))
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'confirmPassword' does not exist on type ... Remove this comment to see the full error message
        error.confirmPassword = 'Confirm Password is required.';

    if (!Validate.compare(values.password, values.confirmPassword)) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'confirmPassword' does not exist on type ... Remove this comment to see the full error message
        error.confirmPassword = 'Password and confirm password should match.';
    }

    return error;
};

const userForm = reduxForm({
    form: 'UserSignupForm', // <------ same form name
    destroyOnUnmount: true,
    validate,
})(UserForm);

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators({ getEmailFromToken }, dispatch);
};

function mapStateToProps(state: $TSFixMe) {
    return {
        register: state.register,
        initialValues: state.register.email,
    };
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
UserForm.propTypes = {
    submitForm: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    register: PropTypes.object.isRequired,
    location: PropTypes.object.isRequired,
    getEmailFromToken: PropTypes.func,
    initialValues: PropTypes.object,
};

export default connect(mapStateToProps, mapDispatchToProps)(userForm);
