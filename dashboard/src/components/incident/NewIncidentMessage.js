import React, { Component } from 'react';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import { ValidateField, SHOULD_LOG_ANALYTICS } from '../../config';
import { Field, reduxForm, formValueSelector } from 'redux-form';
import { connect } from 'react-redux';
import { RenderTextArea } from '../basic/RenderTextArea';
import {
    setInvestigationNote,
    editIncidentMessageSwitch,
    setInternalNote,
} from '../../actions/incident';
import { bindActionCreators } from 'redux';
import { logEvent } from '../../analytics';
const selector = formValueSelector('NewIncidentMessage');

class NewIncidentMessage extends Component {
    validate = values => {
        const errors = {};
        if (!ValidateField.text(values[`content`])) {
            errors.name = 'Incident Message is required.';
        }
        return errors;
    };
    cancelEdit = () => {
        this.props.editIncidentMessageSwitch(this.props.incidentMessage);
    };
    submitForm = values => {
        const thisObj = this;
        const postObj = {};
        postObj.content = values[`content`];
        let mode = 'NEW';
        if (this.props.edit) {
            postObj.id = this.props.incidentMessage._id;
        } else {
            postObj.type = this.props.type;
            mode = 'EDIT';
        }

        if (this.props.type === 'investigation') {
            this.props
                .setInvestigationNote(
                    this.props.currentProject._id,
                    this.props.incident._id,
                    postObj
                )
                .then(
                    () => {
                        thisObj.props.reset();
                        if (SHOULD_LOG_ANALYTICS) {
                            logEvent(
                                `EVENT: DASHBOARD > PROJECT > MONITOR > INCIDENT > ${mode} INVESTIGATION MESSAGE`,
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
                .setInternalNote(
                    this.props.currentProject._id,
                    this.props.incident._id,
                    postObj
                )
                .then(
                    () => {
                        thisObj.props.reset();
                        if (SHOULD_LOG_ANALYTICS) {
                            logEvent(
                                `EVENT: DASHBOARD > PROJECT > MONITOR > INCIDENT > ${mode} INVESTIGATION MESSAGE`,
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
        const { handleSubmit, incidentMessageState, edit, type } = this.props;
        return (
            <div>
                <form
                    id="form-new-incident-message"
                    onSubmit={handleSubmit(this.submitForm)}
                >
                    <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                        <div>
                            <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                <fieldset className="bs-Fieldset">
                                    <div className="bs-Fieldset-rows">
                                        <div className="bs-Fieldset-row">
                                            <ShouldRender if={!edit}>
                                                <label className="bs-Fieldset-label">
                                                    {`${type
                                                        .charAt(0)
                                                        .toUpperCase()}${type.slice(
                                                        1
                                                    )} Notes`}
                                                </label>
                                            </ShouldRender>
                                            <ShouldRender if={edit}>
                                                <label className="bs-Fieldset-label">
                                                    {`Update your ${type
                                                        .charAt(0)
                                                        .toUpperCase()}${type.slice(
                                                        1
                                                    )} Note`}
                                                </label>
                                            </ShouldRender>
                                            <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                <Field
                                                    component={RenderTextArea}
                                                    type="text"
                                                    name={`content`}
                                                    id="content"
                                                    className="bs-TextArea"
                                                    rows="2"
                                                    placeholder="Add a message to the thread"
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
                                        this.props.incidentMessageState.error &&
                                        edit
                                    }
                                >
                                    <div className="Box-root Margin-right--8">
                                        <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                    </div>
                                    <div className="Box-root">
                                        <span style={{ color: 'red' }}>
                                            {
                                                this.props.incidentMessageState
                                                    .error
                                            }
                                        </span>
                                    </div>
                                </ShouldRender>
                                <ShouldRender
                                    if={
                                        this.props.incidentMessageState.error &&
                                        !edit
                                    }
                                >
                                    <div className="Box-root Margin-right--8">
                                        <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                    </div>
                                    <div className="Box-root">
                                        <span style={{ color: 'red' }}>
                                            {
                                                this.props.incidentMessageState
                                                    .error
                                            }
                                        </span>
                                    </div>
                                </ShouldRender>
                            </div>
                        </div>
                        <span className="db-SettingsForm-footerMessage"></span>
                        <ShouldRender if={!edit}>
                            <div>
                                <button
                                    id="addIncidentMessageButton"
                                    className="bs-Button bs-Button--blue"
                                    type="submit"
                                >
                                    <ShouldRender
                                        if={!incidentMessageState.requesting}
                                    >
                                        <span>Save </span>
                                    </ShouldRender>

                                    <ShouldRender
                                        if={incidentMessageState.requesting}
                                    >
                                        <FormLoader />
                                    </ShouldRender>
                                </button>
                            </div>
                        </ShouldRender>
                        <ShouldRender if={edit}>
                            <div>
                                <button
                                    className="bs-Button"
                                    disabled={incidentMessageState.requesting}
                                    onClick={this.cancelEdit}
                                >
                                    <span>Cancel</span>
                                </button>
                                <button
                                    id="addIncidentMessageButton"
                                    className="bs-Button bs-Button--blue"
                                    type="submit"
                                >
                                    <ShouldRender
                                        if={!incidentMessageState.requesting}
                                    >
                                        <span>Update </span>
                                    </ShouldRender>

                                    <ShouldRender
                                        if={incidentMessageState.requesting}
                                    >
                                        <FormLoader />
                                    </ShouldRender>
                                </button>
                            </div>
                        </ShouldRender>
                    </div>
                </form>
            </div>
        );
    }
}

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            setInvestigationNote,
            editIncidentMessageSwitch,
            setInternalNote,
        },
        dispatch
    );

const mapStateToProps = (state, ownProps) => {
    const content = selector(state, 'content');
    const incidentMessageState =
        ownProps.type === 'investigation'
            ? state.incident.investigationNotes
            : state.incident.internalNotes;
    const initialValues = {
        content: ownProps.incidentMessage
            ? ownProps.incidentMessage.content
            : '',
    };
    const currentProject = state.project.currentProject;
    return {
        content,
        initialValues,
        incidentMessageState,
        currentProject,
        form: ownProps.formId,
    };
};
NewIncidentMessage.displayName = 'NewIncidentMessage';
const NewIncidentMessageForm = new reduxForm({
    destroyOnUnmount: true,
    enableReinitialize: true,
})(NewIncidentMessage);
NewIncidentMessage.propTypes = {
    incident: PropTypes.object,
    incidentMessage: PropTypes.object,
    incidentMessageState: PropTypes.object,
    currentProject: PropTypes.object,
    setInvestigationNote: PropTypes.func,
    handleSubmit: PropTypes.func,
    edit: PropTypes.bool,
    type: PropTypes.string,
    editIncidentMessageSwitch: PropTypes.func,
    setInternalNote: PropTypes.func,
};
export default connect(
    mapStateToProps,
    mapDispatchToProps
)(NewIncidentMessageForm);
