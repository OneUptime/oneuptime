import React from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import Fade from 'react-reveal/Fade';
import {
    incidentRequest,
    incidentError,
    incidentSuccess,
    resetIncident,
    getIncident,
    getIncidentTimeline,
    fetchIncidentMessages,
} from '../actions/incident';
import { fetchIncidentStatusPages } from '../actions/statusPage';
import { fetchIncidentPriorities } from '../actions/incidentPriorities';
import { fetchIncidentAlert, fetchSubscriberAlert } from '../actions/alert';
import Dashboard from '../components/Dashboard';
import IncidentStatus from '../components/incident/IncidentStatus';
import IncidentAlert from '../components/incident/IncidentAlert';
import SubscriberAlert from '../components/subscriber/subscriberAlert';
import IncidentInvestigation from '../components/incident/IncidentInvestigation';
import IncidentInternal from '../components/incident/IncidentInternal';
import PropTypes from 'prop-types';
import IncidentDeleteBox from '../components/incident/IncidentDeleteBox';
import RenderIfSubProjectAdmin from '../components/basic/RenderIfSubProjectAdmin';
import MonitorViewLogsBox from '../components/monitor/MonitorViewLogsBox';
import { getMonitorLogs } from '../actions/monitor';
import { logEvent } from '../analytics';
import { SHOULD_LOG_ANALYTICS } from '../config';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import { Tab, Tabs, TabList, TabPanel, resetIdCounter } from 'react-tabs';
import { fetchBasicIncidentSettings } from '../actions/incidentBasicsSettings';
import IncidentStatusPages from '../components/incident/incidentStatusPages';
import { fetchDefaultCommunicationSla } from '../actions/incidentCommunicationSla';
import secondsToHms from '../utils/secondsToHms';

class Incident extends React.Component {
    constructor(props) {
        super(props);
        this.props = props;
        this.state = {
            tabIndex: 0,
            alertLogPage: 1,
            subscribeAlertPage: 1,
        };
    }

