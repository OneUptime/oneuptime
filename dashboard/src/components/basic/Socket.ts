import { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import io from 'socket.io-client';
import RemovedFromSubProjectModal from '../modals/RemovedFromSubProject';
import RemovedFromProjectModal from '../modals/RemovedFromProject';
import { User, REALTIME_URL } from '../../config';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import { openModal, closeModal } from '../../actions/modal';
import {
    incidentresolvedbysocket,
    incidentacknowledgedbysocket,
    deletemonitorbysocket,
    updatemonitorbysocket,
    createmonitorbysocket,
    incidentcreatedbysocket,
    updatemonitorlogbysocket,
    updatemonitorstatusbysocket,
    updateincidenttimelinebysocket,
    updateincidentbysocket,
    updatelighthouselogbysocket,
    updateprobebysocket,
    addnotifications,
    teamMemberRoleUpdate,
    teamMemberCreate,
    teamMemberDelete,
    addIncidentNote,
    createMonitor,
    deleteincidentbysocket,
    resolvescheduledevent,
    slacountdown,
    updateAlllighthouselogbysocket,
    updateTimelineBySocket,
} from '../../actions/socket';
import DataPathHoC from '../DataPathHoC';
import {
    createScheduledEventSuccess,
    updateScheduledEventSuccess,
    deleteScheduledEventSuccess,
} from '../../actions/scheduledEvent';

// Important: Below `/realtime` is also needed because `io` constructor strips out the path from the url.
// '/realtime' is set as socket io namespace, so remove
// @ts-expect-error ts-migrate(2339) FIXME: Property 'connect' does not exist on type '{ (opts... Remove this comment to see the full error message
export const socket = io.connect(REALTIME_URL.replace('/realtime', ''), {
    path: '/realtime/socket.io',
    transports: ['websocket', 'polling'],
});

class SocketApp extends Component {
    shouldComponentUpdate(nextProps: $TSFixMe) {
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
            this.props.project !== nextProps.project ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeProjectId' does not exist on type ... Remove this comment to see the full error message
            this.props.activeProjectId !== nextProps.activeProjectId
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
            if (this.props.project && this.props.activeProjectId) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeProjectId' does not exist on type ... Remove this comment to see the full error message
                const projectId = this.props.activeProjectId;
                socket.removeListener(`incidentResolved-${projectId}`);
                socket.removeListener(`incidentAcknowledged-${projectId}`);
                socket.removeListener(`createMonitor-${projectId}`);
                socket.removeListener(`updateMonitor-${projectId}`);
                socket.removeListener(`deleteMonitor-${projectId}`);
                socket.removeListener(`incidentCreated-${projectId}`);
                socket.removeListener(`updateMonitorLog-${projectId}`);
                socket.removeListener(`updateMonitorStatus-${projectId}`);
                socket.removeListener(`updateIncidentTimeline-${projectId}`);
                socket.removeListener(`updateIncident-${projectId}`);
                socket.removeListener(`updateLighthouseLog-${projectId}`);
                socket.removeListener(`updateAllLighthouseLog-${projectId}`);
                socket.removeListener(`updateProbe`);
                socket.removeListener(`NewNotification-${projectId}`);
                socket.removeListener(`TeamMemberRoleUpdate-${projectId}`);
                socket.removeListener(`TeamMemberCreate-${projectId}`);
                socket.removeListener(`TeamMemberDelete-${projectId}`);
                socket.removeListener(`addIncidentNote-${projectId}`);
                socket.removeListener(`incidentTimeline-${projectId}`);
                socket.removeListener(`createMonitor-${projectId}`);
                socket.removeListener(`addScheduledEvent-${projectId}`);
                socket.removeListener(`deleteScheduledEvent-${projectId}`);
                socket.removeListener(`updateScheduledEvent-${projectId}`);
                socket.removeListener(`deleteIncident-${projectId}`);
                socket.removeListener(`resolveScheduledEvent-${projectId}`);
                socket.removeListener(`slaCountDown-${projectId}`);
            }
            return true;
        } else {
            return false;
        }
    }

    render() {
        const thisObj = this;
        const loggedInUser = User.getUserId();

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
        if (this.props.project && this.props.activeProjectId) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeProjectId' does not exist on type ... Remove this comment to see the full error message
            const projectId = this.props.activeProjectId;
            socket.on(`incidentResolved-${projectId}`, function(data: $TSFixMe) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                const isUserInProject = thisObj.props.project
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                    ? thisObj.props.project.users.some(
                          (user: $TSFixMe) => user.userId === loggedInUser
                      )
                    : false;
                if (isUserInProject) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentresolvedbysocket' does not exist... Remove this comment to see the full error message
                    thisObj.props.incidentresolvedbysocket(data);
                } else {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
                    const subProject = thisObj.props.subProjects.find(
                        (subProject: $TSFixMe) => subProject._id === data.projectId
                    );
                    const isUserInSubProject = subProject
                        ? subProject.users.some(
                              (user: $TSFixMe) => user.userId === loggedInUser
                          )
                        : false;

                    if (isUserInSubProject)
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentresolvedbysocket' does not exist... Remove this comment to see the full error message
                        thisObj.props.incidentresolvedbysocket(data);
                }
            });
            socket.on(`incidentAcknowledged-${projectId}`, function(data: $TSFixMe) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                const isUserInProject = thisObj.props.project
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                    ? thisObj.props.project.users.some(
                          (user: $TSFixMe) => user.userId === loggedInUser
                      )
                    : false;
                if (isUserInProject) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentacknowledgedbysocket' does not e... Remove this comment to see the full error message
                    thisObj.props.incidentacknowledgedbysocket(data);
                } else {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
                    const subProject = thisObj.props.subProjects.find(
                        (subProject: $TSFixMe) => subProject._id === data.projectId
                    );
                    const isUserInSubProject = subProject
                        ? subProject.users.some(
                              (user: $TSFixMe) => user.userId === loggedInUser
                          )
                        : false;

                    if (isUserInSubProject)
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentacknowledgedbysocket' does not e... Remove this comment to see the full error message
                        thisObj.props.incidentacknowledgedbysocket(data);
                }
            });
            socket.on(`createMonitor-${projectId}`, function(data: $TSFixMe) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                const isUserInProject = thisObj.props.project
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                    ? thisObj.props.project.users.some(
                          (user: $TSFixMe) => user.userId === loggedInUser
                      )
                    : false;
                if (isUserInProject) {
                    if (data.createdById !== User.getUserId()) {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'createmonitorbysocket' does not exist on... Remove this comment to see the full error message
                        thisObj.props.createmonitorbysocket(data);
                    }
                } else {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
                    const subProject = thisObj.props.subProjects.find(
                        (subProject: $TSFixMe) => subProject._id === data.projectId._id
                    );
                    const isUserInSubProject = subProject
                        ? subProject.users.some(
                              (user: $TSFixMe) => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInSubProject)
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'createmonitorbysocket' does not exist on... Remove this comment to see the full error message
                        thisObj.props.createmonitorbysocket(data);
                }
            });
            socket.on(`updateMonitor-${projectId}`, function(data: $TSFixMe) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                const isUserInProject = thisObj.props.project
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                    ? thisObj.props.project.users.some(
                          (user: $TSFixMe) => user.userId === loggedInUser
                      )
                    : false;
                if (isUserInProject) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'updatemonitorbysocket' does not exist on... Remove this comment to see the full error message
                    thisObj.props.updatemonitorbysocket(data);
                } else {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
                    const subProject = thisObj.props.subProjects.find(
                        (subProject: $TSFixMe) => subProject._id === data.projectId._id
                    );
                    const isUserInSubProject = subProject
                        ? subProject.users.some(
                              (user: $TSFixMe) => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInSubProject)
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'updatemonitorbysocket' does not exist on... Remove this comment to see the full error message
                        thisObj.props.updatemonitorbysocket(data);
                }
            });
            socket.on(`deleteMonitor-${projectId}`, function(data: $TSFixMe) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                const isUserInProject = thisObj.props.project
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                    ? thisObj.props.project.users.some(
                          (user: $TSFixMe) => user.userId === loggedInUser
                      )
                    : false;
                if (isUserInProject) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'deletemonitorbysocket' does not exist on... Remove this comment to see the full error message
                    thisObj.props.deletemonitorbysocket(data);
                } else {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
                    const subProject = thisObj.props.subProjects.find(
                        (subProject: $TSFixMe) => subProject._id === data.projectId
                    );
                    const isUserInSubProject = subProject
                        ? subProject.users.some(
                              (user: $TSFixMe) => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInSubProject)
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'deletemonitorbysocket' does not exist on... Remove this comment to see the full error message
                        thisObj.props.deletemonitorbysocket(data);
                }
            });
            socket.on(`incidentCreated-${projectId}`, function(data: $TSFixMe) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                const isUserInProject = thisObj.props.project
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                    ? thisObj.props.project.users.some(
                          (user: $TSFixMe) => user.userId === loggedInUser
                      )
                    : false;

                if (isUserInProject) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentcreatedbysocket' does not exist ... Remove this comment to see the full error message
                    thisObj.props.incidentcreatedbysocket(data);
                } else {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
                    const subProject = thisObj.props.subProjects.find(
                        (subProject: $TSFixMe) => subProject._id === data.projectId
                    );
                    const isUserInSubProject = subProject
                        ? subProject.users.some(
                              (user: $TSFixMe) => user.userId === loggedInUser
                          )
                        : false;

                    if (isUserInSubProject) {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentcreatedbysocket' does not exist ... Remove this comment to see the full error message
                        thisObj.props.incidentcreatedbysocket(data);
                    }
                }
            });
            socket.on(`updateMonitorLog-${projectId}`, function(data: $TSFixMe) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                const isUserInProject = thisObj.props.project
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                    ? thisObj.props.project.users.some(
                          (user: $TSFixMe) => user.userId === loggedInUser
                      )
                    : false;
                if (isUserInProject) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'updatemonitorlogbysocket' does not exist... Remove this comment to see the full error message
                    thisObj.props.updatemonitorlogbysocket(data);
                } else {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
                    const subProject = thisObj.props.subProjects.find(
                        (subProject: $TSFixMe) => subProject._id === data.projectId
                    );
                    const isUserInSubProject = subProject
                        ? subProject.users.some(
                              (user: $TSFixMe) => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInSubProject)
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'updatemonitorlogbysocket' does not exist... Remove this comment to see the full error message
                        thisObj.props.updatemonitorlogbysocket(data);
                }
            });
            socket.on(`updateMonitorStatus-${projectId}`, function(data: $TSFixMe) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                const isUserInProject = thisObj.props.project
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                    ? thisObj.props.project.users.some(
                          (user: $TSFixMe) => user.userId === loggedInUser
                      )
                    : false;
                if (isUserInProject) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'updatemonitorstatusbysocket' does not ex... Remove this comment to see the full error message
                    thisObj.props.updatemonitorstatusbysocket(
                        data,
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'probes' does not exist on type 'Readonly... Remove this comment to see the full error message
                        thisObj.props.probes
                    );
                } else {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
                    const subProject = thisObj.props.subProjects.find(
                        (subProject: $TSFixMe) => subProject._id === data.projectId
                    );
                    const isUserInSubProject = subProject
                        ? subProject.users.some(
                              (user: $TSFixMe) => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInSubProject)
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'updatemonitorstatusbysocket' does not ex... Remove this comment to see the full error message
                        thisObj.props.updatemonitorstatusbysocket(
                            data,
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'probes' does not exist on type 'Readonly... Remove this comment to see the full error message
                            thisObj.props.probes
                        );
                }
            });
            socket.on(`updateIncidentTimeline-${projectId}`, function(data: $TSFixMe) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                const isUserInProject = thisObj.props.project
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                    ? thisObj.props.project.users.some(
                          (user: $TSFixMe) => user.userId === loggedInUser
                      )
                    : false;
                if (isUserInProject) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateincidenttimelinebysocket' does not... Remove this comment to see the full error message
                    thisObj.props.updateincidenttimelinebysocket(data);
                } else {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
                    const subProject = thisObj.props.subProjects.find(
                        (subProject: $TSFixMe) => subProject._id === data.projectId
                    );
                    const isUserInSubProject = subProject
                        ? subProject.users.some(
                              (user: $TSFixMe) => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInSubProject)
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateincidenttimelinebysocket' does not... Remove this comment to see the full error message
                        thisObj.props.updateincidenttimelinebysocket(data);
                }
            });
            socket.on(`updateLighthouseLog-${projectId}`, function(data: $TSFixMe) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                const isUserInProject = thisObj.props.project
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                    ? thisObj.props.project.users.some(
                          (user: $TSFixMe) => user.userId === loggedInUser
                      )
                    : false;
                if (isUserInProject) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'updatelighthouselogbysocket' does not ex... Remove this comment to see the full error message
                    thisObj.props.updatelighthouselogbysocket(data);
                } else {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
                    const subProject = thisObj.props.subProjects.find(
                        (subProject: $TSFixMe) => subProject._id === data.projectId
                    );
                    const isUserInSubProject = subProject
                        ? subProject.users.some(
                              (user: $TSFixMe) => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInSubProject)
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'updatelighthouselogbysocket' does not ex... Remove this comment to see the full error message
                        thisObj.props.updatelighthouselogbysocket(data);
                }
            });
            socket.on(`updateAllLighthouseLog-${projectId}`, function(data: $TSFixMe) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                const isUserInProject = thisObj.props.project
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                    ? thisObj.props.project.users.some(
                          (user: $TSFixMe) => user.userId === loggedInUser
                      )
                    : false;
                if (isUserInProject) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateAlllighthouselogbysocket' does not... Remove this comment to see the full error message
                    thisObj.props.updateAlllighthouselogbysocket(data);
                } else {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
                    const subProject = thisObj.props.subProjects.find(
                        (subProject: $TSFixMe) => subProject._id === data.projectId
                    );
                    const isUserInSubProject = subProject
                        ? subProject.users.some(
                              (user: $TSFixMe) => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInSubProject)
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateAlllighthouselogbysocket' does not... Remove this comment to see the full error message
                        thisObj.props.updateAlllighthouselogbysocket(data);
                }
            });
            socket.on(`updateProbe`, function(data: $TSFixMe) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                const isUserInProject = thisObj.props.project
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                    ? thisObj.props.project.users.some(
                          (user: $TSFixMe) => user.userId === loggedInUser
                      )
                    : false;
                if (isUserInProject) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateprobebysocket' does not exist on t... Remove this comment to see the full error message
                    return thisObj.props.updateprobebysocket(data);
                } else {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
                    const subProject = thisObj.props.subProjects.find(
                        (subProject: $TSFixMe) => subProject._id === data.projectId
                    );
                    const isUserInSubProject = subProject
                        ? subProject.users.some(
                              (user: $TSFixMe) => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInSubProject)
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateprobebysocket' does not exist on t... Remove this comment to see the full error message
                        return thisObj.props.updateprobebysocket(data);
                }
            });
            socket.on(`NewNotification-${projectId}`, function(data: $TSFixMe) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                const isUserInProject = thisObj.props.project
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                    ? thisObj.props.project.users.some(
                          (user: $TSFixMe) => user.userId === loggedInUser
                      )
                    : false;
                if (isUserInProject) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'addnotifications' does not exist on type... Remove this comment to see the full error message
                    thisObj.props.addnotifications(data);
                } else {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
                    const subProject = thisObj.props.subProjects.find(
                        (subProject: $TSFixMe) => subProject._id === data.projectId
                    );
                    const isUserInSubProject = subProject
                        ? subProject.users.some(
                              (user: $TSFixMe) => user.userId === loggedInUser
                          )
                        : false;

                    if (isUserInSubProject)
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'addnotifications' does not exist on type... Remove this comment to see the full error message
                        thisObj.props.addnotifications(data);
                }
            });
            socket.on(`TeamMemberRoleUpdate-${projectId}`, function(data: $TSFixMe) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                const isUserInProject = thisObj.props.project
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                    ? thisObj.props.project.users.some(
                          (user: $TSFixMe) => user.userId === loggedInUser
                      )
                    : false;
                if (isUserInProject) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'teamMemberRoleUpdate' does not exist on ... Remove this comment to see the full error message
                    thisObj.props.teamMemberRoleUpdate(data.response);
                } else {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
                    const subProject = thisObj.props.subProjects.find(
                        (subProject: $TSFixMe) => subProject._id === data.projectId
                    );
                    const isUserInSubProject = subProject
                        ? subProject.users.some(
                              (user: $TSFixMe) => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInSubProject)
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'teamMemberRoleUpdate' does not exist on ... Remove this comment to see the full error message
                        thisObj.props.teamMemberRoleUpdate(data.response);
                }
            });
            socket.on(`TeamMemberCreate-${projectId}`, function(data: $TSFixMe) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                const isUserInProject = thisObj.props.project
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                    ? thisObj.props.project.users.some(
                          (user: $TSFixMe) => user.userId === loggedInUser
                      )
                    : false;
                if (isUserInProject) {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'teamMemberCreate' does not exist on type... Remove this comment to see the full error message
                    thisObj.props.teamMemberCreate(data.users);
                } else {
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
                    const subProject = thisObj.props.subProjects.find(
                        (subProject: $TSFixMe) => subProject._id === projectId
                    );
                    const isUserInSubProject = subProject
                        ? subProject.users.some(
                              (user: $TSFixMe) => user.userId === loggedInUser
                          )
                        : false;

                    if (isUserInSubProject)
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'teamMemberCreate' does not exist on type... Remove this comment to see the full error message
                        thisObj.props.teamMemberCreate(data.users);
                }
            });
            socket.on(`TeamMemberDelete-${projectId}`, function(data: $TSFixMe) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                if (data.projectId === thisObj.props.project._id) {
                    const projectUser = data.teamMembers.find(
                        (member: $TSFixMe) => member.userId === User.getUserId()
                    );
                    if (!projectUser) {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
                        thisObj.props.openModal({
                            id: uuidv4(),
                            onClose: () => '',
                            // @ts-expect-error ts-migrate(2794) FIXME: Expected 1 arguments, but got 0. Did you forget to... Remove this comment to see the full error message
                            onConfirm: () => new Promise(resolve => resolve()),
                            content: RemovedFromProjectModal,
                        });
                    }
                } else {
                    const subProjectUser = data.teamMembers.find(
                        (member: $TSFixMe) => member.userId === User.getUserId()
                    );
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                    const mainUser = thisObj.props.project?.users.find(
                        (user: $TSFixMe) => (user.userId._id || user.userId) ===
                            User.getUserId() &&
                        (user.role === 'Owner' ||
                            user.role === 'Administrator')
                    );
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
                    const subProject = thisObj.props.subProjects.find(
                        (subProject: $TSFixMe) => subProject._id === data.projectId
                    );
                    const subProjectName = subProject ? subProject.name : '';
                    if (!subProjectUser && !mainUser) {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
                        thisObj.props.openModal({
                            id: uuidv4(),
                            onClose: () => '',
                            // @ts-expect-error ts-migrate(2794) FIXME: Expected 1 arguments, but got 0. Did you forget to... Remove this comment to see the full error message
                            onConfirm: () => new Promise(resolve => resolve()),
                            content: DataPathHoC(RemovedFromSubProjectModal, {
                                name: subProjectName,
                            }),
                        });
                    }
                }
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'teamMemberDelete' does not exist on type... Remove this comment to see the full error message
                thisObj.props.teamMemberDelete(data.response);
            });
            socket.on(`addIncidentNote-${projectId}`, function(data: $TSFixMe) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'addIncidentNote' does not exist on type ... Remove this comment to see the full error message
                thisObj.props.addIncidentNote(data);
            });
            socket.on(`incidentTimeline-${projectId}`, function(data: $TSFixMe) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateTimelineBySocket' does not exist o... Remove this comment to see the full error message
                thisObj.props.updateTimelineBySocket(data);
            });
            socket.on(`createMonitor-${projectId}`, function(data: $TSFixMe) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'createMonitor' does not exist on type 'R... Remove this comment to see the full error message
                thisObj.props.createMonitor(data);
            });
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createScheduledEventSuccess' does not ex... Remove this comment to see the full error message
            socket.on(`addScheduledEvent-${projectId}`, (event: $TSFixMe) => thisObj.props.createScheduledEventSuccess(event)
            );

            // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteScheduledEventSuccess' does not ex... Remove this comment to see the full error message
            socket.on(`deleteScheduledEvent-${projectId}`, (event: $TSFixMe) => thisObj.props.deleteScheduledEventSuccess(event)
            );

            // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateScheduledEventSuccess' does not ex... Remove this comment to see the full error message
            socket.on(`updateScheduledEvent-${projectId}`, (event: $TSFixMe) => thisObj.props.updateScheduledEventSuccess(event)
            );

            socket.on(`updateIncident-${projectId}`, (incident: $TSFixMe) => {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'updateincidentbysocket' does not exist o... Remove this comment to see the full error message
                thisObj.props.updateincidentbysocket(incident);
            });

            socket.on(`deleteIncident-${projectId}`, (incident: $TSFixMe) => {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleteincidentbysocket' does not exist o... Remove this comment to see the full error message
                thisObj.props.deleteincidentbysocket(incident);
            });

            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolvescheduledevent' does not exist on... Remove this comment to see the full error message
            socket.on(`resolveScheduledEvent-${projectId}`, (event: $TSFixMe) => thisObj.props.resolvescheduledevent(event)
            );

            // @ts-expect-error ts-migrate(2339) FIXME: Property 'slacountdown' does not exist on type 'Re... Remove this comment to see the full error message
            socket.on(`slaCountDown-${projectId}`, (event: $TSFixMe) => thisObj.props.slacountdown({
                incident: event.incident,
                countDown: event.countDown,
            })
            );
        }
        return null;
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
SocketApp.displayName = 'SocketApp';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
SocketApp.propTypes = {
    project: PropTypes.object,
    activeProjectId: PropTypes.string,
};

const mapStateToProps = (state: $TSFixMe) => ({
    project: state.project.currentProject,
    subProjects: state.subProject.subProjects.subProjects,
    probes: state.probe.probes.data,
    activeProjectId: state.subProject.activeSubProject
});

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        incidentresolvedbysocket,
        incidentacknowledgedbysocket,
        deletemonitorbysocket,
        updatemonitorbysocket,
        createmonitorbysocket,
        incidentcreatedbysocket,
        updatemonitorlogbysocket,
        updatemonitorstatusbysocket,
        updateincidenttimelinebysocket,
        updateincidentbysocket,
        updatelighthouselogbysocket,
        updateprobebysocket,
        addnotifications,
        teamMemberRoleUpdate,
        teamMemberCreate,
        teamMemberDelete,
        openModal,
        closeModal,
        addIncidentNote,
        updateTimelineBySocket,
        createMonitor,
        createScheduledEventSuccess,
        updateScheduledEventSuccess,
        deleteScheduledEventSuccess,
        deleteincidentbysocket,
        resolvescheduledevent,
        slacountdown,
        updateAlllighthouselogbysocket,
    },
    dispatch
);

export default connect(mapStateToProps, mapDispatchToProps)(SocketApp);
