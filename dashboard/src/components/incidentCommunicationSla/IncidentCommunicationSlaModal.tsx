import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

import { reduxForm, Field } from 'redux-form';

import ClickOutside from 'react-click-outside';
import {
    createCommunicationSla,
    fetchCommunicationSlas,
} from '../../actions/incidentCommunicationSla';
import { closeModal } from 'common-ui/actions/modal';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import { RenderField } from '../basic/RenderField';
import { RenderSelect } from '../basic/RenderSelect';
import MultiSelectDropDown from '../basic/MultiSelectDropDown';
import { fetchMonitors } from '../../actions/monitor';

function validate(values: $TSFixMe) {
    const errors = {};

    if (!values.name || !values.name.trim()) {

        errors.name = 'Communication SLA name is required';
    }
    if (values.customDuration && isNaN(values.customDuration)) {

        errors.customDuration = 'Only numeric values are allowed';
    }
    if (
        values.alertTime &&
        values.alertTime.trim() &&
        isNaN(values.alertTime)
    ) {

        errors.alertTime = 'Only numeric values are allowed';
    }
    if (
        Number(values.alertTime) >= Number(values.customDuration) ||
        Number(values.alertTime) >= Number(values.durationOption)
    ) {

        errors.alertTime = 'Alert time should be less than duration';
    }
    return errors;
}

interface IncidentCommunicationSlaModalProps {
    closeModal: Function;
    handleSubmit: Function;
    data?: object;
    requesting?: boolean;
    slaError?: string;
    createCommunicationSla?: Function;
    fetchCommunicationSlas?: Function;
    createIncidentSlaModalId?: string;
    formValues?: object;
    monitorsList?: unknown[];
    fetchMonitors?: Function;
}

class IncidentCommunicationSlaModal extends React.Component<IncidentCommunicationSlaModalProps> {
    state = {
        setCustom: false,
        durationHelpTextTime: '60',
        customDurationTime: 'X',
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

            closeModal,

            createIncidentSlaModalId,

            createCommunicationSla,

            fetchCommunicationSlas,

            data,

            fetchMonitors,
        } = this.props;
        const { setCustom } = this.state;
        const projectId = data.projectId;
        const postObj = {};

        if (
            this.state.selectedMonitors &&
            this.state.selectedMonitors.length > 0
        ) {

            postObj.monitors = this.state.selectedMonitors;
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
            return;
        }


        postObj.name = values.name;

        postObj.isDefault = values.isDefault;

        postObj.alertTime = values.alertTime;

        if (setCustom) {

            postObj.duration = values.customDuration;
        } else {

            postObj.duration = values.durationOption;
        }

        createCommunicationSla(projectId, postObj).then(() => {

            if (!this.props.slaError) {
                fetchMonitors(projectId);
                fetchCommunicationSlas(projectId, 0, 10);
                closeModal({
                    id: createIncidentSlaModalId,
                });
            }
        });
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                return this.handleCloseModal();
            case 'Enter':

