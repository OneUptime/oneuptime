import React, { Component } from 'react';
import { FormLoader } from '../basic/Loader';

import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import {
    fetchAuditLogStatus,
    auditLogStatusChange,
} from '../../actions/auditLogs';

class AuditLog extends Component {
    handleKeyBoard: $TSFixMe;
    async componentDidMount() {

        await this.props.fetchAuditLogStatus();
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
                name="auditStatusToggler"
                id="auditStatusToggler"
            />
            <span className="TogglerBtn-slider round"></span>
        </label>
    );
    submitForm = (values: $TSFixMe) => {

        this.props.auditLogStatusChange({ status: values.auditStatusToggler });
    };
    render() {

        const { changeAuditLogStatus, handleSubmit } = this.props;
        return (
            <div
                id="oneuptimeAuditLog"
                onKeyDown={this.handleKeyBoard}
                className="bs-ContentSection Card-root Card-shadow--medium"
            >
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <div className="Flex-flex Flex-alignItems-center Flex-justifyContent--spaceBetween">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Audit Logs Settings</span>
                                </span>
                            </div>
                            <p>
                                <span>
                                    Here you can enable or disable audit logs
                                    being monitored on your OneUptime projects.
                                </span>
                            </p>
                        </div>
                    </div>
                    <form
                        id="audit-log-toggle-form"
                        onSubmit={handleSubmit(this.submitForm)}
                    >
                        <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                    <fieldset className="bs-Fieldset">
                                        <div className="bs-Fieldset-rows">
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    Enable Audit Logs
                                                </label>
                                                <div
                                                    className="bs-Fieldset-fields"
                                                    style={{
                                                        paddingTop: 3,
                                                    }}
                                                >
                                                    <Field
                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                        name="auditStatusToggler"
                                                        id="auditStatusToggler"
                                                        component={
                                                            this.toggleComponent
                                                        }
                                                        disabled={
                                                            changeAuditLogStatus &&
                                                            changeAuditLogStatus.requesting
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
                                {!changeAuditLogStatus.requesting &&
                                    changeAuditLogStatus.error && (
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
                                                            changeAuditLogStatus.error
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
                                        changeAuditLogStatus &&
                                        changeAuditLogStatus.requesting
                                    }
                                    type="submit"
                                    id="auditLogSubmit"
                                >
                                    {changeAuditLogStatus.requesting ? (
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


AuditLog.displayName = 'AuditLog';

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        { fetchAuditLogStatus, auditLogStatusChange },
        dispatch
    );
};

function mapStateToProps(state: $TSFixMe) {
    const auditLogStatus = state.auditLogs.auditLogStatus;
    const changeAuditLogStatus = state.auditLogs.changeAuditLogStatus;
    return {
        settings: state.settings,
        auditLogStatus,
        changeAuditLogStatus,
        initialValues: {
            auditStatusToggler: auditLogStatus.data
                ? auditLogStatus.data.value
                : false,
        },
    };
}
const ReduxFormComponent = reduxForm({
    form: 'audit-log-toggle-form',
    enableReinitialize: true,
})(AuditLog);


AuditLog.propTypes = {
    changeAuditLogStatus: PropTypes.object,
    handleSubmit: PropTypes.func,
    fetchAuditLogStatus: PropTypes.func,
    auditLogStatusChange: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(ReduxFormComponent);
