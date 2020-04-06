import React from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { reduxForm, Field } from 'redux-form';
import uuid from 'uuid';
import { RenderField } from '../basic/RenderField';
import { Validate } from '../../config';
import { FormLoader } from '../basic/Loader';
import PropTypes from 'prop-types';
import { fetchSettings, saveSettings, testSmtp } from '../../actions/settings';
import { openModal, closeModal } from '../../actions/modal';
import SmtpTestModal from './smtpTestModal';

// Client side validation
function validate(values) {
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
        key: 'email-enabled',
        label: 'Enable Emails',
        // eslint-disable-next-line react/display-name, react/prop-types
        component: ({ input: { value, onChange } }) => (
            <label className="Toggler-wrap">
                <input
                    className="btn-toggler"
                    checked={value}
                    onChange={onChange}
                    type="checkbox"
                    name="email-enabled"
                    id="email-enabled"
                />
                <span className="TogglerBtn-slider round"></span>
            </label>
        ),
    },
    {
        key: 'email',
        label: 'Email',
        type: 'text',
        component: RenderField,
    },
    {
        key: 'password',
        label: 'Password',
        type: 'password',
        component: RenderField,
    },
    {
        key: 'from-name',
        label: 'From Name',
        type: 'text',
        component: RenderField,
    },
    {
        key: 'smtp-server',
        label: 'SMTP Server',
        type: 'text',
        component: RenderField,
    },
    {
        key: 'smtp-port',
        label: 'SMTP Port',
        type: 'text',
        component: RenderField,
    },
    {
        key: 'smtp-secure',
        label: 'SMTP Secure',
        // eslint-disable-next-line react/display-name, react/prop-types
        component: ({ input: { value, onChange } }) => (
            <label className="Toggler-wrap">
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
    },
];

export class Component extends React.Component {
    constructor(props) {
        super(props);
        this.state = { testModalId: uuid.v4(), testEmail: '' }
    }

    async componentDidMount() {
        await this.props.fetchSettings(settingsType);
    }

    handleTestSmtp = (e) => {
        e.preventDefault();
        const thisObj = this;
        const { testSmtp, smtpForm } = this.props;
        const { testModalId } = this.state;

        this.props.openModal({
            id: testModalId,
            onConfirm: (testForm) => {
                const { 'test-email': email } = testForm;
                const {
                    email: user,
                    password: pass,
                    'smtp-server': host,
                    'smtp-port': port,
                    'smtp-secure': secure,
                    'from-name': from
                } = smtpForm.values;

                let payload = { user, pass, host, port, secure, from, email }

                return testSmtp(payload).then(res => {
                    if (res && typeof res === 'string') {
                        // prevent dismissal of modal if errored
                        // res will only be a string if errored
                        return this.handleTestSmtp();
                    }

                    if (window.location.href.indexOf('localhost') <= -1) {
                        thisObj.context.mixpanel.track('Sent SMTP settings');
                    }
                });
            },
            content: SmtpTestModal,
        });
    }

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
            <div onKeyDown={this.handleKeyBoard} className="bs-ContentSection Card-root Card-shadow--medium">
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
                                    the emails from Fyipe, including all the
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
    closeModal: PropTypes.func.isRequired,
    openModal: PropTypes.func.isRequired,
    testSmtp: PropTypes.func
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            saveSettings,
            fetchSettings,
            testSmtp,
            openModal,
            closeModal
        },
        dispatch
    );
};

function mapStateToProps(state) {
    return {
        settings: state.settings,
        initialValues: state.settings[settingsType],
        smtpForm: state.form['smtp-form'],
    };
}

const ReduxFormComponent = reduxForm({
    form: 'smtp-form',
    enableReinitialize: true,
    validate,
})(Component);

export default connect(mapStateToProps, mapDispatchToProps)(ReduxFormComponent);
