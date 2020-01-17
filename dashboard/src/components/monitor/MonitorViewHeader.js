import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import MonitorChart from './MonitorChart';
import uuid from 'uuid';
import DateRangeWrapper from './DateRangeWrapper';
import MonitorTitle from './MonitorTitle';
import ProbeBar from './ProbeBar';
import moment from 'moment';
import { editMonitorSwitch, fetchMonitorLogs, fetchMonitorsIncidentsRange, deleteMonitor } from '../../actions/monitor';
import DeleteMonitor from '../modals/DeleteMonitor';
import { FormLoader } from '../basic/Loader';
import RenderIfSubProjectAdmin from '../basic/RenderIfSubProjectAdmin';
import Badge from '../common/Badge';
import ShouldRender from '../basic/ShouldRender';
import { selectedProbe } from '../../actions/monitor';
import { openModal, closeModal } from '../../actions/modal';
import { history } from '../../store';
import { getMonitorStatus } from '../../config';
import DataPathHoC from '../DataPathHoC';
import { logEvent } from '../../analytics';
import { IS_DEV } from '../../config';

export class MonitorViewHeader extends Component {
    constructor(props) {
        super(props);
        this.props = props;
        this.state = {
            deleteModalId: uuid.v4(),
            startDate: moment().subtract(30, 'd'),
            endDate: moment()
        }

        this.deleteMonitor = this.deleteMonitor.bind(this);
    }

    componentDidMount() {
        const { fetchMonitorLogs, fetchMonitorsIncidentsRange, monitor } = this.props;
        const { startDate, endDate } = this.state;

        fetchMonitorLogs(monitor.projectId._id || monitor.projectId, monitor._id, startDate, endDate);
        fetchMonitorsIncidentsRange(monitor.projectId._id || monitor.projectId, monitor._id, 100, startDate, endDate);
    }

    handleDateChange = (startDate, endDate) => {
        this.setState({ startDate, endDate });

        const { fetchMonitorLogs, fetchMonitorsIncidentsRange, monitor } = this.props;

        fetchMonitorLogs(monitor.projectId._id || monitor.projectId, monitor._id, startDate, endDate);
        fetchMonitorsIncidentsRange(monitor.projectId._id || monitor.projectId, monitor._id, 100, startDate, endDate);
    }

    editMonitor = () => {
        this.props.editMonitorSwitch(this.props.index);
        if (!IS_DEV) {
            logEvent('Edit Monitor Switch Clicked', {});
        }
    }

    deleteMonitor = () => {
        let promise = this.props.deleteMonitor(this.props.monitor._id, this.props.monitor.projectId._id || this.props.monitor.projectId);
        history.push(`/project/${this.props.currentProject._id}/monitoring`);
        if (!IS_DEV) {
            logEvent('Monitor Deleted', {
                ProjectId: this.props.currentProject._id,
                monitorId: this.props.monitor._id
            });
        }
        return promise;
    }

    selectbutton = (data) => {
        this.props.selectedProbe(data);
    }

