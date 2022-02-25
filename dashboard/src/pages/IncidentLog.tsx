import React from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import Fade from 'react-reveal/Fade';
import {
    incidentsRequest,
    incidentsError,
    incidentsSuccess,
    resetIncidents,
    getIncidents,
    getProjectIncidents,
    getComponentIncidents,
    getProjectComponentIncidents,
} from '../actions/incident';
import { fetchIncidentPriorities } from '../actions/incidentPriorities';
import PropTypes from 'prop-types';
import { v4 as uuidv4 } from 'uuid';
import { openModal, closeModal } from '../actions/modal';
import IncidentProjectBox from '../components/incident/IncidentProjectBox';
import RenderIfUserInSubProject from '../components/basic/RenderIfUserInSubProject';
import ShouldRender from '../components/basic/ShouldRender';
import TutorialBox from '../components/tutorial/TutorialBox';
import { LoadingState } from '../components/basic/Loader';

import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import {
    fetchIncidentTemplates,
    fetchDefaultTemplate,
} from '../actions/incidentBasicsSettings';
import { fetchComponent } from '../actions/component';
import { fetchMonitors } from '../actions/monitor';

class IncidentLog extends React.Component {
    constructor(props) {
        super(props);
        this.props = props;
        this.state = { createIncidentModalId: uuidv4(), page: {} };
    }

    componentDidMount() {
        this.ready();
    }

    ready = () => {
        const {
            componentId,
            fetchComponent,
            componentSlug,
            component,
            activeProjectId,
        } = this.props;

        if (this.props.currentProject && componentSlug) {
            fetchComponent(this.props.currentProject._id, componentSlug);
        }

        if (componentSlug && component && componentId) {
            const projectId = component.projectId._id || component.projectId;
            this.props.getComponentIncidents(projectId, componentId);
        } else {
            this.props.getIncidents(activeProjectId, 0, 10); //0 -> skip, 10-> limit.
        }

        if (activeProjectId) {
            this.props.fetchIncidentPriorities(activeProjectId, 0, 0);
            this.props.fetchIncidentTemplates({
                projectId: activeProjectId,
                skip: 0,
                limit: 0,
            });
            this.props.fetchDefaultTemplate({
                projectId: activeProjectId,
            });
        }
    };

    componentDidUpdate(prevProps) {
        if (prevProps?.activeProjectId !== this.props?.activeProjectId) {
            this.props.fetchMonitors(this.props.activeProjectId);
            this.ready();
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

        if (String(prevProps.componentId) !== String(this.props.componentId)) {
            if (this.props.component && this.props.component.projectId) {
                const projectId =
                    this.props.component.projectId._id ||
                    this.props.component.projectId;
                this.props.getComponentIncidents(
                    projectId,
                    this.props.componentId
                );
            }
        }

        if (
            JSON.stringify(prevProps.currentProject) !==
            JSON.stringify(this.props.currentProject)
        ) {
            if (this.props.currentProject) {
                this.props.fetchDefaultTemplate({
                    projectId:
                        this.props.currentProject._id ||
                        this.props.currentProject,
                });
                this.props.fetchIncidentTemplates({
                    projectId:
                        this.props.currentProject._id ||
                        this.props.currentProject,
                    skip: 0,
                    limit: 0,
                });
            }
        }
    }

    prevClicked = (projectId, skip, limit) => {
        const { componentId } = this.props;
        if (componentId) {
            this.props.getProjectComponentIncidents(
                projectId,
                componentId,
                (skip || 0) > (limit || 10) ? skip - limit : 0,
                10
            );
        } else {
            this.props.getProjectIncidents(
                projectId,
                (skip || 0) > (limit || 10) ? skip - limit : 0,
                10
            );
        }

        const newPageState = Object.assign({}, this.state.page, {
            [projectId]:
                this.state.page[projectId] === 1
                    ? 1
                    : this.state.page[projectId] - 1,
        });
        this.setState({
            page: newPageState,
        });
    };

    nextClicked = (projectId, skip, limit) => {
        const { componentId } = this.props;
        if (componentId) {
            this.props.getProjectComponentIncidents(
                projectId,
                componentId,
                skip + limit,
                10
            );
        } else {
            this.props.getProjectIncidents(projectId, skip + limit, 10);
        }
        const newPageState = Object.assign({}, this.state.page, {
            [projectId]: !this.state.page[projectId]
                ? 2
                : this.state.page[projectId] + 1,
        });
        this.setState({
            page: newPageState,
        });
    };

    render() {
        const { createIncidentModalId } = this.state;
        const creating = this.props.create ? this.props.create : false;
        const {
            subProjects,
            currentProject,
            subProjectIncidents,
            incidents,
            componentId,
            location: { pathname },
            component,
            switchToProjectViewerNav,
            activeProjectId,
        } = this.props;
        const currentProjectId = activeProjectId;

        // Add Project Incidents to All Incidents List
        let projectIncident =
            subProjectIncidents &&
            subProjectIncidents.find(
                subProjectIncident =>
                    subProjectIncident._id === currentProjectId
            );
        if (projectIncident && incidents) {
            projectIncident.requesting = incidents.requesting;
            projectIncident.error = incidents.error;
            projectIncident.success = incidents.success;
        }

        const subProjectName =
            subProjects.find(obj => obj._id === currentProjectId)?.name ||
            currentProject.name;
        projectIncident =
            projectIncident && projectIncident.incidents ? (
                <RenderIfUserInSubProject
                    subProjectId={projectIncident._id}
                    key={() => uuidv4()}
                >
                    <div className="bs-BIM">
                        <div className="Box-root Margin-bottom--12">
                            <div className="bs-ContentSection Card-root Card-shadow--medium">
                                <IncidentProjectBox
                                    componentId={componentId}
                                    subProjectIncident={projectIncident}
                                    creating={creating}
                                    createIncidentModalId={
                                        createIncidentModalId
                                    }
                                    openModal={this.props.openModal}
                                    subProjectName={subProjectName}
                                    showProjectName={
                                        currentProject?._id !== currentProjectId
                                    }
                                    currentProjectId={currentProjectId}
                                    prevClicked={this.prevClicked}
                                    nextClicked={this.nextClicked}
                                    subProjects={subProjects}
                                    allProjectLength={
                                        subProjectIncidents.length
                                    }
                                    modalList={this.props.modalList}
                                    page={
                                        !this.state.page[projectIncident._id]
                                            ? 1
                                            : this.state.page[
                                                  projectIncident._id
                                              ]
                                    }
                                    componentSlug={this.props.componentSlug}
                                />
                            </div>
                        </div>
                    </div>
                </RenderIfUserInSubProject>
            ) : (
                false
            );

        const allIncidents = projectIncident && [projectIncident];
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
                <ShouldRender if={!pathname.endsWith('incidents')}>
                    <BreadCrumbItem
                        route={getParentRoute(pathname)}
                        name={componentName}
                    />
                </ShouldRender>
                <BreadCrumbItem route={pathname} name="Incidents" />
                <div id="incidentLogs">
                    <div>
                        <div className="db-RadarRulesLists-page">
                            <ShouldRender
                                if={this.props.tutorialStat.incident.show}
                            >
                                <TutorialBox
                                    type="incident"
                                    currentProjectId={
                                        this.props.currentProject?._id
                                    }
                                />
                            </ShouldRender>

                            {!this.props.incidents.requesting && allIncidents}
                            <ShouldRender if={this.props.incidents.requesting}>
                                <LoadingState />
                            </ShouldRender>
                        </div>
                    </div>
                </div>
            </Fade>
        );
    }
}

