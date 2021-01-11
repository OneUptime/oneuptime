import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { destroy } from 'redux-form';
import Fade from 'react-reveal/Fade';
import Dashboard from '../components/Dashboard';
import NewMonitor from '../components/monitor/NewMonitor';
import MonitorList from '../components/monitor/MonitorList';
import ShouldRender from '../components/basic/ShouldRender';
import IncidentStatus from '../components/incident/IncidentStatus';
import RenderIfSubProjectAdmin from '../components/basic/RenderIfSubProjectAdmin';
import RenderIfSubProjectMember from '../components/basic/RenderIfSubProjectMember';
import { LoadingState } from '../components/basic/Loader';
import TutorialBox from '../components/tutorial/TutorialBox';
import PropTypes from 'prop-types';
import {
    fetchMonitorLogs,
    fetchMonitorsIncidents,
    fetchMonitorStatuses,
    fetchLighthouseLogs,
} from '../actions/monitor';
import { loadPage } from '../actions/page';
import { fetchTutorial } from '../actions/tutorial';
import { getProbes } from '../actions/probe';
import RenderIfUserInSubProject from '../components/basic/RenderIfUserInSubProject';
import IsUserInSubProject from '../components/basic/IsUserInSubProject';
import { logEvent } from '../analytics';
import { SHOULD_LOG_ANALYTICS } from '../config';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import { fetchIncidentPriorities } from '../actions/incidentPriorities';
import { fetchBasicIncidentSettings } from '../actions/incidentBasicsSettings';
import { API_URL, User } from '../config';
import io from 'socket.io-client';
import CustomTutorial from '../components/tutorial/CustomTutorial';

