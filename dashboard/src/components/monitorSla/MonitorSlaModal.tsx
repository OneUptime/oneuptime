import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { reduxForm, Field } from 'redux-form';
import ClickOutside from 'react-click-outside';
import { createMonitorSla, fetchMonitorSlas } from '../../actions/monitorSla';
import { fetchMonitors } from '../../actions/monitor';
import { closeModal } from '../../actions/modal';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';
import { RenderField } from '../basic/RenderField';
import { RenderSelect } from '../basic/RenderSelect';
import MultiSelectDropDown from '../basic/MultiSelectDropDown';

function validate(values) {
    const errors = {};

    if (!values.name || !values.name.trim()) {
        errors.name = 'Monitor SLA name is required';
    }
    if (values.customFrequency && isNaN(values.customFrequency)) {
        errors.customFrequency = 'Only numeric values are allowed';
    }
    if (values.customFrequency && Number(values.customFrequency) < 1) {
        errors.customFrequency = 'You need atleast a single day';
    }
    if (values.customMonitorUptime && isNaN(values.customMonitorUptime)) {
        errors.customMonitorUptime = 'Only numeric values are allowed';
    }
    if (
        values.customMonitorUptime &&
        Number(values.customMonitorUptime) > 100
    ) {
        errors.customMonitorUptime = 'Uptime greater than 100 is not allowed';
    }
    if (values.customMonitorUptime && Number(values.customMonitorUptime) < 1) {
        errors.customMonitorUptime = 'Uptime less than 1 is not allowed';
    }
    return errors;
}

