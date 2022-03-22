import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import MonitorChart from './MonitorChart';

import { v4 as uuidv4 } from 'uuid';
import MonitorTitle from './MonitorTitle';
import ProbeBar from './ProbeBar';
import moment from 'moment';
import {
    editMonitorSwitch,
    fetchMonitorLogs,
    fetchMonitorStatuses,
    deleteMonitor,
    toggleEdit,
} from '../../actions/monitor';
import DeleteMonitor from '../modals/DeleteMonitor';
import { FormLoader } from '../basic/Loader';
import RenderIfSubProjectAdmin from '../basic/RenderIfSubProjectAdmin';
import Badge from '../common/Badge';
import ShouldRender from '../basic/ShouldRender';
import { selectedProbe } from '../../actions/monitor';
import { openModal, closeModal } from '../../actions/modal';
import { history } from '../../store';
import { getMonitorStatus, filterProbeData } from '../../config';
import DataPathHoC from '../DataPathHoC';

import CreateManualIncident from '../modals/CreateManualIncident';
import DateTimeRangePicker from '../basic/DateTimeRangePicker';
import DisabledMessage from '../modals/DisabledMessage';
import { updateprobebysocket } from '../../actions/socket';

export class MonitorViewHeader extends Component {
    constructor(props: $TSFixMe) {
        super(props);

        this.props = props;
        this.state = {
            deleteModalId: uuidv4(),
            startDate: moment().subtract(30, 'd'),
            endDate: moment(),
            createIncidentModalId: uuidv4(),
        };

        this.deleteMonitor = this.deleteMonitor.bind(this);
    }

    componentDidMount() {
        const {

            fetchMonitorLogs,

            fetchMonitorStatuses,

            monitor,
            // updateprobebysocket,
        } = this.props;

        const { startDate, endDate } = this.state;

        // socket.on(`updateProbe`, function(data) {
        //     updateprobebysocket(data);
        // });

        fetchMonitorLogs(
            monitor.projectId._id || monitor.projectId,
            monitor._id,
            startDate,
            endDate
        );
        fetchMonitorStatuses(
            monitor.projectId._id || monitor.projectId,
            monitor._id,
            startDate,
            endDate
        );
    }
    componentWillUnmount() {
        // socket.removeListener(`updateProbe`);
    }
    handleStartDateTimeChange = (val: $TSFixMe) => {
        const startDate = moment(val);

        this.handleDateChange(startDate, this.state.endDate);
    };
    handleEndDateTimeChange = (val: $TSFixMe) => {
        const endDate = moment(val);

        this.handleDateChange(this.state.startDate, endDate);
    };
    handleDateChange = (startDate: $TSFixMe, endDate: $TSFixMe) => {
        if (moment(startDate).isBefore(moment(endDate))) {
            this.setState({ startDate, endDate });

            const {

                fetchMonitorLogs,

                fetchMonitorStatuses,

                monitor,
            } = this.props;

            fetchMonitorLogs(
                monitor.projectId._id || monitor.projectId,
                monitor._id,
                startDate,
                endDate
            );
            fetchMonitorStatuses(
                monitor.projectId._id || monitor.projectId,
                monitor._id,
                startDate,
                endDate
            );
        }
    };

    editMonitor = () => {

        this.props.editMonitorSwitch(this.props.index);

        this.props.toggleEdit(true);
    };

    deleteMonitor = () => {

        const promise = this.props.deleteMonitor(

            this.props.monitor._id,

            this.props.monitor.projectId._id || this.props.monitor.projectId
        );
        history.push(

            `/dashboard/project/${this.props.currentProject.slug}/component/${this.props.componentSlug}/monitoring`
        );

        return promise;
    };