const socket = io.connect(API_URL.replace('/api', ''), {
    path: '/api/socket.io',
});
class DashboardView extends Component {
    componentDidMount() {
        this.props.loadPage('Monitors');
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'PAGE VIEW: DASHBOARD > PROJECT > COMPONENT > MONITOR LIST'
            );
        }
    }

    componentDidUpdate(prevProps) {
        if (prevProps.monitor.monitorsList.monitors.length === 0) {
            this.props.monitor.monitorsList.monitors.forEach(subProject => {
                if (subProject.monitors.length > 0) {
                    subProject.monitors.forEach(monitor => {
                        this.props.fetchMonitorLogs(
                            monitor.projectId._id || monitor.projectId,
                            monitor._id,
                            this.props.startDate,
                            this.props.endDate
                        );
                        this.props.fetchMonitorsIncidents(
                            monitor.projectId._id || monitor.projectId,
                            monitor._id,
                            0,
                            3
                        );
                        this.props.fetchMonitorStatuses(
                            monitor.projectId._id || monitor.projectId,
                            monitor._id,
                            this.props.startDate,
                            this.props.endDate
                        );
                        if (
                            monitor.type === 'url' &&
                            monitor.data &&
                            monitor.data.url
                        ) {
                            this.props.fetchLighthouseLogs(
                                monitor.projectId._id || monitor.projectId,
                                monitor._id,
                                0,
                                1,
                                monitor.data.url
                            );
                        }
                    });
                }
            });
        }
    }

    componentWillUnmount() {
        this.props.destroy('NewMonitor');
        socket.removeListener(`createMonitor-${this.props.currentProject._id}`);
    }

    ready = () => {
        const projectId = this.props.currentProject
            ? this.props.currentProject._id
            : null;
        this.props.getProbes(projectId, 0, 10); //0 -> skip, 10-> limit.
        this.props.fetchIncidentPriorities(this.props.currentProject._id, 0, 0);
        this.props.fetchBasicIncidentSettings(this.props.currentProject._id);
        this.props.monitor.monitorsList.monitors.forEach(subProject => {
            if (subProject.monitors.length > 0) {
                subProject.monitors.forEach(monitor => {
                    this.props.fetchMonitorLogs(
                        monitor.projectId._id || monitor.projectId,
                        monitor._id,
                        this.props.startDate,
                        this.props.endDate
                    );
                    this.props.fetchMonitorsIncidents(
                        monitor.projectId._id || monitor.projectId,
                        monitor._id,
                        0,
                        3
                    );
                    this.props.fetchMonitorStatuses(
                        monitor.projectId._id || monitor.projectId,
                        monitor._id,
                        this.props.startDate,
                        this.props.endDate
                    );
                    if (
                        monitor.type === 'url' &&
                        monitor.data &&
                        monitor.data.url
                    ) {
                        this.props.fetchLighthouseLogs(
                            monitor.projectId._id || monitor.projectId,
                            monitor._id,
                            0,
                            1,
                            monitor.data.url
                        );
                    }
                });
            }
        });
    };

    render() {
        let incidentslist = null;
        const {
            componentId,
            subProjects,
            currentProject,
            location: { pathname },
            component,
        } = this.props;

        if (this.props.currentProject) {
            document.title = this.props.currentProject.name + ' Dashboard';
        }

        if (this.props.monitors.length) {
            const scriptElement = document.createElement('script');
            scriptElement.type = 'text/javascript';
            scriptElement.src = '/dashboard/assets/js/landing.base.js';
            document.head.appendChild(scriptElement);
        }

        let allMonitors = this.props.monitor.monitorsList.monitors
            .map(monitor => monitor.monitors)
            .flat();

        const monitorIds = allMonitors.map(monitor => monitor._id);

        if (this.props.incidents) {
            incidentslist = this.props.incidents
                .filter(incident => monitorIds.includes(incident.monitorId._id))
                .map((incident, i) => {
                    return (
                        <RenderIfUserInSubProject
                            key={`${incident._id || i}`}
                            subProjectId={
                                incident.projectId._id || incident.projectId
                            }
                        >
                            <IncidentStatus
                                count={i}
                                incident={incident}
                                multiple={true}
                                route={pathname}
                            />
                        </RenderIfUserInSubProject>
                    );
                });
        }
        const currentProjectId = currentProject ? currentProject._id : null;

        // SubProject Monitors List
        const monitors =
            subProjects &&
            subProjects.map((subProject, i) => {
                const subProjectMonitor = this.props.monitor.monitorsList.monitors.find(
                    subProjectMonitor =>
                        subProjectMonitor._id === subProject._id
                );
                allMonitors = IsUserInSubProject(subProject)
                    ? allMonitors
                    : allMonitors.filter(
                          monitor =>
                              monitor.projectId !== subProjectMonitor._id ||
                              monitor.projectId._id !== subProjectMonitor._id
                      );
                return subProjectMonitor &&
                    subProjectMonitor.monitors.length > 0 ? (
                    <div
                        id={`box_${subProject.name}`}
                        className="Box-root Margin-vertical--12"
                        key={i}
                    >
                        <div
                            className="db-Trends Card-root"
                            style={{ overflow: 'visible' }}
                        >
                            <MonitorList
                                componentId={componentId}
                                shouldRenderProjectType={
                                    subProjects && subProjects.length > 0
                                }
                                projectType={'subproject'}
                                projectName={subProject.name}
                                monitors={subProjectMonitor.monitors}
                            />
                        </div>
                    </div>
                ) : (
                    false
                );
            });

        // Add Project Monitors to Monitors List
        let projectMonitor = this.props.monitor.monitorsList.monitors.find(
            subProjectMonitor => subProjectMonitor._id === currentProjectId
        );
        allMonitors = IsUserInSubProject(currentProject)
            ? allMonitors
            : allMonitors.filter(
                  monitor =>
                      monitor.projectId !== currentProject._id ||
                      monitor.projectId._id !== currentProject._id
              );
        projectMonitor =
            projectMonitor && projectMonitor.monitors.length > 0 ? (
                <div
                    id={`box_${currentProject.name}`}
                    key={`box_${currentProject.name}`}
                    className="Box-root Margin-vertical--12"
                >
                    <div
                        className="db-Trends Card-root"
                        style={{ overflow: 'visible' }}
                    >
                        <MonitorList
                            componentId={componentId}
                            shouldRenderProjectType={
                                subProjects && subProjects.length > 0
                            }
                            projectType={'project'}
                            projectName={'Project'}
                            monitors={projectMonitor.monitors}
                        />
                    </div>
                </div>
            ) : (
                false
            );

        monitors && monitors.unshift(projectMonitor);
        const componentName = component ? component.name : '';

        return (
            <Dashboard ready={this.ready}>
                <Fade>
                    <BreadCrumbItem route={pathname} name={componentName} />
                    <BreadCrumbItem route={pathname + '#'} name="Monitors" />
                    <div className="Box-root">
                        <div>
                            <div>
                                <div className="db-BackboneViewContainer">
                                    <div className="dashboard-home-view react-view">
                                        <div>
                                            <div>
                                                <span>
                                                    <ShouldRender
                                                        if={
                                                            !this.props.monitor
                                                                .monitorsList
                                                                .requesting
                                                        }
                                                    >
                                                        {/* Here, component notifier */}
                                                        <CustomTutorial
                                                            monitors={
                                                                allMonitors
                                                            }
                                                            tutorialStat={
                                                                this.props
                                                                    .tutorialStat
                                                            }
                                                            currentProjectId={
                                                                currentProjectId
                                                            }
                                                            hideActionButton={
                                                                true
                                                            }
                                                        />
                                                        <ShouldRender
                                                            if={
                                                                (!this.props
                                                                    .tutorialStat
                                                                    .monitorCustom
                                                                    .show ||
                                                                    allMonitors.length >
                                                                        0) &&
                                                                this.props
                                                                    .tutorialStat
                                                                    .monitor
                                                                    .show
                                                            }
                                                        >
                                                            <TutorialBox
                                                                type="monitor"
                                                                currentProjectId={
                                                                    currentProjectId
                                                                }
                                                            />
                                                        </ShouldRender>

                                                        <div className="Box-root Margin-bottom--12">
                                                            {incidentslist}
                                                        </div>

                                                        {monitors}

                                                        <RenderIfSubProjectAdmin>
                                                            <NewMonitor
                                                                index={1000}
                                                                formKey="NewMonitorForm"
                                                                componentId={
                                                                    this.props
                                                                        .componentId
                                                                }
                                                            />
                                                        </RenderIfSubProjectAdmin>
                                                        <RenderIfSubProjectMember>
                                                            <ShouldRender
                                                                if={
                                                                    !this.props
                                                                        .monitor
                                                                        .monitorsList
                                                                        .requesting &&
                                                                    allMonitors.length ===
                                                                        0
                                                                }
                                                            >
                                                                <div
                                                                    id="app-loading"
                                                                    style={{
                                                                        position:
                                                                            'fixed',
                                                                        top:
                                                                            '0',
                                                                        bottom:
                                                                            '0',
                                                                        left:
                                                                            '0',
                                                                        right:
                                                                            '0',
                                                                        backgroundColor:
                                                                            '#fdfdfd',
                                                                        zIndex:
                                                                            '999',
                                                                        display:
                                                                            'flex',
                                                                        justifyContent:
                                                                            'center',
                                                                        alignItems:
                                                                            'center',
                                                                        flexDirection:
                                                                            'column',
                                                                    }}
                                                                >
                                                                    <div
                                                                        className="db-SideNav-icon db-SideNav-icon--atlas "
                                                                        style={{
                                                                            backgroundRepeat:
                                                                                'no-repeat',
                                                                            backgroundSize:
                                                                                '50px',
                                                                            height:
                                                                                '50px',
                                                                            width:
                                                                                '50px',
                                                                        }}
                                                                    ></div>
                                                                    <div
                                                                        style={{
                                                                            marginTop:
                                                                                '20px',
                                                                            fontSize:
                                                                                '16px',
                                                                        }}
                                                                    >
                                                                        No
                                                                        monitors
                                                                        are
                                                                        added to
                                                                        this
                                                                        project.
                                                                        Please
                                                                        contact
                                                                        your
                                                                        project
                                                                        admin.
                                                                    </div>
                                                                </div>
                                                            </ShouldRender>
                                                        </RenderIfSubProjectMember>
                                                    </ShouldRender>

                                                    <ShouldRender
                                                        if={
                                                            this.props.monitor
                                                                .monitorsList
                                                                .requesting
                                                        }
                                                    >
                                                        <LoadingState />
                                                    </ShouldRender>
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </Fade>
            </Dashboard>
        );
    }
}

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            destroy,
            fetchMonitorLogs,
            fetchMonitorsIncidents,
            fetchMonitorStatuses,
            fetchLighthouseLogs,
            fetchIncidentPriorities,
            fetchBasicIncidentSettings,
            loadPage,
            fetchTutorial,
            getProbes,
        },
        dispatch
    );
};

