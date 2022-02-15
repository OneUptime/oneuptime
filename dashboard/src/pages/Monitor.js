import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { destroy } from 'redux-form';
import Fade from 'react-reveal/Fade';
import ComponentSummary from '../components/component/ComponentSummary';
import NewMonitor from '../components/monitor/NewMonitor';
import MonitorList from '../components/monitor/MonitorList';
import ShouldRender from '../components/basic/ShouldRender';
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
    fetchMonitors,
    fetchPaginatedMonitors,
} from '../actions/monitor';
import { fetchComponentSummary, fetchComponent } from '../actions/component';
import { loadPage } from '../actions/page';
import { fetchTutorial } from '../actions/tutorial';
import { getProbes } from '../actions/probe';
import IsUserInSubProject from '../components/basic/IsUserInSubProject';
import { logEvent } from '../analytics';
import { SHOULD_LOG_ANALYTICS } from '../config';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import { fetchIncidentPriorities } from '../actions/incidentPriorities';
import {
    fetchIncidentTemplates,
    fetchDefaultTemplate,
} from '../actions/incidentBasicsSettings';
import CustomTutorial from '../components/tutorial/CustomTutorial';
// import { socket } from '../components/basic/Socket';

class MonitorDashboardView extends Component {
    state = {
        showNewMonitorForm: false,
        page: 1,
    };

    prevClicked = (projectId, skip, limit) => {
        this.props
            .fetchPaginatedMonitors({
                projectId,
                skip: (skip || 0) > (limit || 5) ? skip - limit : 0,
                limit,
                componentSlug: this.props.componentSlug,
                paginate: true,
            })
            .then(() => {
                this.setState(prevState => {
                    return {
                        page:
                            prevState.page === 1
                                ? prevState.page
                                : prevState.page - 1,
                    };
                });
            });
    };

    nextClicked = (projectId, skip, limit) => {
        this.props
            .fetchPaginatedMonitors({
                projectId,
                skip: skip + limit,
                limit,
                componentSlug: this.props.componentSlug,
                paginate: true,
            })
            .then(() => {
                this.setState(prevState => {
                    return {
                        page: prevState.page + 1,
                    };
                });
            });
    };

    componentDidMount() {
        this.props.loadPage('Monitors');

        this.ready();
    }

    fetchMonitorResources = () => {
        this.props.monitor.paginatedMonitorsList.monitors.forEach(
            subProject => {
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
            }
        );
    };

