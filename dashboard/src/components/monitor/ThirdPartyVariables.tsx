import React, { Component } from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { withRouter } from 'react-router-dom';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { Field, reduxForm } from 'redux-form';
import { FormLoader, ListLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { RenderField } from '../basic/RenderField';
import { editMonitor, resetEditMonitor } from '../../actions/monitor';
import { fetchCustomFields } from '../../actions/monitorCustomField';

class ThirdPartyVariables extends Component {
    componentDidMount() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchCustomFields' does not exist on typ... Remove this comment to see the full error message
            fetchCustomFields,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetEditMonitor' does not exist on type... Remove this comment to see the full error message
            resetEditMonitor,
        } = this.props;
        fetchCustomFields(currentProject._id);
        resetEditMonitor();
    }

    submitForm = (values: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        const { currentProject, monitor, customFields } = this.props;
        const projectId = monitor.projectId._id || monitor.projectId;
        const postObj = {
            _id: monitor._id,
            projectId,
        };

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'customFields' does not exist on type '{ ... Remove this comment to see the full error message
        postObj.customFields = customFields.map((field: $TSFixMe) => ({
            fieldName: field.fieldName,
            uniqueField: field.uniqueField,
            fieldType: field.fieldType,

            fieldValue:
                field.fieldType === 'number'
                    ? parseFloat(values[field.fieldName])
                    : values[field.fieldName]
        }));

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'editMonitor' does not exist on type 'Rea... Remove this comment to see the full error message
        this.props.editMonitor(currentProject._id, postObj);
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
            handleSubmit,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'editingMonitor' does not exist on type '... Remove this comment to see the full error message
            editingMonitor,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'editError' does not exist on type 'Reado... Remove this comment to see the full error message
            editError,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'customFields' does not exist on type 'Re... Remove this comment to see the full error message
            customFields,
        } = this.props;

        return (
            <div className="Box-root Margin-vertical--12">
                <div className="db-RadarRulesLists-page">
                    <div className="Box-root Margin-bottom--12">
                        <div className="bs-ContentSection Card-root Card-shadow--medium">
                            <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                    <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                        <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                            <span>Monitor Custom Fields</span>
                                        </span>
                                        <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                            <span>
                                                List of all the available custom
                                                fields for this monitor
                                            </span>
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div className="bs-ContentSection-content Box-root">
                                <div className="bs-ObjectList db-UserList">
                                    <div
                                        style={{
                                            overflow: 'hidden',
                                            overflowX: 'auto',
                                        }}
                                    >
                                        <form
                                            onSubmit={handleSubmit(
                                                this.submitForm
                                            )}
                                        >
                                            <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                                                <div>
                                                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                                        {customFields &&
                                                            customFields.length >
                                                                0 &&
                                                            customFields.map(
                                                                (field: $TSFixMe) => <fieldset
                                                                    key={
                                                                        field._id
                                                                    }
                                                                    data-test="RetrySettings-failedAndExpiring"
                                                                    className="bs-Fieldset"
                                                                    style={{
                                                                        padding: 0,
                                                                    }}
                                                                >
                                                                    <div className="bs-Fieldset-rows">
                                                                        <div className="bs-Fieldset-row">
                                                                            <label className="bs-Fieldset-label">
                                                                                <span>
                                                                                    {
                                                                                        field.fieldName
                                                                                    }
                                                                                </span>
                                                                            </label>
                                                                            <div className="bs-Fieldset-fields">
                                                                                <div
                                                                                    className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart"
                                                                                    style={{
                                                                                        width:
                                                                                            '100%',
                                                                                    }}
                                                                                >
                                                                                    <div className="Flex-flex">
                                                                                        <div
                                                                                            className="bs-Fieldset-field"
                                                                                            style={{
                                                                                                width:
                                                                                                    '100%',
                                                                                            }}
                                                                                        >
                                                                                            <Field
                                                                                                component={
                                                                                                    RenderField
                                                                                                }
                                                                                                name={
                                                                                                    field.fieldName
                                                                                                }
                                                                                                id={
                                                                                                    field.fieldName
                                                                                                }
                                                                                                type={
                                                                                                    field.fieldType
                                                                                                }
                                                                                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                                                style={{
                                                                                                    width:
                                                                                                        '100%',
                                                                                                    padding:
                                                                                                        '3px 5px',
                                                                                                }}
                                                                                            />
                                                                                        </div>
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </fieldset>
                                                            )}

                                                        {customFields &&
                                                            customFields.length ===
                                                                0 && (
                                                                <div
                                                                    style={{
                                                                        textAlign:
                                                                            'center',
                                                                    }}
                                                                >
                                                                    <span
                                                                        style={{
                                                                            display:
                                                                                'block',
                                                                            marginTop: 10,
                                                                        }}
                                                                    >
                                                                        You do
                                                                        not have
                                                                        any
                                                                        custom
                                                                        fields
                                                                        at this
                                                                        time
                                                                    </span>
                                                                    <br />
                                                                </div>
                                                            )}
                                                    </div>
                                                </div>
                                            </div>

                                            <div
                                                className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12"
                                                style={{ paddingRight: 25 }}
                                            >
                                                <span className="db-SettingsForm-footerMessage"></span>
                                                <div className="bs-Tail-copy">
                                                    <div
                                                        className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                        style={{
                                                            marginTop: '10px',
                                                        }}
                                                    >
                                                        <ShouldRender
                                                            if={editError}
                                                        >
                                                            <div className="Box-root Margin-right--8">
                                                                <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                            </div>
                                                            <div className="Box-root">
                                                                <span
                                                                    style={{
                                                                        color:
                                                                            'red',
                                                                    }}
                                                                >
                                                                    {editError}
                                                                </span>
                                                            </div>
                                                        </ShouldRender>
                                                    </div>
                                                </div>

                                                <div>
                                                    <button
                                                        className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                                        disabled={
                                                            editingMonitor
                                                        }
                                                        type="submit"
                                                        id="saveMonitorCustomField"
                                                    >
                                                        {!editingMonitor && (
                                                            <span>
                                                                Save Fields
                                                            </span>
                                                        )}
                                                        {editingMonitor && (
                                                            <FormLoader />
                                                        )}
                                                    </button>
                                                </div>
                                            </div>
                                        </form>
                                    </div>
                                    <ShouldRender if={false}>
                                        <ListLoader />
                                    </ShouldRender>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ThirdPartyVariables.displayName = 'ThirdPartyVariables';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ThirdPartyVariables.propTypes = {
    currentProject: PropTypes.object,
    editMonitor: PropTypes.func,
    handleSubmit: PropTypes.func.isRequired,
    monitor: PropTypes.object,
    editingMonitor: PropTypes.bool,
    editError: PropTypes.string,
    fetchCustomFields: PropTypes.func,
    resetEditMonitor: PropTypes.func,
    customFields: PropTypes.array,
};

const ThirdPartyVariableForm = reduxForm({
    form: 'ThirdPartyVariableForm', // a unique identifier for this form
    enableReinitialize: true,
    destroyOnUnmount: true,
})(ThirdPartyVariables);

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        editMonitor,
        fetchCustomFields,
        resetEditMonitor,
    },
    dispatch
);

const mapStateToProps = (state: $TSFixMe, ownProps: $TSFixMe) => {
    const { monitor } = ownProps;
    const initialValues = {};
    if (monitor && monitor.customFields && monitor.customFields.length > 0) {
        monitor.customFields.forEach(
            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
            (field: $TSFixMe) => initialValues[field.fieldName] = field.fieldValue
        );
    }

    return {
        currentProject: state.project.currentProject,
        initialValues,
        formValues:
            state.form.ThirdPartyVariableForm &&
            state.form.ThirdPartyVariableForm.values,
        editingMonitor: state.monitor.editMonitor.requesting,
        editError: state.monitor.editMonitor.error,
        customFields: state.monitorCustomField.monitorCustomFields.fields,
    };
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(withRouter(ThirdPartyVariableForm));
