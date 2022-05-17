import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { Validate } from '../../config';
import { RenderField } from '../basic/RenderField';
import { ButtonSpinner } from '../basic/Loader.js';
import { removeQuery } from '../../store';
import queryString from 'query-string';
import { getEmailFromToken } from '../../actions/register';
class UserForm extends Component {
    constructor() {
        super(...arguments);
        this.state = {
            serverResponse: '',
        };
    }
    componentDidMount() {
        const query = queryString.parse(this.props.location.search);
        if (query && query.status === 'user-not-found') {
            this.setState({
                serverResponse: 'No user found for this token',
            });
        }
        removeQuery();
        this.props.getEmailFromToken(query.token);
    }
    render() {
        const { serverResponse } = this.state;
        return (React.createElement("div", { id: "main-body", className: "box css", style: { width: 500 } },
            React.createElement("div", { className: "inner" },
                React.createElement("div", { className: "title extra" },
                    React.createElement("h2", null, serverResponse ? (React.createElement("span", null, serverResponse)) : (React.createElement("span", null,
                        ' ',
                        this.props.register.error ? (React.createElement("span", { id: "error-msg", className: "error" }, this.props.register.error)) : ('Create your OneUptime account'),
                        ' ')))),
                React.createElement("form", { onSubmit: this.props.handleSubmit(this.props.submitForm) },
                    React.createElement("div", { style: {
                            display: 'flex',
                            justifyContent: 'space-between',
                        } },
                        React.createElement("p", { className: "text", style: {
                                display: 'block',
                                maxWidth: '50%',
                                marginTop: 0,
                            } },
                            React.createElement("span", null,
                                React.createElement("label", { htmlFor: "email" }, "Email"),
                                React.createElement(Field, { type: "email", id: "email", name: "email", component: RenderField, placeholder: "jeff@example.com", required: "required", value: this.props.register.user.email || '', disabled: this.props.initialValues &&
                                        this.props.initialValues.email }))),
                        React.createElement("p", { className: "text", style: {
                                display: 'block',
                                maxWidth: '50%',
                                marginTop: 0,
                            } },
                            React.createElement("span", null,
                                React.createElement("label", { htmlFor: "name" }, "Full Name"),
                                React.createElement(Field, { type: "text", component: RenderField, name: "name", id: "name", placeholder: "Jeff Smith", required: "required", value: this.props.register.user.name || '' })))),
                    React.createElement("div", { style: {
                            display: 'flex',
                            justifyContent: 'space-between',
                        } },
                        React.createElement("p", { className: "text", style: {
                                display: 'block',
                                maxWidth: '50%',
                                marginTop: 0,
                            } },
                            React.createElement("span", null,
                                React.createElement("label", { htmlFor: "companyName" }, "Company Name"),
                                React.createElement(Field, { type: "text", name: "companyName", id: "companyName", component: RenderField, placeholder: "Company Name" }))),
                        React.createElement("p", { className: "text", style: {
                                display: 'block',
                                maxWidth: '50%',
                                marginTop: 0,
                            } },
                            React.createElement("span", null,
                                React.createElement("label", { htmlFor: "companyPhoneNumber" }, "Phone Number"),
                                React.createElement(Field, { type: "text", component: RenderField, name: "companyPhoneNumber", id: "companyPhoneNumber", placeholder: "+1-123-456-7890" })))),
                    React.createElement("div", { style: {
                            display: 'flex',
                            justifyContent: 'space-between',
                        } },
                        React.createElement("p", { className: "text", style: {
                                display: 'block',
                                maxWidth: '50%',
                                marginTop: 0,
                            } },
                            React.createElement("span", null,
                                React.createElement("label", { htmlFor: "password" }, "Password"),
                                React.createElement(Field, { type: "password", component: RenderField, name: "password", id: "password", placeholder: "Your Password", className: "password-strength-input", required: "required", value: this.props.register.user.password ||
                                        '' }))),
                        React.createElement("p", { className: "text", style: {
                                display: 'block',
                                maxWidth: '50%',
                                marginTop: 0,
                            } },
                            React.createElement("span", null,
                                React.createElement("label", { htmlFor: "confirmPassword" }, "Confirm Password"),
                                React.createElement(Field, { type: "password", component: RenderField, name: "confirmPassword", id: "confirmPassword", placeholder: "Confirm Password", required: "required", value: this.props.register.user
                                        .confirmPassword || '' })))),
                    React.createElement("p", { className: "submit", style: { width: '100%', maxWidth: '100%' } },
                        React.createElement("button", { style: { width: '100%' }, type: "submit", className: "button blue medium", id: "create-account-button", disabled: this.props.register &&
                                ((this.props.register.isUserInvited &&
                                    this.props.register.isUserInvited
                                        .requesting) ||
                                    this.props.register.requesting) }, this.props.register &&
                            ((this.props.register.isUserInvited &&
                                this.props.register.isUserInvited
                                    .requesting) ||
                                this.props.register.requesting) ? (React.createElement(ButtonSpinner, null)) : (React.createElement("span", null, "Sign Up"))))))));
    }
}
UserForm.displayName = 'UserForm';
const validate = function (values) {
    const error = {};
    if (!Validate.text(values.name))
        error.name = 'Name is required.';
    if (Validate.text(values.name) && !Validate.isValidName(values.name))
        error.name = 'Name is not valid.';
    if (!Validate.text(values.email))
        error.email = 'Email is required.';
    if (Validate.text(values.email) && !Validate.email(values.email))
        error.email = 'Email is not valid.';
    if (!Validate.isValidBusinessEmail(values.email) &&
        Validate.email(values.email))
        error.email = 'Please enter a business email address.';
    if (!Validate.text(values.companyName))
        error.companyName = 'Company name is required.';
    if (!Validate.text(values.companyPhoneNumber))
        error.companyPhoneNumber = 'Phone number is required.';
    if (Validate.text(values.companyPhoneNumber) &&
        !Validate.isValidNumber(values.companyPhoneNumber))
        error.companyPhoneNumber = 'Phone number is invalid.';
    if (!Validate.text(values.password))
        error.password = 'Password is required.';
    if (Validate.text(values.password) &&
        !Validate.isStrongPassword(values.password)) {
        error.password = 'Password should be atleast 8 characters long';
    }
    if (!Validate.text(values.confirmPassword))
        error.confirmPassword = 'Confirm Password is required.';
    if (!Validate.compare(values.password, values.confirmPassword)) {
        error.confirmPassword = 'Password and confirm password should match.';
    }
    return error;
};
const userForm = reduxForm({
    form: 'UserSignupForm',
    destroyOnUnmount: true,
    validate,
})(UserForm);
const mapDispatchToProps = (dispatch) => {
    return bindActionCreators({ getEmailFromToken }, dispatch);
};
function mapStateToProps(state) {
    return {
        register: state.register,
        initialValues: state.register.email,
    };
}
UserForm.propTypes = {
    submitForm: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    register: PropTypes.object.isRequired,
    location: PropTypes.object.isRequired,
    getEmailFromToken: PropTypes.func,
    initialValues: PropTypes.object,
};
export default connect(mapStateToProps, mapDispatchToProps)(userForm);