    componentDidUpdate(prevProps) {
        if (
            JSON.stringify(prevProps.monitor.paginatedMonitorsList.monitors) !==
            JSON.stringify(this.props.monitor.paginatedMonitorsList.monitors)
        ) {
            this.fetchMonitorResources();
        }
        if (
            String(prevProps.componentSlug) !==
                String(this.props.componentSlug) ||
            JSON.stringify(prevProps.currentProject) !==
                JSON.stringify(this.props.currentProject)
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

    componentWillUnmount() {
        this.props.destroy('NewMonitor');
        // socket.removeListener(`createMonitor-${this.props.currentProject._id}`);
    }

    toggleForm = () =>
        this.setState(prevState => ({
            showNewMonitorForm: !prevState.showNewMonitorForm,
        }));

    ready = () => {
        const projectId = this.props.currentProject
            ? this.props.currentProject._id
            : null;
        if (projectId && this.props.componentSlug) {
            this.props.fetchComponent(projectId, this.props.componentSlug);
        }
        this.props.getProbes(projectId, 0, 10); //0 -> skip, 10-> limit.
        if (this.props.currentProject) {
            this.props.fetchIncidentPriorities(
                this.props.currentProject._id || this.props.currentProject,
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

        this.props.fetchPaginatedMonitors({
            projectId,
            skip: 0,
            limit: 5,
            componentSlug: this.props.componentSlug,
        });
    };

    render() {
        const {
            componentId,
            subProjects,
            currentProject,
            location: { pathname },
            component,
            fetchComponentSummary,
            componentSummaryObj,
            switchToProjectViewerNav,
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

        const monitor = this.props.monitor;
        if (component && component._id) {
            monitor.paginatedMonitorsList.monitors.forEach(item => {
                item.monitors = item.monitors.filter(
                    monitor => monitor.componentId._id === component._id
                );
            });
        }

        let allMonitors = monitor.paginatedMonitorsList.monitors
            .map(monitor => monitor.monitors)
            .flat();

        const currentProjectId = currentProject ? currentProject._id : null;
        const currentProjectSlug = currentProject ? currentProject.slug : null;

        // SubProject Monitors List
        let monitors =
            subProjects &&
            subProjects.map((subProject, i) => {
                const subProjectMonitor = this.props.monitor.paginatedMonitorsList.monitors.find(
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
                                projectId={subProject._id}
                                skip={subProjectMonitor.skip}
                                limit={subProjectMonitor.limit}
                                count={subProjectMonitor.count}
                                requesting={
                                    this.props.monitor.paginatedMonitorsList
                                        .requesting
                                }
                                error={
                                    this.props.monitor.paginatedMonitorsList
                                        .error
                                }
                                page={this.state.page}
                                prevClicked={this.prevClicked}
                                nextClicked={this.nextClicked}
                                requestingNextPage={
                                    this.props.monitor.paginatedMonitorsList
                                        .requestingNextPage
                                }
                            />
                        </div>
                    </div>
                ) : (
                    false
                );
            });

        // Add Project Monitors to Monitors List
        let projectMonitor = this.props.monitor.paginatedMonitorsList.monitors.find(
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
                            projectId={currentProject._id}
                            skip={projectMonitor.skip}
                            limit={projectMonitor.limit}
                            count={projectMonitor.count}
                            requesting={
                                this.props.monitor.paginatedMonitorsList
                                    .requesting
                            }
                            error={
                                this.props.monitor.paginatedMonitorsList.error
                            }
                            page={this.state.page}
                            prevClicked={this.prevClicked}
                            nextClicked={this.nextClicked}
                            requestingNextPage={
                                this.props.monitor.paginatedMonitorsList
                                    .requestingNextPage
                            }
                        />
                    </div>
                </div>
            ) : (
                false
            );

        monitors && projectMonitor && monitors.unshift(projectMonitor);
        monitors = monitors.filter(
            monitor => monitor && typeof monitor === 'object'
        );
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
                <BreadCrumbItem route={pathname} name={componentName} />
                <BreadCrumbItem
                    route={pathname + '#'}
                    name={
                        this.state.showNewMonitorForm ||
                        !monitors ||
                        monitors.length === 0 ||
                        monitors[0] === false
                            ? 'New Monitor Form'
                            : 'Monitors'
                    }
                    pageTitle="Monitors"
                    addBtn={monitors.length > 0 && monitors[0] !== false}
                    btnText="Create New Monitor"
                    toggleForm={this.toggleForm}
                />
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
                                                            .paginatedMonitorsList
                                                            .requesting
                                                    }
                                                >
                                                    {/* Here, component notifier */}
                                                    <CustomTutorial
                                                        monitors={allMonitors}
                                                        slug={
                                                            currentProjectSlug
                                                        }
                                                        tutorialStat={
                                                            this.props
                                                                .tutorialStat
                                                        }
                                                        currentProjectId={
                                                            currentProjectId
                                                        }
                                                        hideActionButton={true}
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
                                                                .monitor.show
                                                        }
                                                    >
                                                        <TutorialBox
                                                            type="monitor"
                                                            currentProjectId={
                                                                currentProjectId
                                                            }
                                                        />
                                                    </ShouldRender>

                                                    <ShouldRender
                                                        if={
                                                            !this.state
                                                                .showNewMonitorForm &&
                                                            monitors &&
                                                            monitors.length >
                                                                0 &&
                                                            monitors[0] !==
                                                                false
                                                        }
                                                    >
                                                        <ComponentSummary
                                                            projectId={
                                                                currentProjectId
                                                            }
                                                            componentId={
                                                                componentId
                                                            }
                                                            fetchSummary={
                                                                fetchComponentSummary
                                                            }
                                                            summary={
                                                                componentSummaryObj.data
                                                            }
                                                            loading={
                                                                componentSummaryObj.requesting
                                                            }
                                                        />
                                                    </ShouldRender>

                                                    {!this.state
                                                        .showNewMonitorForm &&
                                                        monitors &&
                                                        monitors.length > 0 &&
                                                        monitors}

                                                    <RenderIfSubProjectAdmin>
                                                        <ShouldRender
                                                            if={
                                                                this.state
                                                                    .showNewMonitorForm ||
                                                                !monitors ||
                                                                monitors.length ===
                                                                    0 ||
                                                                monitors[0] ===
                                                                    false
                                                            }
                                                        >
                                                            <NewMonitor
                                                                index={1000}
                                                                formKey="NewMonitorForm"
                                                                componentId={
                                                                    this.props
                                                                        .componentId
                                                                }
                                                                componentSlug={
                                                                    this.props
                                                                        .component &&
                                                                    this.props
                                                                        .component
                                                                        .slug
                                                                }
                                                                showCancelBtn={
                                                                    monitors.length >
                                                                        0 &&
                                                                    monitors[0] !==
                                                                        false
                                                                }
                                                                toggleForm={
                                                                    this
                                                                        .toggleForm
                                                                }
                                                            />
                                                        </ShouldRender>
                                                    </RenderIfSubProjectAdmin>
                                                    <RenderIfSubProjectMember>
                                                        <ShouldRender
                                                            if={
                                                                !this.props
                                                                    .monitor
                                                                    .paginatedMonitorsList
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
                                                                    top: '0',
                                                                    bottom: '0',
                                                                    left: '0',
                                                                    right: '0',
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
                                                                    No monitors
                                                                    are added to
                                                                    this
                                                                    project.
                                                                    Please
                                                                    contact your
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
                                                            .paginatedMonitorsList
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
            fetchIncidentTemplates,
            loadPage,
            fetchTutorial,
            getProbes,
            fetchComponentSummary,
            fetchComponent,
            fetchMonitors,
            fetchDefaultTemplate,
            fetchPaginatedMonitors,
        },
        dispatch
    );
};

const mapStateToProps = (state, ownProps) => {
    const { componentSlug } = ownProps.match.params;
    const projectId =
        state.project.currentProject && state.project.currentProject._id;
    const monitor = state.monitor;
    const component =
        state.component && state.component.currentComponent.component;

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
        componentId:
            state.component.currentComponent.component &&
            state.component.currentComponent.component._id,
        currentProject: state.project.currentProject,
        incidents: state.incident.unresolvedincidents.incidents,
        monitors: state.monitor.paginatedMonitorsList.monitors,
        subProjects,
        startDate: state.monitor.paginatedMonitorsList.startDate,
        endDate: state.monitor.paginatedMonitorsList.endDate,
        component,
        tutorialStat,
        componentSummaryObj: state.component.componentSummary,
        componentSlug,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
    };
};

MonitorDashboardView.propTypes = {
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
    fetchIncidentTemplates: PropTypes.func.isRequired,
    tutorialStat: PropTypes.object,
    fetchComponentSummary: PropTypes.func,
    componentSummaryObj: PropTypes.object,
    fetchComponent: PropTypes.func,
    componentSlug: PropTypes.string,
    fetchDefaultTemplate: PropTypes.func,
    switchToProjectViewerNav: PropTypes.bool,
    fetchPaginatedMonitors: PropTypes.func,
};

MonitorDashboardView.displayName = 'MonitorDashboardView';

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(MonitorDashboardView);
