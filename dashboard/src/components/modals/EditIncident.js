import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { reduxForm, Field } from 'redux-form';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { updateIncident } from '../../actions/incident';
import { ValidateField } from '../../config';
import { RenderSelect } from '../basic/RenderSelect';
import { RenderField } from '../basic/RenderField';
import AceEditor from 'react-ace';
import 'brace/mode/markdown';
import 'brace/theme/github';

const MarkdownEditor = ({ input }) => (
    <AceEditor
        mode="markdown"
        theme="github"
        value={input.value}
        editorProps={{
            $blockScrolling: true,
        }}
        height="150px"
        width="100%"
        highlightActiveLine={true}
        setOptions={{
            enableBasicAutocompletion: true,
            enableLiveAutocompletion: true,
            enableSnippets: true,
            showGutter: false,
        }}
        onChange={input.onChange}
        placeholder="This can be markdown"
    />
);

MarkdownEditor.displayName = 'MarkdownEditor';
MarkdownEditor.propTypes = {
    input: PropTypes.object.isRequired,
};

class EditIncident extends Component {
    submitForm = values => {
        const { incidentId } = this.props.data;
        const projectId = this.props.currentProject._id;
        this.props
            .updateIncident(
                projectId,
                incidentId,
                values.incidentType,
                values.title,
                values.description,
                values.incidentPriority
            )
            .then(() => this.props.closeThisDialog());
    };

    render() {
        const { handleSubmit, editIncident, incidentPriorities } = this.props;
        return (
            <div
                onKeyDown={this.handleKeyBoard}
                className="ModalLayer-contents"
                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM">
                    <div className="bs-Modal bs-Modal--medium">
                        <div className="bs-Modal-header">
                            <div
                                className="bs-Modal-header-copy"
                                style={{
                                    marginBottom: '10px',
                                    marginTop: '10px',
                                }}
                            >
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span id="incidentTitleLabel">
                                        Edit Incident
                                    </span>
                                </span>
                            </div>
                        </div>
                        <form
                            onSubmit={handleSubmit(this.submitForm.bind(this))}
                        >
                            <div className="bs-Modal-content bs-u-paddingless">
                                <div className="bs-Modal-block bs-u-paddingless">
                                    <div className="bs-Modal-content">
                                        <ShouldRender
                                            if={incidentPriorities.length > 0}
                                        >
                                            <div className="bs-Fieldset-row Margin-bottom--12">
                                                <label className="bs-Fieldset-label">
                                                    Priority
                                                </label>
                                                <div className="bs-Fieldset-fields">
                                                    <Field
                                                        className="db-select-nw"
                                                        component={RenderSelect}
                                                        name="incidentPriority"
                                                        placeholder="Incident Priority"
                                                        disabled={
                                                            this.props
                                                                .editIncident
                                                                .requesting
                                                        }
                                                        options={[
                                                            {
                                                                value: '',
                                                                label:
                                                                    'Select type',
                                                            },
                                                            ...incidentPriorities.map(
                                                                incidentPriority => ({
                                                                    value:
                                                                        incidentPriority._id,
                                                                    label:
                                                                        incidentPriority.name,
                                                                })
                                                            ),
                                                        ]}
                                                    />
                                                </div>
                                            </div>
                                        </ShouldRender>
                                        <div className="bs-Fieldset-row">
                                            <label className="bs-Fieldset-label">
                                                Incident title
                                            </label>
                                            <div className="bs-Fieldset-fields">
                                                <Field
                                                    className="db-BusinessSettings-input TextInput bs-TextInput"
                                                    component={RenderField}
                                                    name="title"
                                                    id="title"
                                                    placeholder="Incident title"
                                                    disabled={
                                                        this.props.editIncident
                                                            .requesting
                                                    }
                                                    validate={[
                                                        ValidateField.required,
                                                    ]}
                                                />
                                            </div>
                                        </div>
                                        <div className="bs-Fieldset-row">
                                            <label className="bs-Fieldset-label script-label">
                                                Description
                                            </label>
                                            <div className="bs-Fieldset-fields">
                                                <Field
                                                    name="description"
                                                    component={MarkdownEditor}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="bs-Modal-footer">
                                <div className="bs-Modal-footer-actions">
                                    <ShouldRender if={editIncident.error}>
                                        <div className="bs-Tail-copy">
                                            <div
                                                className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                style={{ marginTop: '10px' }}
                                            >
                                                <div className="Box-root Margin-right--8">
                                                    <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                </div>
                                                <div className="Box-root">
                                                    <span
                                                        style={{ color: 'red' }}
                                                    >
                                                        {editIncident.error}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </ShouldRender>
                                    <button
                                        className="bs-Button bs-DeprecatedButton"
                                        onClick={() =>
                                            this.props.closeThisDialog()
                                        }
                                    >
                                        <span>Cancel</span>
                                    </button>
                                    <button
                                        id="saveIncident"
                                        className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                        disabled={
                                            editIncident &&
                                            editIncident.requesting
                                        }
                                        type="submit"
                                    >
                                        {editIncident &&
                                            !editIncident.requesting && (
                                                <span>Save</span>
                                            )}
                                        {editIncident &&
                                            editIncident.requesting && (
                                                <FormLoader />
                                            )}
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        );
    }
}

EditIncident.displayName = 'CreateManualIncident';
EditIncident.propTypes = {
    incidentPriorities: PropTypes.array.isRequired,
};
const CreateManualIncidentForm = reduxForm({
    form: 'CreateManualIncident',
})(EditIncident);

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            updateIncident,
        },
        dispatch
    );
};

function mapStateToProps(state, ownProps) {
    const incident = ownProps.data.incident;
    const initialValues = {
        title: incident.title,
        description: incident.description,
        incidentPriority: incident.incidentPriority
            ? incident.incidentPriority._id
            : null,
        incidentType: incident.incidentType,
    };
    return {
        currentProject: state.project.currentProject,
        editIncident: state.incident.editIncident,
        incidentPriorities:
            state.incidentPriorities.incidentPrioritiesList.incidentPriorities,
        initialValues,
    };
}

EditIncident.propTypes = {
    updateIncident: PropTypes.func.isRequired,
    data: PropTypes.object,
    handleSubmit: PropTypes.func.isRequired,
    editIncident: PropTypes.object,
    currentProject: PropTypes.object.isRequired,
    closeThisDialog: PropTypes.func.isRequired,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(CreateManualIncidentForm);
