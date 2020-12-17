import React, { Component } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { reduxForm, Field } from 'redux-form';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import {
    setEmailIncidentNotification,
    setSmsIncidentNotification,
} from '../../actions/project';
import { RenderField } from '../basic/RenderField';
import { Validate } from '../../config';

const validate = values => {
    const errors = {};
    if (values.replyAddress) {
        if (!Validate.email(values.replyAddress)) {
            errors.replyAddress = 'Please input valid email.';
        }
    }
    return errors;
};

class AdvancedIncidentNotification extends Component {
    state = {
        showMoreOptions: false,
    };

    showMoreOptionsToggle = () =>
        this.setState(prevState => ({
            showMoreOptions: !prevState.showMoreOptions,
        }));

    submitForm = values => {
        const {
            type,
            setSmsIncidentNotification,
            setEmailIncidentNotification,
            projectId,
        } = this.props;

        if (type === 'email') {
            setEmailIncidentNotification({ projectId, data: values });
        } else {
            setSmsIncidentNotification({ projectId, data: values });
        }
    };

    render() {
        const {
            type,
            requestingEmailIncident,
            requestingSmsIncident,
        } = this.props;
        const { showMoreOptions } = this.state;

        return (
            <div
                className="db-World-contentPane Box-root Margin-vertical--12"
                style={{ paddingTop: 0 }}
            >
                <div className="db-RadarRulesLists-page">
                    <div className="bs-ContentSection Card-root Card-shadow--medium">
                        <div className="Box-root">
                            <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                                <div className="Box-root">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>Advanced Options</span>
                                    </span>
                                    <p>
                                        <span>
                                            Choose incident notification to send
                                            subscribers via {type}
                                        </span>
                                    </p>
                                </div>
                                <ShouldRender if={type === 'email'}>
                                    <div
                                        className="bs-Fieldset-row"
                                        style={{
                                            padding: 0,
                                            display: 'flex',
                                            alignItems: 'center',
                                        }}
                                    >
                                        <label style={{ marginRight: 10 }}>
                                            Show more advanced options
                                        </label>
                                        <div>
                                            <label className="Toggler-wrap">
                                                <input
                                                    className="btn-toggler"
                                                    type="checkbox"
                                                    onChange={() =>
                                                        this.showMoreOptionsToggle()
                                                    }
                                                    name="moreAdvancedOptions"
                                                    id="moreAdvancedOptions"
                                                    checked={showMoreOptions}
                                                />
                                                <span className="TogglerBtn-slider round"></span>
                                            </label>
                                        </div>
                                    </div>
                                </ShouldRender>
                            </div>
                            <form
                                onSubmit={this.props.handleSubmit(
                                    this.submitForm
                                )}
                            >
                                <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                                    <div>
                                        <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                            <div className="bs-Fieldset-row">
                                                <label
                                                    className="bs-Fieldset-label"
                                                    style={{
                                                        flex: '30% 0 0',
                                                    }}
                                                >
                                                    <span></span>
                                                </label>
                                                <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                    <div
                                                        className="Box-root"
                                                        style={{
                                                            height: '5px',
                                                        }}
                                                    ></div>
                                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                        <label className="Checkbox">
                                                            <Field
                                                                component="input"
                                                                type="checkbox"
                                                                name={
                                                                    type ===
                                                                    'email'
                                                                        ? 'sendCreatedIncidentNotificationEmail'
                                                                        : 'sendCreatedIncidentNotificationSms'
                                                                }
                                                                className="Checkbox-source"
                                                                id="createdIncidentNotification"
                                                            />
                                                            <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                <div className="Checkbox-target Box-root">
                                                                    <div className="Checkbox-color Box-root"></div>
                                                                </div>
                                                            </div>
                                                            <div
                                                                className="Box-root"
                                                                style={{
                                                                    paddingLeft:
                                                                        '5px',
                                                                }}
                                                            >
                                                                <span>
                                                                    Enable
                                                                    Create
                                                                    Incident{' '}
                                                                    {type ===
                                                                    'sms'
                                                                        ? 'SMS'
                                                                        : 'Email'}{' '}
                                                                    for
                                                                    Subscribers
                                                                </span>
                                                            </div>
                                                        </label>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label
                                                    className="bs-Fieldset-label"
                                                    style={{
                                                        flex: '30% 0 0',
                                                    }}
                                                >
                                                    <span></span>
                                                </label>
                                                <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                    <div
                                                        className="Box-root"
                                                        style={{
                                                            height: '5px',
                                                        }}
                                                    ></div>
                                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                        <label className="Checkbox">
                                                            <Field
                                                                component="input"
                                                                type="checkbox"
                                                                name={
                                                                    type ===
                                                                    'email'
                                                                        ? 'sendAcknowledgedIncidentNotificationEmail'
                                                                        : 'sendAcknowledgedIncidentNotificationSms'
                                                                }
                                                                className="Checkbox-source"
                                                                id="acknowledgedIncidentNotification"
                                                            />
                                                            <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                <div className="Checkbox-target Box-root">
                                                                    <div className="Checkbox-color Box-root"></div>
                                                                </div>
                                                            </div>
                                                            <div
                                                                className="Box-root"
                                                                style={{
                                                                    paddingLeft:
                                                                        '5px',
                                                                }}
                                                            >
                                                                <span>
                                                                    Enable
                                                                    Acknowledge
                                                                    Incident{' '}
                                                                    {type ===
                                                                    'sms'
                                                                        ? 'SMS'
                                                                        : 'Email'}{' '}
                                                                    for
                                                                    Subscribers
                                                                </span>
                                                            </div>
                                                        </label>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label
                                                    className="bs-Fieldset-label"
                                                    style={{
                                                        flex: '30% 0 0',
                                                    }}
                                                >
                                                    <span></span>
                                                </label>
                                                <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                    <div
                                                        className="Box-root"
                                                        style={{
                                                            height: '5px',
                                                        }}
                                                    ></div>
                                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                        <label className="Checkbox">
                                                            <Field
                                                                component="input"
                                                                type="checkbox"
                                                                name={
                                                                    type ===
                                                                    'email'
                                                                        ? 'sendResolvedIncidentNotificationEmail'
                                                                        : 'sendResolvedIncidentNotificationSms'
                                                                }
                                                                className="Checkbox-source"
                                                                id="resolvedIncidentNotification"
                                                            />
                                                            <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                <div className="Checkbox-target Box-root">
                                                                    <div className="Checkbox-color Box-root"></div>
                                                                </div>
                                                            </div>
                                                            <div
                                                                className="Box-root"
                                                                style={{
                                                                    paddingLeft:
                                                                        '5px',
                                                                }}
                                                            >
                                                                <span>
                                                                    Enable
                                                                    Resolve
                                                                    Incident{' '}
                                                                    {type ===
                                                                    'sms'
                                                                        ? 'SMS'
                                                                        : 'Email'}{' '}
                                                                    for
                                                                    Subscribers
                                                                </span>
                                                            </div>
                                                        </label>
                                                    </div>
                                                </div>
                                            </div>

                                            {type === 'sms' && (
                                                <div className="bs-Fieldset-row">
                                                    <label
                                                        className="bs-Fieldset-label"
                                                        style={{
                                                            flex: '30% 0 0',
                                                        }}
                                                    >
                                                        <span></span>
                                                    </label>
                                                    <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                        <div
                                                            className="Box-root"
                                                            style={{
                                                                height: '5px',
                                                            }}
                                                        ></div>
                                                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                            <label className="Checkbox">
                                                                <Field
                                                                    component="input"
                                                                    type="checkbox"
                                                                    name={
                                                                        'enableInvestigationNoteNotificationSMS'
                                                                    }
                                                                    className="Checkbox-source"
                                                                    id="enableInvestigationNoteNotificationSMS"
                                                                />
                                                                <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                    <div className="Checkbox-target Box-root">
                                                                        <div className="Checkbox-color Box-root"></div>
                                                                    </div>
                                                                </div>
                                                                <div
                                                                    className="Box-root"
                                                                    style={{
                                                                        paddingLeft:
                                                                            '5px',
                                                                    }}
                                                                >
                                                                    <span>
                                                                        Enable
                                                                        Investigation
                                                                        Note SMS
                                                                        for
                                                                        Subscribers
                                                                    </span>
                                                                </div>
                                                            </label>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            {showMoreOptions &&
                                                type === 'email' && (
                                                    <>
                                                        <div className="bs-Fieldset-row">
                                                            <label className="bs-Fieldset-label"></label>
                                                            <div className="bs-Fieldset-fields">
                                                                <div
                                                                    className="Box-root"
                                                                    style={{
                                                                        fontWeight: 500,
                                                                    }}
                                                                >
                                                                    <span>
                                                                        More
                                                                        Advanced
                                                                        Options
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="bs-Fieldset-row">
                                                            <label className="bs-Fieldset-label">
                                                                Reply Address
                                                            </label>
                                                            <div className="bs-Fieldset-fields">
                                                                <Field
                                                                    className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                    component={
                                                                        RenderField
                                                                    }
                                                                    type="text"
                                                                    name="replyAddress"
                                                                    id="replyAddress"
                                                                    placeholder="email@mycompany.com"
                                                                    disabled={
                                                                        false
                                                                    }
                                                                />
                                                                <p className="bs-Fieldset-explanation">
                                                                    <span>
                                                                        Optional
                                                                        Email
                                                                        address
                                                                        where
                                                                        email
                                                                        replies
                                                                        will be
                                                                        sent to.
                                                                    </span>
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </>
                                                )}
                                            <div className="bs-Fieldset-row">
                                                <label
                                                    className="bs-Fieldset-label"
                                                    style={{
                                                        flex: '30% 0 0',
                                                    }}
                                                >
                                                    <span></span>
                                                </label>
                                                <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                    <div
                                                        className="Box-root"
                                                        style={{
                                                            height: '5px',
                                                        }}
                                                    ></div>
                                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                        <label className="Checkbox">
                                                            <div
                                                                className="Box-root"
                                                                style={{
                                                                    paddingLeft:
                                                                        '5px',
                                                                }}
                                                            >
                                                                <label></label>
                                                            </div>
                                                        </label>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                                    <span className="db-SettingsForm-footerMessage"></span>
                                    <div>
                                        <button
                                            id="saveIncidentNotification"
                                            className="bs-Button bs-Button--blue"
                                            disabled={
                                                requestingEmailIncident ||
                                                requestingSmsIncident
                                            }
                                            type="submit"
                                        >
                                            <ShouldRender
                                                if={
                                                    !requestingEmailIncident &&
                                                    !requestingSmsIncident
                                                }
                                            >
                                                <span>Save</span>
                                            </ShouldRender>
                                            <ShouldRender
                                                if={
                                                    requestingEmailIncident ||
                                                    requestingSmsIncident
                                                }
                                            >
                                                <FormLoader />
                                            </ShouldRender>
                                        </button>
                                    </div>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

AdvancedIncidentNotification.displayName = 'AdvancedIncidentNotification';

AdvancedIncidentNotification.propTypes = {
    type: PropTypes.string.isRequired,
    setEmailIncidentNotification: PropTypes.func,
    setSmsIncidentNotification: PropTypes.func,
    handleSubmit: PropTypes.func,
    requestingEmailIncident: PropTypes.bool,
    requestingSmsIncident: PropTypes.bool,
    projectId: PropTypes.string,
};

const IncidentNotificationForm = reduxForm({
    form: 'IncidentNotificationForm',
    enableReinitialize: true,
    destroyOnUnmount: false, // do not destroy the form state
    validate,
})(AdvancedIncidentNotification);

const mapStateToProps = (state, ownProps) => {
    const { type } = ownProps;

    let initialValues = {};
    if (type === 'sms') {
        initialValues = {
            sendCreatedIncidentNotificationSms:
                state.project.currentProject &&
                state.project.currentProject.sendCreatedIncidentNotificationSms,
            sendAcknowledgedIncidentNotificationSms:
                state.project.currentProject &&
                state.project.currentProject
                    .sendAcknowledgedIncidentNotificationSms,
            sendResolvedIncidentNotificationSms:
                state.project.currentProject &&
                state.project.currentProject
                    .sendResolvedIncidentNotificationSms,
            enableInvestigationNoteNotificationSMS:
                state.project.currentProject &&
                state.project.currentProject
                    .enableInvestigationNoteNotificationSMS,
        };
    } else {
        initialValues = {
            sendCreatedIncidentNotificationEmail:
                state.project.currentProject &&
                state.project.currentProject
                    .sendCreatedIncidentNotificationEmail,
            sendAcknowledgedIncidentNotificationEmail:
                state.project.currentProject &&
                state.project.currentProject
                    .sendAcknowledgedIncidentNotificationEmail,
            sendResolvedIncidentNotificationEmail:
                state.project.currentProject &&
                state.project.currentProject
                    .sendResolvedIncidentNotificationEmail,
            replyAddress:
                state.project.currentProject &&
                state.project.currentProject.replyAddress,
        };
    }

    return {
        requestingEmailIncident:
            state.project.emailIncidentNotification.requesting,
        errorEmailIncident: state.project.emailIncidentNotification.error,
        requestingSmsIncident: state.project.smsIncidentNotification.requesting,
        errorSmsIncident: state.project.smsIncidentNotification.error,
        initialValues,
        projectId:
            state.project.currentProject && state.project.currentProject._id,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        { setEmailIncidentNotification, setSmsIncidentNotification },
        dispatch
    );

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(IncidentNotificationForm);
