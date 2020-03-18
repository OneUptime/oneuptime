/*import React, { Component } from 'react';
import { Field, reduxForm } from 'redux-form'
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { updateOnCallAlertSetting, updateOnCallAlertSettingRequest, updateOnCallAlertSettingSuccess, updateOnCallAlertSettingError } from '../../actions/profile';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';

export class OnCallAlertSetting extends Component {

    submitForm = (values)=> {
        const alerts = [];
        for (const i in values) {
            if (values.hasOwnProperty(i)) {
                values[i] && alerts.push(i);
            }
        }
        this.props.updateOnCallAlertSetting(alerts).then(function () {

        }, function () {

        });
        if(!SHOULD_LOG_ANALYTICS){
        logEvent('Update On Call Alert', alerts);
        }
    }

    render() {
        const { handleSubmit } = this.props;

        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                <span>On Call Alert Settings</span>
                            </span>
                            <p><span>How would you like to be alerted when you&#39;re on-call duty?</span></p>
                        </div>
                    </div>
                    <form onSubmit={handleSubmit(this.submitForm)}>
                        <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                    <fieldset data-test="RetrySettings-failedAndExpiring" className="bs-Fieldset">
                                        <div className="bs-Fieldset-rows">
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label"><span>Alert me via</span></label>
                                                <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                    <div className="Box-root" style={{ height: '5px' }}></div>
                                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                        <div className="Box-root Margin-bottom--12">
                                                            <div data-test="RetrySettings-failedPaymentsRow" className="Box-root">
                                                                <label className="Checkbox" htmlFor="email-check">
                                                                    <Field
                                                                        type="checkbox"
                                                                        data-test="RetrySettings-failedPaymentsCheckbox"
                                                                        className="Checkbox-source"
                                                                        name="email"
                                                                        id="email-check"
                                                                        component="input"
                                                                    />
                                                                    <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                        <div className="Checkbox-target Box-root">
                                                                            <div className="Checkbox-color Box-root"></div>
                                                                        </div>
                                                                    </div>
                                                                    <div className="Checkbox-label Box-root Margin-left--8"><span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"><span>Email</span></span></div>
                                                                </label>
                                                                <div className="Box-root Padding-left--24">
                                                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                                        <div className="Box-root Margin-bottom--4"><span className="Text-color--inherit Text-display--inline Text-fontSize--12 Text-fontWeight--regular Text-lineHeight--16 Text-typeface--base Text-wrap--wrap"><span>An Email alerts will be sent each time when you&#39;re on call duty and we need your attention.</span></span></div>
                                                                        <div className="Box-root">
                                                                            <div className="Box-root">
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="Box-root">
                                                            <div data-test="RetrySettings-expiringCardsRow" className="Box-root">
                                                                <label className="Checkbox" htmlFor="sms">
                                                                    <Field
                                                                        type="checkbox"
                                                                        data-test="RetrySettings-expiringCardsCheckbox"
                                                                        name="sms"
                                                                        className="Checkbox-source"
                                                                        id="sms"
                                                                        value="on"
                                                                        component="input"
                                                                    />
                                                                    <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                        <div className="Checkbox-target Box-root">
                                                                            <div className="Checkbox-color Box-root"></div>
                                                                        </div>
                                                                    </div>
                                                                    <div className="Checkbox-label Box-root Margin-left--8"><span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"><span>SMS</span></span></div>
                                                                </label>
                                                                <div className="Box-root Padding-left--24">
                                                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                                        <div className="Box-root Margin-bottom--4">
                                                                            <div className="Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                                <div className="Box-root Margin-right--8"><span className="Text-color--inherit Text-display--inline Text-fontSize--12 Text-fontWeight--regular Text-lineHeight--16 Text-typeface--base Text-wrap--wrap"><span>An SMS will be sent when we need your attention.</span></span></div>
                                                                            </div>
                                                                        </div>
                                                                        <div className="Box-root">
                                                                            <div className="Box-root">
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="Box-root">
                                                            <div data-test="RetrySettings-expiringCardsRow" className="Box-root">
                                                                <label className="Checkbox" htmlFor="call">
                                                                    <Field
                                                                        type="checkbox"
                                                                        data-test="RetrySettings-expiringCardsCheckbox"
                                                                        name="call"
                                                                        className="Checkbox-source"
                                                                        id="call"
                                                                        value="on"
                                                                        component="input"
                                                                    />
                                                                    <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                        <div className="Checkbox-target Box-root">
                                                                            <div className="Checkbox-color Box-root"></div>
                                                                        </div>
                                                                    </div>
                                                                    <div className="Checkbox-label Box-root Margin-left--8"><span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"><span>Call</span></span></div>
                                                                </label>
                                                                <div className="Box-root Padding-left--24">
                                                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                                        <div className="Box-root Margin-bottom--4">
                                                                            <div className="Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                                <div className="Box-root Margin-right--8"><span className="Text-color--inherit Text-display--inline Text-fontSize--12 Text-fontWeight--regular Text-lineHeight--16 Text-typeface--base Text-wrap--wrap"><span>We&#39;ll call you when you&#39;re on call and when something goes wrong. We recommend you to turn this on.</span></span></div>
                                                                            </div>
                                                                        </div>
                                                                        <div className="Box-root">
                                                                            <div className="Box-root">
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
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
                                    <ShouldRender if={this.props.profileSettings && this.props.profileSettings.onCallAlertSetting && this.props.profileSettings.onCallAlertSetting.error}>

                                        <div className="Box-root Margin-right--8">
                                            <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex">
                                            </div>
                                        </div>
                                        <div className="Box-root">
                                            <span style={{ color: 'red' }}>{this.props.profileSettings && this.props.profileSettings.onCallAlertSetting && this.props.profileSettings.onCallAlertSetting.error ? this.props.profileSettings.onCallAlertSetting.error : ''}</span>
                                        </div>

                                    </ShouldRender>
                                </div>
                            </div>
                            <div>
                                <button
                                    className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                    disabled={this.props.profileSettings && this.props.profileSettings.onCallAlertSetting && this.props.profileSettings.onCallAlertSetting.requesting}
                                    type="submit">
                                    <ShouldRender if={this.props.profileSettings && this.props.profileSettings.onCallAlertSetting && !this.props.profileSettings.onCallAlertSetting.requesting}>
                                        <span>Save Profile</span>
                                    </ShouldRender>
                                    <ShouldRender if={this.props.profileSettings && this.props.profileSettings.onCallAlertSetting && this.props.profileSettings.onCallAlertSetting.requesting}>
                                        <FormLoader />
                                    </ShouldRender>

                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        );
    }
}

OnCallAlertSetting.displayName = 'OnCallAlertSetting'

let OnCallAlertSettingForm = reduxForm({
    form: 'OnCallAlertSetting', // a unique identifier for this form
    enableReinitialize: true
})(OnCallAlertSetting);

const mapDispatchToProps = (dispatch) => {
    return bindActionCreators({ updateOnCallAlertSetting, updateOnCallAlertSettingRequest, updateOnCallAlertSettingSuccess, updateOnCallAlertSettingError }, dispatch)
}

const mapStateToProps = state => {
    const data = state.profileSettings && state.profileSettings.profileSetting && state.profileSettings.profileSetting.data ? state.profileSettings.profileSetting.data : null;

    const initialValues = {
        sms: false, call: false, email: false
    };

    data && data.onCallAlert && data.onCallAlert.forEach(alert => {
        initialValues[alert] = true;
    });

    return {
        initialValues,
        profileSettings: state.profileSettings,
    };
}

OnCallAlertSetting.propTypes = {
    updateOnCallAlertSetting:PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    profileSettings: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null,undefined])
    ])
}

export default connect(mapStateToProps, mapDispatchToProps)(OnCallAlertSettingForm);
*/
