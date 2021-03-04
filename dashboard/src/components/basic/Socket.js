import { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import io from 'socket.io-client';
import RemovedFromSubProjectModal from '../modals/RemovedFromSubProject';
import RemovedFromProjectModal from '../modals/RemovedFromProject';
import { User, API_URL } from '../../config';
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
} from '../../actions/socket';
import DataPathHoC from '../DataPathHoC';
import {
    createScheduledEventSuccess,
    updateScheduledEventSuccess,
    deleteScheduledEventSuccess,
} from '../../actions/scheduledEvent';

// Important: Below `/api` is also needed because `io` constructor strips out the path from the url.
const socket = io.connect(API_URL.replace('/api', ''), {
    path: '/api/socket.io',
});

class SocketApp extends Component {
    shouldComponentUpdate(nextProps) {
        if (this.props.project !== nextProps.project) {
            if (this.props.project) {
                socket.removeListener(
                    `incidentResolved-${this.props.project._id}`
                );
                socket.removeListener(
                    `incidentAcknowledged-${this.props.project._id}`
                );
                socket.removeListener(
                    `createMonitor-${this.props.project._id}`
                );
                socket.removeListener(
                    `updateMonitor-${this.props.project._id}`
                );
                socket.removeListener(
                    `deleteMonitor-${this.props.project._id}`
                );
                socket.removeListener(
                    `incidentCreated-${this.props.project._id}`
                );
                socket.removeListener(
                    `updateMonitorLog-${this.props.project._id}`
                );
                socket.removeListener(
                    `updateMonitorStatus-${this.props.project._id}`
                );
                socket.removeListener(
                    `updateIncidentTimeline-${this.props.project._id}`
                );
                socket.removeListener(
                    `updateIncident-${this.props.project._id}`
                );
                socket.removeListener(
                    `updateLighthouseLog-${this.props.project._id}`
                );
                socket.removeListener(
                    `updateAllLighthouseLog-${this.props.project._id}`
                );
                socket.removeListener(`updateProbe-${this.props.project._id}`);
                socket.removeListener(
                    `NewNotification-${this.props.project._id}`
                );
                socket.removeListener(
                    `TeamMemberRoleUpdate-${this.props.project._id}`
                );
                socket.removeListener(
                    `TeamMemberCreate-${this.props.project._id}`
                );
                socket.removeListener(
                    `TeamMemberDelete-${this.props.project._id}`
                );
                socket.removeListener(
                    `addIncidentNote-${this.props.project._id}`
                );
                socket.removeListener(
                    `createMonitor-${this.props.project._id}`
                );
                socket.removeListener(
                    `addScheduledEvent-${this.props.project._id}`
                );
                socket.removeListener(
                    `deleteScheduledEvent-${this.props.project._id}`
                );
                socket.removeListener(
                    `updateScheduledEvent-${this.props.project._id}`
                );
                socket.removeListener(
                    `deleteIncident-${this.props.project._id}`
                );
                socket.removeListener(
                    `resolveScheduledEvent-${this.props.project._id}`
                );
                socket.removeListener(`slaCountDown-${this.props.project._id}`);
            }
            return true;
        } else {
            return false;
        }
    }

