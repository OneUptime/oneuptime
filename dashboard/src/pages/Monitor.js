import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { destroy } from 'redux-form';
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
import { fetchMonitorsIncidents, fetchMonitors } from '../actions/monitor';
import { loadPage } from '../actions/page';
import { fetchTutorial } from '../actions/tutorial';
import { getProbes } from '../actions/probe';
import RenderIfUserInSubProject from '../components/basic/RenderIfUserInSubProject';
import Badge from '../components/common/Badge';
import IsUserInSubProject from '../components/basic/IsUserInSubProject';
import { logEvent } from '../analytics';
import { IS_DEV } from '../config';

class DashboardView extends Component {

    componentDidMount() {
        this.props.loadPage('Monitors');
        if (!IS_DEV) {
            logEvent('Main monitor page Loaded');
        }
    }

    componentWillUnmount() {
        this.props.destroy('NewMonitor');
    }

    ready = () => {
        const projectId = this.props.currentProject ? this.props.currentProject._id : null;
        this.props.fetchMonitors(projectId).then(() => {
            this.props.monitor.monitorsList.monitors.forEach((subProject) => {
                if (subProject.monitors.length > 0) {
                    subProject.monitors.forEach((monitor) => {
                        this.props.fetchMonitorsIncidents(monitor.projectId._id || monitor.projectId, monitor._id, 0, 3);
                    });
                }
            });
        });
        this.props.fetchTutorial();
        this.props.getProbes(projectId, 0, 10); //0 -> skip, 10-> limit.
    }

    render() {
        let isNewMonitorVisible = true;
        let incidentslist = null;

        if (this.props.currentProject) {
            document.title = this.props.currentProject.name + ' Dashboard';
        }

        if (this.props.monitors.length) {
            var scriptElement = document.createElement('script');
            scriptElement.type = 'text/javascript';
            scriptElement.src = '/assets/js/landing.base.js';
            document.head.appendChild(scriptElement);
        }

        if (this.props.monitor && this.props.monitor.monitorsList && this.props.monitor.monitorsList.monitors && this.props.monitor.monitorsList.monitors.length > 0) {
            this.props.monitor.monitorsList.monitors.map((subProjectMonitor) => {
                return subProjectMonitor && subProjectMonitor.monitors && subProjectMonitor.monitors.map(monitor => {
                    if (monitor.editMode) {
                        isNewMonitorVisible = false;
                    }

                    return monitor;
                });
            });
        }

        if (this.props.incidents) {
            incidentslist = this.props.incidents.map((incident, i) => {
                return (
                    <RenderIfUserInSubProject key={`${incident._id || i}`} subProjectId={incident.projectId._id || incident.projectId}>
                        <IncidentStatus count={i} incident={incident} multiple={true} />
                    </RenderIfUserInSubProject>
                )
            })
        }

        const { subProjects, currentProject } = this.props;
        const currentProjectId = currentProject ? currentProject._id : null;
        var allMonitors = this.props.monitor.monitorsList.monitors.map(monitor => monitor.monitors).flat();

        // SubProject Monitors List
        const monitors = subProjects && subProjects.map((subProject, i) => {
            const subProjectMonitor = this.props.monitor.monitorsList.monitors.find(subProjectMonitor => subProjectMonitor._id === subProject._id)
            allMonitors = IsUserInSubProject(subProject) ? allMonitors : allMonitors.filter(monitor => monitor.projectId !== subProjectMonitor._id || monitor.projectId._id !== subProjectMonitor._id)
            return subProjectMonitor && subProjectMonitor.monitors.length > 0 ? (
                <div id={`box_${subProject.name}`} className="Box-root Margin-vertical--12" key={i}>
                    <div className="db-Trends Card-root" style={{ 'overflow': 'visible' }}>
                        <ShouldRender if={subProjects && subProjects.length > 0}>
                            <div className="Box-root Padding-top--20 Padding-left--20">
                                <Badge id={`badge_${subProject.name}`} color={'blue'}>{subProject.name}</Badge>
                            </div>
                        </ShouldRender>
                        <MonitorList monitors={subProjectMonitor.monitors} />
                    </div>
                </div>
            ) : false;
        });

        // Add Project Monitors to Monitors List
        var projectMonitor = this.props.monitor.monitorsList.monitors.find(subProjectMonitor => subProjectMonitor._id === currentProjectId)
        allMonitors = IsUserInSubProject(currentProject) ? allMonitors : allMonitors.filter(monitor => monitor.projectId !== currentProject._id || monitor.projectId._id !== currentProject._id)
        projectMonitor = projectMonitor && projectMonitor.monitors.length > 0 ? (
            <div id={`box_${currentProject.name}`} key={`box_${currentProject.name}`} className="Box-root Margin-vertical--12">
                <div className="db-Trends Card-root" style={{ 'overflow': 'visible' }}>
                    <ShouldRender if={subProjects && subProjects.length > 0}>
                        <div className="Box-root Padding-top--20 Padding-left--20">
                            <Badge id={`badge_${currentProject.name}`} color={'red'}>Project</Badge>
                        </div>
                    </ShouldRender>
                    <MonitorList monitors={projectMonitor.monitors} />
                </div>
            </div>
        ) : false;

        monitors && monitors.unshift(projectMonitor);

        return (
            <Dashboard ready={this.ready}>
                <div className="Box-root">
                    <div>
                        <div>
                            <div className="db-BackboneViewContainer">
                                <div className="dashboard-home-view react-view">
                                    <div>
                                        <div>
                                            <span>
                                                <ShouldRender if={!this.props.monitor.monitorsList.requesting}>
                                                    <ShouldRender if={this.props.monitorTutorial.show}>
                                                        <TutorialBox type="monitor" />
                                                    </ShouldRender>

                                                    <div className="Box-root Margin-bottom--12">
                                                        {incidentslist}
                                                    </div>

                                                    {
                                                        monitors
                                                    }

                                                    <RenderIfSubProjectAdmin>
                                                        <ShouldRender if={isNewMonitorVisible}>
                                                            <NewMonitor index={1000} formKey="NewMonitorForm" />
                                                        </ShouldRender>
                                                    </RenderIfSubProjectAdmin>

                                                    <RenderIfSubProjectMember>
                                                        <ShouldRender if={!this.props.monitor.monitorsList.requesting && allMonitors.length === 0 && isNewMonitorVisible === false}>
                                                            <div
                                                                id="app-loading"
                                                                style={{ 'position': 'fixed', 'top': '0', 'bottom': '0', 'left': '0', 'right': '0', 'backgroundColor': '#fbfbfb', 'zIndex': '999', 'display': 'flex', 'justifyContent': 'center', 'alignItems': 'center', 'flexDirection': 'column' }}
                                                            >
                                                                <div
                                                                    className="db-SideNav-icon db-SideNav-icon--atlas "
                                                                    style={{ 'backgroundRepeat': 'no-repeat', 'backgroundSize': '50px', 'height': '50px', 'width': '50px' }}
                                                                ></div>
                                                                <div style={{ 'marginTop': '20px', 'fontSize': '16px' }}>
                                                                    No monitors are added to this project. Please contact your project admin.
                                                                </div>
                                                            </div>
                                                        </ShouldRender>
                                                    </RenderIfSubProjectMember>

                                                </ShouldRender>

                                                <ShouldRender if={this.props.monitor.monitorsList.requesting}>
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
            </Dashboard>
        );
    }
}

