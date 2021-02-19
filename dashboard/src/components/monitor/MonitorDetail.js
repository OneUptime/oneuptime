import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import IncidentList from '../incident/IncidentList';
import uuid from 'uuid';
import {
    editMonitorSwitch,
    selectedProbe,
    fetchMonitorLogs,
    fetchMonitorStatuses,
    fetchMonitorsIncidents,
} from '../../actions/monitor';
import { openModal } from '../../actions/modal';
import { createNewIncident } from '../../actions/incident';
import moment from 'moment';
import { FormLoader } from '../basic/Loader';
import CreateManualIncident from '../modals/CreateManualIncident';
import ShouldRender from '../basic/ShouldRender';
import DisabledMessage from '../modals/DisabledMessage';
import DataPathHoC from '../DataPathHoC';
import Badge from '../common/Badge';
import { history } from '../../store';
import { Link } from 'react-router-dom';
import MonitorChart from './MonitorChart';
import StatusIndicator from './StatusIndicator';
import ProbeBar from './ProbeBar';
import { getMonitorStatus, filterProbeData } from '../../config';
import { logEvent } from '../../analytics';
import { SHOULD_LOG_ANALYTICS } from '../../config';
import DateTimeRangePicker from '../basic/DateTimeRangePicker';

export class MonitorDetail extends Component {
    constructor(props) {
        super(props);
        this.props = props;
        this.state = {
            createIncidentModalId: uuid.v4(),
            startDate: moment().subtract(30, 'd'),
            endDate: moment(),
            now: Date.now(),
            nowHandler: null,
        };
        this.selectbutton = this.selectbutton.bind(this);
    }

    componentDidMount() {
        const { fetchMonitorLogs, monitor } = this.props;
        const { startDate, endDate } = this.state;

        fetchMonitorLogs(
            monitor.projectId._id || monitor.projectId,
            monitor._id,
            startDate,
            endDate
        );
        this.setLastAlive();
    }

    componentDidUpdate(prevProps) {
        const { fetchMonitorLogs, monitor } = this.props;
        const { startDate, endDate } = this.state;

        if (prevProps.probes !== this.props.probes) {
            if (this.state.nowHandler) {
                clearTimeout(this.state.nowHandler);
            }

            fetchMonitorLogs(
                monitor.projectId._id || monitor.projectId,
                monitor._id,
                startDate,
                endDate
            );

            this.setLastAlive();
        }
    }

    setLastAlive = () => {
        this.setState({ now: Date.now() });

        const nowHandler = setTimeout(() => {
            this.setState({ now: Date.now() });
        }, 300000);

        this.setState({ nowHandler });
    };

    handleStartDateTimeChange = val => {
        const startDate = moment(val);
        this.handleDateChange(startDate, this.state.endDate);
    };
    handleEndDateTimeChange = val => {
        const endDate = moment(val);
        this.handleDateChange(this.state.startDate, endDate);
    };
    handleDateChange = (startDate, endDate) => {
        this.setState({ startDate, endDate });

        const { fetchMonitorLogs, fetchMonitorStatuses, monitor } = this.props;

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
    };

    selectbutton = data => {
        this.props.selectedProbe(data);
    };

