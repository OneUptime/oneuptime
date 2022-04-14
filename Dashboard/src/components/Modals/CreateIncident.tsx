import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

import { Field, reduxForm, change, formValueSelector } from 'redux-form';

import ClickOutside from 'react-click-outside';
import { createNewIncident, resetCreateIncident } from '../../actions/incident';
import {
    ValidateField,
    // renderIfUserInSubProject
} from '../../config';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { history, RootState } from '../../store';
import { RenderSelect } from '../basic/RenderSelect';
import { RenderField } from '../basic/RenderField';
import RenderCodeEditor from '../basic/RenderCodeEditor';
import { fetchCustomFields } from '../../actions/customField';
import { getIncidents, getComponentIncidents } from '../../actions/incident';
import { closeModal } from 'CommonUI/actions/modal';
import MultiSelectDropDown from '../basic/MultiSelectDropDown';

interface CreateIncidentProps {
    closeModal: Function;
    createNewIncident: Function;
    // subProjects: PropTypes.array,
    currentProject?: object;
    handleSubmit?: Function;
    monitors?: unknown[];
    newIncident?: object;
    error?: object;
    requesting?: boolean;
    data?: object;
    incidentPriorities: unknown[];
    change: Function;
    fetchCustomFields?: Function;
    resetCreateIncident?: Function;
    customFields?: unknown[];
    componentId?: string;
    monitorsList?: unknown[];
    formValues?: object;
    componentSlug?: string;
    getIncidents?: Function;
    getComponentIncidents?: Function;
    subProjectId?: string;
    currentProjectId?: string;
    incidentTemplateObj?: object;
}

