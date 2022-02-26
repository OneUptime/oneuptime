import React, { Fragment } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-reveal/Fade';
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
import getParentRoute from '../utils/getParentRoute';
import { getProbes } from '../actions/probe';
import MSTeamsBox from '../components/webHooks/MSTeamsBox';
import SlackBox from '../components/webHooks/SlackBox';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
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
class MonitorView extends React.Component {
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

    componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        const { currentProject } = this.props;

        this.ready();

        if (currentProject) {
            const userId = User.getUserId();
            const projectMember = currentProject.users.find(
                (user: $TSFixMe) => user.userId === userId
            );
            if (projectMember) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchSchedules' does not exist on type '... Remove this comment to see the full error message
                this.props.fetchSchedules(currentProject._id);
            }
        }
    }

    componentDidUpdate(prevProps: $TSFixMe) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
        const { monitor } = this.props;
        if (
            String(prevProps.componentSlug) !==
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
                String(this.props.componentSlug) ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            prevProps.currentProject !== this.props.currentProject
        ) {
            if (
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                this.props.currentProject &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                this.props.currentProject._id &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
                this.props.componentSlug
            ) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchComponent' does not exist on type '... Remove this comment to see the full error message
                this.props.fetchComponent(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                    this.props.currentProject._id,
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
                    this.props.componentSlug
                );
            }
        }
        if (monitor && String(prevProps.monitor._id) !== String(monitor._id)) {
            const subProjectId = monitor.projectId
                ? monitor.projectId._id || monitor.projectId
                : '';
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getProbes' does not exist on type 'Reado... Remove this comment to see the full error message
            subProjectId && this.props.getProbes(subProjectId, 0, 10); //0 -> skip, 10-> limit.
            if (monitor.type === 'url') {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchLighthouseLogs' does not exist on t... Remove this comment to see the full error message
                this.props.fetchLighthouseLogs(
                    monitor.projectId._id || monitor.projectId,
                    monitor._id,
                    0,
                    1,
                    monitor.data.url
                );
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchLighthouseLogs' does not exist on t... Remove this comment to see the full error message
                this.props.fetchLighthouseLogs(subProjectId, monitor._id, 0, 5); //0 -> skip, 10-> limit.
            }
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchMonitorsIncidents' does not exist o... Remove this comment to see the full error message
            this.props.fetchMonitorsIncidents(subProjectId, monitor._id, 0, 10); //0 -> skip, 5-> limit.
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchMonitorsSubscribers' does not exist... Remove this comment to see the full error message
            this.props.fetchMonitorsSubscribers(
                subProjectId,
                monitor._id,
                0,
                5
            ); //0 -> skip, 5-> limit.
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getMonitorLogs' does not exist on type '... Remove this comment to see the full error message
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

            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchMonitorSlas' does not exist on type... Remove this comment to see the full error message
            this.props.fetchMonitorSlas(subProjectId);
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchCommunicationSlas' does not exist o... Remove this comment to see the full error message
            this.props.fetchCommunicationSlas(subProjectId);
        }

        if (
            JSON.stringify(prevProps.currentProject) !==
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            JSON.stringify(this.props.currentProject)
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchDefaultTemplate' does not exist on ... Remove this comment to see the full error message
            this.props.fetchDefaultTemplate({
                projectId:
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                    this.props.currentProject._id || this.props.currentProject,
            });
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchIncidentTemplates' does not exist o... Remove this comment to see the full error message
            this.props.fetchIncidentTemplates({
                projectId:
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                    this.props.currentProject._id || this.props.currentProject,
                skip: 0,
                limit: 0,
            });
        }
    }
    tabSelected = (index: $TSFixMe) => {
        const tabSlider = document.getElementById('tab-slider');
        // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
        tabSlider.style.transform = `translate(calc(${tabSlider.offsetWidth}px*${index}), 0px)`;
        this.setState({
            tabIndex: index,
        });
    };
    ready = () => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
            monitor,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
            componentSlug,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchComponent' does not exist on type '... Remove this comment to see the full error message
            fetchComponent,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
        } = this.props;

        if (currentProject && currentProject._id && componentSlug) {
            fetchComponent(currentProject._id, componentSlug);
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        if (monitor && monitor._id && this.props.currentProject._id) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchIncidentPriorities' does not exist ... Remove this comment to see the full error message
            this.props.fetchIncidentPriorities(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                this.props.currentProject._id,
                0,
                0
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchIncidentTemplates' does not exist o... Remove this comment to see the full error message
            this.props.fetchIncidentTemplates({
                projectId:
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                    this.props.currentProject._id || this.props.currentProject,
                skip: 0,
                limit: 0,
            });
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchDefaultTemplate' does not exist on ... Remove this comment to see the full error message
            this.props.fetchDefaultTemplate({
                projectId:
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                    this.props.currentProject._id || this.props.currentProject,
            });
            const subProjectId = monitor.projectId
                ? monitor.projectId._id || monitor.projectId
                : '';
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getProbes' does not exist on type 'Reado... Remove this comment to see the full error message
            subProjectId && this.props.getProbes(subProjectId, 0, 10); //0 -> skip, 10-> limit.
            if (subProjectId && monitor) {
                if (monitor.type === 'url') {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchLighthouseLogs' does not exist on t... Remove this comment to see the full error message
                    this.props.fetchLighthouseLogs(
                        monitor.projectId._id || monitor.projectId,
                        monitor._id,
                        0,
                        1,
                        monitor.data.url
                    );
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchLighthouseLogs' does not exist on t... Remove this comment to see the full error message
                    this.props.fetchLighthouseLogs(
                        subProjectId,
                        monitor._id,
                        0,
                        5
                    ); //0 -> skip, 10-> limit.
                }
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchMonitorsIncidents' does not exist o... Remove this comment to see the full error message
                this.props.fetchMonitorsIncidents(
                    subProjectId,
                    monitor._id,
                    0,
                    5
                ); //0 -> skip, 5-> limit.
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchMonitorsSubscribers' does not exist... Remove this comment to see the full error message
                this.props.fetchMonitorsSubscribers(
                    subProjectId,
                    monitor._id,
                    0,
                    5
                ); //0 -> skip, 5-> limit.
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'getMonitorLogs' does not exist on type '... Remove this comment to see the full error message
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

                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchMonitorSlas' does not exist on type... Remove this comment to see the full error message
                this.props.fetchMonitorSlas(subProjectId);
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchCommunicationSlas' does not exist o... Remove this comment to see the full error message
                this.props.fetchCommunicationSlas(subProjectId);
            }
        }
    };

    isDefaultMonitorSlaSet = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorSlas' does not exist on type 'Rea... Remove this comment to see the full error message
        const { monitorSlas } = this.props;
        return monitorSlas && monitorSlas.some((sla: $TSFixMe) => sla.isDefault);
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'initialValues' does not exist on type 'R... Remove this comment to see the full error message
            initialValues,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
            location: { pathname },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
            component,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
            monitor,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorSlas' does not exist on type 'Rea... Remove this comment to see the full error message
            monitorSlas,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'scheduleWarning' does not exist on type ... Remove this comment to see the full error message
            scheduleWarning,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type 'Reado... Remove this comment to see the full error message
            monitorId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'history' does not exist on type 'Readonl... Remove this comment to see the full error message
            history,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'defaultSchedule' does not exist on type ... Remove this comment to see the full error message
            defaultSchedule,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchToProjectViewerNav' does not exist... Remove this comment to see the full error message
            switchToProjectViewerNav,
        } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'slug' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        const redirectTo = `/dashboard/project/${this.props.slug}/on-call`;
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

        const subProjectId =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.monitor && this.props.monitor.projectId
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                ? this.props.monitor.projectId._id ||
                  // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                  this.props.monitor.projectId
                : null;
        const componentName = component ? component.name : '';
        const monitorName = monitor ? monitor.name : '';
        const monitorType = monitor && monitor.type ? monitor.type : '';
        const agentless = monitor && monitor.agentlessConfig;

        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 1.
        const componentMonitorsRoute = getParentRoute(pathname);
        const defaultMonitorSla = monitorSlas.find((sla: $TSFixMe) => sla.isDefault);
        const disabledMonitor =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.monitor && this.props.monitor.disabled;
        const projectName = currentProject ? currentProject.name : '';
        const projectId = currentProject ? currentProject._id : '';
        return (
            <Fade>
                <BreadCrumbItem
                    route="/"
                    name={projectName}
                    projectId={projectId}
                    slug={currentProject ? currentProject.slug : null}
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ route: string; name: any; projectId: any; ... Remove this comment to see the full error message
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
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'tabIndex' does not exist on type 'Readon... Remove this comment to see the full error message
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
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'tabIndex' does not exist on type 'Readon... Remove this comment to see the full error message
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
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
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
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'requestingMonitorSla' does not exist on ... Remove this comment to see the full error message
                    {!this.props.requestingMonitorSla &&
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                        this.props.monitor &&
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                        (this.props.monitor.monitorSla ||
                            this.isDefaultMonitorSlaSet()) &&
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
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
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                {this.props.monitor
                                                    .monitorSla ? (
                                                    <span>
                                                        For the past{' '}
                                                        {
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
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
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'requestingMonitorSla' does not exist on ... Remove this comment to see the full error message
                    {!this.props.requestingMonitorSla &&
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                        this.props.monitor &&
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                        this.props.monitor.breachedMonitorSla &&
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
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
                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                {this.props.monitor
                                                    .monitorSla ? (
                                                    <span>
                                                        In the last{' '}
                                                        {
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
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
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                    {this.props.monitor &&
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                    this.props.monitor._id &&
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                    this.props.monitor.type &&
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                    (((this.props.monitor
                                                        .type === 'url' ||
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                        this.props.monitor
                                                            .type === 'api' ||
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                        this.props.monitor
                                                            .type === 'ip') &&
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'probeList' does not exist on type 'Reado... Remove this comment to see the full error message
                                                        !this.props.probeList
                                                            .requesting) ||
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                        (this.props.monitor
                                                            .type !== 'url' &&
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                            this.props.monitor
                                                                .type !==
                                                                'api' &&
                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
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
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'edit' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                                                    .edit &&
                                                                                !this
                                                                                    .props
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'requestingComponent' does not exist on t... Remove this comment to see the full error message
                                                                                    .requestingComponent
                                                                            }
                                                                        >
                                                                            <MonitorViewHeader
                                                                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ componentId: any; monitor: any; index: any... Remove this comment to see the full error message
                                                                                componentId={
                                                                                    this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
                                                                                        .componentId
                                                                                }
                                                                                monitor={
                                                                                    this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                                                        .monitor
                                                                                }
                                                                                index={
                                                                                    this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                                                        .monitor
                                                                                        ._id
                                                                                }
                                                                                componentSlug={
                                                                                    this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
                                                                                        .component &&
                                                                                    this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
                                                                                        .component
                                                                                        .slug
                                                                                }
                                                                            />
                                                                        </ShouldRender>
                                                                        <ShouldRender
                                                                            if={
                                                                                this
                                                                                    .props
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'edit' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                                                    .edit
                                                                            }
                                                                        >
                                                                            <NewMonitor
                                                                                {...this
                                                                                    .props}
                                                                                editMonitorProp={
                                                                                    this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                                                        .monitor
                                                                                }
                                                                                index={
                                                                                    this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                                                        .monitor
                                                                                        ._id
                                                                                }
                                                                                edit={
                                                                                    true
                                                                                }
                                                                                key={
                                                                                    this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                                                        .monitor
                                                                                        ._id
                                                                                }
                                                                                formKey={
                                                                                    this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
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
                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'requestingComponent' does not exist on t... Remove this comment to see the full error message
                                                                            .requestingComponent && (
                                                                            <MonitorViewIncidentBox
                                                                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ componentId: any; monitor: any; }' is not ... Remove this comment to see the full error message
                                                                                componentId={
                                                                                    this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
                                                                                        .componentId
                                                                                }
                                                                                monitor={
                                                                                    this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                                                        .monitor
                                                                                }
                                                                            />
                                                                        )}
                                                                    </div>
                                                                    <ShouldRender
                                                                        if={
                                                                            this
                                                                                .props
                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                                                .monitor &&
                                                                            this
                                                                                .props
                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                                                .monitor
                                                                                .type &&
                                                                            this
                                                                                .props
                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                                                .monitor
                                                                                .type ===
                                                                                'url' &&
                                                                            !this
                                                                                .props
                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'requestingComponent' does not exist on t... Remove this comment to see the full error message
                                                                                .requestingComponent
                                                                        }
                                                                    >
                                                                        <div className="Box-root Margin-bottom--12">
                                                                            <MonitorViewLighthouseLogsBox
                                                                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ componentId: any; monitor: any; componentS... Remove this comment to see the full error message
                                                                                componentId={
                                                                                    this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
                                                                                        .componentId
                                                                                }
                                                                                monitor={
                                                                                    this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                                                        .monitor
                                                                                }
                                                                                componentSlug={
                                                                                    this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
                                                                                        .component &&
                                                                                    this
                                                                                        .props
                                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
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
                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                                                .monitor &&
                                                                            this
                                                                                .props
                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                                                .monitor
                                                                                .type &&
                                                                            (this
                                                                                .props
                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                                                .monitor
                                                                                .type ===
                                                                                'url' ||
                                                                                this
                                                                                    .props
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                                                    .monitor
                                                                                    .type ===
                                                                                    'api' ||
                                                                                this
                                                                                    .props
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                                                    .monitor
                                                                                    .type ===
                                                                                    'server-monitor' ||
                                                                                this
                                                                                    .props
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                                                    .monitor
                                                                                    .type ===
                                                                                    'incomingHttpRequest' ||
                                                                                this
                                                                                    .props
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                                                    .monitor
                                                                                    .type ===
                                                                                    'kubernetes' ||
                                                                                this
                                                                                    .props
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                                                    .monitor
                                                                                    .type ===
                                                                                    'ip' ||
                                                                                this
                                                                                    .props
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
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
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
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
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
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
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
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
                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
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
                                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'requestingComponent' does not exist on t... Remove this comment to see the full error message
                                                                        .requestingComponent && (
                                                                        <>
                                                                            <div>
                                                                                <ThirdPartyVariables
                                                                                    monitor={
                                                                                        this
                                                                                            .props
                                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                                                            .monitor
                                                                                    }
                                                                                    componentId={
                                                                                        this
                                                                                            .props
                                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
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
                                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                                                            .monitor &&
                                                                                        this
                                                                                            .props
                                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                                                            .monitor
                                                                                            .type &&
                                                                                        this
                                                                                            .props
                                                                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                                                            .monitor
                                                                                            .type !==
                                                                                            'manual'
                                                                                    }
                                                                                >
                                                                                    <div className="Box-root Margin-bottom--12">
                                                                                        <MonitorViewDisableBox
                                                                                            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ componentId: any; monitor: any; tabSelecte... Remove this comment to see the full error message
                                                                                            componentId={
                                                                                                this
                                                                                                    .props
                                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
                                                                                                    .componentId
                                                                                            }
                                                                                            monitor={
                                                                                                this
                                                                                                    .props
                                                                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
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
                                                                                    // @ts-expect-error ts-migrate(2604) FIXME: JSX element type 'MonitorViewChangeComponentBox' d... Remove this comment to see the full error message
                                                                                    <MonitorViewChangeComponentBox
                                                                                        componentId={
                                                                                            this
                                                                                                .props
                                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
                                                                                                .componentId
                                                                                        }
                                                                                        monitor={
                                                                                            this
                                                                                                .props
                                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                                                                .monitor
                                                                                        }
                                                                                    />
                                                                                </div>
                                                                                <div className="Box-root Margin-bottom--12">
                                                                                    <MonitorViewDeleteBox
                                                                                        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ componentId: any; monitor: any; componentS... Remove this comment to see the full error message
                                                                                        componentId={
                                                                                            this
                                                                                                .props
                                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
                                                                                                .componentId
                                                                                        }
                                                                                        monitor={
                                                                                            this
                                                                                                .props
                                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitor' does not exist on type 'Readonl... Remove this comment to see the full error message
                                                                                                .monitor
                                                                                        }
                                                                                        componentSlug={
                                                                                            this
                                                                                                .props
                                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
                                                                                                .component &&
                                                                                            this
                                                                                                .props
                                                                                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
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

const mapStateToProps = (state: $TSFixMe, props: $TSFixMe) => {
    const scheduleWarning: $TSFixMe = [];
    const { monitorSlug, componentSlug } = props.match.params;
    const schedules = state.schedule.schedules;
    state.schedule.subProjectSchedules.forEach((item: $TSFixMe) => {
        item.schedules.forEach((item: $TSFixMe) => {
            item.monitorIds.forEach((monitor: $TSFixMe) => {
                scheduleWarning.push(monitor._id);
            });
        });
    });

    const component =
        state.component.currentComponent.component &&
        state.component.currentComponent.component;

    const projectId =
        state.project.currentProject && state.project.currentProject._id;
    const monitorCollection = state.monitor.monitorsList.monitors.find((el: $TSFixMe) => {
        return component && component.projectId._id === el._id;
    });
    const currentMonitor =
        monitorCollection &&
        monitorCollection.monitors.find((el: $TSFixMe) => {
            return el.slug === monitorSlug;
        });
    const monitorId = currentMonitor && currentMonitor._id;
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

    const initialValues = {};
    let currentMonitorCriteria = [];
    // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type '{}'.
    if (monitor && monitor._id) {
        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        initialValues[`name_${monitor._id}`] = monitor.name;
        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        initialValues[`url_${monitor._id}`] = monitor.data && monitor.data.url;
        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        initialValues[`deviceId_${monitor._id}`] =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type '{}'.
            monitor.data && monitor.data.deviceId;
        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        initialValues[`ip_${monitor._id}`] =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type '{}'.
            monitor.data && monitor.data.IPAddress;
        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        initialValues[`description_${monitor._id}`] =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type '{}'.
            monitor.data && monitor.data.description;
        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        initialValues[`subProject_${monitor._id}`] =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type '{}'.
            monitor.projectId._id || monitor.projectId;
        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        initialValues[`resourceCategory_${monitor._id}`] =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resourceCategory' does not exist on type... Remove this comment to see the full error message
            monitor.resourceCategory &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resourceCategory' does not exist on type... Remove this comment to see the full error message
            (monitor.resourceCategory._id || monitor.resourceCategory);

        const monitorSchedules: $TSFixMe = [];
        if (schedules && schedules.data) {
            schedules.data.forEach((schedule: $TSFixMe) => {
                monitorSchedules.push({
                    [schedule._id]: schedule.monitorIds.some(
                        // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type '{}'.
                        (monitorId: $TSFixMe) => monitorId._id === monitor._id
                    ),
                });
            });
        }
        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        initialValues[`callSchedules_${monitor._id}`] = monitorSchedules;
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentCommunicationSla' does not exist... Remove this comment to see the full error message
            monitor.incidentCommunicationSla &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentCommunicationSla' does not exist... Remove this comment to see the full error message
            monitor.incidentCommunicationSla._id
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentCommunicationSla' does not exist... Remove this comment to see the full error message
            initialValues.incidentCommunicationSla =
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentCommunicationSla' does not exist... Remove this comment to see the full error message
                monitor.incidentCommunicationSla._id;
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorSla' does not exist on type '{}'.
        if (monitor.monitorSla && monitor.monitorSla._id) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorSla' does not exist on type '{}'.
            initialValues.monitorSla = monitor.monitorSla._id;
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type '{}'.
        if (monitor.type === 'kubernetes') {
            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
            initialValues[`configurationFile_${monitor._id}`] =
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'kubernetesConfig' does not exist on type... Remove this comment to see the full error message
                monitor.kubernetesConfig;
            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
            initialValues[`kubernetesNamespace_${monitor._id}`] =
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'kubernetesNamespace' does not exist on t... Remove this comment to see the full error message
                monitor.kubernetesNamespace || 'default';
        }
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type '{}'.
            monitor.type === 'url' ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type '{}'.
            monitor.type === 'api' ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type '{}'.
            monitor.type === 'server-monitor' ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type '{}'.
            monitor.type === 'incomingHttpRequest' ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type '{}'.
            monitor.type === 'script' ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type '{}'.
            monitor.type === 'kubernetes' ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type '{}'.
            monitor.type === 'ip'
        ) {
            // collect all criteria
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'criteria' does not exist on type '{}'.
            if (monitor.criteria) {
                if (
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'criteria' does not exist on type '{}'.
                    monitor.criteria.up &&
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'criteria' does not exist on type '{}'.
                    monitor.criteria.down &&
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'criteria' does not exist on type '{}'.
                    monitor.criteria.degraded
                ) {
                    currentMonitorCriteria = [
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'criteria' does not exist on type '{}'.
                        ...monitor.criteria.up,
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'criteria' does not exist on type '{}'.
                        ...monitor.criteria.degraded,
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'criteria' does not exist on type '{}'.
                        ...monitor.criteria.down,
                    ].map((criterion, index) => {
                        const monitorUpCriteriaCount =
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'criteria' does not exist on type '{}'.
                            monitor.criteria.up.length;
                        const monitorDegradedCriteriaCount =
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'criteria' does not exist on type '{}'.
                            monitor.criteria.degraded.length;
                        const type =
                            index < monitorUpCriteriaCount
                                ? 'up'
                                : index <
                                  monitorUpCriteriaCount +
                                      monitorDegradedCriteriaCount
                                ? 'degraded'
                                : 'down';

                        const id = criterion._id;
                        const criterionBodyField = mapCriteria(criterion);
                        const criterionFieldName = `${type}_${id}`;
                        const scriptName =
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
                        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                        initialValues[criterionFieldName] = criterionBodyField;

                        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                        initialValues[`name_${criterionFieldName}`] =
                            criterion.name;
                        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                        initialValues[`incidentTitle_${criterionFieldName}`] =
                            criterion.title;
                        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                        initialValues[
                            `incidentDescription_${criterionFieldName}`
                        ] = criterion.description;
                        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                        initialValues[`createAlert_${criterionFieldName}`] =
                            criterion.createAlert;
                        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                        initialValues[`autoAcknowledge_${criterionFieldName}`] =
                            criterion.autoAcknowledge;
                        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                        initialValues[`autoResolve_${criterionFieldName}`] =
                            criterion.autoResolve;
                        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                        initialValues[
                            `script_${criterionFieldName}`
                        ] = scriptName;

                        // initialize schedules checkboxes for the criterions
                        /**
                         * @type Array.<String>
                         */
                        const criterionScheduleIds = criterion.scheduleIds;
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
                                const scheduleId = schedule._id;
                                criterionSchedules.push({
                                    [scheduleId]: criterionScheduleIds.includes(
                                        scheduleId
                                    ),
                                });
                            });
                            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type '{}'.
        if (monitor.type === 'api') {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'method' does not exist on type '{}'.
            if (monitor.method && monitor.method.length)
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                initialValues[`method_${monitor._id}`] = monitor.method;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'bodyType' does not exist on type '{}'.
            if (monitor.bodyType && monitor.bodyType.length)
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                initialValues[`bodyType_${monitor._id}`] = monitor.bodyType;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'text' does not exist on type '{}'.
            if (monitor.text && monitor.text.length)
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                initialValues[`text_${monitor._id}`] = monitor.text;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'formData' does not exist on type '{}'.
            if (monitor.formData && monitor.formData.length)
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                initialValues[`formData_${monitor._id}`] = monitor.formData;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'headers' does not exist on type '{}'.
            if (monitor.headers && monitor.headers.length)
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
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

const mapDispatchToProps = (dispatch: $TSFixMe) => {
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
MonitorView.displayName = 'MonitorView';

export default connect(mapStateToProps, mapDispatchToProps)(MonitorView);
