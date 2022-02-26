import React from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm, Field } from 'redux-form';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import { RenderField } from '../basic/RenderField';
import { ValidateField } from '../../config';
import {
    setRevealIncidentSettingsVariables,
    createIncidentTemplate,
    fetchIncidentTemplates,
    createIncidentTemplateFailure,
} from '../../actions/incidentBasicsSettings';
import { closeModal } from '../../actions/modal';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { RenderSelect } from '../basic/RenderSelect';
import RenderCodeEditor from '../basic/RenderCodeEditor';

class CreateIncidentTemplate extends React.Component {
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
                        .getElementById('createIncidentTemplate')
                        .click();
                }
                return false;
            default:
                return false;
        }
    };

    submit = (values: $TSFixMe) => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createIncidentTemplate' does not exist o... Remove this comment to see the full error message
            createIncidentTemplate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
            closeModal,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchIncidentTemplates' does not exist o... Remove this comment to see the full error message
            fetchIncidentTemplates,
        } = this.props;

        const projectId = currentProject._id;
        const {
            title,
            description,
            incidentPriority,
            name,
            isDefault,
        } = values;

        createIncidentTemplate({
            projectId,
            data: {
                title,
                description,
                incidentPriority,
                name,
                isDefault,
            },
        }).then(() => {
            if (
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'creatingIncidentTemplate' does not exist... Remove this comment to see the full error message
                !this.props.creatingIncidentTemplate &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'createIncidentTemplateError' does not ex... Remove this comment to see the full error message
                !this.props.createIncidentTemplateError
            ) {
                fetchIncidentTemplates({ projectId, skip: 0, limit: 10 });
                closeModal();
            }
        });
    };

    closeAndClearError = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'createIncidentTemplateFailure' does not ... Remove this comment to see the full error message
        const { createIncidentTemplateFailure, closeModal } = this.props;

        // clear error
        createIncidentTemplateFailure(null);
        closeModal();
    };

    onContentChange = (val: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'change' does not exist on type 'Readonly... Remove this comment to see the full error message
        this.props.change('description', val);
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
            handleSubmit,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'creatingIncidentTemplate' does not exist... Remove this comment to see the full error message
            creatingIncidentTemplate,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentPriorities' does not exist on ty... Remove this comment to see the full error message
            incidentPriorities,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createIncidentTemplateError' does not ex... Remove this comment to see the full error message
            createIncidentTemplateError,
        } = this.props;

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
                                            Create New Incident Template
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
                                                <fieldset className="bs-Fieldset">
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
                                                                        creatingIncidentTemplate
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
                                                                Incident
                                                                Priority
                                                            </label>
                                                            <div className="bs-Fieldset-fields">
                                                                <Field
                                                                    className="db-select-nw"
                                                                    component={
                                                                        RenderSelect
                                                                    }
                                                                    id="incidentTemplatePriority"
                                                                    name="incidentPriority"
                                                                    options={[
                                                                        {
                                                                            value:
                                                                                '',
                                                                            label:
                                                                                'Select Priority',
                                                                        },
                                                                        ...incidentPriorities.map(
                                                                            (incidentPriority: $TSFixMe) => ({
                                                                                value:
                                                                                    incidentPriority._id,

                                                                                label:
                                                                                    incidentPriority.name
                                                                            })
                                                                        ),
                                                                    ]}
                                                                    disabled={
                                                                        creatingIncidentTemplate
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
                                                                Incident Title
                                                            </label>
                                                            <div className="bs-Fieldset-fields">
                                                                <Field
                                                                    id="title"
                                                                    className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                    component={
                                                                        RenderField
                                                                    }
                                                                    name="title"
                                                                    validate={
                                                                        ValidateField.text
                                                                    }
                                                                    disabled={
                                                                        creatingIncidentTemplate
                                                                    }
                                                                    style={{
                                                                        width:
                                                                            '100%',
                                                                    }}
                                                                />
                                                            </div>
                                                        </div>
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
                                                                Incident
                                                                Description
                                                            </label>
                                                            <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                                <Field
                                                                    name="description"
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
                                                                    '6px',
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
                                                                    <Field
                                                                        component="input"
                                                                        type="checkbox"
                                                                        name="isDefault"
                                                                        className="Checkbox-source"
                                                                        id="isDefault"
                                                                    />
                                                                    <div className="Checkbox-box Box-root Margin-right--2">
                                                                        <div className="Checkbox-target Box-root">
                                                                            <div className="Checkbox-color Box-root"></div>
                                                                        </div>
                                                                    </div>
                                                                    <div
                                                                        className="Box-root"
                                                                        style={{
                                                                            paddingLeft:
                                                                                '5px',
                                                                        }}
                                                                    >
                                                                        <span>
                                                                            Use
                                                                            as
                                                                            default
                                                                            incident
                                                                            template
                                                                        </span>
                                                                    </div>
                                                                </label>
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
                                                                                !this
                                                                                    .props
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'revealVariables' does not exist on type ... Remove this comment to see the full error message
                                                                                    .revealVariables
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
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'setRevealIncidentSettingsVariables' does... Remove this comment to see the full error message
                                                                                        this.props.setRevealIncidentSettingsVariables(
                                                                                            true
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
                                                                                this
                                                                                    .props
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'revealVariables' does not exist on type ... Remove this comment to see the full error message
                                                                                    .revealVariables
                                                                            }
                                                                        >
                                                                            <ul
                                                                                className="template-variable-1"
                                                                                style={{
                                                                                    display:
                                                                                        'block',
                                                                                }}
                                                                            >
                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'settingsVariables' does not exist on typ... Remove this comment to see the full error message
                                                                                {this.props.settingsVariables.map(
                                                                                    (
                                                                                        variable: $TSFixMe,
                                                                                        index: $TSFixMe
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
                                                                                            {`{{${variable.name}}} : ${variable.definition}`}
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
                                            if={createIncidentTemplateError}
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
                                                                createIncidentTemplateError
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
                                            id="createIncidentTemplate"
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                            disabled={creatingIncidentTemplate}
                                            type="submit"
                                            style={{ height: '35px' }}
                                        >
                                            {!creatingIncidentTemplate && (
                                                <>
                                                    <span>Create</span>
                                                    <span className="create-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </>
                                            )}
                                            {creatingIncidentTemplate && (
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
CreateIncidentTemplate.displayName = 'CreateIncidentTemplate';
// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
CreateIncidentTemplate.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    currentProject: PropTypes.object.isRequired,
    setRevealIncidentSettingsVariables: PropTypes.func.isRequired,
    revealVariables: PropTypes.bool.isRequired,
    settingsVariables: PropTypes.array.isRequired,
    incidentPriorities: PropTypes.array.isRequired,
    creatingIncidentTemplate: PropTypes.bool,
    createIncidentTemplateError: PropTypes.string,
    createIncidentTemplate: PropTypes.func,
    closeModal: PropTypes.func,
    fetchIncidentTemplates: PropTypes.func,
    createIncidentTemplateFailure: PropTypes.func,
    change: PropTypes.func,
};

const CreateIncidentTemplateForm = reduxForm({
    form: 'CreateIncidentTemplateForm', // a unique identifier for this form
    enableReinitialize: true,
})(CreateIncidentTemplate);

const mapStateToProps = (state: $TSFixMe) => {
    return {
        currentProject: state.project.currentProject,
        revealVariables: state.incidentBasicSettings.revealVariables,
        settingsVariables:
            state.incidentBasicSettings.incidentBasicSettingsVariables
                .incidentBasicSettingsVariables,
        incidentPriorities:
            state.incidentPriorities.incidentPrioritiesList.incidentPriorities,
        creatingIncidentTemplate:
            state.incidentBasicSettings.createIncidentTemplate.requesting,
        createIncidentTemplateError:
            state.incidentBasicSettings.createIncidentTemplate.error,
    };
};
const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        createIncidentTemplate,
        setRevealIncidentSettingsVariables,
        closeModal,
        fetchIncidentTemplates,
        createIncidentTemplateFailure,
    },
    dispatch
);

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(CreateIncidentTemplateForm);
