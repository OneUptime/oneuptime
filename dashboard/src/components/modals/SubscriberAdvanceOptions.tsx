import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm, Field } from 'redux-form';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import { closeModal } from '../../actions/modal';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import { updateSubscriberOption } from '../../actions/statusPage';

class SubscriberAdvanceOption extends React.Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = (values: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusPage' does not exist on type 'Read... Remove this comment to see the full error message
        const { status } = this.props.statusPage;
        const { projectId } = status;
        this.props
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateSubscriberOption' does not exist o... Remove this comment to see the full error message
            .updateSubscriberOption(projectId._id || projectId, {
                _id: status._id,
                enableRSSFeed: values.enableRSSFeed,
                emailNotification: values.emailNotification,
                smsNotification: values.smsNotification,
                webhookNotification: values.webhookNotification,
                selectIndividualMonitors: values.selectIndividualMonitors,
                multipleNotificationTypes: values.multipleNotificationTypes,
            })
            .then(() => {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
                this.props.closeModal({
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscriberAdvanceOptionModalId' does not... Remove this comment to see the full error message
                    id: this.props.subscriberAdvanceOptionModalId,
                });
            });
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                return this.handleCloseModal();
            case 'Enter':
                // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                return document
                    .getElementById('saveSubscriberAdvanceOptionButton')
                    .click();
            default:
                return false;
        }
    };

    handleCloseModal = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
        this.props.closeModal({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscriberAdvanceOptionModalId' does not... Remove this comment to see the full error message
            id: this.props.subscriberAdvanceOptionModalId,
        });
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscriberOption' does not exist on type... Remove this comment to see the full error message
        const { requesting, error } = this.props.subscriberOption;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
        const { handleSubmit, closeModal } = this.props;

        return (
            <div
                className="ModalLayer-contents"
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM">
                    <div className="bs-Modal">
                        <ClickOutside onClickOutside={this.handleCloseModal}>
                            <div className="bs-Modal-header">
                                <div
                                    className="bs-Modal-header-copy"
                                    style={{
                                        marginBottom: '10px',
                                        marginTop: '10px',
                                    }}
                                >
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>
                                            Advanced options for subscribers
                                        </span>
                                    </span>
                                    <p>
                                        <span>
                                            Manage options for external
                                            subscribers.
                                        </span>
                                    </p>
                                </div>
                            </div>
                            <form onSubmit={handleSubmit(this.submitForm)}>
                                <div className="Padding-horizontal--12">
                                    <div className="bs-Modal-block bs-u-paddingless">
                                        <div className="bs-Modal-content">
                                            <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                                <div className="bs-Fieldset-row">
                                                    <label
                                                        className="bs-Fieldset-label"
                                                        style={{
                                                            flex: '0% 0 0',
                                                        }}
                                                    >
                                                        <span></span>
                                                    </label>
                                                    <div
                                                        className="bs-Fieldset-fields bs-Fieldset-fields--wide"
                                                        style={{
                                                            flexBasis: '100%',
                                                        }}
                                                    >
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
                                                                        'enableRSSFeed'
                                                                    }
                                                                    data-test="RetrySettings-failedPaymentsCheckbox"
                                                                    className="Checkbox-source"
                                                                    id="statuspage.enableRSSFeed"
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
                                                                    <label>
                                                                        <span>
                                                                            Enable
                                                                            RSS
                                                                            feed
                                                                            for
                                                                            incidents
                                                                        </span>
                                                                    </label>
                                                                    <p className="bs-Fieldset-explanation">
                                                                        <span>
                                                                            Enabling
                                                                            this
                                                                            will
                                                                            allow
                                                                            your
                                                                            users
                                                                            to
                                                                            download
                                                                            RSS
                                                                            feed
                                                                            for
                                                                            monitor&apos;s
                                                                            incidents.
                                                                        </span>
                                                                    </p>
                                                                </div>
                                                            </label>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="bs-Fieldset-row">
                                                    <label
                                                        className="bs-Fieldset-label"
                                                        style={{
                                                            flex: '0% 0 0',
                                                        }}
                                                    >
                                                        <span></span>
                                                    </label>
                                                    <div
                                                        className="bs-Fieldset-fields bs-Fieldset-fields--wide"
                                                        style={{
                                                            flexBasis: '100%',
                                                        }}
                                                    >
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
                                                                        'emailNotification'
                                                                    }
                                                                    data-test="RetrySettings-failedPaymentsCheckbox"
                                                                    className="Checkbox-source"
                                                                    id="statuspage.emailNotification"
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
                                                                    <label>
                                                                        <span>
                                                                            Enable
                                                                            Email
                                                                            notifications
                                                                        </span>
                                                                    </label>
                                                                    <p className="bs-Fieldset-explanation">
                                                                        <span>
                                                                            Enabling
                                                                            this
                                                                            will
                                                                            allow
                                                                            your
                                                                            users
                                                                            to
                                                                            subscribe
                                                                            to
                                                                            email
                                                                            alerts
                                                                            for
                                                                            incidents.
                                                                        </span>
                                                                    </p>
                                                                </div>
                                                            </label>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="bs-Fieldset-row">
                                                    <label
                                                        className="bs-Fieldset-label"
                                                        style={{
                                                            flex: '0% 0 0',
                                                        }}
                                                    >
                                                        <span></span>
                                                    </label>
                                                    <div
                                                        className="bs-Fieldset-fields bs-Fieldset-fields--wide"
                                                        style={{
                                                            flexBasis: '100%',
                                                        }}
                                                    >
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
                                                                        'smsNotification'
                                                                    }
                                                                    data-test="RetrySettings-failedPaymentsCheckbox"
                                                                    className="Checkbox-source"
                                                                    id="statuspage.smsNotification"
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
                                                                    <label>
                                                                        <span>
                                                                            Enable
                                                                            SMS
                                                                            notifications
                                                                        </span>
                                                                    </label>
                                                                    <p className="bs-Fieldset-explanation">
                                                                        <span>
                                                                            Enabling
                                                                            this
                                                                            will
                                                                            allow
                                                                            your
                                                                            users
                                                                            to
                                                                            subscribe
                                                                            to
                                                                            sms
                                                                            alerts
                                                                            for
                                                                            your
                                                                            incidents.
                                                                        </span>
                                                                    </p>
                                                                </div>
                                                            </label>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="bs-Fieldset-row">
                                                    <label
                                                        className="bs-Fieldset-label"
                                                        style={{
                                                            flex: '0% 0 0',
                                                        }}
                                                    >
                                                        <span></span>
                                                    </label>
                                                    <div
                                                        className="bs-Fieldset-fields bs-Fieldset-fields--wide"
                                                        style={{
                                                            flexBasis: '100%',
                                                        }}
                                                    >
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
                                                                        'webhookNotification'
                                                                    }
                                                                    data-test="RetrySettings-failedPaymentsCheckbox"
                                                                    className="Checkbox-source"
                                                                    id="statuspage.webhookNotification"
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
                                                                    <label>
                                                                        <span>
                                                                            Enable
                                                                            Webhook
                                                                            integration
                                                                        </span>
                                                                    </label>
                                                                    <p className="bs-Fieldset-explanation">
                                                                        <span>
                                                                            Enabling
                                                                            this
                                                                            will
                                                                            allow
                                                                            your
                                                                            users
                                                                            to
                                                                            add
                                                                            webhook
                                                                            integrations.
                                                                        </span>
                                                                    </p>
                                                                </div>
                                                            </label>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="bs-Fieldset-row">
                                                    <label
                                                        className="bs-Fieldset-label"
                                                        style={{
                                                            flex: '0% 0 0',
                                                        }}
                                                    >
                                                        <span></span>
                                                    </label>
                                                    <div
                                                        className="bs-Fieldset-fields bs-Fieldset-fields--wide"
                                                        style={{
                                                            flexBasis: '100%',
                                                        }}
                                                    >
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
                                                                        'selectIndividualMonitors'
                                                                    }
                                                                    data-test="RetrySettings-failedPaymentsCheckbox"
                                                                    className="Checkbox-source"
                                                                    id="statuspage_selectIndividualMonitors"
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
                                                                    <label>
                                                                        <span>
                                                                            Allow
                                                                            subscribers
                                                                            to
                                                                            connect
                                                                            to
                                                                            individual
                                                                            monitors
                                                                        </span>
                                                                    </label>
                                                                    <p className="bs-Fieldset-explanation">
                                                                        <span>
                                                                            Enabling
                                                                            this
                                                                            will
                                                                            allow
                                                                            your
                                                                            users
                                                                            to
                                                                            connect
                                                                            to
                                                                            individual
                                                                            monitors
                                                                        </span>
                                                                    </p>
                                                                </div>
                                                            </label>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="bs-Fieldset-row">
                                                    <label
                                                        className="bs-Fieldset-label"
                                                        style={{
                                                            flex: '0% 0 0',
                                                        }}
                                                    >
                                                        <span></span>
                                                    </label>
                                                    <div
                                                        className="bs-Fieldset-fields bs-Fieldset-fields--wide"
                                                        style={{
                                                            flexBasis: '100%',
                                                        }}
                                                    >
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
                                                                        'multipleNotificationTypes'
                                                                    }
                                                                    data-test="RetrySettings-failedPaymentsCheckbox"
                                                                    className="Checkbox-source"
                                                                    id="statuspage_multipleNotificationTypes"
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
                                                                    <label>
                                                                        <span>
                                                                            Allow
                                                                            subscribers
                                                                            to
                                                                            choose
                                                                            between
                                                                            Incident,
                                                                            Scheduled
                                                                            event
                                                                            and
                                                                            Announcement
                                                                            notifications
                                                                        </span>
                                                                    </label>
                                                                    <p className="bs-Fieldset-explanation">
                                                                        <span>
                                                                            Enabling
                                                                            this
                                                                            will
                                                                            allow
                                                                            your
                                                                            users
                                                                            to
                                                                            choose
                                                                            subscription
                                                                            between
                                                                            Incident,
                                                                            Scheduled
                                                                            events
                                                                            and
                                                                            Announcement
                                                                            notifications.
                                                                        </span>
                                                                    </p>
                                                                </div>
                                                            </label>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <ShouldRender if={error}>
                                            <div className="bs-Tail-copy">
                                                <div
                                                    className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                    style={{
                                                        marginTop: '10px',
                                                    }}
                                                >
                                                    <div className="Box-root Margin-right--8">
                                                        <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                    </div>
                                                    <div className="Box-root">
                                                        <span
                                                            style={{
                                                                color: 'red',
                                                            }}
                                                        >
                                                            {error}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                        <button
                                            className="bs-Button bs-DeprecatedButton btn__modal"
                                            type="button"
                                            onClick={() =>
                                                closeModal({
                                                    id: this.props
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscriberAdvanceOptionModalId' does not... Remove this comment to see the full error message
                                                        .subscriberAdvanceOptionModalId,
                                                })
                                            }
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="saveSubscriberAdvanceOptionButton"
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                            disabled={requesting}
                                            type="submit"
                                            autoFocus={true}
                                        >
                                            {!requesting && (
                                                <>
                                                    <span>Save</span>
                                                    <span className="create-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </>
                                            )}
                                            {requesting && <FormLoader />}
                                        </button>
                                    </div>
                                </div>
                            </form>
                        </ClickOutside>
                    </div>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
