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
import IncidentStatus from '../components/incident/IncidentStatus';
import IncidentAlert from '../components/incident/IncidentAlert';
import SubscriberAlert from '../components/subscriber/subscriberAlert';
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
import {
    fetchIncidentTemplates,
    fetchDefaultTemplate,
} from '../actions/incidentBasicsSettings';
import { fetchDefaultCommunicationSla } from '../actions/incidentCommunicationSla';
import secondsToHms from '../utils/secondsToHms';
import { fetchComponent } from '../actions/component';
import HideIncidentBox from '../components/incident/HideIncidentBox';
import flat from '../utils/flattenArray';
import joinNames from '../utils/joinNames';
import { fetchProjectSlug } from '../actions/project';
import ShouldRender from '../components/basic/ShouldRender';

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
        this.ready();
    }
    componentDidUpdate(prevProps) {
        // if (
        //     // When multiple incidents are created and 'ViewIncident' is clicked for each of them, this allows the proper incident to load.
        //     prevProps.incidentId !== this.props.incidentId
        // ) {
        //     return this.ready();
        // }
        if (
            prevProps.projectId !== this.props.projectId ||
            (prevProps.incident && prevProps.incident._id) !==
                (this.props.incident && this.props.incident._id) ||
            prevProps.componentSlug !== this.props.componentSlug
        ) {
            // this.props.getIncident(this.props.projectId, this.props.incidentId);
            this.fetchAllIncidentData();
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

        if (prevProps.activeProjectId !== this.props.activeProjectId) {
            if (!this.props.componentSlug) {
                this.props.history.push(
                    `/dashboard/project/${this.props.currentProject.slug}/incidents`
                );
            }
        }
    }

    nextAlerts = () => {
        this.props.fetchIncidentAlert(
            this.props.projectId,
            this.props.incidentSlug,
            parseInt(this.props.skip, 10) + parseInt(this.props.limit, 10),
            parseInt(this.props.limit, 10)
        );
        this.setState({
            alertLogPage: this.state.alertLogPage + 1,
        });
    };

    previousAlerts = () => {
        this.props.fetchIncidentAlert(
            this.props.projectId,
            this.props.incidentSlug,
            parseInt(this.props.skip, 10) - parseInt(this.props.limit, 10),
            parseInt(this.props.limit, 10)
        );
        this.setState({
            alertLogPage: this.state.alertLogPage - 1,
        });
    };

    nextSubscribers = () => {
        this.props.fetchSubscriberAlert(
            this.props.projectId,
            this.props.incidentSlug,
            parseInt(this.props.subscribersAlerts.skip, 10) +
                parseInt(this.props.subscribersAlerts.limit, 10),
            parseInt(this.props.subscribersAlerts.limit, 10)
        );
        this.setState({
            subscribeAlertPage: this.state.subscribeAlertPage + 1,
        });
    };

    previousSubscribers = () => {
        this.props.fetchSubscriberAlert(
            this.props.projectId,
            this.props.incidentSlug,
            parseInt(this.props.subscribersAlerts.skip, 10) -
                parseInt(this.props.subscribersAlerts.limit, 10),
            parseInt(this.props.subscribersAlerts.limit, 10)
        );
        this.setState({
            subscribeAlertPage: this.state.subscribeAlertPage - 1,
        });
    };
    tabSelected = index => {
        const tabSlider = document.getElementById('tab-slider');
        tabSlider.style.transform = `translate(calc(${tabSlider.offsetWidth}px*${index}), 0px)`;
        this.setState({
            tabIndex: index,
        });
        if (index === 2) {
            this.props.fetchIncidentAlert(
                this.props.projectId,
                this.props.incidentSlug,
                0,
                10
            );
            this.props.fetchSubscriberAlert(
                this.props.projectId,
                this.props.incidentSlug,
                0,
                10
            );
        }
    };

    fetchAllIncidentData() {
        if (this.props.currentProject) {
            this.props.fetchIncidentPriorities(
                this.props.currentProject && this.props.currentProject._id,
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
        }

        this.props
            .getIncident(this.props.projectId, this.props.incidentSlug)
            .then(data => {
                if (data.data && data.data._id) {
                    this.props.getIncidentTimeline(
                        this.props.projectId,
                        data.data._id,
                        0,
                        10
                    );
                }
            });
        this.props.fetchIncidentAlert(
            this.props.projectId,
            this.props.incidentSlug,
            0,
            10
        );
        this.props.fetchSubscriberAlert(
            this.props.projectId,
            this.props.incidentSlug,
            0,
            10
        );

        const monitors =
            this.props.incident && this.props.incident.monitors
                ? this.props.incident.monitors.map(monitor => monitor.monitorId)
                : [];
        for (const monitor of monitors) {
            this.props.getMonitorLogs(
                this.props.projectId,
                monitor._id,
                0,
                10,
                null,
                null,
                null,
                null,
                monitor.type
            );
        }
        this.props.fetchIncidentMessages(
            this.props.projectId,
            this.props.incidentSlug,
            0,
            10
        );
        this.props.fetchIncidentMessages(
            this.props.projectId,
            this.props.incidentSlug,
            0,
            10,
            'internal'
        );
    }

    ready = () => {
        // const incidentId = this.props.incidentId;
        const {
            projectId,
            currentProject,
            componentSlug,
            fetchComponent,
            projectSlug,
            fetchProjectSlug,
            incidentSlug,
        } = this.props;

        fetchProjectSlug(projectSlug);

        if (currentProject && currentProject._id && componentSlug) {
            fetchComponent(currentProject._id, componentSlug);
        }
        if (projectId) {
            this.fetchAllIncidentData();
            this.props.fetchIncidentStatusPages(projectId, incidentSlug);
            this.props.fetchDefaultCommunicationSla(projectId);
        }
    };

    loader = () => (
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

    render() {
        let variable = null;
        const {
            currentProject,
            history,
            scheduleWarning,
            defaultSchedule,
            monitors,
            allMonitors,
            componentSlug,
            switchToProjectViewerNav,
        } = this.props;
        const slug = currentProject ? currentProject.slug : null;
        const redirectTo = `/dashboard/project/${slug}/on-call`;
        const {
            component,
            location: { pathname },
            requestingComponent,
        } = this.props;

        let scheduleAlert;

        const monitorList = monitors
            ? monitors.map(monitor => monitor.monitorId)
            : [];

        const incidentMonitors = [];
        const monitorIds = monitorList.map(monitor => String(monitor._id));
        allMonitors.forEach(monitor => {
            if (monitorIds.includes(String(monitor._id))) {
                incidentMonitors.push(monitor);
            }
        });

        const monitorWithoutSchedule = [];
        monitorList.forEach(monitor => {
            if (!scheduleWarning.includes(monitor._id)) {
                monitorWithoutSchedule.push(monitor.name);
            }
        });

        const monitorNames = joinNames(monitorWithoutSchedule);

        if (defaultSchedule !== true) {
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
                                        The monitor {monitorNames} does not have
                                        an on-call schedule. No Team Member will
                                        be alerted when incident is created.
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
                        <ShouldRender
                            if={
                                this.props.incident && !this.props.errorIncident
                            }
                        >
                            <div className="Flex-flex Flex-direction--columnReverse">
                                <TabList
                                    id="customTabList"
                                    className={'custom-tab-list'}
                                >
                                    <Tab
                                        className={
                                            'custom-tab custom-tab-6 bs-custom-incident-tab basic-tab'
                                        }
                                    >
                                        Basic
                                    </Tab>
                                    <Tab
                                        className={
                                            'custom-tab custom-tab-6 bs-custom-incident-tab monitor-tab'
                                        }
                                    >
                                        Monitor Logs
                                    </Tab>
                                    <Tab
                                        className={
                                            'custom-tab custom-tab-6 bs-custom-incident-tab alert-tab'
                                        }
                                    >
                                        Alert Logs
                                    </Tab>
                                    <Tab
                                        id="tab-advance"
                                        className={
                                            'custom-tab custom-tab-6 bs-custom-incident-tab advanced-tab'
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
                        </ShouldRender>
                        <div>{scheduleAlert}</div>
                        {this.props.incident &&
                            this.props.incident.countDown &&
                            this.props.incident.countDown !== '0' && (
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
                                                        According to the SLA
                                                        attached to this
                                                        incident, you need to
                                                        update the incident note
                                                        for this incident in{' '}
                                                        {secondsToHms(
                                                            this.props.incident
                                                                .countDown
                                                        )}
                                                    </span>
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        {this.props.incident &&
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
                                <ShouldRender
                                    if={
                                        !this.props.errorIncident &&
                                        this.props.incident
                                    }
                                >
                                    <IncidentStatus
                                        incident={this.props.incident}
                                        count={0}
                                        route={pathname}
                                        editable={true}
                                    />
                                    <IncidentInternal
                                        incident={this.props.incident}
                                    />
                                </ShouldRender>
                            </Fade>
                        </TabPanel>
                        <TabPanel>
                            <Fade>
                                {monitorList && monitorList.length > 1
                                    ? monitorList.map(monitor => (
                                          <div
                                              key={monitor._id}
                                              className="Box-root Margin-bottom--12"
                                          >
                                              <MonitorViewLogsBox
                                                  incidentId={
                                                      this.props.incident._id
                                                  }
                                                  monitorId={monitor._id}
                                                  monitorName={monitor.name}
                                                  monitorType={monitor.type}
                                                  agentless={
                                                      monitor &&
                                                      monitor.agentlessConfig
                                                  }
                                              />
                                          </div>
                                      ))
                                    : monitorList[0] && (
                                          <div
                                              key={monitorList[0]._id}
                                              className="Box-root Margin-bottom--12"
                                          >
                                              <MonitorViewLogsBox
                                                  incidentId={
                                                      this.props.incident._id
                                                  }
                                                  monitorId={monitorList[0]._id}
                                                  monitorName={
                                                      monitorList[0].name
                                                  }
                                                  monitorType={
                                                      monitorList[0].type
                                                  }
                                                  agentless={
                                                      monitorList[0] &&
                                                      monitorList[0]
                                                          .agentlessConfig
                                                  }
                                              />
                                          </div>
                                      )}
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
                                <RenderIfSubProjectAdmin>
                                    {!requestingComponent && (
                                        <>
                                            <HideIncidentBox
                                                incident={this.props.incident}
                                                currentProject={
                                                    this.props.currentProject
                                                }
                                            />
                                            <IncidentDeleteBox
                                                incident={this.props.incident}
                                                deleting={this.props.deleting}
                                                currentProject={
                                                    this.props.currentProject
                                                }
                                                componentSlug={
                                                    this.props.componentSlug
                                                }
                                                componentId={
                                                    this.props.componentId
                                                }
                                            />
                                        </>
                                    )}
                                </RenderIfSubProjectAdmin>
                            </Fade>
                        </TabPanel>
                    </Tabs>
                </div>
            );
        } else {
            variable = (
                <ShouldRender
                    if={this.props.errorIncident || !this.props.incident}
                >
                    <ShouldRender if={this.props.errorIncident}>
                        <div className="bs-ContentSection Card-root Card-shadow--medium Padding-horizontal--20 Padding-vertical--16 bs-u-center">
                            {this.props.errorIncident}
                        </div>
                    </ShouldRender>
                    <ShouldRender
                        if={this.props.successIncident && !this.props.incident}
                    >
                        <div className="bs-ContentSection Card-root Card-shadow--medium Padding-horizontal--20 Padding-vertical--16 bs-u-center">
                            This incident does not exists
                        </div>
                    </ShouldRender>
                </ShouldRender>
            );
        }
        const componentName = component ? component.name : '';
        const projectName = currentProject ? currentProject.name : '';
        const projectId = currentProject ? currentProject._id : '';
        return (
            <Fade>
                <BreadCrumbItem
                    route="/"
                    name={projectName}
                    projectId={projectId}
                    slug={currentProject ? currentProject.slug : null}
                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
                {componentSlug && componentName ? (
                    <>
                        <BreadCrumbItem
                            route={getParentRoute(pathname, null, 'incidents')}
                            name={componentName}
                        />
                        <BreadCrumbItem
                            route={getParentRoute(
                                pathname,
                                null,
                                'incident-log'
                            )}
                            name="Incident Log"
                        />
                        <BreadCrumbItem
                            route={pathname}
                            name="Incident"
                            containerType="Incident"
                        />
                    </>
                ) : (
                    <>
                        <BreadCrumbItem
                            route={getParentRoute(
                                pathname,
                                null,
                                'project-incidents'
                            )}
                            name="Incidents"
                        />
                        <BreadCrumbItem
                            route={pathname}
                            name="Incident"
                            containerType="Incident"
                        />
                    </>
                )}
                <div>
                    <div>
                        <div className="db-BackboneViewContainer">
                            <div className="react-settings-view react-view">
                                <span>
                                    <div>
                                        <div>
                                            {this.props.requestingIncident
                                                ? this.loader()
                                                : variable}
                                        </div>
                                    </div>
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </Fade>
        );
    }
}

const mapStateToProps = (state, props) => {
    const {
        componentSlug,
        incidentSlug,
        slug: projectSlug,
    } = props.match.params;

    const projectId = componentSlug
        ? state.component.currentComponent.component &&
          state.component.currentComponent.component.projectId._id
        : state.project.projectSlug.project &&
          state.project.projectSlug.project._id;

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

    let allMonitors =
        state.monitor &&
        state.monitor.monitorsList &&
        state.monitor.monitorsList.monitors
            .filter(monitorObj => String(monitorObj._id) === String(projectId))
            .map(monitorObj => monitorObj.monitors);
    allMonitors = flat(allMonitors);
    const monitors =
        state.incident &&
        state.incident.incident &&
        state.incident.incident.incident &&
        state.incident.incident.incident.monitors;

    return {
        defaultSchedule,
        scheduleWarning,
        currentProject: state.project.currentProject,
        incident: state.incident.incident.incident,
        requestingIncident: state.incident.incident.requesting,
        errorIncident: state.incident.incident.error,
        successIncident: state.incident.incident.success,
        incidentSlug,
        projectId,
        incidentTimeline: state.incident.incident,
        count: state.alert.incidentalerts.count,
        skip: state.alert.incidentalerts.skip,
        limit: state.alert.incidentalerts.limit,
        subscribersAlerts: state.alert.subscribersAlert,
        deleting: state.incident.incident.deleteIncident
            ? state.incident.incident.deleteIncident.requesting
            : false,
        requestingComponent: state.component.currentComponent.requesting,
        component:
            state.component && state.component.currentComponent.component,
        componentId:
            state.component.currentComponent.component &&
            state.component.currentComponent.component._id,
        componentSlug,
        requestingDefaultIncidentSla:
            state.incidentSla.defaultIncidentCommunicationSla.requesting,
        defaultIncidentSla:
            state.incidentSla.defaultIncidentCommunicationSla.sla,
        monitors,
        allMonitors,
        projectSlug,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
        activeProjectId: state.subProject.activeSubProject,
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
            fetchIncidentTemplates,
            fetchIncidentStatusPages,
            fetchDefaultCommunicationSla,
            fetchComponent,
            fetchProjectSlug,
            fetchDefaultTemplate,
        },
        dispatch
    );
};

Incident.propTypes = {
    currentProject: PropTypes.object,
    deleting: PropTypes.bool.isRequired,
    fetchIncidentAlert: PropTypes.func,
    fetchSubscriberAlert: PropTypes.func,
    getIncident: PropTypes.func,
    getIncidentTimeline: PropTypes.func,
    getMonitorLogs: PropTypes.func,
    incident: PropTypes.object,
    limit: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
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
    componentSlug: PropTypes.string,
    fetchIncidentMessages: PropTypes.func,
    fetchIncidentPriorities: PropTypes.func.isRequired,
    fetchIncidentTemplates: PropTypes.func.isRequired,
    fetchIncidentStatusPages: PropTypes.func.isRequired,
    fetchDefaultCommunicationSla: PropTypes.func,
    // defaultIncidentSla: PropTypes.oneOfType([
    //     PropTypes.object,
    //     PropTypes.oneOf([null, undefined]),
    // ]),
    history: PropTypes.func,
    scheduleWarning: PropTypes.array,
    defaultSchedule: PropTypes.bool,
    incidentSlug: PropTypes.string,
    projectId: PropTypes.string,
    fetchComponent: PropTypes.func,
    requestingComponent: PropTypes.bool,
    monitors: PropTypes.array,
    allMonitors: PropTypes.array,
    projectSlug: PropTypes.string,
    fetchProjectSlug: PropTypes.func,
    fetchDefaultTemplate: PropTypes.func,
    requestingIncident: PropTypes.bool,
    errorIncident: PropTypes.bool,
    successIncident: PropTypes.bool,
    switchToProjectViewerNav: PropTypes.bool,
    activeProjectId: PropTypes.string,
};

Incident.displayName = 'Incident';

export default connect(mapStateToProps, mapDispatchToProps)(Incident);
