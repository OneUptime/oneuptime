import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

import { reduxForm, Field, FieldArray } from 'redux-form';

import ClickOutside from 'react-click-outside';
import { closeModal, openModal } from 'common-ui/actions/modal';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import { RenderField } from '../basic/RenderField';
import { RenderSelect } from '../basic/RenderSelect';
import { createIncomingRequest } from '../../actions/incomingRequest';
import IncomingRequestUrl from './IncomingRequestUrl';
import { RenderTextArea } from '../basic/RenderTextArea';
import Tooltip from '../basic/Tooltip';
import { incomingRequestVariables } from '../../config';
import { fetchCustomFields } from '../../actions/customField';
import { fetchCustomFields as fetchMonitorCustomFields } from '../../actions/monitorCustomField';
import RenderCodeEditor from '../basic/RenderCodeEditor';
import MultiSelectDropDown from '../basic/MultiSelectDropDown';

function validate(values: $TSFixMe) {
    const errors = {};

    if (!values.name || !values.name.trim()) {

        errors.name = 'Incoming request name is required';
    }

    return errors;
}

const bulletpoints = {
    display: 'listItem',
    listStyleType: 'disc',
    listStylePosition: 'inside',
};

interface CreateIncomingRequestProps {
    closeModal: Function;
    openModal: Function;
    handleSubmit: Function;
    createIncomingRequest?: Function;
    requesting?: boolean;
    requestError?: string;
    formValues?: object;
    data?: object;
    incidentPriorities?: unknown[];
    destroy: Function;
    change: Function // to manually destroy the form state;
    fetchCustomFields?: Function // to manually change redux form state;
    customFields?: unknown[];
    fetchMonitorCustomFields?: Function;
    monitorCustomFields?: unknown[];
    monitorsList?: unknown[];
}

class CreateIncomingRequest extends Component<CreateIncomingRequestProps> {
    state = {
        monitorError: null,
        filterShowing: false,
        selectedProjects: [],
        selectedComponents: [],
        selectedMonitors: [],
        selectData: [],
    };

