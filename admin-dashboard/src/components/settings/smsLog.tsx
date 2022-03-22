import React, { Component } from 'react';
import { FormLoader } from '../basic/Loader';

import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import { fetchSmsLogStatus, smsLogStatusChange } from '../../actions/smsLogs';

class SmsLog extends Component {
    handleKeyBoard: $TSFixMe;
    async componentDidMount() {

        await this.props.fetchSmsLogStatus();
    }
    toggleComponent = ({
        input: { value, onChange }
    }: $TSFixMe) => (
        <label className="Toggler-wrap">
            <input
                className="btn-toggler"
                checked={value}
                onChange={onChange}
                type="checkbox"
                name="smsStatusToggler"
                id="smsStatusToggler"
            />
            <span className="TogglerBtn-slider round"></span>
        </label>
    );
    submitForm = (values: $TSFixMe) => {

        this.props.smsLogStatusChange({ status: values.smsStatusToggler });
    };
    render() {

        const { changeSmsLogStatus, handleSubmit } = this.props;
        return (
            <div
                id="oneuptimeSmsLog"
                onKeyDown={this.handleKeyBoard}
                className="bs-ContentSection Card-root Card-shadow--medium"
            >
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <div className="Flex-flex Flex-alignItems-center Flex-justifyContent--spaceBetween">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>SMS Logs Settings</span>
                                </span>
                            </div>
                            <p>
                                <span>
                                    Here you can enable or disable SMS logs
                                    being monitored on your OneUptime projects.
                                </span>
                            </p>
                        </div>
                    </div>
                    <form
                        id="sms-log-toggle-form"
                        onSubmit={handleSubmit(this.submitForm)}
                    >
                        <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                    <fieldset className="bs-Fieldset">
                                        <div className="bs-Fieldset-rows">
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    Enable SMS Logs
                                                </label>
                                                <div
                                                    className="bs-Fieldset-fields"
                                                    style={{
                                                        paddingTop: 3,
                                                    }}
                                                >
                                                    <Field
                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                        name="smsStatusToggler"
                                                        id="smsStatusToggler"
                                                        component={
                                                            this.toggleComponent
                                                        }
                                                        disabled={
                                                            changeSmsLogStatus &&
                                                            changeSmsLogStatus.requesting
                                                        }
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </fieldset>
                                </div>
                            </div>
                        </div>

                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                            <span className="db-SettingsForm-footerMessage">
                                {!changeSmsLogStatus.requesting &&
                                    changeSmsLogStatus.error && (
                                        <div
                                            id="errors"
                                            className="bs-Tail-copy"
                                        >
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
                                                            changeSmsLogStatus.error
                                                        }
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                            </span>
                            <div>
                                <button
                                    className="bs-Button bs-Button--blue"
                                    disabled={
                                        changeSmsLogStatus &&
                                        changeSmsLogStatus.requesting
                                    }
                                    type="submit"
                                    id="smsLogSubmit"
                                >
                                    {changeSmsLogStatus.requesting ? (
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


SmsLog.displayName = 'SmsLog';

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        { fetchSmsLogStatus, smsLogStatusChange },
        dispatch
    );
};

function mapStateToProps(state: $TSFixMe) {
    const smsLogStatus = state.smsLogs.smsLogStatus;
    const changeSmsLogStatus = state.smsLogs.changeSmsLogStatus;
    return {
        settings: state.settings,
        smsLogStatus,
        changeSmsLogStatus,
        initialValues: {
            smsStatusToggler: smsLogStatus.data
                ? smsLogStatus.data.value
                : false,
        },
    };
}
const ReduxFormComponent = reduxForm({
    form: 'sms-log-toggle-form',
    enableReinitialize: true,
})(SmsLog);


SmsLog.propTypes = {
    changeSmsLogStatus: PropTypes.object,
    handleSubmit: PropTypes.func,
    fetchSmsLogStatus: PropTypes.func,
    smsLogStatusChange: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(ReduxFormComponent);
