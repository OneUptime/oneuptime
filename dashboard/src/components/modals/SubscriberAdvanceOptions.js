import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { reduxForm, Field } from 'redux-form';
import { closeModal } from '../../actions/modal';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import {
    updateSubscriberOption
} from '../../actions/statusPage';
import { logEvent } from '../../analytics';
import { IS_DEV } from '../../config';

class SubscriberAdvanceOption extends React.Component {

    submitForm = (values) => {
        const { status } = this.props.statusPage;
        const { projectId } = status;
        this.props.updateSubscriberOption(projectId._id || projectId, {
            _id: status._id,
            enableRSSFeed: values.enableRSSFeed,
            emailNotification: values.emailNotification,
            smsNotification: values.smsNotification,
            webhookNotification: values.webhookNotification,
        })
            .then(() => {
                this.props.closeModal({
                    id: this.props.subscriberAdvanceOptionModalId
                })
            })
        if (!IS_DEV) {
            logEvent('Private StatusPage Updated', values);
        }
    }

    handleKeyBoard = (e) => {
        const { closeModal, subscriberAdvanceOptionModalId } = this.props;
        switch (e.key) {
            case 'Escape':
                return closeModal({
                    id: subscriberAdvanceOptionModalId
                })
            default:
                return false;
        }
    }

    render() {
        const { requesting, error } = this.props.subscriberOption;
        const { handleSubmit, closeModal } = this.props;

        return (
            <div onKeyDown={this.handleKeyBoard} className="ModalLayer-contents" tabIndex="-1" style={{ marginTop: '40px' }}>
                <div className="bs-BIM">
                    <div className="bs-Modal">
                        <div className="bs-Modal-header">
                            <div className="bs-Modal-header-copy"
                                style={{ marginBottom: '10px', marginTop: '10px' }}>
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Advance options for subscribers</span>
                                </span>
                                <p>
                                    <span>
                                        Manage features for status-page subscribers.
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
                                                <label className="bs-Fieldset-label" style={{ flex: '0% 0 0' }}><span></span></label>
                                                <div className="bs-Fieldset-fields bs-Fieldset-fields--wide" style={{ flexBasis: '100%' }}>
                                                    <div className="Box-root" style={{ height: '5px' }}></div>
                                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                        <label className="Checkbox">
                                                            <Field
                                                                component="input"
                                                                type="checkbox"
                                                                name={'enableRSSFeed'}
                                                                data-test="RetrySettings-failedPaymentsCheckbox"
                                                                className="Checkbox-source"
                                                                id='statuspage.enableRSSFeed'
                                                            />
                                                            <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                <div className="Checkbox-target Box-root">
                                                                    <div className="Checkbox-color Box-root"></div>
                                                                </div>
                                                            </div>
                                                            <div className="Box-root" style={{ 'padding-left': '5px' }}>
                                                                <label><span>Enable RSS feed for incidents</span></label>
                                                                <p className="bs-Fieldset-explanation"><span>Enabling this will allow your users to download RSS feed for monitor&apos;s incidents.
																				</span></p>
                                                            </div>
                                                        </label>

                                                    </div>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label" style={{ flex: '0% 0 0' }}><span></span></label>
                                                <div className="bs-Fieldset-fields bs-Fieldset-fields--wide" style={{ flexBasis: '100%' }}>
                                                    <div className="Box-root" style={{ height: '5px' }}></div>
                                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                        <label className="Checkbox">
                                                            <Field
                                                                component="input"
                                                                type="checkbox"
                                                                name={'emailNotification'}
                                                                data-test="RetrySettings-failedPaymentsCheckbox"
                                                                className="Checkbox-source"
                                                                id='statuspage.emailNotification'
                                                            />
                                                            <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                <div className="Checkbox-target Box-root">
                                                                    <div className="Checkbox-color Box-root"></div>
                                                                </div>
                                                            </div>
                                                            <div className="Box-root" style={{ 'padding-left': '5px' }}>
                                                                <label><span>Enable Email notifications</span></label>
                                                                <p className="bs-Fieldset-explanation"><span>Enabling this will allow your users to subscribe to email alerts for incidents.
																				</span></p>
                                                            </div>
                                                        </label>

                                                    </div>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label" style={{ flex: '0% 0 0' }}><span></span></label>
                                                <div className="bs-Fieldset-fields bs-Fieldset-fields--wide" style={{ flexBasis: '100%' }}>
                                                    <div className="Box-root" style={{ height: '5px' }}></div>
                                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                        <label className="Checkbox">
                                                            <Field
                                                                component="input"
                                                                type="checkbox"
                                                                name={'smsNotification'}
                                                                data-test="RetrySettings-failedPaymentsCheckbox"
                                                                className="Checkbox-source"
                                                                id='statuspage.smsNotification'
                                                            />
                                                            <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                <div className="Checkbox-target Box-root">
                                                                    <div className="Checkbox-color Box-root"></div>
                                                                </div>
                                                            </div>
                                                            <div className="Box-root" style={{ 'padding-left': '5px' }}>
                                                                <label><span>Enable SMS notifications</span></label>
                                                                <p className="bs-Fieldset-explanation"><span>Enabling this will allow your users to subscribe to sms alerts for your incidents.
																				</span></p>
                                                            </div>
                                                        </label>

                                                    </div>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label" style={{ flex: '0% 0 0' }}><span></span></label>
                                                <div className="bs-Fieldset-fields bs-Fieldset-fields--wide" style={{ flexBasis: '100%' }}>
                                                    <div className="Box-root" style={{ height: '5px' }}></div>
                                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                        <label className="Checkbox">
                                                            <Field
                                                                component="input"
                                                                type="checkbox"
                                                                name={'webhookNotification'}
                                                                data-test="RetrySettings-failedPaymentsCheckbox"
                                                                className="Checkbox-source"
                                                                id='statuspage.webhookNotification'
                                                            />
                                                            <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                <div className="Checkbox-target Box-root">
                                                                    <div className="Checkbox-color Box-root"></div>
                                                                </div>
                                                            </div>
                                                            <div className="Box-root" style={{ 'padding-left': '5px' }}>
                                                                <label><span>Enable Webhook integration</span></label>
                                                                <p className="bs-Fieldset-explanation"><span>Enabling this will allow your users to add webhook integrations.
																				</span></p>
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
                                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart" style={{ marginTop: '10px' }}>
                                                <div className="Box-root Margin-right--8">
                                                    <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex">
                                                    </div>
                                                </div>
                                                <div className="Box-root">
                                                    <span style={{ color: 'red' }}>{error}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </ShouldRender>
                                    <button className="bs-Button bs-DeprecatedButton" type="button" onClick={() => closeModal({
                                        id: this.props.subscriberAdvanceOptionModalId
                                    })}>
                                        <span>Cancel</span></button>
                                    <button
                                        id="saveSubscriberAdvanceOptionButton"
                                        className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                        disabled={requesting}
                                        type="submit">
                                        {!requesting && <span>Save</span>}
                                        {requesting && <FormLoader />}
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        )
    }
}

