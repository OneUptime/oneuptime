import React from 'react';

import { reduxForm, Field } from 'redux-form';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

import ClickOutside from 'react-click-outside';
import { RenderField } from '../basic/RenderField';
import { ValidateField, incidentNoteTemplateVariables } from '../../config';
import { closeModal } from 'common-ui/actions/modal';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { RenderSelect } from '../basic/RenderSelect';
import {
    updateIncidentNoteTemplate,
    updateIncidentNoteTemplateFailure,
} from '../../actions/incidentNoteTemplate';
import RenderCodeEditor from '../basic/RenderCodeEditor';

interface EditIncidentNoteTemplateProps {
    handleSubmit: Function;
    currentProject: object;
    closeModal?: Function;
    data?: object;
    updatingNoteTemplate?: boolean;
    updatingNoteTemplateError?: string;
    updateIncidentNoteTemplate?: Function;
    updateIncidentNoteTemplateFailure?: Function;
    formValues?: object;
    change?: Function;
}

class EditIncidentNoteTemplate extends React.Component<EditIncidentNoteTemplateProps> {
    state = {
        showVariables: false,
    };
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
                        .getElementById('updateIncidentNoteTemplate')
                        .click();
                }
                return false;
            default:
                return false;
        }
    };

    submit = (values: $TSFixMe) => {
        const {

            updateIncidentNoteTemplate,

            currentProject,

            closeModal,

            data,
        } = this.props;

        const projectId = currentProject._id;
        const {
            name,
            incidentState,
            customIncidentState,
            incidentNote,
        } = values;

        const updateData = {
            name,
            incidentState,
        };
        if (incidentNote) {

            updateData.incidentNote = incidentNote.trim();
        }
        if (incidentState === 'Others') {
            updateData.incidentState = customIncidentState;
        }

        updateIncidentNoteTemplate({
            projectId,
            templateId: data.template._id,
            data: updateData,
        }).then(() => {
            if (

                !this.props.updatingNoteTemplate &&

                !this.props.updatingNoteTemplateError
            ) {
                closeModal();
            }
        });
    };

    closeAndClearError = () => {

        const { updateIncidentNoteTemplateFailure, closeModal } = this.props;

        updateIncidentNoteTemplateFailure(null);
        closeModal();
    };

    onContentChange = (val: $TSFixMe) => {

        this.props.change('incidentNote', val);
    };

    override render() {
        const {

            handleSubmit,

            updatingNoteTemplate,

            updatingNoteTemplateError,

            formValues,
        } = this.props;
        const { showVariables } = this.state;

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
                                        <span>Edit Incident Note Template</span>
                                    </span>
                                </div>
                            </div>
                            <form onSubmit={handleSubmit(this.submit)}>
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
                                                                    className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                    component={
                                                                        RenderField
                                                                    }
                                                                    id="name"
                                                                    name="name"
                                                                    validate={
                                                                        ValidateField.text
                                                                    }
                                                                    disabled={
                                                                        updatingNoteTemplate
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
                                                                        updatingNoteTemplate
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
                                                                                updatingNoteTemplate
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
                                            if={updatingNoteTemplateError}
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
                                                                updatingNoteTemplateError
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
                                            id="updateIncidentNoteTemplate"
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                            disabled={updatingNoteTemplate}
                                            type="submit"
                                            style={{ height: '35px' }}
                                        >
                                            {!updatingNoteTemplate && (
                                                <>
                                                    <span>Edit</span>
                                                    <span className="create-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </>
                                            )}
                                            {updatingNoteTemplate && (
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


EditIncidentNoteTemplate.displayName = 'EditIncidentNoteTemplate';

EditIncidentNoteTemplate.propTypes = {
    handleSubmit: PropTypes.func.isRequired,
    currentProject: PropTypes.object.isRequired,
    closeModal: PropTypes.func,
    data: PropTypes.object,
    updatingNoteTemplate: PropTypes.bool,
    updatingNoteTemplateError: PropTypes.string,
    updateIncidentNoteTemplate: PropTypes.func,
    updateIncidentNoteTemplateFailure: PropTypes.func,
    formValues: PropTypes.object,
    change: PropTypes.func,
};

const EditIncidentNoteTemplateForm = reduxForm({
    form: 'EditIncidentNoteTemplateForm', // a unique identifier for this form
    enableReinitialize: true,
})(EditIncidentNoteTemplate);

const mapStateToProps = (state: RootState, ownProps: $TSFixMe) => {
    const { data } = ownProps;
    const { template } = data;
    const initialValues = {
        ...template,
    };
    if (!['Investigation', 'Update'].includes(template.incidentState)) {
        initialValues.incidentState = 'Others';
        initialValues.customIncidentState = template.incidentState;
    }
    return {
        currentProject: state.project.currentProject,
        updatingNoteTemplate:
            state.incidentNoteTemplate.updateNoteTemplate.requesting,
        updatingNoteTemplateError:
            state.incidentNoteTemplate.updateNoteTemplate.error,
        initialValues,
        formValues: state.form.EditIncidentNoteTemplateForm
            ? state.form.EditIncidentNoteTemplateForm.values
            : {},
    };
};
const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    {
        updateIncidentNoteTemplate,
        closeModal,
        updateIncidentNoteTemplateFailure,
    },
    dispatch
);

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(EditIncidentNoteTemplateForm);