const mapStateToProps = (state, props) => {
    const { componentId } = props.match.params;
    const projectId = User.getCurrentProjectId()
        ? User.getCurrentProjectId()
        : null;

    const monitor = state.monitor;
    let component;
    state.component.componentList.components.forEach(item => {
        item.components.forEach(c => {
            if (String(c._id) === String(componentId)) {
                component = c;
            }
        });
    });

    monitor.monitorsList.monitors.forEach(item => {
        item.monitors = item.monitors.filter(
            monitor => monitor.componentId._id === componentId
        );
    });

    let subProjects = state.subProject.subProjects.subProjects;

    // sort subprojects names for display in alphabetical order
    const subProjectNames =
        subProjects && subProjects.map(subProject => subProject.name);
    subProjectNames && subProjectNames.sort();
    subProjects =
        subProjectNames &&
        subProjectNames.map(name =>
            subProjects.find(subProject => subProject.name === name)
        );
    // try to get custom project tutorial by project ID
    const projectCustomTutorial = state.tutorial[projectId];

    // set a default show to true for the tutorials to display
    const tutorialStat = {
        monitorCustom: { show: true },
        monitor: { show: true },
    };
    // loop through each of the tutorial stat, if they have a value based on the project id, replace it with it
    for (const key in tutorialStat) {
        if (projectCustomTutorial && projectCustomTutorial[key]) {
            tutorialStat[key].show = projectCustomTutorial[key].show;
        }
    }

    return {
        monitor,
        componentId,
        currentProject: state.project.currentProject,
        incidents: state.incident.unresolvedincidents.incidents,
        monitors: state.monitor.monitorsList.monitors,
        subProjects,
        startDate: state.monitor.monitorsList.startDate,
        endDate: state.monitor.monitorsList.endDate,
        component,
        tutorialStat,
        projectId,
    };
};