    handleKeyBoard = (e) => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeModal({ id: this.state.deleteModalId })
            default:
                return false;
        }
    }

    filterProbeData = (monitor, probe) => {
        const data = monitor.logs && monitor.logs.length > 0 ? monitor.logs.filter(probeLogs => {
            return probeLogs._id === null || probeLogs._id === probe._id
        }) : [];
        const probeData = data && data.length > 0 ? data[0].logs : [];

        return probeData && probeData.length > 0 ? probeData.filter(
            log => moment(new Date(log.createdAt)).isBetween(
                new Date(this.state.startDate),
                new Date(this.state.endDate),
                'day',
                '[]'
            )
        ) : [];
    }

    render() {
        const { deleteModalId, startDate, endDate } = this.state;
        const { monitor, subProjects, monitorState, activeProbe, currentProject, probes } = this.props;

        const subProjectId = monitor.projectId._id || monitor.projectId;
        const subProject = subProjects.find(subProject => subProject._id === subProjectId);

        const probe = monitor && monitor.probes && monitor.probes.length > 0 ? monitor.probes[monitor.probes.length < 2 ? 0 : activeProbe] : null;
        const probeData = this.filterProbeData(monitor, probe);

        const status = getMonitorStatus(monitor.incidentsRange || monitor.incidents, probeData);

        let deleting = false;
        if (monitorState && monitorState.deleteMonitor && monitorState.deleteMonitor === monitor._id) {
            deleting = true;
        }

        return (
            <div className="db-Trends bs-ContentSection Card-root Card-shadow--medium" onKeyDown={this.handleKeyBoard}>
                {
                    currentProject._id === subProjectId ?
                        subProjects.length > 0 ?
                            <div className="Box-root Padding-top--20 Padding-left--20">
                                <Badge color={'red'}>Project</Badge>
                            </div> :
                            null
                        :
                        <div className="Box-root Padding-top--20 Padding-left--20">
                            <Badge color={'blue'}>{subProject && subProject.name}</Badge>
                        </div>
                }
                <div className="Box-root">
                    <div className="db-Trends-header">
                        <MonitorTitle monitor={monitor} status={status} />
                        <div className="db-Trends-controls">
                            <div className="db-Trends-timeControls">
                                <DateRangeWrapper
                                    selected={startDate}
                                    onChange={this.handleDateChange}
                                    dateRange={30}
                                />
                            </div>
                            <div>
                                <RenderIfSubProjectAdmin subProjectId={subProjectId}>
                                    <button id={`edit_${monitor.name}`} className='bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--settings' type='button' onClick={this.editMonitor}><span>Edit</span></button>
                                    <button id={`delete_${monitor.name}`} className={deleting ? 'bs-Button bs-Button--blue' : 'bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--delete'} type="button" disabled={deleting}
                                        onClick={() =>
                                            this.props.openModal({
                                                id: deleteModalId,
                                                onClose: () => '',
                                                onConfirm: () => this.deleteMonitor(),
                                                content: DataPathHoC(DeleteMonitor, { monitor })
                                            })}>
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
                    <ShouldRender if={monitor && monitor.probes && monitor.probes.length > 1}>
                        <ShouldRender if={monitor.type !== 'manual' && monitor.type !== 'device' && monitor.type !== 'server-monitor'}>
                            <div className="btn-group">
                                {monitor && monitor.probes.map((location, index) => {
                                    let probeData = this.filterProbeData(monitor, location);
                                    let status = getMonitorStatus(monitor.incidentsRange || monitor.incidents, probeData);
                                    let probe = probes.filter(probe => probe._id === location._id);
                                    let lastAlive = probe && probe.length > 0 ? probe[0].lastAlive : null;

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
                                    )
                                })}
                            </div>
                        </ShouldRender>
                        <MonitorChart start={startDate} end={endDate} key={uuid.v4()} monitor={monitor} data={probeData} status={status} showAll={true} />
                    </ShouldRender>
                    {monitor && monitor.probes && monitor.probes.length < 2 ?
                        <MonitorChart start={startDate} end={endDate} key={uuid.v4()} monitor={monitor} data={probeData} status={status} showAll={true} />
                        : ''
                    }<br />
                </div>
            </div>
        );
    }
}

MonitorViewHeader.displayName = 'MonitorViewHeader';

MonitorViewHeader.propTypes = {
    monitor: PropTypes.object.isRequired,
    editMonitorSwitch: PropTypes.func.isRequired,
    fetchMonitorLogs: PropTypes.func.isRequired,
    fetchMonitorsIncidentsRange: PropTypes.func.isRequired,
    monitorState: PropTypes.object.isRequired,
    deleteMonitor: PropTypes.func.isRequired,
    openModal: PropTypes.func,
    closeModal: PropTypes.func,
    index: PropTypes.string.isRequired,
    subProjects: PropTypes.array.isRequired,
    currentProject: PropTypes.object.isRequired,
    activeProbe: PropTypes.number,
    selectedProbe: PropTypes.func.isRequired,
    probes: PropTypes.array
};

const mapDispatchToProps = dispatch => bindActionCreators({
    editMonitorSwitch,
    fetchMonitorLogs,
    fetchMonitorsIncidentsRange,
    deleteMonitor,
    selectedProbe,
    openModal,
    closeModal
}, dispatch);

const mapStateToProps = (state) => {
    return {
        monitorState: state.monitor,
        subProjects: state.subProject.subProjects.subProjects,
        currentProject: state.project.currentProject,
        activeProbe: state.monitor.activeProbe,
        probes: state.probe.probes.data
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(MonitorViewHeader);