const mapStateToProps = (state, ownProps) => {
    const { componentSlug } = ownProps.match.params;
    const projectId =
        state.project.currentProject && state.project.currentProject._id;
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
        incident: { show: true },
    };
    // loop through each of the tutorial stat, if they have a value based on the project id, replace it with it
    for (const key in tutorialStat) {
        if (projectCustomTutorial && projectCustomTutorial[key]) {
            tutorialStat[key].show = projectCustomTutorial[key].show;
        }
    }

    let activeProjectId = state.subProject.activeSubProject;
    if (componentSlug) {
        activeProjectId =
            state.component.currentComponent &&
            state.component.currentComponent.component &&
            state.component.currentComponent.component.projectId &&
            (state.component.currentComponent.component.projectId._id ||
                state.component.currentComponent.component.projectId);
    }
    return {
        componentId:
            state.component.currentComponent.component &&
            state.component.currentComponent.component._id,
        currentProject: state.project.currentProject,
        incidents: state.incident.incidents,
        create: state.incident.newIncident.requesting,
        subProjects,
        subProjectIncidents: state.incident.incidents.incidents,
        tutorialStat,
        component:
            state.component.currentComponent &&
            state.component.currentComponent.component,
        modalList: state.modal.modals,
        projectId,
        componentSlug,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
        activeProjectId,
    };
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators(
        {
            incidentsRequest,
            incidentsError,
            incidentsSuccess,
            resetIncidents,
            getIncidents,
            getProjectIncidents,
            openModal,
            closeModal,
            fetchIncidentPriorities,
            fetchIncidentTemplates,
            getComponentIncidents,
            getProjectComponentIncidents,
            fetchComponent,
            fetchDefaultTemplate,
            fetchMonitors,
        },
        dispatch
    );
};

IncidentLog.propTypes = {
    componentId: PropTypes.string.isRequired,
    getIncidents: PropTypes.func,
    getProjectIncidents: PropTypes.func,
    incidents: PropTypes.object,
    currentProject: PropTypes.object,
    create: PropTypes.bool,
    openModal: PropTypes.func,
    subProjects: PropTypes.array.isRequired,
    subProjectIncidents: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.array,
    ]),
    tutorialStat: PropTypes.object,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    component: PropTypes.arrayOf(
        PropTypes.shape({
            name: PropTypes.string,
            _id: PropTypes.string,
        })
    ),
    fetchIncidentPriorities: PropTypes.func.isRequired,
    fetchIncidentTemplates: PropTypes.func.isRequired,
    modalList: PropTypes.array,
    getComponentIncidents: PropTypes.func,
    getProjectComponentIncidents: PropTypes.func,
    fetchComponent: PropTypes.func,
    componentSlug: PropTypes.string,
    fetchDefaultTemplate: PropTypes.func,
    switchToProjectViewerNav: PropTypes.bool,
    activeProjectId: PropTypes.string,
    fetchMonitors: PropTypes.func,
};

IncidentLog.displayName = 'IncidentLog';

export default connect(mapStateToProps, mapDispatchToProps)(IncidentLog);
