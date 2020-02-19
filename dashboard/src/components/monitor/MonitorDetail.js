import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import IncidentList from '../incident/IncidentList';
import uuid from 'uuid';
import DateRangeWrapper from './DateRangeWrapper';
import {
    editMonitorSwitch,
    selectedProbe,
    fetchMonitorLogs,
    fetchMonitorStatuses,
    fetchMonitorsIncidents
} from '../../actions/monitor';
import { openModal } from '../../actions/modal';
import { createNewIncident } from '../../actions/incident';
import moment from 'moment';
import { FormLoader } from '../basic/Loader';
import CreateManualIncident from '../modals/CreateManualIncident';
import ShouldRender from '../basic/ShouldRender';
import MonitorUrl from '../modals/MonitorUrl';
import DataPathHoC from '../DataPathHoC';
import Badge from '../common/Badge';
import { history } from '../../store';
import { Link } from 'react-router-dom';
import MonitorChart from './MonitorChart';
import StatusIndicator from './StatusIndicator';
import ProbeBar from './ProbeBar';
import { getMonitorStatus, filterProbeData } from '../../config';
import { logEvent } from '../../analytics';
import { IS_DEV } from '../../config';

export class MonitorDetail extends Component {
    constructor(props) {
        super(props);
        this.props = props;
        this.state = {
            createIncidentModalId: uuid.v4(),
            startDate: moment().subtract(30, 'd'),
            endDate: moment(),
            now: Date.now(),
            nowHandler: null
        }
        this.selectbutton = this.selectbutton.bind(this);
    }

    componentDidMount() {
        this.setLastAlive();
    }

    componentDidUpdate(prevProps) {
        if (prevProps.probes !== this.props.probes) {
            if (this.state.nowHandler) {
                clearTimeout(this.state.nowHandler);
            }

            this.setLastAlive();
        }
    }

    setLastAlive = () => {
        this.setState({ now: Date.now() });

        const nowHandler = setTimeout(() => {
            this.setState({ now: Date.now() });
        }, 300000);

        this.setState({ nowHandler });
    }

    handleDateChange = (startDate, endDate) => {
        this.setState({ startDate, endDate });

        const { fetchMonitorLogs, fetchMonitorStatuses, monitor } = this.props;

        fetchMonitorLogs(monitor.projectId._id || monitor.projectId, monitor._id, startDate, endDate);
        fetchMonitorStatuses(monitor.projectId._id || monitor.projectId, monitor._id, startDate, endDate);
    }

    selectbutton = (data) => {
        this.props.selectedProbe(data);
    }

    prevClicked = () => {
        this.props.fetchMonitorsIncidents(this.props.monitor.projectId._id, this.props.monitor._id, (this.props.monitor.skip ? (parseInt(this.props.monitor.skip, 10) - 3) : 3), 3);
        if (!IS_DEV) {
            logEvent('Previous Incident Requested', {
                ProjectId: this.props.monitor.projectId._id,
                monitorId: this.props.monitor._id,
                skip: (this.props.monitor.skip ? (parseInt(this.props.monitor.skip, 10) - 3) : 3)
            });
        }
    }

    nextClicked = () => {
        this.props.fetchMonitorsIncidents(this.props.monitor.projectId._id, this.props.monitor._id, (this.props.monitor.skip ? (parseInt(this.props.monitor.skip, 10) + 3) : 3), 3);
        if (!IS_DEV) {
            logEvent('Next Incident Requested', {
                ProjectId: this.props.monitor.projectId._id,
                monitorId: this.props.monitor._id,
                skip: (this.props.monitor.skip ? (parseInt(this.props.monitor.skip, 10) + 3) : 3)
            });
        }
    }

    editMonitor = () => {
        this.props.editMonitorSwitch(this.props.index);
        if (!IS_DEV) {
            logEvent('Edit Monitor Switch Clicked', {});
        }
    }

    handleKeyBoard = (e) => {
        const canNext = (this.props.monitor && this.props.monitor.count) && this.props.monitor.count > this.props.monitor.skip + this.props.monitor.limit ? true : false;
        const canPrev = this.props.monitor && this.props.monitor.skip <= 0 ? false : true;
        switch (e.key) {
            case 'ArrowRight':
                return canNext && this.nextClicked()
            case 'ArrowLeft':
                return canPrev && this.prevClicked()
            default:
                return false;
        }
    }

    replaceDashWithSpace = (string) => {
        return string.replace('-', ' ');
    }

    componentWillUnmount() {
        if (this.state.nowHandler) {
            clearTimeout(this.state.nowHandler);
        }
    }

