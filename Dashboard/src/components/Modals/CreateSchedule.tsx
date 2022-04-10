import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

import { change } from 'redux-form';
import moment from 'moment';

import { reduxForm, Field, formValueSelector } from 'redux-form';

import ClickOutside from 'react-click-outside';
import {
    createScheduledEvent,
    fetchscheduledEvents,
} from '../../actions/scheduledEvent';
import { closeModal } from 'CommonUI/actions/modal';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import { RenderField } from '../basic/RenderField';
import { RenderSelect } from '../basic/RenderSelect';
import { RenderTextArea } from '../basic/RenderTextArea';
import DateTimeSelector from '../basic/DateTimeSelector';
import { ValidateField } from '../../config';
import MultiSelectDropDown from '../basic/MultiSelectDropDown';

function validate(values: $TSFixMe) {
    const errors = {};

    if (!values.name) {

        errors.name = 'Maintenance name is required';
    }
    return errors;
}

interface CreateScheduleProps {
    closeModal: Function;
    handleSubmit: Function;
    createScheduledEvent: Function;
    fetchscheduledEvents: Function;
    createScheduledEventModalId?: string;
    data?: object;
    requesting?: boolean;
    scheduledEventError?: string;
    minStartDate?: string | object;
    monitors?: unknown[];
    formValues?: object;
    change?: Function;
}