    override componentDidMount() {
        const {

            fetchCustomFields,

            data,

            fetchMonitorCustomFields,
        } = this.props;
        const { projectId } = data;
        fetchCustomFields(projectId);
        fetchMonitorCustomFields(projectId);

        window.addEventListener('keydown', this.handleKeyBoard);

        this.formatData();
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = (values: $TSFixMe) => {
        const {

            closeModal,

            createIncomingRequest,

            data,

            openModal,

            customFields,
        } = this.props;
        const { projectId } = data;
        const postObj = {};


        postObj.name = values.name;

        postObj.selectAllMonitors = values.selectAllMonitors;


        postObj.filterMatch = values.filterMatch;

        postObj.filters =
            values.filters && values.filters.length > 0
                ? values.filters
                    .filter((filter: $TSFixMe) => !!filter)
                    .map((filter: $TSFixMe) => {
                        if (!isNaN(filter.filterText)) {
                            if (typeof filter.filterText === 'string') {
                                filter.filterText = String(filter.filterText);
                            } else {
                                filter.filterText = parseFloat(
                                    filter.filterText
                                );
                            }
                        }

                        return filter;
                    })
                : [];

        if (values.nextAction && values.nextAction === 'createIncident') {

            postObj.createIncident = true;

            postObj.incidentType = values.incidentType;

            postObj.createSeparateIncident = values.createSeparateIncident;
            if (values.dynamicIncidentType) {

                postObj.customIncidentType = values.customIncidentType;

                postObj.dynamicIncidentType = values.dynamicIncidentType;
            }

            postObj.incidentTitle = values.incidentTitle;

            postObj.incidentPriority = values.incidentPriority;
            if (values.dynamicIncidentPriority) {
                // create this incident priority on the BE

                postObj.customIncidentPriority = values.customIncidentPriority;

                postObj.dynamicIncidentPriority =
                    values.dynamicIncidentPriority;
            }

            postObj.incidentDescription = values.incidentDescription;


            postObj.customFields = customFields.map((field: $TSFixMe) => ({
                fieldName: field.fieldName,
                fieldType: field.fieldType,
                uniqueField: field.uniqueField,

                fieldValue:
                    field.fieldType === 'number'
                        ? parseFloat(values[field.fieldName])
                        : values[field.fieldName]
            }));

            if (
                values.selectMonitor &&
                values.selectMonitor === 'selectAllMonitors'
            ) {

                postObj.selectAllMonitors = true;
            } else {

                postObj.selectAllMonitors = false;
            }


            postObj.monitors = [];

            if (!postObj.selectAllMonitors) {
                if (
                    this.state.selectedMonitors &&
                    this.state.selectedMonitors.length > 0
                ) {
                    const monitors = this.state.selectedMonitors;

                    postObj.monitors = monitors;
                }


                const isDuplicate = postObj.monitors

                    ? postObj.monitors.length === new Set(postObj.monitors).size
                        ? false
                        : true
                    : false;

                if (isDuplicate) {
                    this.setState({
                        monitorError: 'Duplicate monitor selection found',
                    });

                    postObj.monitors = [];
                    return;
                }
            }
        }

        if (values.nextAction && values.nextAction === 'updateIncidentNote') {

            postObj.updateIncidentNote = true;
        }

        if (values.nextAction && values.nextAction === 'updateInternalNote') {

            postObj.updateInternalNote = true;
        }

        if (
            values.nextAction &&
            (values.nextAction === 'updateIncidentNote' ||
                values.nextAction === 'updateInternalNote')
        ) {

            postObj.noteContent = values.noteContent;

            postObj.incidentState = values.incidentState;
            if (values.incidentState === 'others') {

                postObj.incidentState = values.customIncidentState;
            }
            if (values.post_statuspage) {

                postObj.post_statuspage = values.post_statuspage;
            }
        }

        if (values.nextAction && values.nextAction === 'acknowledgeIncident') {

            postObj.acknowledgeIncident = true;
        }

        if (values.nextAction && values.nextAction === 'resolveIncident') {

            postObj.resolveIncident = true;
        }

        createIncomingRequest(projectId, postObj).then(() => {

            if (!this.props.requesting && !this.props.requestError) {
                closeModal({
                    id: projectId, // the projectId was used as the id for this modal
                });

                this.props.destroy();
                openModal({
                    id: projectId,
                    content: IncomingRequestUrl,
                });
            }
        });
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

    renderFilters = ({
        fields
    }: $TSFixMe) => {
        const { filterShowing } = this.state;

        const { formValues, monitorCustomFields, customFields } = this.props;

        if (
            !filterShowing &&
            formValues &&
            (!formValues.filters || formValues.filters.length === 0)
        ) {
            // show at least one filter initially
            fields.push();
            this.setState({ filterShowing: true });
        }

        return <>
            <div
                style={{
                    width: '100%',
                    position: 'relative',
                }}
            >
                <span
                    id="addFilter"
                    onClick={() => {
                        fields.push();
                    }}
                ></span>
                {fields.map((field: $TSFixMe, index: $TSFixMe) => {
                    return (
                        <div
                            style={{
                                width: '100%',
                                marginBottom: 10,
                            }}
                            key={index}
                        >
                            <div
                                className="bs-Fieldset-field"
                                style={{
                                    width: '100%',
                                }}
                            >
                                {formValues &&
                                    formValues.nextAction ===
                                    'createIncident' ? (
                                    <Field
                                        className="db-select-nw Table-cell--width--maximized"
                                        component={RenderSelect}
                                        name={`${field}.filterCriteria`}
                                        id={`${field}.filterCriteria`}
                                        placeholder="Criteria"
                                        style={{
                                            height: '28px',
                                            width: '100%',
                                        }}
                                        options={[
                                            ...monitorCustomFields.map(
                                                (field: $TSFixMe) => ({
                                                    value: field.fieldName,
                                                    label: field.fieldName
                                                })
                                            ),
                                        ]}
                                    />
                                ) : (
                                    <Field
                                        className="db-select-nw Table-cell--width--maximized"
                                        component={RenderSelect}
                                        name={`${field}.filterCriteria`}
                                        id={`${field}.filterCriteria`}
                                        placeholder="Criteria"
                                        style={{
                                            height: '28px',
                                            width: '100%',
                                        }}
                                        options={[
                                            {
                                                value: 'incidentId',
                                                label: 'Incident ID',
                                            },
                                            ...customFields.map((field: $TSFixMe) => ({
                                                value: field.fieldName,
                                                label: field.fieldName
                                            })),
                                        ]}
                                    />
                                )}

                                {formValues &&
                                    formValues.nextAction ===
                                    'createIncident' ? (
                                    (formValues.filters[index]
                                        ? (
                                            monitorCustomFields.find(
                                                (field: $TSFixMe) => field.fieldName ===
                                                    formValues.filters[
                                                        index
                                                    ].filterCriteria
                                            ) || {
                                                fieldType: 'text',
                                            }
                                        ).fieldType
                                        : 'text') === 'text' ? (
                                        <Field
                                            className="db-select-nw Table-cell--width--maximized"
                                            component={RenderSelect}
                                            name={`${field}.filterCondition`}
                                            id={`${field}.filterCondition`}
                                            placeholder="Condition"
                                            style={{
                                                height: '28px',
                                                width: '100%',
                                                marginLeft: 5,
                                            }}
                                            options={[
                                                {
                                                    value: 'equalTo',
                                                    label: 'Equal To',
                                                },
                                                {
                                                    value: 'notEqualTo',
                                                    label: 'Not Equal To',
                                                },
                                            ]}
                                        />
                                    ) : (
                                        <Field
                                            className="db-select-nw Table-cell--width--maximized"
                                            component={RenderSelect}
                                            name={`${field}.filterCondition`}
                                            id={`${field}.filterCondition`}
                                            placeholder="Condition"
                                            style={{
                                                height: '28px',
                                                width: '100%',
                                                marginLeft: 5,
                                            }}
                                            options={[
                                                {
                                                    value: 'equalTo',
                                                    label: 'Equal To',
                                                },
                                                {
                                                    value: 'notEqualTo',
                                                    label: 'Not Equal To',
                                                },
                                                {
                                                    value: 'greaterThan',
                                                    label: 'Greater Than',
                                                },
                                                {
                                                    value: 'lessThan',
                                                    label: 'Less Than',
                                                },
                                                {
                                                    value:
                                                        'lessThanOrEqualTo',
                                                    label:
                                                        'Less Than Or Equal To',
                                                },
                                                {
                                                    value:
                                                        'greaterThanOrEqualTo',
                                                    label:
                                                        'Greater Than Or Equal To',
                                                },
                                            ]}
                                        />
                                    )
                                ) : (formValues && formValues.filters[index]
                                    ? formValues.filters[index]
                                        .filterCriteria === 'incidentId'
                                        ? 'number'
                                        : (
                                            customFields.find(
                                                (field: $TSFixMe) => field.fieldName ===
                                                    formValues.filters[
                                                        index
                                                    ].filterCriteria
                                            ) || {
                                                fieldType: 'text',
                                            }
                                        ).fieldType
                                    : 'text') === 'text' ? (
                                    <Field
                                        className="db-select-nw Table-cell--width--maximized"
                                        component={RenderSelect}
                                        name={`${field}.filterCondition`}
                                        id={`${field}.filterCondition`}
                                        placeholder="Condition"
                                        style={{
                                            height: '28px',
                                            width: '100%',
                                            marginLeft: 5,
                                        }}
                                        options={[
                                            {
                                                value: 'equalTo',
                                                label: 'Equal To',
                                            },
                                            {
                                                value: 'notEqualTo',
                                                label: 'Not Equal To',
                                            },
                                        ]}
                                    />
                                ) : (
                                    <Field
                                        className="db-select-nw Table-cell--width--maximized"
                                        component={RenderSelect}
                                        name={`${field}.filterCondition`}
                                        id={`${field}.filterCondition`}
                                        placeholder="Condition"
                                        style={{
                                            height: '28px',
                                            width: '100%',
                                            marginLeft: 5,
                                        }}
                                        options={[
                                            {
                                                value: 'equalTo',
                                                label: 'Equal To',
                                            },
                                            {
                                                value: 'notEqualTo',
                                                label: 'Not Equal To',
                                            },
                                            {
                                                value: 'greaterThan',
                                                label: 'Greater Than',
                                            },
                                            {
                                                value: 'lessThan',
                                                label: 'Less Than',
                                            },
                                            {
                                                value: 'lessThanOrEqualTo',
                                                label:
                                                    'Less Than Or Equal To',
                                            },
                                            {
                                                value:
                                                    'greaterThanOrEqualTo',
                                                label:
                                                    'Greater Than Or Equal To',
                                            },
                                        ]}
                                    />
                                )}

                                {formValues &&
                                    formValues.nextAction ===
                                    'createIncident' ? (
                                    <Field
                                        component={RenderField}
                                        name={`${field}.filterText`}
                                        type={
                                            formValues &&
                                                formValues.filters[index]
                                                ? (
                                                    monitorCustomFields.find(
                                                        (field: $TSFixMe) => field.fieldName ===
                                                            formValues
                                                                .filters[
                                                                index
                                                            ]
                                                                .filterCriteria
                                                    ) || {
                                                        fieldType: 'text',
                                                    }
                                                ).fieldType
                                                : 'text'
                                        }
                                        placeholder="{{request.body.value}}"
                                        id={`${field}.filterText`}
                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                        style={{
                                            width: '100%',
                                            padding: '3px 5px',
                                            marginLeft: 5,
                                        }}
                                        parentStyle={{
                                            marginRight: 5,
                                        }}
                                    />
                                ) : (
                                    <Field
                                        component={RenderField}
                                        name={`${field}.filterText`}
                                        type={
                                            formValues &&
                                                formValues.filters[index]
                                                ? formValues.filters[index]
                                                    .filterCriteria ===
                                                    'incidentId'
                                                    ? 'number'
                                                    : (
                                                        customFields.find(
                                                            (field: $TSFixMe) => field.fieldName ===
                                                                formValues
                                                                    .filters[
                                                                    index
                                                                ]
                                                                    .filterCriteria
                                                        ) || {
                                                            fieldType:
                                                                'text',
                                                        }
                                                    ).fieldType
                                                : 'text'
                                        }
                                        placeholder="{{request.body.value}}"
                                        id={`${field}.filterText`}
                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                        style={{
                                            width: '100%',
                                            padding: '3px 5px',
                                            marginLeft: 5,
                                        }}
                                        parentStyle={{
                                            marginRight: 5,
                                        }}
                                    />
                                )}


                                <Tooltip title="Incoming http Request Filter">
                                    <p>
                                        Filter exposes the{' '}
                                        <code>request</code> object of an
                                        incoming request. The value on the{' '}
                                        <code>request</code> object can
                                        either be a string or a number
                                    </p>
                                    <p>
                                        Example properties include the
                                        following:
                                    </p>
                                    <p>
                                        <ul>
                                            <li>
                                                <code>request.body</code>
                                            </li>
                                            <li>
                                                <code>request.query</code>
                                            </li>
                                            <li>
                                                <code>request.headers</code>
                                            </li>
                                        </ul>
                                    </p>
                                    <p>Usage examples include:</p>
                                    <p>
                                        <ul>
                                            <li>
                                                <code>
                                                    1 | request.body.value
                                                </code>
                                            </li>
                                            <li>
                                                <code>
                                                    2 | request.query.value
                                                </code>
                                            </li>
                                            <li>
                                                <code>
                                                    3 |
                                                    request.headers.value
                                                </code>
                                            </li>
                                        </ul>
                                    </p>
                                    <p>
                                        You can pass the value of{' '}
                                        <code>request</code> object directly
                                        or you can specify the{' '}
                                        <code>request</code> body as a
                                        variable{' '}
                                        <code>
                                            {'{{request.body.value}}'}
                                        </code>
                                    </p>
                                </Tooltip>
                                <button
                                    className="bs-Button bs-DeprecatedButton"
                                    type="button"
                                    onClick={() => fields.remove(index)}
                                    style={{
                                        borderRadius: '50%',
                                        padding: 0,
                                        display: 'flex',
                                        justifyContent: 'center',
                                        alignItems: 'center',
                                        width: 25,
                                        height: 25,
                                    }}
                                >
                                    <img
                                        src="/dashboard/assets/img/minus.svg"
                                        style={{
                                            height: '13px',
                                            width: '13px',
                                        }}
                                        alt=""
                                    />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </>;
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                return this.handleCloseModal();
            case 'Enter':
                if (e.target.localName !== 'textarea') {

                    return document
                        .getElementById('createIncomingRequest')
                        .click();
                }
                break;
            default:
                return false;
        }
    };

    handleCloseModal = () => {

        const { closeModal, data, destroy } = this.props;
        const { projectId } = data;
        destroy();
        closeModal({
            id: projectId,
        });
    };

    toggleShowAdvancedOptions = () =>

        this.props.change(
            'showAdvancedOptions',

            !this.props.formValues.showAdvancedOptions
        );

    toggleShowAvailableVariables = () =>

        this.props.change(
            'showAvailableVariables',

            !this.props.formValues.showAvailableVariables
        );

    onContentChange = (val: $TSFixMe) => {

        this.props.change('noteContent', val);
    };

    override render() {
        const {

            handleSubmit,

            data,

            formValues,

            closeModal,

            incidentPriorities,

            customFields,
        } = this.props;
        const { projectId } = data;

        const {
            selectedProjects,
            selectedComponents,
            selectedMonitors,
            selectData,
        } = this.state;

        return (
            <div
                className="ModalLayer-contents"

                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM">
                    <div className="bs-Modal" style={{ width: 700 }}>
                        <ClickOutside onClickOutside={this.handleCloseModal}>
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
                                            Create Incoming HTTP Request
                                        </span>
                                    </span>
                                </div>
                            </div>
                            <form onSubmit={handleSubmit(this.submitForm)}>
                                <div className="bs-Modal-content">
                                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                        <fieldset className="Margin-bottom--16">
                                            <div className="bs-Fieldset-rows">
                                                <div
                                                    className="bs-Fieldset-row"
                                                    style={{ padding: 0 }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label Text-align--left"
                                                        htmlFor="name"
                                                        style={{
                                                            flexBasis: '20%',
                                                        }}
                                                    >
                                                        <span>Name</span>
                                                    </label>
                                                    <div
                                                        className="bs-Fieldset-fields"
                                                        style={{
                                                            flexBasis: '80%',
                                                            maxWidth: '80%',
                                                        }}
                                                    >
                                                        <div
                                                            className="bs-Fieldset-field"
                                                            style={{
                                                                width: '100%',
                                                            }}
                                                        >
                                                            <Field
                                                                component={
                                                                    RenderField
                                                                }
                                                                name="name"
                                                                type="input"
                                                                placeholder="Name of request"
                                                                id="name"
                                                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                style={{
                                                                    width:
                                                                        '100%',
                                                                    padding:
                                                                        '3px 5px',
                                                                }}
                                                                autoFocus={true}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>

                                        <fieldset style={{ paddingTop: 0 }}>
                                            <div className="bs-Fieldset-rows">
                                                <div
                                                    className="bs-Fieldset-row"
                                                    style={{ padding: 0 }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label Text-align--left"
                                                        style={{
                                                            flexBasis: '20%',
                                                        }}
                                                    ></label>
                                                    <div
                                                        className="bs-Fieldset-fields"
                                                        style={{
                                                            flexBasis: '80%',
                                                            maxWidth: '80%',
                                                        }}
                                                    >
                                                        <div
                                                            className="bs-Fieldset-field"
                                                            style={{
                                                                width: '100%',
                                                                fontWeight: 500,
                                                            }}
                                                        >
                                                            What would you like
                                                            to do
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>

                                        <fieldset>
                                            <div className="bs-Fieldset-rows">
                                                <div
                                                    className="bs-Fieldset-row"
                                                    style={{ padding: 0 }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label Text-align--left"
                                                        htmlFor="createIncident"
                                                        style={{
                                                            flexBasis: '20%',
                                                        }}
                                                    >
                                                        <span></span>
                                                    </label>
                                                    <div
                                                        className="bs-Fieldset-fields"
                                                        style={{
                                                            paddingTop: '6px',
                                                            flexBasis: '80%',
                                                            maxWidth: '80%',
                                                        }}
                                                    >
                                                        <div className="bs-Fieldset-field">
                                                            <label
                                                                className="bs-Radio"
                                                                style={{
                                                                    marginRight:
                                                                        '12px',
                                                                }}
                                                                htmlFor="createIncident"
                                                            >
                                                                <Field
                                                                    component="input"
                                                                    type="radio"
                                                                    name="nextAction"
                                                                    className="bs-Radio-source"
                                                                    id="createIncident"
                                                                    value="createIncident"
                                                                    style={{
                                                                        width: 0,
                                                                    }}
                                                                />
                                                                <span className="bs-Radio-button"></span>
                                                                <div
                                                                    className="Box-root"
                                                                    style={{
                                                                        paddingLeft:
                                                                            '5px',
                                                                    }}
                                                                >
                                                                    <span>
                                                                        Create
                                                                        Incident
                                                                    </span>
                                                                </div>
                                                            </label>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>

                                        <fieldset>
                                            <div className="bs-Fieldset-rows">
                                                <div
                                                    className="bs-Fieldset-row"
                                                    style={{ padding: 0 }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label Text-align--left"
                                                        htmlFor="acknowledgeIncident"
                                                        style={{
                                                            flexBasis: '20%',
                                                        }}
                                                    >
                                                        <span></span>
                                                    </label>
                                                    <div
                                                        className="bs-Fieldset-fields"
                                                        style={{
                                                            paddingTop: '6px',
                                                            flexBasis: '80%',
                                                            maxWidth: '80%',
                                                        }}
                                                    >
                                                        <div className="bs-Fieldset-field">
                                                            <label
                                                                className="bs-Radio"
                                                                style={{
                                                                    marginRight:
                                                                        '12px',
                                                                }}
                                                                htmlFor="acknowledgeIncident"
                                                            >
                                                                <Field
                                                                    component="input"
                                                                    type="radio"
                                                                    name="nextAction"
                                                                    className="bs-Radio-source"
                                                                    id="acknowledgeIncident"
                                                                    value="acknowledgeIncident"
                                                                    style={{
                                                                        width: 0,
                                                                    }}
                                                                />
                                                                <span className="bs-Radio-button"></span>
                                                                <div
                                                                    className="Box-root"
                                                                    style={{
                                                                        paddingLeft:
                                                                            '5px',
                                                                    }}
                                                                >
                                                                    <span>
                                                                        Acknowledge
                                                                        Incident
                                                                    </span>
                                                                </div>
                                                            </label>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>

                                        <fieldset>
                                            <div className="bs-Fieldset-rows">
                                                <div
                                                    className="bs-Fieldset-row"
                                                    style={{ padding: 0 }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label Text-align--left"
                                                        htmlFor="resolveIncident"
                                                        style={{
                                                            flexBasis: '20%',
                                                        }}
                                                    >
                                                        <span></span>
                                                    </label>
                                                    <div
                                                        className="bs-Fieldset-fields"
                                                        style={{
                                                            paddingTop: '6px',
                                                            flexBasis: '80%',
                                                            maxWidth: '80%',
                                                        }}
                                                    >
                                                        <div className="bs-Fieldset-field">
                                                            <label
                                                                className="bs-Radio"
                                                                style={{
                                                                    marginRight:
                                                                        '12px',
                                                                }}
                                                                htmlFor="resolveIncident"
                                                            >
                                                                <Field
                                                                    component="input"
                                                                    type="radio"
                                                                    name="nextAction"
                                                                    className="bs-Radio-source"
                                                                    id="resolveIncident"
                                                                    value="resolveIncident"
                                                                    style={{
                                                                        width: 0,
                                                                    }}
                                                                />
                                                                <span className="bs-Radio-button"></span>
                                                                <div
                                                                    className="Box-root"
                                                                    style={{
                                                                        paddingLeft:
                                                                            '5px',
                                                                    }}
                                                                >
                                                                    <span>
                                                                        Resolve
                                                                        Incident
                                                                    </span>
                                                                </div>
                                                            </label>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>

                                        <fieldset className="Margin-bottom--16">
                                            <div className="bs-Fieldset-rows">
                                                <div
                                                    className="bs-Fieldset-row"
                                                    style={{ padding: 0 }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label Text-align--left"
                                                        htmlFor="updateInternalNote"
                                                        style={{
                                                            flexBasis: '20%',
                                                        }}
                                                    >
                                                        <span></span>
                                                    </label>
                                                    <div
                                                        className="bs-Fieldset-fields"
                                                        style={{
                                                            paddingTop: '6px',
                                                            flexBasis: '80%',
                                                            maxWidth: '80%',
                                                        }}
                                                    >
                                                        <div className="bs-Fieldset-field">
                                                            <label
                                                                className="bs-Radio"
                                                                style={{
                                                                    marginRight:
                                                                        '12px',
                                                                }}
                                                                htmlFor="updateInternalNote"
                                                            >
                                                                <Field
                                                                    component="input"
                                                                    type="radio"
                                                                    name="nextAction"
                                                                    className="bs-Radio-source"
                                                                    id="updateInternalNote"
                                                                    value="updateInternalNote"
                                                                    style={{
                                                                        width: 0,
                                                                    }}
                                                                />
                                                                <span className="bs-Radio-button"></span>
                                                                <div
                                                                    className="Box-root"
                                                                    style={{
                                                                        paddingLeft:
                                                                            '5px',
                                                                    }}
                                                                >
                                                                    <span>
                                                                        Update
                                                                        Internal
                                                                        Note
                                                                    </span>
                                                                </div>
                                                            </label>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>

                                        {formValues &&
                                            formValues.nextAction ===
                                            'createIncident' && (
                                                <fieldset className="Margin-bottom--4">
                                                    <div className="bs-Fieldset-rows">
                                                        <div
                                                            className="bs-Fieldset-row"
                                                            style={{
                                                                padding: 0,
                                                            }}
                                                        >
                                                            <label
                                                                className="bs-Fieldset-label Text-align--left"
                                                                style={{
                                                                    flexBasis:
                                                                        '20%',
                                                                }}
                                                            >
                                                                <span>
                                                                    Monitors
                                                                </span>
                                                            </label>
                                                            <div
                                                                className="bs-Fieldset-fields"
                                                                style={{
                                                                    flexBasis:
                                                                        '80%',
                                                                    maxWidth:
                                                                        '80%',
                                                                }}
                                                            >
                                                                <fieldset
                                                                    style={{
                                                                        padding: 0,
                                                                        marginBottom: 10,
                                                                    }}
                                                                >
                                                                    <div className="bs-Fieldset-rows">
                                                                        <div
                                                                            className="bs-Fieldset-row"
                                                                            style={{
                                                                                padding: 0,
                                                                                display:
                                                                                    'block',
                                                                            }}
                                                                        >
                                                                            <div
                                                                                className="bs-Fieldset-field"
                                                                                style={{
                                                                                    padding: 0,
                                                                                }}
                                                                            >
                                                                                <label
                                                                                    className="bs-Radio"
                                                                                    style={{
                                                                                        marginRight:
                                                                                            '12px',
                                                                                    }}
                                                                                    htmlFor="selectAllMonitors"
                                                                                >
                                                                                    <Field
                                                                                        component="input"
                                                                                        type="radio"
                                                                                        name="selectMonitor"
                                                                                        className="bs-Radio-source"
                                                                                        id="selectAllMonitors"
                                                                                        value="selectAllMonitors"
                                                                                        style={{
                                                                                            width: 0,
                                                                                        }}
                                                                                    />
                                                                                    <span className="bs-Radio-button"></span>
                                                                                    <div
                                                                                        className="Box-root"
                                                                                        style={{
                                                                                            paddingLeft:
                                                                                                '10px',
                                                                                        }}
                                                                                    >
                                                                                        <span>
                                                                                            Select
                                                                                            All
                                                                                            Monitors
                                                                                        </span>
                                                                                    </div>
                                                                                </label>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </fieldset>
                                                                <fieldset
                                                                    style={{
                                                                        padding: 0,
                                                                        marginBottom: 10,
                                                                    }}
                                                                >
                                                                    <div className="bs-Fieldset-rows">
                                                                        <div
                                                                            className="bs-Fieldset-row"
                                                                            style={{
                                                                                padding: 0,
                                                                                display:
                                                                                    'block',
                                                                            }}
                                                                        >
                                                                            <div
                                                                                className="bs-Fieldset-field"
                                                                                style={{
                                                                                    padding: 0,
                                                                                }}
                                                                            >
                                                                                <label
                                                                                    className="bs-Radio"
                                                                                    style={{
                                                                                        marginRight:
                                                                                            '12px',
                                                                                    }}
                                                                                    htmlFor="selectSpecificMonitors"
                                                                                >
                                                                                    <Field
                                                                                        component="input"
                                                                                        type="radio"
                                                                                        name="selectMonitor"
                                                                                        className="bs-Radio-source"
                                                                                        id="selectSpecificMonitors"
                                                                                        value="selectSpecificMonitors"
                                                                                        style={{
                                                                                            width: 0,
                                                                                        }}
                                                                                    />
                                                                                    <span className="bs-Radio-button"></span>
                                                                                    <div
                                                                                        className="Box-root"
                                                                                        style={{
                                                                                            paddingLeft:
                                                                                                '10px',
                                                                                        }}
                                                                                    >
                                                                                        <span>
                                                                                            Select
                                                                                            Specific
                                                                                            Monitors
                                                                                        </span>
                                                                                    </div>
                                                                                </label>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </fieldset>
                                                                {formValues &&
                                                                    formValues.selectMonitor ===
                                                                    'selectSpecificMonitors' && (
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
                                                        </div>
                                                    </div>
                                                </fieldset>
                                            )}

                                        {formValues &&
                                            formValues.nextAction ===
                                            'createIncident' && (
                                                <fieldset>
                                                    <div className="bs-Fieldset-rows">
                                                        <div
                                                            className="bs-Fieldset-row"
                                                            style={{
                                                                padding: 0,
                                                            }}
                                                        >
                                                            <label
                                                                className="bs-Fieldset-label Text-align--left"
                                                                htmlFor="createSeparateIncident"
                                                                style={{
                                                                    flexBasis:
                                                                        '20%',
                                                                }}
                                                            >
                                                                <span></span>
                                                            </label>
                                                            <div
                                                                className="bs-Fieldset-fields"
                                                                style={{
                                                                    paddingTop:
                                                                        '0px',
                                                                    flexBasis:
                                                                        '80%',
                                                                    maxWidth:
                                                                        '80%',
                                                                }}
                                                            >
                                                                <div className="bs-Fieldset-field">
                                                                    <label
                                                                        className="Checkbox"
                                                                        style={{
                                                                            marginRight:
                                                                                '12px',
                                                                        }}
                                                                        htmlFor="createSeparateIncident"
                                                                    >
                                                                        <Field
                                                                            component="input"
                                                                            type="checkbox"
                                                                            name="createSeparateIncident"
                                                                            className="Checkbox-source"
                                                                            id="createSeparateIncident"
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
                                                                                Create
                                                                                separate
                                                                                incidents
                                                                            </span>
                                                                        </div>
                                                                    </label>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </fieldset>
                                            )}

                                        {formValues && formValues.nextAction && (
                                            <fieldset style={{ paddingTop: 0 }}>
                                                <div className="bs-Fieldset-rows">
                                                    <div
                                                        className="bs-Fieldset-row"
                                                        style={{ padding: 0 }}
                                                    >
                                                        <label
                                                            className="bs-Fieldset-label Text-align--left"
                                                            htmlFor="showAdvancedOptions"
                                                            style={{
                                                                flexBasis:
                                                                    '20%',
                                                            }}
                                                        ></label>
                                                        <div
                                                            className="bs-Fieldset-fields"
                                                            style={{
                                                                flexBasis:
                                                                    '80%',
                                                                maxWidth: '80%',
                                                            }}
                                                        >
                                                            <div
                                                                className="bs-Fieldset-field"
                                                                style={{
                                                                    width:
                                                                        '100%',
                                                                    padding:
                                                                        '10px 0px',
                                                                    textDecoration:
                                                                        'underline',
                                                                }}
                                                            >
                                                                <div
                                                                    style={{
                                                                        cursor:
                                                                            'pointer',
                                                                    }}
                                                                    onClick={
                                                                        this
                                                                            .toggleShowAdvancedOptions
                                                                    }
                                                                    id="advancedOptionsBtn"
                                                                >
                                                                    {formValues.showAdvancedOptions
                                                                        ? 'Hide Advanced Options'
                                                                        : 'Show Advanced Options'}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </fieldset>
                                        )}

                                        {formValues &&
                                            formValues.showAdvancedOptions &&
                                            (formValues.nextAction ===
                                                'acknowledgeIncident' ||
                                                formValues.nextAction ===
                                                'resolveIncident') && (
                                                <fieldset className="Margin-bottom--16">
                                                    <div className="bs-Fieldset-rows">
                                                        <div
                                                            className="bs-Fieldset-row"
                                                            style={{
                                                                padding: 0,
                                                            }}
                                                        >
                                                            <label
                                                                className="bs-Fieldset-label Text-align--left"
                                                                style={{
                                                                    flexBasis:
                                                                        '20%',
                                                                }}
                                                            >
                                                                <span>
                                                                    Filters
                                                                </span>
                                                            </label>
                                                            <div
                                                                className="bs-Fieldset-fields"
                                                                style={{
                                                                    flexBasis:
                                                                        '80%',
                                                                    maxWidth:
                                                                        '80%',
                                                                }}
                                                            >
                                                                <div
                                                                    style={{
                                                                        width:
                                                                            '100%',
                                                                        marginBottom: 20,
                                                                    }}
                                                                >
                                                                    <div>
                                                                        Match
                                                                    </div>
                                                                    <div className="Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                                                                        <div className="Flex-flex Flex-alignItems--center Flex-justifyContent--center">
                                                                            <Field
                                                                                className="db-select-nw Table-cell--width--maximized"
                                                                                component={
                                                                                    RenderSelect
                                                                                }
                                                                                name="filterMatch"
                                                                                id="filterMatch"
                                                                                style={{
                                                                                    height:
                                                                                        '28px',
                                                                                    maxWidth: 150,
                                                                                }}
                                                                                options={[
                                                                                    {
                                                                                        value:
                                                                                            'all',
                                                                                        label:
                                                                                            'All',
                                                                                    },
                                                                                    {
                                                                                        value:
                                                                                            'any',
                                                                                        label:
                                                                                            'Any',
                                                                                    },
                                                                                ]}
                                                                            />
                                                                            <span
                                                                                style={{
                                                                                    marginLeft: 10,
                                                                                }}
                                                                            >
                                                                                of
                                                                                the
                                                                                following
                                                                                rules:
                                                                            </span>
                                                                        </div>
                                                                        <button
                                                                            type="button"
                                                                            onClick={e => {
                                                                                e.preventDefault();

                                                                                document
                                                                                    .querySelector(
                                                                                        '#addFilter'
                                                                                    )

                                                                                    .click();
                                                                            }}
                                                                            className="Button bs-ButtonLegacy ActionIconParent"
                                                                        >
                                                                            <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                                                                                <span>
                                                                                    Add
                                                                                    filter
                                                                                </span>
                                                                            </span>
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                                <div
                                                                    className="bs-Fieldset-fields"
                                                                    style={{
                                                                        flexBasis:
                                                                            '100%',
                                                                        maxWidth:
                                                                            '100%',
                                                                        width:
                                                                            '100%',
                                                                        padding: 0,
                                                                    }}
                                                                >
                                                                    <div
                                                                        className="bs-Fieldset-field"
                                                                        style={{
                                                                            width:
                                                                                '100%',
                                                                        }}
                                                                    >
                                                                        <FieldArray
                                                                            name="filters"
                                                                            component={
                                                                                this
                                                                                    .renderFilters
                                                                            }
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </fieldset>
                                            )}

                                        {formValues &&
                                            formValues.showAdvancedOptions &&
                                            (formValues.nextAction ===
                                                'updateInternalNote' ||
                                                formValues.nextAction ===
                                                'updateIncidentNote') && (
                                                <>
                                                    <fieldset className="Margin-bottom--16">
                                                        <div className="bs-Fieldset-rows">
                                                            <div
                                                                className="bs-Fieldset-row"
                                                                style={{
                                                                    padding: 0,
                                                                }}
                                                            >
                                                                <label
                                                                    className="bs-Fieldset-label Text-align--left"
                                                                    style={{
                                                                        flexBasis:
                                                                            '20%',
                                                                    }}
                                                                >
                                                                    <span>
                                                                        Filters
                                                                    </span>
                                                                </label>
                                                                <div
                                                                    className="bs-Fieldset-fields"
                                                                    style={{
                                                                        flexBasis:
                                                                            '80%',
                                                                        maxWidth:
                                                                            '80%',
                                                                    }}
                                                                >
                                                                    <div
                                                                        style={{
                                                                            width:
                                                                                '100%',
                                                                            marginBottom: 20,
                                                                        }}
                                                                    >
                                                                        <div>
                                                                            Match
                                                                        </div>
                                                                        <div className="Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                                                                            <div className="Flex-flex Flex-alignItems--center Flex-justifyContent--center">
                                                                                <Field
                                                                                    className="db-select-nw Table-cell--width--maximized"
                                                                                    component={
                                                                                        RenderSelect
                                                                                    }
                                                                                    name="filterMatch"
                                                                                    id="filterMatch"
                                                                                    style={{
                                                                                        height:
                                                                                            '28px',
                                                                                        maxWidth: 150,
                                                                                    }}
                                                                                    options={[
                                                                                        {
                                                                                            value:
                                                                                                'all',
                                                                                            label:
                                                                                                'All',
                                                                                        },
                                                                                        {
                                                                                            value:
                                                                                                'any',
                                                                                            label:
                                                                                                'Any',
                                                                                        },
                                                                                    ]}
                                                                                />
                                                                                <span
                                                                                    style={{
                                                                                        marginLeft: 10,
                                                                                    }}
                                                                                >
                                                                                    of
                                                                                    the
                                                                                    following
                                                                                    rules:
                                                                                </span>
                                                                            </div>
                                                                            <button
                                                                                type="button"
                                                                                onClick={e => {
                                                                                    e.preventDefault();

                                                                                    document
                                                                                        .querySelector(
                                                                                            '#addFilter'
                                                                                        )

                                                                                        .click();
                                                                                }}
                                                                                className="Button bs-ButtonLegacy ActionIconParent"
                                                                            >
                                                                                <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                                                                                    <span>
                                                                                        Add
                                                                                        filter
                                                                                    </span>
                                                                                </span>
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                    <div
                                                                        className="bs-Fieldset-fields"
                                                                        style={{
                                                                            flexBasis:
                                                                                '100%',
                                                                            maxWidth:
                                                                                '100%',
                                                                            width:
                                                                                '100%',
                                                                            padding: 0,
                                                                        }}
                                                                    >
                                                                        <div
                                                                            className="bs-Fieldset-field"
                                                                            style={{
                                                                                width:
                                                                                    '100%',
                                                                            }}
                                                                        >
                                                                            <FieldArray
                                                                                name="filters"
                                                                                component={
                                                                                    this
                                                                                        .renderFilters
                                                                                }
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </fieldset>

                                                    <fieldset className="Margin-bottom--16">
                                                        <div className="bs-Fieldset-rows">
                                                            <div
                                                                className="bs-Fieldset-row"
                                                                style={{
                                                                    padding: 0,
                                                                }}
                                                            >
                                                                <label
                                                                    className="bs-Fieldset-label Text-align--left"
                                                                    htmlFor="incidentState"
                                                                    style={{
                                                                        flexBasis:
                                                                            '20%',
                                                                    }}
                                                                >
                                                                    <span>
                                                                        Incident
                                                                        State
                                                                    </span>
                                                                </label>
                                                                <div
                                                                    className="bs-Fieldset-fields"
                                                                    style={{
                                                                        flexBasis:
                                                                            '80%',
                                                                        maxWidth:
                                                                            '80%',
                                                                    }}
                                                                >
                                                                    <div
                                                                        className="bs-Fieldset-field"
                                                                        style={{
                                                                            width:
                                                                                '100%',
                                                                        }}
                                                                    >
                                                                        <Field
                                                                            className="db-select-nw-300"
                                                                            component={
                                                                                RenderSelect
                                                                            }
                                                                            name="incidentState"
                                                                            id="incidentState"
                                                                            placeholder="Incident State"
                                                                            disabled={
                                                                                false
                                                                            }
                                                                            style={{
                                                                                width:
                                                                                    '100%',
                                                                            }}
                                                                            options={[
                                                                                {
                                                                                    value:
                                                                                        'investigating',
                                                                                    label:
                                                                                        'Investigating',
                                                                                },
                                                                                {
                                                                                    value:
                                                                                        'update',
                                                                                    label:
                                                                                        'Update',
                                                                                },
                                                                                {
                                                                                    value:
                                                                                        'others',
                                                                                    label:
                                                                                        'Others',
                                                                                },
                                                                            ]}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </fieldset>

                                                    {formValues &&
                                                        formValues.incidentState ===
                                                        'others' && (
                                                            <fieldset className="Margin-bottom--16">
                                                                <div className="bs-Fieldset-rows">
                                                                    <div
                                                                        className="bs-Fieldset-row"
                                                                        style={{
                                                                            padding: 0,
                                                                        }}
                                                                    >
                                                                        <label
                                                                            className="bs-Fieldset-label Text-align--left"
                                                                            htmlFor="customIncidentState"
                                                                            style={{
                                                                                flexBasis:
                                                                                    '20%',
                                                                            }}
                                                                        >
                                                                            <span>
                                                                                Custom
                                                                                Incident
                                                                                State
                                                                            </span>
                                                                        </label>
                                                                        <div
                                                                            className="bs-Fieldset-fields"
                                                                            style={{
                                                                                flexBasis:
                                                                                    '80%',
                                                                                maxWidth:
                                                                                    '80%',
                                                                            }}
                                                                        >
                                                                            <div
                                                                                className="bs-Fieldset-field"
                                                                                style={{
                                                                                    width:
                                                                                        '100%',
                                                                                }}
                                                                            >
                                                                                <Field
                                                                                    className="db-BusinessSettings-input-300 TextInput bs-TextInput"
                                                                                    component={
                                                                                        RenderField
                                                                                    }
                                                                                    type="text"
                                                                                    name={`customIncidentState`}
                                                                                    id="customIncidentState"
                                                                                    placeholder="Enter a custom incident state"
                                                                                    style={{
                                                                                        width:
                                                                                            '100%',
                                                                                    }}
                                                                                    required={
                                                                                        true
                                                                                    }
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </fieldset>
                                                        )}

                                                    <fieldset className="Margin-bottom--16">
                                                        <div className="bs-Fieldset-rows">
                                                            <div
                                                                className="bs-Fieldset-row"
                                                                style={{
                                                                    padding: 0,
                                                                }}
                                                            >
                                                                <label
                                                                    className="bs-Fieldset-label Text-align--left"
                                                                    htmlFor="noteContent"
                                                                    style={{
                                                                        flexBasis:
                                                                            '20%',
                                                                    }}
                                                                >
                                                                    <span>
                                                                        Investigation
                                                                        Note
                                                                    </span>
                                                                </label>
                                                                <div
                                                                    className="bs-Fieldset-fields"
                                                                    style={{
                                                                        flexBasis:
                                                                            '80%',
                                                                        maxWidth:
                                                                            '80%',
                                                                    }}
                                                                >
                                                                    <div
                                                                        className="bs-Fieldset-field"
                                                                        style={{
                                                                            width:
                                                                                '100%',
                                                                        }}
                                                                    >
                                                                        <Field
                                                                            name="noteContent"
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
                                                        </div>
                                                    </fieldset>
                                                    <fieldset>
                                                        <div className="bs-Fieldset-rows">
                                                            <div
                                                                className="bs-Fieldset-row"
                                                                style={{
                                                                    padding:
                                                                        '0px',
                                                                }}
                                                            >
                                                                <label
                                                                    className="bs-Fieldset-label Text-align--left"
                                                                    style={{
                                                                        flexBasis:
                                                                            '20%',
                                                                    }}
                                                                >
                                                                    <span></span>
                                                                </label>
                                                                <label
                                                                    className="bs-Fieldset-label bs-Fieldset-row Checkbox"
                                                                    style={{
                                                                        padding:
                                                                            '0px',
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
                                                                                this
                                                                                on
                                                                                Status
                                                                                Page
                                                                            </span>
                                                                        </span>
                                                                    </div>
                                                                </label>
                                                            </div>
                                                        </div>
                                                    </fieldset>
                                                    <fieldset
                                                        style={{
                                                            paddingTop: 0,
                                                        }}
                                                    >
                                                        <div className="bs-Fieldset-rows">
                                                            <div
                                                                className="bs-Fieldset-row"
                                                                style={{
                                                                    padding: 0,
                                                                }}
                                                            >
                                                                <label
                                                                    className="bs-Fieldset-label Text-align--left"
                                                                    htmlFor="name"
                                                                    style={{
                                                                        flexBasis:
                                                                            '20%',
                                                                    }}
                                                                ></label>
                                                                <div
                                                                    className="bs-Fieldset-fields"
                                                                    style={{
                                                                        flexBasis:
                                                                            '80%',
                                                                        maxWidth:
                                                                            '80%',
                                                                    }}
                                                                >
                                                                    <div
                                                                        className="bs-Fieldset-field"
                                                                        style={{
                                                                            width:
                                                                                '100%',
                                                                            display:
                                                                                'block',
                                                                        }}
                                                                    >
                                                                        {formValues &&
                                                                            !formValues.showAvailableVariables && (
                                                                                <div
                                                                                    style={{
                                                                                        width:
                                                                                            '100%',
                                                                                        paddingBottom: 10,
                                                                                        textDecoration:
                                                                                            'underline',
                                                                                        cursor:
                                                                                            'pointer',
                                                                                    }}
                                                                                    onClick={
                                                                                        this
                                                                                            .toggleShowAvailableVariables
                                                                                    }
                                                                                >
                                                                                    Click
                                                                                    to
                                                                                    show
                                                                                    available
                                                                                    variables
                                                                                </div>
                                                                            )}
                                                                        {formValues &&
                                                                            formValues.showAvailableVariables && (
                                                                                <div>
                                                                                    <span
                                                                                        className="template-variable-2"
                                                                                        style={{
                                                                                            display:
                                                                                                'block',
                                                                                            paddingBottom:
                                                                                                '10px',
                                                                                        }}
                                                                                    >
                                                                                        You
                                                                                        can
                                                                                        use
                                                                                        these
                                                                                        available
                                                                                        variables
                                                                                        in
                                                                                        incident
                                                                                        title,
                                                                                        incident
                                                                                        description
                                                                                        or
                                                                                        custom
                                                                                        field.
                                                                                    </span>
                                                                                    <span
                                                                                        className="template-variable-1"
                                                                                        style={{
                                                                                            display:
                                                                                                'block',
                                                                                        }}
                                                                                    >
                                                                                        {incomingRequestVariables.map(
                                                                                            (
                                                                                                item,
                                                                                                index
                                                                                            ) => {
                                                                                                return (
                                                                                                    <span
                                                                                                        key={
                                                                                                            index
                                                                                                        }
                                                                                                        className="template-variables"

                                                                                                        style={
                                                                                                            bulletpoints
                                                                                                        }
                                                                                                    >
                                                                                                        {
                                                                                                            item.description
                                                                                                        }
                                                                                                        <br />
                                                                                                    </span>
                                                                                                );
                                                                                            }
                                                                                        )}
                                                                                    </span>
                                                                                </div>
                                                                            )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </fieldset>
                                                </>
                                            )}

                                        {formValues &&
                                            formValues.showAdvancedOptions &&
                                            formValues.nextAction ===
                                            'createIncident' && (
                                                <>
                                                    <fieldset className="Margin-bottom--16">
                                                        <div className="bs-Fieldset-rows">
                                                            <div
                                                                className="bs-Fieldset-row"
                                                                style={{
                                                                    padding: 0,
                                                                }}
                                                            >
                                                                <label
                                                                    className="bs-Fieldset-label Text-align--left"
                                                                    style={{
                                                                        flexBasis:
                                                                            '20%',
                                                                    }}
                                                                >
                                                                    <span>
                                                                        Filters
                                                                    </span>
                                                                </label>
                                                                <div
                                                                    className="bs-Fieldset-fields"
                                                                    style={{
                                                                        flexBasis:
                                                                            '80%',
                                                                        maxWidth:
                                                                            '80%',
                                                                    }}
                                                                >
                                                                    <div
                                                                        style={{
                                                                            width:
                                                                                '100%',
                                                                            marginBottom: 20,
                                                                        }}
                                                                    >
                                                                        <div>
                                                                            Match
                                                                        </div>
                                                                        <div className="Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                                                                            <div className="Flex-flex Flex-alignItems--center Flex-justifyContent--center">
                                                                                <Field
                                                                                    className="db-select-nw Table-cell--width--maximized"
                                                                                    component={
                                                                                        RenderSelect
                                                                                    }
                                                                                    name="filterMatch"
                                                                                    id="filterMatch"
                                                                                    style={{
                                                                                        height:
                                                                                            '28px',
                                                                                        maxWidth: 150,
                                                                                    }}
                                                                                    options={[
                                                                                        {
                                                                                            value:
                                                                                                'all',
                                                                                            label:
                                                                                                'All',
                                                                                        },
                                                                                        {
                                                                                            value:
                                                                                                'any',
                                                                                            label:
                                                                                                'Any',
                                                                                        },
                                                                                    ]}
                                                                                />
                                                                                <span
                                                                                    style={{
                                                                                        marginLeft: 10,
                                                                                    }}
                                                                                >
                                                                                    of
                                                                                    the
                                                                                    following
                                                                                    rules:
                                                                                </span>
                                                                            </div>
                                                                            <button
                                                                                type="button"
                                                                                onClick={e => {
                                                                                    e.preventDefault();

                                                                                    document
                                                                                        .querySelector(
                                                                                            '#addFilter'
                                                                                        )

                                                                                        .click();
                                                                                }}
                                                                                className="Button bs-ButtonLegacy ActionIconParent"
                                                                            >
                                                                                <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                                                                                    <span>
                                                                                        Add
                                                                                        filter
                                                                                    </span>
                                                                                </span>
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                    <div
                                                                        className="bs-Fieldset-fields"
                                                                        style={{
                                                                            flexBasis:
                                                                                '100%',
                                                                            maxWidth:
                                                                                '100%',
                                                                            width:
                                                                                '100%',
                                                                            padding: 0,
                                                                        }}
                                                                    >
                                                                        <div
                                                                            className="bs-Fieldset-field"
                                                                            style={{
                                                                                width:
                                                                                    '100%',
                                                                            }}
                                                                        >
                                                                            <FieldArray
                                                                                name="filters"
                                                                                component={
                                                                                    this
                                                                                        .renderFilters
                                                                                }
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </fieldset>
                                                    <fieldset>
                                                        <div className="bs-Fieldset-rows">
                                                            <div
                                                                className="bs-Fieldset-row"
                                                                style={{
                                                                    padding: 0,
                                                                }}
                                                            >
                                                                <label
                                                                    className="bs-Fieldset-label Text-align--left"
                                                                    htmlFor="name"
                                                                    style={{
                                                                        flexBasis:
                                                                            '20%',
                                                                    }}
                                                                ></label>
                                                                <div
                                                                    className="bs-Fieldset-fields"
                                                                    style={{
                                                                        flexBasis:
                                                                            '80%',
                                                                        maxWidth:
                                                                            '80%',
                                                                    }}
                                                                >
                                                                    <div
                                                                        className="bs-Fieldset-field"
                                                                        style={{
                                                                            width:
                                                                                '100%',
                                                                        }}
                                                                    >
                                                                        <div
                                                                            style={{
                                                                                width:
                                                                                    '100%',
                                                                                paddingBottom: 10,
                                                                                fontWeight: 500,
                                                                                fontSize: 14,
                                                                            }}
                                                                        >
                                                                            Incidents
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </fieldset>
                                                    <fieldset className="Margin-bottom--16">
                                                        <div className="bs-Fieldset-rows">
                                                            <div
                                                                className="bs-Fieldset-row"
                                                                style={{
                                                                    padding: 0,
                                                                }}
                                                            >
                                                                <label
                                                                    className="bs-Fieldset-label Text-align--left"
                                                                    htmlFor="incidentTitle"
                                                                    style={{
                                                                        flexBasis:
                                                                            '20%',
                                                                    }}
                                                                >
                                                                    <span>
                                                                        Incident
                                                                        Title
                                                                    </span>
                                                                </label>
                                                                <div
                                                                    className="bs-Fieldset-fields"
                                                                    style={{
                                                                        flexBasis:
                                                                            '80%',
                                                                        maxWidth:
                                                                            '80%',
                                                                    }}
                                                                >
                                                                    <div
                                                                        className="bs-Fieldset-field"
                                                                        style={{
                                                                            width:
                                                                                '100%',
                                                                        }}
                                                                    >
                                                                        <Field
                                                                            component={
                                                                                RenderField
                                                                            }
                                                                            name="incidentTitle"
                                                                            type="input"
                                                                            placeholder="Monitor is offline"
                                                                            id="incidentTitle"
                                                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                            style={{
                                                                                width:
                                                                                    '100%',
                                                                                padding:
                                                                                    '3px 5px',
                                                                            }}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </fieldset>
                                                    <fieldset className="Margin-bottom--16">
                                                        <div className="bs-Fieldset-rows">
                                                            <div
                                                                className="bs-Fieldset-row"
                                                                style={{
                                                                    padding: 0,
                                                                }}
                                                            >
                                                                <label
                                                                    className="bs-Fieldset-label Text-align--left"
                                                                    htmlFor="incidentType"
                                                                    style={{
                                                                        flexBasis:
                                                                            '20%',
                                                                    }}
                                                                >
                                                                    <span>
                                                                        Incident
                                                                        Type
                                                                    </span>
                                                                </label>
                                                                <div
                                                                    className="bs-Fieldset-fields"
                                                                    style={{
                                                                        flexBasis:
                                                                            '80%',
                                                                        maxWidth:
                                                                            '80%',
                                                                    }}
                                                                >
                                                                    <div
                                                                        className="bs-Fieldset-field"
                                                                        style={{
                                                                            width:
                                                                                '100%',
                                                                        }}
                                                                    >
                                                                        {formValues &&
                                                                            !formValues.dynamicIncidentType ? (
                                                                            <Field
                                                                                className="db-select-nw"
                                                                                component={
                                                                                    RenderSelect
                                                                                }
                                                                                name="incidentType"
                                                                                id="incidentType"
                                                                                placeholder="Incident type"
                                                                                disabled={
                                                                                    this
                                                                                        .props

                                                                                        .requesting
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
                                                                            />
                                                                        ) : (
                                                                            <Field
                                                                                className="db-BusinessSettings-input-300 TextInput bs-TextInput"
                                                                                component={
                                                                                    RenderField
                                                                                }
                                                                                type="text"
                                                                                name="customIncidentType"
                                                                                id="incidentType"
                                                                                placeholder="Incident Type"
                                                                                style={{
                                                                                    width:
                                                                                        '100%',
                                                                                }}
                                                                            />
                                                                        )}
                                                                    </div>
                                                                    <div
                                                                        onClick={() =>

                                                                            this.props.change(
                                                                                'dynamicIncidentType',
                                                                                !formValues.dynamicIncidentType
                                                                            )
                                                                        }
                                                                        style={{
                                                                            cursor:
                                                                                'pointer',
                                                                            marginTop: 5,
                                                                            textDecoration:
                                                                                'underline',
                                                                        }}
                                                                    >
                                                                        {formValues.dynamicIncidentType
                                                                            ? 'use predefined values'
                                                                            : 'use dynamic values'}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </fieldset>
                                                    <ShouldRender
                                                        if={
                                                            incidentPriorities.length >
                                                            0
                                                        }
                                                    >
                                                        <fieldset className="Margin-bottom--16">
                                                            <div className="bs-Fieldset-rows">
                                                                <div
                                                                    className="bs-Fieldset-row"
                                                                    style={{
                                                                        padding: 0,
                                                                    }}
                                                                >
                                                                    <label
                                                                        className="bs-Fieldset-label Text-align--left"
                                                                        htmlFor="incidentPriority"
                                                                        style={{
                                                                            flexBasis:
                                                                                '20%',
                                                                        }}
                                                                    >
                                                                        <span>
                                                                            Incident
                                                                            Priority
                                                                        </span>
                                                                    </label>
                                                                    <div
                                                                        className="bs-Fieldset-fields"
                                                                        style={{
                                                                            flexBasis:
                                                                                '80%',
                                                                            maxWidth:
                                                                                '80%',
                                                                        }}
                                                                    >
                                                                        <div
                                                                            className="bs-Fieldset-field"
                                                                            style={{
                                                                                width:
                                                                                    '100%',
                                                                            }}
                                                                        >
                                                                            {formValues &&
                                                                                !formValues.dynamicIncidentPriority ? (
                                                                                <Field
                                                                                    style={{
                                                                                        width:
                                                                                            '100%',
                                                                                    }}
                                                                                    className="db-select-nw"
                                                                                    component={
                                                                                        RenderSelect
                                                                                    }
                                                                                    name="incidentPriority"
                                                                                    id="incidentPriority"
                                                                                    disabled={
                                                                                        this
                                                                                            .props

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
                                                                                />
                                                                            ) : (
                                                                                <Field
                                                                                    className="db-BusinessSettings-input-300 TextInput bs-TextInput"
                                                                                    component={
                                                                                        RenderField
                                                                                    }
                                                                                    type="text"
                                                                                    name="customIncidentPriority"
                                                                                    id="incidentPriority"
                                                                                    placeholder="Incident Priority"
                                                                                    style={{
                                                                                        width:
                                                                                            '100%',
                                                                                    }}
                                                                                />
                                                                            )}
                                                                        </div>
                                                                        <div
                                                                            onClick={() =>

                                                                                this.props.change(
                                                                                    'dynamicIncidentPriority',
                                                                                    !formValues.dynamicIncidentPriority
                                                                                )
                                                                            }
                                                                            style={{
                                                                                cursor:
                                                                                    'pointer',
                                                                                marginTop: 5,
                                                                                textDecoration:
                                                                                    'underline',
                                                                            }}
                                                                        >
                                                                            {formValues.dynamicIncidentPriority
                                                                                ? 'use predefined values'
                                                                                : 'use dynamic values'}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </fieldset>
                                                    </ShouldRender>
                                                    <fieldset className="Margin-bottom--16">
                                                        <div className="bs-Fieldset-rows">
                                                            <div
                                                                className="bs-Fieldset-row"
                                                                style={{
                                                                    padding: 0,
                                                                }}
                                                            >
                                                                <label
                                                                    className="bs-Fieldset-label Text-align--left"
                                                                    htmlFor="incidentDescription"
                                                                    style={{
                                                                        flexBasis:
                                                                            '20%',
                                                                    }}
                                                                >
                                                                    <span>
                                                                        Incident
                                                                        Description
                                                                    </span>
                                                                </label>
                                                                <div
                                                                    className="bs-Fieldset-fields"
                                                                    style={{
                                                                        flexBasis:
                                                                            '80%',
                                                                        maxWidth:
                                                                            '80%',
                                                                    }}
                                                                >
                                                                    <div
                                                                        className="bs-Fieldset-field"
                                                                        style={{
                                                                            width:
                                                                                '100%',
                                                                        }}
                                                                    >
                                                                        <Field
                                                                            component={
                                                                                RenderTextArea
                                                                            }
                                                                            name="incidentDescription"
                                                                            type="textarea"
                                                                            rows="5"
                                                                            placeholder="Description of the incident"
                                                                            id="incidentDescription"
                                                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                            style={{
                                                                                width:
                                                                                    '100%',
                                                                                padding:
                                                                                    '3px 5px',
                                                                                whiteSpace:
                                                                                    'normal',
                                                                            }}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </fieldset>
                                                    {customFields &&
                                                        customFields.length >
                                                        0 &&
                                                        customFields.map(
                                                            (field: $TSFixMe, index: $TSFixMe) => (
                                                                <fieldset
                                                                    key={index}
                                                                    className="Margin-bottom--16"
                                                                >
                                                                    <div className="bs-Fieldset-rows">
                                                                        <div
                                                                            className="bs-Fieldset-row"
                                                                            style={{
                                                                                padding: 0,
                                                                            }}
                                                                        >
                                                                            <label
                                                                                className="bs-Fieldset-label Text-align--left"
                                                                                htmlFor="incidentDescription"
                                                                                style={{
                                                                                    flexBasis:
                                                                                        '20%',
                                                                                }}
                                                                            >
                                                                                <span>
                                                                                    {
                                                                                        field.fieldName
                                                                                    }
                                                                                </span>
                                                                            </label>
                                                                            <div
                                                                                className="bs-Fieldset-fields"
                                                                                style={{
                                                                                    flexBasis:
                                                                                        '80%',
                                                                                    maxWidth:
                                                                                        '80%',
                                                                                }}
                                                                            >
                                                                                <div
                                                                                    className="bs-Fieldset-field"
                                                                                    style={{
                                                                                        width:
                                                                                            '100%',
                                                                                    }}
                                                                                >
                                                                                    <Field
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
                                                                                        className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                                        style={{
                                                                                            width:
                                                                                                '100%',
                                                                                            padding:
                                                                                                '3px 5px',
                                                                                            whiteSpace:
                                                                                                'normal',
                                                                                        }}
                                                                                    />
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </fieldset>
                                                            )
                                                        )}
                                                    <fieldset
                                                        style={{
                                                            paddingTop: 0,
                                                        }}
                                                    >
                                                        <div className="bs-Fieldset-rows">
                                                            <div
                                                                className="bs-Fieldset-row"
                                                                style={{
                                                                    padding: 0,
                                                                }}
                                                            >
                                                                <label
                                                                    className="bs-Fieldset-label Text-align--left"
                                                                    htmlFor="name"
                                                                    style={{
                                                                        flexBasis:
                                                                            '20%',
                                                                    }}
                                                                ></label>
                                                                <div
                                                                    className="bs-Fieldset-fields"
                                                                    style={{
                                                                        flexBasis:
                                                                            '80%',
                                                                        maxWidth:
                                                                            '80%',
                                                                    }}
                                                                >
                                                                    <div
                                                                        className="bs-Fieldset-field"
                                                                        style={{
                                                                            width:
                                                                                '100%',
                                                                            display:
                                                                                'block',
                                                                        }}
                                                                    >
                                                                        {formValues &&
                                                                            !formValues.showAvailableVariables && (
                                                                                <div
                                                                                    style={{
                                                                                        width:
                                                                                            '100%',
                                                                                        paddingBottom: 10,
                                                                                        textDecoration:
                                                                                            'underline',
                                                                                        cursor:
                                                                                            'pointer',
                                                                                    }}
                                                                                    onClick={
                                                                                        this
                                                                                            .toggleShowAvailableVariables
                                                                                    }
                                                                                >
                                                                                    Click
                                                                                    to
                                                                                    show
                                                                                    available
                                                                                    variables
                                                                                </div>
                                                                            )}
                                                                        {formValues &&
                                                                            formValues.showAvailableVariables && (
                                                                                <div>
                                                                                    <span
                                                                                        className="template-variable-2"
                                                                                        style={{
                                                                                            display:
                                                                                                'block',
                                                                                            paddingBottom:
                                                                                                '10px',
                                                                                        }}
                                                                                    >
                                                                                        You
                                                                                        can
                                                                                        use
                                                                                        these
                                                                                        available
                                                                                        variables
                                                                                        in
                                                                                        incident
                                                                                        title,
                                                                                        incident
                                                                                        description
                                                                                        or
                                                                                        custom
                                                                                        field.
                                                                                    </span>
                                                                                    <span
                                                                                        className="template-variable-1"
                                                                                        style={{
                                                                                            display:
                                                                                                'block',
                                                                                        }}
                                                                                    >
                                                                                        {incomingRequestVariables.map(
                                                                                            (
                                                                                                item,
                                                                                                index
                                                                                            ) => {
                                                                                                return (
                                                                                                    <span
                                                                                                        key={
                                                                                                            index
                                                                                                        }
                                                                                                        className="template-variables"

                                                                                                        style={
                                                                                                            bulletpoints
                                                                                                        }
                                                                                                    >
                                                                                                        {
                                                                                                            item.description
                                                                                                        }
                                                                                                        <br />
                                                                                                    </span>
                                                                                                );
                                                                                            }
                                                                                        )}
                                                                                    </span>
                                                                                </div>
                                                                            )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </fieldset>
                                                </>
                                            )}
                                    </div>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <ShouldRender
                                            if={

                                                !this.props.requesting &&

                                                this.props.requestError
                                            }
                                        >
                                            <div
                                                className="bs-Tail-copy"
                                                style={{ width: 200 }}
                                            >
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

                                                                    .requestError
                                                            }
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                        <button
                                            className="bs-Button bs-DeprecatedButton btn__modal"
                                            type="button"
                                            onClick={() => {

                                                this.props.destroy();
                                                closeModal({ id: projectId });
                                            }}
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"

                                            disabled={this.props.requesting}
                                            type="submit"
                                            id="createIncomingRequest"
                                        >

                                            {!this.props.requesting && (
                                                <>
                                                    <span>Create</span>
                                                    <span className="create-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </>
                                            )}

                                            {this.props.requesting && (
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


CreateIncomingRequest.displayName = 'CreateIncomingRequest';


CreateIncomingRequest.propTypes = {
    closeModal: PropTypes.func.isRequired,
    openModal: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    createIncomingRequest: PropTypes.func,
    requesting: PropTypes.bool,
    requestError: PropTypes.string,
    formValues: PropTypes.object,
    data: PropTypes.object,
    incidentPriorities: PropTypes.array,
    destroy: PropTypes.func.isRequired, // to manually destroy the form state
    change: PropTypes.func.isRequired, // to manually change redux form state
    fetchCustomFields: PropTypes.func,
    customFields: PropTypes.array,
    fetchMonitorCustomFields: PropTypes.func,
    monitorCustomFields: PropTypes.array,
    monitorsList: PropTypes.array,
};

const CreateIncomingRequestForm = reduxForm({
    form: 'incomingRequestForm', // a unique identifier for this form
    enableReinitialize: false,
    validate, // <--- validation function given to redux-form
    destroyOnUnmount: false,
})(CreateIncomingRequest);

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    {
        createIncomingRequest,
        closeModal,
        openModal,
        fetchCustomFields,
        fetchMonitorCustomFields,
    },
    dispatch
);

const mapStateToProps = (state: $TSFixMe) => {
    let monitors: $TSFixMe = [];
    state.monitor.monitorsList.monitors.forEach((monitor: $TSFixMe) => {
        monitors = [...monitors, ...monitor.monitors];
    });

    return {
        monitorsList: monitors,
        requesting: state.incomingRequest.createIncomingRequest.requesting,
        requestError: state.incomingRequest.createIncomingRequest.error,
        formValues:
            state.form.incomingRequestForm &&
            state.form.incomingRequestForm.values,
        initialValues: {
            selectAllMonitors: false,
            incidentPriority: state.incidentBasicSettings.defaultTemplate
                .template.incidentPriority
                ? state.incidentBasicSettings.defaultTemplate.template
                    .incidentPriority._id ||
                state.incidentBasicSettings.defaultTemplate.template
                    .incidentPriority
                : '',
            showAdvancedOptions: false,
            showAvailableVariables: false,
            incidentType: 'offline',
            noteContent: '',
            incidentState: 'update',
            filterMatch: 'any',
        },
        incidentPriorities:
            state.incidentPriorities.incidentPrioritiesList.incidentPriorities,
        customFields: state.customField.customFields.fields,
        monitorCustomFields:
            state.monitorCustomField.monitorCustomFields.fields,
    };
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(CreateIncomingRequestForm);