class MonitorSlaModal extends React.Component {
    state = {
        setCustomFrequency: false,
        setCustomMonitorUptime: false,
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

    submitForm = values => {
        const {
            closeModal,
            createMonitorSlaModalId,
            createMonitorSla,
            fetchMonitorSlas,
            fetchMonitors,
            data,
        } = this.props;
        const { setCustomFrequency, setCustomMonitorUptime } = this.state;
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

        if (setCustomFrequency) {
            postObj.frequency = values.customFrequency;
        } else {
            postObj.frequency = values.frequencyOption;
        }

        if (setCustomMonitorUptime) {
            postObj.monitorUptime = values.customMonitorUptime;
        } else {
            postObj.monitorUptime = values.monitorUptimeOption;
        }

        createMonitorSla(projectId, postObj).then(() => {
            if (!this.props.slaError) {
                fetchMonitors(projectId);
                fetchMonitorSlas(projectId, 0, 10);
                closeModal({
                    id: createMonitorSlaModalId,
                });
            }
        });
    };

    handleKeyBoard = e => {
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
            id: this.props.createMonitorSlaModalId,
        });
    };

    formatData = () => {
        const monitors = this.props.monitorsList;
        const hash = {};

        monitors.forEach(monitor => {
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
                    components: hash[projectId].components.map(componentObj => {
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

    updateState = (value, key) => {
        this.setState(prevState => {
            let currentValue = prevState[key];

            if (currentValue.includes(value)) {
                currentValue = currentValue.filter(val => val !== value);
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

    updateMultipleState = (id, key, databank) => {
        if (key === 'selectedProjects' && databank.includes(id)) {
            const monitorIds = [];
            const componentIds = [];
            this.props.monitorsList.forEach(monitor => {
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
            const monitorIds = [];
            const componentIds = [];
            this.props.monitorsList.forEach(monitor => {
                if ((monitor.projectId._id || monitor.projectId) === id) {
                    monitorIds.push(monitor._id);
                    componentIds.push(
                        monitor.componentId._id || monitor.componentId
                    );
                }
            });

            return this.setState(prevState => ({
                selectedMonitors: prevState.selectedMonitors.filter(
                    monitorId => !monitorIds.includes(monitorId)
                ),
                selectedComponents: prevState.selectedComponents.filter(
                    componentId => !componentIds.includes(componentId)
                ),
            }));
        }

        if (key === 'selectedComponents' && databank.includes(id)) {
            const monitorIds = [];
            this.props.monitorsList.forEach(monitor => {
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
            const monitorIds = [];
            this.props.monitorsList.forEach(monitor => {
                if ((monitor.componentId._id || monitor.componentId) === id) {
                    monitorIds.push(monitor._id);
                }
            });

            return this.setState(prevState => ({
                selectedMonitors: prevState.selectedMonitors.filter(
                    monitorId => !monitorIds.includes(monitorId)
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
            createMonitorSlaModalId,
            formValues,
        } = this.props;
        const { setCustomFrequency, setCustomMonitorUptime } = this.state;

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
                                        <span>Add Monitor SLA</span>
                                    </span>
                                    <br />
                                    <br />
                                    <span>
                                        SLA is used to make sure your monitors
                                        provide a certain reliability of
                                        service.
                                    </span>
                                </div>
                            </div>
                            <form
                                id="monitorSlaForm"
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
                                                            setCustomFrequency
                                                                ? 'customFrequency'
                                                                : 'frequencyOption'
                                                        }
                                                    >
                                                        <span>
                                                            Frequency{' '}
                                                            {setCustomFrequency &&
                                                                `(days)`}
                                                        </span>
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <div
                                                            className="bs-Fieldset-field"
                                                            style={{
                                                                width: '100%',
                                                            }}
                                                        >
                                                            {setCustomFrequency && (
                                                                <Field
                                                                    component={
                                                                        RenderField
                                                                    }
                                                                    name="customFrequency"
                                                                    placeholder="30"
                                                                    id="customFrequency"
                                                                    className="bs-TextInput"
                                                                    style={{
                                                                        width:
                                                                            '100%',
                                                                        padding:
                                                                            '3px 5px',
                                                                    }}
                                                                />
                                                            )}
                                                            {!setCustomFrequency && (
                                                                <Field
                                                                    className="db-select-nw Table-cell--width--maximized"
                                                                    name="frequencyOption"
                                                                    id="frequencyOption"
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
                                                                                '30',
                                                                            label:
                                                                                'Every month',
                                                                        },
                                                                        {
                                                                            value:
                                                                                '90',
                                                                            label:
                                                                                'Every 3 months',
                                                                        },
                                                                        {
                                                                            value:
                                                                                '180',
                                                                            label:
                                                                                'Every 6 months',
                                                                        },
                                                                        {
                                                                            value:
                                                                                '365',
                                                                            label:
                                                                                'Every year',
                                                                        },
                                                                        {
                                                                            value:
                                                                                'custom',
                                                                            label:
                                                                                'Custom',
                                                                        },
                                                                    ]}
                                                                    onChange={(
                                                                        event,
                                                                        value
                                                                    ) => {
                                                                        value ===
                                                                            'custom' &&
                                                                            this.setState(
                                                                                {
                                                                                    setCustomFrequency: true,
                                                                                }
                                                                            );
                                                                    }}
                                                                />
                                                            )}
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
                                                        htmlFor={
                                                            setCustomFrequency
                                                                ? 'customMonitorUptime'
                                                                : 'monitorUptimeOption'
                                                        }
                                                    >
                                                        <span>
                                                            Monitor Uptime{' '}
                                                            {setCustomMonitorUptime &&
                                                                `(%)`}
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
                                                            {setCustomMonitorUptime && (
                                                                <Field
                                                                    component={
                                                                        RenderField
                                                                    }
                                                                    name="customMonitorUptime"
                                                                    placeholder="99.95"
                                                                    id="customMonitorUptime"
                                                                    className="bs-TextInput"
                                                                    style={{
                                                                        width:
                                                                            '100%',
                                                                        padding:
                                                                            '3px 5px',
                                                                    }}
                                                                />
                                                            )}
                                                            {!setCustomMonitorUptime && (
                                                                <Field
                                                                    className="db-select-nw Table-cell--width--maximized"
                                                                    name="monitorUptimeOption"
                                                                    id="monitorUptimeOption"
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
                                                                                '',
                                                                            label:
                                                                                'Select monitor uptime',
                                                                        },
                                                                        {
                                                                            value:
                                                                                '99.90',
                                                                            label:
                                                                                '99.90%',
                                                                        },
                                                                        {
                                                                            value:
                                                                                '99.95',
                                                                            label:
                                                                                '99.95%',
                                                                        },
                                                                        {
                                                                            value:
                                                                                '99.99',
                                                                            label:
                                                                                '99.99%',
                                                                        },
                                                                        {
                                                                            value:
                                                                                'custom',
                                                                            label:
                                                                                'Custom',
                                                                        },
                                                                    ]}
                                                                    onChange={(
                                                                        event,
                                                                        value
                                                                    ) => {
                                                                        value ===
                                                                            'custom' &&
                                                                            this.setState(
                                                                                {
                                                                                    setCustomMonitorUptime: true,
                                                                                }
                                                                            );
                                                                    }}
                                                                />
                                                            )}
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
                                                    id: createMonitorSlaModalId,
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

MonitorSlaModal.displayName = 'MonitorSlaModal';

MonitorSlaModal.propTypes = {
    closeModal: PropTypes.func.isRequired,
    handleSubmit: PropTypes.func.isRequired,
    data: PropTypes.object,
    requesting: PropTypes.bool,
    slaError: PropTypes.string,
    createMonitorSla: PropTypes.func,
    fetchMonitorSlas: PropTypes.func,
    createMonitorSlaModalId: PropTypes.string,
    monitorsList: PropTypes.array,
    formValues: PropTypes.object,
    fetchMonitors: PropTypes.func,
};

const MonitorSlaForm = reduxForm({
    form: 'monitorSlaForm',
    enableReinitialize: false,
    validate,
    destroyOnUnmount: true,
})(MonitorSlaModal);

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            closeModal,
            createMonitorSla,
            fetchMonitorSlas,
            fetchMonitors,
        },
        dispatch
    );

const mapStateToProps = (state, ownProps) => {
    const monitorData = state.monitor.monitorsList.monitors.find(
        data => String(data._id) === String(ownProps.data.projectId)
    );
    const monitors = monitorData ? monitorData.monitors : [];

    return {
        createMonitorSlaModalId: state.modal.modals[0].id,
        initialValues: {
            frequencyOption: '30',
        },
        requesting: state.monitorSla.monitorSla.requesting,
        slaError: state.monitorSla.monitorSla.error,
        monitorsList: monitors,
        formValues:
            state.form.monitorSlaForm && state.form.monitorSlaForm.values,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(MonitorSlaForm);
