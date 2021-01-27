module.exports = {
    sendCreatedIncident: async incident => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                _id: incident.projectId,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : incident.projectId;

            global.io.emit(`incidentCreated-${projectId}`, incident);
        } catch (error) {
            ErrorService.log('realTimeService.sendCreatedIncident', error);
            throw error;
        }
    },

    sendSlaCountDown: async (incident, countDown) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                _id: incident.projectId,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : incident.projectId;

            global.io.emit(`slaCountDown-${projectId}`, {
                incident,
                countDown,
            });
        } catch (error) {
            ErrorService.log('realTimeService.sendSlaCountDown', error);
            throw error;
        }
    },

    deleteIncident: async incident => {
        try {
            if (!global || !global.io) {
                return;
            }
            const project = await ProjectService.findOneBy({
                _id: incident.projectId,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : incident.projectId;
            global.io.emit(`deleteIncident-${projectId}`, incident);
        } catch (error) {
            ErrorService.log('realTimeService.deleteIncident', error);
            throw error;
        }
    },

    addIncidentNote: async incidentNote => {
        try {
            if (!global || !global.io) {
                return;
            }
            const incident = await IncidentService.findOneBy({
                _id: incidentNote.incidentId._id,
            });
            const project = await ProjectService.findOneBy({
                _id: incident.projectId,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : incident.projectId;

            global.io.emit(`addIncidentNote-${projectId}`, incidentNote);
        } catch (error) {
            ErrorService.log('realTimeService.addIncidentNote', error);
            throw error;
        }
    },

    updateIncidentNote: async incidentNote => {
        try {
            if (!global || !global.io) {
                return;
            }
            const incident = await IncidentService.findOneBy({
                _id: incidentNote.incidentId._id,
            });
            const project = await ProjectService.findOneBy({
                _id: incident.projectId,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : incident.projectId;

            global.io.emit(`updateIncidentNote-${projectId}`, incidentNote);
        } catch (error) {
            ErrorService.log('realTimeService.updateIncidentNote', error);
            throw error;
        }
    },

    updateIncidentTimeline: async incidentTimeline => {
        try {
            if (!global || !global.io) {
                return;
            }
            const project = await ProjectService.findOneBy({
                _id: incidentTimeline.projectId,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : incidentTimeline.projectId;

            global.io.emit(
                `updateIncidentTimeline-${projectId}`,
                incidentTimeline
            );
        } catch (error) {
            ErrorService.log('realTimeService.updateIncidentTimeline', error);
            throw error;
        }
    },

    updateIncident: async incident => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                _id: incident.projectId,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : incident.projectId;

            global.io.emit(`updateIncident-${projectId}`, incident);
        } catch (error) {
            ErrorService.log('realTimeService.updateIncident', error);
            throw error;
        }
    },

    deleteIncidentNote: async incidentNote => {
        try {
            if (!global || !global.io) {
                return;
            }
            const incident = await IncidentService.findOneBy({
                _id: incidentNote.incidentId._id,
            });
            const project = await ProjectService.findOneBy({
                _id: incident.projectId,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : incident.projectId;

            global.io.emit(`deleteIncidentNote-${projectId}`, incidentNote);
        } catch (error) {
            ErrorService.log('realTimeService.deleteIncidentNote', error);
            throw error;
        }
    },

    addScheduledEvent: async event => {
        try {
            const project = await ProjectService.findOneBy({
                _id: event.projectId,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : event.projectId;

            global.io.emit(`addScheduledEvent-${projectId}`, event);
        } catch (error) {
            ErrorService.log('realTimeService.addScheduledEvent', error);
            throw error;
        }
    },

    deleteScheduledEvent: async event => {
        try {
            const project = await ProjectService.findOneBy({
                _id: event.projectId,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : event.projectId;

            global.io.emit(`deleteScheduledEvent-${projectId}`, event);
        } catch (error) {
            ErrorService.log('realTimeService.deleteScheduledEvent', error);
            throw error;
        }
    },

    updateScheduledEvent: async event => {
        try {
            const project = await ProjectService.findOneBy({
                _id: event.projectId,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : event.projectId;

            global.io.emit(`updateScheduledEvent-${projectId}`, event);
        } catch (error) {
            ErrorService.log('realTimeService.updateScheduledEvent', error);
            throw error;
        }
    },

    resolveScheduledEvent: async event => {
        try {
            const project = await ProjectService.findOneBy({
                _id: event.projectId._id,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : event.projectId._id;

            global.io.emit(`resolveScheduledEvent-${projectId}`, event);
        } catch (error) {
            ErrorService.log('realTimeService.resolveScheduledEvent', error);
            throw error;
        }
    },

    addScheduledEventInternalNote: async note => {
        try {
            if (!global || !global.io) {
                return;
            }
            const scheduledEventId =
                typeof note.scheduledEventId === 'string'
                    ? note.scheduledEventId
                    : note.scheduledEventId._id;

            global.io.emit(
                `addScheduledEventInternalNote-${scheduledEventId}`,
                note
            );
        } catch (error) {
            ErrorService.log(
                'realTimeService.addScheduledEventInternalNote',
                error
            );
            throw error;
        }
    },

    addScheduledEventInvestigationNote: async (note, projectId) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                _id: projectId,
            });
            projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : projectId;

            const scheduledEventId =
                typeof note.scheduledEventId === 'string'
                    ? note.scheduledEventId
                    : note.scheduledEventId._id;

            global.io.emit(
                `addScheduledEventInvestigationNote-${scheduledEventId}`,
                note
            );
            global.io.emit(`addEventNote-${projectId}`, note); // realtime update on status page
        } catch (error) {
            ErrorService.log(
                'realTimeService.addScheduledEventInvestigationNote',
                error
            );
            throw error;
        }
    },

    deleteScheduledEventInternalNote: async note => {
        try {
            if (!global || !global.io) {
                return;
            }
            const scheduledEventId =
                typeof note.scheduledEventId === 'string'
                    ? note.scheduledEventId
                    : note.scheduledEventId._id;

            global.io.emit(
                `deleteScheduledEventInternalNote-${scheduledEventId}`,
                note
            );
        } catch (error) {
            ErrorService.log(
                'realTimeService.deleteScheduledEventInternalNote',
                error
            );
            throw error;
        }
    },

    deleteScheduledEventInvestigationNote: async (note, projectId) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                _id: projectId,
            });
            projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : projectId;

            const scheduledEventId =
                typeof note.scheduledEventId === 'string'
                    ? note.scheduledEventId
                    : note.scheduledEventId._id;

            global.io.emit(
                `deleteScheduledEventInvestigationNote-${scheduledEventId}`,
                note
            );
            global.io.emit(`deleteEventNote-${projectId}`, note); // realtime update on status page
        } catch (error) {
            ErrorService.log(
                'realTimeService.deleteScheduledEventInvestigationNote',
                error
            );
            throw error;
        }
    },

    updateScheduledEventInternalNote: async note => {
        try {
            if (!global || !global.io) {
                return;
            }
            const scheduledEventId =
                typeof note.scheduledEventId === 'string'
                    ? note.scheduledEventId
                    : note.scheduledEventId._id;

            global.io.emit(
                `updateScheduledEventInternalNote-${scheduledEventId}`,
                note
            );
        } catch (error) {
            ErrorService.log(
                'realTimeService.updateScheduledEventInternalNote',
                error
            );
            throw error;
        }
    },

    updateScheduledEventInvestigationNote: async (note, projectId) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                _id: projectId,
            });
            projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : projectId;

            const scheduledEventId =
                typeof note.scheduledEventId === 'string'
                    ? note.scheduledEventId
                    : note.scheduledEventId._id;

            global.io.emit(
                `updateScheduledEventInvestigationNote-${scheduledEventId}`,
                note
            );
            global.io.emit(`updateEventNote-${projectId}`, note);
        } catch (error) {
            ErrorService.log(
                'realTimeService.updateScheduledEventInvestigationNote',
                error
            );
            throw error;
        }
    },

    sendComponentCreated: async component => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                _id: component.projectId._id,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : component.projectId._id;

            global.io.emit(`createComponent-${projectId}`, component);
        } catch (error) {
            ErrorService.log('realTimeService.sendComponentCreated', error);
            throw error;
        }
    },

    sendMonitorCreated: async monitor => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                _id: monitor.projectId._id,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : monitor.projectId._id;

            global.io.emit(`createMonitor-${projectId}`, monitor);
        } catch (error) {
            ErrorService.log('realTimeService.sendMonitorCreated', error);
            throw error;
        }
    },

    deleteMonitor: async monitor => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                _id: monitor.projectId._id,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : monitor.projectId._id;

            global.io.emit(`deleteMonitor-${projectId}`, monitor);
        } catch (error) {
            ErrorService.log('realTimeService.deleteMonitor', error);
            throw error;
        }
    },

    sendComponentDelete: async component => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                _id: component.projectId,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : component.projectId;

            global.io.emit(`deleteComponent-${projectId}`, component);
        } catch (error) {
            ErrorService.log('realTimeService.sendComponentDelete', error);
            throw error;
        }
    },

    sendMonitorDelete: async monitor => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                _id: monitor.projectId,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : monitor.projectId;

            global.io.emit(`deleteMonitor-${projectId}`, monitor);
        } catch (error) {
            ErrorService.log('realTimeService.sendMonitorDelete', error);
            throw error;
        }
    },

    incidentResolved: async incident => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                _id: incident.projectId,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : incident.projectId;

            global.io.emit(`incidentResolved-${projectId}`, incident);
        } catch (error) {
            ErrorService.log('realTimeService.incidentResolved', error);
            throw error;
        }
    },

    incidentAcknowledged: async incident => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                _id: incident.projectId,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : incident.projectId;

            global.io.emit(`incidentAcknowledged-${projectId}`, incident);
        } catch (error) {
            ErrorService.log('realTimeService.incidentAcknowledged', error);
            throw error;
        }
    },

    statusPageEdit: async statusPage => {
        try {
            const project = await ProjectService.findOneBy({
                _id: statusPage.projectId._id,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : statusPage.projectId._id;

            global.io.emit(`updateStatusPage-${projectId}`, statusPage);
        } catch (error) {
            ErrorService.log('realTimeService.statusPageEdit', error);
            throw error;
        }
    },

    componentEdit: async component => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                _id: component.projectId,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : component.projectId;

            global.io.emit(`updateComponent-${projectId}`, component);
        } catch (error) {
            ErrorService.log('realTimeService.componentEdit', error);
            throw error;
        }
    },

    monitorEdit: async monitor => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                _id: monitor.projectId,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : monitor.projectId;

            global.io.emit(`updateMonitor-${projectId}`, monitor);
        } catch (error) {
            ErrorService.log('realTimeService.monitorEdit', error);
            throw error;
        }
    },

    updateMonitorLog: async (data, projectId) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({ _id: projectId });
            const parentProjectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : projectId;

            global.io.emit(`updateMonitorLog-${parentProjectId}`, {
                projectId,
                monitorId: data.monitorId,
                data,
            });
        } catch (error) {
            ErrorService.log('realTimeService.updateMonitorLog', error);
            throw error;
        }
    },

    updateLighthouseLog: async (data, projectId) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({ _id: projectId });
            const parentProjectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : projectId;

            global.io.emit(`updateLighthouseLog-${parentProjectId}`, {
                projectId,
                monitorId: data.monitorId,
                data,
            });
        } catch (error) {
            ErrorService.log('realTimeService.updateLighthouseLog', error);
            throw error;
        }
    },

    updateAllLighthouseLog: async (projectId, data) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({ _id: projectId });
            const parentProjectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : projectId;

            global.io.emit(`updateAllLighthouseLog-${parentProjectId}`, {
                projectId,
                monitorId: data.monitorId,
                data,
            });
        } catch (error) {
            ErrorService.log('realTimeService.updateAllLighthouseLog', error);
            throw error;
        }
    },

    updateMonitorStatus: async (data, projectId) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({ _id: projectId });
            const parentProjectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : projectId;

            global.io.emit(`updateMonitorStatus-${parentProjectId}`, {
                projectId,
                monitorId: data.monitorId,
                data,
            });
        } catch (error) {
            ErrorService.log('realTimeService.updateMonitorStatus', error);
            throw error;
        }
    },

    updateProbe: async (data, monitorId) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const monitor = await MonitorService.findOneBy({ _id: monitorId });

            if (!monitor) {
                return;
            }

            const project = await ProjectService.findOneBy({
                _id: monitor.projectId,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : monitor.projectId;

            global.io.emit(`updateProbe-${projectId}`, data);
        } catch (error) {
            ErrorService.log('realTimeService.updateProbe', error);
            throw error;
        }
    },

    sendNotification: async data => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                _id: data.projectId,
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : data.projectId;

            global.io.emit(`NewNotification-${projectId}`, data);
        } catch (error) {
            ErrorService.log('realTimeService.sendNotification', error);
            throw error;
        }
    },

    updateTeamMemberRole: async (projectId, data) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({ _id: projectId });

            projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : projectId;
            global.io.emit(`TeamMemberRoleUpdate-${projectId}`, data);
        } catch (error) {
            ErrorService.log('realTimeService.updateTeamMemberRole', error);
            throw error;
        }
    },

    createTeamMember: async (projectId, data) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({ _id: projectId });

            projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : projectId;
            global.io.emit(`TeamMemberCreate-${projectId}`, data);
        } catch (error) {
            ErrorService.log('realTimeService.createTeamMember', error);
            throw error;
        }
    },

    deleteTeamMember: async (projectId, data) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({ _id: projectId });

            projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id
                    : project._id
                : projectId;
            global.io.emit(`TeamMemberDelete-${projectId}`, data);
        } catch (error) {
            ErrorService.log('realTimeService.deleteTeamMember', error);
            throw error;
        }
    },

    sendApplicationLogCreated: async applicationLog => {
        try {
            if (!global || !global.io) {
                return;
            }
            const componentId = applicationLog.componentId._id;

            global.io.emit(
                `createApplicationLog-${componentId}`,
                applicationLog
            );
        } catch (error) {
            ErrorService.log(
                'realTimeService.sendApplicationLogCreated',
                error
            );
            throw error;
        }
    },
    sendApplicationLogDelete: async applicationLog => {
        try {
            if (!global || !global.io) {
                return;
            }

            const componentId = applicationLog.componentId._id;

            global.io.emit(
                `deleteApplicationLog-${componentId}`,
                applicationLog
            );
        } catch (error) {
            ErrorService.log('realTimeService.sendApplicationLogDelete', error);
            throw error;
        }
    },
    sendLogCreated: async contentLog => {
        try {
            if (!global || !global.io) {
                return;
            }
            const applicationLogId = contentLog.applicationLogId._id;

            global.io.emit(`createLog-${applicationLogId}`, contentLog);
        } catch (error) {
            ErrorService.log('realTimeService.sendLogCreated', error);
            throw error;
        }
    },
    applicationLogKeyReset: async applicationLog => {
        try {
            if (!global || !global.io) {
                return;
            }

            const componentId = applicationLog.componentId._id;

            global.io.emit(
                `applicationLogKeyReset-${componentId}`,
                applicationLog
            );
        } catch (error) {
            ErrorService.log('realTimeService.applicationLogKeyReset', error);
            throw error;
        }
    },
    sendContainerSecurityCreated: async containerSecurity => {
        try {
            if (!global || !global.io) {
                return;
            }
            const componentId = containerSecurity.componentId;

            global.io.emit(
                `createContainerSecurity-${componentId}`,
                containerSecurity
            );
        } catch (error) {
            ErrorService.log(
                'realTimeService.sendContainerSecurityCreated',
                error
            );
            throw error;
        }
    },
    sendApplicationSecurityCreated: async applicationSecurity => {
        try {
            if (!global || !global.io) {
                return;
            }
            const componentId = applicationSecurity.componentId;

            global.io.emit(
                `createApplicationSecurity-${componentId}`,
                applicationSecurity
            );
        } catch (error) {
            ErrorService.log(
                'realTimeService.sendApplicationSecurityCreated',
                error
            );
            throw error;
        }
    },
    sendErrorTrackerCreated: async errorTracker => {
        try {
            if (!global || !global.io) {
                return;
            }
            const componentId = errorTracker.componentId._id;

            global.io.emit(`createErrorTracker-${componentId}`, errorTracker);
        } catch (error) {
            ErrorService.log('realTimeService.sendErrorTrackerCreated', error);
            throw error;
        }
    },
    sendErrorTrackerDelete: async errorTracker => {
        try {
            if (!global || !global.io) {
                return;
            }

            const componentId = errorTracker.componentId._id;

            global.io.emit(`deleteErrorTracker-${componentId}`, errorTracker);
        } catch (error) {
            ErrorService.log('realTimeService.sendErrorTrackerDelete', error);
            throw error;
        }
    },
    errorTrackerKeyReset: async errorTracker => {
        try {
            if (!global || !global.io) {
                return;
            }

            const componentId = errorTracker.componentId._id;

            global.io.emit(`errorTrackerKeyReset-${componentId}`, errorTracker);
        } catch (error) {
            ErrorService.log('realTimeService.errorTrackerKeyReset', error);
            throw error;
        }
    },
    sendErrorEventCreated: async data => {
        try {
            if (!global || !global.io) {
                return;
            }
            const errorTrackerId = data.errorEvent.errorTrackerId._id;

            global.io.emit(`createErrorEvent-${errorTrackerId}`, data);
        } catch (error) {
            ErrorService.log('realTimeService.sendErrorEventCreated', error);
            throw error;
        }
    },
    sendIssueStatusChange: async (issue, type) => {
        try {
            if (!global || !global.io) {
                return;
            }
            const errorTrackerId = issue.errorTrackerId._id;

            global.io.emit(`${type}Issue-${errorTrackerId}`, issue);
        } catch (error) {
            ErrorService.log('realTimeService.sendIssueStatusChange', error);
            throw error;
        }
    },
};

const ErrorService = require('./errorService');
const ProjectService = require('./projectService');
const MonitorService = require('./monitorService');
const IncidentService = require('./incidentService');
