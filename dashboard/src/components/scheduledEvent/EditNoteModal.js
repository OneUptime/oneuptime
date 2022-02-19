import React, { Component } from 'react';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import { ValidateField } from '../../config';
import { Field, reduxForm, change } from 'redux-form';
import { connect } from 'react-redux';
import ClickOutside from 'react-click-outside';
import { closeModal } from '../../actions/modal';
import { bindActionCreators } from 'redux';

import { RenderField } from '../basic/RenderField';
import { RenderSelect } from '../basic/RenderSelect';
import {
    updateScheduledEventNoteInternal,
    updateScheduledEventNoteInvestigation,
} from '../../actions/scheduledEvent';
import RenderCodeEditor from '../basic/RenderCodeEditor';

class EditNoteModal extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    validate = values => {
        const errors = {};
        if (!ValidateField.text(values[`content`])) {
            errors.name = 'Note content is required.';
        }
        if (!ValidateField.text(values[`event_state`])) {
            errors.name = 'Incident State is required.';
        }
        if (
            values[`event_state`] === 'others' &&
            !ValidateField.text(values[`custom_event_state`])
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
            updateInternalError,
        } = this.props;
        const postObj = {};
        postObj.content = values[`content`];
        postObj.event_state =
            values[`event_state`] === 'others'
                ? values[`custom_event_state`]
                : values[`event_state`];
        updateScheduledEventNoteInternal(
            projectId,
            scheduledEventId,
            scheduledEventNoteId,
            postObj
        ).then(() => {
            if (!updateInternalError) {
                return closeModal({ id: modalId });
            }
        });
    };

    handleKeyBoard = e => {
        const { closeThisDialog, data } = this.props;
        if (e.target.localName !== 'textarea' && e.key) {
            switch (e.key) {
                case 'Escape':
                    return closeThisDialog();
                case 'Enter':
                    if (e.target.localName !== 'textarea') {
                        return document
                            .getElementById(`${data.type}-updateButton`)
                            .click();
                    }
                    return;
                default:
                    return false;
            }
        }
    };

    onContentChange = val => {
        this.props.change('content', val);
    };

    render() {
        const {
            handleSubmit,
            event_state,
            updatingInternalNote,
            updatingInvestigationNote,
            updateInternalError,
            updateInvestigationError,
            closeThisDialog,
        } = this.props;
        const { type } = this.props.data;

        return (
            <div
                className="ModalLayer-contents"
                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM">
                    <div className="bs-Modal bs-Modal--large">
                        <ClickOutside onClickOutside={closeThisDialog}>
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
                                id={`form-update-schedule-${type}-message`}
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
                                                            component={
                                                                RenderSelect
                                                            }
                                                            name="event_state"
                                                            id="event_state"
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
                                                                    value:
                                                                        'update',
                                                                    label:
                                                                        'Update',
                                                                },
                                                                {
                                                                    value:
                                                                        'others',
                                                                    label:
                                                                        'Others',
                                                                },
                                                            ]}
                                                            autoFocus={true}
                                                        />
                                                    </div>
                                                </div>
                                                <ShouldRender
                                                    if={
                                                        event_state === 'others'
                                                    }
                                                >
                                                    <div className="bs-Fieldset-row">
                                                        <label className="bs-Fieldset-label">
                                                            Custom Incident
                                                            State
                                                        </label>
                                                        <div className="bs-Fieldset-fields">
                                                            <Field
                                                                className="db-BusinessSettings-input-300 TextInput bs-TextInput"
                                                                component={
                                                                    RenderField
                                                                }
                                                                type="text"
                                                                name={`custom_event_state`}
                                                                id="custom_event_state"
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
                                                            <Field
                                                                name="content"
                                                                component={
                                                                    RenderCodeEditor
                                                                }
                                                                id="update-internal"
                                                                mode="markdown"
                                                                height="150px"
                                                                width="100%"
                                                                placeholder="This can be markdown"
                                                                wrapEnabled={
                                                                    true
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
                                                    type === 'internal' &&
                                                    updateInternalError
                                                }
                                            >
                                                <div className="Box-root Margin-right--8">
                                                    <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                </div>
                                                <div className="Box-root">
                                                    <span
                                                        style={{ color: 'red' }}
                                                    >
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
                                                    <span
                                                        style={{ color: 'red' }}
                                                    >
                                                        {
                                                            updateInvestigationError
                                                        }
                                                    </span>
                                                </div>
                                            </ShouldRender>
                                        </div>
                                    </div>
                                    <span className="db-SettingsForm-footerMessage"></span>
                                    <ShouldRender if={type === 'internal'}>
                                        <div style={{ display: 'flex' }}>
                                            <button
                                                className="bs-Button bs-DeprecatedButton btn__modal"
                                                type="button"
                                                onClick={
                                                    this.props.closeThisDialog
                                                }
                                                disabled={updatingInternalNote}
                                            >
                                                <span>Cancel</span>
                                                <span className="cancel-btn__keycode">
                                                    Esc
                                                </span>
                                            </button>
                                            <button
                                                id={`${type}-updateButton`}
                                                className="bs-Button bs-Button--blue btn__modal"
                                                type="submit"
                                                disabled={updatingInternalNote}
                                            >
                                                <ShouldRender
                                                    if={!updatingInternalNote}
                                                >
                                                    <span>Update</span>
                                                    <span className="create-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
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
                                        <div style={{ display: 'flex' }}>
                                            <button
                                                className="bs-Button bs-DeprecatedButton btn__modal"
                                                type="button"
                                                onClick={
                                                    this.props.closeThisDialog
                                                }
                                                disabled={
                                                    updatingInvestigationNote
                                                }
                                            >
                                                <span>Cancel</span>
                                                <span className="cancel-btn__keycode">
                                                    Esc
                                                </span>
                                            </button>
                                            <button
                                                id={`${type}-updateButton`}
                                                className="bs-Button bs-Button--blue btn__modal"
                                                type="submit"
                                                disabled={
                                                    updatingInvestigationNote
                                                }
                                            >
                                                <ShouldRender
                                                    if={
                                                        !updatingInvestigationNote
                                                    }
                                                >
                                                    <span>Update</span>
                                                    <span className="create-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </ShouldRender>

                                                <ShouldRender
                                                    if={
                                                        updatingInvestigationNote
                                                    }
                                                >
                                                    <FormLoader />
                                                </ShouldRender>
                                            </button>
                                        </div>
                                    </ShouldRender>
                                </div>
                            </form>
                        </ClickOutside>
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

    const event_state =
        state.form.EditNote &&
        state.form.EditNote.values &&
        state.form.EditNote.values.event_state;

    const initialValues = {
        event_state:
            note.event_state === 'investigating' ||
            note.event_state === 'update'
                ? note.event_state
                : 'others',
        custom_event_state: note.event_state,
        content: note.content,
    };

    return {
        currentProject,
        event_state,
        modalId: state.modal.modals[0].id,
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
    event_state: PropTypes.string,
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
    change: PropTypes.func,
    updateScheduledEventNoteInternal: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(EditNoteModalForm);