const mapDispatchToProps = (dispatch) => {
    return bindActionCreators({
        destroy,
        fetchMonitorsIncidents,
        fetchMonitors,
        loadPage,
        fetchTutorial,
        getProbes
    }, dispatch);
};

const mapStateToProps = state => {
    const monitor = state.monitor;
    var subProjects = state.subProject.subProjects.subProjects;

    // sort subprojects names for display in alphabetical order
    const subProjectNames = subProjects && subProjects.map(subProject => subProject.name);
    subProjectNames && subProjectNames.sort();
    subProjects = subProjectNames && subProjectNames.map(name => subProjects.find(subProject => subProject.name === name))

    const initialValues = {
        name_1000: '',
        url_1000: '',
        deviceId_1000: ''
    };

    monitor.monitorsList.monitors.forEach((subProjectMonitors) => {
        subProjectMonitors && subProjectMonitors.monitors.forEach((monitor) => {
            initialValues[`name_${monitor._id}`] = monitor.name;
            initialValues[`url_${monitor._id}`] = monitor.data && monitor.data.url;
            initialValues[`deviceId_${monitor._id}`] = monitor.data && monitor.data.deviceId;
        });
    });

    return {
        monitor,
        initialValues,
        currentProject: state.project.currentProject,
        incidents: state.incident.unresolvedincidents.incidents,
        monitors: state.monitor.monitorsList.monitors,
        subProjects,
        monitorTutorial: state.tutorial.monitor
    };
};

DashboardView.propTypes = {
    currentProject: PropTypes.oneOfType(
        [
            PropTypes.object,
            PropTypes.oneOf([null, undefined])
        ]
    ),
    monitor: PropTypes.oneOfType(
        [
            PropTypes.object,
            PropTypes.oneOf([null, undefined])
        ]
    ),
    monitors: PropTypes.oneOfType(
        [
            PropTypes.array,
            PropTypes.oneOf([null, undefined])
        ]
    ),
    incidents: PropTypes.oneOfType(
        [
            PropTypes.array,
            PropTypes.oneOf([null, undefined])
        ]
    ),
    loadPage: PropTypes.func,
    destroy: PropTypes.func.isRequired,
    fetchMonitorsIncidents: PropTypes.func.isRequired,
    fetchMonitors: PropTypes.func.isRequired,
    subProjects: PropTypes.array,
    monitorTutorial: PropTypes.object,
    fetchTutorial: PropTypes.func,
    getProbes: PropTypes.func,
};

DashboardView.displayName = 'DashboardView';

export default connect(mapStateToProps, mapDispatchToProps)(DashboardView);