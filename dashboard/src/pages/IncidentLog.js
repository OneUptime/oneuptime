import React from 'react';
import Dashboard from '../components/Dashboard';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { incidentsRequest, incidentsError, incidentsSuccess, resetIncidents, getIncidents, getProjectIncidents } from '../actions/incident';
import PropTypes from 'prop-types';
import uuid from 'uuid';
import { openModal, closeModal } from '../actions/modal';
import IncidentProjectBox from '../components/incident/IncidentProjectBox'
import Badge from '../components/common/Badge';
import RenderIfUserInSubProject from '../components/basic/RenderIfUserInSubProject'
import ShouldRender from '../components/basic/ShouldRender';
import TutorialBox from '../components/tutorial/TutorialBox';

class IncidentLog extends React.Component {

    constructor(props) {
        super(props);
        this.props = props;
        this.state = { createIncidentModalId: uuid.v4() }
    }

    componentDidMount() {
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Incident Log Page Loaded');
        }
    }

    ready = () => {
        this.props.getIncidents(this.props.currentProject._id, 0, 10); //0 -> skip, 10-> limit.
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Incident Log Page Ready, Data Requested');
        }
    }

    prevClicked = (projectId, skip, limit) => {
        this.props.getProjectIncidents(projectId, ((skip || 0) > (limit || 10)) ? skip - limit : 0, 10);
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Previous Incident Requested', {
                projectId: projectId,
            });
        }
    }

    nextClicked = (projectId, skip, limit) => {
        this.props.getProjectIncidents(projectId, skip + limit, 10);
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Next Incident Requested', {
                projectId: projectId,
            });
        }
    }

    render() {
        let { createIncidentModalId } = this.state;
        let creating = this.props.create ? this.props.create : false;
        const { subProjects, currentProject, subProjectIncidents, incidents } = this.props;
        const currentProjectId = currentProject ? currentProject._id : null;

        // SubProject Incidents List
        const allIncidents = subProjects && subProjects.map((subProject, i) => {
            const subProjectIncident = subProjectIncidents && subProjectIncidents.find(subProjectIncident => subProjectIncident._id === subProject._id)
            if (subProjectIncident && incidents) {
                subProjectIncident.requesting = incidents.requesting
                subProjectIncident.error = incidents.error
                subProjectIncident.success = incidents.success
            }

            return subProjectIncident && subProjectIncident.incidents ? (
                <RenderIfUserInSubProject subProjectId={subProjectIncident._id}>
                    <div className="bs-BIM" key={i}>
                        <div className="Box-root Margin-bottom--12">
                            <div className="bs-ContentSection Card-root Card-shadow--medium">
                                <ShouldRender if={subProjects.length > 0}>
                                    <div className="Box-root Padding-top--20 Padding-left--20">
                                        <Badge color={'blue'}>{subProject.name}</Badge>
                                    </div>
                                </ShouldRender>
                                <IncidentProjectBox
                                    subProjectIncident={subProjectIncident}
                                    creating={creating}
                                    createIncidentModalId={createIncidentModalId}
                                    openModal={this.props.openModal}
                                    subProjectName={subProject.name}
                                    currentProjectId={currentProjectId}
                                    prevClicked={this.prevClicked}
                                    nextClicked={this.nextClicked}
                                />
                            </div>
                        </div>
                    </div>
                </RenderIfUserInSubProject>

            ) : false;
        });

        // Add Project Incidents to All Incidents List
        var projectIncident = subProjectIncidents && subProjectIncidents.find(subProjectIncident => subProjectIncident._id === currentProjectId)
        if (projectIncident && incidents) {
            projectIncident.requesting = incidents.requesting
            projectIncident.error = incidents.error
            projectIncident.success = incidents.success
        }

        projectIncident = projectIncident && projectIncident.incidents ? (
            <RenderIfUserInSubProject subProjectId={projectIncident._id} key={() => uuid.v4()}>
                <div className="bs-BIM">
                    <div className="Box-root Margin-bottom--12">
                        <div className="bs-ContentSection Card-root Card-shadow--medium">
                            {
                                <div className="Box-root Padding-top--20 Padding-left--20">
                                    <Badge color={'red'}>Project</Badge>
                                </div>
                            }
                            <IncidentProjectBox
                                subProjectIncident={projectIncident}
                                creating={creating}
                                createIncidentModalId={createIncidentModalId}
                                openModal={this.props.openModal}
                                subProjectName={currentProject.name}
                                currentProjectId={currentProjectId}
                                prevClicked={this.prevClicked}
                                nextClicked={this.nextClicked}
                                subProjects={subProjects}
                            />
                        </div>
                    </div>
                </div>
            </RenderIfUserInSubProject>
        ) : false;

        allIncidents && allIncidents.unshift(projectIncident);

        return (
            <Dashboard ready={this.ready}>
                <div className="db-World-contentPane Box-root Padding-bottom--48">
                    <div>
                        <div>
                            <div className="db-RadarRulesLists-page">
                                <ShouldRender if={true}>
                                    <TutorialBox type="incident" />
                                </ShouldRender>

                                {
                                    allIncidents
                                }
                            </div>
                        </div>
                    </div>
                </div>
            </Dashboard>
        );
    }
}

const mapStateToProps = state => {
    var subProjects = state.subProject.subProjects.subProjects;

    // sort subprojects names for display in alphabetical order
    const subProjectNames = subProjects && subProjects.map(subProject => subProject.name);
    subProjectNames && subProjectNames.sort();
    subProjects = subProjectNames && subProjectNames.map(name => subProjects.find(subProject => subProject.name === name))
    return {
        currentProject: state.project.currentProject,
        incidents: state.incident.incidents,
        create: state.incident.newIncident.requesting,
        subProjects,
        subProjectIncidents: state.incident.incidents.incidents
    };
};

const mapDispatchToProps = dispatch => {
    return bindActionCreators({
        incidentsRequest,
        incidentsError,
        incidentsSuccess,
        resetIncidents,
        getIncidents,
        getProjectIncidents,
        openModal,
        closeModal,
    }, dispatch);
}

IncidentLog.contextTypes = {
    mixpanel: PropTypes.object.isRequired
};

IncidentLog.propTypes = {
    getIncidents: PropTypes.func,
    getProjectIncidents: PropTypes.func,
    incidents: PropTypes.object,
    currentProject: PropTypes.object,
    create: PropTypes.bool,
    openModal: PropTypes.func,
    subProjects: PropTypes.array.isRequired,
    subProjectIncidents: PropTypes.oneOfType([PropTypes.object, PropTypes.array]),
}

IncidentLog.displayName = 'IncidentLog'

export default connect(mapStateToProps, mapDispatchToProps)(IncidentLog);
