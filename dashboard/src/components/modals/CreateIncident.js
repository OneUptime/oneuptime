import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { Field, reduxForm } from 'redux-form';
import { createNewIncident } from '../../actions/incident';
import { ValidateField, renderIfUserInSubProject } from '../../config';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { history } from '../../store';
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

MarkdownEditor.displayName = 'CreateIncidentMarkdownEditor';
MarkdownEditor.propTypes = {
    input: PropTypes.object.isRequired,
};

class CreateIncident extends Component {
    submitForm = values => {
        const {
            createNewIncident,
            closeThisDialog,
            currentProject,
            monitors,
            data,
        } = this.props;
        const {
            monitorId,
            incidentType,
            title,
            description,
            incidentPriorities,
        } = values;
        let projectId = currentProject._id;
        const subProjectMonitor = monitors.find(
            subProjectMonitor => subProjectMonitor._id === data.subProjectId
        );
        subProjectMonitor.monitors.forEach(monitor => {
            if (monitor._id === values)
                projectId = monitor.projectId._id || monitor.projectId;
        });
        createNewIncident(
            projectId,
            monitorId,
            incidentType,
            title,
            description,
            incidentPriorities
        ).then(
            function() {
                closeThisDialog();
            },
            function() {
                //do nothing.
            }
        );
    };

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeThisDialog();
            default:
                return false;
        }
    };

    render() {
        const {
            handleSubmit,
            subProjects,
            currentProject,
            closeThisDialog,
            data,
            monitors,
            incidentPriorities,
        } = this.props;
        const subProjectMonitor = monitors.find(
            subProjectMonitor => subProjectMonitor._id === data.subProjectId
        );

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
                                    <span>Create New Incident</span>
                                </span>
                            </div>
                        </div>
                        <form
                            id="frmIncident"
                            onSubmit={handleSubmit(this.submitForm)}
                        >
                            <div className="bs-Modal-content bs-u-paddingless">
                                <div className="bs-Modal-block bs-u-paddingless">
                                    <div className="bs-Modal-content">
                                        <span className="bs-Fieldset">
                                            {subProjectMonitor &&
                                            subProjectMonitor.monitors &&
                                            subProjectMonitor.monitors.length >
                                                0 ? (
                                                <div className="bs-Fieldset-rows">
                                                    <div className="bs-Fieldset-row Margin-bottom--12">
                                                        <label className="bs-Fieldset-label">
                                                            <span>
                                                                {' '}
                                                                Monitor{' '}
                                                            </span>
                                                        </label>
                                                        <Field
                                                            id="monitorList"
                                                            name="monitorId"
                                                            component={
                                                                RenderSelect
                                                            }
                                                            className="db-select-nw"
                                                            validate={
                                                                ValidateField.select
                                                            }
                                                            options={[
                                                                {
                                                                    value: '',
                                                                    label:
                                                                        'Select a monitor',
                                                                },
                                                                ...(subProjectMonitor &&
                                                                subProjectMonitor
                                                                    .monitors
                                                                    .length > 0
                                                                    ? subProjectMonitor.monitors.map(
                                                                          monitor => ({
                                                                              value:
                                                                                  monitor._id,
                                                                              label:
                                                                                  monitor.name,
                                                                              show: renderIfUserInSubProject(
                                                                                  currentProject,
                                                                                  subProjects,
                                                                                  monitor
                                                                                      .projectId
                                                                                      ._id ||
                                                                                      monitor.projectId
                                                                              ),
                                                                          })
                                                                      )
                                                                    : []),
                                                            ]}
                                                        />
                                                    </div>
                                                    <div className="bs-Fieldset-row Margin-bottom--12">
                                                        <label className="bs-Fieldset-label">
                                                            Incident type
                                                        </label>
                                                        <div className="bs-Fieldset-fields">
                                                            <Field
                                                                className="db-select-nw"
                                                                component={
                                                                    RenderSelect
                                                                }
                                                                name="incidentType"
                                                                id="incidentType"
                                                                placeholder="Incident type"
                                                                disabled={
                                                                    this.props
                                                                        .newIncident
                                                                        .requesting
                                                                }
                                                                validate={
                                                                    ValidateField.select
                                                                }
                                                                options={[
                                                                    {
                                                                        value:
                                                                            '',
                                                                        label:
                                                                            'Select type',
                                                                    },
                                                                    {
                                                                        value:
                                                                            'online',
                                                                        label:
                                                                            'Online',
                                                                    },
                                                                    {
                                                                        value:
                                                                            'offline',
                                                                        label:
                                                                            'Offline',
                                                                    },
                                                                    {
                                                                        value:
                                                                            'degraded',
                                                                        label:
                                                                            'Degraded',
                                                                    },
                                                                ]}
                                                            />
                                                        </div>
                                                    </div>
                                                    <ShouldRender
                                                        if={
                                                            incidentPriorities.length >
                                                            0
                                                        }
                                                    >
                                                        <div className="bs-Fieldset-row Margin-bottom--12">
                                                            <label className="bs-Fieldset-label">
                                                                Priority
                                                            </label>
                                                            <div className="bs-Fieldset-fields">
                                                                <Field
                                                                    className="db-select-nw"
                                                                    component={
                                                                        RenderSelect
                                                                    }
                                                                    name="incidentPriority"
                                                                    placeholder="Incident Priority"
                                                                    disabled={
                                                                        this
                                                                            .props
                                                                            .newIncident
                                                                            .requesting
                                                                    }
                                                                    options={[
                                                                        {
                                                                            value:
                                                                                '',
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
                                                    <div className="bs-Fieldset-row Margin-bottom--12">
                                                        <label className="bs-Fieldset-label">
                                                            Incident title
                                                        </label>
                                                        <div className="bs-Fieldset-fields">
                                                            <Field
                                                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                component={
                                                                    RenderField
                                                                }
                                                                name="title"
                                                                id="title"
                                                                placeholder="Incident title"
                                                                disabled={
                                                                    this.props
                                                                        .newIncident
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
                                                                component={
                                                                    MarkdownEditor
                                                                }
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : (
                                                <label className="bs-Fieldset-label">
                                                    <span>
                                                        {' '}
                                                        No monitor added yet.{' '}
                                                    </span>
                                                    <div
                                                        className="bs-ObjectList-copy bs-is-highlighted"
                                                        style={{
                                                            display: 'inline',
                                                            textAlign: 'left',
                                                            cursor: 'pointer',
                                                        }}
                                                        onClick={() => {
                                                            closeThisDialog();
                                                            history.push(
                                                                '/dashboard/project/' +
                                                                    this.props
                                                                        .currentProject
                                                                        ._id +
                                                                    '/monitoring'
                                                            );
                                                        }}
                                                    >
                                                        Please create one.
                                                    </div>
                                                </label>
                                            )}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div className="bs-Modal-footer">
                                <div className="bs-Modal-footer-actions">
                                    <ShouldRender
                                        if={
                                            this.props.newIncident &&
                                            this.props.newIncident.error
                                        }
                                    >
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
                                                        {
                                                            this.props
                                                                .newIncident
                                                                .error
                                                        }
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </ShouldRender>
                                    <button
                                        className="bs-Button bs-DeprecatedButton"
                                        type="button"
                                        onClick={closeThisDialog}
                                    >
                                        <span>Cancel</span>
                                    </button>
                                    <ShouldRender
                                        if={
                                            subProjectMonitor &&
                                            subProjectMonitor.monitors &&
                                            subProjectMonitor.monitors.length >
                                                0
                                        }
                                    >
                                        <button
                                            id="createIncident"
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                            disabled={
                                                this.props.newIncident &&
                                                this.props.newIncident
                                                    .requesting
                                            }
                                            type="submit"
                                        >
                                            {this.props.newIncident &&
                                                !this.props.newIncident
                                                    .requesting && (
                                                    <span>Create</span>
                                                )}
                                            {this.props.newIncident &&
                                                this.props.newIncident
                                                    .requesting && (
                                                    <FormLoader />
                                                )}
                                        </button>
                                    </ShouldRender>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        );
    }
}

CreateIncident.displayName = 'CreateIncidentFormModal';

const CreateIncidentForm = reduxForm({
    form: 'CreateNewIncident', // a unique identifier for this form
})(CreateIncident);

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            createNewIncident,
        },
        dispatch
    );
};

function mapStateToProps(state) {
    return {
        monitors: state.monitor.monitorsList.monitors,
        subProjects: state.subProject.subProjects.subProjects,
        currentProject: state.project.currentProject,
        newIncident: state.incident.newIncident,
        incidentPriorities:
            state.incidentPriorities.incidentPrioritiesList.incidentPriorities,
    };
}

CreateIncident.propTypes = {
    closeThisDialog: PropTypes.func.isRequired,
    createNewIncident: PropTypes.func.isRequired,
    subProjects: PropTypes.array,
    currentProject: PropTypes.object,
    handleSubmit: PropTypes.func,
    monitors: PropTypes.array,
    newIncident: PropTypes.object,
    error: PropTypes.object,
    requesting: PropTypes.bool,
    data: PropTypes.object,
    incidentPriorities: PropTypes.array.isRequired,
};

export default connect(mapStateToProps, mapDispatchToProps)(CreateIncidentForm);
