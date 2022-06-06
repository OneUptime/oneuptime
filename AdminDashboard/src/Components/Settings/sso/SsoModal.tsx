import React from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { RenderField } from '../../basic/RenderField';
import { API_URL, Validate } from '../../../config';

import { reduxForm, Field } from 'redux-form';
import { addSso, fetchSsos, updateSso } from '../../../actions/sso';
import { fetchSsoDefaultRoles } from '../../../actions/ssoDefaultRoles';
import copyToClipboard from '../../../utils/copyToClipboard';

// Client side validation
function validate(values: $TSFixMe) {
    const errors: $TSFixMe = {};

    if (!Validate.text(values.domain)) {
        errors.domain = 'Domain is not valid.';
    }

    if (!Validate.text(values.entityId)) {
        errors.entityId = 'Application ID is not valid.';
    }

    if (!Validate.text(values.remoteLoginUrl)) {
        errors.remoteLoginUrl = 'SSO URL is not valid.';
    }

    if (!Validate.text(values.remoteLogoutUrl)) {
        errors.remoteLogoutUrl = 'Remote logout URL is not valid.';
    }

    return errors;
}

const fields: $TSFixMe = [
    {
        key: 'saml-enabled',
        label: 'Enable SAML',
        description:
            'SAML is an industry standard SSO framework typically used by large enterprises for communicating identities across the internet.',

        component: ({ input: { value, onChange } }: $TSFixMe) => {
            return (
                <label className="Toggler-wrap">
                    <input
                        className="btn-toggler"
                        checked={value}
                        onChange={onChange}
                        type="checkbox"
                        name="saml-enabled"
                        id="saml-enabled"
                    />
                    <span
                        id="saml-enabled-slider"
                        className="TogglerBtn-slider round"
                    ></span>
                </label>
            );
        },
    },
    {
        key: 'ssoCallbackUrl',
        label: 'SSO Callback URL',
        value: `${API_URL}/user/sso/callback`,
        description: 'Add this to your IDP as your callback url',
        copyIcon:
            'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHZpZXdCb3g9IjAgMCAyMCAyMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+Y2xpcGJvYXJkPC90aXRsZT48cGF0aCBkPSJNMTQuMjc1IDQuNWguMzI1Yy4yMiAwIC40LjE4LjQuNHYxMC4yYS40LjQgMCAwIDEtLjQuNEg1LjRhLjQuNCAwIDAgMS0uNC0uNFY0LjljMC0uMjIuMTgtLjQuNC0uNGgxLjQ4NWMuMjIgMCAuNC4xOC40LjR2MS42NDdjMCAuMjIuMTc5LjQuNC40aDQuNzRhLjQuNCAwIDAgMCAuNC0uNFY0LjlhLjQuNCAwIDAgMSAuNC0uNGgxLjA1ek0xMS42IDMuOTUzYy4yMiAwIC40LjE4LjQuNFY1LjZhLjQuNCAwIDAgMS0uNC40SDguNGEuNC40IDAgMCAxLS40LS40VjQuMzUzYzAtLjIyLjE4LS40LjQtLjRoLjI1M2EuNC40IDAgMCAwIC40LS40VjMuNGMwLS4yMi4xOC0uNC40LS40aDEuMDI3Yy4yMiAwIC40LjE4LjQuNHYuMTUzYzAgLjIyMS4xOC40LjQuNGguMzJ6TTYuNSAxM2MwIC4yNjguMjIzLjUuNDk5LjVoMi43MDJhLjQ5OC40OTggMCAwIDAgLjQ5OS0uNWMwLS4yNjgtLjIyMy0uNS0uNDk5LS41SDYuOTk5YS40OTguNDk4IDAgMCAwLS40OTkuNXptMC0xLjc1YzAgLjI2OC4yMjIuNS40OTYuNWg1LjYwOGEuNDk2LjQ5NiAwIDAgMCAuNDk2LS41YzAtLjI2OC0uMjIyLS41LS40OTYtLjVINi45OTZhLjQ5Ni40OTYgMCAwIDAtLjQ5Ni41em0wLTEuNzVjMCAuMjY4LjIyNi41LjUwNi41aDQuNjg4Yy4yOSAwIC41MDYtLjIyNC41MDYtLjUgMC0uMjY4LS4yMjYtLjUtLjUwNi0uNUg3LjAwNmEuNDk3LjQ5NyAwIDAgMC0uNTA2LjV6IiBmaWxsPSIjNTI1RjdGIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiLz48L3N2Zz4=',
    },
    {
        key: 'domain',
        label: 'Domain',
        placeholder: 'microsoftonline.com',
        description: 'This is the domain that will be use in the SSO.',
        type: 'text',
        component: RenderField,
    },
    {
        key: 'entityId',
        label: 'Application ID',
        placeholder: 'hackerbay.io',
        description: 'This is the entity ID that will be used in the SSO.',
        type: 'text',
        component: RenderField,
    },
    {
        key: 'remoteLoginUrl',
        label: 'Remote Login URL',
        placeholder:
            'https://login.microsoftonline.com/a4e1d-1s4f-965f-ert452136',
        description:
            'This is the Url that oneuptime will invoke to redirect users to your identity provider.',
        type: 'text',
        component: RenderField,
    },
    {
        key: 'certificateFingerprint',
        label: 'Certificate Fingerprint',
        placeholder: 'ASFD254689CSVDS45DS5S4DGV6SD4V',
        description:
            'The SHA256 or SHA1 fingerprint of the SAML certificate obtain this from your Saml service provider.',
        type: 'text',
        component: RenderField,
    },
    {
        key: 'remoteLogoutUrl',
        label: 'Remote Logout URL',
        placeholder:
            'https://login.microsoftonline.com/common/wsfederation?wa=wsignout1.0',
        description:
            'This is the Url that oneuptime will direct your users to after they sign out.',
        type: 'text',
        component: RenderField,
    },
    {
        key: 'ipRanges',
        label: 'IP Ranges',
        placeholder: '10.0. 0.0 – 10.255. 255.255.',
        description:
            'Request from these IP ranges will always be routed via remote authentication. Requests from IP adresses outside these range will be routed to the normal sign in form.',
        type: 'text',
        component: RenderField,
    },
];

