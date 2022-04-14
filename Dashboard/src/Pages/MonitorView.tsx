import React, { Fragment } from 'react';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';

import { Fade } from 'react-awesome-reveal';
import {
    fetchMonitorsIncidents,
    fetchMonitorsSubscribers,
    getMonitorLogs,
    fetchLighthouseLogs,
} from '../actions/monitor';
import { fetchIncidentPriorities } from '../actions/incidentPriorities';
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
import { mapCriteria, User } from '../config';
import { fetchSchedules } from '../actions/schedule';

import WebHookBox from '../components/webHooks/WebHookBox';

import MonitorViewLogsBox from '../components/monitor/MonitorViewLogsBox';
import moment from 'moment';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../Utils/getParentRoute';
import { getProbes } from '../actions/probe';
import MSTeamsBox from '../components/webHooks/MSTeamsBox';
import SlackBox from '../components/webHooks/SlackBox';

import { Tab, Tabs, TabList, TabPanel, resetIdCounter } from 'react-tabs';
import {
    fetchIncidentTemplates,
    fetchDefaultTemplate,
} from '../actions/incidentBasicsSettings';
import { fetchCommunicationSlas } from '../actions/incidentCommunicationSla';
import { fetchMonitorSlas } from '../actions/monitorSla';
import ThirdPartyVariables from '../components/monitor/ThirdPartyVariables';
import MonitorViewChangeComponentBox from '../components/monitor/MonitorViewChangeComponentBox';
import { fetchComponent } from '../actions/component';

interface MonitorViewProps {
    projectId?: string;
    slug?: string;
    monitorId?: string;
    componentId?: string;
    monitor?: object;
    edit?: boolean;
    fetchMonitorsIncidents: Function;
    fetchMonitorsSubscribers: Function;
    initialValues: object;
    getMonitorLogs: Function;
    fetchLighthouseLogs: Function;
    location?: {
        pathname?: string
    };
    component?: object;
    getProbes: Function;
    probeList?: object;
    currentProject: object;
    fetchIncidentPriorities: Function;
    fetchIncidentTemplates: Function;
    fetchCommunicationSlas?: Function;
    fetchMonitorSlas?: Function;
    requestingIncidentSla?: boolean;
    requestingMonitorSla?: boolean;
    monitorSlas?: unknown[];
    history?: Function;
    scheduleWarning?: unknown[];
    defaultSchedule?: boolean;
    fetchSchedules?: Function;
    componentSlug?: string;
    fetchComponent?: Function;
    requestingComponent?: boolean;
    fetchDefaultTemplate?: Function;
    switchToProjectViewerNav?: boolean;
}

