import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { Field, reduxForm, formValueSelector } from 'redux-form';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import {
    createSubscriberRequest,
    createSubscriberError,
    createSubscriberSuccess,
    createSubscriber,
} from '../../actions/subscriber';
import { Validate } from '../../config';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { RenderField } from '../basic/RenderField';
import { RenderSelect } from '../basic/RenderSelect';
import { fetchMonitorsSubscribers } from '../../actions/monitor';
import countryCodes from '../../utils/countryCodes';
import { fetchStatusPageSubscribers } from '../../actions/statusPage';

function validate(values: $TSFixMe) {
    const errors = {};

    if (!Validate.text(values.monitorId)) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type '{}'.
        errors.monitorId = 'Please select a monitor.';
    }
    if (!Validate.text(values.alertVia)) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'alertVia' does not exist on type '{}'.
        errors.alertVia = 'Please select a subscribe method.';
    } else {
        if (values.alertVia === 'sms') {
            if (!Validate.text(values.countryCode)) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'countryCode' does not exist on type '{}'... Remove this comment to see the full error message
                errors.countryCode = 'Please select a country code.';
            }
            if (!Validate.text(values.contactPhone)) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'contactPhone' does not exist on type '{}... Remove this comment to see the full error message
                errors.contactPhone = 'Please enter a contact number.';
            }
        }
        if (values.alertVia === 'email') {
            if (!Validate.text(values.email)) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type '{}'.
                errors.email = 'Please enter an email address.';
            } else {
                if (!Validate.email(values.email)) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type '{}'.
                    errors.email = 'Please enter a valid email address.';
                }
            }
        }
        if (values.alertVia === 'webhook') {
            if (!Validate.text(values.endpoint)) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'endpoint' does not exist on type '{}'.
                errors.endpoint = 'Please enter an endpoint url.';
            } else {
                if (!Validate.url(values.endpoint)) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'endpoint' does not exist on type '{}'.
                    errors.endpoint = 'Please enter a valid url.';
                }
            }
            if (!Validate.text(values.email)) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type '{}'.
                errors.email = 'Please enter an email address.';
            } else {
                if (!Validate.email(values.email)) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type '{}'.
                    errors.email = 'Please enter a valid email address.';
                }
            }
            if (
                !Validate.text(values.webhookMethod) ||
                !['get', 'post'].includes(values.webhookMethod)
            ) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'webhookMethod' does not exist on type '{... Remove this comment to see the full error message
                errors.webhookMethod = 'Please choose an http method';
            }
        }
    }

    return errors;
}

const selector = formValueSelector('CreateSubscriber');

