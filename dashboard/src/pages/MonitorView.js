import React, { Fragment } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import Fade from 'react-reveal/Fade';
import {
    fetchMonitorsIncidents,
    fetchMonitorsSubscribers,
    getMonitorLogs,
    fetchLighthouseLogs,
} from '../actions/monitor';
import { fetchIncidentPriorities } from '../actions/incidentPriorities';
import Dashboard from '../components/Dashboard';
import PropTypes from 'prop-types';
import MonitorViewHeader from '../components/monitor/MonitorViewHeader';
import MonitorViewIncidentBox from '../components/monitor/MonitorViewIncidentBox';
import MonitorViewLighthouseLogsBox from '../components/monitor/MonitorViewLighthouseLogsBox';
import MonitorViewSubscriberBox from '../components/monitor/MonitorViewSubscriberBox';
import MonitorViewDeleteBox from '../components/monitor/MonitorViewDeleteBox';
import MonitorViewDisableBox from '../components/monitor/MonitorViewDisableBox';
import NewMonitor from '../components/monitor/NewMonitor';
import ShouldRender from '../components/basic/ShouldRender';
import { LoadingState } from '../components/basic/Loader';
import RenderIfSubProjectAdmin from '../components/basic/RenderIfSubProjectAdmin';
import { mapCriteria } from '../config';
import WebHookBox from '../components/webHooks/WebHookBox';
import { logEvent } from '../analytics';
import { SHOULD_LOG_ANALYTICS } from '../config';
import MonitorViewLogsBox from '../components/monitor/MonitorViewLogsBox';
import moment from 'moment';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import { getProbes } from '../actions/probe';
import MSTeamsBox from '../components/webHooks/MSTeamsBox';
import SlackBox from '../components/webHooks/SlackBox';
import { Tab, Tabs, TabList, TabPanel, resetIdCounter } from 'react-tabs';
import { fetchBasicIncidentSettings } from '../actions/incidentBasicsSettings';
import { fetchCommunicationSlas } from '../actions/incidentCommunicationSla';
import { fetchMonitorSlas } from '../actions/monitorSla';
import ThirdPartyVariables from '../components/monitor/ThirdPartyVariables';
class MonitorView extends React.Component {
    // eslint-disable-next-line
    constructor(props) {
        super(props);
        this.state = {
            tabIndex: 0,
        };
    }

    componentWillMount() {
        resetIdCounter();
    }

