import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { reduxForm, Field } from 'redux-form';
import { RenderField } from '../basic/RenderField';
import { Validate } from '../../config';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import { confirmLicense } from '../../actions/license';

//Client side validation
function validate(values) {
    const errors = {};

    if (values.email) {
        if (!Validate.email(values.email)) {
            errors.email = 'Email is not valid.';
        }

        if (
            !Validate.isValidBusinessEmail(values.email) &&
            Validate.email(values.email)
        ) {
            errors.email = 'Please enter a business email address.';
        }
    }

    if (values.license) {
        if (!Validate.text(values.license)) {
            errors.license = 'License is not in valid format.';
        }
    }

    return errors;
}

export class LicenseSetting extends Component {
    submitForm = values => {
        const { confirmLicense } = this.props;

        confirmLicense(values);
    };

    render() {
        const { handleSubmit, license: { data }, confirm: { requesting, error } } = this.props;
        const isLicensed = data && data.license;

        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <div className="Flex-flex Flex-alignItems-center Flex-justifyContent--spaceBetween">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>License Details</span>
                                </span>
                                <div className={`Badge Badge--color--${isLicensed ? 'green' : 'red'} Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2`}>
                                    <span className={`Badge-text Text-color--${isLicensed ? 'green' : 'red'} Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap`}>
                                        <span>{isLicensed ? 'Valid License' : 'Evaluation License'}</span>
                                    </span>
                                </div>
                            </div>
                            <p>
                                <span>
                                    Update your License Key and Email. To buy a license, please email sales@fyipe.com
                                </span>
                            </p>
                        </div>
                    </div>
                    <form onSubmit={handleSubmit(this.submitForm)}>
                        <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                    <fieldset className="bs-Fieldset">
                                        <div className="bs-Fieldset-rows">
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    License Key
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <Field
                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                        type="text"
                                                        name="license"
                                                        id="license"
                                                        placeholder="License Key"
                                                        component={RenderField}
                                                        disabled={requesting}
                                                    />
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    Email
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <Field
                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                        type="email"
                                                        name="email"
                                                        id="email"
                                                        placeholder="Email"
                                                        component={RenderField}
                                                        disabled={requesting}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </fieldset>
                                </div>
                            </div>
                        </div>

                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                            <span className="db-SettingsForm-footerMessage"></span>
                            <div className="bs-Tail-copy">
                                <div
                                    className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                    style={{ marginTop: '10px' }}
                                >
                                    <ShouldRender if={error}>
                                        <div className="Box-root Margin-right--8">
                                            <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                        </div>
                                        <div className="Box-root">
                                            <span id="licenseError" style={{ color: 'red' }}>
                                                {error}
                                            </span>
                                        </div>
                                    </ShouldRender>
                                </div>
                            </div>
                            <div>
                                <button
                                    className="bs-Button bs-Button--blue"
                                    disabled={requesting}
                                    type="submit"
                                >
                                    {!requesting && (
                                        <span>Confirm License</span>
                                    )}
                                    {requesting && (
                                        <FormLoader />
                                    )}
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        );
    }
}

LicenseSetting.displayName = 'LicenseSetting';

const LicenseSettingForm = reduxForm({
    form: 'License', // a unique identifier for this form,
    enableReinitialize: true,
    validate, // <--- validation function given to redux-for
})(LicenseSetting);

const mapStateToProps = state => {
    const initValues = state.license.license
        ? Object.assign({}, state.license.license.data)
        : {};

    return {
        initialValues: initValues,
        license: state.license.license,
        confirm: state.license.confirmLicense,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ confirmLicense }, dispatch);

LicenseSetting.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    confirmLicense: PropTypes.func.isRequired,
    initialValues: PropTypes.object,
    license: PropTypes.object
};

export default connect(mapStateToProps, mapDispatchToProps)(LicenseSettingForm);