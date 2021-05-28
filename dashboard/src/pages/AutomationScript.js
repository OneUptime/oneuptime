import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { destroy } from 'redux-form';
import Fade from 'react-reveal/Fade';
import Dashboard from '../components/Dashboard';
// import NewComponent from '../components/component/NewComponent';
import ComponentList from '../components/component/ComponentList';
import ShouldRender from '../components/basic/ShouldRender';
import { LoadingState } from '../components/basic/Loader';
import PropTypes from 'prop-types';
import {
    fetchMonitors,
    fetchMonitorsIncidents,
    fetchMonitorLogs,
} from '../actions/monitor';
import { loadPage } from '../actions/page';
import { getSmtpConfig } from '../actions/smsTemplates';
import IsUserInSubProject from '../components/basic/IsUserInSubProject';
import { logEvent } from '../analytics';
import { IS_SAAS_SERVICE } from '../config';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import { fetchComponents } from '../actions/component';
import NewScript from '../components/automationScript/NewScript';

class AutomationScript extends Component {
    componentDidMount() {
        this.props.loadPage('Components');
        if (IS_SAAS_SERVICE) {
            logEvent('PAGE VIEW: DASHBOARD > PROJECT > COMPONENT');
        }
    }

    componentWillUnmount() {
        this.props.destroy('NewComponent');
    }

    ready = () => {
        const projectId = this.props.currentProject
            ? this.props.currentProject._id
            : null;
        this.props.fetchComponents(projectId);
        this.props.getSmtpConfig(projectId);
        this.props.fetchMonitors(projectId).then(() => {
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
                            1
                        );
                    });
                }
            });
        });
    };

    render() {
        if (this.props.currentProject) {
            document.title = this.props.currentProject.name + ' Dashboard';
        }

        if (this.props.components.length) {
            const scriptElement = document.createElement('script');
            scriptElement.type = 'text/javascript';
            scriptElement.src = '/dashboard/assets/js/landing.base.js';
            document.head.appendChild(scriptElement);
        }

        const {
            subProjects,
            currentProject,
            location: { pathname },
        } = this.props;
        const currentProjectId = currentProject ? currentProject._id : null;
        let allComponents = this.props.component.componentList.components
            .map(component => component.components)
            .flat();

        // SubProject Components List
        const components =
            subProjects &&
            subProjects.map((subProject, i) => {
                const subProjectComponent = this.props.component.componentList.components.find(
                    subProjectComponent =>
                        String(subProjectComponent._id) ===
                        String(subProject._id)
                );
                allComponents = IsUserInSubProject(subProject)
                    ? allComponents
                    : allComponents.filter(
                          component =>
                              component.projectId !== subProjectComponent._id ||
                              component.projectId._id !==
                                  subProjectComponent._id
                      );
                return subProjectComponent &&
                    subProjectComponent.components.length > 0 ? (
                    <div
                        id={`box_${subProject.name}`}
                        className="Box-root Margin-vertical--12"
                        key={i}
                    >
                        <div
                            className="db-Trends Card-root"
                            style={{ overflow: 'visible' }}
                        >
                            <ComponentList
                                shouldRenderProjectType={
                                    subProjects && subProjects.length > 0
                                }
                                projectId={subProject._id}
                                projectType={'subproject'}
                                projectName={subProject.name}
                                components={subProjectComponent.components}
                            />
                        </div>
                    </div>
                ) : (
                    false
                );
            });

        // Add Project Components to Components List
        let projectComponent = this.props.component.componentList.components.find(
            subProjectComponent =>
                String(subProjectComponent._id) === String(currentProjectId)
        );
        allComponents = IsUserInSubProject(currentProject)
            ? allComponents
            : allComponents.filter(
                  component =>
                      component.projectId !== currentProject._id ||
                      component.projectId._id !== currentProject._id
              );
        projectComponent =
            projectComponent && projectComponent.components.length > 0 ? (
                <div
                    id={`box_${currentProject.name}`}
                    key={`box_${currentProject.name}`}
                    className="Box-root Margin-vertical--12"
                >
                    <div
                        className="db-Trends Card-root"
                        style={{ overflow: 'visible' }}
                    >
                        <ComponentList
                            shouldRenderProjectType={
                                subProjects && subProjects.length > 0
                            }
                            projectId={currentProjectId}
                            projectType={'project'}
                            projectName={'Project'}
                            components={projectComponent.components}
                        />
                    </div>
                </div>
            ) : (
                false
            );

        components && components.unshift(projectComponent);

        return (
            <Dashboard ready={this.ready}>
                <Fade>
                    <BreadCrumbItem route={pathname} name="Automation Script" />
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
                                                            !this.props
                                                                .component
                                                                .componentList
                                                                .requesting
                                                        }
                                                    >
                                                        <NewScript
                                                            index={1000}
                                                            formKey="NewComponentForm"
                                                        />
                                                    </ShouldRender>

                                                    <ShouldRender
                                                        if={
                                                            this.props.component
                                                                .componentList
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
            fetchMonitors,
            loadPage,
            fetchMonitorsIncidents,
            fetchMonitorLogs,
            getSmtpConfig,
            fetchComponents,
        },
        dispatch
    );
};