    selectbutton = (data: $TSFixMe) => {

        this.props.selectedProbe(data);
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                return this.props.closeModal({ id: this.state.deleteModalId });
            default:
                return false;
        }
    };

    render() {
        const {

            deleteModalId,

            startDate,

            endDate,

            createIncidentModalId,
        } = this.state;
        const {

            monitor,

            subProjects,

            monitorState,

            activeProbe,
            // currentProject,

            probes,

            creating,
        } = this.props;

        const subProjectId = monitor.projectId._id || monitor.projectId;
        const subProject = subProjects.find(
            (subProject: $TSFixMe) => subProject._id === subProjectId
        );

        const probe =
            monitor && probes && probes.length > 0
                ? probes[probes.length < 2 ? 0 : activeProbe]
                : null;
        const { logs, statuses } = filterProbeData(
            monitor,
            probe,
            startDate,
            endDate
        );
        const monitorType = monitor.type;
        const requesting = monitorState.fetchMonitorLogsRequest;
        const monitorDisabled = monitor.disabled;
        const status = monitorDisabled
            ? 'disabled'
            : requesting
                ? 'requesting'
                : getMonitorStatus(
                    monitor.incidents,
                    logs,
                    monitorType.replace('-', ' ')
                );
        let deleting = false;
        if (
            monitorState &&
            monitorState.deleteMonitor &&
            monitorState.deleteMonitor === monitor._id
        ) {
            deleting = true;
        }

        return (
            <div
                className="db-Trends bs-ContentSection Card-root Card-shadow--medium"
                onKeyDown={this.handleKeyBoard}
            >
                <div className="Flex-flex Flex-direction--row">
                    {/* {currentProject._id === subProjectId ? (
                        subProjects.length > 0 ? (
                            <div className="Box-root Padding-top--20 Padding-left--20">
                                <Badge color={'red'}>Project</Badge>
                            </div>
                        ) : null
                    ) : (
                        <div className="Box-root Padding-top--20 Padding-left--20">
                            <Badge color={'blue'}>
                                {subProject && subProject.name}
                            </Badge>
                        </div>
                    )} */}
                    <ShouldRender if={monitor && monitor.resourceCategory}>
                        <div
                            className={`Box-root Padding-top--20 ${(subProjects && subProjects.length > 0) ||
                                    (subProject && subProject.name)
                                    ? 'Padding-left--4'
                                    : 'Padding-left--20'
                                }`}
                        >
                            <Badge
                                color={'slate5'}
                                backgroundColor={'white'}
                                fontColor={'black'}
                            >
                                {monitor && monitor.resourceCategory
                                    ? monitor.resourceCategory.name
                                    : ''}
                            </Badge>
                        </div>
                    </ShouldRender>
                </div>
                <div className="Box-root">
                    <div className="db-Trends-header">
                        <MonitorTitle

                            monitor={monitor}
                            logs={logs}
                            status={status}
                        />
                        <div className="db-Trends-controls">
                            <div className="db-Trends-timeControls">
                                <DateTimeRangePicker
                                    currentDateRange={{
                                        startDate: startDate,
                                        endDate: endDate,
                                    }}
                                    handleStartDateTimeChange={
                                        this.handleStartDateTimeChange
                                    }
                                    handleEndDateTimeChange={
                                        this.handleEndDateTimeChange
                                    }
                                    formId={'monitorDateTime'}
                                    displayOnlyDate={true}
                                />
                            </div>
                            <div>
                                <RenderIfSubProjectAdmin
                                    subProjectId={subProjectId}
                                >
                                    <button
                                        className={
                                            creating
                                                ? 'bs-Button bs-Button--blue'
                                                : 'bs-Button bs-ButtonLegacy ActionIconParent'
                                        }
                                        type="button"
                                        disabled={creating}
                                        id={`monitorCreateIncident_${monitor.name}`}
                                        onClick={() =>

                                            this.props.openModal({
                                                id: createIncidentModalId,
                                                content: DataPathHoC(
                                                    monitorDisabled
                                                        ? DisabledMessage
                                                        : CreateManualIncident,
                                                    {
                                                        monitorId: monitor._id,
                                                        projectId:
                                                            monitor.projectId
                                                                ._id ||
                                                            monitor.projectId,
                                                        monitor,
                                                    }
                                                ),
                                            })
                                        }
                                    >
                                        <ShouldRender if={!creating}>
                                            <span className="bs-FileUploadButton bs-Button--icon bs-Button--new">
                                                <span>Create New Incident</span>
                                            </span>
                                        </ShouldRender>
                                        <ShouldRender if={creating}>
                                            <FormLoader />
                                        </ShouldRender>
                                    </button>
                                    <button
                                        id={`edit_${monitor.name}`}
                                        className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--settings"
                                        type="button"
                                        onClick={this.editMonitor}
                                    >
                                        <span>Edit</span>
                                    </button>
                                    <button
                                        id={`delete_${monitor.name}`}
                                        className={
                                            deleting
                                                ? 'bs-Button bs-Button--blue'
                                                : 'bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--delete'
                                        }
                                        type="button"
                                        disabled={deleting}
                                        onClick={() =>

                                            this.props.openModal({
                                                id: deleteModalId,
                                                onClose: () => '',
                                                onConfirm: () =>
                                                    this.deleteMonitor(),
                                                content: DataPathHoC(
                                                    DeleteMonitor,
                                                    { monitor }
                                                ),
                                            })
                                        }
                                    >
                                        <ShouldRender if={!deleting}>
                                            <span>Delete</span>
                                        </ShouldRender>
                                        <ShouldRender if={deleting}>
                                            <FormLoader />
                                        </ShouldRender>
                                    </button>
                                </RenderIfSubProjectAdmin>
                            </div>
                        </div>
                    </div>
                    <ShouldRender if={monitor && probes && probes.length > 1}>
                        <ShouldRender
                            if={
                                monitor.type !== 'manual' &&
                                !(
                                    !monitor.agentlessConfig &&
                                    monitor.type === 'server-monitor'
                                ) &&
                                monitor.type !== 'incomingHttpRequest'
                            }
                        >
                            <div className="btn-group">
                                {monitor &&
                                    probes.map((location: $TSFixMe, index: $TSFixMe) => {
                                        const { logs } = filterProbeData(
                                            monitor,
                                            location,
                                            startDate,
                                            endDate
                                        );
                                        const checkLogs =
                                            logs && logs.length > 0;
                                        const status = checkLogs
                                            ? logs[0].status

                                            : getMonitorStatus(
                                                monitor.incidents,
                                                logs
                                            );
                                        const probe = probes.filter(
                                            (probe: $TSFixMe) => probe._id === location._id
                                        );
                                        const lastAlive =
                                            probe && probe.length > 0
                                                ? probe[0].lastAlive
                                                : null;

                                        return (
                                            <ProbeBar
                                                key={index}
                                                index={index}
                                                name={location.probeName}
                                                status={status}
                                                selectbutton={this.selectbutton}
                                                activeProbe={activeProbe}
                                                lastAlive={lastAlive}
                                            />
                                        );
                                    })}
                            </div>
                        </ShouldRender>
                        <MonitorChart
                            start={startDate}
                            end={endDate}
                            key={uuidv4()}
                            monitor={monitor}
                            data={logs}
                            statuses={statuses}
                            status={status}
                            showAll={true}
                        />
                    </ShouldRender>
                    {monitor && probes && probes.length < 2 ? (
                        <MonitorChart
                            start={startDate}
                            end={endDate}
                            key={uuidv4()}
                            monitor={monitor}
                            data={logs}
                            statuses={statuses}
                            status={status}
                            showAll={true}
                        />
                    ) : (
                        ''
                    )}
                    <br />
                </div>
            </div>
        );
    }
}