    render() {
        const thisObj = this;
        const loggedInUser = User.getUserId();

        if (this.props.project) {
            socket.on(`incidentResolved-${this.props.project._id}`, function(
                data
            ) {
                const isUserInProject = thisObj.props.project
                    ? thisObj.props.project.users.some(
                          user => user.userId === loggedInUser
                      )
                    : false;
                if (isUserInProject) {
                    if (!data.resolvedBy) {
                        thisObj.props.incidentresolvedbysocket(data);
                    } else if (data.resolvedBy._id !== User.getUserId()) {
                        thisObj.props.incidentresolvedbysocket(data);
                    }
                } else {
                    const subProject = thisObj.props.subProjects.find(
                        subProject => subProject._id === data.projectId
                    );
                    const isUserInSubProject = subProject
                        ? subProject.users.some(
                              user => user.userId === loggedInUser
                          )
                        : false;
                    if (
                        data &&
                        data.createdById &&
                        data.createdById._id !== User.getUserId()
                    ) {
                        if (!data.resolvedBy) {
                            if (isUserInSubProject)
                                thisObj.props.incidentresolvedbysocket(data);
                        } else if (data.resolvedBy._id !== User.getUserId()) {
                            if (isUserInSubProject)
                                thisObj.props.incidentresolvedbysocket(data);
                        }
                    }
                }
            });
            socket.on(
                `incidentAcknowledged-${this.props.project._id}`,
                function(data) {
                    const isUserInProject = thisObj.props.project
                        ? thisObj.props.project.users.some(
                              user => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInProject) {
                        if (!data.acknowledgedBy) {
                            thisObj.props.incidentacknowledgedbysocket(data);
                        } else if (
                            data.acknowledgedBy &&
                            data.acknowledgedBy._id !== User.getUserId()
                        ) {
                            thisObj.props.incidentacknowledgedbysocket(data);
                        }
                    } else {
                        const subProject = thisObj.props.subProjects.find(
                            subProject => subProject._id === data.projectId
                        );
                        const isUserInSubProject = subProject
                            ? subProject.users.some(
                                  user => user.userId === loggedInUser
                              )
                            : false;
                        if (
                            data &&
                            data.createdById &&
                            data.createdById._id !== User.getUserId()
                        ) {
                            if (!data.acknowledgedBy) {
                                if (isUserInSubProject)
                                    thisObj.props.incidentacknowledgedbysocket(
                                        data
                                    );
                            } else if (
                                data.acknowledgedBy &&
                                data.acknowledgedBy._id !== User.getUserId()
                            ) {
                                if (isUserInSubProject)
                                    thisObj.props.incidentacknowledgedbysocket(
                                        data
                                    );
                            }
                        }
                    }
                }
            );
            socket.on(`createMonitor-${this.props.project._id}`, function(
                data
            ) {
                const isUserInProject = thisObj.props.project
                    ? thisObj.props.project.users.some(
                          user => user.userId === loggedInUser
                      )
                    : false;
                if (isUserInProject) {
                    if (data.createdById !== User.getUserId()) {
                        thisObj.props.createmonitorbysocket(data);
                    }
                } else {
                    const subProject = thisObj.props.subProjects.find(
                        subProject => subProject._id === data.projectId._id
                    );
                    const isUserInSubProject = subProject
                        ? subProject.users.some(
                              user => user.userId === loggedInUser
                          )
                        : false;
                    if (data.createdById !== User.getUserId()) {
                        if (isUserInSubProject)
                            thisObj.props.createmonitorbysocket(data);
                    }
                }
            });
            socket.on(`updateMonitor-${this.props.project._id}`, function(
                data
            ) {
                const isUserInProject = thisObj.props.project
                    ? thisObj.props.project.users.some(
                          user => user.userId === loggedInUser
                      )
                    : false;
                if (isUserInProject) {
                    thisObj.props.updatemonitorbysocket(data);
                } else {
                    const subProject = thisObj.props.subProjects.find(
                        subProject => subProject._id === data.projectId._id
                    );
                    const isUserInSubProject = subProject
                        ? subProject.users.some(
                              user => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInSubProject)
                        thisObj.props.updatemonitorbysocket(data);
                }
            });
            socket.on(`deleteMonitor-${this.props.project._id}`, function(
                data
            ) {
                const isUserInProject = thisObj.props.project
                    ? thisObj.props.project.users.some(
                          user => user.userId === loggedInUser
                      )
                    : false;
                if (isUserInProject) {
                    thisObj.props.deletemonitorbysocket(data);
                } else {
                    const subProject = thisObj.props.subProjects.find(
                        subProject => subProject._id === data.projectId
                    );
                    const isUserInSubProject = subProject
                        ? subProject.users.some(
                              user => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInSubProject)
                        thisObj.props.deletemonitorbysocket(data);
                }
            });
            socket.on(`incidentCreated-${this.props.project._id}`, function(
                data
            ) {
                const isUserInProject = thisObj.props.project
                    ? thisObj.props.project.users.some(
                          user => user.userId === loggedInUser
                      )
                    : false;
                if (isUserInProject) {
                    if (
                        data &&
                        ((data.createdById &&
                            data.createdById._id !== User.getUserId()) ||
                            data.createdById === null)
                    ) {
                        thisObj.props.incidentcreatedbysocket(data);
                    }
                } else {
                    const subProject = thisObj.props.subProjects.find(
                        subProject => subProject._id === data.projectId
                    );
                    const isUserInSubProject = subProject
                        ? subProject.users.some(
                              user => user.userId === loggedInUser
                          )
                        : false;
                    if (
                        data &&
                        ((data.createdById &&
                            data.createdById._id !== User.getUserId()) ||
                            data.createdById === null)
                    ) {
                        if (isUserInSubProject)
                            thisObj.props.incidentcreatedbysocket(data);
                    }
                }
            });
            socket.on(`updateMonitorLog-${this.props.project._id}`, function(
                data
            ) {
                const isUserInProject = thisObj.props.project
                    ? thisObj.props.project.users.some(
                          user => user.userId === loggedInUser
                      )
                    : false;
                if (isUserInProject) {
                    thisObj.props.updatemonitorlogbysocket(data);
                } else {
                    const subProject = thisObj.props.subProjects.find(
                        subProject => subProject._id === data.projectId
                    );
                    const isUserInSubProject = subProject
                        ? subProject.users.some(
                              user => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInSubProject)
                        thisObj.props.updatemonitorlogbysocket(data);
                }
            });
            socket.on(`updateMonitorStatus-${this.props.project._id}`, function(
                data
            ) {
                const isUserInProject = thisObj.props.project
                    ? thisObj.props.project.users.some(
                          user => user.userId === loggedInUser
                      )
                    : false;
                if (isUserInProject) {
                    thisObj.props.updatemonitorstatusbysocket(
                        data,
                        thisObj.props.probes
                    );
                } else {
                    const subProject = thisObj.props.subProjects.find(
                        subProject => subProject._id === data.projectId
                    );
                    const isUserInSubProject = subProject
                        ? subProject.users.some(
                              user => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInSubProject)
                        thisObj.props.updatemonitorstatusbysocket(
                            data,
                            thisObj.props.probes
                        );
                }
            });
            socket.on(
                `updateIncidentTimeline-${this.props.project._id}`,
                function(data) {
                    const isUserInProject = thisObj.props.project
                        ? thisObj.props.project.users.some(
                              user => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInProject) {
                        thisObj.props.updateincidenttimelinebysocket(data);
                    } else {
                        const subProject = thisObj.props.subProjects.find(
                            subProject => subProject._id === data.projectId
                        );
                        const isUserInSubProject = subProject
                            ? subProject.users.some(
                                  user => user.userId === loggedInUser
                              )
                            : false;
                        if (isUserInSubProject)
                            thisObj.props.updateincidenttimelinebysocket(data);
                    }
                }
            );
            socket.on(`updateLighthouseLog-${this.props.project._id}`, function(
                data
            ) {
                const isUserInProject = thisObj.props.project
                    ? thisObj.props.project.users.some(
                          user => user.userId === loggedInUser
                      )
                    : false;
                if (isUserInProject) {
                    thisObj.props.updatelighthouselogbysocket(data);
                } else {
                    const subProject = thisObj.props.subProjects.find(
                        subProject => subProject._id === data.projectId
                    );
                    const isUserInSubProject = subProject
                        ? subProject.users.some(
                              user => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInSubProject)
                        thisObj.props.updatelighthouselogbysocket(data);
                }
            });
            socket.on(
                `updateAllLighthouseLog-${this.props.project._id}`,
                function(data) {
                    const isUserInProject = thisObj.props.project
                        ? thisObj.props.project.users.some(
                              user => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInProject) {
                        thisObj.props.updateAlllighthouselogbysocket(data);
                    } else {
                        const subProject = thisObj.props.subProjects.find(
                            subProject => subProject._id === data.projectId
                        );
                        const isUserInSubProject = subProject
                            ? subProject.users.some(
                                  user => user.userId === loggedInUser
                              )
                            : false;
                        if (isUserInSubProject)
                            thisObj.props.updateAlllighthouselogbysocket(data);
                    }
                }
            );
            socket.on(`updateProbe-${this.props.project._id}`, function(data) {
                const isUserInProject = thisObj.props.project
                    ? thisObj.props.project.users.some(
                          user => user.userId === loggedInUser
                      )
                    : false;
                if (isUserInProject) {
                    thisObj.props.updateprobebysocket(data);
                } else {
                    const subProject = thisObj.props.subProjects.find(
                        subProject => subProject._id === data.projectId
                    );
                    const isUserInSubProject = subProject
                        ? subProject.users.some(
                              user => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInSubProject)
                        thisObj.props.updateprobebysocket(data);
                }
            });
            socket.on(`NewNotification-${this.props.project._id}`, function(
                data
            ) {
                const isUserInProject = thisObj.props.project
                    ? thisObj.props.project.users.some(
                          user => user.userId === loggedInUser
                      )
                    : false;
                if (isUserInProject) {
                    if (data.createdBy && data.createdBy !== User.getUserId()) {
                        thisObj.props.addnotifications(data);
                    }
                } else {
                    const subProject = thisObj.props.subProjects.find(
                        subProject => subProject._id === data.projectId
                    );
                    const isUserInSubProject = subProject
                        ? subProject.users.some(
                              user => user.userId === loggedInUser
                          )
                        : false;
                    if (data.createdBy && data.createdBy !== User.getUserId()) {
                        if (isUserInSubProject)
                            thisObj.props.addnotifications(data);
                    }
                }
            });
            socket.on(
                `TeamMemberRoleUpdate-${this.props.project._id}`,
                function(data) {
                    const isUserInProject = thisObj.props.project
                        ? thisObj.props.project.users.some(
                              user => user.userId === loggedInUser
                          )
                        : false;
                    if (isUserInProject) {
                        thisObj.props.teamMemberRoleUpdate(data.response);
                    } else {
                        const subProject = thisObj.props.subProjects.find(
                            subProject => subProject._id === data.projectId
                        );
                        const isUserInSubProject = subProject
                            ? subProject.users.some(
                                  user => user.userId === loggedInUser
                              )
                            : false;
                        if (isUserInSubProject)
                            thisObj.props.teamMemberRoleUpdate(data.response);
                    }
                }
            );
            socket.on(`TeamMemberCreate-${this.props.project._id}`, function(
                data
            ) {
                const isUserInProject = thisObj.props.project
                    ? thisObj.props.project.users.some(
                          user => user.userId === loggedInUser
                      )
                    : false;
                if (isUserInProject) {
                    if (data.userId !== User.getUserId()) {
                        thisObj.props.teamMemberCreate(data.response);
                    }
                } else {
                    const subProject = thisObj.props.subProjects.find(
                        subProject => subProject._id === data.projectId
                    );
                    const isUserInSubProject = subProject
                        ? subProject.users.some(
                              user => user.userId === loggedInUser
                          )
                        : false;
                    if (data.userId !== User.getUserId()) {
                        if (isUserInSubProject)
                            thisObj.props.teamMemberCreate(data.response);
                    }
                }
            });
            socket.on(`TeamMemberDelete-${this.props.project._id}`, function(
                data
            ) {
                if (data.projectId === thisObj.props.project._id) {
                    const projectUser = data.teamMembers.find(
                        member => member.userId === User.getUserId()
                    );
                    if (!projectUser) {
                        thisObj.props.openModal({
                            id: uuidv4(),
                            onClose: () => '',
                            onConfirm: () => new Promise(resolve => resolve()),
                            content: RemovedFromProjectModal,
                        });
                    }
                } else {
                    const subProjectUser = data.teamMembers.find(
                        member => member.userId === User.getUserId()
                    );
                    const subProject = thisObj.props.subProjects.find(
                        subProject => subProject._id === data.projectId
                    );
                    const subProjectName = subProject ? subProject.name : '';
                    if (!subProjectUser) {
                        thisObj.props.openModal({
                            id: uuidv4(),
                            onClose: () => '',
                            onConfirm: () => new Promise(resolve => resolve()),
                            content: DataPathHoC(RemovedFromSubProjectModal, {
                                name: subProjectName,
                            }),
                        });
                    }
                }
                thisObj.props.teamMemberDelete(data.response);
            });
            socket.on(`addIncidentNote-${this.props.project._id}`, function(
                data
            ) {
                thisObj.props.addIncidentNote(data);
            });
            socket.on(`createMonitor-${this.props.project._id}`, function(
                data
            ) {
                thisObj.props.createMonitor(data);
            });
            socket.on(`addScheduledEvent-${this.props.project._id}`, event =>
                thisObj.props.createScheduledEventSuccess(event)
            );

            socket.on(`deleteScheduledEvent-${this.props.project._id}`, event =>
                thisObj.props.deleteScheduledEventSuccess(event)
            );

            socket.on(`updateScheduledEvent-${this.props.project._id}`, event =>
                thisObj.props.updateScheduledEventSuccess(event)
            );

            socket.on(`updateIncident-${this.props.project._id}`, incident => {
                thisObj.props.updateincidentbysocket(incident);
            });

            socket.on(`deleteIncident-${this.props.project._id}`, incident => {
                thisObj.props.deleteincidentbysocket(incident);
            });

            socket.on(
                `resolveScheduledEvent-${this.props.project._id}`,
                event => thisObj.props.resolvescheduledevent(event)
            );

            socket.on(`slaCountDown-${this.props.project._id}`, event =>
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
    project: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
    _id: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
};

const mapStateToProps = state => ({
    project: state.project.currentProject,
    subProjects: state.subProject.subProjects.subProjects,
    probes: state.probe.probes.data,
});

const mapDispatchToProps = dispatch =>
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
