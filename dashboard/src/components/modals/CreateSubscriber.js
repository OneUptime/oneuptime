import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { Field, reduxForm, formValueSelector } from 'redux-form';
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

function validate(values) {
    const errors = {};

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
        }
    }

    return errors;
}

const selector = formValueSelector('CreateSubscriber');

class CreateSubscriber extends Component {
    submitForm = values => {
        values.contactEmail = values.email;
        values.contactWebhook = values.endpoint;
        const {
            createSubscriber,
            closeThisDialog,
            data,
            fetchMonitorsSubscribers,
        } = this.props;
        const { monitorId, subProjectId } = data;
        createSubscriber(subProjectId, monitorId, values).then(
            function() {
                fetchMonitorsSubscribers(subProjectId, monitorId, 0, 5);
                closeThisDialog();
            },
            function() {
                //do nothing.
            }
        );
    };

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeThisDialog();
            default:
                return false;
        }
    };

    render() {
        const { handleSubmit, closeThisDialog } = this.props;

        return (
            <div
                onKeyDown={this.handleKeyBoard}
                className="ModalLayer-contents"
                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM">
                    <div className="bs-Modal bs-Modal--medium">
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
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    Alert Via
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <Field
                                                        className="db-select-nw"
                                                        component={RenderSelect}
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
                                                                value: 'sms',
                                                                label: 'SMS',
                                                            },
                                                            {
                                                                value: 'email',
                                                                label: 'Email',
                                                            },
                                                            {
                                                                value:
                                                                    'webhook',
                                                                label:
                                                                    'Webhook',
                                                            },
                                                        ]}
                                                    />
                                                </div>
                                            </div>
                                            {this.props.type === 'webhook' && (
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
                                                            this.props.type ===
                                                            'webhook'
                                                        }
                                                    >
                                                        <div className="bs-Fieldset-row bs-Fieldset-fields--desc">
                                                            <label className="bs-Fieldset-label" />
                                                            <div className="bs-Fieldset-fields">
                                                                We notify you on
                                                                this email when
                                                                this wehbook
                                                                stops working
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
                                                            name="contactPhone"
                                                            id="contactPhoneId"
                                                            placeholder="6505551234"
                                                            required="required"
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div className="bs-Modal-footer">
                                <div className="bs-Modal-footer-actions">
                                    <ShouldRender
                                        if={
                                            this.props.newSubscriber &&
                                            this.props.newSubscriber.error
                                        }
                                    >
                                        <div className="bs-Tail-copy">
                                            <div
                                                className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                style={{ marginTop: '10px' }}
                                            >
                                                <div className="Box-root Margin-right--8">
                                                    <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                </div>
                                                <div className="Box-root">
                                                    <span
                                                        style={{ color: 'red' }}
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
                                        className="bs-Button bs-DeprecatedButton"
                                        type="button"
                                        onClick={closeThisDialog}
                                    >
                                        <span>Cancel</span>
                                    </button>
                                    <button
                                        className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                        disabled={
                                            this.props.newSubscriber &&
                                            this.props.newSubscriber.requesting
                                        }
                                        type="submit"
                                        id="createSubscriber"
                                    >
                                        {this.props.newSubscriber &&
                                            !this.props.newSubscriber
                                                .requesting && (
                                                <span>Create</span>
                                            )}
                                        {this.props.newSubscriber &&
                                            this.props.newSubscriber
                                                .requesting && <FormLoader />}
                                    </button>
                                </div>
                            </div>
                        </form>
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

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            createSubscriberRequest,
            createSubscriberError,
            createSubscriberSuccess,
            createSubscriber,
            fetchMonitorsSubscribers,
        },
        dispatch
    );
};

function mapStateToProps(state) {
    return {
        monitors: state.monitor.monitorsList.monitors,
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
    newSubscriber: PropTypes.object,
    error: PropTypes.object,
    requesting: PropTypes.bool,
    type: PropTypes.string,
    data: PropTypes.oneOfType([PropTypes.string, PropTypes.object]),
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(CreateSubscriberForm);
