import { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import io from 'socket.io-client';
import RemovedFromSubProjectModal from '../modals/RemovedFromSubProject';
import RemovedFromProjectModal from '../modals/RemovedFromProject';
import { User, REALTIME_URL } from '../../config';

import { v4 as uuidv4 } from 'uuid';
import { openModal, closeModal } from 'common-ui/actions/modal';
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

export const socket = io.connect(REALTIME_URL.replace('/realtime', ''), {
    path: '/realtime/socket.io',
    transports: ['websocket', 'polling'],
});

interface SocketAppProps {
    project?: object;
    activeProjectId?: string;
}

class SocketApp extends Component<SocketAppProps> {
    shouldComponentUpdate(nextProps: $TSFixMe) {
        if (
            this.props.project !== nextProps.project ||
            this.props.activeProjectId !== nextProps.activeProjectId
        ) {
            if (this.props.project && this.props.activeProjectId) {
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

        if (this.props.project && this.props.activeProjectId) {
            const projectId = this.props.activeProjectId;
            socket.on(
                `incidentResolved-${projectId}`,
                function (data: $TSFixMe) {
                    const isUserInProject = thisObj.props.project
                        ? thisObj.props.project.users.some(
                              (user: $TSFixMe) => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInProject) {
                        thisObj.props.incidentresolvedbysocket(data);
                    } else {
                        const subProject = thisObj.props.subProjects.find(
                            (subProject: $TSFixMe) =>
                                subProject._id === data.projectId
                        );
                        const isUserInSubProject = subProject
                            ? subProject.users.some(
                                  (user: $TSFixMe) =>
                                      user.userId === loggedInUser
                              )
                            : false;

                        if (isUserInSubProject)
                            thisObj.props.incidentresolvedbysocket(data);
                    }
                }
            );
            socket.on(
                `incidentAcknowledged-${projectId}`,
                function (data: $TSFixMe) {
                    const isUserInProject = thisObj.props.project
                        ? thisObj.props.project.users.some(
                              (user: $TSFixMe) => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInProject) {
                        thisObj.props.incidentacknowledgedbysocket(data);
                    } else {
                        const subProject = thisObj.props.subProjects.find(
                            (subProject: $TSFixMe) =>
                                subProject._id === data.projectId
                        );
                        const isUserInSubProject = subProject
                            ? subProject.users.some(
                                  (user: $TSFixMe) =>
                                      user.userId === loggedInUser
                              )
                            : false;

                        if (isUserInSubProject)
                            thisObj.props.incidentacknowledgedbysocket(data);
                    }
                }
            );
            socket.on(`createMonitor-${projectId}`, function (data: $TSFixMe) {
                const isUserInProject = thisObj.props.project
                    ? thisObj.props.project.users.some(
                          (user: $TSFixMe) => user.userId === loggedInUser
                      )
                    : false;
                if (isUserInProject) {
                    if (data.createdById !== User.getUserId()) {
                        thisObj.props.createmonitorbysocket(data);
                    }
                } else {
                    const subProject = thisObj.props.subProjects.find(
                        (subProject: $TSFixMe) =>
                            subProject._id === data.projectId._id
                    );
                    const isUserInSubProject = subProject
                        ? subProject.users.some(
                              (user: $TSFixMe) => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInSubProject)
                        thisObj.props.createmonitorbysocket(data);
                }
            });
            socket.on(`updateMonitor-${projectId}`, function (data: $TSFixMe) {
                const isUserInProject = thisObj.props.project
                    ? thisObj.props.project.users.some(
                          (user: $TSFixMe) => user.userId === loggedInUser
                      )
                    : false;
                if (isUserInProject) {
                    thisObj.props.updatemonitorbysocket(data);
                } else {
                    const subProject = thisObj.props.subProjects.find(
                        (subProject: $TSFixMe) =>
                            subProject._id === data.projectId._id
                    );
                    const isUserInSubProject = subProject
                        ? subProject.users.some(
                              (user: $TSFixMe) => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInSubProject)
                        thisObj.props.updatemonitorbysocket(data);
                }
            });
            socket.on(`deleteMonitor-${projectId}`, function (data: $TSFixMe) {
                const isUserInProject = thisObj.props.project
                    ? thisObj.props.project.users.some(
                          (user: $TSFixMe) => user.userId === loggedInUser
                      )
                    : false;
                if (isUserInProject) {
                    thisObj.props.deletemonitorbysocket(data);
                } else {
                    const subProject = thisObj.props.subProjects.find(
                        (subProject: $TSFixMe) =>
                            subProject._id === data.projectId
                    );
                    const isUserInSubProject = subProject
                        ? subProject.users.some(
                              (user: $TSFixMe) => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInSubProject)
                        thisObj.props.deletemonitorbysocket(data);
                }
            });
            socket.on(
                `incidentCreated-${projectId}`,
                function (data: $TSFixMe) {
                    const isUserInProject = thisObj.props.project
                        ? thisObj.props.project.users.some(
                              (user: $TSFixMe) => user.userId === loggedInUser
                          )
                        : false;

                    if (isUserInProject) {
                        thisObj.props.incidentcreatedbysocket(data);
                    } else {
                        const subProject = thisObj.props.subProjects.find(
                            (subProject: $TSFixMe) =>
                                subProject._id === data.projectId
                        );
                        const isUserInSubProject = subProject
                            ? subProject.users.some(
                                  (user: $TSFixMe) =>
                                      user.userId === loggedInUser
                              )
                            : false;

                        if (isUserInSubProject) {
                            thisObj.props.incidentcreatedbysocket(data);
                        }
                    }
                }
            );
            socket.on(
                `updateMonitorLog-${projectId}`,
                function (data: $TSFixMe) {
                    const isUserInProject = thisObj.props.project
                        ? thisObj.props.project.users.some(
                              (user: $TSFixMe) => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInProject) {
                        thisObj.props.updatemonitorlogbysocket(data);
                    } else {
                        const subProject = thisObj.props.subProjects.find(
                            (subProject: $TSFixMe) =>
                                subProject._id === data.projectId
                        );
                        const isUserInSubProject = subProject
                            ? subProject.users.some(
                                  (user: $TSFixMe) =>
                                      user.userId === loggedInUser
                              )
                            : false;
                        if (isUserInSubProject)
                            thisObj.props.updatemonitorlogbysocket(data);
                    }
                }
            );
            socket.on(
                `updateMonitorStatus-${projectId}`,
                function (data: $TSFixMe) {
                    const isUserInProject = thisObj.props.project
                        ? thisObj.props.project.users.some(
                              (user: $TSFixMe) => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInProject) {
                        thisObj.props.updatemonitorstatusbysocket(
                            data,

                            thisObj.props.probes
                        );
                    } else {
                        const subProject = thisObj.props.subProjects.find(
                            (subProject: $TSFixMe) =>
                                subProject._id === data.projectId
                        );
                        const isUserInSubProject = subProject
                            ? subProject.users.some(
                                  (user: $TSFixMe) =>
                                      user.userId === loggedInUser
                              )
                            : false;
                        if (isUserInSubProject)
                            thisObj.props.updatemonitorstatusbysocket(
                                data,

                                thisObj.props.probes
                            );
                    }
                }
            );
            socket.on(
                `updateIncidentTimeline-${projectId}`,
                function (data: $TSFixMe) {
                    const isUserInProject = thisObj.props.project
                        ? thisObj.props.project.users.some(
                              (user: $TSFixMe) => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInProject) {
                        thisObj.props.updateincidenttimelinebysocket(data);
                    } else {
                        const subProject = thisObj.props.subProjects.find(
                            (subProject: $TSFixMe) =>
                                subProject._id === data.projectId
                        );
                        const isUserInSubProject = subProject
                            ? subProject.users.some(
                                  (user: $TSFixMe) =>
                                      user.userId === loggedInUser
                              )
                            : false;
                        if (isUserInSubProject)
                            thisObj.props.updateincidenttimelinebysocket(data);
                    }
                }
            );
            socket.on(
                `updateLighthouseLog-${projectId}`,
                function (data: $TSFixMe) {
                    const isUserInProject = thisObj.props.project
                        ? thisObj.props.project.users.some(
                              (user: $TSFixMe) => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInProject) {
                        thisObj.props.updatelighthouselogbysocket(data);
                    } else {
                        const subProject = thisObj.props.subProjects.find(
                            (subProject: $TSFixMe) =>
                                subProject._id === data.projectId
                        );
                        const isUserInSubProject = subProject
                            ? subProject.users.some(
                                  (user: $TSFixMe) =>
                                      user.userId === loggedInUser
                              )
                            : false;
                        if (isUserInSubProject)
                            thisObj.props.updatelighthouselogbysocket(data);
                    }
                }
            );
            socket.on(
                `updateAllLighthouseLog-${projectId}`,
                function (data: $TSFixMe) {
                    const isUserInProject = thisObj.props.project
                        ? thisObj.props.project.users.some(
                              (user: $TSFixMe) => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInProject) {
                        thisObj.props.updateAlllighthouselogbysocket(data);
                    } else {
                        const subProject = thisObj.props.subProjects.find(
                            (subProject: $TSFixMe) =>
                                subProject._id === data.projectId
                        );
                        const isUserInSubProject = subProject
                            ? subProject.users.some(
                                  (user: $TSFixMe) =>
                                      user.userId === loggedInUser
                              )
                            : false;
                        if (isUserInSubProject)
                            thisObj.props.updateAlllighthouselogbysocket(data);
                    }
                }
            );
            socket.on(`updateProbe`, function (data: $TSFixMe) {
                const isUserInProject = thisObj.props.project
                    ? thisObj.props.project.users.some(
                          (user: $TSFixMe) => user.userId === loggedInUser
                      )
                    : false;
                if (isUserInProject) {
                    return thisObj.props.updateprobebysocket(data);
                } else {
                    const subProject = thisObj.props.subProjects.find(
                        (subProject: $TSFixMe) =>
                            subProject._id === data.projectId
                    );
                    const isUserInSubProject = subProject
                        ? subProject.users.some(
                              (user: $TSFixMe) => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInSubProject)
                        return thisObj.props.updateprobebysocket(data);
                }
            });
            socket.on(
                `NewNotification-${projectId}`,
                function (data: $TSFixMe) {
                    const isUserInProject = thisObj.props.project
                        ? thisObj.props.project.users.some(
                              (user: $TSFixMe) => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInProject) {
                        thisObj.props.addnotifications(data);
                    } else {
                        const subProject = thisObj.props.subProjects.find(
                            (subProject: $TSFixMe) =>
                                subProject._id === data.projectId
                        );
                        const isUserInSubProject = subProject
                            ? subProject.users.some(
                                  (user: $TSFixMe) =>
                                      user.userId === loggedInUser
                              )
                            : false;

                        if (isUserInSubProject)
                            thisObj.props.addnotifications(data);
                    }
                }
            );
            socket.on(
                `TeamMemberRoleUpdate-${projectId}`,
                function (data: $TSFixMe) {
                    const isUserInProject = thisObj.props.project
                        ? thisObj.props.project.users.some(
                              (user: $TSFixMe) => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInProject) {
                        thisObj.props.teamMemberRoleUpdate(data.response);
                    } else {
                        const subProject = thisObj.props.subProjects.find(
                            (subProject: $TSFixMe) =>
                                subProject._id === data.projectId
                        );
                        const isUserInSubProject = subProject
                            ? subProject.users.some(
                                  (user: $TSFixMe) =>
                                      user.userId === loggedInUser
                              )
                            : false;
                        if (isUserInSubProject)
                            thisObj.props.teamMemberRoleUpdate(data.response);
                    }
                }
            );
            socket.on(
                `TeamMemberCreate-${projectId}`,
                function (data: $TSFixMe) {
                    const isUserInProject = thisObj.props.project
                        ? thisObj.props.project.users.some(
                              (user: $TSFixMe) => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInProject) {
                        thisObj.props.teamMemberCreate(data.users);
                    } else {
                        const subProject = thisObj.props.subProjects.find(
                            (subProject: $TSFixMe) =>
                                subProject._id === projectId
                        );
                        const isUserInSubProject = subProject
                            ? subProject.users.some(
                                  (user: $TSFixMe) =>
                                      user.userId === loggedInUser
                              )
                            : false;

                        if (isUserInSubProject)
                            thisObj.props.teamMemberCreate(data.users);
                    }
                }
            );
            socket.on(
                `TeamMemberDelete-${projectId}`,
                function (data: $TSFixMe) {
                    if (data.projectId === thisObj.props.project._id) {
                        const projectUser = data.teamMembers.find(
                            (member: $TSFixMe) =>
                                member.userId === User.getUserId()
                        );
                        if (!projectUser) {
                            thisObj.props.openModal({
                                id: uuidv4(),
                                onClose: () => '',

                                onConfirm: () =>
                                    new Promise(resolve => resolve()),
                                content: RemovedFromProjectModal,
                            });
                        }
                    } else {
                        const subProjectUser = data.teamMembers.find(
                            (member: $TSFixMe) =>
                                member.userId === User.getUserId()
                        );

                        const mainUser = thisObj.props.project?.users.find(
                            (user: $TSFixMe) =>
                                (user.userId._id || user.userId) ===
                                    User.getUserId() &&
                                (user.role === 'Owner' ||
                                    user.role === 'Administrator')
                        );

                        const subProject = thisObj.props.subProjects.find(
                            (subProject: $TSFixMe) =>
                                subProject._id === data.projectId
                        );
                        const subProjectName = subProject
                            ? subProject.name
                            : '';
                        if (!subProjectUser && !mainUser) {
                            thisObj.props.openModal({
                                id: uuidv4(),
                                onClose: () => '',

                                onConfirm: () =>
                                    new Promise(resolve => resolve()),
                                content: DataPathHoC(
                                    RemovedFromSubProjectModal,
                                    {
                                        name: subProjectName,
                                    }
                                ),
                            });
                        }
                    }

                    thisObj.props.teamMemberDelete(data.response);
                }
            );
            socket.on(
                `addIncidentNote-${projectId}`,
                function (data: $TSFixMe) {
                    thisObj.props.addIncidentNote(data);
                }
            );
            socket.on(
                `incidentTimeline-${projectId}`,
                function (data: $TSFixMe) {
                    thisObj.props.updateTimelineBySocket(data);
                }
            );
            socket.on(`createMonitor-${projectId}`, function (data: $TSFixMe) {
                thisObj.props.createMonitor(data);
            });

            socket.on(`addScheduledEvent-${projectId}`, (event: $TSFixMe) =>
                thisObj.props.createScheduledEventSuccess(event)
            );

            socket.on(`deleteScheduledEvent-${projectId}`, (event: $TSFixMe) =>
                thisObj.props.deleteScheduledEventSuccess(event)
            );

            socket.on(`updateScheduledEvent-${projectId}`, (event: $TSFixMe) =>
                thisObj.props.updateScheduledEventSuccess(event)
            );

            socket.on(`updateIncident-${projectId}`, (incident: $TSFixMe) => {
                thisObj.props.updateincidentbysocket(incident);
            });

            socket.on(`deleteIncident-${projectId}`, (incident: $TSFixMe) => {
                thisObj.props.deleteincidentbysocket(incident);
            });

            socket.on(`resolveScheduledEvent-${projectId}`, (event: $TSFixMe) =>
                thisObj.props.resolvescheduledevent(event)
            );

            socket.on(`slaCountDown-${projectId}`, (event: $TSFixMe) =>
                thisObj.props.slacountdown({
                    incident: event.incident,
                    countDown: event.countDown,
                })
            );
        }
        return null;
    }
}

SocketApp.displayName = 'SocketApp';

SocketApp.propTypes = {
    project: PropTypes.object,
    activeProjectId: PropTypes.string,
};

const mapStateToProps = (state: $TSFixMe) => ({
    project: state.project.currentProject,
    subProjects: state.subProject.subProjects.subProjects,
    probes: state.probe.probes.data,
    activeProjectId: state.subProject.activeSubProject,
});

const mapDispatchToProps = (dispatch: Dispatch) =>
    bindActionCreators(
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