class Component extends Component<ComponentProps> {
    state = {
        copied: false,
    };

    handleCopyToClipboard = (text: $TSFixMe) => {
        copyToClipboard(text);

        this.setState({ copied: true });
        // reset it after 0.5 secs
        setTimeout(() => {
            return this.setState({ copied: false });
        }, 500);
    };
    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyboard);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyboard);
    }

    handleKeyboard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeThisDialog();
            default:
                return false;
        }
    };

    submitForm = async (data: $TSFixMe) => {
        const { closeThisDialog }: $TSFixMe = this.props;
        const { _id: id } = data;

        await this.props.onSubmit({ id, data });

        await this.props.fetchSsos();

        await this.props.fetchSsoDefaultRoles();
        closeThisDialog();
    };

    override render() {
        const {
            handleSubmit,

            closeThisDialog,

            sso,

            formTitle,

            updatingSso,

            addingSso,
        } = this.props;
        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex="-1"
                    style={{ marginTop: '40px' }}
                >
                    <div className="bs-Modal-header">
                        <div
                            className="bs-Modal-header-copy"
                            style={{
                                marginBottom: '10px',
                                marginTop: '10px',
                            }}
                        >
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                <span>{formTitle}</span>
                            </span>
                        </div>
                    </div>
                    <form
                        id="sso-form"
                        onSubmit={handleSubmit(this.submitForm)}
                    >
                        <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                    <fieldset className="bs-Fieldset">
                                        <div className="bs-Fieldset-rows">
                                            {fields.map(field => {
                                                if (field.value) {
                                                    return (
                                                        <div
                                                            key={field.key}
                                                            className="bs-Fieldset-row"
                                                        >
                                                            <label
                                                                className="bs-Fieldset-label"
                                                                style={{
                                                                    paddingTop: 0,
                                                                }}
                                                            >
                                                                {field.label}
                                                            </label>
                                                            <div
                                                                className="bs-Fieldset-fields"
                                                                style={{
                                                                    paddingTop: 3,
                                                                }}
                                                            >
                                                                <div
                                                                    style={{
                                                                        display:
                                                                            'flex',
                                                                    }}
                                                                >
                                                                    <div>
                                                                        {
                                                                            field.value
                                                                        }
                                                                    </div>
                                                                    <div
                                                                        id={`copycallbackurl`}
                                                                        title="copy url"
                                                                        style={{
                                                                            marginLeft: 10,
                                                                            height: 20,
                                                                            width: 20,
                                                                            backgroundImage: `url(${field.copyIcon})`,
                                                                            backgroundPosition:
                                                                                'no-repeat',
                                                                            backgroundSize:
                                                                                'contain',
                                                                            cursor: 'pointer',
                                                                        }}
                                                                        onClick={() => {
                                                                            return this.handleCopyToClipboard(
                                                                                field.value
                                                                            );
                                                                        }}
                                                                        disabled={
                                                                            this
                                                                                .state
                                                                                .copied
                                                                        }
                                                                    ></div>
                                                                </div>
                                                                <span
                                                                    style={{
                                                                        marginTop:
                                                                            '5px',
                                                                    }}
                                                                >
                                                                    {
                                                                        field.description
                                                                    }
                                                                </span>
                                                            </div>
                                                        </div>
                                                    );
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
                                                                    sso &&
                                                                    sso.requesting
                                                                }
                                                                style={{
                                                                    width: '350px',
                                                                }}
                                                                autoFocus={
                                                                    field.key ===
                                                                    'domain'
                                                                        ? true
                                                                        : false
                                                                }
                                                            />
                                                            <span
                                                                style={{
                                                                    marginTop:
                                                                        '10px',
                                                                }}
                                                            >
                                                                {
                                                                    field.description
                                                                }
                                                            </span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </fieldset>
                                </div>
                            </div>
                        </div>

                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                            <span className="db-SettingsForm-footerMessage"></span>
                            <div style={{ display: 'flex' }}>
                                <button
                                    className="bs-Button bs-DeprecatedButton btn__modal"
                                    type="button"
                                    onClick={closeThisDialog}
                                >
                                    <span>Cancel</span>
                                    <span className="cancel-btn__keycode">
                                        Esc
                                    </span>
                                </button>
                                <button
                                    id="save-button"
                                    className="bs-Button bs-Button--blue btn__modal"
                                    disabled={updatingSso || addingSso}
                                    type="submit"
                                    autoFocus={formTitle === 'Update SSO'}
                                >
                                    <span>Save</span>
                                    <span className="create-btn__keycode">
                                        <span className="keycode__icon keycode__icon--enter" />
                                    </span>
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        );
    }
}

Component.displayName = 'SsoModal';

Component.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    // eslint-disable-next-line react/no-unused-prop-types
    addSso: PropTypes.func.isRequired,
    fetchSsos: PropTypes.func.isRequired,
    fetchSsoDefaultRoles: PropTypes.func.isRequired,
    // eslint-disable-next-line react/no-unused-prop-types
    initialValues: PropTypes.object,
    closeThisDialog: PropTypes.func.isRequired,
    onSubmit: PropTypes.func.isRequired,
    formTitle: PropTypes.string.isRequired,
    sso: PropTypes.object,
    addingSso: PropTypes.bool,
    updatingSso: PropTypes.bool,
};

const ReduxFormComponent: $TSFixMe = reduxForm({
    form: 'sso-form',
    enableReinitialize: true,
    validate,
})(Component);

export const SsoAddModal: $TSFixMe = connect(
    state => {
        return {
            formTitle: 'Create SSO',

            addingSso: state.sso.addSso.requesting,
        };
    },
    dispatch => {
        return bindActionCreators(
            {
                onSubmit: addSso,
                fetchSsos,
                fetchSsoDefaultRoles,
            },
            dispatch
        );
    }
)(ReduxFormComponent);

export const SsoUpdateModal: $TSFixMe = connect(
    state => {
        return {
            formTitle: 'Update SSO',

            sso: state.sso.sso,

            initialValues: state.sso.sso.sso,

            updatingSso: state.sso.updateSso.requesting,
        };
    },
    dispatch => {
        return bindActionCreators(
            {
                onSubmit: updateSso,
                fetchSsos,
                fetchSsoDefaultRoles,
            },
            dispatch
        );
    }
)(ReduxFormComponent);