SubscriberAdvanceOption.displayName = 'SubscriberAdvanceOption';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
SubscriberAdvanceOption.propTypes = {
    updateSubscriberOption: PropTypes.func.isRequired,
    closeModal: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    subscriberAdvanceOptionModalId: PropTypes.string,
    requesting: PropTypes.bool,
    error: PropTypes.object,
    statusPage: PropTypes.object,
    subscriberOption: PropTypes.object,
};

const NewUpdateSchedule = reduxForm({
    form: 'SubscriberAdvanceOptionForm',
    enableReinitialize: true,
    destroyOnUnmount: true,
})(SubscriberAdvanceOption);

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        closeModal,
        updateSubscriberOption,
    },
    dispatch
);

const mapStateToProps = (state: $TSFixMe) => {
    const initialValues = {};
    const {
        statusPage,
        statusPage: { status },
    } = state;
    const { subscriberOption } = state.statusPage;
    const subscriberAdvanceOptionModalId = state.modal.modals[0].id;

    // @ts-expect-error ts-migrate(2339) FIXME: Property 'enableRSSFeed' does not exist on type '{... Remove this comment to see the full error message
    initialValues.enableRSSFeed = status.enableRSSFeed;
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'emailNotification' does not exist on typ... Remove this comment to see the full error message
    initialValues.emailNotification = status.emailNotification;
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'smsNotification' does not exist on type ... Remove this comment to see the full error message
    initialValues.smsNotification = status.smsNotification;
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'webhookNotification' does not exist on t... Remove this comment to see the full error message
    initialValues.webhookNotification = status.webhookNotification;
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'selectIndividualMonitors' does not exist... Remove this comment to see the full error message
    initialValues.selectIndividualMonitors = status.selectIndividualMonitors;
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'multipleNotificationTypes' does not exis... Remove this comment to see the full error message
    initialValues.multipleNotificationTypes = status.multipleNotificationTypes;

    return {
        initialValues,
        subscriberOption,
        statusPage,
        subscriberAdvanceOptionModalId,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(NewUpdateSchedule);
