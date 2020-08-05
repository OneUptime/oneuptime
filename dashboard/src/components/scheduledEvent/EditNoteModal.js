import React, { Component } from 'react';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import { ValidateField, SHOULD_LOG_ANALYTICS } from '../../config';
import { Field, reduxForm, change } from 'redux-form';
import { connect } from 'react-redux';
import { closeModal } from '../../actions/modal';
import { bindActionCreators } from 'redux';
import { logEvent } from '../../analytics';
import { RenderField } from '../basic/RenderField';
import { RenderSelect } from '../basic/RenderSelect';
import CodeEditor from '../basic/CodeEditor';
import {
    updateScheduledEventNoteInternal,
    updateScheduledEventNoteInvestigation,
} from '../../actions/scheduledEvent';

class EditNoteModal extends Component {
    validate = values => {
        const errors = {};
        if (!ValidateField.text(values[`content`])) {
            errors.name = 'Note content is required.';
        }
        if (!ValidateField.text(values[`incident_state`])) {
            errors.name = 'Incident State is required.';
        }
        if (
            values[`incident_state`] === 'others' &&
            !ValidateField.text(values[`custom_incident_state`])
        ) {
            errors.name = 'Custom Incident State is required.';
        }
        return errors;
    };

    submitForm = values => {
        const {
            data: { projectId, scheduledEventId, scheduledEventNoteId, type },
            modalId,
            closeModal,
            updateScheduledEventNoteInternal,
            updateScheduledEventNoteInvestigation,
            updateInternalError,
            updateInvestigationError,
        } = this.props;
        const postObj = {};
        postObj.content = values[`content`];
        postObj.incident_state =
            values[`incident_state`] === 'others'
                ? values[`custom_incident_state`]
                : values[`incident_state`];
        postObj.type = type;

        if (type === 'internal') {
            updateScheduledEventNoteInternal(
                projectId,
                scheduledEventId,
                scheduledEventNoteId,
                postObj
            ).then(() => {
                if (!updateInternalError) {
                    if (SHOULD_LOG_ANALYTICS) {
                        logEvent(
                            `EVENT: DASHBOARD > PROJECT > SCHEDULED EVENT > INCIDENT > ${type} INVESTIGATION MESSAGE`,
                            values
                        );
                    }

                    return closeModal({ id: modalId });
                }
            });
        }

        if (type === 'investigation') {
            updateScheduledEventNoteInvestigation(
                projectId,
                scheduledEventId,
                scheduledEventNoteId,
                postObj
            ).then(() => {
                if (!updateInvestigationError) {
                    if (SHOULD_LOG_ANALYTICS) {
                        logEvent(
                            `EVENT: DASHBOARD > PROJECT > SCHEDULED EVENT > INCIDENT > ${type} INVESTIGATION MESSAGE`,
                            values
                        );
                    }

                    return closeModal({ id: modalId });
                }
            });
        }
    };

    handleKeyBoard = e => {
        const { closeThisDialog } = this.props;
        switch (e.key) {
            case 'Escape':
                return closeThisDialog();
            default:
                return false;
        }
    };

    onContentChange = val => {
        this.props.change('content', val);
    };