DashboardView.propTypes = {
    currentProject: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
    componentId: PropTypes.string,
    monitor: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
    monitors: PropTypes.oneOfType([
        PropTypes.array,
        PropTypes.oneOf([null, undefined]),
    ]),
    incidents: PropTypes.oneOfType([
        PropTypes.array,
        PropTypes.oneOf([null, undefined]),
    ]),
    loadPage: PropTypes.func,
    destroy: PropTypes.func.isRequired,
    fetchMonitorLogs: PropTypes.func,
    fetchMonitorsIncidents: PropTypes.func.isRequired,
    fetchMonitorStatuses: PropTypes.func.isRequired,
    fetchLighthouseLogs: PropTypes.func.isRequired,
    subProjects: PropTypes.array,
    getProbes: PropTypes.func,
    startDate: PropTypes.object,
    endDate: PropTypes.object,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    component: PropTypes.arrayOf(
        PropTypes.shape({
            name: PropTypes.string,
        })
    ),
    fetchIncidentPriorities: PropTypes.func.isRequired,
    fetchBasicIncidentSettings: PropTypes.func.isRequired,
    tutorialStat: PropTypes.object,
    projectId: PropTypes.string,
};

DashboardView.displayName = 'DashboardView';

export default connect(mapStateToProps, mapDispatchToProps)(DashboardView);
