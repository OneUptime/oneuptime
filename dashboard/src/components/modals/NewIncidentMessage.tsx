import React, { Component } from 'react';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import { ValidateField } from '../../config';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { Field, reduxForm, change } from 'redux-form';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import {
    setInvestigationNote,
    editIncidentMessageSwitch,
    setInternalNote,
    fetchIncidentMessages,
} from '../../actions/incident';
import { closeModal } from '../../actions/modal';
import { bindActionCreators } from 'redux';

import { RenderField } from '../basic/RenderField';
import { RenderSelect } from '../basic/RenderSelect';
import RenderCodeEditor from '../basic/RenderCodeEditor';

class NewIncidentMessage extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    validate = (values: $TSFixMe) => {
        const errors = {};
        if (!ValidateField.text(values[`content`])) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type '{}'.
            errors.name = 'Incident Message is required.';
        }
        if (!ValidateField.text(values[`incident_state`])) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type '{}'.
            errors.name = 'Incident State is required.';
        }
        if (
            values[`incident_state`] === 'Others' &&
            !ValidateField.text(values[`custom_incident_state`])
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type '{}'.
            errors.name = 'Custom Incident State is required.';
        }
        return errors;
    };
    cancelEdit = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'editIncidentMessageSwitch' does not exis... Remove this comment to see the full error message
        this.props.editIncidentMessageSwitch(this.props.incidentMessage);
    };
    onContentChange = (val: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'change' does not exist on type 'Readonly... Remove this comment to see the full error message
        this.props.change('content', val);
    };
    submitForm = (values: $TSFixMe) => {
        const thisObj = this;
        const postObj = {};
        if (values.post_statuspage) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'post_statuspage' does not exist on type ... Remove this comment to see the full error message
            postObj.post_statuspage = values['post_statuspage'];
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'content' does not exist on type '{}'.
        postObj.content = values[`content`];
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident_state' does not exist on type '... Remove this comment to see the full error message
        postObj.incident_state =
            values[`incident_state`] === 'Others'
                ? values[`custom_incident_state`]
                : values[`incident_state`];

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type '{}'.
        postObj.type = this.props.data.type;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        if (this.props.data.edit) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'id' does not exist on type '{}'.
            postObj.id = this.props.data.incidentMessage._id;
        }

        const projectId =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            this.props.data.incident.projectId._id ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            this.props.data.incident.projectId ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            this.props.currentProject._id;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        if (this.props.data.type === 'investigation') {
            this.props
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'setInvestigationNote' does not exist on ... Remove this comment to see the full error message
                .setInvestigationNote(
                    projectId,
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                    this.props.data.incident._id,
                    postObj
                )
                .then(
                    () => {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'reset' does not exist on type 'Readonly<... Remove this comment to see the full error message
                        thisObj.props.reset();
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
                        thisObj.props.closeModal();
                    },
                    (error: $TSFixMe) => {
                        if (error && error.message) {
                            return error;
                        }
                    }
                );
        } else {
            this.props
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'setInternalNote' does not exist on type ... Remove this comment to see the full error message
                .setInternalNote(
                    projectId,
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                    this.props.data.incident._id,
                    postObj
                )
                .then(
                    () => {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
                        this.props.closeModal();
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchIncidentMessages' does not exist on... Remove this comment to see the full error message
                        this.props.fetchIncidentMessages(
                            projectId,
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                            this.props.data.incident.slug,
                            0,
                            10,
                            'internal'
                        );
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'reset' does not exist on type 'Readonly<... Remove this comment to see the full error message
                        thisObj.props.reset();
                    },
                    (error: $TSFixMe) => {
                        if (error && error.message) {
                            return error;
                        }
                    }
                );
        }
    };
    handleKeyBoard = (event: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
        const { closeModal, data } = this.props;
        if (event.target.localName !== 'textarea' && event.key) {
            switch (event.key) {
                case 'Escape':
                    return closeModal();
                case 'Enter':
                    return data.edit
                        // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                        ? document
                              .getElementById(`${data.type}-editButton`)
                              .click()
                        // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                        : document
                              .getElementById(`${data.type}-addButton`)
                              .click();
                default:
                    return false;
            }
        }
    };
    onTemplateChange = (value: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'change' does not exist on type 'Readonly... Remove this comment to see the full error message
        const { change, noteTemplates } = this.props;

        if (value) {
            !noteTemplates.requesting &&
                noteTemplates.templates.forEach((template: $TSFixMe) => {
                    if (String(template._id) === String(value)) {
                        if (
                            !['Investigation', 'Update'].includes(
                                template.incidentState
                            )
                        ) {
                            change('incident_state', 'Others');
                            change(
                                'custom_incident_state',
                                template.incidentState
                            );
                        } else {
                            change('incident_state', template.incidentState);
                        }
                        change('content', template.incidentNote);
                    }
                });
        } else {
            change('incident_state', 'Update');
            change('content', '');
        }
    };
    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
            handleSubmit,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentMessageState' does not exist on ... Remove this comment to see the full error message
            incidentMessageState,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident_state' does not exist on type '... Remove this comment to see the full error message
            incident_state,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteTemplates' does not exist on type 'R... Remove this comment to see the full error message
            noteTemplates,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
            closeModal,
        } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        const { edit, type } = this.props.data;
        return (
            <div
                className="ModalLayer-contents"
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM">
                    <div className="bs-Modal bs-Modal--large">
                        <ClickOutside onClickOutside={closeModal}>
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
                                            {`${
                                                edit ? 'Edit' : 'Add New'
                                            } ${type
                                                .charAt(0)
                                                .toUpperCase()}${type.slice(
                                                1
                                            )} Note`}
                                        </span>
                                    </span>
                                </div>
                            </div>
                            <form
                                id={`form-new-incident-${type}-message`}
                                onSubmit={handleSubmit(this.submitForm)}
                            >
                                <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                                    <div>
                                        <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                            <fieldset
                                                className="bs-Fieldset"
                                                style={{
                                                    padding: 10,
                                                }}
                                            >
                                                {!edit &&
                                                    !noteTemplates.requesting &&
                                                    noteTemplates.templates
                                                        .length > 0 && (
                                                        <div className="bs-Fieldset-row">
                                                            <label className="bs-Fieldset-label">
                                                                Incident Note
                                                                Templates
                                                            </label>
                                                            <div className="bs-Fieldset-fields">
                                                                <Field
                                                                    className="db-select-nw-300 full-width"
                                                                    component={
                                                                        RenderSelect
                                                                    }
                                                                    name="noteTemplate"
                                                                    id="noteTemplate"
                                                                    placeholder="Incident Note Template"
                                                                    disabled={
                                                                        false
                                                                    }
                                                                    validate={
                                                                        ValidateField.select
                                                                    }
                                                                    style={{
                                                                        width:
                                                                            '100%',
                                                                    }}
                                                                    options={[
                                                                        {
                                                                            value:
                                                                                '',
                                                                            label:
                                                                                'Select template',
                                                                        },
                                                                        ...noteTemplates.templates.map(
                                                                            (template: $TSFixMe) => ({
                                                                                value:
                                                                                    template._id,

                                                                                label:
                                                                                    template.name
                                                                            })
                                                                        ),
                                                                    ]}
                                                                    onChange={(
                                                                        event: $TSFixMe,
                                                                        newValue: $TSFixMe
                                                                    ) =>
                                                                        this.onTemplateChange(
                                                                            newValue
                                                                        )
                                                                    }
                                                                />
                                                            </div>
                                                        </div>
                                                    )}
                                                <div className="bs-Fieldset-row">
                                                    <label className="bs-Fieldset-label">
                                                        Incident State
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <Field
                                                            className="db-select-nw-300 full-width"
                                                            component={
                                                                RenderSelect
                                                            }
                                                            name="incident_state"
                                                            id="incident_state"
                                                            placeholder="Incident State"
                                                            disabled={false}
                                                            validate={
                                                                ValidateField.select
                                                            }
                                                            style={{
                                                                width: '100%',
                                                            }}
                                                            options={[
                                                                {
                                                                    value:
                                                                        'Investigating',
                                                                    label:
                                                                        'Investigating',
                                                                },
                                                                {
                                                                    value:
                                                                        'Update',
                                                                    label:
                                                                        'Update',
                                                                },
                                                                {
                                                                    value:
                                                                        'Others',
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
                                                        incident_state ===
                                                        'Others'
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
                                                                name={`custom_incident_state`}
                                                                id="custom_incident_state"
                                                                placeholder="Enter a custom incident state"
                                                                validate={
                                                                    ValidateField.text
                                                                }
                                                                style={{
                                                                    width:
                                                                        '100%',
                                                                }}
                                                            />
                                                        </div>
                                                    </div>
                                                </ShouldRender>
                                                <div className="bs-Fieldset-rows">
                                                    <div className="bs-Fieldset-row">
                                                        <ShouldRender
                                                            if={!edit}
                                                        >
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
                                                                name="content"
                                                                component={
                                                                    RenderCodeEditor
                                                                }
                                                                id="incident_description"
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
                                                <ShouldRender if={!edit}>
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
                                                                name={`post_statuspage`}
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
                                                                    width:
                                                                        '160px',
                                                                }}
                                                            >
                                                                <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                    <span>
                                                                        Post
                                                                        this on
                                                                        Status
                                                                        Page
                                                                    </span>
                                                                </span>
                                                            </div>
                                                        </label>
                                                    </div>
                                                </ShouldRender>
                                            </fieldset>
                                        </div>
                                    </div>
                                </div>
                                <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                                    <div className="bs-Tail-copy">
                                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                            <ShouldRender
                                                if={
                                                    edit &&
                                                    this.props
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentMessageState' does not exist on ... Remove this comment to see the full error message
                                                        .incidentMessageState
                                                        .edit.error
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
                                                            this.props
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentMessageState' does not exist on ... Remove this comment to see the full error message
                                                                .incidentMessageState
                                                                .edit.error
                                                        }
                                                    </span>
                                                </div>
                                            </ShouldRender>
                                            <ShouldRender
                                                if={
                                                    !edit &&
                                                    this.props
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentMessageState' does not exist on ... Remove this comment to see the full error message
                                                        .incidentMessageState
                                                        .create.error
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
                                                            this.props
                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentMessageState' does not exist on ... Remove this comment to see the full error message
                                                                .incidentMessageState
                                                                .create.error
                                                        }
                                                    </span>
                                                </div>
                                            </ShouldRender>
                                        </div>
                                    </div>
                                    <ShouldRender if={!edit}>
                                        <div style={{ display: 'flex' }}>
                                            <button
                                                className="bs-Button bs-DeprecatedButton btn__modal"
                                                type="button"
                                                onClick={closeModal}
                                                disabled={
                                                    incidentMessageState.create
                                                        .requesting
                                                }
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
                                            >
                                                <ShouldRender
                                                    if={
                                                        !incidentMessageState
                                                            .create.requesting
                                                    }
                                                >
                                                    <span>Save </span>
                                                    <span className="create-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </ShouldRender>

                                                <ShouldRender
                                                    if={
                                                        incidentMessageState
                                                            .create.requesting
                                                    }
                                                >
                                                    <FormLoader />
                                                </ShouldRender>
                                            </button>
                                        </div>
                                    </ShouldRender>
                                    <ShouldRender if={edit}>
                                        <div style={{ display: 'flex' }}>
                                            <button
                                                className="bs-Button bs-DeprecatedButton btn__modal"
                                                type="button"
                                                onClick={closeModal}
                                                disabled={
                                                    incidentMessageState.edit
                                                        .requesting
                                                }
                                            >
                                                <span>Cancel</span>
                                                <span className="cancel-btn__keycode">
                                                    Esc
                                                </span>
                                            </button>
                                            <button
                                                id={`${type}-editButton`}
                                                className="bs-Button bs-Button--blue btn__modal"
                                                type="submit"
                                            >
                                                <ShouldRender
                                                    if={
                                                        !incidentMessageState
                                                            .edit.requesting
                                                    }
                                                >
                                                    <span>Update </span>
                                                    <span className="create-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </ShouldRender>

                                                <ShouldRender
                                                    if={
                                                        incidentMessageState
                                                            .edit.requesting
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

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        setInvestigationNote,
        editIncidentMessageSwitch,
        setInternalNote,
        closeModal,
        change,
        fetchIncidentMessages,
    },
    dispatch
);

const mapStateToProps = (state: $TSFixMe, ownProps: $TSFixMe) => {
    const incidentMessageState =
        ownProps.data.type === 'investigation'
            ? state.incident.investigationNotes
            : state.incident.internalNotes;
    let initialValues = null;

    if (ownProps.data.incidentMessage) {
        const isCustomState = !['Investigating', 'Update'].includes(
            ownProps.data.incidentMessage.incident_state
        );
        initialValues = {
            content: ownProps.data.incidentMessage.content,
            incident_state: isCustomState
                ? 'Others'
                : ownProps.data.incidentMessage.incident_state,
            custom_incident_state: isCustomState
                ? ownProps.data.incidentMessage.incident_state
                : '',
        };
    } else {
        initialValues = {
            content: '',
            incident_state: 'Update',
            custom_incident_state: '',
        };
    }
    const currentProject = state.project.currentProject;
    const incident_state = state.form[ownProps.data.formId]
        ? state.form[ownProps.data.formId].values
            ? state.form[ownProps.data.formId].values.incident_state
                ? state.form[ownProps.data.formId].values.incident_state
                : ''
            : ''
        : '';
    return {
        initialValues,
        incidentMessageState,
        currentProject,
        form: ownProps.data.formId,
        incident_state,
        noteTemplates: state.incidentNoteTemplate.noteTemplates,
    };
};
// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
NewIncidentMessage.displayName = 'NewIncidentMessage';
const NewIncidentMessageForm = new reduxForm({
    destroyOnUnmount: true,
    enableReinitialize: true,
})(NewIncidentMessage);
// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
NewIncidentMessage.propTypes = {
    incident: PropTypes.object,
    incidentMessage: PropTypes.object,
    incidentMessageState: PropTypes.object,
    currentProject: PropTypes.object,
    data: PropTypes.object,
    setInvestigationNote: PropTypes.func,
    handleSubmit: PropTypes.func,
    edit: PropTypes.bool,
    type: PropTypes.string,
    editIncidentMessageSwitch: PropTypes.func,
    setInternalNote: PropTypes.func,
    incident_state: PropTypes.string,
    change: PropTypes.func,
    closeModal: PropTypes.func,
    noteTemplates: PropTypes.object,
    fetchIncidentMessages: PropTypes.func,
};
export default connect(
    mapStateToProps,
    mapDispatchToProps
)(NewIncidentMessageForm);