class MonitorView extends React.Component<MonitorViewProps> {
    // eslint-disable-next-line
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {
            tabIndex: 0,
        };
    }

    componentWillMount() {
        resetIdCounter();
    }

    override componentDidMount() {

        const { currentProject }: $TSFixMe = this.props;

        this.ready();

        if (currentProject) {
            const userId: $TSFixMe = User.getUserId();
            const projectMember: $TSFixMe = currentProject.users.find(
                (user: $TSFixMe) => user.userId === userId
            );
            if (projectMember) {

                this.props.fetchSchedules(currentProject._id);
            }
        }
    }

    componentDidUpdate(prevProps: $TSFixMe) {

        const { monitor }: $TSFixMe = this.props;
        if (
            String(prevProps.componentSlug) !==

            String(this.props.componentSlug) ||

            prevProps.currentProject !== this.props.currentProject
        ) {
            if (

                this.props.currentProject &&

                this.props.currentProject._id &&

                this.props.componentSlug
            ) {

                this.props.fetchComponent(

                    this.props.currentProject._id,

                    this.props.componentSlug
                );
            }
        }
        if (monitor && String(prevProps.monitor._id) !== String(monitor._id)) {
            const subProjectId: $TSFixMe = monitor.projectId
                ? monitor.projectId._id || monitor.projectId
                : '';

            subProjectId && this.props.getProbes(subProjectId, 0, 10); //0 -> skip, 10-> limit.
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

            this.props.fetchMonitorsIncidents(subProjectId, monitor._id, 0, 10); //0 -> skip, 5-> limit.

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
                moment().utc(),
                null,
                null,
                monitor.type
            ); //0 -> skip, 5-> limit.


            this.props.fetchMonitorSlas(subProjectId);

            this.props.fetchCommunicationSlas(subProjectId);
        }

        if (
            JSON.stringify(prevProps.currentProject) !==

            JSON.stringify(this.props.currentProject)
        ) {

            this.props.fetchDefaultTemplate({
                projectId:

                    this.props.currentProject._id || this.props.currentProject,
            });

            this.props.fetchIncidentTemplates({
                projectId:

                    this.props.currentProject._id || this.props.currentProject,
                skip: 0,
                limit: 0,
            });
        }
    }
    tabSelected = (index: $TSFixMe) => {
        const tabSlider: $TSFixMe = document.getElementById('tab-slider');

        tabSlider.style.transform = `translate(calc(${tabSlider.offsetWidth}px*${index}), 0px)`;
        this.setState({
            tabIndex: index,
        });
    };
    ready = () => {
        const {

            monitor,

            componentSlug,

            fetchComponent,

            currentProject,
        } = this.props;

        if (currentProject && currentProject._id && componentSlug) {
            fetchComponent(currentProject._id, componentSlug);
        }

        if (monitor && monitor._id && this.props.currentProject._id) {

            this.props.fetchIncidentPriorities(

                this.props.currentProject._id,
                0,
                0
            );

            this.props.fetchIncidentTemplates({
                projectId:

                    this.props.currentProject._id || this.props.currentProject,
                skip: 0,
                limit: 0,
            });

            this.props.fetchDefaultTemplate({
                projectId:

                    this.props.currentProject._id || this.props.currentProject,
            });
            const subProjectId: $TSFixMe = monitor.projectId
                ? monitor.projectId._id || monitor.projectId
                : '';

            subProjectId && this.props.getProbes(subProjectId, 0, 10); //0 -> skip, 10-> limit.
            if (subProjectId && monitor) {
                if (monitor.type === 'url') {

                    this.props.fetchLighthouseLogs(
                        monitor.projectId._id || monitor.projectId,
                        monitor._id,
                        0,
                        1,
                        monitor.data.url
                    );

                    this.props.fetchLighthouseLogs(
                        subProjectId,
                        monitor._id,
                        0,
                        5
                    ); //0 -> skip, 10-> limit.
                }

                this.props.fetchMonitorsIncidents(
                    subProjectId,
                    monitor._id,
                    0,
                    5
                ); //0 -> skip, 5-> limit.

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
                    moment().utc(),
                    null,
                    null,
                    monitor.type
                ); //0 -> skip, 5-> limit.


                this.props.fetchMonitorSlas(subProjectId);

                this.props.fetchCommunicationSlas(subProjectId);
            }
        }
    };

    isDefaultMonitorSlaSet = () => {

        const { monitorSlas }: $TSFixMe = this.props;
        return monitorSlas && monitorSlas.some((sla: $TSFixMe) => sla.isDefault);
    };

    override render() {
        const {

            initialValues,

            location: { pathname },

            component,

            monitor,

            monitorSlas,

            scheduleWarning,

            monitorId,

            history,

            defaultSchedule,

            currentProject,

            switchToProjectViewerNav,
        } = this.props;

        const redirectTo:string: $TSFixMe = `/dashboard/project/${this.props.slug}/on-call`;
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

        const subProjectId: $TSFixMe =

            this.props.monitor && this.props.monitor.projectId

                ? this.props.monitor.projectId._id ||

                this.props.monitor.projectId
                : null;
        const componentName: $TSFixMe = component ? component.name : '';
        const monitorName: $TSFixMe = monitor ? monitor.name : '';
        const monitorType: $TSFixMe = monitor && monitor.type ? monitor.type : '';
        const agentless: $TSFixMe = monitor && monitor.agentlessConfig;


        const componentMonitorsRoute: $TSFixMe = getParentRoute(pathname);
        const defaultMonitorSla = monitorSlas.find((sla: $TSFixMe) => sla.isDefault);
        const disabledMonitor: $TSFixMe =

            this.props.monitor && this.props.monitor.disabled;
        const projectName: $TSFixMe = currentProject ? currentProject.name : '';
        const projectId: $TSFixMe = currentProject ? currentProject._id : '';
        return (
            <Fade>
                <BreadCrumbItem
                    route="/"
                    name={projectName}
                    projectId={projectId}
                    slug={currentProject ? currentProject.slug : null}

                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
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
                    onSelect={(tabIndex: $TSFixMe) => this.tabSelected(tabIndex)}

                    selectedIndex={this.state.tabIndex}
                >
                    <div className="Flex-flex Flex-direction--columnReverse">
                        <TabList
                            id="customTabList"
                            className={'custom-tab-list'}
                        >
                            <Tab
                                className={'custom-tab custom-tab-4 basic-tab'}
                            >
                                Basic
                            </Tab>
                            <Tab
                                className={
                                    'custom-tab custom-tab-4 subscribers-tab'
                                }
                            >
                                Subscribers
                            </Tab>
                            <Tab
                                className={
                                    'custom-tab custom-tab-4 integrations-tab'
                                }
                            >
                                Integrations
                            </Tab>
                            <Tab
                                className={
                                    'custom-tab custom-tab-4 advanced-options-tab'
                                }
                            >
                                Advanced Options
                            </Tab>
                            <div id="tab-slider" className="custom-tab-4"></div>
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
                                                monitored because its currently
                                                disabled. Please enable this
                                                monitor to start monitoring.
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

                                                            this.props.monitor
                                                                .monitorSla
                                                                .frequency
                                                        }{' '}
                                                        days, this monitor has
                                                        not breached the defined
                                                        SLA
                                                    </span>
                                                ) : (
                                                    <span>
                                                        For the past{' '}
                                                        {
                                                            defaultMonitorSla.frequency
                                                        }{' '}
                                                        days, this monitor has
                                                        not breached the defined
                                                        SLA
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

                                                            this.props.monitor
                                                                .monitorSla
                                                                .frequency
                                                        }{' '}
                                                        days, the SLA for this
                                                        monitor was breached
                                                    </span>
                                                ) : (
                                                    <span>
                                                        In the last{' '}
                                                        {
                                                            defaultMonitorSla.frequency
                                                        }{' '}
                                                        days, the SLA for this
                                                        monitor was breached
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

                                                        this.props.monitor._id &&

                                                        this.props.monitor.type &&

                                                        (((this.props.monitor
                                                            .type === 'url' ||

                                                            this.props.monitor
                                                                .type === 'api' ||

                                                            this.props.monitor
                                                                .type === 'ip') &&

                                                            !this.props.probeList
                                                                .requesting) ||

                                                            (this.props.monitor
                                                                .type !== 'url' &&

                                                                this.props.monitor
                                                                    .type !==
                                                                'api' &&

                                                                this.props.monitor
                                                                    .type !==
                                                                'ip')) ? (
                                                        <Fragment>
                                                            <TabPanel>
                                                                <Fade>
                                                                    <div className="Box-root Margin-bottom--12">
                                                                        <ShouldRender
                                                                            if={
                                                                                !this
                                                                                    .props

                                                                                    .edit &&
                                                                                !this
                                                                                    .props

                                                                                    .requestingComponent
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
                                                                                componentSlug={
                                                                                    this
                                                                                        .props

                                                                                        .component &&
                                                                                    this
                                                                                        .props

                                                                                        .component
                                                                                        .slug
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
                                                                        {!this
                                                                            .props

                                                                            .requestingComponent && (
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
                                                                            )}
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
                                                                            'url' &&
                                                                            !this
                                                                                .props

                                                                                .requestingComponent
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
                                                                                componentSlug={
                                                                                    this
                                                                                        .props

                                                                                        .component &&
                                                                                    this
                                                                                        .props

                                                                                        .component
                                                                                        .slug
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
                                                                                'incomingHttpRequest' ||
                                                                                this
                                                                                    .props

                                                                                    .monitor
                                                                                    .type ===
                                                                                'kubernetes' ||
                                                                                this
                                                                                    .props

                                                                                    .monitor
                                                                                    .type ===
                                                                                'ip' ||
                                                                                this
                                                                                    .props

                                                                                    .monitor
                                                                                    .type ===
                                                                                'script')
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
                                                                                projectId={
                                                                                    monitor
                                                                                        .projectId
                                                                                        ._id ||
                                                                                    monitor.projectId
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
                                                                    {!this.props

                                                                        .requestingComponent && (
                                                                            <>
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

                                                                                        <MonitorViewChangeComponentBox
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
                                                                                            componentSlug={
                                                                                                this
                                                                                                    .props

                                                                                                    .component &&
                                                                                                this
                                                                                                    .props

                                                                                                    .component
                                                                                                    .slug
                                                                                            }
                                                                                        />
                                                                                    </div>
                                                                                </RenderIfSubProjectAdmin>
                                                                            </>
                                                                        )}
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
        );
    }
}

const mapStateToProps: Function = (state: RootState, props: $TSFixMe) => {
    const scheduleWarning: $TSFixMe = [];
    const { monitorSlug, componentSlug }: $TSFixMe = props.match.params;
    const schedules: $TSFixMe = state.schedule.schedules;
    state.schedule.subProjectSchedules.forEach((item: $TSFixMe) => {
        item.schedules.forEach((item: $TSFixMe) => {
            item.monitorIds.forEach((monitor: $TSFixMe) => {
                scheduleWarning.push(monitor._id);
            });
        });
    });

    const component: $TSFixMe =
        state.component.currentComponent.component &&
        state.component.currentComponent.component;

    const projectId: $TSFixMe =
        state.project.currentProject && state.project.currentProject._id;
    const monitorCollection = state.monitor.monitorsList.monitors.find((el: $TSFixMe) => {
        return component && component.projectId._id === el._id;
    });
    const currentMonitor: $TSFixMe =
        monitorCollection &&
        monitorCollection.monitors.find((el: $TSFixMe) => {
            return el.slug === monitorSlug;
        });
    const monitorId: $TSFixMe = currentMonitor && currentMonitor._id;
    let defaultSchedule;
    state.schedule.subProjectSchedules.forEach((item: $TSFixMe) => {
        item.schedules.forEach((item: $TSFixMe) => {
            defaultSchedule = item.isDefault;
        });
    });
    let monitor = {};
    state.monitor.monitorsList.monitors.forEach((item: $TSFixMe) => {
        item.monitors.forEach((monitorItem: $TSFixMe) => {
            if (String(monitorItem._id) === String(monitorId)) {
                monitor = monitorItem;
            }
        });
    });

    const initialValues: $TSFixMe = {};
    let currentMonitorCriteria = [];

    if (monitor && monitor._id) {

        initialValues[`name_${monitor._id}`] = monitor.name;

        initialValues[`url_${monitor._id}`] = monitor.data && monitor.data.url;

        initialValues[`deviceId_${monitor._id}`] =

            monitor.data && monitor.data.deviceId;

        initialValues[`ip_${monitor._id}`] =

            monitor.data && monitor.data.IPAddress;

        initialValues[`description_${monitor._id}`] =

            monitor.data && monitor.data.description;

        initialValues[`subProject_${monitor._id}`] =

            monitor.projectId._id || monitor.projectId;

        initialValues[`resourceCategory_${monitor._id}`] =

            monitor.resourceCategory &&

            (monitor.resourceCategory._id || monitor.resourceCategory);

        const monitorSchedules: $TSFixMe = [];
        if (schedules && schedules.data) {
            schedules.data.forEach((schedule: $TSFixMe) => {
                monitorSchedules.push({
                    [schedule._id]: schedule.monitorIds.some(

                        (monitorId: $TSFixMe) => monitorId._id === monitor._id
                    ),
                });
            });
        }

        initialValues[`callSchedules_${monitor._id}`] = monitorSchedules;
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

        if (monitor.type === 'kubernetes') {

            initialValues[`configurationFile_${monitor._id}`] =

                monitor.kubernetesConfig;

            initialValues[`kubernetesNamespace_${monitor._id}`] =

                monitor.kubernetesNamespace || 'default';
        }
        if (

            monitor.type === 'url' ||

            monitor.type === 'api' ||

            monitor.type === 'server-monitor' ||

            monitor.type === 'incomingHttpRequest' ||

            monitor.type === 'script' ||

            monitor.type === 'kubernetes' ||

            monitor.type === 'ip'
        ) {
            // collect all criteria

            if (monitor.criteria) {
                if (

                    monitor.criteria.up &&

                    monitor.criteria.down &&

                    monitor.criteria.degraded
                ) {
                    currentMonitorCriteria = [

                        ...monitor.criteria.up,

                        ...monitor.criteria.degraded,

                        ...monitor.criteria.down,
                    ].map((criterion, index) => {
                        const monitorUpCriteriaCount: $TSFixMe =

                            monitor.criteria.up.length;
                        const monitorDegradedCriteriaCount: $TSFixMe =

                            monitor.criteria.degraded.length;
                        const type: $TSFixMe =
                            index < monitorUpCriteriaCount
                                ? 'up'
                                : index <
                                    monitorUpCriteriaCount +
                                    monitorDegradedCriteriaCount
                                    ? 'degraded'
                                    : 'down';

                        const id: $TSFixMe = criterion._id;
                        const criterionBodyField: $TSFixMe = mapCriteria(criterion);
                        const criterionFieldName:string: $TSFixMe = `${type}_${id}`;
                        const scriptName: $TSFixMe =
                            criterion.scripts &&
                            criterion.scripts.map(({
                                scriptId
                            }: $TSFixMe) => {
                                return {
                                    value: scriptId._id,
                                    label: scriptId.name,
                                };
                            });

                        // set initial values for the criterion

                        initialValues[criterionFieldName] = criterionBodyField;


                        initialValues[`name_${criterionFieldName}`] =
                            criterion.name;

                        initialValues[`incidentTitle_${criterionFieldName}`] =
                            criterion.title;

                        initialValues[
                            `incidentDescription_${criterionFieldName}`
                        ] = criterion.description;

                        initialValues[`createAlert_${criterionFieldName}`] =
                            criterion.createAlert;

                        initialValues[`autoAcknowledge_${criterionFieldName}`] =
                            criterion.autoAcknowledge;

                        initialValues[`autoResolve_${criterionFieldName}`] =
                            criterion.autoResolve;

                        initialValues[
                            `script_${criterionFieldName}`
                        ] = scriptName;

                        // initialize schedules checkboxes for the criterions
                        /**
                         * @type Array.<String>
                         */
                        const criterionScheduleIds: $TSFixMe = criterion.scheduleIds;
                        /**
                         * @type { {data : Array}}
                         */

                        if (
                            criterionScheduleIds &&
                            criterionScheduleIds.length &&
                            schedules &&
                            schedules.data
                        ) {
                            const criterionSchedules: $TSFixMe = [];

                            // for each schedule, check if the criterion is already associated with it
                            schedules.data.forEach((schedule: $TSFixMe) => {
                                const scheduleId: $TSFixMe = schedule._id;
                                criterionSchedules.push({
                                    [scheduleId]: criterionScheduleIds.includes(
                                        scheduleId
                                    ),
                                });
                            });

                            initialValues[
                                `criterion_${id}_schedules`
                            ] = criterionSchedules;
                        }

                        return {
                            type,
                            id,
                            ...(criterion.default && {
                                default: true,
                            }),
                        };
                    });
                }
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
        component:
            state.component && state.component.currentComponent.component,
        slug: state.project.currentProject && state.project.currentProject.slug,
        componentId:
            state.component.currentComponent.component &&
            state.component.currentComponent.component._id,
        requestingComponent: state.component.currentComponent.requesting,
        monitor,
        edit: state.monitor.monitorsList.editMode ? true : false,
        initialValues,
        currentMonitorCriteria,
        match: props.match,
        probeList: state.probe.probes,
        currentProject: state.project.currentProject,
        requestingIncidentSla:
            state.incidentSla.incidentCommunicationSlas.requesting,
        requestingMonitorSla: state.monitorSla.monitorSlas.requesting,
        monitorSlas: state.monitorSla.monitorSlas.slas,
        componentSlug,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
    };
};

const mapDispatchToProps: Function = (dispatch: Dispatch) => {
    return bindActionCreators(
        {
            fetchMonitorsIncidents,
            fetchMonitorsSubscribers,
            getMonitorLogs,
            fetchLighthouseLogs,
            getProbes,
            fetchIncidentPriorities,
            fetchIncidentTemplates,
            fetchCommunicationSlas,
            fetchMonitorSlas,
            fetchSchedules,
            fetchComponent,
            fetchDefaultTemplate,
        },
        dispatch
    );
};


MonitorView.propTypes = {
    projectId: PropTypes.string,
    slug: PropTypes.string,
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
    component: PropTypes.object,
    getProbes: PropTypes.func.isRequired,
    probeList: PropTypes.object,
    currentProject: PropTypes.object.isRequired,
    fetchIncidentPriorities: PropTypes.func.isRequired,
    fetchIncidentTemplates: PropTypes.func.isRequired,
    fetchCommunicationSlas: PropTypes.func,
    fetchMonitorSlas: PropTypes.func,
    requestingIncidentSla: PropTypes.bool,
    requestingMonitorSla: PropTypes.bool,
    monitorSlas: PropTypes.array,
    history: PropTypes.func,
    scheduleWarning: PropTypes.array,
    defaultSchedule: PropTypes.bool,
    fetchSchedules: PropTypes.func,
    componentSlug: PropTypes.string,
    fetchComponent: PropTypes.func,
    requestingComponent: PropTypes.bool,
    fetchDefaultTemplate: PropTypes.func,
    switchToProjectViewerNav: PropTypes.bool,
};


MonitorView.displayName = 'MonitorView';

export default connect(mapStateToProps, mapDispatchToProps)(MonitorView);