class CreateIncident extends Component<ComponentProps> {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            componentId: props.componentId,
            monitorError: null,
            loading: false,
            selectedProjects: [],
            selectedComponents: [],
            selectedMonitors: [],
            selectData: [],
        };
    }

    override componentDidMount() {
        const {

            currentProject,

            fetchCustomFields,

            resetCreateIncident,
        } = this.props;
        fetchCustomFields(currentProject._id);
        resetCreateIncident();

        this.formatData();

        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = async (values: $TSFixMe) => {
        const {

            createNewIncident,

            closeModal,

            currentProject,

            data,

            monitorsList,

            monitors: subProjectMonitors,

            componentSlug,

            subProjectId,

            componentId,

            getIncidents,

            getComponentIncidents,

            currentProjectId,
        } = this.props;
        const thisObj = this;

        const {
            incidentType,
            title,
            description,
            incidentPriority,
            selectAllMonitors,
        } = values;
        let monitors = [];
        if (

            this.state.selectedMonitors &&

            this.state.selectedMonitors.length > 0
        ) {

            monitors = this.state.selectedMonitors;
        }
        if (
            (!monitors || (monitors && monitors.length === 0)) &&
            !selectAllMonitors
        ) {
            this.setState({
                monitorError: 'No monitor was selected',
            });
            return;
        }

        if (selectAllMonitors) {
            const allMonitors = monitorsList;
            monitors = allMonitors.map((monitor: $TSFixMe) => monitor._id);
        }

        const isDuplicate = monitors
            ? monitors.length === new Set(monitors).size
                ? false
                : true
            : false;

        if (isDuplicate) {
            this.setState({
                monitorError: 'Duplicate monitor selection found',
            });
            return;
        }

        // const subProjectId = data.subProjectId;
        const subProjectMonitor = subProjectMonitors.find(
            (subProjectMonitor: $TSFixMe) => subProjectMonitor._id === data.subProjectId
        );
        subProjectMonitor.monitors.forEach((monitor: $TSFixMe) => {
            if (monitor._id === values)
                currentProject._id = monitor.projectId._id || monitor.projectId;
        });


        const customFields = this.props.customFields.map((field: $TSFixMe) => ({
            fieldName: field.fieldName,
            fieldType: field.fieldType,
            uniqueField: field.uniqueField,

            fieldValue:
                field.fieldType === 'number'
                    ? parseFloat(values[field.fieldName])
                    : values[field.fieldName]
        }));

        this.setState({ loading: true });

        createNewIncident(
            subProjectId,
            monitors,
            incidentType,
            title,
            description,
            incidentPriority === '' ? null : incidentPriority,
            customFields
        ).then(
            function () {
                thisObj.setState({ loading: false });
                closeModal({});
                if (componentSlug) {
                    getComponentIncidents(subProjectId, componentId);
                } else {
                    getIncidents(currentProjectId, 0, 10);
                }
            },
            function () {
                //do nothing.
            }
        );
    };

    handleKeyBoard = (e: $TSFixMe) => {
        if (e.target.localName === 'body' && e.key) {
            switch (e.key) {
                case 'Escape':

                    return this.props.closeModal({});
                case 'Enter':

                    return document.getElementById('createIncident').click();
                default:
                    return false;
            }
        }
    };

    setTemplateValues = (value: $TSFixMe) => {

        const { change, incidentTemplateObj } = this.props;

        if (value) {
            !incidentTemplateObj.requesting &&
                incidentTemplateObj.templates.forEach((template: $TSFixMe) => {
                    if (String(template._id) === String(value)) {
                        change('title', template.title);
                        change('description', template.description);
                        template.incidentPriority &&
                            change(
                                'incidentPriority',
                                template.incidentPriority._id ||
                                template.incidentPriority
                            );
                    }
                });
        }
    };

    formatData = () => {

        const monitors = this.props.monitorsList;
        const hash = {};

        monitors.forEach((monitor: $TSFixMe) => {
            const projectId = monitor.projectId._id || monitor.projectId;
            const componentId = monitor.componentId._id || monitor.componentId;

            if (!hash[projectId]) {

                hash[projectId] = {
                    projectName: monitor.projectId?.name,
                    projectId,
                    components: [
                        {
                            componentName: monitor.componentId?.name,
                            componentId,
                            monitors: [
                                {
                                    monitorName: monitor.name,
                                    monitorId: monitor._id,
                                },
                            ],
                        },
                    ],
                };
            } else {
                let monitorAdded = false;

                hash[projectId] = {

                    ...hash[projectId],

                    components: hash[projectId].components.map((componentObj: $TSFixMe) => {
                        if (componentObj.componentId === componentId) {
                            const newMonitor = {
                                monitorName: monitor.name,
                                monitorId: monitor._id,
                            };

                            componentObj.monitors = [
                                ...componentObj.monitors,
                                newMonitor,
                            ];

                            monitorAdded = true;
                        }

                        return componentObj;
                    }),
                };

                if (!monitorAdded) {
                    const componentData = {
                        componentName: monitor.componentId.name,
                        componentId,
                        monitors: [
                            {
                                monitorName: monitor.name,
                                monitorId: monitor._id,
                            },
                        ],
                    };

                    hash[projectId] = {

                        ...hash[projectId],
                        components: [

                            ...hash[projectId].components,
                            componentData,
                        ],
                    };

                    monitorAdded = true;
                }
            }
        });

        const data = [];
        for (const [, value] of Object.entries(hash)) {
            data.push(value);
        }

        this.setState({
            selectData: data,
        });
    };

    updateState = (value: $TSFixMe, key: $TSFixMe) => {
        this.setState(prevState => {

            let currentValue = prevState[key];

            if (currentValue.includes(value)) {
                currentValue = currentValue.filter((val: $TSFixMe) => val !== value);
                this.updateMultipleState(value, key, currentValue);

                return {
                    [key]: currentValue,
                };
            }

            currentValue = [...currentValue, value];
            this.updateMultipleState(value, key, currentValue);

            return {
                [key]: currentValue,
            };
        });
    };

    updateMultipleState = (id: $TSFixMe, key: $TSFixMe, databank: $TSFixMe) => {
        if (key === 'selectedProjects' && databank.includes(id)) {
            const monitorIds: $TSFixMe = [];
            const componentIds: $TSFixMe = [];

            this.props.monitorsList.forEach((monitor: $TSFixMe) => {
                if ((monitor.projectId._id || monitor.projectId) === id) {
                    monitorIds.push(monitor._id);
                    componentIds.push(
                        monitor.componentId._id || monitor.componentId
                    );
                }
            });

            return this.setState(prevState => ({
                selectedMonitors: Array.from(

                    new Set([...prevState.selectedMonitors, ...monitorIds])
                ),
                selectedComponents: Array.from(

                    new Set([...prevState.selectedComponents, ...componentIds])
                ),
            }));
        }

        if (key === 'selectedProjects' && !databank.includes(id)) {
            const monitorIds: $TSFixMe = [];
            const componentIds: $TSFixMe = [];

            this.props.monitorsList.forEach((monitor: $TSFixMe) => {
                if ((monitor.projectId._id || monitor.projectId) === id) {
                    monitorIds.push(monitor._id);
                    componentIds.push(
                        monitor.componentId._id || monitor.componentId
                    );
                }
            });

            return this.setState(prevState => ({

                selectedMonitors: prevState.selectedMonitors.filter(
                    (monitorId: $TSFixMe) => !monitorIds.includes(monitorId)
                ),

                selectedComponents: prevState.selectedComponents.filter(
                    (componentId: $TSFixMe) => !componentIds.includes(componentId)
                ),
            }));
        }

        if (key === 'selectedComponents' && databank.includes(id)) {
            const monitorIds: $TSFixMe = [];

            this.props.monitorsList.forEach((monitor: $TSFixMe) => {
                if ((monitor.componentId._id || monitor.componentId) === id) {
                    monitorIds.push(monitor._id);
                }
            });

            return this.setState(prevState => ({
                selectedMonitors: Array.from(

                    new Set([...prevState.selectedMonitors, ...monitorIds])
                ),
            }));
        }

        if (key === 'selectedComponents' && !databank.includes(id)) {
            const monitorIds: $TSFixMe = [];

            this.props.monitorsList.forEach((monitor: $TSFixMe) => {
                if ((monitor.componentId._id || monitor.componentId) === id) {
                    monitorIds.push(monitor._id);
                }
            });

            return this.setState(prevState => ({

                selectedMonitors: prevState.selectedMonitors.filter(
                    (monitorId: $TSFixMe) => !monitorIds.includes(monitorId)
                ),
            }));
        }
    };

    override render() {
        const {

            handleSubmit,

            closeModal,

            data,

            monitors,

            incidentPriorities,

            customFields,

            monitorsList,

            componentId,

            incidentTemplateObj,
        } = this.props;


        const { formValues } = this.props;
        const {

            selectedProjects,

            selectedComponents,

            selectedMonitors,

            selectData,
        } = this.state;

        const subProjectMonitor = monitors.find(
            (subProjectMonitor: $TSFixMe) => subProjectMonitor._id === data.subProjectId
        );

        const allMonitors =

            this.state.componentId &&
            monitorsList.filter(

                (monitor: $TSFixMe) => monitor.componentId._id === this.state.componentId
            );

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
                                                {(!componentId &&
                                                    monitorsList &&
                                                    monitorsList.length > 0) ||
                                                    (allMonitors &&
                                                        allMonitors.length &&
                                                        componentId) ? (
                                                    <div className="bs-Fieldset-rows">
                                                        <div className="bs-Fieldset-row Margin-bottom--12 Padding-left--0">
                                                            <label className="bs-Fieldset-label">
                                                                <span>
                                                                    {' '}
                                                                    Monitors{' '}
                                                                </span>
                                                            </label>
                                                            {formValues &&
                                                                formValues.selectAllMonitors && (
                                                                    <div
                                                                        className="bs-Fieldset-row"
                                                                        style={{
                                                                            padding: 0,
                                                                            width:
                                                                                '100%',
                                                                        }}
                                                                    >
                                                                        <div
                                                                            className="bs-Fieldset-fields bs-Fieldset-fields--wide"
                                                                            style={{
                                                                                padding: 0,
                                                                            }}
                                                                        >
                                                                            <div
                                                                                className="Box-root"
                                                                                style={{
                                                                                    height:
                                                                                        '5px',
                                                                                }}
                                                                            ></div>
                                                                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                                                <label
                                                                                    className="Checkbox"
                                                                                    htmlFor="selectAllMonitorsBox"
                                                                                >
                                                                                    <Field
                                                                                        component="input"
                                                                                        type="checkbox"
                                                                                        name="selectAllMonitors"
                                                                                        className="Checkbox-source"
                                                                                        id="selectAllMonitorsBox"
                                                                                    />
                                                                                    <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                                        <div className="Checkbox-target Box-root">
                                                                                            <div className="Checkbox-color Box-root"></div>
                                                                                        </div>
                                                                                    </div>
                                                                                    <div className="Checkbox-label Box-root Margin-left--8">
                                                                                        <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                                            <span>
                                                                                                All
                                                                                                Monitors
                                                                                                Selected
                                                                                            </span>
                                                                                        </span>
                                                                                    </div>
                                                                                </label>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            {formValues &&
                                                                !formValues.selectAllMonitors && (
                                                                    <div className="bs-Fieldset-fields">
                                                                        <div
                                                                            className="bs-Fieldset-field"
                                                                            style={{
                                                                                width:
                                                                                    '100%',
                                                                            }}
                                                                        >
                                                                            <MultiSelectDropDown
                                                                                ready={
                                                                                    true
                                                                                }
                                                                                value={`${selectedMonitors.length
                                                                                    } Monitor${selectedMonitors.length >
                                                                                        0
                                                                                        ? 's'
                                                                                        : ''
                                                                                    } Selected`}
                                                                                updateState={
                                                                                    this
                                                                                        .updateState
                                                                                }
                                                                                selectedProjects={
                                                                                    selectedProjects
                                                                                }
                                                                                selectedComponents={
                                                                                    selectedComponents
                                                                                }
                                                                                selectedMonitors={
                                                                                    selectedMonitors
                                                                                }
                                                                                options={
                                                                                    selectData
                                                                                }
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                )}
                                                        </div>
                                                        <div className="bs-Fieldset-row Margin-bottom--12 Padding-left--0">
                                                            <label
                                                                className="bs-Fieldset-label"
                                                                id="incidentType"
                                                            >
                                                                Incident type
                                                            </label>
                                                            <div className="bs-Fieldset-fields">
                                                                <Field
                                                                    className="db-select-nw db-select-fw"
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
                                                                    style={{
                                                                        width:
                                                                            '100%',
                                                                    }}
                                                                />
                                                            </div>
                                                        </div>
                                                        {!incidentTemplateObj.requesting &&
                                                            incidentTemplateObj
                                                                .templates
                                                                .length > 1 && (
                                                                <div className="bs-Fieldset-row Margin-bottom--12 Padding-left--0">
                                                                    <label className="bs-Fieldset-label">
                                                                        Incident
                                                                        Templates
                                                                    </label>
                                                                    <div className="bs-Fieldset-fields">
                                                                        <Field
                                                                            className="db-select-nw db-select-fw"
                                                                            component={
                                                                                RenderSelect
                                                                            }
                                                                            name="incidentTemplate"
                                                                            id="incidentTemplate"
                                                                            placeholder="Incident template"
                                                                            disabled={
                                                                                this
                                                                                    .props

                                                                                    .newIncident
                                                                                    .requesting
                                                                            }
                                                                            options={[
                                                                                ...incidentTemplateObj.templates.map(
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
                                                                                this.setTemplateValues(
                                                                                    newValue
                                                                                )
                                                                            }
                                                                            style={{
                                                                                width:
                                                                                    '100%',
                                                                            }}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            )}
                                                        <ShouldRender
                                                            if={
                                                                incidentPriorities.length >
                                                                0
                                                            }
                                                        >
                                                            <div className="bs-Fieldset-row Margin-bottom--12 Padding-left--0">
                                                                <label className="bs-Fieldset-label">
                                                                    Priority
                                                                </label>
                                                                <div className="bs-Fieldset-fields">
                                                                    <Field
                                                                        className="db-select-nw db-select-fw"
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
                                                                                (incidentPriority: $TSFixMe) => ({
                                                                                    value:
                                                                                        incidentPriority._id,

                                                                                    label:
                                                                                        incidentPriority.name
                                                                                })
                                                                            ),
                                                                        ]}
                                                                        style={{
                                                                            width:
                                                                                '100%',
                                                                        }}
                                                                    />
                                                                </div>
                                                            </div>
                                                        </ShouldRender>
                                                        <div className="bs-Fieldset-row Margin-bottom--12 Padding-left--0">
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
                                                                    style={{
                                                                        width:
                                                                            '100%',
                                                                    }}
                                                                />
                                                            </div>
                                                        </div>
                                                        <div className="bs-Fieldset-row Padding-left--0">
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
                                                                />
                                                            </div>
                                                        </div>
                                                        {customFields &&
                                                            customFields.length >
                                                            0 && (
                                                                <>
                                                                    {customFields.map(
                                                                        (
                                                                            field: $TSFixMe,
                                                                            index: $TSFixMe
                                                                        ) => (
                                                                            <div
                                                                                key={
                                                                                    index
                                                                                }
                                                                                className="bs-Fieldset-row Margin-bottom--12 Padding-left--0"
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
                                                                                        style={{
                                                                                            width:
                                                                                                '100%',
                                                                                        }}
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
                                                                closeModal();
                                                                history.push(
                                                                    '/dashboard/project/' +
                                                                    this
                                                                        .props

                                                                        .currentProject
                                                                        .slug +
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
                                    <div
                                        className="bs-Modal-footer-actions"
                                        style={{
                                            width: '100%',
                                            flexWrap: 'nowrap',
                                        }}
                                    >
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
                                            onClick={closeModal}
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
                                                        .requesting &&

                                                    !this.state.loading && (
                                                        <>
                                                            <span>Create</span>
                                                            <span className="create-btn__keycode">
                                                                <span className="keycode__icon keycode__icon--enter" />
                                                            </span>
                                                        </>
                                                    )}

                                                {this.props.newIncident &&

                                                    (this.props.newIncident
                                                        .requesting ||

                                                        this.state.loading) && (
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
    closeModal: PropTypes.func.isRequired,
    createNewIncident: PropTypes.func.isRequired,
    // subProjects: PropTypes.array,
    currentProject: PropTypes.object,
    handleSubmit: PropTypes.func,
    monitors: PropTypes.array,
    newIncident: PropTypes.object,
    error: PropTypes.object,
    requesting: PropTypes.bool,
    data: PropTypes.object,
    incidentPriorities: PropTypes.array.isRequired,
    change: PropTypes.func.isRequired,
    fetchCustomFields: PropTypes.func,
    resetCreateIncident: PropTypes.func,
    customFields: PropTypes.array,
    componentId: PropTypes.string,
    monitorsList: PropTypes.array,
    formValues: PropTypes.object,
    componentSlug: PropTypes.string,
    getIncidents: PropTypes.func,
    getComponentIncidents: PropTypes.func,
    subProjectId: PropTypes.string,
    currentProjectId: PropTypes.string,
    incidentTemplateObj: PropTypes.object,
};

const  formName: string = 'CreateNewIncident';

const CreateIncidentForm = reduxForm({
    form: formName, // a unique identifier for this form
    enableReinitialize: true,
    destroyOnUnmount: true,
})(CreateIncident);

const selector = formValueSelector(formName);

function mapStateToProps(state: RootState, props: $TSFixMe) {
    const { data } = props;
    const { subProjectId, componentId, componentSlug, currentProjectId } = data;
    const { projects } = state.project.projects;
    const { subProjects } = state.subProject.subProjects;
    const incidentTemplateObj = state.incidentBasicSettings.incidentTemplates;
    const defaultTemplateObj = state.incidentBasicSettings.defaultTemplate;

    const monitorsList: $TSFixMe = [];
    state.monitor.monitorsList.monitors.forEach((item: $TSFixMe) => {
        item.monitors.forEach((m: $TSFixMe) => {
            monitorsList.push(m);
        });
    });

    let projectName = '';
    for (const project of projects) {
        if (project._id === subProjectId) projectName = project.name;
    }
    if (projectName === '') {
        for (const subProject of subProjects) {
            if (subProject._id === subProjectId) projectName = subProject.name;
        }
    }

    const  incidentType: string = 'offline';
    const initialValues = {
        incidentType,
        selectAllMonitors: false,
    };
    const defaultTemplate = defaultTemplateObj.template;
    if (defaultTemplate) {

        initialValues.incidentTemplate = defaultTemplate._id;

        initialValues.title = defaultTemplate.title;

        initialValues.description = defaultTemplate.description;

        initialValues.incidentPriority =
            defaultTemplate.incidentPriority._id ||
            defaultTemplate.incidentPriority;
    }

    const selectedIncidentType = selector(state, 'incidentType');
    return {
        monitorsList,
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
        componentId,
        subProjectId,
        formValues:
            state.form.CreateNewIncident && state.form.CreateNewIncident.values,
        componentSlug,
        currentProjectId,
        incidentTemplateObj,
    };
}

const mapDispatchToProps: Function = (dispatch: Dispatch) => {
    return bindActionCreators(
        {
            createNewIncident,
            change,
            fetchCustomFields,
            resetCreateIncident,
            getIncidents,
            getComponentIncidents,
            closeModal,
        },
        dispatch
    );
};

export default connect(mapStateToProps, mapDispatchToProps)(CreateIncidentForm);
