import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { destroy } from 'redux-form';
import Dashboard from '../components/Dashboard';
import NewComponent from '../components/component/NewComponent';
import ComponentList from '../components/component/ComponentList';
import ShouldRender from '../components/basic/ShouldRender';
// import IncidentStatus from '../components/incident/IncidentStatus';
import RenderIfSubProjectAdmin from '../components/basic/RenderIfSubProjectAdmin';
import RenderIfSubProjectMember from '../components/basic/RenderIfSubProjectMember';
import { LoadingState } from '../components/basic/Loader';
import TutorialBox from '../components/tutorial/TutorialBox';
import PropTypes from 'prop-types';
import { fetchComponents } from '../actions/component';
import { loadPage } from '../actions/page';
import { fetchTutorial } from '../actions/tutorial';
import { getProbes } from '../actions/probe';
// import RenderIfUserInSubProject from '../components/basic/RenderIfUserInSubProject';
import IsUserInSubProject from '../components/basic/IsUserInSubProject';
import { logEvent } from '../analytics';
import { IS_SAAS_SERVICE } from '../config';

class DashboardView extends Component {
    componentDidMount() {
        this.props.loadPage('Components');
        if (IS_SAAS_SERVICE) {
            logEvent('Main component page Loaded');
        }
    }

    componentWillUnmount() {
        this.props.destroy('NewComponent');
    }

    ready = () => {
        const projectId = this.props.currentProject
            ? this.props.currentProject._id
            : null;
        this.props.getProbes(projectId, 0, 10); //0 -> skip, 10-> limit.
        this.props.fetchComponents(projectId).then(() => {
            this.props.component.componentList.components.forEach(
                subProject => {
                    if (subProject.components.length > 0) {
                        subProject.components.forEach(component => {
                            this.props.fetchComponentLogs(
                                component.projectId._id || component.projectId,
                                component._id,
                                this.props.startDate,
                                this.props.endDate
                            );
                        });
                    }
                }
            );
        });
        this.props.fetchTutorial();
    };

    render() {
        if (this.props.currentProject) {
            document.title = this.props.currentProject.name + ' Dashboard';
        }

        if (this.props.components.length) {
            const scriptElement = document.createElement('script');
            scriptElement.type = 'text/javascript';
            scriptElement.src = '/assets/js/landing.base.js';
            document.head.appendChild(scriptElement);
        }

        const { subProjects, currentProject } = this.props;
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
                        subProjectComponent._id === subProject._id
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
            subProjectComponent => subProjectComponent._id === currentProjectId
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
                                                        !this.props.component
                                                            .componentList
                                                            .requesting
                                                    }
                                                >
                                                    <ShouldRender
                                                        if={
                                                            this.props
                                                                .componentTutorial
                                                                .show
                                                        }
                                                    >
                                                        <TutorialBox type="component" />
                                                    </ShouldRender>

                                                    {components}

                                                    <RenderIfSubProjectAdmin>
                                                        <NewComponent
                                                            index={1000}
                                                            formKey="NewComponentForm"
                                                        />
                                                    </RenderIfSubProjectAdmin>

                                                    <RenderIfSubProjectMember>
                                                        <ShouldRender
                                                            if={
                                                                !this.props
                                                                    .component
                                                                    .componentList
                                                                    .requesting &&
                                                                allComponents.length ===
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
                                                                    No
                                                                    components
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
            </Dashboard>
        );
    }
}

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            destroy,
            fetchComponents,
            loadPage,
            fetchTutorial,
            getProbes,
        },
        dispatch
    );
};

const mapStateToProps = state => {
    const component = state.component;
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

    return {
        component,
        currentProject: state.project.currentProject,
        incidents: state.incident.unresolvedincidents.incidents,
        components: state.component.componentList.components,
        subProjects,
        componentTutorial: state.tutorial.component,
        startDate: state.component.componentList.startDate,
        endDate: state.component.componentList.endDate,
    };
};

DashboardView.propTypes = {
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
    fetchComponentLogs: PropTypes.func,
    fetchComponents: PropTypes.func.isRequired,
    subProjects: PropTypes.array,
    componentTutorial: PropTypes.object,
    fetchTutorial: PropTypes.func,
    getProbes: PropTypes.func,
    startDate: PropTypes.object,
    endDate: PropTypes.object,
};

DashboardView.displayName = 'DashboardView';

export default connect(mapStateToProps, mapDispatchToProps)(DashboardView);
