import React from 'react';

import { reduxForm, Field } from 'redux-form';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

import ClickOutside from 'react-click-outside';
import { RenderField } from '../basic/RenderField';
import { ValidateField } from '../../config';
import {
    setRevealIncidentSettingsVariables,
    createIncidentTemplate,
    fetchIncidentTemplates,
    createIncidentTemplateFailure,
} from '../../actions/incidentBasicsSettings';
import { closeModal } from 'CommonUI/actions/modal';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { RenderSelect } from '../basic/RenderSelect';
import RenderCodeEditor from '../basic/RenderCodeEditor';

interface CreateIncidentTemplateProps {
    handleSubmit: Function;
    currentProject: object;
    setRevealIncidentSettingsVariables: Function;
    revealVariables: boolean;
    settingsVariables: unknown[];
    incidentPriorities: unknown[];
    creatingIncidentTemplate?: boolean;
    createIncidentTemplateError?: string;
    createIncidentTemplate?: Function;
    closeModal?: Function;
    fetchIncidentTemplates?: Function;
    createIncidentTemplateFailure?: Function;
    change?: Function;
}

class CreateIncidentTemplate extends React.Component<CreateIncidentTemplateProps> {
    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (event: $TSFixMe) => {
        switch (event.key) {
            case 'Escape':
                return this.closeAndClearError();
            case 'Enter':
                if (event.target.localName === 'body') {

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

            createIncidentTemplate,

            currentProject,

            closeModal,

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

                !this.props.creatingIncidentTemplate &&

                !this.props.createIncidentTemplateError
            ) {
                fetchIncidentTemplates({ projectId, skip: 0, limit: 10 });
                closeModal();
            }
        });
    };

    closeAndClearError = () => {

        const { createIncidentTemplateFailure, closeModal } = this.props;

        // clear error
        createIncidentTemplateFailure(null);
        closeModal();
    };

    onContentChange = (val: $TSFixMe) => {

        this.props.change('description', val);
    };

    override render() {
        const {

            handleSubmit,

            creatingIncidentTemplate,

            incidentPriorities,

            createIncidentTemplateError,
        } = this.props;

        return (
            <div
                className="ModalLayer-contents"

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


CreateIncidentTemplate.displayName = 'CreateIncidentTemplate';

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

const mapStateToProps: Function = (state: RootState) => {
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
const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators(
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