    render() {
        const { createIncidentModalId, startDate, endDate } = this.state;
        const { monitor, create, monitorState, activeProbe, currentProject, probes, activeIncident } = this.props;

        const probe = monitor && probes && probes.length > 0 ? probes[probes.length < 2 ? 0 : activeProbe] : null;
        const lastAlive = probe && probe.lastAlive ? probe.lastAlive : null;

        const { logs, statuses } = filterProbeData(monitor, probe, startDate, endDate);

        const status = getMonitorStatus(monitor.incidents, logs);

        const creating = create || false;

        const url = monitor && monitor.data && monitor.data.url ? monitor.data.url : null;
        const probeUrl = `/project/${monitor.projectId._id}/settings/probe`;

        monitor.error = null;
        if (monitorState.monitorsList.error && monitorState.monitorsList.error.monitorId && monitor && monitor._id) {
            if (monitorState.monitorsList.error.monitorId === monitor._id) {
                monitor.error = monitorState.monitorsList.error.error;
            }
        }
        monitor.success = monitorState.monitorsList.success;
        monitor.requesting = monitorState.monitorsList.requesting;

        let badgeColor;
        switch (monitor.type) {
            case 'manual':
                badgeColor = 'red';
                break;
            case 'device':
                badgeColor = 'green';
                break;
            default:
                badgeColor = 'blue';
                break;
        }

        const isCurrentlyNotMonitoring = (lastAlive && moment(this.state.now).diff(moment(lastAlive), 'seconds') >= 300) || !lastAlive;

        return (
            <div className="Box-root Card-shadow--medium" tabIndex='0' onKeyDown={this.handleKeyBoard}>
                <div className="Box-root Padding-top--20 Padding-left--20 Padding-bottom--20">
                    <Badge id={`badge_${this.props.projectName}`} color={this.props.projectType === 'project' ? 'red' : 'blue'}>{this.props.projectName}</Badge>
                </div>
                <div className="db-Trends-header">
                    <div className="db-Trends-title">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                    <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                        <StatusIndicator status={status} />
                                        <span id={`monitor_title_${monitor.name}`}>
                                            {monitor.name}
                                        </span>
                                    </span>
                                    <ShouldRender if={monitor && monitor.type}>
                                        {
                                            monitor.type === 'url' || monitor.type === 'api' || monitor.type === 'script' ?
                                                <ShouldRender if={probes && !probes.length > 0}>
                                                    <span className="Text-fontSize--14">This monitor cannot be monitored because there are are 0 probes. You can view probes <Link to={probeUrl}>here</Link></span>
                                                </ShouldRender>
                                                : ''
                                        }
                                    </ShouldRender>
                                    <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                        {url && <span>
                                            Currently {isCurrentlyNotMonitoring && 'Not'} Monitoring &nbsp;
                                        <a href={url}>{url}</a>
                                        </span>}
                                    </span>
                                </div>
                                <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                    <div className="Box-root">
                                        <Badge color={badgeColor}>{this.replaceDashWithSpace(monitor.type)}</Badge>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="db-Trends-controls">
                        <div className="db-Trends-timeControls">
                            <DateRangeWrapper
                                selected={startDate}
                                onChange={this.handleDateChange}
                                dateRange={30}
                            />
                        </div>
                        <div>
                            {monitor.type === 'device' &&
                                <button
                                    className='bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--eye' type='button'
                                    onClick={() =>
                                        this.props.openModal({
                                            id: monitor._id,
                                            onClose: () => '',
                                            content: DataPathHoC(MonitorUrl, monitor)
                                        })
                                    }
                                >
                                    <span>Show URL</span>
                                </button>
                            }
                            <button className={creating && activeIncident === monitor._id ? 'bs-Button bs-Button--blue' : 'bs-Button bs-ButtonLegacy ActionIconParent'} type="button" disabled={creating}
                                id={`create_incident_${monitor.name}`}
                                onClick={() =>
                                    this.props.openModal({
                                        id: createIncidentModalId,
                                        content: DataPathHoC(CreateManualIncident, { monitorId: monitor._id, projectId: monitor.projectId._id })
                                    })}>
                                <ShouldRender if={!(creating && activeIncident === monitor._id)}>
                                    <span className="bs-FileUploadButton bs-Button--icon bs-Button--new">
                                        <span>Create New Incident</span>
                                    </span>
                                </ShouldRender>
                                <ShouldRender if={creating && activeIncident === monitor._id}>
                                    <FormLoader />
                                </ShouldRender>
                            </button>
                            <button id={`more_details_${monitor.name}`} className='bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--help' type='button' onClick={() => { history.push('/project/' + currentProject._id + '/monitors/' + monitor._id) }}><span>More</span></button>
                        </div>
                    </div>
                </div>
                <ShouldRender if={monitor && probes && probes.length > 1}>
                    <ShouldRender if={monitor.type !== 'manual' && monitor.type !== 'device' && monitor.type !== 'server-monitor'}>
                        <div className="btn-group">
                            {monitor && probes.map((location, index) => {
                                const { logs } = filterProbeData(monitor, location, startDate, endDate);
                                const status = getMonitorStatus(monitor.incidents, logs);
                                const probe = probes.filter(probe => probe._id === location._id);
                                const lastAlive = probe && probe.length > 0 ? probe[0].lastAlive : null;

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
                    <MonitorChart
                        start={startDate}
                        end={endDate}
                        key={uuid.v4()}
                        monitor={monitor}
                        data={logs}
                        statuses={statuses}
                        status={status}
                    />
                </ShouldRender>

                {monitor && monitor.type ?
                    monitor.type === 'url' || monitor.type === 'api' || monitor.type === 'script' ?
                        <div>
                            <ShouldRender if={probes && probes.length > 0}>
                                {monitor && probes && probes.length < 2 ?
                                    <MonitorChart
                                        start={startDate}
                                        end={endDate}
                                        key={uuid.v4()}
                                        monitor={monitor}
                                        data={logs}
                                        statuses={statuses}
                                        status={status}
                                    />
                                    : ''
                                }
                                <div className="db-RadarRulesLists-page">
                                    <div className="Box-root Margin-bottom--12">
                                        <div className="">
                                            <div className="Box-root">
                                                <div>
                                                    <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center"><span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap"></span><span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"><span>Here&apos;s a list of recent incidents which belong to this monitor.</span></span></div>
                                                            <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                                <div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <IncidentList incidents={monitor} prevClicked={this.prevClicked} nextClicked={this.nextClicked} />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </ShouldRender>
                            <ShouldRender if={probes && !probes.length > 0}>
                                <div className="Margin-bottom--12"></div>
                            </ShouldRender>
                        </div>
                        :
                        <div>
                            {monitor && probes && probes.length < 2 ?
                                <MonitorChart
                                    start={startDate}
                                    end={endDate}
                                    key={uuid.v4()}
                                    monitor={monitor}
                                    data={logs}
                                    statuses={statuses}
                                    status={status}
                                />
                                :
                                ''
                            }
                            <div className="db-RadarRulesLists-page">
                                <div className="Box-root Margin-bottom--12">
                                    <div className="">
                                        <div className="Box-root">
                                            <div>
                                                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center"><span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap"></span><span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"><span>Here&apos;s a list of recent incidents which belong to this monitor.</span></span></div>
                                                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                            <div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                                <IncidentList incidents={monitor} prevClicked={this.prevClicked} nextClicked={this.nextClicked} />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    : ''
                }
            </div>
        )
    }
}

MonitorDetail.displayName = 'MonitorDetail'

const mapDispatchToProps = (dispatch) => {
    return bindActionCreators({
        editMonitorSwitch,
        openModal,
        fetchMonitorsIncidents,
        fetchMonitorLogs,
        fetchMonitorStatuses,
        createNewIncident,
        selectedProbe,
    }, dispatch)
};

function mapStateToProps(state) {
    return {
        monitorState: state.monitor,
        currentProject: state.project.currentProject,
        create: state.incident.newIncident.requesting,
        activeIncident: state.incident.newIncident.monitorId,
        subProject: state.subProject,
        activeProbe: state.monitor.activeProbe,
        probes: state.probe.probes.data
    };
}

MonitorDetail.propTypes = {
    currentProject: PropTypes.object.isRequired,
    monitor: PropTypes.object.isRequired,
    fetchMonitorsIncidents: PropTypes.func.isRequired,
    fetchMonitorLogs: PropTypes.func.isRequired,
    fetchMonitorStatuses: PropTypes.func.isRequired,
    editMonitorSwitch: PropTypes.func.isRequired,
    monitorState: PropTypes.object.isRequired,
    index: PropTypes.string,
    openModal: PropTypes.func,
    create: PropTypes.bool,
    selectedProbe: PropTypes.func.isRequired,
    activeProbe: PropTypes.number,
    probes: PropTypes.array,
    activeIncident: PropTypes.string,
    projectName: PropTypes.string,
    projectType: PropTypes.string
};

export default connect(mapStateToProps, mapDispatchToProps)(MonitorDetail);
