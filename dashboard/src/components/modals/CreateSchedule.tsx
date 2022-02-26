import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { change } from 'redux-form';
import moment from 'moment';
import 'imrc-datetime-picker/dist/imrc-datetime-picker.css';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'redu... Remove this comment to see the full error message
import { reduxForm, Field, formValueSelector } from 'redux-form';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import {
    createScheduledEvent,
    fetchscheduledEvents,
} from '../../actions/scheduledEvent';
import { closeModal } from '../../actions/modal';
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type '{}'.
        errors.name = 'Maintenance name is required';
    }
    return errors;
}

class CreateSchedule extends React.Component {
    state = {
        currentDate: moment(),
        dateError: null,
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createScheduledEvent' does not exist on ... Remove this comment to see the full error message
            createScheduledEvent,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
            closeModal,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createScheduledEventModalId' does not ex... Remove this comment to see the full error message
            createScheduledEventModalId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchscheduledEvents' does not exist on ... Remove this comment to see the full error message
            fetchscheduledEvents,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            data,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'Readon... Remove this comment to see the full error message
            monitors,
        } = this.props;
        const projectId = data.projectId;
        const postObj = {};

        if (
            this.state.selectedMonitors &&
            this.state.selectedMonitors.length > 0
        ) {
            const monitors = this.state.selectedMonitors;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type '{}'.
            postObj.monitors = monitors;
        } else {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type '{}'.
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

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type '{}'.
        postObj.name = values.name;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'startDate' does not exist on type '{}'.
        postObj.startDate = moment(values.startDate);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'endDate' does not exist on type '{}'.
        postObj.endDate = moment(values.endDate);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'description' does not exist on type '{}'... Remove this comment to see the full error message
        postObj.description = values.description;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'showEventOnStatusPage' does not exist on... Remove this comment to see the full error message
        postObj.showEventOnStatusPage = values.showEventOnStatusPage;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'callScheduleOnEvent' does not exist on t... Remove this comment to see the full error message
        postObj.callScheduleOnEvent = values.callScheduleOnEvent;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorDuringEvent' does not exist on ty... Remove this comment to see the full error message
        postObj.monitorDuringEvent = values.monitorDuringEvent;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'alertSubscriber' does not exist on type ... Remove this comment to see the full error message
        postObj.alertSubscriber = values.alertSubscriber;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'recurring' does not exist on type '{}'.
        postObj.recurring = values.recurring;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'interval' does not exist on type '{}'.
        postObj.interval = values.interval;

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
            return;
        }

        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type '{}'.
            postObj.monitors &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type '{}'.
            postObj.monitors.length === 0 &&
            !values.selectAllMonitors
        ) {
            this.setState({
                monitorError: 'No monitor was selected',
            });
            return;
        }

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'startDate' does not exist on type '{}'.
        if (postObj.startDate > postObj.endDate) {
            this.setState({
                dateError: 'Start date should always be less than End date',
            });
            return;
        }

        createScheduledEvent(projectId, postObj).then(() => {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'scheduledEventError' does not exist on t... Remove this comment to see the full error message
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
                    // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                    return document
                        .getElementById('createScheduledEventButton')
                        .click();
                default:
                    return false;
            }
        }
    };

    handleCloseModal = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
        this.props.closeModal({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createScheduledEventModalId' does not ex... Remove this comment to see the full error message
            id: this.props.createScheduledEventModalId,
        });
    };

    formatData = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'Readon... Remove this comment to see the full error message
        const monitors = this.props.monitors;
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'Readon... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'Readon... Remove this comment to see the full error message
            this.props.monitors.forEach((monitor: $TSFixMe) => {
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'Readon... Remove this comment to see the full error message
            this.props.monitors.forEach((monitor: $TSFixMe) => {
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type 'Readon... Remove this comment to see the full error message
            this.props.monitors.forEach((monitor: $TSFixMe) => {
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

    render() {
        const {
            currentDate,
            selectedProjects,
            selectedComponents,
            selectedMonitors,
            selectData,
        } = this.state;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'formValues' does not exist on type 'Read... Remove this comment to see the full error message
        const { formValues } = this.props;
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'requesting' does not exist on type 'Read... Remove this comment to see the full error message
            requesting,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'scheduledEventError' does not exist on t... Remove this comment to see the full error message
            scheduledEventError,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
            closeModal,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'handleSubmit' does not exist on type 'Re... Remove this comment to see the full error message
            handleSubmit,
        } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'minStartDate' does not exist on type 'Re... Remove this comment to see the full error message
        let { minStartDate } = this.props;
        if (!minStartDate) {
            minStartDate = currentDate;
        }

        return (
            <div
                className="ModalLayer-contents"
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
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
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'change' does not exist on type 'Readonly... Remove this comment to see the full error message
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
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'createScheduledEventModalId' does not ex... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
CreateSchedule.displayName = 'CreateSchedule';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        createScheduledEvent,
        fetchscheduledEvents,
        closeModal,
        change,
    },
    dispatch
);

const selector = formValueSelector('newCreateSchedule');

const mapStateToProps = (state: $TSFixMe) => {
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
