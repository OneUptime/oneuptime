import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { Field, reduxForm, change, formValueSelector } from 'redux-form';
import handlebars from 'handlebars';
import moment from 'moment';
import ClickOutside from 'react-click-outside';
import { createNewIncident } from '../../actions/incident';
import { ValidateField, renderIfUserInSubProject } from '../../config';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { history } from '../../store';
import { RenderSelect } from '../basic/RenderSelect';
import { RenderField } from '../basic/RenderField';
import RenderCodeEditor from '../basic/RenderCodeEditor';
import { fetchCustomFields } from '../../actions/customField';

class CreateIncident extends Component {
    constructor() {
        super();
        this.state = {
            monitorName: '',
            titleEdited: false,
            descriptionEdited: false,
            componentId: null,
        };
    }

    componentDidMount() {
        const { currentProject, fetchCustomFields } = this.props;
        fetchCustomFields(currentProject._id);

        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

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
            incidentPriority,
        } = values;
        let projectId = currentProject._id;
        const subProjectMonitor = monitors.find(
            subProjectMonitor => subProjectMonitor._id === data.subProjectId
        );
        subProjectMonitor.monitors.forEach(monitor => {
            if (monitor._id === values)
                projectId = monitor.projectId._id || monitor.projectId;
        });

        const customFields = this.props.customFields.map(field => ({
            fieldName: field.fieldName,
            fieldValue:
                field.fieldType === 'number'
                    ? parseFloat(values[field.fieldName])
                    : values[field.fieldName],
        }));

