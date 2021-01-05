import React, { Component } from 'react';
import { withRouter } from 'react-router-dom';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import { Field, FieldArray, reduxForm } from 'redux-form';
import { FormLoader, ListLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { RenderField } from '../basic/RenderField';
import { editMonitor } from '../../actions/monitor';
import { SHOULD_LOG_ANALYTICS } from '../../config';
import { logEvent } from '../../analytics';

class ThirdPartyVariables extends Component {
    submitForm = values => {
        const { currentProject, monitor } = this.props;
        values._id = monitor._id;
        values.projectId = currentProject._id;

        if (values.thirdPartyVariable && values.thirdPartyVariable.length > 0) {
            const thirdPartyVariable = values.thirdPartyVariable.filter(
                variable =>
                    typeof variable === 'string' || typeof variable === 'number'
            );
            values.thirdPartyVariable = thirdPartyVariable.map(variable => {
                if (!isNaN(variable)) {
                    variable = Number(variable);
                }
                return variable;
            });
        }

        this.props.editMonitor(currentProject._id, values);

        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > MONITOR > INTEGRATION > THIRD PARTY VARIABLE'
            );
        }
    };

    renderVariables = ({ fields }) => {
        const { formValues } = this.props;

        return (
            <>
                <div
                    style={{
                        width: '100%',
                    }}
                >
                    <button
                        id="addVariable"
                        className="Button bs-ButtonLegacy ActionIconParent"
                        type="button"
                        onClick={() => {
                            fields.push();
                        }}
                    ></button>
                    {formValues &&
                        (!formValues.thirdPartyVariable ||
                            formValues.thirdPartyVariable.length === 0) && (
                            <span
                                style={{
                                    display: 'block',
                                    textAlign: 'center',
                                }}
                            >
                                You do not have any variable on this monitor
                            </span>
                        )}
                    {fields.map((field, index) => {
                        return (
                            <div
                                style={{
                                    width: '65%',
                                    marginBottom: 10,
                                    marginTop: 10,
                                }}
                                key={index}
                            >
                                <Field
                                    component={RenderField}
                                    name={field}
                                    id={`variable_${index}`}
                                    placeholder="Any variable"
                                    className="bs-TextInput"
                                    style={{
                                        width: '100%',
                                        padding: '3px 5px',
                                    }}
                                />
                                <button
                                    id="removeVariable"
                                    className="Button bs-ButtonLegacy ActionIconParent"
                                    style={{
                                        marginTop: 10,
                                    }}
                                    type="button"
                                    onClick={() => {
                                        fields.remove(index);
                                    }}
                                >
                                    <span className="bs-Button bs-Button--icon bs-Button--delete">
                                        <span>Remove Variable</span>
                                    </span>
                                </button>
                            </div>
                        );
                    })}
                </div>
            </>
        );
    };

    render() {
        const { handleSubmit, editingMonitor, editError } = this.props;

        return (
            <div className="Box-root Margin-vertical--12">
                <div className="db-RadarRulesLists-page">
                    <div className="Box-root Margin-bottom--12">
                        <div className="bs-ContentSection Card-root Card-shadow--medium">
                            <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                    <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                        <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                            <span>Third Party Variables</span>
                                        </span>
                                        <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                            <span>
                                                List of all the available third
                                                party variables for this monitor
                                            </span>
                                        </span>
                                    </div>
                                    <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                        <div className="Box-root">
                                            <button
                                                className="Button bs-ButtonLegacy ActionIconParent"
                                                type="button"
                                                id="altAddVariable"
                                                onClick={() => {
                                                    document
                                                        .querySelector(
                                                            '#addVariable'
                                                        )
                                                        .click();
                                                }}
                                            >
                                                <div className="bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                    <div className="Box-root Margin-right--8">
                                                        <div className="SVGInline SVGInline--cleaned Button-icon ActionIcon ActionIcon--color--inherit Box-root Flex-flex"></div>
                                                    </div>
                                                    <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                                                        <span>
                                                            Add Variable
                                                        </span>
                                                    </span>
                                                </div>
                                            </button>
                                        </div>
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
                                                        <fieldset
                                                            data-test="RetrySettings-failedAndExpiring"
                                                            className="bs-Fieldset"
                                                        >
                                                            <div className="bs-Fieldset-rows">
                                                                <div className="bs-Fieldset-row">
                                                                    <label
                                                                        className="bs-Fieldset-label"
                                                                        style={{
                                                                            flex:
                                                                                '25% 0 0',
                                                                        }}
                                                                    >
                                                                        <span></span>
                                                                    </label>
                                                                    <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                                        <div
                                                                            className="Box-root"
                                                                            style={{
                                                                                height:
                                                                                    '5px',
                                                                            }}
                                                                        ></div>
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
                                                                                        marginTop: 10,
                                                                                    }}
                                                                                >
                                                                                    <FieldArray
                                                                                        name="thirdPartyVariable"
                                                                                        component={
                                                                                            this
                                                                                                .renderVariables
                                                                                        }
                                                                                    />
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
                                                        id="saveMonitorVariables"
                                                    >
                                                        {!editingMonitor && (
                                                            <span>
                                                                Save Variables
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

ThirdPartyVariables.displayName = 'ThirdPartyVariables';

ThirdPartyVariables.propTypes = {
    currentProject: PropTypes.object,
    editMonitor: PropTypes.func,
    handleSubmit: PropTypes.func.isRequired,
    formValues: PropTypes.object,
    monitor: PropTypes.object,
    editingMonitor: PropTypes.bool,
    editError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
};

const ThirdPartyVariableForm = reduxForm({
    form: 'ThirdPartyVariableForm', // a unique identifier for this form
    enableReinitialize: true,
    destroyOnUnmount: true,
})(ThirdPartyVariables);

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            editMonitor,
        },
        dispatch
    );

const mapStateToProps = (state, ownProps) => {
    const { monitor } = ownProps;
    const initialValues = {};
    if (
        monitor &&
        monitor.thirdPartyVariable &&
        monitor.thirdPartyVariable.length > 0
    ) {
        initialValues.thirdPartyVariable = monitor.thirdPartyVariable;
    }

    return {
        currentProject: state.project.currentProject,
        initialValues,
        formValues:
            state.form.ThirdPartyVariableForm &&
            state.form.ThirdPartyVariableForm.values,
        editingMonitor: state.monitor.editMonitor.requesting,
        editError: state.monitor.editMonitor.error,
    };
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(withRouter(ThirdPartyVariableForm));
