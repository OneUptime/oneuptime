import React from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { Component } from 'react';
import { reduxForm, Field } from 'redux-form';
import {
    setSmtpConfig,
    postSmtpConfig,
    deleteSmtpConfig,
    updateSmtpConfig,
} from '../../actions/smsTemplates';
import { RenderField } from '../basic/RenderField';
import { Validate } from '../../config';
import IsAdmin from '../basic/IsAdmin';
import IsOwner from '../basic/IsOwner';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import { logEvent } from '../../analytics';
import { SHOULD_LOG_ANALYTICS } from '../../config';

export class SmsSmtpBox extends Component {
    constructor(props) {
        super(props);
        this.changeValue = this.changeValue.bind(this);
        this.submitForm = this.submitForm.bind(this);
    }

    //Client side validation
    validate = values => {
        const errors = {};
        if (this.props.showSmsSmtpConfiguration) {
            if (values.accountSid) {
                if (!Validate.text(values.accountSid)) {
                    errors.accountSid =
                        'Please input accountSid in text format .';
                }
            } else {
                errors.accountSid =
                    'Please input accountSid this cannot be left blank.';
            }

            if (values.phoneNumber) {
                if (!Validate.number(values.phoneNumber)) {
                    errors.phoneNumber =
                        'Please input phoneNumber in number format .';
                }
            } else {
                errors.phoneNumber =
                    'Please input phoneNumber this cannot be left blank.';
            }

            if (values.authToken) {
                if (!Validate.text(values.authToken)) {
                    errors.authToken =
                        'Please input authToken in proper format .';
                }
            } else {
                errors.authToken =
                    'Please input authToken this cannot be left blank.';
            }
        }
        return errors;
    };