    componentWillMount() {
        resetIdCounter();
    }
    componentDidMount() {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent('PAGE VIEW: DASHBOARD > PROJECT > INCIDENT');
        }
    }
    componentDidUpdate(prevProps) {
        const previousIncidentId = prevProps.match.params.incidentId;
        const newIncidentId = this.props.match.params.incidentId;
        if (previousIncidentId !== newIncidentId) {
            this.fetchAllIncidentData();
        }
    }

    nextAlerts = () => {
        this.props.fetchIncidentAlert(
            this.props.match.params.projectId,
            this.props.match.params.incidentId,
            parseInt(this.props.skip, 10) + parseInt(this.props.limit, 10),
            parseInt(this.props.limit, 10)
        );
        this.setState({
            alertLogPage: this.state.alertLogPage + 1
        })
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > INCIDENT > NEXT ALERT CLICKED',
                {
                    projectId: this.props.match.params.projectId,
                    incidentId: this.props.match.params.incidentId,
                }
            );
        }
    };

    previousAlerts = () => {
        this.props.fetchIncidentAlert(
            this.props.match.params.projectId,
            this.props.match.params.incidentId,
            parseInt(this.props.skip, 10) - parseInt(this.props.limit, 10),
            parseInt(this.props.limit, 10)
        );
        this.setState({
            alertLogPage: this.state.alertLogPage - 1
        })
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > INCIDENT > PREVIOUS ALERT CLICKED',
                {
                    projectId: this.props.match.params.projectId,
                    incidentId: this.props.match.params.incidentId,
                }
            );
        }
    };

    nextTimeline = () => {
        this.props.getIncidentTimeline(
            this.props.match.params.projectId,
            this.props.match.params.incidentId,
            parseInt(this.props.incidentTimeline.skip, 10) +
                parseInt(this.props.incidentTimeline.limit, 10),
            parseInt(this.props.incidentTimeline.limit, 10)
        );
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > INCIDENT > NEXT TIMELINE CLICKED',
                {
                    projectId: this.props.match.params.projectId,
                    incidentId: this.props.match.params.incidentId,
                }
            );
        }
    };

    previousTimeline = () => {
        this.props.getIncidentTimeline(
            this.props.match.params.projectId,
            this.props.match.params.incidentId,
            parseInt(this.props.incidentTimeline.skip, 10) -
                parseInt(this.props.incidentTimeline.limit, 10),
            parseInt(this.props.incidentTimeline.limit, 10)
        );
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > INCIDENT > PREVIOUS TIMELINE CLICKED',
                {
                    projectId: this.props.match.params.projectId,
                    incidentId: this.props.match.params.incidentId,
                }
            );
        }
    };

    nextSubscribers = () => {
        this.props.fetchSubscriberAlert(
            this.props.match.params.projectId,
            this.props.match.params.incidentId,
            parseInt(this.props.subscribersAlerts.skip, 10) +
                parseInt(this.props.subscribersAlerts.limit, 10),
            parseInt(this.props.subscribersAlerts.limit, 10)
        );
        this.setState({
            subscribeAlertPage: this.state.subscribeAlertPage  + 1
        })
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > INCIDENT > NEXT SUBSCRIBER CLICKED',
                {
                    projectId: this.props.match.params.projectId,
                    incidentId: this.props.match.params.incidentId,
                }
            );
        }
    };

    previousSubscribers = () => {
        this.props.fetchSubscriberAlert(
            this.props.match.params.projectId,
            this.props.match.params.incidentId,
            parseInt(this.props.subscribersAlerts.skip, 10) -
                parseInt(this.props.subscribersAlerts.limit, 10),
            parseInt(this.props.subscribersAlerts.limit, 10)
        );
        this.setState({
            subscribeAlertPage: this.state.subscribeAlertPage  - 1
        })
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > INCIDENT > PREVIOUS SUBSCRIBER CLICKED',
                {
                    projectId: this.props.match.params.projectId,
                    incidentId: this.props.match.params.incidentId,
                }
            );
        }
    };
    tabSelected = index => {
        const tabSlider = document.getElementById('tab-slider');
        tabSlider.style.transform = `translate(calc(${tabSlider.offsetWidth}px*${index}), 0px)`;
        this.setState({
            tabIndex: index,
        });
        if (index === 2 || index === 0) {
            this.fetchAllIncidentData();
        }
    };

    fetchAllIncidentData() {
        this.props.fetchIncidentPriorities(this.props.currentProject._id, 0, 0);
        this.props.fetchBasicIncidentSettings(this.props.currentProject._id);
        const monitorId =
            this.props.incident &&
            this.props.incident.monitorId &&
            this.props.incident.monitorId._id
                ? this.props.incident.monitorId._id
                : null;

        this.props
            .getIncident(
                this.props.match.params.projectId,
                this.props.match.params.incidentId
            )
            .then(() => {
                this.props.getIncidentTimeline(
                    this.props.match.params.projectId,
                    this.props.match.params.incidentId,
                    0,
                    10
                );
            });
        this.props.fetchIncidentAlert(
            this.props.match.params.projectId,
            this.props.match.params.incidentId,
            0,
            10
        );
        this.props.fetchSubscriberAlert(
            this.props.match.params.projectId,
            this.props.match.params.incidentId,
            0,
            10
        );
        this.props.getMonitorLogs(
            this.props.match.params.projectId,
            monitorId,
            0,
            10,
            null,
            null,
            null,
            this.props.match.params.incidentId,
            this.props.type
        );
        this.props.fetchIncidentMessages(
            this.props.match.params.projectId,
            this.props.match.params.incidentId,
            0,
            10
        );
        this.props.fetchIncidentMessages(
            this.props.match.params.projectId,
            this.props.match.params.incidentId,
            0,
            10,
            'internal'
        );
    }

    ready = () => {
        const { projectId, incidentId } = this.props.match.params;
        this.fetchAllIncidentData();
        this.props.fetchIncidentStatusPages(projectId, incidentId);
        this.props.fetchDefaultCommunicationSla(projectId);
    };

    render() {
        let variable = null;
        const {
            currentProject,
            history,
            scheduleWarning,
            defaultSchedule,
        } = this.props;
        const projectId = currentProject ? currentProject._id : null;
        const redirectTo = `/dashboard/project/${projectId}/on-call`;
        const {
            component,
            location: { pathname },
        } = this.props;
        const monitorId =
            this.props.incident &&
            this.props.incident.monitorId &&
            this.props.incident.monitorId._id
                ? this.props.incident.monitorId._id
                : null;
        const monitorName =
            this.props.incident &&
            this.props.incident.monitorId &&
            this.props.incident.monitorId.name
                ? this.props.incident.monitorId.name
                : null;
        const monitorType =
            this.props.monitor && this.props.monitor.type
                ? this.props.monitor.type
                : '';
        const agentless =
            this.props.monitor && this.props.monitor.agentlessConfig;

        const incidentCommunicationSla =
            this.props.monitor &&
            (this.props.monitor.incidentCommunicationSla ||
                this.props.defaultIncidentSla);

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

        if (this.props.incident) {
            variable = (
                <div>
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
                                <Tab
                                    className={
                                        'custom-tab custom-tab-6 bs-custom-incident-tab'
                                    }
                                >
                                    Basic
                                </Tab>
                                <Tab
                                    className={
                                        'custom-tab custom-tab-6 bs-custom-incident-tab'
                                    }
                                >
                                    Monitor Logs
                                </Tab>
                                <Tab
                                    className={
                                        'custom-tab custom-tab-6 bs-custom-incident-tab'
                                    }
                                >
                                    Alert Logs
                                </Tab>
                                <Tab
                                    className={
                                        'custom-tab custom-tab-6 bs-custom-incident-tab'
                                    }
                                >
                                    Status Page Notes
                                </Tab>
                                <Tab
                                    id="tab-advance"
                                    className={
                                        'custom-tab custom-tab-6 bs-custom-incident-tab'
                                    }
                                >
                                    Advanced Options
                                </Tab>
                                <div
                                    id="tab-slider"
                                    className="custom-tab-6 bs-custom-incident-slider"
                                ></div>
                            </TabList>
                        </div>
                        <div>{scheduleAlert}</div>
                        {incidentCommunicationSla &&
                            this.props.incident &&
                            this.props.incident.countDown &&
                            this.props.incident.countDown !== '0:0' && (
                                <div
                                    className="Box-root Margin-vertical--12"
                                    style={{ marginTop: 0, cursor: 'pointer' }}
                                    id="slaIndicatorAlert"
                                >
                                    <div className="db-Trends bs-ContentSection Card-root Card-shadow--small">
                                        <div className="Box-root box__yellow--dark Card-shadow--medium Border-radius--4">
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
                                                    <span>
                                                        According to{' '}
                                                        {incidentCommunicationSla &&
                                                            incidentCommunicationSla.name}{' '}
                                                        SLA, you need to update
                                                        the incident note for
                                                        this incident in{' '}
                                                        {secondsToHms(
                                                            this.props.incident
                                                                .countDown
                                                        )}
                                                        {'. '} Click{' '}
                                                        <span
                                                            onClick={() =>
                                                                this.tabSelected(
                                                                    4
                                                                )
                                                            }
                                                            style={{
                                                                textDecoration:
                                                                    'underline',
                                                            }}
                                                        >
                                                            here
                                                        </span>{' '}
                                                        to update the incident
                                                        note
                                                    </span>
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        {incidentCommunicationSla &&
                            this.props.incident &&
                            this.props.incident.breachedCommunicationSla && (
                                <div
                                    className="Box-root Margin-vertical--12"
                                    style={{ marginTop: 0 }}
                                    id="slaBreachedIndicator"
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
                                                    <span>
                                                        You&#39;ve breached SLA
                                                        with this incident
                                                    </span>
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        <TabPanel>
                            <Fade>
                                <IncidentStatus
                                    incident={this.props.incident}
                                    count={0}
                                    route={pathname}
                                />
                                <IncidentInternal
                                    incident={this.props.incident}
                                />
                            </Fade>
                        </TabPanel>
                        <TabPanel>
                            <Fade>
                                <div className="Box-root Margin-bottom--12">
                                    <MonitorViewLogsBox
                                        incidentId={this.props.incident._id}
                                        monitorId={monitorId}
                                        monitorName={monitorName}
                                        monitorType={monitorType}
                                        agentless={agentless}
                                    />
                                </div>
                            </Fade>
                        </TabPanel>
                        <TabPanel>
                            <Fade>
                                <IncidentAlert
                                    next={this.nextAlerts}
                                    previous={this.previousAlerts}
                                    page={this.state.alertLogPage}
                                />

                                <SubscriberAlert
                                    next={this.nextSubscribers}
                                    previous={this.previousSubscribers}
                                    incident={this.props.incident}
                                    page={this.state.subscribeAlertPage}
                                />
                            </Fade>
                        </TabPanel>
                        <TabPanel>
                            <Fade>
                                <IncidentStatusPages />
                                <IncidentInvestigation
                                    incident={this.props.incident}
                                />
                            </Fade>
                        </TabPanel>
                        <TabPanel>
                            <Fade>
                                <RenderIfSubProjectAdmin>
                                    <IncidentDeleteBox
                                        incident={this.props.incident}
                                        deleting={this.props.deleting}
                                        currentProject={
                                            this.props.currentProject
                                        }
                                        component={this.props.component}
                                        componentId={this.props.componentId}
                                    />
                                </RenderIfSubProjectAdmin>
                            </Fade>
                        </TabPanel>
                    </Tabs>
                </div>
            );
        } else {
            variable = (
                <div
                    id="app-loading"
                    style={{
                        position: 'fixed',
                        top: '0',
                        bottom: '0',
                        left: '0',
                        right: '0',
                        backgroundColor: '#fdfdfd',
                        zIndex: '999',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                    }}
                >
                    <div style={{ transform: 'scale(2)' }}>
                        <svg
                            viewBox="0 0 24 24"
                            xmlns="http://www.w3.org/2000/svg"
                            className="bs-Spinner-svg"
                        >
                            <ellipse
                                cx="12"
                                cy="12"
                                rx="10"
                                ry="10"
                                className="bs-Spinner-ellipse"
                            ></ellipse>
                        </svg>
                    </div>
                </div>
            );
        }
        const componentName = component ? component.name : '';

        return (
            <Dashboard ready={this.ready}>
                <Fade>
                    <BreadCrumbItem
                        route={getParentRoute(pathname, null, 'incidents')}
                        name={componentName}
                    />
                    <BreadCrumbItem
                        route={getParentRoute(pathname, null, 'incident-log')}
                        name="Incident Log"
                    />
                    <BreadCrumbItem
                        route={pathname}
                        name="Incident"
                        containerType="Incident"
                    />
                    <div>
                        <div>
                            <div className="db-BackboneViewContainer">
                                <div className="react-settings-view react-view">
                                    <span>
                                        <div>
                                            <div>{variable}</div>
                                        </div>
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </Fade>
            </Dashboard>
        );
    }
}

const mapStateToProps = (state, props) => {
    const scheduleWarning = [];
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
    const { componentId } = props.match.params;
    const monitorId =
        state.incident &&
        state.incident.incident &&
        state.incident.incident.incident &&
        state.incident.incident.incident.monitorId &&
        state.incident.incident.incident.monitorId._id
            ? state.incident.incident.incident.monitorId._id
            : null;
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
    return {
        defaultSchedule,
        scheduleWarning,
        monitor,
        type: monitor && monitor.type ? monitor.type : null,
        currentProject: state.project.currentProject,
        incident: state.incident.incident.incident,
        incidentTimeline: state.incident.incident,
        count: state.alert.incidentalerts.count,
        skip: state.alert.incidentalerts.skip,
        limit: state.alert.incidentalerts.limit,
        subscribersAlerts: state.alert.subscribersAlert,
        deleting: state.incident.incident.deleteIncident
            ? state.incident.incident.deleteIncident.requesting
            : false,
        component,
        componentId,
        requestingDefaultIncidentSla:
            state.incidentSla.defaultIncidentCommunicationSla.requesting,
        defaultIncidentSla:
            state.incidentSla.defaultIncidentCommunicationSla.sla,
    };
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            getMonitorLogs,
            fetchIncidentAlert,
            fetchSubscriberAlert,
            incidentRequest,
            incidentError,
            incidentSuccess,
            resetIncident,
            getIncident,
            getIncidentTimeline,
            fetchIncidentMessages,
            fetchIncidentPriorities,
            fetchBasicIncidentSettings,
            fetchIncidentStatusPages,
            fetchDefaultCommunicationSla,
        },
        dispatch
    );
};

Incident.propTypes = {
    monitor: PropTypes.object,
    currentProject: PropTypes.object,
    deleting: PropTypes.bool.isRequired,
    fetchIncidentAlert: PropTypes.func,
    fetchSubscriberAlert: PropTypes.func,
    getIncident: PropTypes.func,
    getIncidentTimeline: PropTypes.func,
    getMonitorLogs: PropTypes.func,
    incident: PropTypes.object,
    incidentTimeline: PropTypes.object,
    limit: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    match: PropTypes.object,
    skip: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    subscribersAlerts: PropTypes.object.isRequired,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    component: PropTypes.arrayOf(
        PropTypes.shape({
            name: PropTypes.string,
            _id: PropTypes.string,
        })
    ),
    componentId: PropTypes.string,
    fetchIncidentMessages: PropTypes.func,
    fetchIncidentPriorities: PropTypes.func.isRequired,
    fetchBasicIncidentSettings: PropTypes.func.isRequired,
    fetchIncidentStatusPages: PropTypes.func.isRequired,
    fetchDefaultCommunicationSla: PropTypes.func,
    defaultIncidentSla: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
    history: PropTypes.func,
    scheduleWarning: PropTypes.array,
    defaultSchedule: PropTypes.bool,
    type: PropTypes.string,
};

Incident.displayName = 'Incident';

export default connect(mapStateToProps, mapDispatchToProps)(Incident);
