import React from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-awesome-reveal/Fade';
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
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
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
    constructor(props: $TSFixMe) {
        super(props);
        // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'props' because it is a read-only... Remove this comment to see the full error message
        this.props = props;
        this.state = { createIncidentModalId: uuidv4(), page: {} };
    }

    componentDidMount() {
        this.ready();
    }

    ready = () => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchComponent' does not exist on type '... Remove this comment to see the full error message
            fetchComponent,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
            componentSlug,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
            component,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeProjectId' does not exist on type ... Remove this comment to see the full error message
            activeProjectId,
        } = this.props;

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        if (this.props.currentProject && componentSlug) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            fetchComponent(this.props.currentProject._id, componentSlug);
        }

        if (componentSlug && component && componentId) {
            const projectId = component.projectId._id || component.projectId;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getComponentIncidents' does not exist on... Remove this comment to see the full error message
            this.props.getComponentIncidents(projectId, componentId);
        } else {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getIncidents' does not exist on type 'Re... Remove this comment to see the full error message
            this.props.getIncidents(activeProjectId, 0, 10); //0 -> skip, 10-> limit.
        }

        if (activeProjectId) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchIncidentPriorities' does not exist ... Remove this comment to see the full error message
            this.props.fetchIncidentPriorities(activeProjectId, 0, 0);
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchIncidentTemplates' does not exist o... Remove this comment to see the full error message
            this.props.fetchIncidentTemplates({
                projectId: activeProjectId,
                skip: 0,
                limit: 0,
            });
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchDefaultTemplate' does not exist on ... Remove this comment to see the full error message
            this.props.fetchDefaultTemplate({
                projectId: activeProjectId,
            });
        }
    };

    componentDidUpdate(prevProps: $TSFixMe) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeProjectId' does not exist on type ... Remove this comment to see the full error message
        if (prevProps?.activeProjectId !== this.props?.activeProjectId) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchMonitors' does not exist on type 'R... Remove this comment to see the full error message
            this.props.fetchMonitors(this.props.activeProjectId);
            this.ready();
        }
        if (
            String(prevProps.componentSlug) !==
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
            String(this.props.componentSlug) ||
            JSON.stringify(prevProps.currentProject) !==
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            JSON.stringify(this.props.currentProject)
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

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
        if (String(prevProps.componentId) !== String(this.props.componentId)) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
            if (this.props.component && this.props.component.projectId) {
                const projectId =
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
                    this.props.component.projectId._id ||
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
                    this.props.component.projectId;
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'getComponentIncidents' does not exist on... Remove this comment to see the full error message
                this.props.getComponentIncidents(
                    projectId,
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
                    this.props.componentId
                );
            }
        }

        if (
            JSON.stringify(prevProps.currentProject) !==
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            JSON.stringify(this.props.currentProject)
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            if (this.props.currentProject) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchDefaultTemplate' does not exist on ... Remove this comment to see the full error message
                this.props.fetchDefaultTemplate({
                    projectId:
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                        this.props.currentProject._id ||
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                        this.props.currentProject,
                });
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchIncidentTemplates' does not exist o... Remove this comment to see the full error message
                this.props.fetchIncidentTemplates({
                    projectId:
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                        this.props.currentProject._id ||
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                        this.props.currentProject,
                    skip: 0,
                    limit: 0,
                });
            }
        }
    }

    prevClicked = (projectId: $TSFixMe, skip: $TSFixMe, limit: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
        const { componentId } = this.props;
        if (componentId) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getProjectComponentIncidents' does not e... Remove this comment to see the full error message
            this.props.getProjectComponentIncidents(
                projectId,
                componentId,
                (skip || 0) > (limit || 10) ? skip - limit : 0,
                10
            );
        } else {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getProjectIncidents' does not exist on t... Remove this comment to see the full error message
            this.props.getProjectIncidents(
                projectId,
                (skip || 0) > (limit || 10) ? skip - limit : 0,
                10
            );
        }

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        const newPageState = Object.assign({}, this.state.page, {
            [projectId]:
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                this.state.page[projectId] === 1
                    ? 1
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                    : this.state.page[projectId] - 1,
        });
        this.setState({
            page: newPageState,
        });
    };

    nextClicked = (projectId: $TSFixMe, skip: $TSFixMe, limit: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
        const { componentId } = this.props;
        if (componentId) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getProjectComponentIncidents' does not e... Remove this comment to see the full error message
            this.props.getProjectComponentIncidents(
                projectId,
                componentId,
                skip + limit,
                10
            );
        } else {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'getProjectIncidents' does not exist on t... Remove this comment to see the full error message
            this.props.getProjectIncidents(projectId, skip + limit, 10);
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        const newPageState = Object.assign({}, this.state.page, {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            [projectId]: !this.state.page[projectId]
                ? 2
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                : this.state.page[projectId] + 1,
        });
        this.setState({
            page: newPageState,
        });
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'createIncidentModalId' does not exist on... Remove this comment to see the full error message
        const { createIncidentModalId } = this.state;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'create' does not exist on type 'Readonly... Remove this comment to see the full error message
        const creating = this.props.create ? this.props.create : false;
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
            subProjects,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjectIncidents' does not exist on t... Remove this comment to see the full error message
            subProjectIncidents,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
            incidents,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
            location: { pathname },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
            component,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchToProjectViewerNav' does not exist... Remove this comment to see the full error message
            switchToProjectViewerNav,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeProjectId' does not exist on type ... Remove this comment to see the full error message
            activeProjectId,
        } = this.props;
        const currentProjectId = activeProjectId;

        // Add Project Incidents to All Incidents List
        let projectIncident =
            subProjectIncidents &&
            subProjectIncidents.find(
                (subProjectIncident: $TSFixMe) => subProjectIncident._id === currentProjectId
            );
        if (projectIncident && incidents) {
            projectIncident.requesting = incidents.requesting;
            projectIncident.error = incidents.error;
            projectIncident.success = incidents.success;
        }

        const subProjectName =
            subProjects.find((obj: $TSFixMe) => obj._id === currentProjectId)?.name ||
            currentProject.name;
        projectIncident =
            projectIncident && projectIncident.incidents ? (
                <RenderIfUserInSubProject
                    subProjectId={projectIncident._id}
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '() => any' is not assignable to type 'Key | ... Remove this comment to see the full error message
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
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
                                    openModal={this.props.openModal}
                                    subProjectName={subProjectName}
                                    showProjectName={
                                        currentProject?._id !== currentProjectId
                                    }
                                    currentProjectId={currentProjectId}
                                    prevClicked={this.prevClicked}
                                    nextClicked={this.nextClicked}
                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ componentId: any; subProjectIncident: any;... Remove this comment to see the full error message
                                    subProjects={subProjects}
                                    allProjectLength={
                                        subProjectIncidents.length
                                    }
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'modalList' does not exist on type 'Reado... Remove this comment to see the full error message
                                    modalList={this.props.modalList}
                                    page={
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                        !this.state.page[projectIncident._id]
                                            ? 1
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                            : this.state.page[
                                            projectIncident._id
                                            ]
                                    }
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
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
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ route: string; name: any; projectId: any; ... Remove this comment to see the full error message
                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
                <ShouldRender if={!pathname.endsWith('incidents')}>
                    <BreadCrumbItem
                        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 1.
                        route={getParentRoute(pathname)}
                        name={componentName}
                    />
                </ShouldRender>
                <BreadCrumbItem route={pathname} name="Incidents" />
                <div id="incidentLogs">
                    <div>
                        <div className="db-RadarRulesLists-page">
                            <ShouldRender
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'tutorialStat' does not exist on type 'Re... Remove this comment to see the full error message
                                if={this.props.tutorialStat.incident.show}
                            >
                                <TutorialBox
                                    type="incident"
                                    currentProjectId={
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                                        this.props.currentProject?._id
                                    }
                                />
                            </ShouldRender>

                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
                            {!this.props.incidents.requesting && allIncidents}
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidents' does not exist on type 'Reado... Remove this comment to see the full error message
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

const mapStateToProps = (state: $TSFixMe, ownProps: $TSFixMe) => {
    const { componentSlug } = ownProps.match.params;
    const projectId =
        state.project.currentProject && state.project.currentProject._id;
    let subProjects = state.subProject.subProjects.subProjects;

    // sort subprojects names for display in alphabetical order
    const subProjectNames =
        subProjects && subProjects.map((subProject: $TSFixMe) => subProject.name);
    subProjectNames && subProjectNames.sort();
    subProjects =
        subProjectNames &&
        subProjectNames.map((name: $TSFixMe) => subProjects.find((subProject: $TSFixMe) => subProject.name === name)
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
            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
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

const mapDispatchToProps = (dispatch: $TSFixMe) => {
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
IncidentLog.displayName = 'IncidentLog';

export default connect(mapStateToProps, mapDispatchToProps)(IncidentLog);
