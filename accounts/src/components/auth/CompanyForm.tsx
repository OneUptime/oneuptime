import React, { Component } from 'react';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { Field, reduxForm } from 'redux-form';
import CountrySelector from '../basic/CountrySelector';
import CompanySizeSelector from '../basic/CompanySizeSelector';
import { connect } from 'react-redux';
import { RenderField } from '../basic/RenderField';
import { Validate } from '../../config';
import { FlatLoader } from '../basic/Loader.js';

const errorStyle = {
    color: 'red',
};

class CompanyForm extends Component {
    render() {
        return (
            <div id="main-body" className="box css">
                <div className="inner">
                    <div className="title extra">
                        <h2>
                            <span>
                                {' '}
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'register' does not exist on type 'Readon... Remove this comment to see the full error message
                                {this.props.register.error ? (
                                    <span style={errorStyle}>
                                        {' '}
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'register' does not exist on type 'Readon... Remove this comment to see the full error message
                                        {this.props.register.error}
                                    </span>
                                ) : (
                                    'One Last Step...'
                                )}{' '}
                            </span>
                        </h2>
                    </div>
                    <form
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
                        onSubmit={this.props.handleSubmit(
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'submitForm' does not exist on type 'Read... Remove this comment to see the full error message
                            this.props.submitForm
                        )}
                    >
                        <p className="text">
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
                        <p className="text">
                            <span>
                                <label htmlFor="companyRole">Job Title</label>
                                <Field
                                    type="text"
                                    name="companyRole"
                                    id="companyRole"
                                    component={RenderField}
                                    placeholder="Your Job Title"
                                />
                            </span>
                        </p>
                        <p className="text">
                            <span>
                                <label htmlFor="companyCountry">Country</label>
                                <Field
                                    type="text"
                                    component={CountrySelector}
                                    name="companyCountry"
                                    id="companyCountry"
                                    placeholder="Company Country"
                                />
                            </span>
                        </p>
                        <p className="text">
                            <span>
                                <label htmlFor="companySize">
                                    Company Size
                                </label>
                                <Field
                                    type="text"
                                    component={CompanySizeSelector}
                                    name="companySize"
                                    id="companySize"
                                    placeholder="company Size"
                                />
                            </span>
                        </p>
                        <p className="text">
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
                        <p className="text">
                            <span>
                                <label htmlFor="reference">
                                    Where did you hear about us?
                                </label>
                                <Field
                                    type="text"
                                    component={RenderField}
                                    name="reference"
                                    id="reference"
                                    placeholder="e.g Facebook"
                                />
                            </span>
                        </p>
                        <p className="text">
                            <span>
                                <label htmlFor="reference">
                                    Promo Code(optional)
                                </label>
                                <Field
                                    type="text"
                                    component={RenderField}
                                    name="promocode"
                                    id="promocode"
                                    placeholder="Promocode (Optional)"
                                />
                            </span>
                        </p>
                        <div>
                            <p className="submit">
                                <button
                                    type="submit"
                                    className="button blue medium"
                                    id="create-account-button"
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'register' does not exist on type 'Readon... Remove this comment to see the full error message
                                    disabled={this.props.register.requesting}
                                >
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'register' does not exist on type 'Readon... Remove this comment to see the full error message
                                    {!this.props.register.requesting && (
                                        <span>Create OneUptime Account</span>
                                    )}
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'register' does not exist on type 'Readon... Remove this comment to see the full error message
                                    {this.props.register.requesting && (
                                        <FlatLoader />
                                    )}
                                </button>
                            </p>
                        </div>
                    </form>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
CompanyForm.displayName = 'CompanyForm';

const validate = function(values: $TSFixMe) {
    const error = {};

    if (!Validate.text(values.companyName)) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'companyName' does not exist on type '{}'... Remove this comment to see the full error message
        error.companyName = 'Company name is required.';
    }

    if (!Validate.text(values.companyRole)) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'companyRole' does not exist on type '{}'... Remove this comment to see the full error message
        error.companyRole = 'Job Title is required.';
    }

    if (!Validate.text(values.companyPhoneNumber)) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'companyPhoneNumber' does not exist on ty... Remove this comment to see the full error message
        error.companyPhoneNumber = 'Phone Number is required.';
    }

    if (!Validate.text(values.comapnySize)) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'comapnySize' does not exist on type '{}'... Remove this comment to see the full error message
        error.comapnySize = 'Phone Number is required.';
    }

    if (!Validate.text(values.reference)) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'reference' does not exist on type '{}'.
        error.reference = 'This is required.';
    }

    return error;
};

const companyForm = reduxForm({
    form: 'CompanyForm', // <------ same form name
    destroyOnUnmount: false, // <------ preserve form data
    forceUnregisterOnUnmount: true,
    validate, // <------ unregister fields on unmoun
})(CompanyForm);

const mapDispatchToProps = () => {
    return {};
};

function mapStateToProps(state: $TSFixMe) {
    return {
        register: state.register,
    };
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
CompanyForm.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    register: PropTypes.object.isRequired,
    submitForm: PropTypes.func.isRequired,
};

export default connect(mapStateToProps, mapDispatchToProps)(companyForm);
