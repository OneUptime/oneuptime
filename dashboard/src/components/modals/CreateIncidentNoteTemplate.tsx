import React from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm, Field } from 'redux-form';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import { RenderField } from '../basic/RenderField';
import { ValidateField, incidentNoteTemplateVariables } from '../../config';
import { closeModal } from '../../actions/modal';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { RenderSelect } from '../basic/RenderSelect';
import {
    createIncidentNoteTemplate,
    fetchIncidentNoteTemplates,
    createIncidentNoteTemplateFailure,
} from '../../actions/incidentNoteTemplate';
import RenderCodeEditor from '../basic/RenderCodeEditor';

class CreateIncidentNoteTemplate extends React.Component {
    state = {
        showVariables: false,
    };

    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (event: $TSFixMe) => {
        switch (event.key) {
            case 'Escape':
                return this.closeAndClearError();
            case 'Enter':
                if (event.target.localName === 'body') {
                    // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                    return document
                        .getElementById('createIncidentNoteTemplate')
                        .click();
                }
                return false;
            default:
                return false;
        }
    };

    submit = (values: $TSFixMe) => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createIncidentNoteTemplate' does not exi... Remove this comment to see the full error message
            createIncidentNoteTemplate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
            closeModal,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchIncidentNoteTemplates' does not exi... Remove this comment to see the full error message
            fetchIncidentNoteTemplates,
        } = this.props;

        const projectId = currentProject._id;
        const {
            incidentState,
            incidentNote,
            name,
            customIncidentState,
        } = values;

        const data = {
            name,
            incidentState,
        };
        if (incidentNote) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentNote' does not exist on type '{ ... Remove this comment to see the full error message
            data.incidentNote = incidentNote.trim();
        }
        if (incidentState === 'Others') {
            data.incidentState = customIncidentState;
        }

        createIncidentNoteTemplate({
            projectId,
            data,
        }).then(() => {
            if (
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'creatingNoteTemplate' does not exist on ... Remove this comment to see the full error message
                !this.props.creatingNoteTemplate &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'creatingNoteTemplateError' does not exis... Remove this comment to see the full error message
                !this.props.creatingNoteTemplateError
            ) {
                fetchIncidentNoteTemplates({ projectId, skip: 0, limit: 10 });
                closeModal();
            }
        });
    };

    closeAndClearError = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'createIncidentNoteTemplateFailure' does ... Remove this comment to see the full error message
        const { createIncidentNoteTemplateFailure, closeModal } = this.props;

        // clear error
        createIncidentNoteTemplateFailure(null);
        closeModal();
    };

    onContentChange = (val: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'change' does not exist on type 'Readonly... Remove this comment to see the full error message
        this.props.change('incidentNote', val);
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
            handleSubmit,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'creatingNoteTemplate' does not exist on ... Remove this comment to see the full error message
            creatingNoteTemplate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'creatingNoteTemplateError' does not exis... Remove this comment to see the full error message
            creatingNoteTemplateError,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'formValues' does not exist on type 'Read... Remove this comment to see the full error message
            formValues,
        } = this.props;
        const { showVariables } = this.state;

        return (
            <div
                className="ModalLayer-contents"
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM">
                    <div
                        className="bs-Modal bs-Modal--medium"
                        style={{ width: 570 }}
                    >
                        <ClickOutside onClickOutside={this.closeAndClearError}>
                            <div className="bs-Modal-header">
                                <div
                                    className="bs-Modal-header-copy"
                                    style={{
                                        marginBottom: '10px',
                                        marginTop: '10px',
                                    }}
                                >
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>
                                            Create New Incident Note Template
                                        </span>
                                    </span>
                                </div>
                            </div>
                            <form
                                onSubmit={handleSubmit(this.submit)}
                                id="templateForm"
                            >
                                <div className="bs-Modal-content bs-u-paddingless">
                                    <div className="bs-Modal-block bs-u-paddingless">
                                        <div className="bs-Modal-content">
                                            <span className="bs-Fieldset">
                                                <fieldset
                                                    className="bs-Fieldset"
                                                    style={{ padding: 0 }}
                                                >
                                                    <div className="bs-Fieldset-rows">
                                                        <div className="bs-Fieldset-row">
                                                            <label className="bs-Fieldset-label">
                                                                Template Name
                                                            </label>
                                                            <div className="bs-Fieldset-fields">
                                                                <Field
                                                                    id="name"
                                                                    className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                    component={
                                                                        RenderField
                                                                    }
                                                                    name="name"
                                                                    validate={
                                                                        ValidateField.text
                                                                    }
                                                                    disabled={
                                                                        creatingNoteTemplate
                                                                    }
                                                                    style={{
                                                                        width:
                                                                            '100%',
                                                                    }}
                                                                />
                                                            </div>
                                                        </div>
                                                        <div className="bs-Fieldset-row">
                                                            <label className="bs-Fieldset-label">
                                                                Incident State
                                                            </label>
                                                            <div className="bs-Fieldset-fields">
                                                                <Field
                                                                    className="db-select-nw full-width"
                                                                    component={
                                                                        RenderSelect
                                                                    }
                                                                    id="incidentState"
                                                                    name="incidentState"
                                                                    options={[
                                                                        {
                                                                            value:
                                                                                'Investigation',
                                                                            label:
                                                                                'Investigation',
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
                                                                    disabled={
                                                                        creatingNoteTemplate
                                                                    }
                                                                    style={{
                                                                        width:
                                                                            '100%',
                                                                    }}
                                                                />
                                                            </div>
                                                        </div>
                                                        {formValues &&
                                                            formValues.incidentState &&
                                                            formValues.incidentState ===
                                                                'Others' && (
                                                                <div className="bs-Fieldset-row">
                                                                    <label className="bs-Fieldset-label">
                                                                        Custom
                                                                        Incident
                                                                        State
                                                                    </label>
                                                                    <div className="bs-Fieldset-fields">
                                                                        <Field
                                                                            id="customIncidentState"
                                                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                            component={
                                                                                RenderField
                                                                            }
                                                                            name="customIncidentState"
                                                                            validate={
                                                                                ValidateField.text
                                                                            }
                                                                            disabled={
                                                                                creatingNoteTemplate
                                                                            }
                                                                            style={{
                                                                                width:
                                                                                    '100%',
                                                                            }}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            )}
                                                    </div>
                                                    <div className="bs-Fieldset-rows">
                                                        <div
                                                            className="bs-Fieldset-row"
                                                            style={{
                                                                paddingTop: 0,
                                                                paddingBottom: 0,
                                                            }}
                                                        >
                                                            <label className="bs-Fieldset-label">
                                                                Incident Note
                                                            </label>
                                                            <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                                <Field
                                                                    name="incidentNote"
                                                                    component={
                                                                        RenderCodeEditor
                                                                    }
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
                                                        className="bs-Fieldset-row"
                                                        style={{
                                                            padding: 0,
                                                        }}
                                                    >
                                                        <label
                                                            className="bs-Fieldset-label Text-align--left"
                                                            htmlFor="isDefault"
                                                        ></label>
                                                        <div
                                                            className="bs-Fieldset-fields"
                                                            style={{
                                                                paddingTop:
                                                                    '15px',
                                                            }}
                                                        >
                                                            <div className="bs-Fieldset-field">
                                                                <label
                                                                    className="Checkbox"
                                                                    style={{
                                                                        marginRight:
                                                                            '12px',
                                                                    }}
                                                                    htmlFor="isDefault"
                                                                >
                                                                    <div>
                                                                        <ShouldRender
                                                                            if={
                                                                                !showVariables
                                                                            }
                                                                        >
                                                                            <div
                                                                                className="template-variable-1"
                                                                                style={{
                                                                                    display:
                                                                                        'block',
                                                                                }}
                                                                            >
                                                                                <button
                                                                                    onClick={() =>
                                                                                        this.setState(
                                                                                            {
                                                                                                showVariables: true,
                                                                                            }
                                                                                        )
                                                                                    }
                                                                                    className="button-as-anchor"
                                                                                    type="button"
                                                                                >
                                                                                    Click
                                                                                    here
                                                                                    to
                                                                                    reveal
                                                                                    available
                                                                                    variables.
                                                                                </button>
                                                                            </div>
                                                                        </ShouldRender>
                                                                        <ShouldRender
                                                                            if={
                                                                                showVariables
                                                                            }
                                                                        >
                                                                            <ul
                                                                                className="template-variable-1"
                                                                                style={{
                                                                                    display:
                                                                                        'block',
                                                                                }}
                                                                            >
                                                                                {incidentNoteTemplateVariables.map(
                                                                                    (
                                                                                        variable,
                                                                                        index
                                                                                    ) => (
                                                                                        <li
                                                                                            key={
                                                                                                index
                                                                                            }
                                                                                            className="template-variables"
                                                                                            style={{
                                                                                                listStyleType:
                                                                                                    'disc',
                                                                                                listStylePosition:
                                                                                                    'inside',
                                                                                            }}
                                                                                        >
                                                                                            {
                                                                                                variable.description
                                                                                            }
                                                                                        </li>
                                                                                    )
                                                                                )}
                                                                            </ul>
                                                                        </ShouldRender>
                                                                    </div>
                                                                </label>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </fieldset>
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div
                                        className="bs-Modal-footer-actions"
                                        style={{
                                            width: '100%',
                                            flexWrap: 'nowrap',
                                        }}
                                    >
                                        <ShouldRender
                                            if={creatingNoteTemplateError}
                                        >
                                            <div className="bs-Tail-copy">
                                                <div
                                                    className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                    style={{
                                                        marginTop: '10px',
                                                    }}
                                                >
                                                    <div className="Box-root Margin-right--8">
                                                        <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                    </div>
                                                    <div className="Box-root">
                                                        <span
                                                            style={{
                                                                color: 'red',
                                                            }}
                                                        >
                                                            {
                                                                creatingNoteTemplateError
                                                            }
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                        <button
                                            className="bs-Button bs-DeprecatedButton btn__modal"
                                            type="button"
                                            onClick={this.closeAndClearError}
                                            style={{ height: '35px' }}
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="createIncidentNoteTemplate"
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                            disabled={creatingNoteTemplate}
                                            type="submit"
                                            style={{ height: '35px' }}
                                        >
                                            {!creatingNoteTemplate && (
                                                <>
                                                    <span>Create</span>
                                                    <span className="create-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </>
                                            )}
                                            {creatingNoteTemplate && (
                                                <FormLoader />
                                            )}
                                        </button>
                                    </div>
                                </div>
                            </form>
                        </ClickOutside>
                    </div>
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
CreateIncidentNoteTemplate.displayName = 'CreateIncidentNoteTemplate';
// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
CreateIncidentNoteTemplate.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    currentProject: PropTypes.object.isRequired,
    creatingNoteTemplate: PropTypes.bool,
    creatingNoteTemplateError: PropTypes.string,
    closeModal: PropTypes.func,
    createIncidentNoteTemplate: PropTypes.func,
    fetchIncidentNoteTemplates: PropTypes.func,
    createIncidentNoteTemplateFailure: PropTypes.func,
    formValues: PropTypes.object,
    change: PropTypes.func,
};

const CreateIncidentNoteTemplateForm = reduxForm({
    form: 'CreateIncidentNoteTemplateForm', // a unique identifier for this form
    enableReinitialize: true,
})(CreateIncidentNoteTemplate);

const mapStateToProps = (state: $TSFixMe) => {
    return {
        currentProject: state.project.currentProject,
        creatingNoteTemplate:
            state.incidentNoteTemplate.createNoteTemplate.requesting,
        creatingNoteTemplateError:
            state.incidentNoteTemplate.createNoteTemplate.error,
        formValues: state.form.CreateIncidentNoteTemplateForm
            ? state.form.CreateIncidentNoteTemplateForm.values
            : {},
        initialValues: { incidentState: 'Update' },
    };
};
const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        closeModal,
        createIncidentNoteTemplate,
        fetchIncidentNoteTemplates,
        createIncidentNoteTemplateFailure,
    },
    dispatch
);

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(CreateIncidentNoteTemplateForm);