        createNewIncident(
            projectId,
            monitorId,
            incidentType,
            title,
            description,
            incidentPriority === '' ? null : incidentPriority,
            customFields
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
            case 'Enter':
                return document.getElementById('createIncident').click();
            default:
                return false;
        }
    };

    substituteVariables = (value, name) => {
        const { titleEdited, descriptionEdited } = this.state;

        if (titleEdited && descriptionEdited) return;

        const {
            monitors,
            incidentBasicSettings,
            data,
            change,
            selectedIncidentType,
            projectName,
        } = this.props;

        let monitorName = this.state.monitorName;

        const subProjectMonitor = monitors.find(
            subProjectMonitor => subProjectMonitor._id === data.subProjectId
        );

        if (
            name === 'monitorId' &&
            subProjectMonitor &&
            subProjectMonitor.monitors
        ) {
            monitorName = '';
            for (const monitor of subProjectMonitor.monitors) {
                if (value === monitor._id) {
                    monitorName = monitor.name;
                    this.setState({ monitorName });
                }
            }
        }

        const values = {
            incidentType: selectedIncidentType,
            monitorName,
            projectName,
            time: moment().format('h:mm:ss a'),
            date: moment().format('MMM Do YYYY'),
        };

        if (name === 'incidentType') values[name] = value;

        if (values['monitorName'] === '')
            values['monitorName'] = '{{Monitor Name}}';

        if (!titleEdited) {
            const titleTemplate = handlebars.compile(
                incidentBasicSettings.title
            );
            change('title', titleTemplate(values));
        }
        if (!descriptionEdited) {
            const descriptionTemplate = handlebars.compile(
                incidentBasicSettings.description
            );
            change('description', descriptionTemplate(values));
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
            customFields,
            components,
        } = this.props;
        const subProjectMonitor = monitors.find(
            subProjectMonitor => subProjectMonitor._id === data.subProjectId
        );

        const allMonitors =
            this.state.componentId &&
            subProjectMonitor.monitors.filter(
                monitor => monitor.componentId._id === this.state.componentId
            );

        return (
            <div
                className="ModalLayer-contents"
                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM">
                    <div className="bs-Modal bs-Modal--medium">
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
                                                subProjectMonitor.monitors
                                                    .length > 0 ? (
                                                    <div className="bs-Fieldset-rows">
                                                        <div className="bs-Fieldset-row Margin-bottom--12">
                                                            <label className="bs-Fieldset-label">
                                                                <span>
                                                                    {' '}
                                                                    Component{' '}
                                                                </span>
                                                            </label>
                                                            <Field
                                                                id="componentList"
                                                                name="componentId"
                                                                component={
                                                                    RenderSelect
                                                                }
                                                                className="db-select-nw"
                                                                validate={
                                                                    ValidateField.select
                                                                }
                                                                options={[
                                                                    {
                                                                        value:
                                                                            '',
                                                                        label:
                                                                            'Select a component',
                                                                    },
                                                                    ...(components &&
                                                                    components.length >
                                                                        0
                                                                        ? components.map(
                                                                              component => ({
                                                                                  value:
                                                                                      component._id,
                                                                                  label:
                                                                                      component.name,
                                                                              })
                                                                          )
                                                                        : []),
                                                                ]}
                                                                onChange={(
                                                                    event,
                                                                    newValue,
                                                                    previousValue,
                                                                    name
                                                                ) => {
                                                                    this.setState(
                                                                        {
                                                                            ...this
                                                                                .state,
                                                                            componentId: newValue,
                                                                        }
                                                                    );
                                                                    this.props.change(
                                                                        'monitorId',
                                                                        ''
                                                                    );
                                                                }}
                                                                autoFocus={true}
                                                            />
                                                        </div>
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
                                                                        value:
                                                                            '',
                                                                        label: !this
                                                                            .state
                                                                            .componentId
                                                                            ? 'No component is selected'
                                                                            : this
                                                                                  .state
                                                                                  .componentId &&
                                                                              allMonitors.length >
                                                                                  0
                                                                            ? 'Select a monitor'
                                                                            : 'No monitor for this component',
                                                                    },
                                                                    ...(allMonitors &&
                                                                    allMonitors.length >
                                                                        0
                                                                        ? allMonitors.map(
                                                                              monitor =>
                                                                                  monitor
                                                                                      .componentId
                                                                                      ._id ===
                                                                                      this
                                                                                          .state
                                                                                          .componentId && {
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
                                                                                  }
                                                                          )
                                                                        : []),
                                                                ]}
                                                                onChange={(
                                                                    event,
                                                                    newValue,
                                                                    previousValue,
                                                                    name
                                                                ) => {
                                                                    this.substituteVariables(
                                                                        newValue,
                                                                        name
                                                                    );
                                                                }}
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
                                                                    id="incidentTypeId"
                                                                    placeholder="Incident type"
                                                                    disabled={
                                                                        this
                                                                            .props
                                                                            .newIncident
                                                                            .requesting
                                                                    }
                                                                    validate={
                                                                        ValidateField.select
                                                                    }
                                                                    options={[
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
                                                                    onChange={(
                                                                        event,
                                                                        newValue,
                                                                        previousValue,
                                                                        name
                                                                    ) =>
                                                                        this.substituteVariables(
                                                                            newValue,
                                                                            name
                                                                        )
                                                                    }
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
                                                                        id="incidentPriority"
                                                                        disabled={
                                                                            this
                                                                                .props
                                                                                .newIncident
                                                                                .requesting
                                                                        }
                                                                        options={[
                                                                            ...incidentPriorities.map(
                                                                                incidentPriority => ({
                                                                                    value:
                                                                                        incidentPriority._id,
                                                                                    label:
                                                                                        incidentPriority.name,
                                                                                })
                                                                            ),
                                                                        ]}
                                                                        onChange={(
                                                                            event,
                                                                            newValue,
                                                                            previousValue,
                                                                            name
                                                                        ) =>
                                                                            this.substituteVariables(
                                                                                newValue,
                                                                                name
                                                                            )
                                                                        }
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
                                                                        this
                                                                            .props
                                                                            .newIncident
                                                                            .requesting
                                                                    }
                                                                    validate={[
                                                                        ValidateField.required,
                                                                    ]}
                                                                    onChange={() =>
                                                                        this.setState(
                                                                            {
                                                                                titleEdited: true,
                                                                            }
                                                                        )
                                                                    }
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
                                                                        RenderCodeEditor
                                                                    }
                                                                    mode="markdown"
                                                                    height="150px"
                                                                    width="100%"
                                                                    placeholder="This can be markdown"
                                                                    wrapEnabled={
                                                                        true
                                                                    }
                                                                    onChange={() =>
                                                                        this.setState(
                                                                            {
                                                                                descriptionEdited: true,
                                                                            }
                                                                        )
                                                                    }
                                                                />
                                                            </div>
                                                        </div>
                                                        {customFields &&
                                                            customFields.length >
                                                                0 && (
                                                                <>
                                                                    {customFields.map(
                                                                        (
                                                                            field,
                                                                            index
                                                                        ) => (
                                                                            <div
                                                                                key={
                                                                                    index
                                                                                }
                                                                                className="bs-Fieldset-row Margin-bottom--12"
                                                                            >
                                                                                <label className="bs-Fieldset-label">
                                                                                    {
                                                                                        field.fieldName
                                                                                    }
                                                                                </label>
                                                                                <div className="bs-Fieldset-fields">
                                                                                    <Field
                                                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                                        component={
                                                                                            RenderField
                                                                                        }
                                                                                        name={
                                                                                            field.fieldName
                                                                                        }
                                                                                        id={
                                                                                            field.fieldName
                                                                                        }
                                                                                        type={
                                                                                            field.fieldType
                                                                                        }
                                                                                        disabled={
                                                                                            this
                                                                                                .props
                                                                                                .newIncident
                                                                                                .requesting
                                                                                        }
                                                                                    />
                                                                                </div>
                                                                            </div>
                                                                        )
                                                                    )}
                                                                </>
                                                            )}
                                                    </div>
                                                ) : (
                                                    <label className="bs-Fieldset-label">
                                                        <span>
                                                            {' '}
                                                            No monitor added
                                                            yet.{' '}
                                                        </span>
                                                        <div
                                                            className="bs-ObjectList-copy bs-is-highlighted"
                                                            style={{
                                                                display:
                                                                    'inline',
                                                                textAlign:
                                                                    'left',
                                                                cursor:
                                                                    'pointer',
                                                            }}
                                                            onClick={() => {
                                                                closeThisDialog();
                                                                history.push(
                                                                    '/dashboard/project/' +
                                                                        this
                                                                            .props
                                                                            .currentProject
                                                                            ._id +
                                                                        '/components'
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
                                    <div className="Flex-flex Flex-Flex-direction--row">
                                        <ShouldRender
                                            if={
                                                this.props.newIncident &&
                                                this.props.newIncident.error
                                            }
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
                                            className="bs-Button bs-DeprecatedButton btn__modal"
                                            type="button"
                                            onClick={closeThisDialog}
                                            style={{ height: '35px' }}
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <ShouldRender
                                            if={
                                                subProjectMonitor &&
                                                subProjectMonitor.monitors &&
                                                subProjectMonitor.monitors
                                                    .length > 0
                                            }
                                        >
                                            <button
                                                id="createIncident"
                                                className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                                disabled={
                                                    this.props.newIncident &&
                                                    this.props.newIncident
                                                        .requesting
                                                }
                                                type="submit"
                                                style={{ height: '35px' }}
                                            >
                                                {this.props.newIncident &&
                                                    !this.props.newIncident
                                                        .requesting && (
                                                        <>
                                                            <span>Create</span>
                                                            <span className="create-btn__keycode">
                                                                <span className="keycode__icon keycode__icon--enter" />
                                                            </span>
                                                        </>
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
                        </ClickOutside>
                    </div>
                </div>
            </div>
        );
    }
}

CreateIncident.displayName = 'CreateIncidentFormModal';
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
    change: PropTypes.func.isRequired,
    selectedIncidentType: PropTypes.string.isRequired,
    projectName: PropTypes.string.isRequired,
    incidentBasicSettings: PropTypes.object.isRequired,
    fetchCustomFields: PropTypes.func,
    customFields: PropTypes.array,
};

const formName = 'CreateNewIncident';

const CreateIncidentForm = reduxForm({
    form: formName, // a unique identifier for this form
})(CreateIncident);

const selector = formValueSelector(formName);

function mapStateToProps(state, props) {
    const { data } = props;
    const { subProjectId } = data;
    const { projects } = state.project.projects;
    const { subProjects } = state.subProject.subProjects;
    const components = state.component.componentList.components[0].components;
    let projectName = '';
    for (const project of projects) {
        if (project._id === subProjectId) projectName = project.name;
    }
    if (projectName === '') {
        for (const subProject of subProjects) {
            if (subProject._id === subProjectId) projectName = subProject.name;
        }
    }
    const incidentType = 'offline';
    const values = {
        incidentType,
        monitorName: '{{Monitor Name}}',
        projectName,
        time: moment().format('h:mm:ss a'),
        date: moment().format('MMM Do YYYY'),
    };
    const titleTemplate = handlebars.compile(
        state.incidentBasicSettings.incidentBasicSettings.title
    );
    const descriptionTemplate = handlebars.compile(
        state.incidentBasicSettings.incidentBasicSettings.description
    );
    const initialValues = {
        incidentType,
        title: titleTemplate(values),
        description: descriptionTemplate(values),
        incidentPriority:
            state.incidentBasicSettings.incidentBasicSettings.incidentPriority,
    };

    const selectedIncidentType = selector(state, 'incidentType');
    return {
        monitors: state.monitor.monitorsList.monitors,
        subProjects: state.subProject.subProjects.subProjects,
        currentProject: state.project.currentProject,
        newIncident: state.incident.newIncident,
        incidentPriorities:
            state.incidentPriorities.incidentPrioritiesList.incidentPriorities,
        incidentBasicSettings:
            state.incidentBasicSettings.incidentBasicSettings,
        selectedIncidentType,
        initialValues,
        projectName,
        customFields: state.customField.customFields.fields,
        components,
    };
}

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            createNewIncident,
            change,
            fetchCustomFields,
        },
        dispatch
    );
};

export default connect(mapStateToProps, mapDispatchToProps)(CreateIncidentForm);
