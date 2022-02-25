import React, { Component } from 'react';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import { ValidateField } from '../../config';
import { Field, reduxForm, change } from 'redux-form';
import { connect } from 'react-redux';
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

    validate = values => {
        const errors = {};
        if (!ValidateField.text(values[`content`])) {
            errors.name = 'Incident Message is required.';
        }
        if (!ValidateField.text(values[`incident_state`])) {
            errors.name = 'Incident State is required.';
        }
        if (
            values[`incident_state`] === 'Others' &&
            !ValidateField.text(values[`custom_incident_state`])
        ) {
            errors.name = 'Custom Incident State is required.';
        }
        return errors;
    };
    cancelEdit = () => {
        this.props.editIncidentMessageSwitch(this.props.incidentMessage);
    };
    onContentChange = val => {
        this.props.change('content', val);
    };
    submitForm = values => {
        const thisObj = this;
        const postObj = {};
        if (values.post_statuspage) {
            postObj.post_statuspage = values['post_statuspage'];
        }
        postObj.content = values[`content`];
        postObj.incident_state =
            values[`incident_state`] === 'Others'
                ? values[`custom_incident_state`]
                : values[`incident_state`];

        postObj.type = this.props.data.type;
        if (this.props.data.edit) {
            postObj.id = this.props.data.incidentMessage._id;
        }

        const projectId =
            this.props.data.incident.projectId._id ||
            this.props.data.incident.projectId ||
            this.props.currentProject._id;
        if (this.props.data.type === 'investigation') {
            this.props
                .setInvestigationNote(
                    projectId,
                    this.props.data.incident._id,
                    postObj
                )
                .then(
                    () => {
                        thisObj.props.reset();
                        thisObj.props.closeModal();
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
                    projectId,
                    this.props.data.incident._id,
                    postObj
                )
                .then(
                    () => {
                        this.props.closeModal();
                        this.props.fetchIncidentMessages(
                            projectId,
                            this.props.data.incident.slug,
                            0,
                            10,
                            'internal'
                        );
                        thisObj.props.reset();
                    },
                    error => {
                        if (error && error.message) {
                            return error;
                        }
                    }
                );
        }
    };
    handleKeyBoard = event => {
        const { closeModal, data } = this.props;
        if (event.target.localName !== 'textarea' && event.key) {
            switch (event.key) {
                case 'Escape':
                    return closeModal();
                case 'Enter':
                    return data.edit
                        ? document
                              .getElementById(`${data.type}-editButton`)
                              .click()
                        : document
                              .getElementById(`${data.type}-addButton`)
                              .click();
                default:
                    return false;
            }
        }
    };
    onTemplateChange = value => {
        const { change, noteTemplates } = this.props;

        if (value) {
            !noteTemplates.requesting &&
                noteTemplates.templates.forEach(template => {
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
            handleSubmit,
            incidentMessageState,
            incident_state,
            noteTemplates,
            closeModal,
        } = this.props;
        const { edit, type } = this.props.data;
        return (
            <div
                className="ModalLayer-contents"
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
                                                                            template => ({
                                                                                value:
                                                                                    template._id,
                                                                                label:
                                                                                    template.name,
                                                                            })
                                                                        ),
                                                                    ]}
                                                                    onChange={(
                                                                        event,
                                                                        newValue
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

const mapDispatchToProps = dispatch =>
    bindActionCreators(
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

const mapStateToProps = (state, ownProps) => {
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
