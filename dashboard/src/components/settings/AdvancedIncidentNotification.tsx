import React, { Component } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';

import { reduxForm, Field } from 'redux-form';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import {
    setEmailNotification,
    setSmsNotification,
    setWebhookNotificationSettings,
} from '../../actions/project';
import { RenderField } from '../basic/RenderField';
import { Validate } from '../../config';
import Checkbox from '../../components/Checkbox';
import CheckboxHeader from './CheckboxHeader';

const validate = (values: $TSFixMe) => {
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

    submitForm = (values: $TSFixMe) => {
        const {

            type,

            setSmsNotification,

            setEmailNotification,

            setWebhookNotificationSettings,

            projectId,
        } = this.props;

        if (type === 'email') {
            setEmailNotification({ projectId, data: values });
        } else if (type === 'sms') {
            setSmsNotification({ projectId, data: values });
        } else if (type === 'webhook') {
            setWebhookNotificationSettings({ projectId, data: values });
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
                                    <ShouldRender
                                        if={type === 'sms' || type === 'email'}
                                    >
                                        <div>
                                            <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                                <CheckboxHeader text="Incident" />

                                                <Checkbox
                                                    name={
                                                        type === 'email'
                                                            ? 'sendCreatedIncidentNotificationEmail'
                                                            : 'sendCreatedIncidentNotificationSms'
                                                    }
                                                    text={`Enable Create Incident
                                                        ${type === 'sms'
                                                            ? 'SMS'
                                                            : 'Email'
                                                        }
                                                        for Subscribers`}
                                                />

                                                <Checkbox
                                                    name={
                                                        type === 'email'
                                                            ? 'sendAcknowledgedIncidentNotificationEmail'
                                                            : 'sendAcknowledgedIncidentNotificationSms'
                                                    }
                                                    text={`Enable Acknowledge Incident
                                                        ${type === 'sms'
                                                            ? 'SMS'
                                                            : 'Email'
                                                        }
                                                        for Subscribers`}
                                                />
                                                <Checkbox
                                                    name={
                                                        type === 'email'
                                                            ? 'sendResolvedIncidentNotificationEmail'
                                                            : 'sendResolvedIncidentNotificationSms'
                                                    }
                                                    text={`Enable Resolve Incident 
                                                        ${type === 'sms'
                                                            ? 'SMS'
                                                            : 'Email'
                                                        } for Subscribers`}
                                                />

                                                {type === 'sms' && (
                                                    <Checkbox
                                                        name="enableInvestigationNoteNotificationSMS"
                                                        text="Enable Investigation Note SMS for Subscribers"
                                                    />
                                                )}

                                                {type === 'email' && (
                                                    <Checkbox
                                                        name="enableInvestigationNoteNotificationEmail"
                                                        text="Enable Investigation Note Email for Subscribers"
                                                    />
                                                )}

                                                <CheckboxHeader text="Scheduled Event" />

                                                <Checkbox
                                                    name={
                                                        type === 'email'
                                                            ? 'sendCreatedScheduledEventNotificationEmail'
                                                            : 'sendCreatedScheduledEventNotificationSms'
                                                    }
                                                    text={`Enable Create Scheduled Maintenance Event
                                                        ${type === 'sms'
                                                            ? 'SMS'
                                                            : 'Email'
                                                        }
                                                        for Subscribers`}
                                                />

                                                <Checkbox
                                                    name={
                                                        type === 'email'
                                                            ? 'sendScheduledEventResolvedNotificationEmail'
                                                            : 'sendScheduledEventResolvedNotificationSms'
                                                    }
                                                    text={`Enable Scheduled Maintenance Event Resolved
                                                        ${type === 'sms'
                                                            ? 'SMS'
                                                            : 'Email'
                                                        }
                                                        for Subscribers`}
                                                />

                                                <Checkbox
                                                    name={
                                                        type === 'email'
                                                            ? 'sendNewScheduledEventInvestigationNoteNotificationEmail'
                                                            : 'sendNewScheduledEventInvestigationNoteNotificationSms'
                                                    }
                                                    text={`Enable Scheduled Maintenance Event Note Added
                                                        ${type === 'sms'
                                                            ? 'SMS'
                                                            : 'Email'
                                                        }
                                                        for Subscribers`}
                                                />

                                                <Checkbox
                                                    name={
                                                        type === 'email'
                                                            ? 'sendScheduledEventCancelledNotificationEmail'
                                                            : 'sendScheduledEventCancelledNotificationSms'
                                                    }
                                                    text={`Enable Scheduled Maintenance Event Cancelled
                                                        ${type === 'sms'
                                                            ? 'SMS'
                                                            : 'Email'
                                                        }
                                                        for Subscribers`}
                                                />

                                                <CheckboxHeader text="Announcement" />
                                                <Checkbox
                                                    name={
                                                        type === 'email'
                                                            ? 'sendAnnouncementNotificationEmail'
                                                            : 'sendAnnouncementNotificationSms'
                                                    }
                                                    text={`Enable Announcement Notification
                                                        ${type === 'sms'
                                                            ? 'SMS'
                                                            : 'Email'
                                                        }
                                                        for Subscribers`}
                                                />

                                                {showMoreOptions &&
                                                    type === 'email' && (
                                                        <>
                                                            <CheckboxHeader text="More Advanced Options" />
                                                            <div className="bs-Fieldset-row">
                                                                <label className="bs-Fieldset-label">
                                                                    Reply
                                                                    Address
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
                                                                            will
                                                                            be
                                                                            sent
                                                                            to.
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
                                    </ShouldRender>
                                    <ShouldRender if={type === 'webhook'}>
                                        <Checkbox
                                            name="enableInvestigationNoteNotificationWebhook"
                                            text="Enable Investigation Note Webhook for Subscribers"
                                        />
                                    </ShouldRender>
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
    setEmailNotification: PropTypes.func,
    setSmsNotification: PropTypes.func,
    handleSubmit: PropTypes.func,
    requestingEmailIncident: PropTypes.bool,
    requestingSmsIncident: PropTypes.bool,
    projectId: PropTypes.string,
    setWebhookNotificationSettings: PropTypes.func,
};

const IncidentNotificationForm = reduxForm({
    form: 'IncidentNotificationForm',
    enableReinitialize: true,
    destroyOnUnmount: false, // do not destroy the form state
    validate,
})(AdvancedIncidentNotification);

const mapStateToProps = (state: $TSFixMe, ownProps: $TSFixMe) => {
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

            sendCreatedScheduledEventNotificationSms:
                state.project.currentProject &&
                state.project.currentProject
                    .sendCreatedScheduledEventNotificationSms,
            sendScheduledEventResolvedNotificationSms:
                state.project.currentProject &&
                state.project.currentProject
                    .sendScheduledEventResolvedNotificationSms,
            sendNewScheduledEventInvestigationNoteNotificationSms:
                state.project.currentProject &&
                state.project.currentProject
                    .sendNewScheduledEventInvestigationNoteNotificationSms,

            sendScheduledEventCancelledNotificationSms:
                state.project.currentProject &&
                state.project.currentProject
                    .sendScheduledEventCancelledNotificationSms,

            sendAnnouncementNotificationSms:
                state.project.currentProject &&
                state.project.currentProject.sendAnnouncementNotificationSms,
        };
    } else if (type === 'email') {
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
            enableInvestigationNoteNotificationEmail:
                state.project.currentProject &&
                state.project.currentProject
                    .enableInvestigationNoteNotificationEmail,

            sendCreatedScheduledEventNotificationEmail:
                state.project.currentProject &&
                state.project.currentProject
                    .sendCreatedScheduledEventNotificationEmail,
            sendScheduledEventResolvedNotificationEmail:
                state.project.currentProject &&
                state.project.currentProject
                    .sendScheduledEventResolvedNotificationEmail,
            sendNewScheduledEventInvestigationNoteNotificationEmail:
                state.project.currentProject &&
                state.project.currentProject
                    .sendNewScheduledEventInvestigationNoteNotificationEmail,
            sendScheduledEventCancelledNotificationEmail:
                state.project.currentProject &&
                state.project.currentProject
                    .sendScheduledEventCancelledNotificationEmail,

            sendAnnouncementNotificationEmail:
                state.project.currentProject &&
                state.project.currentProject.sendAnnouncementNotificationEmail,

            replyAddress:
                state.project.currentProject &&
                state.project.currentProject.replyAddress,
        };
    } else if (type === 'webhook') {
        initialValues = {
            enableInvestigationNoteNotificationWebhook:
                state.project.currentProject &&
                state.project.currentProject
                    .enableInvestigationNoteNotificationWebhook,
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

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        setEmailNotification,
        setSmsNotification,
        setWebhookNotificationSettings,
    },
    dispatch
);

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(IncidentNotificationForm);
