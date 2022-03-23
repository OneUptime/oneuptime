import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

import ClickOutside from 'react-click-outside';
import { Validate } from '../../config';

import { reduxForm, Field } from 'redux-form';
import { createSlack } from '../../actions/slackWebhook';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import { RenderField } from '../basic/RenderField';
import MultiSelectDropDown from '../basic/MultiSelectDropDown';

function validate(values: $TSFixMe) {
    const errors = {};

    if (!Validate.url(values.endpoint)) {

        errors.endpoint = 'Webhook url is required!';
    }

    return errors;
}

interface CreateSlackProps {
    currentProject?: object;
    createSlack: Function;
    closeThisDialog: Function;
    handleSubmit: Function;
    monitor?: object;
    newSlack?: object;
    data?: object;
    formValues?: object;
    monitorsList?: unknown[];
}

class CreateSlack extends React.Component<CreateSlackProps> {
    state = {
        monitorError: null,
        selectedProjects: [],
        selectedComponents: [],
        selectedMonitors: [],
        selectData: [],
    };
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);

        this.formatData();
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = (values: $TSFixMe) => {
        const {

            createSlack,

            closeThisDialog,

            monitor,

            data: { monitorId },
        } = this.props;
        const postObj = {};
        const { selectAllMonitors } = values;
        let monitors = [];
        const allMonitors = monitor.monitorsList.monitors
            .map((monitor: $TSFixMe) => monitor.monitors)
            .flat();

        if (selectAllMonitors) {
            monitors = allMonitors.map((monitor: $TSFixMe) => monitor._id);
        }
        if (
            this.state.selectedMonitors &&
            this.state.selectedMonitors.length > 0
        ) {
            monitors = this.state.selectedMonitors;
        }
        if (monitorId) {
            monitors = [monitorId];
        }
        if (!monitors || (monitors && monitors.length === 0)) {
            this.setState({
                monitorError: 'No monitor was selected',
            });
            return;
        }

        postObj.webHookName = values.webHookName;

        postObj.endpoint = values.endpoint;

        postObj.monitors = monitors;

        postObj.monitors = postObj.monitors.filter((monitor: $TSFixMe) => monitor !== null);

        postObj.type = 'slack';

        postObj.incidentCreated = values.incidentCreated
            ? values.incidentCreated
            : false;

        postObj.incidentResolved = values.incidentResolved
            ? values.incidentResolved
            : false;

        postObj.incidentAcknowledged = values.incidentAcknowledged
            ? values.incidentAcknowledged
            : false;

        postObj.incidentNoteAdded = values.incidentNoteAdded
            ? values.incidentNoteAdded
            : false;


        const isDuplicate = postObj.monitors

            ? postObj.monitors.length === new Set(postObj.monitors).size
                ? false
                : true
            : false;

        if (isDuplicate) {
            this.setState({
                monitorError: 'Duplicate monitor selection found',
            });

            postObj.monitorId = [];
            return;
        }

        createSlack(this.props.currentProject._id, postObj).then(() => {

            if (this.props.newSlack && !this.props.newSlack.error) {
                closeThisDialog();
            }
        });
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                return this.props.closeThisDialog();
            case 'Enter':

                return document.getElementById('createSlack').click();
            default:
                return false;
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

    render() {
        const {

            handleSubmit,

            closeThisDialog,

            data: { monitorId },
        } = this.props;


        const { formValues } = this.props;
        const {
            selectedProjects,
            selectedComponents,
            selectedMonitors,
            selectData,
        } = this.state;

        const monitorList = [];

        const allMonitors = this.props.monitor.monitorsList.monitors
            .map((monitor: $TSFixMe) => monitor.monitors)
            .flat();
        if (allMonitors && allMonitors.length > 0) {
            allMonitors.map((monitor: $TSFixMe) => monitorList.push({
                value: monitor._id,
                label: monitor.name,
            })
            );
        }

        return (
            <div
                className="ModalLayer-contents"

                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM">
                    <div className="bs-Modal" style={{ width: 600 }}>
                        <ClickOutside onClickOutside={closeThisDialog}>
                            <div className="bs-Modal-header">
                                <div
                                    className="bs-Modal-header-copy bs-u-flex Flex-direction--column"
                                    style={{
                                        marginBottom: '10px',
                                        marginTop: '10px',
                                    }}
                                >
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap Margin-bottom--4">
                                        <span>Create Slack Webhook</span>
                                    </span>
                                    <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                        <span>
                                            Click{' '}
                                            <a
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                href="https://github.com/OneUptime/feature-docs/blob/master/Webhooks.md#slack"
                                                style={{
                                                    textDecoration: 'underline',
                                                }}
                                            >
                                                here
                                            </a>{' '}
                                            to check documentation on how to
                                            integrate Slack with OneUptime.
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
                                                        htmlFor="webHookName"
                                                    >
                                                        <span>Name</span>
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
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
                                                                name="webHookName"
                                                                type="text"
                                                                placeholder="Webhook Name"
                                                                id="webHookName"
                                                                className="db-BusinessSettings-input TextInput bs-TextInput"
                                                                style={{
                                                                    width:
                                                                        '100%',
                                                                    padding:
                                                                        '5px 10px',
                                                                }}
                                                                autoFocus={true}
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
                                                    style={{ padding: 0 }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label Text-align--left"
                                                        htmlFor="endpoint"
                                                    >
                                                        <span>
                                                            Endpoint URL
                                                        </span>
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
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
                                                                name="endpoint"
                                                                type="url"
                                                                placeholder="Enter Slack Webhook URL"
                                                                id="endpoint"
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

                                        <ShouldRender if={!monitorId}>
                                            <fieldset className="Margin-bottom--16">
                                                <div className="bs-Fieldset-rows">
                                                    <div
                                                        className="bs-Fieldset-row Margin-bottom--12 Padding-left--0"
                                                        style={{ padding: 0 }}
                                                    >
                                                        <label
                                                            className="bs-Fieldset-label Text-align--left"
                                                            htmlFor="monitorId"
                                                        >
                                                            <span>
                                                                Monitors
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
                                                </div>
                                            </fieldset>
                                        </ShouldRender>

                                        <fieldset className="Margin-bottom--16">
                                            <div className="bs-Fieldset-rows">
                                                <div
                                                    className="bs-Fieldset-row"
                                                    style={{ padding: 0 }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label Text-align--left"
                                                        htmlFor="monitorId"
                                                    >
                                                        <span></span>
                                                    </label>
                                                    <div
                                                        className="bs-Fieldset-fields"
                                                        style={{
                                                            paddingTop: '6px',
                                                        }}
                                                    >
                                                        <div className="bs-Fieldset-field">
                                                            <label
                                                                className="Checkbox"
                                                                style={{
                                                                    marginRight:
                                                                        '12px',
                                                                }}
                                                            >
                                                                <Field
                                                                    component="input"
                                                                    type="checkbox"
                                                                    name="incidentCreated"
                                                                    className="Checkbox-source"
                                                                    id="incidentCreated"
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
                                                                    <label>
                                                                        <span>
                                                                            Ping
                                                                            when
                                                                            incident
                                                                            is
                                                                            Created
                                                                        </span>
                                                                    </label>
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
                                                        htmlFor="monitorId"
                                                    >
                                                        <span></span>
                                                    </label>
                                                    <div
                                                        className="bs-Fieldset-fields"
                                                        style={{
                                                            paddingTop: '6px',
                                                        }}
                                                    >
                                                        <div className="bs-Fieldset-field">
                                                            <label
                                                                className="Checkbox"
                                                                style={{
                                                                    marginRight:
                                                                        '12px',
                                                                }}
                                                            >
                                                                <Field
                                                                    component="input"
                                                                    type="checkbox"
                                                                    name="incidentAcknowledged"
                                                                    className="Checkbox-source"
                                                                    id="incidentAcknowledged"
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
                                                                    <label>
                                                                        <span>
                                                                            Ping
                                                                            when
                                                                            incident
                                                                            is
                                                                            Acknowledged
                                                                        </span>
                                                                    </label>
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
                                                        htmlFor="monitorId"
                                                    >
                                                        <span></span>
                                                    </label>
                                                    <div
                                                        className="bs-Fieldset-fields"
                                                        style={{
                                                            paddingTop: '6px',
                                                        }}
                                                    >
                                                        <div className="bs-Fieldset-field">
                                                            <label
                                                                className="Checkbox"
                                                                style={{
                                                                    marginRight:
                                                                        '12px',
                                                                }}
                                                            >
                                                                <Field
                                                                    component="input"
                                                                    type="checkbox"
                                                                    name="incidentResolved"
                                                                    className="Checkbox-source"
                                                                    id="incidentResolved"
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
                                                                    <label>
                                                                        <span>
                                                                            Ping
                                                                            when
                                                                            incident
                                                                            is
                                                                            Resolved
                                                                        </span>
                                                                    </label>
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
                                                        htmlFor="monitorId"
                                                    >
                                                        <span></span>
                                                    </label>
                                                    <div
                                                        className="bs-Fieldset-fields"
                                                        style={{
                                                            paddingTop: '6px',
                                                        }}
                                                    >
                                                        <div className="bs-Fieldset-field">
                                                            <label
                                                                className="Checkbox"
                                                                style={{
                                                                    marginRight:
                                                                        '12px',
                                                                }}
                                                            >
                                                                <Field
                                                                    component="input"
                                                                    type="checkbox"
                                                                    name="incidentNoteAdded"
                                                                    className="Checkbox-source"
                                                                    id="incidentNoteAdded"
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
                                                                    <label>
                                                                        <span>
                                                                            Ping
                                                                            when
                                                                            incident
                                                                            note
                                                                            is
                                                                            Added
                                                                        </span>
                                                                    </label>
                                                                </div>
                                                            </label>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>
                                    </div>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <ShouldRender
                                            if={

                                                this.props.newSlack &&

                                                this.props.newSlack.error
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

                                                                    .newSlack
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
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                            disabled={

                                                this.props.newSlack &&

                                                this.props.newSlack.requesting
                                            }
                                            type="submit"
                                            id="createSlack"
                                        >

                                            {this.props.newSlack &&

                                                !this.props.newSlack
                                                    .requesting && (
                                                    <>
                                                        <span>Create</span>
                                                        <span className="create-btn__keycode">
                                                            <span className="keycode__icon keycode__icon--enter" />
                                                        </span>
                                                    </>
                                                )}

                                            {this.props.newSlack &&

                                                this.props.newSlack
                                                    .requesting && (
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


CreateSlack.displayName = 'CreateSlack';


CreateSlack.propTypes = {
    currentProject: PropTypes.object,
    createSlack: PropTypes.func.isRequired,
    closeThisDialog: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    monitor: PropTypes.object,
    newSlack: PropTypes.object,
    data: PropTypes.object,
    formValues: PropTypes.object,
    monitorsList: PropTypes.array,
};

const NewCreateSlack = reduxForm({
    form: 'newCreateSlack', // a unique identifier for this form
    enableReinitialize: true,
    validate, // <--- validation function given to redux-for
    destroyOnUnmount: true,
})(CreateSlack);

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    {
        createSlack,
    },
    dispatch
);
//
const mapStateToProps = (state: $TSFixMe) => {
    const monitorsList: $TSFixMe = [];
    state.monitor.monitorsList.monitors.forEach((item: $TSFixMe) => {
        item.monitors.forEach((m: $TSFixMe) => {
            monitorsList.push(m);
        });
    });

    return {
        monitor: state.monitor,
        currentProject: state.project.currentProject,
        formValues:
            state.form.newCreateSlack && state.form.newCreateSlack.values,
        newSlack: state.slackWebhooks.createSlack,
        initialValues: {
            endpoint: '',
            endpointType: '',
            selectAllMonitors: false,
        },
        monitorsList,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(NewCreateSlack);
