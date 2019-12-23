import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { Field, reduxForm } from 'redux-form';
import {
    updatePrivateStatusPage, updatePrivateStatusPageRequest,
    updatePrivateStatusPageSuccess, updatePrivateStatusPageError, fetchProjectStatusPage
} from '../../actions/statusPage';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import uuid from 'uuid';
import { openModal } from '../../actions/modal';
import DataPathHoC from '../DataPathHoC';
import SubscriberAdvanceOptions from '../modals/SubscriberAdvanceOptions';

export class PrivateStatusPage extends Component {

    constructor(props) {
        super(props);
        this.props = props;
        this.state = {
            subscriberAdvanceOptionModalId: uuid.v4(),
        }
    }

    submitForm = (values) => {
        const { status } = this.props.statusPage;
        const { projectId } = status;

        this.props.updatePrivateStatusPage(projectId._id || projectId, { 
            _id: status._id,
            isPrivate: values.isPrivate, 
            isSubscriberEnabled: values.isSubscriberEnabled, 
            isGroupedByMonitorCategory: values.isGroupedByMonitorCategory,
            showScheduledEvents: values.showScheduledEvents,
        })
            .then(() => {
                this.props.fetchProjectStatusPage(projectId, true)
            })
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Private StatusPage Updated', values);
        }
    }

    render() {
        const { handleSubmit } = this.props;
        const { subscriberAdvanceOptionModalId } = this.state;
        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">

                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                <span>More Options</span>
                            </span>
                            <p><span>Here are more options for your status page</span></p>
                        </div>
                    </div>

                    <form onSubmit={handleSubmit(this.submitForm)}>

                        <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                    <fieldset data-test="RetrySettings-failedAndExpiring" className="bs-Fieldset">
                                        <div className="bs-Fieldset-rows">

                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label" style={{ flex: '25% 0 0' }}><span></span></label>
                                                <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                    <div className="Box-root" style={{ height: '5px' }}></div>
                                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                        <label className="Checkbox">
                                                            <Field
                                                                component="input"
                                                                type="checkbox"
                                                                name={'isGroupedByMonitorCategory'}
                                                                data-test="RetrySettings-failedPaymentsCheckbox"
                                                                className="Checkbox-source"
                                                                id='statuspage.isGroupedByMonitorCategory'
                                                            />
                                                            <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                <div className="Checkbox-target Box-root">
                                                                    <div className="Checkbox-color Box-root">
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="Box-root" style={{ 'padding-left': '5px' }}>
                                                                <label><span>Group Monitor by Categories</span></label>
                                                                <p className="bs-Fieldset-explanation"><span>Group monitor on public  status page by categories.
																				</span></p>
                                                            </div>
                                                        </label>

                                                    </div>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label" style={{ flex: '25% 0 0' }}><span></span></label>
                                                <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                    <div className="Box-root" style={{ height: '5px' }}></div>
                                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                        <label className="Checkbox">
                                                            <Field
                                                                component="input"
                                                                type="checkbox"
                                                                name={'isPrivate'}
                                                                data-test="RetrySettings-failedPaymentsCheckbox"
                                                                className="Checkbox-source"
                                                                id='statuspage.isPrivate'
                                                            />
                                                            <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                <div className="Checkbox-target Box-root">
                                                                    <div className="Checkbox-color Box-root">
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="Box-root" style={{ 'padding-left': '5px' }}>
                                                                <label><span>Private Status Page</span></label>
                                                                <p className="bs-Fieldset-explanation"><span>Making the status page private will only make it visible to your internal team.
																				</span></p>
                                                            </div>
                                                        </label>

                                                    </div>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label" style={{ flex: '25% 0 0' }}><span></span></label>
                                                <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                    <div className="Box-root" style={{ height: '5px' }}></div>
                                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                        <label className="Checkbox">
                                                            <Field
                                                                component="input"
                                                                type="checkbox"
                                                                name={'showScheduledEvents'}
                                                                data-test="RetrySettings-failedPaymentsCheckbox"
                                                                className="Checkbox-source"
                                                                id='statuspage.showScheduledEvents'
                                                            />
                                                            <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                <div className="Checkbox-target Box-root">
                                                                    <div className="Checkbox-color Box-root"></div>
                                                                </div>
                                                            </div>
                                                            <div className="Box-root" style={{ 'padding-left': '5px' }}>
                                                                <label><span>Show Scheduled events</span></label>
                                                                <p className="bs-Fieldset-explanation"><span> Enable this to allow your users to see scheduled events like Database migration, Scheduled downtime, etc.
																				</span></p>
                                                            </div>
                                                        </label>

                                                    </div>
                                                </div>
                                            </div>                                            

                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label" style={{ flex: '25% 0 0' }}><span></span></label>
                                                <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                    <div className="Box-root" style={{ height: '5px' }}></div>
                                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                        <label className="Checkbox">
                                                            <Field
                                                                component="input"
                                                                type="checkbox"
                                                                name={'isSubscriberEnabled'}
                                                                data-test="RetrySettings-failedPaymentsCheckbox"
                                                                className="Checkbox-source"
                                                                id='statuspage.isSubscriberEnabled'
                                                            />
                                                            <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                <div className="Checkbox-target Box-root">
                                                                    <div className="Checkbox-color Box-root"></div>
                                                                </div>
                                                            </div>
                                                            <div className="Box-root" style={{ 'padding-left': '5px' }}>
                                                                <label><span>Enable Subscribers</span></label>
                                                                <p className="bs-Fieldset-explanation"><span>Enabling this will allow your users to subscribe and get notifications for your incidents.
																				</span></p>
                                                            </div>
                                                        </label>

                                                    </div>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label" style={{ flex: '25% 0 0' }}><span></span></label>
                                                <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                    <div className="Box-root" style={{ height: '5px' }}></div>
                                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                        <label className="Checkbox">
                                                            <div className="Box-root" style={{ 'paddingLeft': '5px' }}>
                                                                <label>
                                                                    <button
                                                                        className="button-as-anchor"
                                                                        style={{ cursor: 'pointer' }}
                                                                        onClick={() => {
                                                                            this.props.openModal({
                                                                                id: subscriberAdvanceOptionModalId,
                                                                                content: DataPathHoC(SubscriberAdvanceOptions, {})
                                                                            })
                                                                        }}>
                                                                        Advance options for subscribers
                                                                    </button>
                                                                </label>
                                                            </div>
                                                        </label>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </fieldset>
                                </div>
                            </div>
                        </div>

                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12"><span className="db-SettingsForm-footerMessage"></span>
                            <div className="bs-Tail-copy">
                                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart" style={{ marginTop: '10px' }}>
                                    <ShouldRender if={this.props.statusPage.privateStatusPage.error} >
                                        <div className="Box-root Margin-right--8">
                                            <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex">
                                            </div>
                                        </div>
                                        <div className="Box-root">
                                            <span style={{ color: 'red' }}>{this.props.statusPage.privateStatusPage.error}</span>
                                        </div>
                                    </ShouldRender>
                                </div>
                            </div>
                            <div>
                                <button className="bs-Button bs-DeprecatedButton bs-Button--blue" disabled={this.props.statusPage.privateStatusPage.requesting} type="submit">{!this.props.statusPage.privateStatusPage.requesting && <span>Save </span>}
                                    {this.props.statusPage.privateStatusPage.requesting && <FormLoader />}
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        );
    }
}