    componentDidMount() {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'PAGE VIEW: DASHBOARD > PROJECT > COMPONENT > MONITOR > MONITOR DETAIL PAGE'
            );
        }
    }

    componentDidUpdate(prevProps) {
        const { monitor } = this.props;
        if (!prevProps.monitor && monitor) {
            const subProjectId = monitor.projectId._id || monitor.projectId;
            this.props.getProbes(subProjectId, 0, 10); //0 -> skip, 10-> limit.
            if (monitor.type === 'url') {
                this.props.fetchLighthouseLogs(
                    monitor.projectId._id || monitor.projectId,
                    monitor._id,
                    0,
                    1,
                    monitor.data.url
                );
                this.props.fetchLighthouseLogs(subProjectId, monitor._id, 0, 5); //0 -> skip, 10-> limit.
            }
            this.props.fetchMonitorsIncidents(subProjectId, monitor._id, 0, 5); //0 -> skip, 5-> limit.
            this.props.fetchMonitorsSubscribers(
                subProjectId,
                monitor._id,
                0,
                5
            ); //0 -> skip, 5-> limit.
            this.props.getMonitorLogs(
                subProjectId,
                monitor._id,
                0,
                10,
                moment()
                    .subtract(1, 'd')
                    .utc(),
                moment().utc()
            ); //0 -> skip, 5-> limit.

            this.props.fetchMonitorSlas(subProjectId);
            this.props.fetchCommunicationSlas(subProjectId);
        }
    }
    tabSelected = index => {
        const tabSlider = document.getElementById('tab-slider');
        tabSlider.style.transform = `translate(calc(${tabSlider.offsetWidth}px*${index}), 0px)`;
        this.setState({
            tabIndex: index,
        });
    };
    ready = () => {
        const { monitor } = this.props;
        this.props.fetchIncidentPriorities(this.props.currentProject._id, 0, 0);
        this.props.fetchBasicIncidentSettings(this.props.currentProject._id);
        const subProjectId = monitor.projectId._id || monitor.projectId;
        this.props.getProbes(subProjectId, 0, 10); //0 -> skip, 10-> limit.
        if (monitor.type === 'url') {
            this.props.fetchLighthouseLogs(
                monitor.projectId._id || monitor.projectId,
                monitor._id,
                0,
                1,
                monitor.data.url
            );
            this.props.fetchLighthouseLogs(subProjectId, monitor._id, 0, 5); //0 -> skip, 10-> limit.
        }
        this.props.fetchMonitorsIncidents(subProjectId, monitor._id, 0, 5); //0 -> skip, 5-> limit.
        this.props.fetchMonitorsSubscribers(subProjectId, monitor._id, 0, 5); //0 -> skip, 5-> limit.
        this.props.getMonitorLogs(
            subProjectId,
            monitor._id,
            0,
            10,
            moment()
                .subtract(1, 'd')
                .utc(),
            moment().utc()
        ); //0 -> skip, 5-> limit.

        this.props.fetchMonitorSlas(subProjectId);
        this.props.fetchCommunicationSlas(subProjectId);
    };

    isDefaultMonitorSlaSet = () => {
        const { monitorSlas } = this.props;
        return monitorSlas && monitorSlas.some(sla => sla.isDefault);
    };

    render() {
        const {
            initialValues,
            location: { pathname },
            component,
            monitor,
            monitorSlas,
            scheduleWarning,
            monitorId,
            projectId,
            history,
            defaultSchedule,
        } = this.props;
        const redirectTo = `/dashboard/project/${projectId}/on-call`;
        let scheduleAlert;
        if (
            scheduleWarning.includes(monitorId) === false &&
            defaultSchedule !== true
        ) {
            scheduleAlert = (
                <div id="alertWarning" className="Box-root Margin-vertical--12">
                    <div className="db-Trends bs-ContentSection Card-root">
                        <div className="Box-root Box-background--red4 Card-shadow--medium Border-radius--4">
                            <div className="bs-ContentSection-content Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                                <span className="ContentHeader-title Text-color--white Text-fontSize--15 Text-fontWeight--regular Text-lineHeight--16">
                                    <img
                                        width="17"
                                        style={{
                                            marginRight: 5,
                                            verticalAlign: 'bottom',
                                            color: 'red',
                                        }}
                                        alt="warning"
                                        src={`${'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIj8+CjxzdmcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayIgeG1sbnM6c3ZnanM9Imh0dHA6Ly9zdmdqcy5jb20vc3ZnanMiIHZlcnNpb249IjEuMSIgd2lkdGg9IjUxMiIgaGVpZ2h0PSI1MTIiIHg9IjAiIHk9IjAiIHZpZXdCb3g9IjAgMCAxOTEuODEyIDE5MS44MTIiIHN0eWxlPSJlbmFibGUtYmFja2dyb3VuZDpuZXcgMCAwIDUxMiA1MTIiIHhtbDpzcGFjZT0icHJlc2VydmUiPjxnPgo8ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgoJPHBhdGggc3R5bGU9IiIgZD0iTTk1LjkwNiwxMjEuMDAzYzYuOTAzLDAsMTIuNS01LjU5NywxMi41LTEyLjVWNTEuNTExYzAtNi45MDQtNS41OTctMTIuNS0xMi41LTEyLjUgICBzLTEyLjUsNS41OTYtMTIuNSwxMi41djU2Ljk5M0M4My40MDYsMTE1LjQwNyw4OS4wMDMsMTIxLjAwMyw5NS45MDYsMTIxLjAwM3oiIGZpbGw9IiNmZmZmZmYiIGRhdGEtb3JpZ2luYWw9IiMxZDFkMWIiLz4KCTxwYXRoIHN0eWxlPSIiIGQ9Ik05NS45MDksMTI3LjgwN2MtMy4yOSwwLTYuNTIxLDEuMzMtOC44NDEsMy42NmMtMi4zMjksMi4zMi0zLjY1OSw1LjU0LTMuNjU5LDguODMgICBzMS4zMyw2LjUyLDMuNjU5LDguODRjMi4zMiwyLjMzLDUuNTUxLDMuNjYsOC44NDEsMy42NnM2LjUxLTEuMzMsOC44NC0zLjY2YzIuMzE5LTIuMzIsMy42Ni01LjU1LDMuNjYtOC44NHMtMS4zNDEtNi41MS0zLjY2LTguODMgICBDMTAyLjQxOSwxMjkuMTM3LDk5LjE5OSwxMjcuODA3LDk1LjkwOSwxMjcuODA3eiIgZmlsbD0iI2ZmZmZmZiIgZGF0YS1vcmlnaW5hbD0iIzFkMWQxYiIvPgoJPHBhdGggc3R5bGU9IiIgZD0iTTk1LjkwNiwwQzQzLjAyNCwwLDAsNDMuMDIzLDAsOTUuOTA2czQzLjAyMyw5NS45MDYsOTUuOTA2LDk1LjkwNnM5NS45MDUtNDMuMDIzLDk1LjkwNS05NS45MDYgICBTMTQ4Ljc4OSwwLDk1LjkwNiwweiBNOTUuOTA2LDE3Ni44MTJDNTEuMjk0LDE3Ni44MTIsMTUsMTQwLjUxOCwxNSw5NS45MDZTNTEuMjk0LDE1LDk1LjkwNiwxNSAgIGM0NC42MTEsMCw4MC45MDUsMzYuMjk0LDgwLjkwNSw4MC45MDZTMTQwLjUxOCwxNzYuODEyLDk1LjkwNiwxNzYuODEyeiIgZmlsbD0iI2ZmZmZmZiIgZGF0YS1vcmlnaW5hbD0iIzFkMWQxYiIvPgo8L2c+CjxnIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjwvZz4KPGcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPC9nPgo8ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgo8L2c+CjxnIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjwvZz4KPGcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPC9nPgo8ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgo8L2c+CjxnIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjwvZz4KPGcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPC9nPgo8ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgo8L2c+CjxnIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjwvZz4KPGcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPC9nPgo8ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgo8L2c+CjxnIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjwvZz4KPGcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPC9nPgo8ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgo8L2c+CjwvZz48L3N2Zz4K'}`}
                                    />
                                    <span>
                                        This Monitor does not have an on-call
                                        schedule. No Team Member will be alerted
                                        when incident is created.
                                    </span>
                                </span>
                                <span>
                                    <button
                                        className="bs-Button bs-Button--grey"
                                        onClick={() => history.push(redirectTo)}
                                    >
                                        Create On-Call Schedule
                                    </button>
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        const subProjectId = this.props.monitor
            ? this.props.monitor.projectId._id || this.props.monitor.projectId
            : null;
        const componentName = component ? component.name : '';
        const monitorName = monitor ? monitor.name : '';
        const monitorType = monitor && monitor.type ? monitor.type : '';
        const agentless = monitor && monitor.agentlessConfig;

        const componentMonitorsRoute = getParentRoute(pathname);
        const defaultMonitorSla = monitorSlas.find(sla => sla.isDefault);
        const disabledMonitor =
            this.props.monitor && this.props.monitor.disabled;
        return (
            <Dashboard ready={this.ready}>
                <Fade>
                    <BreadCrumbItem
                        route={componentMonitorsRoute}
                        name={componentName}
                    />
                    <BreadCrumbItem
                        route={`${componentMonitorsRoute}#`}
                        name="Monitors"
                    />
                    <BreadCrumbItem
                        route={pathname}
                        name={monitorName}
                        pageTitle="Monitor View"
                        type={monitor ? monitor.type : null}
                    />
                    <Tabs
                        selectedTabClassName={'custom-tab-selected'}
                        onSelect={tabIndex => this.tabSelected(tabIndex)}
                        selectedIndex={this.state.tabIndex}
                    >
                        <div className="Flex-flex Flex-direction--columnReverse">
                            <TabList
                                id="customTabList"
                                className={'custom-tab-list'}
                            >
                                <Tab className={'custom-tab custom-tab-4'}>
                                    Basic
                                </Tab>
                                <Tab className={'custom-tab custom-tab-4'}>
                                    Subscribers
                                </Tab>
                                <Tab className={'custom-tab custom-tab-4'}>
                                    Integrations
                                </Tab>
                                <Tab className={'custom-tab custom-tab-4'}>
                                    Advanced Options
                                </Tab>
                                <div
                                    id="tab-slider"
                                    className="custom-tab-4"
                                ></div>
                            </TabList>
                        </div>
                        <div>{scheduleAlert}</div>
                        {disabledMonitor && this.state.tabIndex === 0 ? (
                            <div
                                className="Box-root Margin-vertical--12"
                                style={{ marginTop: 0, cursor: 'pointer' }}
                                id="noMonitorSlaBreached"
                            >
                                <div className="db-Trends bs-ContentSection Card-root Card-shadow--small">
                                    <div className="Box-root Box-background--slate9 Card-shadow--medium Border-radius--4">
                                        <div
                                            className="bs-ContentSection-content Box-root Flex-flex Padding-horizontal--20 Padding-vertical--12"
                                            style={{
                                                justifyContent: 'space-between',
                                            }}
                                        >
                                            <div
                                                className="ContentHeader-title Text-fontSize--15 Text-fontWeight--regular Text-lineHeight--16"
                                                style={{
                                                    color: 'rgb(76, 76, 76)',
                                                    paddingTop: '5px',
                                                }}
                                            >
                                                <span>
                                                    This monitor is not being
                                                    monitored because its
                                                    currently disabled. Please
                                                    enable this monitor to start
                                                    monitoring.
                                                </span>
                                            </div>
                                            <div>
                                                <button
                                                    className="bs-Button bs-DeprecatedButton bs-Button--grey"
                                                    id={`reEnable_${this.props.monitor.name}`}
                                                    onClick={() =>
                                                        this.tabSelected(3)
                                                    }
                                                >
                                                    <span>Enable</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            ''
                        )}
                        {!this.props.requestingMonitorSla &&
                            this.props.monitor &&
                            (this.props.monitor.monitorSla ||
                                this.isDefaultMonitorSlaSet()) &&
                            !this.props.monitor.breachedMonitorSla && (
                                <div
                                    className="Box-root Margin-vertical--12"
                                    style={{ marginTop: 0, cursor: 'pointer' }}
                                    id="noMonitorSlaBreached"
                                >
                                    <div className="db-Trends bs-ContentSection Card-root Card-shadow--small">
                                        <div className="Box-root Box-background--green Card-shadow--medium Border-radius--4">
                                            <div className="bs-ContentSection-content Box-root Flex-flex Flex-alignItems--center Padding-horizontal--20 Padding-vertical--12">
                                                <span
                                                    className="db-SideNav-icon db-SideNav-icon--tick db-SideNav-icon--selected"
                                                    style={{
                                                        filter:
                                                            'brightness(0) invert(1)',
                                                        marginTop: 1,
                                                        marginRight: 10,
                                                    }}
                                                ></span>
                                                <span className="ContentHeader-title Text-color--white Text-fontSize--15 Text-fontWeight--regular Text-lineHeight--16">
                                                    {this.props.monitor
                                                        .monitorSla ? (
                                                        <span>
                                                            For the past{' '}
                                                            {
                                                                this.props
                                                                    .monitor
                                                                    .monitorSla
                                                                    .frequency
                                                            }{' '}
                                                            days, this monitor
                                                            has not breached the
                                                            defined SLA
                                                        </span>
                                                    ) : (
                                                        <span>
                                                            For the past{' '}
                                                            {
                                                                defaultMonitorSla.frequency
                                                            }{' '}
                                                            days, this monitor
                                                            has not breached the
                                                            defined SLA
                                                        </span>
                                                    )}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        {!this.props.requestingMonitorSla &&
                            this.props.monitor &&
                            this.props.monitor.breachedMonitorSla &&
                            (this.props.monitor.monitorSla ||
                                this.isDefaultMonitorSlaSet()) && (
                                <div
                                    className="Box-root Margin-vertical--12"
                                    style={{ marginTop: 0 }}
                                    id="monitorSlaBreached"
                                >
                                    <div className="db-Trends bs-ContentSection Card-root Card-shadow--small">
                                        <div className="Box-root Box-background--red4 Card-shadow--medium Border-radius--4">
                                            <div className="bs-ContentSection-content Box-root Flex-flex Flex-alignItems--center Padding-horizontal--20 Padding-vertical--12">
                                                <span
                                                    className="db-SideNav-icon db-SideNav-icon--info db-SideNav-icon--selected"
                                                    style={{
                                                        filter:
                                                            'brightness(0) invert(1)',
                                                        marginTop: 1,
                                                        marginRight: 10,
                                                    }}
                                                ></span>
                                                <span className="ContentHeader-title Text-color--white Text-fontSize--15 Text-fontWeight--regular Text-lineHeight--16">
                                                    {this.props.monitor
                                                        .monitorSla ? (
                                                        <span>
                                                            In the last{' '}
                                                            {
                                                                this.props
                                                                    .monitor
                                                                    .monitorSla
                                                                    .frequency
                                                            }{' '}
                                                            days, the SLA for
                                                            this monitor was
                                                            breached
                                                        </span>
                                                    ) : (
                                                        <span>
                                                            In the last{' '}
                                                            {
                                                                defaultMonitorSla.frequency
                                                            }{' '}
                                                            days, the SLA for
                                                            this monitor was
                                                            breached
                                                        </span>
                                                    )}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        <div className="Box-root">
                            <div>
                                <div>
                                    <div className="db-BackboneViewContainer">
                                        <div className="react-settings-view react-view">
                                            <span data-reactroot="">
                                                <div>
                                                    <div>
                                                        {this.props.monitor &&
                                                        this.props.monitor
                                                            ._id &&
                                                        this.props.monitor
                                                            .type &&
                                                        (((this.props.monitor
                                                            .type === 'url' ||
                                                            this.props.monitor
                                                                .type ===
                                                                'api') &&
                                                            !this.props
                                                                .probeList
                                                                .requesting) ||
                                                            (this.props.monitor
                                                                .type !==
                                                                'url' &&
                                                                this.props
                                                                    .monitor
                                                                    .type !==
                                                                    'api')) ? (
                                                            <Fragment>
                                                                <TabPanel>
                                                                    <Fade>
                                                                        <div className="Box-root Margin-bottom--12">
                                                                            <ShouldRender
                                                                                if={
                                                                                    !this
                                                                                        .props
                                                                                        .edit
                                                                                }
                                                                            >
                                                                                <MonitorViewHeader
                                                                                    componentId={
                                                                                        this
                                                                                            .props
                                                                                            .componentId
                                                                                    }
                                                                                    monitor={
                                                                                        this
                                                                                            .props
                                                                                            .monitor
                                                                                    }
                                                                                    index={
                                                                                        this
                                                                                            .props
                                                                                            .monitor
                                                                                            ._id
                                                                                    }
                                                                                />
                                                                            </ShouldRender>
                                                                            <ShouldRender
                                                                                if={
                                                                                    this
                                                                                        .props
                                                                                        .edit
                                                                                }
                                                                            >
                                                                                <NewMonitor
                                                                                    {...this
                                                                                        .props}
                                                                                    editMonitorProp={
                                                                                        this
                                                                                            .props
                                                                                            .monitor
                                                                                    }
                                                                                    index={
                                                                                        this
                                                                                            .props
                                                                                            .monitor
                                                                                            ._id
                                                                                    }
                                                                                    edit={
                                                                                        true
                                                                                    }
                                                                                    key={
                                                                                        this
                                                                                            .props
                                                                                            .monitor
                                                                                            ._id
                                                                                    }
                                                                                    formKey={
                                                                                        this
                                                                                            .props
                                                                                            .monitor
                                                                                            ._id
                                                                                    }
                                                                                    initialValues={
                                                                                        initialValues
                                                                                    }
                                                                                />
                                                                            </ShouldRender>
                                                                        </div>
                                                                        <div className="Box-root Margin-bottom--12">
                                                                            <MonitorViewIncidentBox
                                                                                componentId={
                                                                                    this
                                                                                        .props
                                                                                        .componentId
                                                                                }
                                                                                monitor={
                                                                                    this
                                                                                        .props
                                                                                        .monitor
                                                                                }
                                                                            />
                                                                        </div>
                                                                        <ShouldRender
                                                                            if={
                                                                                this
                                                                                    .props
                                                                                    .monitor &&
                                                                                this
                                                                                    .props
                                                                                    .monitor
                                                                                    .type &&
                                                                                this
                                                                                    .props
                                                                                    .monitor
                                                                                    .type ===
                                                                                    'url'
                                                                            }
                                                                        >
                                                                            <div className="Box-root Margin-bottom--12">
                                                                                <MonitorViewLighthouseLogsBox
                                                                                    componentId={
                                                                                        this
                                                                                            .props
                                                                                            .componentId
                                                                                    }
                                                                                    monitor={
                                                                                        this
                                                                                            .props
                                                                                            .monitor
                                                                                    }
                                                                                />
                                                                            </div>
                                                                        </ShouldRender>
                                                                        <ShouldRender
                                                                            if={
                                                                                this
                                                                                    .props
                                                                                    .monitor &&
                                                                                this
                                                                                    .props
                                                                                    .monitor
                                                                                    .type &&
                                                                                (this
                                                                                    .props
                                                                                    .monitor
                                                                                    .type ===
                                                                                    'url' ||
                                                                                    this
                                                                                        .props
                                                                                        .monitor
                                                                                        .type ===
                                                                                        'api' ||
                                                                                    this
                                                                                        .props
                                                                                        .monitor
                                                                                        .type ===
                                                                                        'server-monitor' ||
                                                                                    this
                                                                                        .props
                                                                                        .monitor
                                                                                        .type ===
                                                                                        'incomingHttpRequest')
                                                                            }
                                                                        >
                                                                            <div className="Box-root Margin-bottom--12">
                                                                                <MonitorViewLogsBox
                                                                                    monitorId={
                                                                                        monitor._id
                                                                                    }
                                                                                    monitorName={
                                                                                        monitorName
                                                                                    }
                                                                                    monitorType={
                                                                                        monitorType
                                                                                    }
                                                                                    agentless={
                                                                                        agentless
                                                                                    }
                                                                                />
                                                                            </div>
                                                                        </ShouldRender>
                                                                    </Fade>
                                                                </TabPanel>
                                                                <TabPanel>
                                                                    <Fade>
                                                                        <div className="Box-root Margin-bottom--12">
                                                                            <MonitorViewSubscriberBox
                                                                                monitorId={
                                                                                    this
                                                                                        .props
                                                                                        .monitor
                                                                                        ._id
                                                                                }
                                                                            />
                                                                        </div>
                                                                    </Fade>
                                                                </TabPanel>

                                                                <TabPanel>
                                                                    <Fade>
                                                                        <div className="Box-root Margin-bottom--12">
                                                                            <MSTeamsBox
                                                                                monitorId={
                                                                                    this
                                                                                        .props
                                                                                        .monitor
                                                                                        ._id
                                                                                }
                                                                            />
                                                                        </div>
                                                                        <div className="Box-root Margin-bottom--12">
                                                                            <SlackBox
                                                                                monitorId={
                                                                                    this
                                                                                        .props
                                                                                        .monitor
                                                                                        ._id
                                                                                }
                                                                            />
                                                                        </div>
                                                                        <div className="Box-root Margin-bottom--12">
                                                                            <WebHookBox
                                                                                monitorId={
                                                                                    this
                                                                                        .props
                                                                                        .monitor
                                                                                        ._id
                                                                                }
                                                                            />
                                                                        </div>
                                                                    </Fade>
                                                                </TabPanel>

                                                                <TabPanel>
                                                                    <Fade>
                                                                        <div>
                                                                            <ThirdPartyVariables
                                                                                monitor={
                                                                                    this
                                                                                        .props
                                                                                        .monitor
                                                                                }
                                                                                componentId={
                                                                                    this
                                                                                        .props
                                                                                        .componentId
                                                                                }
                                                                            />
                                                                        </div>
                                                                        <RenderIfSubProjectAdmin
                                                                            subProjectId={
                                                                                subProjectId
                                                                            }
                                                                        >
                                                                            <ShouldRender
                                                                                if={
                                                                                    this
                                                                                        .props
                                                                                        .monitor &&
                                                                                    this
                                                                                        .props
                                                                                        .monitor
                                                                                        .type &&
                                                                                    this
                                                                                        .props
                                                                                        .monitor
                                                                                        .type !==
                                                                                        'manual'
                                                                                }
                                                                            >
                                                                                <div className="Box-root Margin-bottom--12">
                                                                                    <MonitorViewDisableBox
                                                                                        componentId={
                                                                                            this
                                                                                                .props
                                                                                                .componentId
                                                                                        }
                                                                                        monitor={
                                                                                            this
                                                                                                .props
                                                                                                .monitor
                                                                                        }
                                                                                        tabSelected={
                                                                                            this
                                                                                                .tabSelected
                                                                                        }
                                                                                    />
                                                                                </div>
                                                                            </ShouldRender>
                                                                            <div className="Box-root Margin-bottom--12">
                                                                                <MonitorViewDeleteBox
                                                                                    componentId={
                                                                                        this
                                                                                            .props
                                                                                            .componentId
                                                                                    }
                                                                                    monitor={
                                                                                        this
                                                                                            .props
                                                                                            .monitor
                                                                                    }
                                                                                />
                                                                            </div>
                                                                        </RenderIfSubProjectAdmin>
                                                                    </Fade>
                                                                </TabPanel>
                                                            </Fragment>
                                                        ) : (
                                                            <LoadingState />
                                                        )}
                                                    </div>
                                                </div>
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </Tabs>
                </Fade>
            </Dashboard>
        );
    }
}

const mapStateToProps = (state, props) => {
    const scheduleWarning = [];
    const { projectId, componentId, monitorId } = props.match.params;

    state.schedule.subProjectSchedules.forEach(item => {
        item.schedules.forEach(item => {
            item.monitorIds.forEach(monitor => {
                scheduleWarning.push(monitor._id);
            });
        });
    });

    let defaultSchedule;
    state.schedule.subProjectSchedules.forEach(item => {
        item.schedules.forEach(item => {
            defaultSchedule = item.isDefault;
        });
    });

    let component;
    state.component.componentList.components.forEach(item => {
        item.components.forEach(c => {
            if (String(c._id) === String(componentId)) {
                component = c;
            }
        });
    });
    const monitor = state.monitor.monitorsList.monitors
        .map(monitor =>
            monitor.monitors.find(monitor => monitor._id === monitorId)
        )
        .filter(monitor => monitor)[0];
    const editMode = monitor && monitor.editMode ? true : false;
    const initialValues = {};
    if (monitor) {
        initialValues[`name_${monitor._id}`] = monitor.name;
        initialValues[`url_${monitor._id}`] = monitor.data && monitor.data.url;
        initialValues[`deviceId_${monitor._id}`] =
            monitor.data && monitor.data.deviceId;
        initialValues[`description_${monitor._id}`] =
            monitor.data && monitor.data.description;
        initialValues[`subProject_${monitor._id}`] = monitor.projectId._id;
        initialValues[`resourceCategory_${monitor._id}`] =
            monitor.resourceCategory && monitor.resourceCategory._id;
        if (
            monitor.incidentCommunicationSla &&
            monitor.incidentCommunicationSla._id
        ) {
            initialValues.incidentCommunicationSla =
                monitor.incidentCommunicationSla._id;
        }
        if (monitor.monitorSla && monitor.monitorSla._id) {
            initialValues.monitorSla = monitor.monitorSla._id;
        }
        if (
            monitor.type === 'url' ||
            monitor.type === 'api' ||
            monitor.type === 'server-monitor' ||
            monitor.type === 'incomingHttpRequest'
        ) {
            if (monitor.criteria && monitor.criteria.up) {
                initialValues[`up_${monitor._id}`] = mapCriteria(
                    monitor.criteria.up
                );
                initialValues[`up_${monitor._id}_createAlert`] =
                    monitor.criteria &&
                    monitor.criteria.up &&
                    monitor.criteria.up.createAlert;
                initialValues[`up_${monitor._id}_autoAcknowledge`] =
                    monitor.criteria &&
                    monitor.criteria.up &&
                    monitor.criteria.up.autoAcknowledge;
                initialValues[`up_${monitor._id}_autoResolve`] =
                    monitor.criteria &&
                    monitor.criteria.up &&
                    monitor.criteria.up.autoResolve;
            }
            if (monitor.criteria && monitor.criteria.degraded) {
                initialValues[`degraded_${monitor._id}`] = mapCriteria(
                    monitor.criteria.degraded
                );
                initialValues[`degraded_${monitor._id}_createAlert`] =
                    monitor.criteria &&
                    monitor.criteria.degraded &&
                    monitor.criteria.degraded.createAlert;
                initialValues[`degraded_${monitor._id}_autoAcknowledge`] =
                    monitor.criteria &&
                    monitor.criteria.degraded &&
                    monitor.criteria.degraded.autoAcknowledge;
                initialValues[`degraded_${monitor._id}_autoResolve`] =
                    monitor.criteria &&
                    monitor.criteria.degraded &&
                    monitor.criteria.degraded.autoResolve;
            }
            if (monitor.criteria && monitor.criteria.down) {
                initialValues[`down_${monitor._id}`] = mapCriteria(
                    monitor.criteria.down
                );
                initialValues[`down_${monitor._id}_createAlert`] =
                    monitor.criteria &&
                    monitor.criteria.down &&
                    monitor.criteria.down.createAlert;
                initialValues[`down_${monitor._id}_autoAcknowledge`] =
                    monitor.criteria &&
                    monitor.criteria.down &&
                    monitor.criteria.down.autoAcknowledge;
                initialValues[`down_${monitor._id}_autoResolve`] =
                    monitor.criteria &&
                    monitor.criteria.down &&
                    monitor.criteria.down.autoResolve;
            }
        }
        if (monitor.type === 'api') {
            if (monitor.method && monitor.method.length)
                initialValues[`method_${monitor._id}`] = monitor.method;
            if (monitor.bodyType && monitor.bodyType.length)
                initialValues[`bodyType_${monitor._id}`] = monitor.bodyType;
            if (monitor.text && monitor.text.length)
                initialValues[`text_${monitor._id}`] = monitor.text;
            if (monitor.formData && monitor.formData.length)
                initialValues[`formData_${monitor._id}`] = monitor.formData;
            if (monitor.headers && monitor.headers.length)
                initialValues[`headers_${monitor._id}`] = monitor.headers;
        }
    }
    return {
        defaultSchedule,
        scheduleWarning,
        projectId,
        monitorId,
        componentId,
        monitor,
        edit: state.monitor.monitorsList.editMode && editMode ? true : false,
        initialValues,
        match: props.match,
        component,
        probeList: state.probe.probes,
        currentProject: state.project.currentProject,
        requestingIncidentSla:
            state.incidentSla.incidentCommunicationSlas.requesting,
        requestingMonitorSla: state.monitorSla.monitorSlas.requesting,
        monitorSlas: state.monitorSla.monitorSlas.slas,
    };
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            fetchMonitorsIncidents,
            fetchMonitorsSubscribers,
            getMonitorLogs,
            fetchLighthouseLogs,
            getProbes,
            fetchIncidentPriorities,
            fetchBasicIncidentSettings,
            fetchCommunicationSlas,
            fetchMonitorSlas,
        },
        dispatch
    );
};

MonitorView.propTypes = {
    projectId: PropTypes.string,
    monitorId: PropTypes.string,
    componentId: PropTypes.string,
    monitor: PropTypes.object,
    edit: PropTypes.bool,
    fetchMonitorsIncidents: PropTypes.func.isRequired,
    fetchMonitorsSubscribers: PropTypes.func.isRequired,
    initialValues: PropTypes.object.isRequired,
    getMonitorLogs: PropTypes.func.isRequired,
    fetchLighthouseLogs: PropTypes.func.isRequired,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    component: PropTypes.shape({
        name: PropTypes.string,
    }),
    getProbes: PropTypes.func.isRequired,
    probeList: PropTypes.object,
    currentProject: PropTypes.object.isRequired,
    fetchIncidentPriorities: PropTypes.func.isRequired,
    fetchBasicIncidentSettings: PropTypes.func.isRequired,
    fetchCommunicationSlas: PropTypes.func,
    fetchMonitorSlas: PropTypes.func,
    requestingIncidentSla: PropTypes.bool,
    requestingMonitorSla: PropTypes.bool,
    monitorSlas: PropTypes.array,
    history: PropTypes.func,
    scheduleWarning: PropTypes.array,
    defaultSchedule: PropTypes.bool,
};

MonitorView.displayName = 'MonitorView';

export default connect(mapStateToProps, mapDispatchToProps)(MonitorView);
