import React from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { RenderField } from '../../basic/RenderField';
import { Validate } from '../../../config';
import { reduxForm, Field } from 'redux-form';
import { addSso } from '../../../actions/sso';

// Client side validation
function validate(values) {
    const errors = {};

    if (!Validate.text(values.samlSsoUrl)) {
        errors.samlSsoUrl = 'SSO URL is not valid.';
    }

    if (!Validate.text(values.certificateFingerprint)) {
        errors.certificateFingerprint = 'Certificate Fingerprint is not valid.';
    }

    if (!Validate.text(values.remoteLogoutUrl)) {
        errors.remoteLogoutUrl = 'Remote logout URL is not valid.';
    }

    if (!Validate.text(values.ipRanges)) {
        errors.ipRanges = 'Ip range is not valid.';
    }

    return errors;
}

const fields = [
    {
        key: 'saml-enabled',
        label: 'Enable SAML',
        description:
            'SAML is an industry standard SSO framework typically used by large enterprises for communicating identities across the internet.',
        // eslint-disable-next-line react/display-name, react/prop-types
        component: ({ input: { value, onChange } }) => (
            <label className="Toggler-wrap">
                <input
                    className="btn-toggler"
                    checked={value}
                    onChange={onChange}
                    type="checkbox"
                    name="saml-enabled"
                    id="saml-enabled"
                />
                <span className="TogglerBtn-slider round"></span>
            </label>
        ),
    },
    {
        key: 'samlSsoUrl',
        label: 'SAML SSO URL',
        placeholder:
            'https://login.microsoftonline.com/a4e1d-1s4f-965f-ert452136',
        description:
            'This is the Url that fyipe will invoke to redirect users to your identity provider.',
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
            'This is the Url that fyipe will direct your users to after they sign out.',
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

class Component extends React.Component {
    submitForm = values => {
        this.props.addSso(values)
    };

    render() {
        const { handleSubmit, closeThisDialog } = this.props;
        return (
            <div
                onKeyDown={e => e.key === 'Escape' && closeThisDialog()}
                className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center"
            >

                <div
                    className="ModalLayer-contents"
                    tabIndex="-1"
                    style={{ marginTop: '40px' }}
                >

                    <form
                        id="sso-form"
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
                                                            style={{
                                                                width: '350px',
                                                            }}
                                                        />
                                                        <span
                                                            style={{
                                                                marginTop:
                                                                    '10px',
                                                            }}
                                                        >
                                                            {field.description}
                                                        </span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </fieldset>
                                </div>
                            </div>
                        </div>

                        <div
                            className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                            <span className="db-SettingsForm-footerMessage">
                            </span>
                            <div>
                                <button
                                    className="bs-Button bs-Button--blue"
                                    type="submit"
                                >
                                    <span>Add</span>
                                </button>
                                <button
                                    className="bs-Button bs-Button--red"
                                    type="button"
                                    onClick={closeThisDialog}
                                >
                                    <span>Cancel</span>
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        )

    }

}

Component.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    addSso: PropTypes.func.isRequired,
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            addSso,
        },
        dispatch
    );
};

const ReduxFormComponent = reduxForm({
    form: 'sso-form',
    enableReinitialize: true,
    validate,
})(Component);

export default connect(null, mapDispatchToProps)(ReduxFormComponent);