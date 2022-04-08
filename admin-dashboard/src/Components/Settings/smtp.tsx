import React from 'react';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';

import { reduxForm, Field } from 'redux-form';

import { v4 as uuidv4 } from 'uuid';
import { RenderField } from '../basic/RenderField';
import { Validate, IS_INTERNAL_SMTP_DEPLOYED } from '../../config';
import { FormLoader } from '../basic/Loader';
import PropTypes from 'prop-types';
import { fetchSettings, saveSettings, testSmtp } from '../../actions/settings';
import { openModal, closeModal } from 'common-ui/actions/modal';
import SmtpTestModal from './smtpTestModal';
import MessageModal from './MessageModal';

// Client side validation
function validate(values: $TSFixMe) {
    const errors = {};

    if (!Validate.email(values.email)) {

        errors.email = 'Email is not valid.';
    }

    if (!Validate.text(values.password)) {

        errors.password = 'Password is not valid.';
    }

    if (!Validate.text(values['from-name'])) {

        errors['from-name'] = 'Name is not valid.';
    }

    if (!Validate.email(values['from'])) {

        errors['from'] = 'Email is not valid.';
    }

    if (!Validate.text(values['smtp-server'])) {

        errors['smtp-server'] = 'SMTP Server is not valid.';
    }

    if (!Validate.text(values['smtp-port'])) {

        errors['smtp-port'] = 'SMTP Port is not valid.';
    }

    return errors;
}

const settingsType = 'smtp';

const fields = [
    {
        key: 'email',
        label: 'Email',
        type: 'text',
        component: RenderField,
        explanation: 'Username for SMTP server.',
    },
    {
        key: 'password',
        label: 'Password',
        type: 'password',
        component: RenderField,
        explanation: 'Password for SMTP server.',
    },
    {
        key: 'smtp-server',
        label: 'SMTP Server',
        type: 'text',
        component: RenderField,
        explanation: 'SMTP Server address.',
    },
    {
        key: 'smtp-port',
        label: 'SMTP Port',
        type: 'text',
        component: RenderField,
        explanation: 'Port SMTP is running on.',
    },
    {
        key: 'from',
        label: 'From Email',
        type: 'text',
        component: RenderField,
        explanation: 'Email address where emails will be sent from.',
    },
    {
        key: 'from-name',
        label: 'From Name',
        type: 'text',
        component: RenderField,
        explanation: 'Name that will be used in emails.',
    },
    {
        key: 'smtp-secure',
        label: 'SMTP Secure',

        component: ({
            input: { value, onChange }
        }: $TSFixMe) => (
            <label className="Toggler-wrap" id="label_smpt_secure">
                <input
                    className="btn-toggler"
                    checked={value}
                    onChange={onChange}
                    type="checkbox"
                    name="smtp-secure"
                    id="smtp-secure"
                />
                <span className="TogglerBtn-slider round"></span>
            </label>
        ),
        explanation: 'Enabled for port 465, disabled for port 587',
    },
];

const emailEnableField = [
    {
        key: 'email-enabled',
        label: 'Enable Emails',

        component: ({
            input: { value, onChange }
        }: $TSFixMe) => (
            <label className="Toggler-wrap" id="email-enabled">
                <input
                    className="btn-toggler"
                    checked={value}
                    onChange={onChange}
                    type="checkbox"
                    name="email-enabled"
                />
                <span className="TogglerBtn-slider round"></span>
            </label>
        ),
    },
];

const smtpOptions = [
    {
        key: 'internalSmtp',
        label: 'Enable internal SMTP server',

        component: ({
            input: { value, onChange }
        }: $TSFixMe) => (
            <label className="Toggler-wrap" id="internalSmtp">
                {' '}
                {/**setting id at label removes intermittent result*/}
                <input
                    className="btn-toggler"
                    checked={value}
                    onChange={onChange}
                    type="checkbox"
                    name="internalSmtp"
                />
                <span className="TogglerBtn-slider round"></span>
            </label>
        ),
        explanation: 'Use pre-configured internal SMTP server',
    },
    {
        key: 'customSmtp',
        label: 'Enable custom SMTP server',

        component: ({
            input: { value, onChange }
        }: $TSFixMe) => (
            <label className="Toggler-wrap" id="customSmtp">
                <input
                    className="btn-toggler"
                    checked={value}
                    onChange={onChange}
                    type="checkbox"
                    name="customSmtp"
                />
                <span className="TogglerBtn-slider round"></span>
            </label>
        ),
        explanation: 'Custom SMTP will also serve as backup SMTP server',
    },
];

