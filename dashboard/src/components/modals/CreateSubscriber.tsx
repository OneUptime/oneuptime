import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';

import { Field, reduxForm, formValueSelector } from 'redux-form';

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

        errors.monitorId = 'Please select a monitor.';
    }
    if (!Validate.text(values.alertVia)) {

        errors.alertVia = 'Please select a subscribe method.';
    } else {
        if (values.alertVia === 'sms') {
            if (!Validate.text(values.countryCode)) {

                errors.countryCode = 'Please select a country code.';
            }
            if (!Validate.text(values.contactPhone)) {

                errors.contactPhone = 'Please enter a contact number.';
            }
        }
        if (values.alertVia === 'email') {
            if (!Validate.text(values.email)) {

                errors.email = 'Please enter an email address.';
            } else {
                if (!Validate.email(values.email)) {

                    errors.email = 'Please enter a valid email address.';
                }
            }
        }
        if (values.alertVia === 'webhook') {
            if (!Validate.text(values.endpoint)) {

                errors.endpoint = 'Please enter an endpoint url.';
            } else {
                if (!Validate.url(values.endpoint)) {

                    errors.endpoint = 'Please enter a valid url.';
                }
            }
            if (!Validate.text(values.email)) {

                errors.email = 'Please enter an email address.';
            } else {
                if (!Validate.email(values.email)) {

                    errors.email = 'Please enter a valid email address.';
                }
            }
            if (
                !Validate.text(values.webhookMethod) ||
                !['get', 'post'].includes(values.webhookMethod)
            ) {

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

        this.props.createSubscriberError('');
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = (values: $TSFixMe) => {
        values.contactEmail = values.email;
        values.contactWebhook = values.endpoint;
        const {

            createSubscriber,

            closeThisDialog,

            data,

            fetchMonitorsSubscribers,

            fetchStatusPageSubscribers,
        } = this.props;
        const { monitorId, subProjectId, statusPage, limit } = data;
        createSubscriber(
            subProjectId,
            monitorId || values.monitorId,
            values
        ).then(
            function () {
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
            function () {
                //do nothing.
            }
        );
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                return this.props.closeThisDialog();
            case 'Enter':

                return document.getElementById('createSubscriber').click();
            default:
                return false;
        }
    };

    render() {
        const {

            handleSubmit,

            closeThisDialog,

            data,

            mergeMonitors,
        } = this.props;

        return (
            <div
                className="ModalLayer-contents"

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

                                                {(this.props.type === 'email' ||

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

                                                this.props.newSubscriber &&

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

                                                this.props.newSubscriber &&

                                                this.props.newSubscriber
                                                    .requesting
                                            }
                                            type="submit"
                                            id="createSubscriber"
                                        >

                                            {this.props.newSubscriber &&

                                                !this.props.newSubscriber
                                                    .requesting && (
                                                    <>
                                                        <span>Create</span>
                                                        <span className="create-btn__keycode">
                                                            <span className="keycode__icon keycode__icon--enter" />
                                                        </span>
                                                    </>
                                                )}

                                            {this.props.newSubscriber &&

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