    prevClicked = () => {
        this.props
            .fetchMonitorsIncidents(
                this.props.monitor.projectId._id,
                this.props.monitor._id,
                this.props.monitor.skip
                    ? parseInt(this.props.monitor.skip, 10) - 3
                    : 3,
                3
            )
            .then(() => {
                this.setState({
                    [this.props.monitor._id]:
                        this.state[this.props.monitor._id] - 1,
                });
            });

        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > COMPONENT > MONITOR > PREVIOUS INCIDENT CLICKED',
                {
                    ProjectId: this.props.monitor.projectId._id,
                    monitorId: this.props.monitor._id,
                    skip: this.props.monitor.skip
                        ? parseInt(this.props.monitor.skip, 10) - 10
                        : 10,
                }
            );
        }
    };

    nextClicked = () => {
        this.props
            .fetchMonitorsIncidents(
                this.props.monitor.projectId._id,
                this.props.monitor._id,
                this.props.monitor.skip
                    ? parseInt(this.props.monitor.skip, 10) + 3
                    : 3,
                3
            )
            .then(() => {
                const numberOfPage = Math.ceil(
                    parseInt(this.props.monitor && this.props.monitor.count) / 3
                );
                this.setState({
                    [this.props.monitor._id]: this.state[this.props.monitor._id]
                        ? this.state[this.props.monitor._id] < numberOfPage
                            ? this.state[this.props.monitor._id] + 1
                            : numberOfPage
                        : 2,
                });
            });

        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > COMPONENT > MONITOR > NEXT INCIDENT CLICKED',
                {
                    ProjectId: this.props.monitor.projectId._id,
                    monitorId: this.props.monitor._id,
                    skip: this.props.monitor.skip
                        ? parseInt(this.props.monitor.skip, 3) + 3
                        : 3,
                }
            );
        }
    };

    editMonitor = () => {
        this.props.editMonitorSwitch(this.props.index);
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > COMPONENT > MONITOR > EDIT MONITOR CLICKED',
                {}
            );
        }
    };

    handleKeyBoard = e => {
        const canNext =
            this.props.monitor &&
            this.props.monitor.count &&
            this.props.monitor.count >
                this.props.monitor.skip + this.props.monitor.limit
                ? true
                : false;
        const canPrev =
            this.props.monitor && this.props.monitor.skip <= 0 ? false : true;
        switch (e.key) {
            case 'ArrowRight':
                return canNext && this.nextClicked();
            case 'ArrowLeft':
                return canPrev && this.prevClicked();
            default:
                return false;
        }
    };

    replaceDashWithSpace = string => {
        if (string === 'incomingHttpRequest') {
            return 'incoming Http Request';
        }
        return string.replace('-', ' ');
    };

    componentWillUnmount() {
        if (this.state.nowHandler) {
            clearTimeout(this.state.nowHandler);
        }
    }

    render() {
        const { createIncidentModalId, startDate, endDate } = this.state;
        const {
            monitor,
            create,
            monitorState,
            activeProbe,
            currentProject,
            probes,
            activeIncident,
            componentId,
        } = this.props;
        const numberOfPage = Math.ceil(
            parseInt(this.props.monitor && this.props.monitor.count) / 3
        );
        const probe =
            monitor && probes && probes.length > 0
                ? probes[probes.length < 2 ? 0 : activeProbe]
                : null;
        const lastAlive = probe && probe.lastAlive ? probe.lastAlive : null;

        const { logs, statuses } = filterProbeData(
            monitor,
            probe,
            startDate,
            endDate
        );

        const requesting = monitorState.fetchMonitorLogsRequest;
        const monitorDisabled = monitor.disabled;
        const status = monitorDisabled
            ? 'disabled'
            : requesting
            ? 'requesting'
            : getMonitorStatus(monitor.incidents, logs);

        const creating = create || false;

        const url =
            monitor && monitor.data && monitor.data.url
                ? monitor.data.url
                : monitor && monitor.data && monitor.data.link
                ? monitor.data.link
                : null;
        const probeUrl = `/dashboard/project/${monitor.projectId._id}/settings/probe`;

        monitor.error = null;
        if (
            monitorState.monitorsList.error &&
            monitorState.monitorsList.error.monitorId &&
            monitor &&
            monitor._id
        ) {
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
            default:
                badgeColor = 'blue';
                break;
        }

        const isCurrentlyNotMonitoring =
            (lastAlive &&
                moment(this.state.now).diff(moment(lastAlive), 'seconds') >=
                    300) ||
            !lastAlive;
        return (
            <div
                className="Box-root Card-shadow--medium"
                tabIndex="0"
                onKeyDown={this.handleKeyBoard}
            >
                <div className="Flex-flex Flex-direction--row">
                    <ShouldRender if={this.props.shouldRenderProjectType}>
                        <div className="Box-root Padding-top--20 Padding-left--20">
                            <Badge
                                id={`badge_${this.props.projectName}`}
                                color={
                                    this.props.projectType === 'project'
                                        ? 'red'
                                        : 'blue'
                                }
                            >
                                {this.props.projectName}
                            </Badge>
                        </div>
                    </ShouldRender>
                    <ShouldRender if={monitor && monitor.resourceCategory}>
                        <div
                            className={`Box-root Padding-top--20 ${
                                this.props.shouldRenderProjectType
                                    ? 'Padding-left--4'
                                    : 'Padding-left--20'
                            }`}
                        >
                            <Badge color={'slate5'}>
                                {monitor && monitor.resourceCategory
                                    ? monitor.resourceCategory.name
                                    : ''}
                            </Badge>
                        </div>
                    </ShouldRender>
                </div>
                <div className="db-Trends-header">
                    <div className="db-Trends-title">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                    <span
                                        id="monitor-content-header"
                                        className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap"
                                    >
                                        <StatusIndicator
                                            status={status}
                                            monitorName={monitor.name}
                                        />
                                        <span
                                            id={`monitor-title-${monitor.name}`}
                                        >
                                            {monitor.name}
                                        </span>
                                    </span>
                                    <ShouldRender if={monitor && monitor.type}>
                                        {monitor.type === 'url' ||
                                        monitor.type === 'api' ||
                                        monitor.type === 'script' ||
                                        monitor.type === 'ip' ? (
                                            <ShouldRender
                                                if={
                                                    probes && !probes.length > 0
                                                }
                                            >
                                                <span className="Text-fontSize--14">
                                                    This monitor cannot be
                                                    monitored because there are
                                                    are 0 probes. You can view
                                                    probes{' '}
                                                    <Link to={probeUrl}>
                                                        here
                                                    </Link>
                                                </span>
                                            </ShouldRender>
                                        ) : (
                                            ''
                                        )}
                                    </ShouldRender>
                                    <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                        {monitor.type !==
                                            'incomingHttpRequest' && url ? (
                                            <span>
                                                Currently{' '}
                                                {isCurrentlyNotMonitoring &&
                                                    'Not'}{' '}
                                                Monitoring &nbsp;
                                                <a
                                                    href={url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                >
                                                    {url}
                                                </a>
                                            </span>
                                        ) : monitor.type ===
                                              'incomingHttpRequest' && url ? (
                                            <span>
                                                <a
                                                    href={url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                >
                                                    {url}
                                                </a>
                                            </span>
                                        ) : (
                                            ''
                                        )}
                                        {monitor.type === 'manual' &&
                                            monitor.data &&
                                            monitor.data.description &&
                                            monitor.data.description !== '' && (
                                                <span>
                                                    Description:{' '}
                                                    {monitor.data.description}
                                                </span>
                                            )}
                                    </span>
                                </div>
                                <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                    <div className="Box-root">
                                        <Badge color={badgeColor}>
                                            {this.replaceDashWithSpace(
                                                monitor.type
                                            )}
                                        </Badge>
                                    </div>
                                </div>
                            </div>
                            <ShouldRender
                                if={
                                    !requesting &&
                                    monitor &&
                                    monitor.type &&
                                    monitor.type === 'server-monitor' &&
                                    (!logs || (logs && logs.length === 0)) &&
                                    !monitor.agentlessConfig
                                }
                            >
                                <div className="Card-root">
                                    <div
                                        className="Box-background--yellow4 Card-shadow--small Border-radius--4 Padding-horizontal--8 Padding-vertical--8"
                                        style={{
                                            marginTop: 10,
                                            marginBottom: 10,
                                            display: 'flex',
                                            alignItems: 'center',
                                        }}
                                    >
                                        <div
                                            className="db-SideNav-icon db-SideNav-icon--warning"
                                            style={{
                                                width: 17,
                                                marginRight: 5,
                                                backgroundSize: 'contain',
                                                backgroundRepeat: 'no-repeat',
                                            }}
                                        />
                                        <span className="Text-color--white Text-fontSize--14 Text-lineHeight--16">
                                            You need to install an agent on your
                                            server, please{' '}
                                            <a
                                                href="https://www.npmjs.com/package/fyipe-server-monitor"
                                                rel="noopener noreferrer"
                                                target="_blank"
                                                style={{
                                                    cursor: 'pointer',
                                                    textDecoration: 'underline',
                                                    color: 'white',
                                                }}
                                            >
                                                click here
                                            </a>{' '}
                                            for instructions. Your Monitor ID is{' '}
                                            {monitor._id}.
                                        </span>
                                    </div>
                                </div>
                            </ShouldRender>
                        </div>
                    </div>
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
                                formId={`${monitor._id}-monitorDateTime`}
                                displayOnlyDate={true}
                            />
                        </div>
                        <div>
                            <button
                                className={
                                    creating && activeIncident === monitor._id
                                        ? 'bs-Button bs-Button--blue'
                                        : 'bs-Button bs-ButtonLegacy ActionIconParent'
                                }
                                type="button"
                                disabled={creating}
                                id={`create_incident_${monitor.name}`}
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
                                                    monitor.projectId._id,
                                                monitor,
                                            }
                                        ),
                                    })
                                }
                            >
                                <ShouldRender
                                    if={
                                        !(
                                            creating &&
                                            activeIncident === monitor._id
                                        )
                                    }
                                >
                                    <span className="bs-FileUploadButton bs-Button--icon bs-Button--new">
                                        <span>Create New Incident</span>
                                    </span>
                                </ShouldRender>
                                <ShouldRender
                                    if={
                                        creating &&
                                        activeIncident === monitor._id
                                    }
                                >
                                    <FormLoader />
                                </ShouldRender>
                            </button>
                            <button
                                id={`more-details-${monitor.name}`}
                                className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--more"
                                type="button"
                                onClick={() => {
                                    history.push(
                                        '/dashboard/project/' +
                                            currentProject._id +
                                            '/' +
                                            componentId +
                                            '/monitoring/' +
                                            monitor._id
                                    );
                                }}
                            >
                                <span>View Monitor</span>
                            </button>
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
                                probes.map((location, index) => {
                                    const { logs } = filterProbeData(
                                        monitor,
                                        location,
                                        startDate,
                                        endDate
                                    );
                                    const checkLogs = logs && logs.length > 0;
                                    const status = checkLogs
                                        ? logs[0].status
                                        : getMonitorStatus(
                                              monitor.incidents,
                                              logs
                                          );
                                    const probe = probes.filter(
                                        probe => probe._id === location._id
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
                        key={uuid.v4()}
                        monitor={monitor}
                        data={logs}
                        statuses={statuses}
                        status={status}
                    />
                </ShouldRender>

                {monitor && monitor.type ? (
                    monitor.type === 'url' ||
                    monitor.type === 'api' ||
                    monitor.type === 'script' ||
                    monitor.type === 'ip' ? (
                        <div>
                            <ShouldRender if={probes && probes.length > 0}>
                                {monitor && probes && probes.length < 2 ? (
                                    <MonitorChart
                                        start={startDate}
                                        end={endDate}
                                        key={uuid.v4()}
                                        monitor={monitor}
                                        data={logs}
                                        statuses={statuses}
                                        status={status}
                                    />
                                ) : (
                                    ''
                                )}
                                <div className="db-RadarRulesLists-page">
                                    <div className="Box-root Margin-bottom--12">
                                        <div className="">
                                            <div className="Box-root">
                                                <div>
                                                    <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                                                <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap"></span>
                                                                <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                    <span>
                                                                        Here&apos;s
                                                                        a list
                                                                        of
                                                                        recent
                                                                        incidents
                                                                        which
                                                                        belong
                                                                        to this
                                                                        monitor
                                                                        2.
                                                                    </span>
                                                                </span>
                                                            </div>
                                                            <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                                <div></div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <IncidentList
                                                        incidents={monitor}
                                                        componentId={
                                                            componentId
                                                        }
                                                        prevClicked={
                                                            this.prevClicked
                                                        }
                                                        nextClicked={
                                                            this.nextClicked
                                                        }
                                                        page={
                                                            this.state[
                                                                monitor._id
                                                            ]
                                                                ? this.state[
                                                                      monitor
                                                                          ._id
                                                                  ]
                                                                : 1
                                                        }
                                                        numberOfPage={
                                                            numberOfPage
                                                        }
                                                    />
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
                    ) : (
                        <div>
                            {monitor && probes && probes.length < 2 ? (
                                <MonitorChart
                                    start={startDate}
                                    end={endDate}
                                    key={uuid.v4()}
                                    monitor={monitor}
                                    data={logs}
                                    statuses={statuses}
                                    status={status}
                                />
                            ) : (
                                ''
                            )}
                            <div className="db-RadarRulesLists-page">
                                <div className="Box-root Margin-bottom--12">
                                    <div className="">
                                        <div className="Box-root">
                                            <div>
                                                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                                            <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap"></span>
                                                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                <span>
                                                                    Here&apos;s
                                                                    a list of
                                                                    recent
                                                                    incidents
                                                                    which belong
                                                                    to this
                                                                    monitor 1.
                                                                </span>
                                                            </span>
                                                        </div>
                                                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                            <div></div>
                                                        </div>
                                                    </div>
                                                </div>
                                                <IncidentList
                                                    incidents={monitor}
                                                    componentId={componentId}
                                                    prevClicked={
                                                        this.prevClicked
                                                    }
                                                    nextClicked={
                                                        this.nextClicked
                                                    }
                                                    page={
                                                        this.state[monitor._id]
                                                            ? this.state[
                                                                  monitor._id
                                                              ]
                                                            : 1
                                                    }
                                                    numberOfPage={numberOfPage}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )
                ) : (
                    ''
                )}
            </div>
        );
    }
}

MonitorDetail.displayName = 'MonitorDetail';

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            editMonitorSwitch,
            openModal,
            fetchMonitorsIncidents,
            fetchMonitorLogs,
            fetchMonitorStatuses,
            createNewIncident,
            selectedProbe,
        },
        dispatch
    );
};

function mapStateToProps(state) {
    return {
        monitorState: state.monitor,
        currentProject: state.project.currentProject,
        create: state.incident.newIncident.requesting,
        activeIncident: state.incident.newIncident.monitorId,
        subProject: state.subProject,
        activeProbe: state.monitor.activeProbe,
        probes: state.probe.probes.data,
    };
}

MonitorDetail.propTypes = {
    currentProject: PropTypes.object.isRequired,
    componentId: PropTypes.string.isRequired,
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
    projectType: PropTypes.string,
    shouldRenderProjectType: PropTypes.bool,
};

export default connect(mapStateToProps, mapDispatchToProps)(MonitorDetail);