class CreateSubscriber extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'createSubscriberError' does not exist on... Remove this comment to see the full error message
        this.props.createSubscriberError('');
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = (values: $TSFixMe) => {
        values.contactEmail = values.email;
        values.contactWebhook = values.endpoint;
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createSubscriber' does not exist on type... Remove this comment to see the full error message
            createSubscriber,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
            closeThisDialog,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            data,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchMonitorsSubscribers' does not exist... Remove this comment to see the full error message
            fetchMonitorsSubscribers,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchStatusPageSubscribers' does not exi... Remove this comment to see the full error message
            fetchStatusPageSubscribers,
        } = this.props;
        const { monitorId, subProjectId, statusPage, limit } = data;
        createSubscriber(
            subProjectId,
            monitorId || values.monitorId,
            values
        ).then(
            function() {
                statusPage
                    ? fetchStatusPageSubscribers(
                          subProjectId,
                          statusPage._id,
                          0,
                          limit
                      )
                    : fetchMonitorsSubscribers(subProjectId, monitorId, 0, 5);
                closeThisDialog();
            },
            function() {
                //do nothing.
            }
        );
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
                return this.props.closeThisDialog();
            case 'Enter':
                // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                return document.getElementById('createSubscriber').click();
            default:
                return false;
        }
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
            handleSubmit,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
            closeThisDialog,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            data,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'mergeMonitors' does not exist on type 'R... Remove this comment to see the full error message
            mergeMonitors,
        } = this.props;

        return (
            <div
                className="ModalLayer-contents"
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM">
                    <div className="bs-Modal bs-Modal--medium">
                        <ClickOutside onClickOutside={closeThisDialog}>
                            <div className="bs-Modal-header">
                                <div
                                    className="bs-Modal-header-copy"
                                    style={{
                                        marginBottom: '10px',
                                        marginTop: '10px',
                                    }}
                                >
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>Add New Subscriber</span>
                                    </span>
                                </div>
                            </div>
                            <form onSubmit={handleSubmit(this.submitForm)}>
                                <div className="bs-Modal-content bs-u-paddingless">
                                    <div className="bs-Modal-block bs-u-paddingless">
                                        <div className="bs-Modal-content">
                                            <span className="bs-Fieldset">
                                                <div className="bs-Fieldset-row bs-type-status">
                                                    <label className="bs-Fieldset-label">
                                                        Alert Via
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <Field
                                                            className="db-select-nw"
                                                            component={
                                                                RenderSelect
                                                            }
                                                            name="alertVia"
                                                            id="alertViaId"
                                                            required="required"
                                                            options={[
                                                                {
                                                                    value: '',
                                                                    label:
                                                                        'Select an alert method',
                                                                },
                                                                {
                                                                    value:
                                                                        'sms',
                                                                    label:
                                                                        'SMS',
                                                                },
                                                                {
                                                                    value:
                                                                        'email',
                                                                    label:
                                                                        'Email',
                                                                },
                                                                {
                                                                    value:
                                                                        'webhook',
                                                                    label:
                                                                        'Webhook',
                                                                },
                                                            ]}
                                                            autoFocus={true}
                                                        />
                                                    </div>
                                                </div>
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                {this.props.type ===
                                                    'webhook' && (
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label">
                                                            URL
                                                        </label>
                                                        <div className="bs-Fieldset-fields">
                                                            <Field
                                                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                component={
                                                                    RenderField
                                                                }
                                                                type="url"
                                                                name="endpoint"
                                                                id="endpointId"
                                                                placeholder="https://mywebsite.com"
                                                            />
                                                        </div>
                                                    </div>
                                                )}
                                                <ShouldRender
                                                    if={
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                        this.props.type ===
                                                        'webhook'
                                                    }
                                                >
                                                    <div className="bs-Fieldset-row Margin-bottom--8">
                                                        <label className="bs-Fieldset-label">
                                                            Http Method
                                                        </label>
                                                        <div className="bs-Fieldset-fields">
                                                            <Field
                                                                className="db-select-nw"
                                                                component={
                                                                    RenderSelect
                                                                }
                                                                name="webhookMethod"
                                                                id="webhookMethod"
                                                                required="required"
                                                                options={[
                                                                    {
                                                                        value:
                                                                            '',
                                                                        label:
                                                                            'Select http method',
                                                                    },
                                                                    {
                                                                        value:
                                                                            'get',
                                                                        label:
                                                                            'GET',
                                                                    },
                                                                    {
                                                                        value:
                                                                            'post',
                                                                        label:
                                                                            'POST',
                                                                    },
                                                                ]}
                                                                autoFocus={true}
                                                            />
                                                        </div>
                                                    </div>
                                                </ShouldRender>
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                {(this.props.type === 'email' ||
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                    this.props.type ===
                                                        'webhook') && (
                                                    <>
                                                        <div className="bs-Fieldset-row">
                                                            <label className="bs-Fieldset-label">
                                                                Email
                                                            </label>
                                                            <div className="bs-Fieldset-fields">
                                                                <Field
                                                                    className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                    component={
                                                                        RenderField
                                                                    }
                                                                    type="text"
                                                                    name="email"
                                                                    id="emailId"
                                                                    placeholder="user@mail.com"
                                                                    required="required"
                                                                />
                                                            </div>
                                                        </div>

                                                        <ShouldRender
                                                            if={
                                                                this.props
                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                                    .type ===
                                                                'webhook'
                                                            }
                                                        >
                                                            <div className="bs-Fieldset-row bs-Fieldset-fields--desc">
                                                                <label className="bs-Fieldset-label" />
                                                                <div className="bs-Fieldset-fields">
                                                                    We notify
                                                                    you on this
                                                                    email when
                                                                    this wehbook
                                                                    stops
                                                                    working
                                                                </div>
                                                            </div>
                                                        </ShouldRender>
                                                    </>
                                                )}
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                {this.props.type === 'sms' && (
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label">
                                                            Country Code
                                                        </label>
                                                        <div className="bs-Fieldset-fields">
                                                            <Field
                                                                className="db-select-nw"
                                                                component={
                                                                    RenderSelect
                                                                }
                                                                name="countryCode"
                                                                id="countryCodeId"
                                                                required="required"
                                                                options={
                                                                    countryCodes
                                                                }
                                                            />
                                                        </div>
                                                    </div>
                                                )}
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                {this.props.type === 'sms' && (
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label">
                                                            Contact Number
                                                        </label>
                                                        <div className="bs-Fieldset-fields">
                                                            <Field
                                                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                component={
                                                                    RenderField
                                                                }
                                                                type="text"
                                                                pattern="[0-9]*"
                                                                inputMode="numeric"
                                                                name="contactPhone"
                                                                id="contactPhoneId"
                                                                placeholder="6505551234"
                                                                normalize={(val: $TSFixMe) => (
                                                                    val ||
                                                                    ''
                                                                ).replace(
                                                                    /[^\d]/g,
                                                                    ''
                                                                )
                                                                }
                                                            />
                                                        </div>
                                                    </div>
                                                )}
                                                <ShouldRender
                                                    if={
                                                        data.monitorList &&
                                                        data.monitorList
                                                            .length > 0
                                                    }
                                                >
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label">
                                                            Monitor
                                                        </label>
                                                        <div className="bs-Fieldset-fields bs-type-status">
                                                            <Field
                                                                className="db-select-nw"
                                                                component={
                                                                    RenderSelect
                                                                }
                                                                name="monitorId"
                                                                id="monitorId"
                                                                required="required"
                                                                options={[
                                                                    {
                                                                        value:
                                                                            '',
                                                                        label:
                                                                            mergeMonitors.length >
                                                                            0
                                                                                ? 'Select a Monitor'
                                                                                : 'No Monitor available',
                                                                    },
                                                                    ...(mergeMonitors &&
                                                                    mergeMonitors.length >
                                                                        0
                                                                        ? mergeMonitors.map(
                                                                              (monitor: $TSFixMe) => ({
                                                                                  value:
                                                                                      monitor._id,

                                                                                  label: `${monitor.componentId.name} / ${monitor.name}`
                                                                              })
                                                                          )
                                                                        : []),
                                                                ]}
                                                            />
                                                        </div>
                                                    </div>
                                                </ShouldRender>
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions Flex-flex--1">
                                        <ShouldRender
                                            if={
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'newSubscriber' does not exist on type 'R... Remove this comment to see the full error message
                                                this.props.newSubscriber &&
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'newSubscriber' does not exist on type 'R... Remove this comment to see the full error message
                                                this.props.newSubscriber.error
                                            }
                                        >
                                            <div className="bs-Tail-copy Flex-flex--1">
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
                                                            {
                                                                this.props
                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'newSubscriber' does not exist on type 'R... Remove this comment to see the full error message
                                                                    .newSubscriber
                                                                    .error
                                                            }
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
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
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                            disabled={
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'newSubscriber' does not exist on type 'R... Remove this comment to see the full error message
                                                this.props.newSubscriber &&
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'newSubscriber' does not exist on type 'R... Remove this comment to see the full error message
                                                this.props.newSubscriber
                                                    .requesting
                                            }
                                            type="submit"
                                            id="createSubscriber"
                                        >
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'newSubscriber' does not exist on type 'R... Remove this comment to see the full error message
                                            {this.props.newSubscriber &&
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'newSubscriber' does not exist on type 'R... Remove this comment to see the full error message
                                                !this.props.newSubscriber
                                                    .requesting && (
                                                    <>
                                                        <span>Create</span>
                                                        <span className="create-btn__keycode">
                                                            <span className="keycode__icon keycode__icon--enter" />
                                                        </span>
                                                    </>
                                                )}
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'newSubscriber' does not exist on type 'R... Remove this comment to see the full error message
                                            {this.props.newSubscriber &&
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'newSubscriber' does not exist on type 'R... Remove this comment to see the full error message
                                                this.props.newSubscriber
                                                    .requesting && (
                                                    <FormLoader />
                                                )}
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
CreateSubscriber.displayName = 'CreateSubscriberFormModal';

const CreateSubscriberForm = reduxForm({
    form: 'CreateSubscriber', // a unique identifier for this form
    validate,
})(CreateSubscriber);

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            createSubscriberRequest,
            createSubscriberError,
            createSubscriberSuccess,
            createSubscriber,
            fetchMonitorsSubscribers,
            fetchStatusPageSubscribers,
        },
        dispatch
    );
};