                return document.getElementById('createSlaBtn').click();
            default:
                return false;
        }
    };

    handleCloseModal = () => {

        this.props.closeModal({

            id: this.props.createIncidentSlaModalId,
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

    render() {
        const {

            requesting,

            slaError,

            closeModal,

            handleSubmit,

            createIncidentSlaModalId,

            formValues,
        } = this.props;
        const { setCustom } = this.state;

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
                    <div className="bs-Modal" style={{ width: 600 }}>
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
                                            Add Incident Communication SLA
                                        </span>
                                    </span>
                                    <br />
                                    <br />
                                    <span>
                                        Incident communication SLA is used to
                                        make sure you keep you customers updated
                                        every few minutes on an active incident.
                                        Your team will get an email reminder
                                        when you forget to update an incident
                                        status, this will help you to
                                        communicate with your customers on time
                                        and keep them updated.
                                    </span>
                                </div>
                            </div>
                            <form
                                id="communicationSlaForm"
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
                                                        htmlFor="name"
                                                    >
                                                        <span>SLA Name</span>
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
                                                                placeholder="SLA name"
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
                                        {formValues && !formValues.isDefault && (
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
                                        )}
                                        <fieldset className="Margin-bottom--16">
                                            <div className="bs-Fieldset-rows">
                                                <div
                                                    className="bs-Fieldset-row"
                                                    style={{ padding: 0 }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label Text-align--left"
                                                        htmlFor={
                                                            setCustom
                                                                ? 'customDuration'
                                                                : 'durationOption'
                                                        }
                                                    >
                                                        <span>
                                                            Duration{' '}
                                                            {this.state
                                                                .setCustom
                                                                ? '(minutes)'
                                                                : ''}
                                                        </span>
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <div
                                                            className="bs-Fieldset-field"
                                                            style={{
                                                                width: '100%',
                                                            }}
                                                        >
                                                            {setCustom && (
                                                                <Field
                                                                    component={
                                                                        RenderField
                                                                    }
                                                                    name="customDuration"
                                                                    placeholder="60"
                                                                    id="customDuration"
                                                                    className="bs-TextInput"
                                                                    style={{
                                                                        width:
                                                                            '100%',
                                                                        padding:
                                                                            '3px 5px',
                                                                    }}
                                                                    onChange={(
                                                                        event: $TSFixMe,
                                                                        value: $TSFixMe
                                                                    ) => {
                                                                        value
                                                                            ? this.setState(
                                                                                {
                                                                                    customDurationTime: value,
                                                                                }
                                                                            )
                                                                            : this.setState(
                                                                                {
                                                                                    customDurationTime:
                                                                                        'X',
                                                                                }
                                                                            );
                                                                    }}
                                                                />
                                                            )}
                                                            {!setCustom && (
                                                                <Field
                                                                    className="db-select-nw Table-cell--width--maximized"
                                                                    name="durationOption"
                                                                    id="durationOption"
                                                                    style={{
                                                                        width:
                                                                            '100%',
                                                                        height: 28,
                                                                    }}
                                                                    component={
                                                                        RenderSelect
                                                                    }
                                                                    options={[
                                                                        {
                                                                            value:
                                                                                '15',
                                                                            label:
                                                                                '15 minutes',
                                                                        },
                                                                        {
                                                                            value:
                                                                                '30',
                                                                            label:
                                                                                '30 minutes',
                                                                        },
                                                                        {
                                                                            value:
                                                                                '60',
                                                                            label:
                                                                                '1 hour',
                                                                        },
                                                                        {
                                                                            value:
                                                                                'custom',
                                                                            label:
                                                                                'Custom',
                                                                        },
                                                                    ]}
                                                                    onChange={(
                                                                        event: $TSFixMe,
                                                                        value: $TSFixMe
                                                                    ) => {
                                                                        value ===
                                                                            'custom' &&
                                                                            this.setState(
                                                                                {
                                                                                    setCustom: true,
                                                                                }
                                                                            );
                                                                        value !==
                                                                            'custom' &&
                                                                            this.setState(
                                                                                {
                                                                                    durationHelpTextTime: value,
                                                                                }
                                                                            );
                                                                    }}
                                                                />
                                                            )}
                                                        </div>
                                                        <p className="bs-Fieldset-explanation">
                                                            {!setCustom ? (
                                                                <span>
                                                                    Make an SLA
                                                                    policy to
                                                                    update an
                                                                    incident
                                                                    status every{' '}
                                                                    {this.state
                                                                        .durationHelpTextTime ===
                                                                        '60'
                                                                        ? '1'
                                                                        : this
                                                                            .state
                                                                            .durationHelpTextTime}{' '}
                                                                    {this.state
                                                                        .durationHelpTextTime ===
                                                                        '60'
                                                                        ? 'hour'
                                                                        : 'minutes.'}
                                                                </span>
                                                            ) : (
                                                                <span>
                                                                    Make an SLA
                                                                    policy to
                                                                    update an
                                                                    incident
                                                                    status every{' '}
                                                                    {
                                                                        this
                                                                            .state
                                                                            .customDurationTime
                                                                    }{' '}
                                                                    {'minutes.'}
                                                                </span>
                                                            )}
                                                        </p>
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
                                                        htmlFor="alertTime"
                                                    >
                                                        <span>
                                                            Alert Team before
                                                            SLA is breached.
                                                        </span>
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <div
                                                            className="bs-Fieldset-field"
                                                            style={{
                                                                width: '100%',
                                                                flexDirection:
                                                                    'column',
                                                            }}
                                                        >
                                                            <Field
                                                                component={
                                                                    RenderField
                                                                }
                                                                name="alertTime"
                                                                placeholder="60"
                                                                id="alertTime"
                                                                className="bs-TextInput"
                                                                style={{
                                                                    width:
                                                                        '100%',
                                                                    padding:
                                                                        '3px 5px',
                                                                }}
                                                                required={true}
                                                            />
                                                            <p className="bs-Fieldset-explanation">
                                                                <span>
                                                                    Alert X
                                                                    minutes
                                                                    before SLA
                                                                    is breached.
                                                                </span>
                                                            </p>
                                                        </div>
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
                                                        htmlFor="isDefault"
                                                    >
                                                        <Field
                                                            component="input"
                                                            type="checkbox"
                                                            name="isDefault"
                                                            className="Checkbox-source"
                                                            id="isDefault"
                                                        />
                                                        <div className="Checkbox-box Box-root Margin-top--2 Margin-right--2">
                                                            <div className="Checkbox-target Box-root">
                                                                <div className="Checkbox-color Box-root"></div>
                                                            </div>
                                                        </div>
                                                        <div className="Checkbox-label Box-root Margin-left--8">
                                                            <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                <span>
                                                                    Set as
                                                                    Default
                                                                </span>
                                                            </span>
                                                        </div>
                                                    </label>
                                                    <p className="bs-Fieldset-explanation">
                                                        <span>
                                                            When an SLA is set
                                                            to default, it is
                                                            applied to all the
                                                            incidents in all the
                                                            monitors in a
                                                            project.
                                                        </span>
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <ShouldRender if={slaError}>
                                            <div
                                                className="bs-Tail-copy"
                                                style={{ width: 200 }}
                                                id="slaError"
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
                                                            {slaError}
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
                                                    id: createIncidentSlaModalId,
                                                })
                                            }
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="createSlaBtn"
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


IncidentCommunicationSlaModal.displayName = 'IncidentCommunicationSlaModal';


IncidentCommunicationSlaModal.propTypes = {
    closeModal: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    data: PropTypes.object,
    requesting: PropTypes.bool,
    slaError: PropTypes.string,
    createCommunicationSla: PropTypes.func,
    fetchCommunicationSlas: PropTypes.func,
    createIncidentSlaModalId: PropTypes.string,
    formValues: PropTypes.object,
    monitorsList: PropTypes.array,
    fetchMonitors: PropTypes.func,
};

const IncidentSlaForm = reduxForm({
    form: 'incidentSlaForm',
    enableReinitialize: false,
    validate,
    destroyOnUnmount: true,
})(IncidentCommunicationSlaModal);

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators(
    {
        closeModal,
        createCommunicationSla,
        fetchCommunicationSlas,
        fetchMonitors,
    },
    dispatch
);

const mapStateToProps = (state: $TSFixMe, ownProps: $TSFixMe) => {
    const monitorData = state.monitor.monitorsList.monitors.find(
        (data: $TSFixMe) => String(data._id) === String(ownProps.data.projectId)
    );
    const monitors = monitorData ? monitorData.monitors : [];

    return {
        createIncidentSlaModalId: state.modal.modals[0].id,
        initialValues: {
            durationOption: '60',
        },
        formValues:
            state.form.incidentSlaForm && state.form.incidentSlaForm.values,
        requesting: state.incidentSla.incidentCommunicationSla.requesting,
        slaError: state.incidentSla.incidentCommunicationSla.error,
        monitorsList: monitors,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(IncidentSlaForm);
