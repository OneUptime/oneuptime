import React from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm, Field } from 'redux-form';
import { RenderField } from '../basic/RenderField';
import { Validate } from '../../config';
import { FormLoader } from '../basic/Loader';
import PropTypes from 'prop-types';
import { fetchSettings, saveSettings } from '../../actions/settings';

// Client side validation
function validate(values: $TSFixMe) {
    const errors = {};

    if (!Validate.text(values['account-sid'])) {
        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        errors['account-sid'] = 'Account SID is not valid.';
    }

    if (!Validate.text(values['authentication-token'])) {
        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        errors['authentication-token'] = 'Authentication token is not valid.';
    }

    if (!Validate.text(values.phone)) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'phone' does not exist on type '{}'.
        errors.phone = 'Phone is not valid.';
    }

    if (!Validate.number(values['alert-limit'])) {
        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
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
        component: ({
            input: { value, onChange }
        }: $TSFixMe) => (
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
        component: ({
            input: { value, onChange }
        }: $TSFixMe) => (
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
        key: 'alert-limit',
        label: 'Twilio Alert Limit',
        type: 'number',
        component: RenderField,
    },
];

export class Component extends React.Component {
    handleKeyBoard: $TSFixMe;
    async componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchSettings' does not exist on type 'R... Remove this comment to see the full error message
        await this.props.fetchSettings(settingsType);
    }

    submitForm = (values: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'saveSettings' does not exist on type 'Re... Remove this comment to see the full error message
        this.props.saveSettings(settingsType, values);
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'settings' does not exist on type 'Readon... Remove this comment to see the full error message
        const { settings, handleSubmit } = this.props;
        return (
            <div
                id="oneuptimeTwilio"
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
                                    the SMS and Call alerts from OneUptime.
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
                            <span className="db-SettingsForm-footerMessage">
                                {!settings.requesting && settings.error && (
                                    <div id="errors" className="bs-Tail-copy">
                                        <div
                                            className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                            style={{ marginTop: '10px' }}
                                        >
                                            <div className="Box-root Margin-right--8">
                                                <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                            </div>
                                            <div className="Box-root">
                                                <span style={{ color: 'red' }}>
                                                    {settings.error}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </span>
                            <div>
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
Component.displayName = 'SettingsForm';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
Component.propTypes = {
    settings: PropTypes.object.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    saveSettings: PropTypes.func.isRequired,
    fetchSettings: PropTypes.func.isRequired,
};

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            saveSettings,
            fetchSettings,
        },
        dispatch
    );
};

function mapStateToProps(state: $TSFixMe) {
    return {
        settings: state.settings,
        initialValues: state.settings[settingsType],
    };
}

const ReduxFormComponent = reduxForm({
    form: 'twilio-form',
    enableReinitialize: true,
    validate,
})(Component);

export default connect(mapStateToProps, mapDispatchToProps)(ReduxFormComponent);
