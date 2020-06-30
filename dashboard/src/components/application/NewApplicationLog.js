import React, { Component } from 'react';
import { RenderField } from '../basic/RenderField';
import { ValidateField } from '../../config';
import { Field, reduxForm, formValueSelector } from 'redux-form';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { logEvent } from '../../analytics';
import { SHOULD_LOG_ANALYTICS } from '../../config';
import { bindActionCreators } from 'redux';
import {
    createApplicationLog,
    createApplicationLogSuccess,
    createApplicationLogFailure,
    editApplicationLogSwitch,
    editApplicationLog,
} from '../../actions/applicationLog';
const selector = formValueSelector('NewApplicationLog');

class NewApplicationLog extends Component {
    validate = values => {
        const errors = {};
        if (!ValidateField.text(values[`name`])) {
            errors.name = 'Application Name is required.';
        }
        return errors;
    };
    cancelEdit = () => {
        this.props.editApplicationLogSwitch(this.props.index);
    };
    submitForm = values => {
        const thisObj = this;
        const postObj = {};
        postObj.name = values[`name`];
        if (!this.props.edit) {
            this.props
                .createApplicationLog(
                    this.props.currentProject._id,
                    this.props.componentId,
                    postObj
                )
                .then(
                    () => {
                        thisObj.props.reset();
                        thisObj.props.closeCreateApplicationLogModal();
                        if (SHOULD_LOG_ANALYTICS) {
                            logEvent(
                                'EVENT: DASHBOARD > PROJECT > COMPONENT > APPLICATION LOG > NEW APPLICATION LOG',
                                values
                            );
                        }
                    },
                    error => {
                        if (error && error.message) {
                            return error;
                        }
                    }
                );
        } else {
            this.props
                .editApplicationLog(
                    this.props.currentProject._id,
                    this.props.componentId,
                    this.props.applicationLog._id,
                    postObj
                )
                .then(
                    () => {
                        thisObj.props.reset();
                        thisObj.props.closeCreateApplicationLogModal();
                        if (SHOULD_LOG_ANALYTICS) {
                            logEvent(
                                'EVENT: DASHBOARD > PROJECT > COMPONENT > APPLICATION LOG > EDIT APPLICATION LOG',
                                values
                            );
                        }
                    },
                    error => {
                        if (error && error.message) {
                            return error;
                        }
                    }
                );
        }
    };
    render() {
        const { handleSubmit, requesting, edit, applicationLog } = this.props;

        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <ShouldRender if={!edit}>
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>New Log Container</span>
                                    </span>
                                    <p>
                                        <span>
                                            Create an application log so you and
                                            your team can monitor the logs
                                            related to it.
                                        </span>
                                    </p>
                                </ShouldRender>
                                <ShouldRender if={edit}>
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>Edit Log Container</span>
                                    </span>
                                    <p>
                                        <span
                                            id={`application-log-edit-title-${applicationLog?.name}`}
                                        >
                                            {`Edit Log Container ${applicationLog?.name}`}
                                        </span>
                                    </p>
                                </ShouldRender>
                            </div>
                        </div>
                        <form
                            id="form-new-application-log"
                            onSubmit={handleSubmit(this.submitForm)}
                        >
                            <div
                                className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-vertical--2"
                                style={{ boxShadow: 'none' }}
                            >
                                <div>
                                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                        <fieldset className="bs-Fieldset">
                                            <div className="bs-Fieldset-rows">
                                                <div className="bs-Fieldset-row">
                                                    <label className="bs-Fieldset-label">
                                                        Name
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <Field
                                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                                            component={
                                                                RenderField
                                                            }
                                                            type="text"
                                                            name={`name`}
                                                            id="name"
                                                            placeholder="Application Name"
                                                            validate={
                                                                ValidateField.text
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
                                <div className="bs-Tail-copy">
                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                        <ShouldRender
                                            if={
                                                this.props.applicationLogState
                                                    .newApplicationLog.error
                                            }
                                        >
                                            <div className="Box-root Margin-right--8">
                                                <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                            </div>
                                            <div className="Box-root">
                                                <span style={{ color: 'red' }}>
                                                    {
                                                        this.props
                                                            .applicationLogState
                                                            .newApplicationLog
                                                            .error
                                                    }
                                                </span>
                                            </div>
                                        </ShouldRender>
                                        <ShouldRender
                                            if={
                                                this.props.applicationLogState
                                                    .editApplicationLog.error
                                            }
                                        >
                                            <div className="Box-root Margin-right--8">
                                                <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                            </div>
                                            <div className="Box-root">
                                                <span style={{ color: 'red' }}>
                                                    {
                                                        this.props
                                                            .applicationLogState
                                                            .editApplicationLog
                                                            .error
                                                    }
                                                </span>
                                            </div>
                                        </ShouldRender>
                                    </div>
                                </div>
                                <ShouldRender if={!edit}>
                                    <div>
                                        <button
                                            id="addApplicationLogButton"
                                            className="bs-Button bs-Button--blue"
                                            type="submit"
                                        >
                                            <ShouldRender if={!requesting}>
                                                <span>Add Application </span>
                                            </ShouldRender>

                                            <ShouldRender if={requesting}>
                                                <FormLoader />
                                            </ShouldRender>
                                        </button>
                                    </div>
                                </ShouldRender>
                                <ShouldRender if={edit}>
                                    <div>
                                        <button
                                            className="bs-Button"
                                            disabled={requesting}
                                            onClick={this.cancelEdit}
                                        >
                                            <span>Cancel</span>
                                        </button>
                                        <button
                                            id="addApplicationLogButton"
                                            className="bs-Button bs-Button--blue"
                                            type="submit"
                                        >
                                            <ShouldRender if={!requesting}>
                                                <span>Edit Application </span>
                                            </ShouldRender>

                                            <ShouldRender if={requesting}>
                                                <FormLoader />
                                            </ShouldRender>
                                        </button>
                                    </div>
                                </ShouldRender>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        );
    }
}

NewApplicationLog.displayName = 'NewApplicationLog';

const NewApplicationLogForm = new reduxForm({
    form: 'NewApplicationLog',
    destroyOnUnmount: true,
    enableReinitialize: true,
})(NewApplicationLog);

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            createApplicationLog,
            createApplicationLogSuccess,
            createApplicationLogFailure,
            editApplicationLogSwitch,
            editApplicationLog,
        },
        dispatch
    );

const mapStateToProps = (state, ownProps) => {
    const name = selector(state, 'name');
    const componentId = ownProps.componentId;
    const requesting = state.applicationLog.newApplicationLog.requesting;
    const currentProject = state.project.currentProject;
    const initialValues = {
        name: ownProps.applicationLog ? ownProps.applicationLog.name : '',
    };
    return {
        applicationLogState: state.applicationLog,
        name,
        componentId,
        requesting,
        currentProject,
        initialValues,
    };
};

NewApplicationLog.propTypes = {
    index: PropTypes.oneOfType([
        PropTypes.string.isRequired,
        PropTypes.number.isRequired,
    ]),
    createApplicationLog: PropTypes.func.isRequired,
    applicationLogState: PropTypes.object.isRequired,
    applicationLog: PropTypes.object,
    handleSubmit: PropTypes.func.isRequired,
    componentId: PropTypes.string,
    requesting: PropTypes.bool,
    currentProject: PropTypes.object,
    edit: PropTypes.bool,
    editApplicationLogSwitch: PropTypes.func,
    editApplicationLog: PropTypes.func,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(NewApplicationLogForm);
