import React, { Component } from 'react';
import PropTypes from 'prop-types';

import ClickOutside from 'react-click-outside';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import { ValidateField } from '../../config';

import { Field, reduxForm, change } from 'redux-form';
import { connect } from 'react-redux';
import { closeModal } from '../../actions/modal';
import { bindActionCreators } from 'redux';

import { RenderField } from '../basic/RenderField';
import { RenderSelect } from '../basic/RenderSelect';
import { createScheduledEventNote } from '../../actions/scheduledEvent';
import RenderCodeEditor from '../basic/RenderCodeEditor';

class AddNoteModal extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    validate = (values: $TSFixMe) => {
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

    submitForm = (values: $TSFixMe) => {
        const {

            data: { projectId, scheduledEventId, type },

            createScheduledEventNote,

            createError,

            modalId,

            closeModal,
        } = this.props;
        const postObj = {};
        if (values.external_note) {

            postObj.external_note = values['external_note'];
        }

        postObj.content = values[`content`];

        postObj.event_state =
            values[`event_state`] === 'others'
                ? values[`custom_event_state`]
                : values[`event_state`];

        postObj.type = type;

        createScheduledEventNote(projectId, scheduledEventId, postObj).then(
            () => {
                if (!createError) {
                    return closeModal({ id: modalId });
                }
            }
        );
    };

    handleKeyBoard = (e: $TSFixMe) => {

        const { closeThisDialog, data } = this.props;
        if (e.target.localName !== 'textarea' && e.key) {
            switch (e.key) {
                case 'Escape':
                    return closeThisDialog();
                case 'Enter':
                    if (e.target.localName !== 'textarea') {

                        return document
                            .getElementById(`${data.type}-addButton`)
                            .click();
                    }
                    return;
                default:
                    return false;
            }
        }
    };

    onContentChange = (val: $TSFixMe) => {

        this.props.change('content', val);
    };

    render() {
        const {

            handleSubmit,

            event_state,

            creatingNote,

            createError,

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
                                            {`Add New ${type
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
                                                        Maintenance State
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <Field
                                                            className="db-select-nw-300"
                                                            component={
                                                                RenderSelect
                                                            }
                                                            name="event_state"
                                                            id="event_state"
                                                            placeholder="Maintenance State"
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
                                                            Custom Maintenance
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
                                                                placeholder="Enter a custom maintenance state"
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
                                                                id="new-internal"
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

                                                <div
                                                    className="bs-Fieldset-row bs-post"
                                                    style={{
                                                        paddingTop: '0px',
                                                    }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label bs-Fieldset-row Checkbox"
                                                        style={{
                                                            padding: '0px',
                                                            marginBottom:
                                                                '15px',
                                                        }}
                                                    >
                                                        <Field
                                                            component="input"
                                                            type="checkbox"
                                                            name={`external_note`}
                                                            data-test="RetrySettings-failedPaymentsCheckbox"
                                                            className="Checkbox-source"
                                                        />
                                                        <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                            <div className="Checkbox-target Box-root">
                                                                <div className="Checkbox-color Box-root"></div>
                                                            </div>
                                                        </div>
                                                        <div
                                                            className="Checkbox-label Box-root"
                                                            style={{
                                                                width: '160px',
                                                            }}
                                                        >
                                                            <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                <span>
                                                                    Post on
                                                                    status page
                                                                </span>
                                                            </span>
                                                        </div>
                                                    </label>
                                                </div>
                                            </fieldset>
                                        </div>
                                    </div>
                                </div>
                                <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                                    <div className="bs-Tail-copy">
                                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                            <ShouldRender if={createError}>
                                                <div className="Box-root Margin-right--8">
                                                    <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                </div>
                                                <div className="Box-root">
                                                    <span
                                                        style={{ color: 'red' }}
                                                    >
                                                        {createError}
                                                    </span>
                                                </div>
                                            </ShouldRender>
                                        </div>
                                    </div>
                                    <span className="db-SettingsForm-footerMessage"></span>
                                    <ShouldRender if={true}>
                                        <div style={{ display: 'flex' }}>
                                            <button
                                                className="bs-Button bs-DeprecatedButton btn__modal"
                                                type="button"
                                                onClick={

                                                    this.props.closeThisDialog
                                                }
                                                disabled={creatingNote}
                                            >
                                                <span>Cancel</span>
                                                <span className="cancel-btn__keycode">
                                                    Esc
                                                </span>
                                            </button>
                                            <button
                                                id={`${type}-addButton`}
                                                className="bs-Button bs-Button--blue btn__modal"
                                                type="submit"
                                                disabled={creatingNote}
                                            >
                                                <ShouldRender
                                                    if={!creatingNote}
                                                >
                                                    <span>Save</span>
                                                    <span className="create-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </ShouldRender>

                                                <ShouldRender if={creatingNote}>
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

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        createScheduledEventNote,
        closeModal,
        change,
    },
    dispatch
);

const mapStateToProps = (state: $TSFixMe) => {
    const currentProject = state.project.currentProject;
    const event_state =
        state.form.AddNote &&
        state.form.AddNote.values &&
        state.form.AddNote.values.event_state;

    return {
        currentProject,
        event_state,
        creatingNote: state.scheduledEvent.newScheduledEventNote.requesting,
        createError: state.scheduledEvent.newScheduledEventNote.error,
        modalId: state.modal.modals[0].id,
    };
};


AddNoteModal.displayName = 'AddNoteModal';

const AddNoteModalForm = reduxForm({
    form: 'AddNote',
    destroyOnUnmount: true,
    enableReinitialize: true,
})(AddNoteModal);


AddNoteModal.propTypes = {
    data: PropTypes.object,
    handleSubmit: PropTypes.func,
    closeThisDialog: PropTypes.func,
    createScheduledEventNote: PropTypes.func,
    event_state: PropTypes.string,
    creatingNote: PropTypes.bool,
    createError: PropTypes.string,
    modalId: PropTypes.string,
    closeModal: PropTypes.func,
    change: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(AddNoteModalForm);