    render() {
        const {
            handleSubmit,
            incident_state,
            updatingInternalNote,
            updatingInvestigationNote,
            updateInternalError,
            updateInvestigationError,
            content,
        } = this.props;
        const { type } = this.props.data;

        return (
            <div
                onKeyDown={this.handleKeyBoard}
                className="ModalLayer-contents"
                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM">
                    <div className="bs-Modal bs-Modal--large">
                        <div className="bs-Modal-header">
                            <div
                                className="bs-Modal-header-copy"
                                style={{
                                    marginBottom: '10px',
                                    marginTop: '10px',
                                }}
                            >
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span id="incidentMessageTitleLabel">
                                        {`Update ${type
                                            .charAt(0)
                                            .toUpperCase()}${type.slice(
                                            1
                                        )} Note`}
                                    </span>
                                </span>
                            </div>
                        </div>
                        <form
                            id={`form-new-schedule-${type}-message`}
                            onSubmit={handleSubmit(this.submitForm)}
                        >
                            <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                                <div>
                                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                        <fieldset className="bs-Fieldset">
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    Incident State
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <Field
                                                        className="db-select-nw-300"
                                                        component={RenderSelect}
                                                        name="incident_state"
                                                        id="incident_state"
                                                        placeholder="Incident State"
                                                        disabled={false}
                                                        validate={
                                                            ValidateField.select
                                                        }
                                                        style={{
                                                            width: '300px',
                                                        }}
                                                        options={[
                                                            {
                                                                value:
                                                                    'investigating',
                                                                label:
                                                                    'Investigating',
                                                            },
                                                            {
                                                                value: 'update',
                                                                label: 'Update',
                                                            },
                                                            {
                                                                value: 'others',
                                                                label: 'Others',
                                                            },
                                                        ]}
                                                    />
                                                </div>
                                            </div>
                                            <ShouldRender
                                                if={incident_state === 'others'}
                                            >
                                                <div className="bs-Fieldset-row">
                                                    <label className="bs-Fieldset-label">
                                                        Custom Incident State
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <Field
                                                            className="db-BusinessSettings-input-300 TextInput bs-TextInput"
                                                            component={
                                                                RenderField
                                                            }
                                                            type="text"
                                                            name={`custom_incident_state`}
                                                            id="custom_incident_state"
                                                            placeholder="Enter a custom incident state"
                                                            validate={
                                                                ValidateField.text
                                                            }
                                                        />
                                                    </div>
                                                </div>
                                            </ShouldRender>
                                            <div className="bs-Fieldset-rows">
                                                <div className="bs-Fieldset-row">
                                                    <ShouldRender if={true}>
                                                        <label className="bs-Fieldset-label">
                                                            {`${type
                                                                .charAt(0)
                                                                .toUpperCase()}${type.slice(
                                                                1
                                                            )} Notes`}
                                                        </label>
                                                    </ShouldRender>
                                                    <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                        <CodeEditor
                                                            code={content}
                                                            onCodeChange={
                                                                this
                                                                    .onContentChange
                                                            }
                                                            textareaId={`new-${type}`}
                                                            placeholder="This can be markdown"
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
                                                type === 'internal' &&
                                                updateInternalError
                                            }
                                        >
                                            <div className="Box-root Margin-right--8">
                                                <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                            </div>
                                            <div className="Box-root">
                                                <span style={{ color: 'red' }}>
                                                    {updateInternalError}
                                                </span>
                                            </div>
                                        </ShouldRender>
                                        <ShouldRender
                                            if={
                                                type === 'investigation' &&
                                                updateInvestigationError
                                            }
                                        >
                                            <div className="Box-root Margin-right--8">
                                                <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                            </div>
                                            <div className="Box-root">
                                                <span style={{ color: 'red' }}>
                                                    {updateInvestigationError}
                                                </span>
                                            </div>
                                        </ShouldRender>
                                    </div>
                                </div>
                                <span className="db-SettingsForm-footerMessage"></span>
                                <ShouldRender if={type === 'internal'}>
                                    <div>
                                        <button
                                            className="bs-Button bs-DeprecatedButton"
                                            type="button"
                                            onClick={this.props.closeThisDialog}
                                            disabled={updatingInternalNote}
                                        >
                                            <span>Cancel</span>
                                        </button>
                                        <button
                                            id={`${type}-addButton`}
                                            className="bs-Button bs-Button--blue"
                                            type="submit"
                                            disabled={updatingInternalNote}
                                        >
                                            <ShouldRender
                                                if={!updatingInternalNote}
                                            >
                                                <span>Update</span>
                                            </ShouldRender>

                                            <ShouldRender
                                                if={updatingInternalNote}
                                            >
                                                <FormLoader />
                                            </ShouldRender>
                                        </button>
                                    </div>
                                </ShouldRender>
                                <ShouldRender if={type === 'investigation'}>
                                    <div>
                                        <button
                                            className="bs-Button bs-DeprecatedButton"
                                            type="button"
                                            onClick={this.props.closeThisDialog}
                                            disabled={updatingInvestigationNote}
                                        >
                                            <span>Cancel</span>
                                        </button>
                                        <button
                                            id={`${type}-addButton`}
                                            className="bs-Button bs-Button--blue"
                                            type="submit"
                                            disabled={updatingInvestigationNote}
                                        >
                                            <ShouldRender
                                                if={!updatingInvestigationNote}
                                            >
                                                <span>Update</span>
                                            </ShouldRender>

                                            <ShouldRender
                                                if={updatingInvestigationNote}
                                            >
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

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            closeModal,
            change,
            updateScheduledEventNoteInternal,
            updateScheduledEventNoteInvestigation,
        },
        dispatch
    );

const mapStateToProps = state => {
    const currentProject = state.project.currentProject;
    const note = state.modal.modals[0].note;

    const incident_state =
        state.form.EditNote &&
        state.form.EditNote.values &&
        state.form.EditNote.values.incident_state;

    const content =
        (state.form.EditNote &&
            state.form.EditNote.values &&
            state.form.EditNote.values.content) ||
        note.content;

    const initialValues = {
        incident_state:
            note.incident_state === 'investigating' ||
            note.incident_state === 'update'
                ? note.incident_state
                : 'others',
        custom_incident_state: note.incident_state,
        content: note.content,
    };

    return {
        currentProject,
        incident_state,
        modalId: state.modal.modals[0].id,
        content,
        initialValues,
        updatingInternalNote:
            state.scheduledEvent.updateScheduledEventNoteInternal.requesting,
        updateInternalError:
            state.scheduledEvent.updateScheduledEventNoteInternal.error,
        updatingInvestigationNote:
            state.scheduledEvent.updateScheduledEventNoteInvestigation
                .requesting,
        updateInvestigationError:
            state.scheduledEvent.updateScheduledEventNoteInvestigation.error,
    };
};

EditNoteModal.displayName = 'EditNoteModal';

const EditNoteModalForm = reduxForm({
    form: 'EditNote',
    destroyOnUnmount: true,
    enableReinitialize: true,
})(EditNoteModal);

EditNoteModal.propTypes = {
    data: PropTypes.object,
    handleSubmit: PropTypes.func,
    closeThisDialog: PropTypes.func,
    incident_state: PropTypes.string,
    updatingInternalNote: PropTypes.bool,
    updatingInvestigationNote: PropTypes.bool,
    updateInternalError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    updateInvestigationError: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    modalId: PropTypes.string,
    closeModal: PropTypes.func,
    content: PropTypes.string,
    change: PropTypes.func,
    updateScheduledEventNoteInternal: PropTypes.func,
    updateScheduledEventNoteInvestigation: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(EditNoteModalForm);