class CreateSchedule extends React.Component<CreateScheduleProps> {
    state = {
        currentDate: moment(),
        dateError: null,
        monitorError: null,
        selectedProjects: [],
        selectedComponents: [],
        selectedMonitors: [],
        selectData: [],
    };

    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);

        this.formatData();
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = (values: $TSFixMe) => {
        const {

            createScheduledEvent,

            closeModal,

            createScheduledEventModalId,

            fetchscheduledEvents,

            data,

            monitors,
        } = this.props;
        const projectId = data.projectId;
        const postObj = {};

        if (
            this.state.selectedMonitors &&
            this.state.selectedMonitors.length > 0
        ) {
            const monitors = this.state.selectedMonitors;

            postObj.monitors = monitors;
        } else {

            postObj.monitors = monitors.map((monitor: $TSFixMe) => monitor._id);
        }

        if (
            values.selectMonitor &&
            values.selectMonitor === 'selectAllMonitors'
        ) {
            values.selectAllMonitors = true;
        } else {
            values.selectAllMonitors = false;
        }


        postObj.name = values.name;

        postObj.startDate = moment(values.startDate);

        postObj.endDate = moment(values.endDate);

        postObj.description = values.description;

        postObj.showEventOnStatusPage = values.showEventOnStatusPage;

        postObj.callScheduleOnEvent = values.callScheduleOnEvent;

        postObj.monitorDuringEvent = values.monitorDuringEvent;

        postObj.alertSubscriber = values.alertSubscriber;

        postObj.recurring = values.recurring;

        postObj.interval = values.interval;


        const isDuplicate = postObj.monitors

            ? postObj.monitors.length === new Set(postObj.monitors).size
                ? false
                : true
            : false;

        if (isDuplicate) {
            this.setState({
                monitorError: 'Duplicate monitor selection found',
            });
            return;
        }

        if (

            postObj.monitors &&

            postObj.monitors.length === 0 &&
            !values.selectAllMonitors
        ) {
            this.setState({
                monitorError: 'No monitor was selected',
            });
            return;
        }


        if (postObj.startDate > postObj.endDate) {
            this.setState({
                dateError: 'Start date should always be less than End date',
            });
            return;
        }

        createScheduledEvent(projectId, postObj).then(() => {

            if (!this.props.scheduledEventError) {
                fetchscheduledEvents(projectId, 0, 10);
                closeModal({
                    id: createScheduledEventModalId,
                });
            }
        });
    };

    handleKeyBoard = (e: $TSFixMe) => {
        if (e.target.localName !== 'textarea' && e.key) {
            switch (e.key) {
                case 'Escape':
                    return this.handleCloseModal();
                case 'Enter':

                    return document
                        .getElementById('createScheduledEventButton')
                        .click();
                default:
                    return false;
            }
        }
    };

    handleCloseModal = () => {

        this.props.closeModal({

            id: this.props.createScheduledEventModalId,
        });
    };

    formatData = () => {

        const monitors = this.props.monitors;
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

            this.props.monitors.forEach((monitor: $TSFixMe) => {
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

            this.props.monitors.forEach((monitor: $TSFixMe) => {
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

            this.props.monitors.forEach((monitor: $TSFixMe) => {
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

            this.props.monitors.forEach((monitor: $TSFixMe) => {
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
            currentDate,
            selectedProjects,
            selectedComponents,
            selectedMonitors,
            selectData,
        } = this.state;

        const { formValues } = this.props;
        const {

            requesting,

            scheduledEventError,

            closeModal,

            handleSubmit,
        } = this.props;

        let { minStartDate } = this.props;
        if (!minStartDate) {
            minStartDate = currentDate;
        }

        return (
            <div
                className="ModalLayer-contents"

                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM">
                    <div className="bs-Modal" style={{ width: 600 }}>
                        <ClickOutside
                            onClickOutside={(e: $TSFixMe) => {
                                if (e.target.className === 'bs-BIM') {
                                    this.handleCloseModal();
                                }
                            }}
                        >
                            <div className="bs-Modal-header">
                                <div
                                    className="bs-Modal-header-copy"
                                    style={{
                                        marginBottom: '10px',
                                        marginTop: '10px',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                    }}
                                >
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>
                                            Create Scheduled Maintenance Event
                                        </span>
                                    </span>
                                    <div
                                        className="bs-Fieldset-row"
                                        style={{
                                            padding: 0,
                                            display: 'flex',
                                            alignItems: 'center',
                                        }}
                                    >
                                        <label style={{ marginRight: 10 }}>
                                            Advanced Options
                                        </label>
                                        <div>
                                            <label className="Toggler-wrap">
                                                <input
                                                    className="btn-toggler"
                                                    type="checkbox"
                                                    onChange={() => {

                                                        this.props.change(
                                                            'showAdvance',
                                                            !formValues.showAdvance
                                                        );
                                                    }}
                                                    name="moreAdvancedOptions"
                                                    id="moreAdvancedOptions"
                                                    checked={
                                                        formValues &&
                                                        formValues.showAdvance
                                                    }
                                                />
                                                <span className="TogglerBtn-slider round"></span>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <form
                                id="scheduledEventForm"
                                onSubmit={handleSubmit(this.submitForm)}
                            >
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
                                                    >
                                                        <span>
                                                            Maintenance Name
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
                                                                name="name"
                                                                placeholder="Maintenance Name"
                                                                id="name"
                                                                className="bs-TextInput"
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
                                                        <span>Monitors</span>
                                                    </label>
                                                    <div
                                                        style={{
                                                            padding: 0,
                                                            width: '100%',
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
                                        <fieldset className="Margin-bottom--16">
                                            <div className="bs-Fieldset-rows">
                                                <div
                                                    className="bs-Fieldset-row"
                                                    style={{ padding: 0 }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label Text-align--left"
                                                        htmlFor="monitorIds"
                                                    >
                                                        <span>
                                                            Maintenance
                                                            Description
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
                                                                className="bs-TextArea"
                                                                component={
                                                                    RenderTextArea
                                                                }
                                                                type="text"
                                                                name="description"
                                                                rows="5"
                                                                id="description"
                                                                placeholder="Maintenance Description"
                                                                style={{
                                                                    width:
                                                                        '100%',
                                                                    resize:
                                                                        'none',
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
                                                    style={{ padding: 0 }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label Text-align--left"
                                                        htmlFor="monitorIds"
                                                    >
                                                        <span>
                                                            Start date and time
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
                                                                className="bs-TextInput"
                                                                type="text"
                                                                name="startDate"
                                                                component={
                                                                    DateTimeSelector
                                                                }
                                                                placeholder="10pm"
                                                                style={{
                                                                    width:
                                                                        '100%',
                                                                    minWidth:
                                                                        '250px',
                                                                }}
                                                                minDate={
                                                                    currentDate
                                                                }
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
                                                        htmlFor="monitorIds"
                                                    >
                                                        <span>
                                                            End date and time
                                                        </span>
                                                    </label>
                                                    <div
                                                        className="bs-Fieldset-fields"
                                                        style={{
                                                            width: '100%',
                                                        }}
                                                    >
                                                        <Field
                                                            className="db-BusinessSettings-input TextInput bs-TextInput"
                                                            type="text"
                                                            name="endDate"
                                                            component={
                                                                DateTimeSelector
                                                            }
                                                            placeholder="10pm"
                                                            style={{
                                                                width: '100%',
                                                                minWidth:
                                                                    '250px',
                                                            }}
                                                            minDate={moment(
                                                                minStartDate
                                                            )}
                                                        />
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
                                                        htmlFor="monitorIds"
                                                    ></label>
                                                    <div className="bs-Fieldset-fields">
                                                        <ShouldRender
                                                            if={
                                                                this.state
                                                                    .dateError
                                                            }
                                                        >
                                                            <div className="bs-Tail-copy">
                                                                <div
                                                                    className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                                    style={{
                                                                        marginTop:
                                                                            '10px',
                                                                    }}
                                                                >
                                                                    <div className="Box-root Margin-right--8">
                                                                        <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                                    </div>
                                                                    <div className="Box-root">
                                                                        <span
                                                                            style={{
                                                                                color:
                                                                                    'red',
                                                                            }}
                                                                            id="dateError"
                                                                        >
                                                                            {
                                                                                this
                                                                                    .state
                                                                                    .dateError
                                                                            }
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </ShouldRender>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>
                                        <div className="bs-Fieldset-row">
                                            <label className="bs-Fieldset-label">
                                                <span></span>
                                            </label>
                                            <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                <div
                                                    className="Box-root"
                                                    style={{
                                                        height: '5px',
                                                    }}
                                                ></div>
                                                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                    <label
                                                        className="Checkbox"
                                                        htmlFor="showEventOnStatusPage"
                                                    >
                                                        <Field
                                                            component="input"
                                                            type="checkbox"
                                                            name="showEventOnStatusPage"
                                                            className="Checkbox-source"
                                                            id="showEventOnStatusPage"
                                                        />
                                                        <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                            <div className="Checkbox-target Box-root">
                                                                <div className="Checkbox-color Box-root"></div>
                                                            </div>
                                                        </div>
                                                        <div className="Checkbox-label Box-root Margin-left--8">
                                                            <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                <span>
                                                                    Show this
                                                                    Maintenance
                                                                    Event on
                                                                    Status Page
                                                                </span>
                                                            </span>
                                                        </div>
                                                    </label>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="bs-Fieldset-row">
                                            <label className="bs-Fieldset-label">
                                                <span></span>
                                            </label>
                                            <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                <div
                                                    className="Box-root"
                                                    style={{
                                                        height: '5px',
                                                    }}
                                                ></div>
                                                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                    <label
                                                        className="Checkbox"
                                                        htmlFor="callScheduleOnEvent"
                                                    >
                                                        <Field
                                                            component="input"
                                                            type="checkbox"
                                                            name="callScheduleOnEvent"
                                                            className="Checkbox-source"
                                                            id="callScheduleOnEvent"
                                                        />
                                                        <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                            <div className="Checkbox-target Box-root">
                                                                <div className="Checkbox-color Box-root"></div>
                                                            </div>
                                                        </div>
                                                        <div className="Checkbox-label Box-root Margin-left--8">
                                                            <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                <span>
                                                                    Alert your
                                                                    team members
                                                                    who are on
                                                                    call when
                                                                    this
                                                                    Maintenance
                                                                    Event starts
                                                                </span>
                                                            </span>
                                                        </div>
                                                    </label>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="bs-Fieldset-row">
                                            <label className="bs-Fieldset-label">
                                                <span></span>
                                            </label>
                                            <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                <div
                                                    className="Box-root"
                                                    style={{
                                                        height: '5px',
                                                    }}
                                                ></div>
                                                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                    <label
                                                        className="Checkbox"
                                                        htmlFor="alertSubscriber"
                                                    >
                                                        <Field
                                                            component="input"
                                                            type="checkbox"
                                                            name="alertSubscriber"
                                                            className="Checkbox-source"
                                                            id="alertSubscriber"
                                                        />
                                                        <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                            <div className="Checkbox-target Box-root">
                                                                <div className="Checkbox-color Box-root"></div>
                                                            </div>
                                                        </div>
                                                        <div className="Checkbox-label Box-root Margin-left--8">
                                                            <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                <span>
                                                                    Alert
                                                                    subscribers
                                                                    about this
                                                                    Scheduled
                                                                    Maintenance
                                                                    Event
                                                                </span>
                                                            </span>
                                                        </div>
                                                    </label>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="bs-Fieldset-row">
                                            <label className="bs-Fieldset-label">
                                                <span></span>
                                            </label>
                                            <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                <div
                                                    className="Box-root"
                                                    style={{
                                                        height: '5px',
                                                    }}
                                                ></div>
                                                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                    <label
                                                        className="Checkbox"
                                                        htmlFor="monitorDuringEvent"
                                                    >
                                                        <Field
                                                            component="input"
                                                            type="checkbox"
                                                            name="monitorDuringEvent"
                                                            className="Checkbox-source"
                                                            id="monitorDuringEvent"
                                                        />
                                                        <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                            <div className="Checkbox-target Box-root">
                                                                <div className="Checkbox-color Box-root"></div>
                                                            </div>
                                                        </div>
                                                        <div className="Checkbox-label Box-root Margin-left--8">
                                                            <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                <span>
                                                                    Monitor this
                                                                    monitor
                                                                    during
                                                                    Maintenance
                                                                    Event
                                                                </span>
                                                            </span>
                                                        </div>
                                                    </label>
                                                </div>
                                            </div>
                                        </div>
                                        {formValues &&
                                            formValues.showAdvance ? (
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">
                                                    <span></span>
                                                </label>
                                                <div className="bs-Fieldset-fields bs-Fieldset-fields--wide">
                                                    <div
                                                        className="Box-root"
                                                        style={{
                                                            height: '5px',
                                                        }}
                                                    ></div>
                                                    <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStart">
                                                        <label
                                                            className="Checkbox"
                                                            htmlFor="recurring"
                                                        >
                                                            <Field
                                                                component="input"
                                                                type="checkbox"
                                                                name="recurring"
                                                                className="Checkbox-source"
                                                                id="recurring"
                                                            />
                                                            <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                                <div className="Checkbox-target Box-root">
                                                                    <div className="Checkbox-color Box-root"></div>
                                                                </div>
                                                            </div>
                                                            <div className="Checkbox-label Box-root Margin-left--8">
                                                                <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                    <span>
                                                                        Set as a
                                                                        recuring
                                                                        event
                                                                    </span>
                                                                </span>
                                                            </div>
                                                        </label>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : null}
                                        {formValues && formValues.recurring ? (
                                            <fieldset className="Margin-bottom--16">
                                                <div className="bs-Fieldset-rows">
                                                    <div
                                                        className="bs-Fieldset-row"
                                                        style={{ padding: 0 }}
                                                    >
                                                        <label
                                                            className="bs-Fieldset-label Text-align--left"
                                                            htmlFor="monitorIds"
                                                        >
                                                            <span>
                                                                Recurring
                                                                interval
                                                            </span>
                                                        </label>
                                                        <div className="bs-Fieldset-fields">
                                                            <Field
                                                                className="db-select-nw"
                                                                component={
                                                                    RenderSelect
                                                                }
                                                                name="interval"
                                                                id="interval"
                                                                validate={
                                                                    ValidateField.select
                                                                }
                                                                style={{
                                                                    height:
                                                                        '28px',
                                                                    width:
                                                                        '100%',
                                                                }}
                                                                options={[
                                                                    {
                                                                        value:
                                                                            '',
                                                                        label:
                                                                            'Select interval',
                                                                    },
                                                                    {
                                                                        value:
                                                                            'daily',
                                                                        label:
                                                                            'Daily',
                                                                    },
                                                                    {
                                                                        value:
                                                                            'weekly',
                                                                        label:
                                                                            'Weekly',
                                                                    },
                                                                    {
                                                                        value:
                                                                            'monthly',
                                                                        label:
                                                                            'Monthly',
                                                                    },
                                                                ]}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </fieldset>
                                        ) : null}
                                    </div>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <ShouldRender if={scheduledEventError}>
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
                                                                scheduledEventError
                                                            }
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                        <ShouldRender
                                            if={this.state.monitorError}
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
                                                                this.state
                                                                    .monitorError
                                                            }
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                        <button
                                            className="bs-Button bs-DeprecatedButton btn__modal"
                                            type="button"
                                            onClick={() =>
                                                closeModal({
                                                    id: this.props

                                                        .createScheduledEventModalId,
                                                })
                                            }
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="createScheduledEventButton"
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                            disabled={requesting}
                                            type="submit"
                                        >
                                            {!requesting && (
                                                <>
                                                    <span>Create</span>
                                                    <span className="create-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </>
                                            )}
                                            {requesting && <FormLoader />}
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


CreateSchedule.displayName = 'CreateSchedule';


CreateSchedule.propTypes = {
    closeModal: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    createScheduledEvent: PropTypes.func.isRequired,
    fetchscheduledEvents: PropTypes.func.isRequired,
    createScheduledEventModalId: PropTypes.string,
    data: PropTypes.object,
    requesting: PropTypes.bool,
    scheduledEventError: PropTypes.string,
    minStartDate: PropTypes.oneOfType([PropTypes.string, PropTypes.object]),
    monitors: PropTypes.array,
    formValues: PropTypes.object,
    change: PropTypes.func,
};

const NewCreateSchedule = reduxForm({
    form: 'newCreateSchedule',
    enableReinitialize: false,
    validate,
    destroyOnUnmount: true,
})(CreateSchedule);

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    {
        createScheduledEvent,
        fetchscheduledEvents,
        closeModal,
        change,
    },
    dispatch
);

const selector = formValueSelector('newCreateSchedule');

const mapStateToProps = (state: RootState) => {
    const minStartDate = selector(state, 'startDate');
    const currentDate = moment().format();

    const monitors: $TSFixMe = [];
    state.monitor.monitorsList.monitors.forEach((monitorObj: $TSFixMe) => {
        monitorObj.monitors.forEach((monitor: $TSFixMe) => monitors.push(monitor));
    });

    return {
        newScheduledEvent: state.scheduledEvent.newScheduledEvent,
        requesting: state.scheduledEvent.currentScheduledEvent.requesting,
        scheduledEventError: state.scheduledEvent.currentScheduledEvent.error,
        createScheduledEventModalId: state.modal.modals[0].id,
        minStartDate,
        monitors,
        initialValues: {
            monitorDuringEvent: false,
            alertSubscriber: true,
            callScheduleOnEvent: true,
            showEventOnStatusPage: true,
            selectAllMonitors: true,
            startDate: currentDate,
            endDate: currentDate,
            showAdvance: false,
            recurring: false,
            selectMonitor: 'selectAllMonitors',
        },
        formValues:
            state.form.newCreateSchedule && state.form.newCreateSchedule.values,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(NewCreateSchedule);