    submitForm = values => {
        const {
            smtpConfigurations,
            updateSmtpConfig,
            postSmtpConfig,
            currentProject,
        } = this.props;

        if (values.smssmtpswitch) {
            if (smtpConfigurations.config && smtpConfigurations.config._id) {
                updateSmtpConfig(
                    currentProject._id,
                    smtpConfigurations.config._id,
                    values
                );
            } else {
                postSmtpConfig(currentProject._id, values);
            }
        } else if (smtpConfigurations.config._id) {
            this.props.deleteSmtpConfig(
                this.props.currentProject._id,
                smtpConfigurations.config._id,
                values
            );
        }
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > SETTINGS > SMS SETTINGS UPDATED'
            );
        }
    };

    changeValue = e => {
        this.props.setSmtpConfig(e.target.checked);
    };

    render() {
        const { handleSubmit } = this.props;
        return (
            <div
                className="db-World-contentPane Box-root"
                style={{ paddingTop: 0 }}
            >
                <div className="db-RadarRulesLists-page">
                    <div className="Box-root Margin-bottom--12">
                        <div className="bs-ContentSection Card-root Card-shadow--medium">
                            <div className="Box-root">
                                <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                                    <div className="Box-root">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Custom Twilio Settings</span>
                                        </span>
                                        <p>
                                            <span>
                                                Send sms and calls via your
                                                Twilio server instead of
                                                Fyipe&#39;s default Twilio
                                                server.
                                            </span>
                                        </p>
                                    </div>
                                </div>
                                {IsAdmin(this.props.currentProject) ||
                                IsOwner(this.props.currentProject) ? (
                                    <form
                                        onSubmit={handleSubmit(this.submitForm)}
                                    >
                                        <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                                            <div>
                                                <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                                    <fieldset className="bs-Fieldset">
                                                        <div className="bs-Fieldset-rows">
                                                            <div className="bs-Fieldset-row">
                                                                <div className="Box-root Margin-bottom--12">
                                                                    <div
                                                                        data-test="RetrySettings-failedPaymentsRow"
                                                                        className="Box-root"
                                                                    >
                                                                        <label
                                                                            className="Checkbox responsive"
                                                                            htmlFor="smssmtpswitch"
                                                                            style={{
                                                                                marginLeft:
                                                                                    '150px',
                                                                            }}
                                                                        >
                                                                            <Field
                                                                                component="input"
                                                                                type="checkbox"
                                                                                name="smssmtpswitch"
                                                                                data-test="RetrySettings-failedPaymentsCheckbox"
                                                                                className="Checkbox-source"
                                                                                id="smssmtpswitch"
                                                                                onChange={
                                                                                    this
                                                                                        .changeValue
                                                                                }
                                                                                disabled={
                                                                                    !IsAdmin(
                                                                                        this
                                                                                            .props
                                                                                            .currentProject
                                                                                    ) &&
                                                                                    !IsOwner(
                                                                                        this
                                                                                            .props
                                                                                            .currentProject
                                                                                    )
                                                                                }
                                                                            />
                                                                            <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                                <div className="Checkbox-target Box-root">
                                                                                    <div className="Checkbox-color Box-root"></div>
                                                                                </div>
                                                                            </div>
                                                                            <div className="Checkbox-label Box-root Margin-left--8">
                                                                                <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                                    <span>
                                                                                        Send
                                                                                        SMS
                                                                                        with
                                                                                        my
                                                                                        Twilio
                                                                                        Account
                                                                                    </span>
                                                                                </span>
                                                                            </div>
                                                                        </label>
                                                                        <div className="Box-root Padding-left--24">
                                                                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                                                <div className="Box-root">
                                                                                    <div className="Box-root"></div>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <ShouldRender
                                                                if={
                                                                    this.props
                                                                        .showSmsSmtpConfiguration
                                                                }
                                                            >
                                                                <div className="bs-Fieldset-row">
                                                                    <label className="bs-Fieldset-label">
                                                                        Account
                                                                        SID
                                                                    </label>
                                                                    <div className="bs-Fieldset-fields">
                                                                        <Field
                                                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                            component={
                                                                                RenderField
                                                                            }
                                                                            type="text"
                                                                            name="accountSid"
                                                                            id="accountSid"
                                                                            placeholder="Account SID"
                                                                            required="required"
                                                                            disabled={
                                                                                this
                                                                                    .props
                                                                                    .smtpConfigurations
                                                                                    .requesting
                                                                            }
                                                                        />
                                                                        <p className="bs-Fieldset-explanation">
                                                                            <span>
                                                                                <a
                                                                                    target="_blank"
                                                                                    rel="noopener noreferrer"
                                                                                    href="https://support.twilio.com/hc/en-us/articles/223136607-What-is-an-Application-SID-"
                                                                                >
                                                                                    Account
                                                                                    SID
                                                                                    for
                                                                                    your
                                                                                    Twilio
                                                                                    Account.
                                                                                </a>
                                                                            </span>
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                                <div className="bs-Fieldset-row">
                                                                    <label className="bs-Fieldset-label">
                                                                        Auth
                                                                        Token
                                                                    </label>
                                                                    <div className="bs-Fieldset-fields">
                                                                        <Field
                                                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                            component={
                                                                                RenderField
                                                                            }
                                                                            type="text"
                                                                            name="authToken"
                                                                            id="authToken"
                                                                            placeholder="Auth Token"
                                                                            required="required"
                                                                            disabled={
                                                                                this
                                                                                    .props
                                                                                    .smtpConfigurations
                                                                                    .requesting
                                                                            }
                                                                        />
                                                                        <p className="bs-Fieldset-explanation">
                                                                            <span>
                                                                                <a
                                                                                    href="https://support.twilio.com/hc/en-us/articles/223136027-Auth-Tokens-and-How-to-Change-Them"
                                                                                    target="_blank"
                                                                                    rel="noopener noreferrer"
                                                                                >
                                                                                    Auth
                                                                                    Token
                                                                                    for
                                                                                    your
                                                                                    Twilio
                                                                                    Account.
                                                                                </a>
                                                                            </span>
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                                <div className="bs-Fieldset-row">
                                                                    <label className="bs-Fieldset-label">
                                                                        Phone
                                                                        Number
                                                                    </label>
                                                                    <div className="bs-Fieldset-fields">
                                                                        <Field
                                                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                            component={
                                                                                RenderField
                                                                            }
                                                                            type="text"
                                                                            name="phoneNumber"
                                                                            id="phoneNumber"
                                                                            placeholder="Phone Number"
                                                                            required="required"
                                                                            disabled={
                                                                                this
                                                                                    .props
                                                                                    .smtpConfigurations
                                                                                    .requesting
                                                                            }
                                                                        />
                                                                        <p className="bs-Fieldset-explanation">
                                                                            <span>
                                                                                <a
                                                                                    href="https://support.twilio.com/hc/en-us/articles/223181428-Assigning-Twilio-number-to-an-SMS-application"
                                                                                    target="_blank"
                                                                                    rel="noopener noreferrer"
                                                                                >
                                                                                    {' '}
                                                                                    Phone
                                                                                    Number
                                                                                    associated
                                                                                    with
                                                                                    your
                                                                                    twilio
                                                                                    account
                                                                                </a>

                                                                                .
                                                                            </span>
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                            </ShouldRender>
                                                        </div>
                                                    </fieldset>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                                            <span className="db-SettingsForm-footerMessage">
                                                <ShouldRender
                                                    if={
                                                        this.props
                                                            .smtpConfigurations
                                                            .error ||
                                                        this.props.smsSmtpDelete
                                                            .error
                                                    }
                                                >
                                                    <div className="bs-Tail-copy">
                                                        <div
                                                            className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                            style={{
                                                                marginTop:
                                                                    '10px',
                                                            }}
                                                        >
                                                            <div className="Box-root Margin-right--8">
                                                                <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                            </div>
                                                            <div className="Box-root">
                                                                <span
                                                                    style={{
                                                                        color:
                                                                            'red',
                                                                    }}
                                                                >
                                                                    {this.props
                                                                        .smtpConfigurations
                                                                        .error ||
                                                                        this
                                                                            .props
                                                                            .smsSmtpDelete
                                                                            .error}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </ShouldRender>
                                            </span>

                                            <div>
                                                <button
                                                    className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                                    disabled={
                                                        this.props
                                                            .smtpConfigurations
                                                            .requesting ||
                                                        this.props.smsSmtpDelete
                                                            .requesting
                                                    }
                                                    type="submit"
                                                >
                                                    <ShouldRender
                                                        if={
                                                            !this.props
                                                                .smtpConfigurations
                                                                .requesting &&
                                                            !this.props
                                                                .smsSmtpDelete
                                                                .requesting
                                                        }
                                                    >
                                                        <span>Save</span>
                                                    </ShouldRender>

                                                    <ShouldRender
                                                        if={
                                                            this.props
                                                                .smtpConfigurations
                                                                .requesting ||
                                                            this.props
                                                                .smsSmtpDelete
                                                                .requesting
                                                        }
                                                    >
                                                        <FormLoader />
                                                    </ShouldRender>
                                                </button>
                                            </div>
                                        </div>
                                    </form>
                                ) : (
                                    <div
                                        className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-vertical--2"
                                        style={{ boxShadow: 'none' }}
                                    >
                                        <div
                                            className="bs-Fieldset-row"
                                            style={{ textAlign: 'center' }}
                                        >
                                            <label
                                                className="bs-Fieldset-label"
                                                style={{ flex: 'none' }}
                                            >
                                                Custom Twilio settings are
                                                available to only admins and
                                                owners.
                                            </label>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

SmsSmtpBox.displayName = 'SmsSmtpBox';

SmsSmtpBox.propTypes = {
    smtpConfigurations: PropTypes.object,
    updateSmtpConfig: PropTypes.func,
    postSmtpConfig: PropTypes.func,
    currentProject: PropTypes.object,
    deleteSmtpConfig: PropTypes.func,
    setSmtpConfig: PropTypes.func,
    handleSubmit: PropTypes.func,
    showSmsSmtpConfiguration: PropTypes.bool,
    smsSmtpDelete: PropTypes.object,
};

const SmsSmtpBoxForm = reduxForm({
    form: 'SmsSmtpBox', // a unique identifier for this form
    enableReinitialize: true,
    validate: SmsSmtpBox.validate, // <--- validation function given to redux-for
})(SmsSmtpBox);

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            setSmtpConfig,
            postSmtpConfig,
            deleteSmtpConfig,
            updateSmtpConfig,
        },
        dispatch
    );
};

function mapStateToProps(state) {
    const smtpConfigurations =
        state.smsTemplates && state.smsTemplates.smsSmtpConfiguration;
    const showSmsSmtpConfiguration =
        state.smsTemplates && state.smsTemplates.showSmsSmtpConfiguration;
    let values = {
        smssmtpswitch: false,
        accountSid: '',
        authToken: '',
        phoneNumber: '',
    };
    if (showSmsSmtpConfiguration) {
        values = {
            smssmtpswitch: true,
            accountSid: smtpConfigurations.config.accountSid,
            authToken: smtpConfigurations.config.authToken,
            phoneNumber: smtpConfigurations.config.phoneNumber,
        };
    }
    return {
        currentProject: state.project.currentProject,
        smtpConfigurations,
        initialValues: values,
        smsSmtpDelete: state.smsTemplates && state.smsTemplates.smsSmtpDelete,
        showSmsSmtpConfiguration,
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(SmsSmtpBoxForm);