PrivateStatusPage.displayName = 'PrivateStatusPage'

let PrivateStatusPageForm = reduxForm({
    form: 'PrivateStatusPages', // a unique identifier for this form
    enableReinitialize: true
})(PrivateStatusPage);

PrivateStatusPage.propTypes = {
    updatePrivateStatusPage: PropTypes.func.isRequired,
    statusPage: PropTypes.object.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    fetchProjectStatusPage: PropTypes.func.isRequired,
}

const mapDispatchToProps = dispatch => bindActionCreators(
    {
        updatePrivateStatusPage,
        updatePrivateStatusPageRequest,
        updatePrivateStatusPageSuccess,
        updatePrivateStatusPageError,
        fetchProjectStatusPage,
        openModal
    }, dispatch
)

const mapStateToProps = state => {
    let initialValues = {};
    const { currentProject } = state.project;
    const { statusPage, statusPage: { status } } = state;

    if (status) {
        initialValues.isPrivate = status.isPrivate;
        initialValues.isSubscriberEnabled = status.isSubscriberEnabled;
        initialValues.isGroupedByMonitorCategory = status.isGroupedByMonitorCategory;
        initialValues.showScheduledEvents = status.showScheduledEvents;
    }

    return { initialValues, statusPage, currentProject };
}

PrivateStatusPage.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

export default connect(mapStateToProps, mapDispatchToProps)(PrivateStatusPageForm);