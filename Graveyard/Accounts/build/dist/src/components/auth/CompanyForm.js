import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { Field, reduxForm } from 'redux-form';
import CountrySelector from '../basic/CountrySelector';
import CompanySizeSelector from '../basic/CompanySizeSelector';
import { connect } from 'react-redux';
import { RenderField } from '../basic/RenderField';
import { Validate } from '../../config';
import { FlatLoader } from '../basic/Loader.js.js';
const errorStyle = {
    color: 'red',
};
class CompanyForm extends Component {
    render() {
        return (React.createElement("div", { id: "main-body", className: "box css" },
            React.createElement("div", { className: "inner" },
                React.createElement("div", { className: "title extra" },
                    React.createElement("h2", null,
                        React.createElement("span", null,
                            ' ',
                            this.props.register.error ? (React.createElement("span", { style: errorStyle },
                                ' ',
                                this.props.register.error)) : ('One Last Step...'),
                            ' '))),
                React.createElement("form", { onSubmit: this.props.handleSubmit(this.props.submitForm) },
                    React.createElement("p", { className: "text" },
                        React.createElement("span", null,
                            React.createElement("label", { htmlFor: "companyName" }, "Company Name"),
                            React.createElement(Field, { type: "text", name: "companyName", id: "companyName", component: RenderField, placeholder: "Company Name" }))),
                    React.createElement("p", { className: "text" },
                        React.createElement("span", null,
                            React.createElement("label", { htmlFor: "companyRole" }, "Job Title"),
                            React.createElement(Field, { type: "text", name: "companyRole", id: "companyRole", component: RenderField, placeholder: "Your Job Title" }))),
                    React.createElement("p", { className: "text" },
                        React.createElement("span", null,
                            React.createElement("label", { htmlFor: "companyCountry" }, "Country"),
                            React.createElement(Field, { type: "text", component: CountrySelector, name: "companyCountry", id: "companyCountry", placeholder: "Company Country" }))),
                    React.createElement("p", { className: "text" },
                        React.createElement("span", null,
                            React.createElement("label", { htmlFor: "companySize" }, "Company Size"),
                            React.createElement(Field, { type: "text", component: CompanySizeSelector, name: "companySize", id: "companySize", placeholder: "company Size" }))),
                    React.createElement("p", { className: "text" },
                        React.createElement("span", null,
                            React.createElement("label", { htmlFor: "companyPhoneNumber" }, "Phone Number"),
                            React.createElement(Field, { type: "text", component: RenderField, name: "companyPhoneNumber", id: "companyPhoneNumber", placeholder: "+1-123-456-7890" }))),
                    React.createElement("p", { className: "text" },
                        React.createElement("span", null,
                            React.createElement("label", { htmlFor: "reference" }, "Where did you hear about us?"),
                            React.createElement(Field, { type: "text", component: RenderField, name: "reference", id: "reference", placeholder: "e.g Facebook" }))),
                    React.createElement("p", { className: "text" },
                        React.createElement("span", null,
                            React.createElement("label", { htmlFor: "reference" }, "Promo Code(optional)"),
                            React.createElement(Field, { type: "text", component: RenderField, name: "promocode", id: "promocode", placeholder: "Promocode (Optional)" }))),
                    React.createElement("div", null,
                        React.createElement("p", { className: "submit" },
                            React.createElement("button", { type: "submit", className: "button blue medium", id: "create-account-button", disabled: this.props.register.requesting },
                                !this.props.register.requesting && (React.createElement("span", null, "Create OneUptime Account")),
                                this.props.register.requesting && (React.createElement(FlatLoader, null)))))))));
    }
}
CompanyForm.displayName = 'CompanyForm';
const validate = function (values) {
    const error = {};
    if (!Validate.text(values.companyName)) {
        error.companyName = 'Company name is required.';
    }
    if (!Validate.text(values.companyRole)) {
        error.companyRole = 'Job Title is required.';
    }
    if (!Validate.text(values.companyPhoneNumber)) {
        error.companyPhoneNumber = 'Phone Number is required.';
    }
    if (!Validate.text(values.comapnySize)) {
        error.comapnySize = 'Phone Number is required.';
    }
    if (!Validate.text(values.reference)) {
        error.reference = 'This is required.';
    }
    return error;
};
const companyForm = reduxForm({
    form: 'CompanyForm',
    destroyOnUnmount: false,
    forceUnregisterOnUnmount: true,
    validate, // <------ unregister fields on unmoun
})(CompanyForm);
const mapDispatchToProps = () => {
    return {};
};
function mapStateToProps(state) {
    return {
        register: state.register,
    };
}
CompanyForm.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    register: PropTypes.object.isRequired,
    submitForm: PropTypes.func.isRequired,
};
export default connect(mapStateToProps, mapDispatchToProps)(companyForm);
