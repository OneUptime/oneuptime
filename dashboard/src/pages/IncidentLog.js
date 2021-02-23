import React from 'react';
import Dashboard from '../components/Dashboard';
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
} from '../actions/incident';
import { fetchIncidentPriorities } from '../actions/incidentPriorities';
import PropTypes from 'prop-types';
import uuid from 'uuid';
import { openModal, closeModal } from '../actions/modal';
import IncidentProjectBox from '../components/incident/IncidentProjectBox';
import Badge from '../components/common/Badge';
import RenderIfUserInSubProject from '../components/basic/RenderIfUserInSubProject';
import ShouldRender from '../components/basic/ShouldRender';
import TutorialBox from '../components/tutorial/TutorialBox';
import { LoadingState } from '../components/basic/Loader';
import { logEvent } from '../analytics';
import { SHOULD_LOG_ANALYTICS } from '../config';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import { fetchBasicIncidentSettings } from '../actions/incidentBasicsSettings';

class IncidentLog extends React.Component {
    constructor(props) {
        super(props);
        this.props = props;
        this.state = { createIncidentModalId: uuid.v4(), page: {} };
    }

    componentDidMount() {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent('PAGE VIEW: DASHBOARD > PROJECT > INCIDENT LOG');
        }
    }

    ready = () => {
        this.props.getIncidents(this.props.currentProject._id, 0, 10); //0 -> skip, 10-> limit.
        this.props.fetchIncidentPriorities(this.props.currentProject._id, 0, 0);
        this.props.fetchBasicIncidentSettings(this.props.currentProject._id);
    };

    prevClicked = (projectId, skip, limit) => {
        this.props.getProjectIncidents(
            projectId,
            (skip || 0) > (limit || 10) ? skip - limit : 0,
            10
        );
        const newPageState = Object.assign({}, this.state.page, {
            [projectId]:
                this.state.page[projectId] === 1
                    ? 1
                    : this.state.page[projectId] - 1,
        });
        this.setState({
            page: newPageState,
        });
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > INCIDENT LOG > PREVIOUS BUTTON CLICKED'
            );
        }
    };

    nextClicked = (projectId, skip, limit) => {
        this.props.getProjectIncidents(projectId, skip + limit, 10);
        const newPageState = Object.assign({}, this.state.page, {
            [projectId]: !this.state.page[projectId]
                ? 2
                : this.state.page[projectId] + 1,
        });
        this.setState({
            page: newPageState,
        });
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'EVENT: DASHBOARD > PROJECT > INCIDENT LOG > NEXT BUTTON CLICKED'
            );
        }
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
        } = this.props;
        const currentProjectId = currentProject ? currentProject._id : null;

        // SubProject Incidents List
        const allIncidents =
            subProjects &&
            subProjects.map((subProject, i) => {
                const subProjectIncident =
                    subProjectIncidents &&
                    subProjectIncidents.find(
                        subProjectIncident =>
                            subProjectIncident._id === subProject._id
                    );
                if (subProjectIncident && incidents) {
                    subProjectIncident.requesting = incidents.requesting;
                    subProjectIncident.error = incidents.error;
                    subProjectIncident.success = incidents.success;
                }

                return subProjectIncident && subProjectIncident.incidents ? (
                    <RenderIfUserInSubProject
                        subProjectId={subProjectIncident._id}
                        key={i}
                    >
                        <div className="bs-BIM" key={i}>
                            <div className="Box-root Margin-bottom--12">
                                <div className="bs-ContentSection Card-root Card-shadow--medium">
                                    <ShouldRender if={subProjects.length > 0}>
                                        <div className="Box-root Padding-top--20 Padding-left--20">
                                            <Badge color={'blue'}>
                                                {subProject.name}
                                            </Badge>
                                        </div>
                                    </ShouldRender>
                                    <IncidentProjectBox
                                        componentId={componentId}
                                        subProjectIncident={subProjectIncident}
                                        creating={creating}
                                        createIncidentModalId={
                                            createIncidentModalId
                                        }
                                        openModal={this.props.openModal}
                                        subProjectName={subProject.name}
                                        currentProjectId={currentProjectId}
                                        prevClicked={this.prevClicked}
                                        nextClicked={this.nextClicked}
                                        allProjectLength={
                                            subProjectIncidents.length
                                        }
                                        modalList={this.props.modalList}
                                        page={
                                            !this.state.page[
                                                subProjectIncident._id
                                            ]
                                                ? 1
                                                : this.state.page[
                                                      subProjectIncident._id
                                                  ]
                                        }
                                    />
                                </div>
                            </div>
                        </div>
                    </RenderIfUserInSubProject>
                ) : (
                    false
                );
            });

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

        projectIncident =
            projectIncident && projectIncident.incidents ? (
                <RenderIfUserInSubProject
                    subProjectId={projectIncident._id}
                    key={() => uuid.v4()}
                >
                    <div className="bs-BIM">
                        <div className="Box-root Margin-bottom--12">
                            <div className="bs-ContentSection Card-root Card-shadow--medium">
                                <ShouldRender if={subProjects.length > 0}>
                                    <div className="Box-root Padding-top--20 Padding-left--20">
                                        <Badge color={'red'}>Project</Badge>
                                    </div>
                                </ShouldRender>
                                <IncidentProjectBox
                                    componentId={componentId}
                                    subProjectIncident={projectIncident}
                                    creating={creating}
                                    createIncidentModalId={
                                        createIncidentModalId
                                    }
                                    openModal={this.props.openModal}
                                    subProjectName={currentProject.name}
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
                                />
                            </div>
                        </div>
                    </div>
                </RenderIfUserInSubProject>
            ) : (
                false
            );

        allIncidents && allIncidents.unshift(projectIncident);
        const componentName = component ? component.name : '';

        return (
            <Dashboard ready={this.ready}>
                <Fade>
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

                                {allIncidents}
                                <ShouldRender
                                    if={this.props.incidents.requesting}
                                >
                                    <LoadingState />
                                </ShouldRender>
                            </div>
                        </div>
                    </div>
                </Fade>
            </Dashboard>
        );
    }
}

const mapStateToProps = (state, props) => {
    const { componentId } = props.match.params;
    const projectId =
        state.project.currentProject && state.project.currentProject._id;
    let subProjects = state.subProject.subProjects.subProjects;
    let component;
    state.component.componentList.components.forEach(item => {
        item.components.forEach(c => {
            if (String(c._id) === String(componentId)) {
                component = c;
            }
        });
    });

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
    return {
        componentId,
        currentProject: state.project.currentProject,
        incidents: state.incident.incidents,
        create: state.incident.newIncident.requesting,
        subProjects,
        subProjectIncidents: state.incident.incidents.incidents,
        tutorialStat,
        component,
        modalList: state.modal.modals,
        projectId,
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
            fetchBasicIncidentSettings,
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
        })
    ),
    fetchIncidentPriorities: PropTypes.func.isRequired,
    fetchBasicIncidentSettings: PropTypes.func.isRequired,
    modalList: PropTypes.array,
};

IncidentLog.displayName = 'IncidentLog';

export default connect(mapStateToProps, mapDispatchToProps)(IncidentLog);