const mapStateToProps = state => {
    // removal of unused props
    const component = state.component;
    let subProjects = state.subProject.subProjects.subProjects;
    let monitors = [];

    // sort subprojects names for display in alphabetical order
    const subProjectNames =
        subProjects && subProjects.map(subProject => subProject.name);
    subProjectNames && subProjectNames.sort();
    subProjects =
        subProjectNames &&
        subProjectNames.map(name =>
            subProjects.find(subProject => subProject.name === name)
        );
    state.monitor.monitorsList.monitors.map(monitor => {
        monitors = monitors.concat(...monitor.monitors);
        return monitor;
    });

    const projectId =
        state.project.currentProject && state.project.currentProject._id;

    // try to get custom project tutorial by project ID
    const projectCustomTutorial = state.tutorial[projectId];

    // set a default show to true for the tutorials to display
    const tutorialStat = {
        componentCustom: { show: true },
        component: { show: true },
    };
    // loop through each of the tutorial stat, if they have a value based on the project id, replace it with it
    for (const key in tutorialStat) {
        if (projectCustomTutorial && projectCustomTutorial[key]) {
            tutorialStat[key].show = projectCustomTutorial[key].show;
        }
    }

    return {
        component,
        currentProject: state.project.currentProject,
        incidents: state.incident.unresolvedincidents.incidents,
        components: state.component.componentList.components,
        subProjects,
        slug: state.project.currentProject && state.project.currentProject.slug,
        monitor: state.monitor,
        startDate: state.monitor.monitorsList.startDate,
        endDate: state.monitor.monitorsList.endDate,
        monitors,
        tutorialStat,
    };
};

AutomationScript.propTypes = {
    currentProject: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
    component: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
    components: PropTypes.oneOfType([
        PropTypes.array,
        PropTypes.oneOf([null, undefined]),
    ]),
    loadPage: PropTypes.func,
    destroy: PropTypes.func.isRequired,
    fetchMonitors: PropTypes.func.isRequired,
    // slug: PropTypes.string,
    subProjects: PropTypes.array,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    fetchMonitorsIncidents: PropTypes.func,
    fetchMonitorLogs: PropTypes.func,
    monitor: PropTypes.object,
    startDate: PropTypes.object,
    endDate: PropTypes.object,
    monitors: PropTypes.array,
    // tutorialStat: PropTypes.object,
    getSmtpConfig: PropTypes.func.isRequired,
    fetchComponents: PropTypes.func,
};

AutomationScript.displayName = 'AutomationScript';

export default connect(mapStateToProps, mapDispatchToProps)(AutomationScript);