MonitorViewHeader.displayName = 'MonitorViewHeader';


MonitorViewHeader.propTypes = {
    componentSlug: PropTypes.string.isRequired,
    monitor: PropTypes.object.isRequired,
    editMonitorSwitch: PropTypes.func.isRequired,
    fetchMonitorLogs: PropTypes.func.isRequired,
    fetchMonitorStatuses: PropTypes.func.isRequired,
    monitorState: PropTypes.object.isRequired,
    deleteMonitor: PropTypes.func.isRequired,
    openModal: PropTypes.func,
    closeModal: PropTypes.func,
    index: PropTypes.string.isRequired,
    subProjects: PropTypes.array.isRequired,
    currentProject: PropTypes.object.isRequired,
    activeProbe: PropTypes.number,
    selectedProbe: PropTypes.func.isRequired,
    probes: PropTypes.array,
    creating: PropTypes.bool,
    toggleEdit: PropTypes.func,
    // updateprobebysocket: PropTypes.func,
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        editMonitorSwitch,
        fetchMonitorLogs,
        fetchMonitorStatuses,
        deleteMonitor,
        selectedProbe,
        openModal,
        closeModal,
        toggleEdit,
        updateprobebysocket,
    },
    dispatch
);

const mapStateToProps = (state: $TSFixMe) => {
    return {
        monitorState: state.monitor,
        subProjects: state.subProject.subProjects.subProjects,
        currentProject: state.project.currentProject,
        activeProbe: state.monitor.activeProbe,
        probes: state.probe.probes.data,
        creating: state.incident.newIncident.requesting,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(MonitorViewHeader);
