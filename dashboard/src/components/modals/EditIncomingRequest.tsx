import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm, Field, FieldArray } from 'redux-form';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import { closeModal } from '../../actions/modal';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import { RenderField } from '../basic/RenderField';
import { RenderSelect } from '../basic/RenderSelect';
import { editIncomingRequest } from '../../actions/incomingRequest';
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type '{}'.
        errors.name = 'Incoming request name is required';
    }

    return errors;
}

const bulletpoints = {
    display: 'listItem',
    listStyleType: 'disc',
    listStylePosition: 'inside',
};

class EditIncomingRequest extends Component {
    state = {
        monitorError: null,
        selectedProjects: [],
        selectedComponents: [],
        selectedMonitors: [],
        selectData: [],
    };

    componentDidMount() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchCustomFields' does not exist on typ... Remove this comment to see the full error message
            fetchCustomFields,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchMonitorCustomFields' does not exist... Remove this comment to see the full error message
            fetchMonitorCustomFields,
        } = this.props;
        fetchCustomFields(projectId);
        fetchMonitorCustomFields(projectId);

        window.addEventListener('keydown', this.handleKeyBoard);

        this.formatData();
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = (values: $TSFixMe) => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
            closeModal,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'editIncomingRequest' does not exist on t... Remove this comment to see the full error message
            editIncomingRequest,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'initialValues' does not exist on type 'R... Remove this comment to see the full error message
            initialValues,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'destroy' does not exist on type 'Readonl... Remove this comment to see the full error message
            destroy,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'customFields' does not exist on type 'Re... Remove this comment to see the full error message
            customFields,
        } = this.props;
        const requestId = initialValues._id;
        const postObj = {};

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type '{}'.
        postObj.name = values.name;

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'filterMatch' does not exist on type '{}'... Remove this comment to see the full error message
        postObj.filterMatch = values.filterMatch;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'filters' does not exist on type '{}'.
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
            if (
                values.selectMonitor &&
                values.selectMonitor === 'selectAllMonitors'
            ) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'selectAllMonitors' does not exist on typ... Remove this comment to see the full error message
                postObj.selectAllMonitors = true;
            } else {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'selectAllMonitors' does not exist on typ... Remove this comment to see the full error message
                postObj.selectAllMonitors = false;
            }
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createIncident' does not exist on type '... Remove this comment to see the full error message
            postObj.createIncident = true;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentTitle' does not exist on type '{... Remove this comment to see the full error message
            postObj.incidentTitle = values.incidentTitle;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentType' does not exist on type '{}... Remove this comment to see the full error message
            postObj.incidentType = values.incidentType;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createSeparateIncident' does not exist o... Remove this comment to see the full error message
            postObj.createSeparateIncident = values.createSeparateIncident;
            if (values.dynamicIncidentType) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'customIncidentType' does not exist on ty... Remove this comment to see the full error message
                postObj.customIncidentType = values.customIncidentType;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'dynamicIncidentType' does not exist on t... Remove this comment to see the full error message
                postObj.dynamicIncidentType = values.dynamicIncidentType;
            }
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentPriority' does not exist on type... Remove this comment to see the full error message
            postObj.incidentPriority = values.incidentPriority;
            if (values.dynamicIncidentPriority) {
                // create this incident priority on the BE
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'customIncidentPriority' does not exist o... Remove this comment to see the full error message
                postObj.customIncidentPriority = values.customIncidentPriority;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'dynamicIncidentPriority' does not exist ... Remove this comment to see the full error message
                postObj.dynamicIncidentPriority =
                    values.dynamicIncidentPriority;
            }
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentDescription' does not exist on t... Remove this comment to see the full error message
            postObj.incidentDescription = values.incidentDescription;

            // @ts-expect-error ts-migrate(2339) FIXME: Property 'customFields' does not exist on type '{}... Remove this comment to see the full error message
            postObj.customFields = customFields.map((field: $TSFixMe) => ({
                fieldName: field.fieldName,
                fieldType: field.fieldType,
                uniqueField: field.uniqueField,

                fieldValue:
                    field.fieldType === 'number'
                        ? parseFloat(values[field.fieldName])
                        : values[field.fieldName]
            }));

            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type '{}'.
            postObj.monitors = [];
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'selectAllMonitors' does not exist on typ... Remove this comment to see the full error message
            if (!postObj.selectAllMonitors) {
                if (
                    this.state.selectedMonitors &&
                    this.state.selectedMonitors.length > 0
                ) {
                    const monitors = this.state.selectedMonitors;
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type '{}'.
                    postObj.monitors = monitors;
                }

                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type '{}'.
                const isDuplicate = postObj.monitors
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type '{}'.
                    ? postObj.monitors.length === new Set(postObj.monitors).size
                        ? false
                        : true
                    : false;

                if (isDuplicate) {
                    this.setState({
                        monitorError: 'Duplicate monitor selection found',
                    });
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type '{}'.
                    postObj.monitors = [];
                    return;
                }
            }
        }

        if (values.nextAction && values.nextAction === 'updateIncidentNote') {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateIncidentNote' does not exist on ty... Remove this comment to see the full error message
            postObj.updateIncidentNote = true;
        }

        if (values.nextAction && values.nextAction === 'updateInternalNote') {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateInternalNote' does not exist on ty... Remove this comment to see the full error message
            postObj.updateInternalNote = true;
        }

        if (
            values.nextAction &&
            (values.nextAction === 'updateIncidentNote' ||
                values.nextAction === 'updateInternalNote')
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteContent' does not exist on type '{}'... Remove this comment to see the full error message
            postObj.noteContent = values.noteContent;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentState' does not exist on type '{... Remove this comment to see the full error message
            postObj.incidentState = values.incidentState;
            if (values.incidentState === 'others') {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentState' does not exist on type '{... Remove this comment to see the full error message
                postObj.incidentState = values.customIncidentState;
            }
            if (values.post_statuspage) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'post_statuspage' does not exist on type ... Remove this comment to see the full error message
                postObj.post_statuspage = values.post_statuspage;
            }
        }

        if (values.nextAction && values.nextAction === 'acknowledgeIncident') {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'acknowledgeIncident' does not exist on t... Remove this comment to see the full error message
            postObj.acknowledgeIncident = true;
        }

        if (values.nextAction && values.nextAction === 'resolveIncident') {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolveIncident' does not exist on type ... Remove this comment to see the full error message
            postObj.resolveIncident = true;
        }

        editIncomingRequest(projectId, requestId, postObj).then(() => {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'requesting' does not exist on type 'Read... Remove this comment to see the full error message
            if (!this.props.requesting && !this.props.requestError) {
                destroy();
                closeModal({
                    id: projectId, // the projectId was used as the id for this modal
                });
            }
        });
    };

    formatData = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorsList' does not exist on type 'Re... Remove this comment to see the full error message
        const monitors = this.props.monitorsList;
        const hash = {};

        monitors.forEach((monitor: $TSFixMe) => {
            const projectId = monitor.projectId._id || monitor.projectId;
            const componentId = monitor.componentId._id || monitor.componentId;
            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
            if (!hash[projectId]) {
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
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
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                hash[projectId] = {
                    // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                    ...hash[projectId],
                    // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
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
                    // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                    hash[projectId] = {
                        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                        ...hash[projectId],
                        components: [
                            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'initialValues' does not exist on type 'R... Remove this comment to see the full error message
            selectedMonitors: this.props.initialValues.monitors || [],
        });
    };

    updateState = (value: $TSFixMe, key: $TSFixMe) => {
        this.setState(prevState => {
            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorsList' does not exist on type 'Re... Remove this comment to see the full error message
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
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'selectedMonitors' does not exist on type... Remove this comment to see the full error message
                    new Set([...prevState.selectedMonitors, ...monitorIds])
                ),
                selectedComponents: Array.from(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'selectedComponents' does not exist on ty... Remove this comment to see the full error message
                    new Set([...prevState.selectedComponents, ...componentIds])
                ),
            }));
        }

        if (key === 'selectedProjects' && !databank.includes(id)) {
            const monitorIds: $TSFixMe = [];
            const componentIds: $TSFixMe = [];
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorsList' does not exist on type 'Re... Remove this comment to see the full error message
            this.props.monitorsList.forEach((monitor: $TSFixMe) => {
                if ((monitor.projectId._id || monitor.projectId) === id) {
                    monitorIds.push(monitor._id);
                    componentIds.push(
                        monitor.componentId._id || monitor.componentId
                    );
                }
            });

            return this.setState(prevState => ({
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'selectedMonitors' does not exist on type... Remove this comment to see the full error message
                selectedMonitors: prevState.selectedMonitors.filter(
                    (monitorId: $TSFixMe) => !monitorIds.includes(monitorId)
                ),
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'selectedComponents' does not exist on ty... Remove this comment to see the full error message
                selectedComponents: prevState.selectedComponents.filter(
                    (componentId: $TSFixMe) => !componentIds.includes(componentId)
                ),
            }));
        }

        if (key === 'selectedComponents' && databank.includes(id)) {
            const monitorIds: $TSFixMe = [];
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorsList' does not exist on type 'Re... Remove this comment to see the full error message
            this.props.monitorsList.forEach((monitor: $TSFixMe) => {
                if ((monitor.componentId._id || monitor.componentId) === id) {
                    monitorIds.push(monitor._id);
                }
            });

            return this.setState(prevState => ({
                selectedMonitors: Array.from(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'selectedMonitors' does not exist on type... Remove this comment to see the full error message
                    new Set([...prevState.selectedMonitors, ...monitorIds])
                ),
            }));
        }

        if (key === 'selectedComponents' && !databank.includes(id)) {
            const monitorIds: $TSFixMe = [];
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorsList' does not exist on type 'Re... Remove this comment to see the full error message
            this.props.monitorsList.forEach((monitor: $TSFixMe) => {
                if ((monitor.componentId._id || monitor.componentId) === id) {
                    monitorIds.push(monitor._id);
                }
            });

            return this.setState(prevState => ({
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'selectedMonitors' does not exist on type... Remove this comment to see the full error message
                selectedMonitors: prevState.selectedMonitors.filter(
                    (monitorId: $TSFixMe) => !monitorIds.includes(monitorId)
                ),
            }));
        }
    };

    renderCustomFields = ({
        fields
    }: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'formValues' does not exist on type 'Read... Remove this comment to see the full error message
        const { formValues, customFields } = this.props;
        return <>
            <div
                style={{
                    width: '100%',
                    position: 'relative',
                }}
            >
                <span
                    id="addCustomField"
                    onClick={() => {
                        fields.push();
                    }}
                ></span>
                {fields.map((field: $TSFixMe, index: $TSFixMe) => {
                    const fieldType = (
                        customFields.find(
                            (customField: $TSFixMe) => String(customField._id) ===
                            String(
                                (formValues.customFields[index] || {})
                                    .fieldName
                            )
                        ) || {}
                    ).fieldType;

                    return (
                        <div
                            style={{
                                width: '100%',
                                marginBottom: 10,
                            }}
                            key={index}
                        >
                            <div className="Flex-flex">
                                <Field
                                    className="db-select-nw Table-cell--width--maximized"
                                    component={RenderSelect}
                                    name={`${field}.fieldName`}
                                    id={`${field}.fieldName`}
                                    placeholder="Field Name"
                                    style={{
                                        height: '28px',
                                        width: '100%',
                                    }}
                                    options={[
                                        {
                                            value: '',
                                            label: 'Select a field',
                                        },
                                        ...customFields.map(
                                            (customField: $TSFixMe) => ({
                                                value: customField._id,

                                                label:
                                                    customField.fieldName
                                            })
                                        ),
                                    ]}
                                />
                                <Field
                                    component={RenderField}
                                    name={`${field}.fieldValue`}
                                    type={
                                        formValues && fieldType
                                            ? fieldType
                                            : 'input'
                                    }
                                    placeholder="Field Value"
                                    id={`${field}.fieldValue`}
                                    className="db-BusinessSettings-input TextInput bs-TextInput"
                                    style={{
                                        width: '100%',
                                        padding: '3px 5px',
                                    }}
                                    parentStyle={{
                                        marginLeft: 5,
                                    }}
                                />
                            </div>
                            <button
                                id="removeMonitor"
                                className="Button bs-ButtonLegacy ActionIconParent"
                                style={{
                                    marginTop: 10,
                                }}
                                type="button"
                                onClick={() => {
                                    fields.remove(index);
                                }}
                            >
                                <span className="bs-Button bs-Button--icon bs-Button--delete">
                                    <span>Remove Field</span>
                                </span>
                            </button>
                        </div>
                    );
                })}
            </div>
        </>;
    };

    renderFilters = ({
        fields
    }: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'filterShowing' does not exist on type '{... Remove this comment to see the full error message
        const { filterShowing } = this.state;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'formValues' does not exist on type 'Read... Remove this comment to see the full error message
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
                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: Element[]; title: string; }' is ... Remove this comment to see the full error message
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
                                                    3 | request.header.value
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
                    // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                    return document
                        .getElementById('editIncomingRequest')
                        .click();
                }
                break;
            default:
                return false;
        }
    };

    handleCloseModal = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'destroy' does not exist on type 'Readonl... Remove this comment to see the full error message
        this.props.destroy();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
        this.props.closeModal({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            id: this.props.projectId,
        });
    };

    toggleShowAdvancedOptions = () =>
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'change' does not exist on type 'Readonly... Remove this comment to see the full error message
        this.props.change(
            'showAdvancedOptions',
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'formValues' does not exist on type 'Read... Remove this comment to see the full error message
            !this.props.formValues.showAdvancedOptions
        );

    toggleShowAvailableVariables = () =>
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'change' does not exist on type 'Readonly... Remove this comment to see the full error message
        this.props.change(
            'showAvailableVariables',
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'formValues' does not exist on type 'Read... Remove this comment to see the full error message
            !this.props.formValues.showAvailableVariables
        );

    onContentChange = (val: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'change' does not exist on type 'Readonly... Remove this comment to see the full error message
        this.props.change('noteContent', val);
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
            handleSubmit,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Reado... Remove this comment to see the full error message
            projectId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'formValues' does not exist on type 'Read... Remove this comment to see the full error message
            formValues,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
            closeModal,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentPriorities' does not exist on ty... Remove this comment to see the full error message
            incidentPriorities,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'destroy' does not exist on type 'Readonl... Remove this comment to see the full error message
            destroy,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'customFields' does not exist on type 'Re... Remove this comment to see the full error message
            customFields,
        } = this.props;

        const {
            selectedProjects,
            selectedComponents,
            selectedMonitors,
            selectData,
        } = this.state;

        return (
            <div
                className="ModalLayer-contents"
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
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
                                        <span>Edit Incoming HTTP Request</span>
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
                                                        htmlFor="endpoint"
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
                                                                                    value={`${
                                                                                        selectedMonitors.length
                                                                                    } Monitor${
                                                                                        selectedMonitors.length >
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
                                                            >
                                                                {formValues &&
                                                                formValues.showAdvancedOptions
                                                                    ? 'Hide Advanced Options'
                                                                    : 'Show Advanced Options'}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>

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
                                                                                // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                                                                                document
                                                                                    .querySelector(
                                                                                        '#addFilter'
                                                                                    )
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'click' does not exist on type 'Element'.
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
                                                                                    // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                                                                                    document
                                                                                        .querySelector(
                                                                                            '#addFilter'
                                                                                        )
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'click' does not exist on type 'Element'.
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
                                                                                                        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ display: string; listStyleType: string; li... Remove this comment to see the full error message
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
                                                                                    // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                                                                                    document
                                                                                        .querySelector(
                                                                                            '#addFilter'
                                                                                        )
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'click' does not exist on type 'Element'.
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
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'requesting' does not exist on type 'Read... Remove this comment to see the full error message
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
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'change' does not exist on type 'Readonly... Remove this comment to see the full error message
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
                                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'requesting' does not exist on type 'Read... Remove this comment to see the full error message
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
                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'change' does not exist on type 'Readonly... Remove this comment to see the full error message
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
                                                                            type="text"
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
                                                                                                        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ display: string; listStyleType: string; li... Remove this comment to see the full error message
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
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'requesting' does not exist on type 'Read... Remove this comment to see the full error message
                                                !this.props.requesting &&
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'requestError' does not exist on type 'Re... Remove this comment to see the full error message
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
                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'requestError' does not exist on type 'Re... Remove this comment to see the full error message
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
                                                destroy();
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
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'requesting' does not exist on type 'Read... Remove this comment to see the full error message
                                            disabled={this.props.requesting}
                                            type="submit"
                                            id="editIncomingRequest"
                                        >
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'requesting' does not exist on type 'Read... Remove this comment to see the full error message
                                            {!this.props.requesting && (
                                                <>
                                                    <span>Edit</span>
                                                    <span className="create-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </>
                                            )}
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'requesting' does not exist on type 'Read... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
EditIncomingRequest.displayName = 'EditIncomingRequest';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
EditIncomingRequest.propTypes = {
    closeModal: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    editIncomingRequest: PropTypes.func,
    requesting: PropTypes.bool,
    requestError: PropTypes.string,
    formValues: PropTypes.object,
    initialValues: PropTypes.object,
    projectId: PropTypes.string,
    incidentPriorities: PropTypes.func,
    change: PropTypes.func.isRequired, // to manually change value of redux form state
    destroy: PropTypes.func.isRequired, // to manually destroy the redux form state
    customFields: PropTypes.array,
    fetchCustomFields: PropTypes.func,
    fetchMonitorCustomFields: PropTypes.func,
    monitorCustomFields: PropTypes.array,
    monitorsList: PropTypes.array,
};

const EditIncomingRequestForm = reduxForm({
    form: 'editIncomingRequestForm', // a unique identifier for this form
    enableReinitialize: false,
    validate, // <--- validation function given to redux-form
    destroyOnUnmount: false,
})(EditIncomingRequest);

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        editIncomingRequest,
        closeModal,
        fetchCustomFields,
        fetchMonitorCustomFields,
    },
    dispatch
);

const mapStateToProps = (state: $TSFixMe) => {
    const incomingRequestToBeUpdated = state.modal.modals[0].incomingRequest;
    const projectId = state.modal.modals[0].projectId;
    const incidentPriorities =
        state.incidentPriorities.incidentPrioritiesList.incidentPriorities;

    const initialValues = {};

    if (incomingRequestToBeUpdated) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type '{}'.
        initialValues.name = incomingRequestToBeUpdated.name;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'selectAllMonitors' does not exist on typ... Remove this comment to see the full error message
        initialValues.selectAllMonitors =
            incomingRequestToBeUpdated.selectAllMonitors;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'createSeparateIncident' does not exist o... Remove this comment to see the full error message
        initialValues.createSeparateIncident =
            incomingRequestToBeUpdated.createSeparateIncident;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'createIncident' does not exist on type '... Remove this comment to see the full error message
        initialValues.createIncident =
            incomingRequestToBeUpdated.createIncident;
        if (incomingRequestToBeUpdated.createIncident) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'nextAction' does not exist on type '{}'.
            initialValues.nextAction = 'createIncident';
        }
        if (incomingRequestToBeUpdated.updateIncidentNote) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'nextAction' does not exist on type '{}'.
            initialValues.nextAction = 'updateIncidentNote';
        }
        if (incomingRequestToBeUpdated.updateInternalNote) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'nextAction' does not exist on type '{}'.
            initialValues.nextAction = 'updateInternalNote';
        }
        if (
            incomingRequestToBeUpdated.updateIncidentNote ||
            incomingRequestToBeUpdated.updateInternalNote
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentState' does not exist on type '{... Remove this comment to see the full error message
            initialValues.incidentState = ['update', 'investigating'].includes(
                incomingRequestToBeUpdated.incidentState
            )
                ? incomingRequestToBeUpdated.incidentState
                : 'others';
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'customIncidentState' does not exist on t... Remove this comment to see the full error message
            initialValues.customIncidentState = ![
                'update',
                'investigating',
            ].includes(incomingRequestToBeUpdated.incidentState)
                ? incomingRequestToBeUpdated.incidentState
                : '';
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'noteContent' does not exist on type '{}'... Remove this comment to see the full error message
            initialValues.noteContent =
                incomingRequestToBeUpdated.noteContent || '';
        }
        if (incomingRequestToBeUpdated.post_statuspage) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'post_statuspage' does not exist on type ... Remove this comment to see the full error message
            initialValues.post_statuspage =
                incomingRequestToBeUpdated.post_statuspage;
        }
        if (incomingRequestToBeUpdated.acknowledgeIncident) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'nextAction' does not exist on type '{}'.
            initialValues.nextAction = 'acknowledgeIncident';
        }
        if (incomingRequestToBeUpdated.resolveIncident) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'nextAction' does not exist on type '{}'.
            initialValues.nextAction = 'resolveIncident';
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type '{}'.
        initialValues._id = incomingRequestToBeUpdated._id;

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'filters' does not exist on type '{}'.
        initialValues.filters = incomingRequestToBeUpdated.filters;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'filterMatch' does not exist on type '{}'... Remove this comment to see the full error message
        initialValues.filterMatch = incomingRequestToBeUpdated.filterMatch;

        if (incomingRequestToBeUpdated.createIncident) {
            const priorityIds = incidentPriorities.map((priority: $TSFixMe) => String(priority._id)
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'dynamicIncidentPriority' does not exist ... Remove this comment to see the full error message
            initialValues.dynamicIncidentPriority = !priorityIds.includes(
                incomingRequestToBeUpdated.incidentPriority
            );

            // @ts-expect-error ts-migrate(2339) FIXME: Property 'dynamicIncidentPriority' does not exist ... Remove this comment to see the full error message
            if (initialValues.dynamicIncidentPriority) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'customIncidentPriority' does not exist o... Remove this comment to see the full error message
                initialValues.customIncidentPriority =
                    incomingRequestToBeUpdated.incidentPriority;
            }
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'dynamicIncidentPriority' does not exist ... Remove this comment to see the full error message
        if (!initialValues.dynamicIncidentPriority) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentPriority' does not exist on type... Remove this comment to see the full error message
            initialValues.incidentPriority =
                incomingRequestToBeUpdated.incidentPriority;
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentTitle' does not exist on type '{... Remove this comment to see the full error message
        initialValues.incidentTitle = incomingRequestToBeUpdated.incidentTitle;
        if (incomingRequestToBeUpdated.createIncident) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'dynamicIncidentType' does not exist on t... Remove this comment to see the full error message
            initialValues.dynamicIncidentType = ![
                'offline',
                'online',
                'degraded',
            ].includes(incomingRequestToBeUpdated.incidentType);

            // @ts-expect-error ts-migrate(2339) FIXME: Property 'dynamicIncidentType' does not exist on t... Remove this comment to see the full error message
            if (initialValues.dynamicIncidentType) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'customIncidentType' does not exist on ty... Remove this comment to see the full error message
                initialValues.customIncidentType =
                    incomingRequestToBeUpdated.incidentType;
            }
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'dynamicIncidentType' does not exist on t... Remove this comment to see the full error message
        if (!initialValues.dynamicIncidentType) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentType' does not exist on type '{}... Remove this comment to see the full error message
            initialValues.incidentType =
                incomingRequestToBeUpdated.incidentType;
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentDescription' does not exist on t... Remove this comment to see the full error message
        initialValues.incidentDescription =
            incomingRequestToBeUpdated.incidentDescription;
        if (
            incomingRequestToBeUpdated.customFields &&
            incomingRequestToBeUpdated.customFields.length > 0
        ) {
            incomingRequestToBeUpdated.customFields.forEach(
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                (field: $TSFixMe) => initialValues[field.fieldName] = field.fieldValue
            );
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'showAdvancedOptions' does not exist on t... Remove this comment to see the full error message
        initialValues.showAdvancedOptions = false;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'showAvailableVariables' does not exist o... Remove this comment to see the full error message
        initialValues.showAvailableVariables = false;
    }

    let monitors: $TSFixMe = [];
    state.monitor.monitorsList.monitors.forEach((monitor: $TSFixMe) => {
        monitors = [...monitors, ...monitor.monitors];
    });
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'selectAllMonitors' does not exist on typ... Remove this comment to see the full error message
    if (!initialValues.selectAllMonitors && incomingRequestToBeUpdated) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'selectMonitor' does not exist on type '{... Remove this comment to see the full error message
        initialValues.selectMonitor = 'selectSpecificMonitors';
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type '{}'.
        initialValues.monitors =
            incomingRequestToBeUpdated.monitors &&
            incomingRequestToBeUpdated.monitors
                .map((monitor: $TSFixMe) => monitor.monitorId
                ? monitor.monitorId._id || monitor.monitorId
                : null
                )
                .filter((item: $TSFixMe) => typeof item === 'string');
    } else {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'selectMonitor' does not exist on type '{... Remove this comment to see the full error message
        initialValues.selectMonitor = 'selectAllMonitors';
    }

    return {
        monitorsList: monitors,
        requesting: state.incomingRequest.updateIncomingRequest.requesting,
        requestError: state.incomingRequest.updateIncomingRequest.error,
        formValues:
            state.form.editIncomingRequestForm &&
            state.form.editIncomingRequestForm.values,
        initialValues,
        projectId,
        incidentPriorities,
        customFields: state.customField.customFields.fields,
        monitorCustomFields:
            state.monitorCustomField.monitorCustomFields.fields,
    };
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(EditIncomingRequestForm);