export class Component extends Component<ComponentProps>{
    public static displayName = '';
    public static propTypes = {};
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            testModalId: uuidv4(),
            messageModalId: uuidv4(),
        };
    }

    async override componentDidMount() {

        await this.props.fetchSettings(settingsType);
    }

    handleTestSmtp = (e: $TSFixMe) => {
        e.preventDefault();

        const { testSmtp, smtpForm } = this.props;

        const { testModalId } = this.state;


        this.props.openModal({
            id: testModalId,
            onConfirm: (testForm: $TSFixMe) => {

                const { smtpToUse } = this.props.smtpTestForm.values;
                const { 'test-email': email } = testForm;
                const {
                    email: user,
                    password: pass,
                    'smtp-server': host,
                    'smtp-port': port,
                    'smtp-secure': secure,
                    from,
                    'from-name': name,
                    internalSmtp,
                    customSmtp,
                } = smtpForm.values;

                const payload = {
                    user,
                    pass,
                    host,
                    port,
                    secure,
                    from,
                    name,
                    email,
                    internalSmtp,
                    customSmtp,
                    smtpToUse,
                };

                return testSmtp(payload).then((res: ExpressResponse) => {
                    if (res && typeof res === 'string') {
                        // prevent dismissal of modal if errored
                        // res will only be a string if errored

                        return this.props.openModal({

                            id: this.state.messageModalId,
                            content: (props: $TSFixMe) => {
                                return (
                                    <MessageModal {...props} email={email} />
                                );
                            },
                        });
                    }

                    return this.props.openModal({

                        id: this.state.messageModalId,
                        content: (props: $TSFixMe) => {
                            return <MessageModal {...props} email={email} />;
                        },
                    });
                });
            },
            content: SmtpTestModal,
        });
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                return this.props.closeModal({ id: this.state.testModalId });
            default:
                return false;
        }
    };

    submitForm = (values: $TSFixMe) => {

        this.props.saveSettings(settingsType, values);
    };

    override render() {

        const { settings, handleSubmit, smtpForm } = this.props;
        return (
            <div
                id="oneuptimeSmtp"
                onKeyDown={this.handleKeyBoard}
                className="bs-ContentSection Card-root Card-shadow--medium"
            >
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <div className="Flex-flex Flex-alignItems-center Flex-justifyContent--spaceBetween">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>SMTP Settings</span>
                                </span>
                            </div>
                            <p>
                                <span>
                                    These SMTP settings will be used to send all
                                    the emails from OneUptime, including all the
                                    email alerts.
                                </span>
                            </p>
                        </div>
                    </div>
                    <form
                        id="smtp-form"
                        onSubmit={handleSubmit(this.submitForm)}
                    >
                        <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                    <fieldset className="bs-Fieldset">
                                        <div className="bs-Fieldset-rows">
                                            {emailEnableField.map(field => (
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

                                                        {field.explanation && (
                                                            <p className="bs-Fieldset-explanation">
                                                                {

                                                                    field.explanation
                                                                }
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                            {smtpForm.values &&
                                                smtpForm.values[
                                                'email-enabled'
                                                ] &&
                                                smtpOptions.map(field => {
                                                    if (
                                                        field.key ===
                                                        'internalSmtp' &&
                                                        !IS_INTERNAL_SMTP_DEPLOYED
                                                    ) {
                                                        return null;
                                                    }
                                                    return (
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
                                                                    type={

                                                                        field.type
                                                                    }
                                                                    name={
                                                                        field.key
                                                                    }
                                                                    id={
                                                                        field.key
                                                                    }
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
                                                                {field.explanation && (
                                                                    <p className="bs-Fieldset-explanation">
                                                                        {
                                                                            field.explanation
                                                                        }
                                                                    </p>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            {smtpForm.values &&
                                                smtpForm.values[
                                                'email-enabled'
                                                ] &&
                                                smtpForm.values.customSmtp &&
                                                fields.map(field => (
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
                                                                type={
                                                                    field.type
                                                                }
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
                                                            {field.explanation && (
                                                                <p className="bs-Fieldset-explanation">
                                                                    {
                                                                        field.explanation
                                                                    }
                                                                </p>
                                                            )}
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
                                    id="testSmtpSettingsButton"
                                    className="bs-Button"
                                    disabled={settings && settings.requesting}
                                    onClick={this.handleTestSmtp}
                                >
                                    {settings.requesting ? (
                                        <FormLoader />
                                    ) : (
                                        <span>Test</span>
                                    )}
                                </button>
                                <button
                                    className="bs-Button bs-Button--blue"
                                    id="save-smpt-settings"
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
    initialValues: PropTypes.object,
    smtpForm: PropTypes.object,
    smtpTestForm: PropTypes.object,
    closeModal: PropTypes.func.isRequired,
    openModal: PropTypes.func.isRequired,
    testSmtp: PropTypes.func,
};

const mapDispatchToProps = (dispatch: Dispatch) => {
    return bindActionCreators(
        {
            saveSettings,
            fetchSettings,
            testSmtp,
            openModal,
            closeModal,
        },
        dispatch
    );
};

function mapStateToProps(state: RootState) {
    return {
        settings: state.settings,
        initialValues: state.settings[settingsType],
        smtpForm: state.form['smtp-form'] || {},
        smtpTestForm: state.form['smtp-test-form'] || {},
    };
}

const ReduxFormComponent = reduxForm({
    form: 'smtp-form',
    enableReinitialize: true,
    validate,
})(Component);

export default connect(mapStateToProps, mapDispatchToProps)(ReduxFormComponent);
