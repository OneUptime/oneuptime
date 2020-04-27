import React from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { reduxForm, Field } from 'redux-form';
import { RenderField } from '../basic/RenderField';
import { Validate } from '../../config';
import { FormLoader } from '../basic/Loader';
import PropTypes from 'prop-types';
import { fetchSettings, saveSettings } from '../../actions/settings';
import { fetchSsos } from '../../actions/sso';
import moment from 'moment';

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

const settingsType = 'sso';

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

export class Component extends React.Component {
    async componentDidMount() {
        await this.props.fetchSettings(settingsType);
        await this.props.fetchSsos()
    }

    submitForm = values => {
        this.props.saveSettings(settingsType, values);
    };

    render() {
        const { settings, handleSubmit, ssos } = this.props;
        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <div className="Flex-flex Flex-alignItems-center Flex-justifyContent--spaceBetween">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Single sign-on (SSO)</span>
                                </span>
                            </div>
                            <p>
                                <span>
                                    Admins and agents use your SSO service to
                                    sign in to Fyipe. Requires configuration.
                                </span>
                            </p>
                        </div>
                    </div>
                    <div style={{ overflow: "auto hidden" }}>
                        <table className="Table">
                            <thead className="Table-body">
                                <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                                    <td
                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                        style={{ height: "1px", minWidth: "270px" }}>
                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span
                                            className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>
                                                domain
                                            </span>
                                        </span>
                                        </div>
                                    </td>
                                    <td id="placeholder-left"
                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                                        style={{ height: "1px", maxWidth: "48px", minWidth: "48px", width: "48px" }}>
                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                            <span
                                                className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            </span>
                                        </div>
                                    </td>
                                    <td
                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                        style={{ height: "1px" }}>
                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                            <span
                                                className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                <span>
                                                    actions
                                                 </span>
                                            </span>
                                        </div>
                                    </td>
                                    <td id="placeholder-right"
                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                                        style={{ height: "1px", maxWidth: "48px", minWidth: "48px", width: "48px" }}>
                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                            <span
                                                className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            </span>
                                        </div>
                                    </td>
                                    <td
                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                        style={{ height: "1px" }}>
                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8"><span
                                            className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>
                                                Created At
                                            </span>
                                        </span>
                                        </div>
                                    </td>
                                    <td id="overflow" type="action"
                                        className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                        style={{ height: "1px" }}>
                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                            <span
                                                className="db-ListViewItem-text Text-align--right Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            </span>
                                        </div>
                                    </td>
                                </tr>
                            </thead>
                            <tbody className="Table-body">
                                {ssos.ssos.map(sso =>
                                    <tr
                                        key={sso._id}
                                        className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink"
                                    >
                                        <td
                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                            style={{ height: "1px", minWidth: "270px" }}>
                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                <span
                                                    className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                    <div className="Box-root Margin-right--16">
                                                        <span>
                                                            {sso.samlSsoUrl}
                                                        </span>
                                                    </div>
                                                </span>
                                            </div>
                                        </td>
                                        <td aria-hidden="true"
                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                                            style={{ height: "1px", maxWidth: "48px", minWidth: "48px", width: "48px" }}>
                                            <div className="db-ListViewItem-link">
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">⁣
                                            </div>
                                            </div>
                                        </td>
                                        <td
                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                            style={{ height: "1px" }}
                                        >
                                            <div className="db-ListViewItem-link">
                                                <button className="bs-Button bs-Button--blue Box-background--blue">
                                                    Edit
                                            </button>
                                                <button className="bs-Button bs-Button--red Box-background--red">
                                                    Delete
                                            </button>
                                            </div>
                                        </td>
                                        <td aria-hidden="true"
                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                                            style={{ height: "1px", maxWidth: "48px", minWidth: "48px", width: "48px" }}>
                                            <div className="db-ListViewItem-link">
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">⁣
                                           </div>
                                            </div>
                                        </td>
                                        <td
                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                            style={{ height: "1px" }}>
                                            <div className="db-ListViewItem-link">
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    {
                                                        moment(
                                                            sso.createdAt
                                                        ).fromNow()
                                                    }
                                                </div>
                                            </div>
                                        </td>
                                        <td
                                            className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell">
                                        </td>
                                    </tr>
                                )
                                }
                            </tbody>
                        </table>
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

                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                            <span className="db-SettingsForm-footerMessage"></span>
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

Component.displayName = 'SettingsForm';

/* eslint-disable */
Component.propTypes = {
    settings: PropTypes.object.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    saveSettings: PropTypes.func.isRequired,
    fetchSettings: PropTypes.func.isRequired,
    initialValues: PropTypes.object,
    ssoForm: PropTypes.object,
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            saveSettings,
            fetchSettings,
            fetchSsos,
        },
        dispatch
    );
};

function mapStateToProps(state) {
    return {
        settings: state.settings,
        initialValues: state.settings[settingsType],
        ssoForm: state.form['sso-form'],
        ssos: state.sso.ssos,
    };
}

const ReduxFormComponent = reduxForm({
    form: 'sso-form',
    enableReinitialize: true,
    validate,
})(Component);

export default connect(mapStateToProps, mapDispatchToProps)(ReduxFormComponent);