function mapStateToProps(state: $TSFixMe, ownProps: $TSFixMe) {
    const projectId = ownProps.data.subProjectId;
    const allMonitors = state.monitor.monitorsList.monitors
        .filter((monitor: $TSFixMe) => String(monitor._id) === String(projectId))
        .map((monitor: $TSFixMe) => monitor.monitors)
        .flat();
    const statusPageMonitors = ownProps.data.monitorList || [];
    const mergeMonitors: $TSFixMe = [];
    allMonitors.forEach((allMon: $TSFixMe) => {
        statusPageMonitors.forEach((mon: $TSFixMe) => {
            if (allMon._id === mon.monitor) {
                mergeMonitors.push(allMon);
            }
        });
    });
    return {
        monitors: state.monitor.monitorsList.monitors,
        mergeMonitors,
        currentProject: state.project.currentProject,
        newSubscriber: state.subscriber.newSubscriber,
        type: selector(state, 'alertVia'),
    };
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
CreateSubscriber.propTypes = {
    closeThisDialog: PropTypes.func.isRequired,
    createSubscriber: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func,
    fetchMonitorsSubscribers: PropTypes.func,
    fetchStatusPageSubscribers: PropTypes.func,
    newSubscriber: PropTypes.object,
    error: PropTypes.object,
    requesting: PropTypes.bool,
    type: PropTypes.string,
    data: PropTypes.oneOfType([PropTypes.string, PropTypes.object]),
    createSubscriberError: PropTypes.func,
    monitorList: PropTypes.array,
    mergeMonitors: PropTypes.array,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(CreateSubscriberForm);
