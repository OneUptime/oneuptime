import React, { Component } from 'react';
import { FormLoader } from '../basic/Loader';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import {
    fetchCallLogStatus,
    callLogStatusChange,
} from '../../actions/callLogs';

class CallLog extends Component {
    async componentDidMount() {
        await this.props.fetchCallLogStatus();
    }
    toggleComponent = ({ input: { value, onChange } }) => (
        <label className="Toggler-wrap">
            <input
                className="btn-toggler"
                checked={value}
                onChange={onChange}
                type="checkbox"
                name="callStatusToggler"
                id="callStatusToggler"
            />
            <span className="TogglerBtn-slider round"></span>
        </label>
    );
    submitForm = values => {
        this.props.callLogStatusChange({ status: values.callStatusToggler });
    };
    render() {
        const { changeCallLogStatus, handleSubmit } = this.props;
        return (
            <div
                id="fyipeCallLog"
                onKeyDown={this.handleKeyBoard}
                className="bs-ContentSection Card-root Card-shadow--medium"
            >
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <div className="Flex-flex Flex-alignItems-center Flex-justifyContent--spaceBetween">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Call Logs Settings</span>
                                </span>
                            </div>
                            <p>
                                <span>
                                    Here you can enable or disable call logs
                                    being monitored on your Fyipe projects.
                                </span>
                            </p>
                        </div>
                    </div>
                    <form
                        id="call-log-toggle-form"
                        onSubmit={handleSubmit(this.submitForm)}
                    >
                        <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                    <fieldset className="bs-Fieldset">
                                        <div className="bs-Fieldset-rows">
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    Enable Call Logs
                                                </label>
                                                <div
                                                    className="bs-Fieldset-fields"
                                                    style={{
                                                        paddingTop: 3,
                                                    }}
                                                >
                                                    <Field
                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                        name="callStatusToggler"
                                                        id="callStatusToggler"
                                                        component={
                                                            this.toggleComponent
                                                        }
                                                        disabled={
                                                            changeCallLogStatus &&
                                                            changeCallLogStatus.requesting
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
                                {!changeCallLogStatus.requesting &&
                                    changeCallLogStatus.error && (
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
                                                            changeCallLogStatus.error
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
                                        changeCallLogStatus &&
                                        changeCallLogStatus.requesting
                                    }
                                    type="submit"
                                    id="callLogSubmit"
                                >
                                    {changeCallLogStatus.requesting ? (
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

CallLog.displayName = 'CallLog';

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        { fetchCallLogStatus, callLogStatusChange },
        dispatch
    );
};

function mapStateToProps(state) {
    const callLogStatus = state.callLogs.callLogStatus;
    const changeCallLogStatus = state.callLogs.changeCallLogStatus;
    return {
        settings: state.settings,
        callLogStatus,
        changeCallLogStatus,
        initialValues: {
            callStatusToggler: callLogStatus.data
                ? callLogStatus.data.value
                : false,
        },
    };
}
const ReduxFormComponent = reduxForm({
    form: 'call-log-toggle-form',
    enableReinitialize: true,
})(CallLog);

CallLog.propTypes = {
    changeCallLogStatus: PropTypes.object,
    handleSubmit: PropTypes.func,
    fetchCallLogStatus: PropTypes.func,
    callLogStatusChange: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(ReduxFormComponent);
