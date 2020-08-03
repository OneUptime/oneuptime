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
    fetchMonitorsIncidents,
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
import { SHOULD_LOG_ANALYTICS } from '../../config';

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
        this.props.fetchMonitorsIncidents(
            this.props.monitor.projectId._id,
            this.props.monitor._id,
            this.props.monitor.skip
                ? parseInt(this.props.monitor.skip, 10) - 3
                : 3,
            3
        );
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > COMPONENT > MONITOR > PREVIOUS INCIDENT CLICKED',
                {
                    ProjectId: this.props.monitor.projectId._id,
                    monitorId: this.props.monitor._id,
                    skip: this.props.monitor.skip
                        ? parseInt(this.props.monitor.skip, 10) - 3
                        : 3,
                }
            );
        }
    };

    nextClicked = () => {
        this.props.fetchMonitorsIncidents(
            this.props.monitor.projectId._id,
            this.props.monitor._id,
            this.props.monitor.skip
                ? parseInt(this.props.monitor.skip, 10) + 3
                : 3,
            3
        );
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > COMPONENT > MONITOR > NEXT INCIDENT CLICKED',
                {
                    ProjectId: this.props.monitor.projectId._id,
                    monitorId: this.props.monitor._id,
                    skip: this.props.monitor.skip
                        ? parseInt(this.props.monitor.skip, 10) + 3
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

        const status = getMonitorStatus(monitor.incidents, logs);

        const creating = create || false;

        const url =
            monitor && monitor.data && monitor.data.url
                ? monitor.data.url
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
            case 'device':
                badgeColor = 'green';
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
                <div className="db-Trends-header">
                    <div className="db-Trends-title">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                    <span
                                        id="monitor-content-header"
                                        className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap"
                                    >
                                        <StatusIndicator status={status} />
                                        <span
                                            id={`monitor-title-${monitor.name}`}
                                        >
                                            {monitor.name}
                                        </span>
                                    </span>
                                    <ShouldRender if={monitor && monitor.type}>
                                        {monitor.type === 'url' ||
                                        monitor.type === 'api' ||
                                        monitor.type === 'script' ? (
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
                                        {url && (
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
                                    monitor &&
                                    monitor.type &&
                                    monitor.type === 'server-monitor' &&
                                    (!logs || (logs && logs.length === 0))
                                }
                            >
                                <div className="Card-root">
                                    <div
                                        className="Box-background--yellow4 Card-shadow--small Border-radius--4 Padding-horizontal--8 Padding-vertical--8"
                                        style={{
                                            marginTop: 10,
                                            marginBottom: 10,
                                            display: 'flex',
                                        }}
                                    >
                                        <img
                                            width="17"
                                            style={{
                                                marginRight: 5,
                                                verticalAlign: 'middle',
                                            }}
                                            alt="warning"
                                            src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB2ZXJzaW9uPSIxLjEiIGlkPSJDYXBhXzEiIHg9IjBweCIgeT0iMHB4IiB2aWV3Qm94PSIwIDAgNTEyIDUxMiIgc3R5bGU9ImVuYWJsZS1iYWNrZ3JvdW5kOm5ldyAwIDAgNTEyIDUxMjsiIHhtbDpzcGFjZT0icHJlc2VydmUiIHdpZHRoPSI1MTIiIGhlaWdodD0iNTEyIj48Zz48Zz4KCTxnPgoJCTxwYXRoIGQ9Ik00OTkuMDE1LDM0NS40M2wtNzkuNjQ2LTEzNy45NDljLTAuMzExLTAuNTM5LTAuNjY0LTEuMDM3LTEuMDU0LTEuNDk0TDM0Mi40OTQsNzQuNjYgICAgYy04LjQ0Ny0xNi44OTUtMjEuNTY1LTMwLjgzMy0zNy45NTUtNDAuMzE4Yy0xNC43MDktOC41MTctMzEuNDI0LTEzLjAyLTQ4LjMzNy0xMy4wMmMtMzQuNDA5LDAtNjYuNDgxLDE4LjQ3My04My43MDYsNDguMjIgICAgTDkyLjg1MSwyMDcuNDhjLTAuMzEsMC41MzctMC41NjcsMS4wOTctMC43NywxLjY3M2wtNzQuNDYsMTI4Ljk4NEM2LjA5MSwzNTQuNTA5LDAsMzczLjc1OSwwLDM5My44NDMgICAgYzAsNTMuMzk1LDQzLjQ0LDk2LjgzNSw5Ni44MzUsOTYuODM1aDMxOC41NmMwLjczLDAsMS40NDItMC4wNzgsMi4xMjctMC4yMjdjMTYuMjA4LTAuMzQyLDMyLjE3My00LjgxOCw0Ni4yOTctMTIuOTk3ICAgIEM1MDkuOTIyLDQ1MC43NTksNTI1LjcwOCwzOTEuNTI3LDQ5OS4wMTUsMzQ1LjQzeiBNNDUzLjc5Nyw0NjAuMTQ2Yy0xMS42NjUsNi43NTQtMjQuOTAyLDEwLjMyNS0zOC4yODEsMTAuMzI1aC0wLjEwNyAgICBjLTAuNjg0LDAuMDE4LTEuMzY3LDAuMDY5LTIuMDMxLDAuMjA2SDk2LjgzNWMtNDIuMzY2LDAtNzYuODM0LTM0LjQ2OC03Ni44MzQtNzYuODM0YzAtMTYuMDY2LDQuOTA5LTMxLjQ1NiwxNC4xOTctNDQuNTA1ICAgIGMwLjE4NC0wLjI1OCwwLjM1NS0wLjUyNSwwLjUxNC0wLjc5OWw3NS40MjMtMTMwLjY1M2wwLjExNi0wLjE5M2MwLjM0Ny0wLjU4MiwwLjYzMi0xLjE5MiwwLjg1My0xLjgyMkwxODkuODEsNzkuNTUzICAgIGMxMy42NTUtMjMuNTgxLDM5LjA5NC0zOC4yMyw2Ni4zOTEtMzguMjNjMTMuMzk5LDAsMjYuNjQ3LDMuNTcxLDM4LjMxNywxMC4zMjhjMTMuMDY5LDcuNTY0LDIzLjUxMiwxOC42OTMsMzAuMjAxLDMyLjE4NCAgICBjMC4wOTQsMC4xODksMC4xOTMsMC4zNzYsMC4yOTksMC41NTlsNzYuODg3LDEzMy4xNjljMC4zMTEsMC41MzksMC42NjQsMS4wMzcsMS4wNTQsMS40OTRMNDgxLjcsMzU1LjQ0MSAgICBDNTAyLjg3NCwzOTIuMDA3LDQ5MC4zNTYsNDM4Ljk3Nyw0NTMuNzk3LDQ2MC4xNDZ6IiBkYXRhLW9yaWdpbmFsPSIjMDAwMDAwIiBjbGFzcz0iYWN0aXZlLXBhdGgiIHN0eWxlPSJmaWxsOiNGRkZGRkYiIGRhdGEtb2xkX2NvbG9yPSIjMDAwMDAwIj48L3BhdGg+Cgk8L2c+CjwvZz48Zz4KCTxnPgoJCTxwYXRoIGQ9Ik0yNTUuOTkyLDEzMy4wNTljLTE5LjQyOCwwLTM1LjIzNCwxNS44MDctMzUuMjM0LDM1LjIzNnYxMDkuMTAxYzAsMTkuNDI5LDE1LjgwNiwzNS4yMzYsMzUuMjM0LDM1LjIzNiAgICBzMzUuMjM0LTE1LjgwNywzNS4yMzQtMzUuMjM2VjE2OC4yOTVDMjkxLjIyNywxNDguODY2LDI3NS40MiwxMzMuMDU5LDI1NS45OTIsMTMzLjA1OXogTTI3MS4yMjYsMjc3LjM5NiAgICBjMCw4LjQtNi44MzMsMTUuMjM1LTE1LjIzMywxNS4yMzVjLTguMzk5LDAtMTUuMjMzLTYuODM0LTE1LjIzMy0xNS4yMzVWMTY4LjI5NWMwLTguNCw2LjgzMy0xNS4yMzUsMTUuMjMzLTE1LjIzNSAgICBjOC4zOTksMCwxNS4yMzMsNi44MzQsMTUuMjMzLDE1LjIzNVYyNzcuMzk2eiIgZGF0YS1vcmlnaW5hbD0iIzAwMDAwMCIgY2xhc3M9ImFjdGl2ZS1wYXRoIiBzdHlsZT0iZmlsbDojRkZGRkZGIiBkYXRhLW9sZF9jb2xvcj0iIzAwMDAwMCI+PC9wYXRoPgoJPC9nPgo8L2c+PGc+Cgk8Zz4KCQk8cGF0aCBkPSJNMjU1Ljk5MiwzMzQuNTU5Yy0xOS40MjgsMC0zNS4yMzQsMTUuODA2LTM1LjIzNCwzNS4yMzRzMTUuODA2LDM1LjIzNCwzNS4yMzQsMzUuMjM0czM1LjIzNC0xNS44MDYsMzUuMjM0LTM1LjIzNCAgICBDMjkxLjIyNywzNTAuMzY2LDI3NS40MiwzMzQuNTU5LDI1NS45OTIsMzM0LjU1OXogTTI1NS45OTIsMzg1LjAyN2MtOC4zOTksMC0xNS4yMzMtNi44MzMtMTUuMjMzLTE1LjIzMyAgICBzNi44MzMtMTUuMjMzLDE1LjIzMy0xNS4yMzNzMTUuMjMzLDYuODMzLDE1LjIzMywxNS4yMzNDMjcxLjIyNiwzNzguMTk0LDI2NC4zOTIsMzg1LjAyNywyNTUuOTkyLDM4NS4wMjd6IiBkYXRhLW9yaWdpbmFsPSIjMDAwMDAwIiBjbGFzcz0iYWN0aXZlLXBhdGgiIHN0eWxlPSJmaWxsOiNGRkZGRkYiIGRhdGEtb2xkX2NvbG9yPSIjMDAwMDAwIj48L3BhdGg+Cgk8L2c+CjwvZz48Zz4KCTxnPgoJCTxwYXRoIGQ9Ik04MS4wNDgsMzE4LjI3N2MtNC43ODMtMi43Ni0xMC45LTEuMTIzLTEzLjY2MSwzLjY2MWwtMjAuNTE3LDM1LjU0MWMtMi43NjEsNC43ODMtMS4xMjIsMTAuOSwzLjY2MSwxMy42NjEgICAgYzEuNTc1LDAuOTA5LDMuMjk0LDEuMzQxLDQuOTksMS4zNDFjMy40NTYsMCw2LjgxOC0xLjc5Myw4LjY3LTUuMDAybDIwLjUxNy0zNS41NDFDODcuNDcxLDMyNy4xNTQsODUuODMzLDMyMS4wMzgsODEuMDQ4LDMxOC4yNzcgICAgeiIgZGF0YS1vcmlnaW5hbD0iIzAwMDAwMCIgY2xhc3M9ImFjdGl2ZS1wYXRoIiBzdHlsZT0iZmlsbDojRkZGRkZGIiBkYXRhLW9sZF9jb2xvcj0iIzAwMDAwMCI+PC9wYXRoPgoJPC9nPgo8L2c+PGc+Cgk8Zz4KCQk8cGF0aCBkPSJNOTUuNTI1LDI5My4xODZjLTQuNzg1LTIuNzU3LTEwLjktMS4xMTMtMTMuNjU4LDMuNjcybC0wLjExOCwwLjIwNWMtMi43NTcsNC43ODUtMS4xMTMsMTAuOSwzLjY3MiwxMy42NTggICAgYzEuNTczLDAuOTA2LDMuMjg5LDEuMzM3LDQuOTgzLDEuMzM3YzMuNDU5LDAsNi44MjMtMS43OTcsOC42NzQtNS4wMDlsMC4xMTgtMC4yMDUgICAgQzEwMS45NTYsMzAyLjA1OCwxMDAuMzExLDI5NS45NDMsOTUuNTI1LDI5My4xODZ6IiBkYXRhLW9yaWdpbmFsPSIjMDAwMDAwIiBjbGFzcz0iYWN0aXZlLXBhdGgiIHN0eWxlPSJmaWxsOiNGRkZGRkYiIGRhdGEtb2xkX2NvbG9yPSIjMDAwMDAwIj48L3BhdGg+Cgk8L2c+CjwvZz48L2c+IDwvc3ZnPg=="
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
                            <DateRangeWrapper
                                selected={startDate}
                                onChange={this.handleDateChange}
                                dateRange={30}
                            />
                        </div>
                        <div>
                            {monitor.type === 'device' && (
                                <button
                                    className="bs-Button bs-DeprecatedButton db-Trends-editButton bs-Button--icon bs-Button--eye"
                                    type="button"
                                    onClick={() =>
                                        this.props.openModal({
                                            id: monitor._id,
                                            onClose: () => '',
                                            content: DataPathHoC(
                                                MonitorUrl,
                                                monitor
                                            ),
                                        })
                                    }
                                >
                                    <span>Show URL</span>
                                </button>
                            )}
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
                                            CreateManualIncident,
                                            {
                                                monitorId: monitor._id,
                                                projectId:
                                                    monitor.projectId._id,
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
                                <span>More</span>
                            </button>
                        </div>
                    </div>
                </div>
                <ShouldRender if={monitor && probes && probes.length > 1}>
                    <ShouldRender
                        if={
                            monitor.type !== 'manual' &&
                            monitor.type !== 'device' &&
                            monitor.type !== 'server-monitor'
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
                                    const status = getMonitorStatus(
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
                    monitor.type === 'script' ? (
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
                                                                        monitor.
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
                                                                    monitor.
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
