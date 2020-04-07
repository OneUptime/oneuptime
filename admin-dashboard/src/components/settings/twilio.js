import React from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { reduxForm, Field } from 'redux-form';
import uuid from 'uuid';
import { RenderField } from '../basic/RenderField';
import { Validate } from '../../config';
import { FormLoader } from '../basic/Loader';
import PropTypes from 'prop-types';
import { fetchSettings, saveSettings, testTwilio } from '../../actions/settings';
import { openModal, closeModal } from '../../actions/modal';

import TwilioTestModal from './twilioTestModal';

// Client side validation
function validate(values) {
    const errors = {};

    if (!Validate.text(values['account-sid'])) {
        errors['account-sid'] = 'Account SID is not valid.';
    }

    if (!Validate.text(values['authentication-token'])) {
        errors['authentication-token'] = 'Authentication token is not valid.';
    }

    if (!Validate.text(values.phone)) {
        errors.phone = 'Phone is not valid.';
    }

    if (!Validate.text(values['verification-sid'])) {
        errors['verification-sid'] = 'Verification SID is not valid.';
    }

    if (!Validate.text(values['alert-limit'])) {
        errors['alert-limit'] = 'Alert limit is not valid.';
    }

    return errors;
}

const settingsType = 'twilio';

const fields = [
    {
        key: 'call-enabled',
        label: 'Enable Call Alerts',
        // eslint-disable-next-line react/display-name, react/prop-types
        component: ({ input: { value, onChange } }) => (
            <label className="Toggler-wrap">
                <input
                    className="btn-toggler"
                    checked={value}
                    onChange={onChange}
                    type="checkbox"
                    name="call-enabled"
                    id="call-enabled"
                />
                <span className="TogglerBtn-slider round"></span>
            </label>
        ),
    },
    {
        key: 'sms-enabled',
        label: 'Enable SMS Alerts',
        // eslint-disable-next-line react/display-name, react/prop-types
        component: ({ input: { value, onChange } }) => (
            <label className="Toggler-wrap">
                <input
                    className="btn-toggler"
                    checked={value}
                    onChange={onChange}
                    type="checkbox"
                    name="sms-enabled"
                    id="sms-enabled"
                />
                <span className="TogglerBtn-slider round"></span>
            </label>
        ),
    },
    {
        key: 'account-sid',
        label: 'Account SID',
        type: 'text',
        component: RenderField,
    },
    {
        key: 'authentication-token',
        label: 'Authentication Token',
        type: 'text',
        component: RenderField,
    },
    {
        key: 'phone',
        label: 'Phone Number',
        placeholder: 'e.g. +15418533069',
        type: 'text',
        component: RenderField,
    },
    {
        key: 'verification-sid',
        label: 'Verification SID',
        type: 'text',
        component: RenderField,
    },
    {
        key: 'alert-limit',
        label: 'Twilio Alert Limit',
        type: 'number',
        component: RenderField,
    },
];

export class Component extends React.Component {
    constructor(props) {
        super(props);
        this.state = { testModalId: uuid.v4() };
    }

    async componentDidMount() {
        await this.props.fetchSettings(settingsType);
    }

    handleTwilioTest = e => {
        e.preventDefault();
        const thisObj = this;
        const { testModalId } = this.state;
        const { twilio, testTwilio } = this.props;

        this.props.openModal({
            id: testModalId,
            onConfirm: (testPhone) => {
                let {'test-number': testphoneNumber} = testPhone;
                let {
                    'account-sid': accountSid, 
                    'authentication-token': authToken, 
                    phone: phoneNumber
                } = twilio;

                return testTwilio({accountSid, authToken, phoneNumber, testphoneNumber}).then(res => {
                    if (res && typeof res === 'string') {
                        // prevent dismissal of modal if errored
                        // res will only be a string if errored
                        return this.handleTwilioTest();
                    }

                    if (window.location.href.indexOf('localhost') <= -1) {
                        thisObj.context.mixpanel.track('Sent SMTP settings');
                    }
                });
            },
            content: TwilioTestModal,
        });
    };

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeModal({ id: this.state.testModalId });
            default:
                return false;
        }
    };

    submitForm = values => {
        this.props.saveSettings(settingsType, values);
    };

    render() {
        const { settings, handleSubmit } = this.props;
        return (
            <div
                onKeyDown={this.handleKeyBoard}
                className="bs-ContentSection Card-root Card-shadow--medium"
            >
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <div className="Flex-flex Flex-alignItems-center Flex-justifyContent--spaceBetween">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Twilio Settings</span>
                                </span>
                            </div>
                            <p>
                                <span>
                                    Your Twilio account will be used to send all
                                    the SMS and Call alerts from Fyipe.
                                </span>
                            </p>
                        </div>
                    </div>
                    <form
                        id="twilio-form"
                        onSubmit={handleSubmit(this.submitForm)}
                    >
                        <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                    <fieldset className="bs-Fieldset">
                                        <div className="bs-Fieldset-rows">
                                            {fields.map(field => (
                                                <div
                                                    key={field.key}
                                                    className="bs-Fieldset-row"
                                                >
                                                    <label className="bs-Fieldset-label">
                                                        {field.label}
                                                    </label>
                                                    <div
                                                        className="bs-Fieldset-fields"
                                                        style={{
                                                            paddingTop: 3,
                                                        }}
                                                    >
                                                        <Field
                                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                                            type={field.type}
                                                            name={field.key}
                                                            id={field.key}
                                                            placeholder={
                                                                field.placeholder ||
                                                                field.label
                                                            }
                                                            component={
                                                                field.component
                                                            }
                                                            disabled={
                                                                settings &&
                                                                settings.requesting
                                                            }
                                                        />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </fieldset>
                                </div>
                            </div>
                        </div>

                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                            <span className="db-SettingsForm-footerMessage"></span>
                            <div>
                                <button
                                    className="bs-Button"
                                    disabled={settings && settings.requesting}
                                    onClick={this.handleTwilioTest}
                                >
                                    {settings.requesting ? (
                                        <FormLoader />
                                    ) : (
                                            <span>Test</span>
                                        )}
                                </button>
                                <button
                                    className="bs-Button bs-Button--blue"
                                    disabled={settings && settings.requesting}
                                    type="submit"
                                >
                                    {settings.requesting ? (
                                        <FormLoader />
                                    ) : (
                                            <span>Save Settings</span>
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

Component.displayName = 'SettingsForm';

Component.propTypes = {
    settings: PropTypes.object.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    saveSettings: PropTypes.func.isRequired,
    fetchSettings: PropTypes.func.isRequired,
    testTwilio: PropTypes.func.isRequired,
    openModal: PropTypes.func,
    closeModal: PropTypes.func,
    twilio: PropTypes.object,
    twilioForm: PropTypes.object,
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            saveSettings,
            fetchSettings,
            testTwilio,
            openModal,
            closeModal,
        },
        dispatch
    );
};

function mapStateToProps(state) {
    return {
        settings: state.settings,
        initialValues: state.settings[settingsType],
        twilio: state.settings.twilio,
        twilioForm: state.form['twilio-test-form'],
    };
}

const ReduxFormComponent = reduxForm({
    form: 'twilio-form',
    enableReinitialize: true,
    validate,
})(Component);

export default connect(mapStateToProps, mapDispatchToProps)(ReduxFormComponent);