SubscriberAdvanceOption.displayName = 'SubscriberAdvanceOption';


SubscriberAdvanceOption.propTypes = {
    updateSubscriberOption: PropTypes.func.isRequired,
    closeModal: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    subscriberAdvanceOptionModalId: PropTypes.string,
    requesting: PropTypes.bool,
    error: PropTypes.object,
    statusPage: PropTypes.object,
    subscriberOption: PropTypes.object
};

const NewUpdateSchedule = reduxForm({
    form: 'SubscriberAdvanceOptionForm',
    enableReinitialize: true,
    destroyOnUnmount: true
})(SubscriberAdvanceOption);

const mapDispatchToProps = dispatch => bindActionCreators(
    {
        closeModal,
        updateSubscriberOption
    }
    , dispatch);

const mapStateToProps = state => {

    const initialValues = {};
    const { statusPage, statusPage: { status } } = state;
    const { subscriberOption } = state.statusPage;
    const subscriberAdvanceOptionModalId = state.modal.modals[0].id;

    initialValues.enableRSSFeed = status.enableRSSFeed;
    initialValues.emailNotification = status.emailNotification;
    initialValues.smsNotification = status.smsNotification;
    initialValues.webhookNotification = status.webhookNotification

    return {
        initialValues,
        subscriberOption,
        statusPage,
        subscriberAdvanceOptionModalId
    }
}

export default connect(mapStateToProps, mapDispatchToProps)(NewUpdateSchedule);