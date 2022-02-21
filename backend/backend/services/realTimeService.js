module.exports = {
    sendCreatedIncident: async incident => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                query: { _id: incident.projectId._id || incident.projectId },
                select: 'parentProjectId _id',
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : incident.projectId._id || incident.projectId;

            postApi(`${realtimeBaseUrl}/send-created-incident`, {
                projectId,
                incident,
            });
        } catch (error) {
            ErrorService.log('realTimeService.sendCreatedIncident', error);
        }
    },

    sendIncidentTimeline: async timeline => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                query: { _id: timeline.projectId },
                select: 'parentProjectId _id',
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : timeline.projectId;
            const { idNumber, slug } = await IncidentService.findOneBy({
                query: { _id: timeline.incidentId },
                select: 'idNumber slug',
            });

            const data = {
                incidentId: idNumber,
                incidentMessages: timeline.data,
                count: timeline.data.length,
                type: 'internal',
                incidentSlug: slug,
            };

            postApi(`${realtimeBaseUrl}/send-incident-timeline`, {
                projectId,
                data,
            });
        } catch (error) {
            ErrorService.log('realTimeService.sendIncidentTimeline', error);
        }
    },

    sendSlaCountDown: async (incident, countDown) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                query: { _id: incident.projectId._id || incident.projectId },
                select: 'parentProjectId _id',
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : incident.projectId._id || incident.projectId;

            await postApi(`${realtimeBaseUrl}/send-sla-countdown`, {
                projectId,
                incident,
                countDown,
            });
        } catch (error) {
            ErrorService.log('realTimeService.sendSlaCountDown', error);
        }
    },

    deleteIncident: async incident => {
        try {
            if (!global || !global.io) {
                return;
            }
            const project = await ProjectService.findOneBy({
                query: { _id: incident.projectId._id || incident.projectId },
                select: 'parentProjectId _id',
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : incident.projectId._id || incident.projectId;

            postApi(`${realtimeBaseUrl}/delete-incident`, {
                projectId,
                incident,
            });
        } catch (error) {
            ErrorService.log('realTimeService.deleteIncident', error);
        }
    },

    addIncidentNote: async incidentNote => {
        try {
            if (!global || !global.io) {
                return;
            }
            const incident = await IncidentService.findOneBy({
                query: {
                    _id: incidentNote.incidentId._id || incidentNote.incidentId,
                },
                select: 'projectId _id',
            });
            const project = await ProjectService.findOneBy({
                query: { _id: incident.projectId._id || incident.projectId },
                select: 'parentProjectId _id',
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : incident.projectId._id || incident.projectId;

            postApi(`${realtimeBaseUrl}/add-incident-note`, {
                projectId,
                incidentNote,
            });
        } catch (error) {
            ErrorService.log('realTimeService.addIncidentNote', error);
        }
    },

    updateIncidentNote: async incidentNote => {
        try {
            if (!global || !global.io) {
                return;
            }
            const incident = await IncidentService.findOneBy({
                query: {
                    _id: incidentNote.incidentId._id || incidentNote.incidentId,
                },
                select: 'projectId',
            });
            const project = await ProjectService.findOneBy({
                query: { _id: incident.projectId._id || incident.projectId },
                select: 'parentProject _id',
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : incident.projectId._id || incident.projectId;

            postApi(`${realtimeBaseUrl}/update-incident-note`, {
                projectId,
                incidentNote,
            });
        } catch (error) {
            ErrorService.log('realTimeService.updateIncidentNote', error);
        }
    },

    updateIncidentTimeline: async incidentTimeline => {
        try {
            if (!global || !global.io) {
                return;
            }
            const project = await ProjectService.findOneBy({
                query: {
                    _id:
                        incidentTimeline.projectId._id ||
                        incidentTimeline.projectId,
                },
                select: 'parentProject _id',
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : incidentTimeline.projectId._id || incidentTimeline.projectId;

            postApi(`${realtimeBaseUrl}/update-incident-timeline`, {
                incidentTimeline,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.updateIncidentTimeline', error);
        }
    },

    updateIncident: async incident => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                query: { _id: incident.projectId._id || incident.projectId },
                select: 'parentProject _id',
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : incident.projectId._id || incident.projectId;

            postApi(`${realtimeBaseUrl}/update-incident`, {
                incident,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.updateIncident', error);
        }
    },

    deleteIncidentNote: async incidentNote => {
        try {
            if (!global || !global.io) {
                return;
            }
            const incident = await IncidentService.findOneBy({
                query: {
                    _id: incidentNote.incidentId._id || incidentNote.incidentId,
                },
                select: 'projectId',
            });
            const project = await ProjectService.findOneBy({
                query: { _id: incident.projectId._id || incident.projectId },
                select: 'parentProject _id',
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : incident.projectId._id || incident.projectId;

            postApi(`${realtimeBaseUrl}/delete-incident-note`, {
                incidentNote,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.deleteIncidentNote', error);
        }
    },

    addScheduledEvent: async event => {
        try {
            const project = await ProjectService.findOneBy({
                query: { _id: event.projectId._id || event.projectId },
                select: 'parentProject _id',
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : event.projectId._id || event.projectId;

            postApi(`${realtimeBaseUrl}/add-scheduled-event`, {
                event,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.addScheduledEvent', error);
        }
    },

    deleteScheduledEvent: async event => {
        try {
            const project = await ProjectService.findOneBy({
                query: { _id: event.projectId._id || event.projectId },
                select: 'parentProject _id',
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : event.projectId._id || event.projectId;

            postApi(`${realtimeBaseUrl}/delete-scheduled-event`, {
                event,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.deleteScheduledEvent', error);
        }
    },

    updateScheduledEvent: async event => {
        try {
            const project = await ProjectService.findOneBy({
                query: { _id: event.projectId._id || event.projectId },
                select: 'parentProject _id',
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : event.projectId._id || event.projectId;

            postApi(`${realtimeBaseUrl}/update-scheduled-event`, {
                event,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.updateScheduledEvent', error);
        }
    },

    resolveScheduledEvent: async event => {
        try {
            const project = await ProjectService.findOneBy({
                query: { _id: event.projectId._id || event.projectId },
                select: 'parentProject _id',
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : event.projectId._id || event.projectId;

            postApi(`${realtimeBaseUrl}/resolve-scheduled-event`, {
                event,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.resolveScheduledEvent', error);
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

            postApi(`${realtimeBaseUrl}/add-scheduled-event-internal-note`, {
                note,
                scheduledEventId,
            });
        } catch (error) {
            ErrorService.log(
                'realTimeService.addScheduledEventInternalNote',
                error
            );
        }
    },

    addScheduledEventInvestigationNote: async (note, projectId) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                query: { _id: projectId },
                select: 'parentProject _id',
            });
            projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : projectId;

            const scheduledEventId =
                typeof note.scheduledEventId === 'string'
                    ? note.scheduledEventId
                    : note.scheduledEventId._id;

            postApi(
                `${realtimeBaseUrl}/add-scheduled-event-investigation-note`,
                { note, scheduledEventId, projectId }
            );
        } catch (error) {
            ErrorService.log(
                'realTimeService.addScheduledEventInvestigationNote',
                error
            );
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

            postApi(`${realtimeBaseUrl}/delete-scheduled-event-internal-note`, {
                note,
                scheduledEventId,
            });
        } catch (error) {
            ErrorService.log(
                'realTimeService.deleteScheduledEventInternalNote',
                error
            );
        }
    },

    deleteScheduledEventInvestigationNote: async (note, projectId) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                query: { _id: projectId },
                select: 'parentProject _id',
            });
            projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : projectId;

            const scheduledEventId =
                typeof note.scheduledEventId === 'string'
                    ? note.scheduledEventId
                    : note.scheduledEventId._id;

            postApi(
                `${realtimeBaseUrl}/delete-scheduled-event-investigation-note`,
                { note, scheduledEventId, projectId }
            );
        } catch (error) {
            ErrorService.log(
                'realTimeService.deleteScheduledEventInvestigationNote',
                error
            );
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

            postApi(`${realtimeBaseUrl}/update-scheduled-event-internal-note`, {
                note,
                scheduledEventId,
            });
        } catch (error) {
            ErrorService.log(
                'realTimeService.updateScheduledEventInternalNote',
                error
            );
        }
    },

    updateScheduledEventInvestigationNote: async (note, projectId) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                query: { _id: projectId },
                select: 'parentProject _id',
            });
            projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : projectId;

            const scheduledEventId =
                typeof note.scheduledEventId === 'string'
                    ? note.scheduledEventId
                    : note.scheduledEventId._id;

            postApi(
                `${realtimeBaseUrl}/update-scheduled-event-investigation-note`,
                { note, scheduledEventId, projectId }
            );
        } catch (error) {
            ErrorService.log(
                'realTimeService.updateScheduledEventInvestigationNote',
                error
            );
        }
    },

    sendComponentCreated: async component => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                query: { _id: component.projectId._id || component.projectId },
                select: 'parentProject _id',
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : component.projectId._id || component.projectId;

            postApi(`${realtimeBaseUrl}/send-component-created`, {
                component,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.sendComponentCreated', error);
        }
    },

    sendMonitorCreated: async monitor => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                query: { _id: monitor.projectId._id || monitor.projectId },
                select: 'parentProject _id',
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : monitor.projectId._id || monitor.projectId;

            postApi(`${realtimeBaseUrl}/send-monitor-created`, {
                monitor,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.sendMonitorCreated', error);
        }
    },

    deleteMonitor: async monitor => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                query: { _id: monitor.projectId._id || monitor.projectId },
                select: 'parentProject _id',
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : monitor.projectId._id || monitor.projectId;

            postApi(`${realtimeBaseUrl}/send-monitor-delete`, {
                monitor,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.deleteMonitor', error);
        }
    },

    sendComponentDelete: async component => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                query: { _id: component.projectId._id || component.projectId },
                select: 'parentProject _id',
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : component.projectId._id || component.projectId;

            postApi(`${realtimeBaseUrl}/send-component-delete`, {
                component,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.sendComponentDelete', error);
        }
    },

    sendMonitorDelete: async monitor => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                query: { _id: monitor.projectId._id || monitor.projectId },
                select: 'parentProject _id',
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : monitor.projectId._id || monitor.projectId;

            postApi(`${realtimeBaseUrl}/send-monitor-delete`, {
                monitor,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.sendMonitorDelete', error);
        }
    },

    incidentResolved: async incident => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                query: { _id: incident.projectId._id || incident.projectId },
                select: 'parentProject _id',
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : incident.projectId._id || incident.projectId;

            postApi(`${realtimeBaseUrl}/incident-resolved`, {
                incident,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.incidentResolved', error);
        }
    },

    incidentAcknowledged: async incident => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                query: { _id: incident.projectId._id || incident.projectId },
                select: 'parentProject _id',
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : incident.projectId._id || incident.projectId;

            postApi(`${realtimeBaseUrl}/incident-acknowledged`, {
                incident,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.incidentAcknowledged', error);
        }
    },

    statusPageEdit: async statusPage => {
        try {
            const project = await ProjectService.findOneBy({
                query: {
                    _id: statusPage.projectId._id || statusPage.projectId,
                },
                select: 'parentProject _id',
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : statusPage.projectId._id || statusPage.projectId;

            postApi(`${realtimeBaseUrl}/status-page-edit`, {
                statusPage,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.statusPageEdit', error);
        }
    },

    componentEdit: async component => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                query: { _id: component.projectId._id || component.projectId },
                select: 'parentProject _id',
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : component.projectId._id || component.projectId;

            postApi(`${realtimeBaseUrl}/component-edit`, {
                component,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.componentEdit', error);
        }
    },

    monitorEdit: async monitor => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                query: { _id: monitor.projectId._id || monitor.projectId },
                select: 'parentProject _id',
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : monitor.projectId._id || monitor.projectId;

            postApi(`${realtimeBaseUrl}/monitor-edit`, {
                monitor,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.monitorEdit', error);
        }
    },

    updateMonitorLog: async (data, logData, projectId) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                query: { _id: projectId },
                select: 'parentProject _id',
            });
            const parentProjectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : projectId;

            postApi(`${realtimeBaseUrl}/update-monitor-log`, {
                data,
                logData,
                projectId,
                parentProjectId,
                monitorId: data.monitorId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.updateMonitorLog', error);
        }
    },

    updateLighthouseLog: async (data, projectId) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                query: { _id: projectId },
                select: 'parentProject _id',
            });
            const parentProjectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : projectId;

            postApi(`${realtimeBaseUrl}/update-lighthouse-log`, {
                projectId,
                monitorId: data.monitorId,
                data,
                parentProjectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.updateLighthouseLog', error);
        }
    },

    updateAllLighthouseLog: async (projectId, data) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                query: { _id: projectId },
                select: 'parentProject _id',
            });
            const parentProjectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : projectId;

            postApi(`${realtimeBaseUrl}/update-all-lighthouse-log`, {
                projectId,
                monitorId: data.monitorId,
                data,
                parentProjectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.updateAllLighthouseLog', error);
        }
    },

    updateMonitorStatus: async (data, projectId) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                query: { _id: projectId },
                select: 'parentProject _id',
            });
            const parentProjectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : projectId;

            postApi(`${realtimeBaseUrl}/update-monitor-status`, {
                projectId,
                monitorId: data.monitorId,
                data,
                parentProjectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.updateMonitorStatus', error);
        }
    },

    updateProbe: async (data, monitorId) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const monitor = await MonitorService.findOneBy({
                query: { _id: monitorId },
                select: 'projectId',
            });

            if (!monitor) {
                return;
            }

            const project = await ProjectService.findOneBy({
                query: { _id: monitor.projectId },
                select: 'parentProject _id',
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : monitor.projectId;

            postApi(`${realtimeBaseUrl}/update-probe`, { data, projectId });
        } catch (error) {
            ErrorService.log('realTimeService.updateProbe', error);
        }
    },

    sendNotification: async data => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                query: { _id: data.projectId._id || data.projectId },
                select: 'parentProjectId _id',
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : data.projectId._id || data.projectId;

            postApi(`${realtimeBaseUrl}/send-notification`, {
                data,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.sendNotification', error);
        }
    },

    updateTeamMemberRole: async (projectId, data) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                query: { _id: projectId },
                select: 'parentProject _id',
            });

            projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : projectId;

            postApi(`${realtimeBaseUrl}/update-team-member-role`, {
                projectId,
                data,
            });
        } catch (error) {
            ErrorService.log('realTimeService.updateTeamMemberRole', error);
        }
    },

    createTeamMember: async (projectId, data) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                query: { _id: projectId },
                select: 'parentProject _id',
            });

            projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : projectId;

            postApi(`${realtimeBaseUrl}/create-team-member`, {
                projectId,
                data,
            });
        } catch (error) {
            ErrorService.log('realTimeService.createTeamMember', error);
        }
    },

    deleteTeamMember: async (projectId, data) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const project = await ProjectService.findOneBy({
                query: { _id: projectId },
                select: 'parentProject _id',
            });

            projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : projectId;

            postApi(`${realtimeBaseUrl}/delete-team-member`, {
                projectId,
                data,
            });
        } catch (error) {
            ErrorService.log('realTimeService.deleteTeamMember', error);
        }
    },

    sendApplicationLogCreated: async applicationLog => {
        try {
            if (!global || !global.io) {
                return;
            }
            const componentId =
                applicationLog.componentId._id || applicationLog.componentId;

            postApi(`${realtimeBaseUrl}/send-application-log-created`, {
                applicationLog,
                componentId,
            });
        } catch (error) {
            ErrorService.log(
                'realTimeService.sendApplicationLogCreated',
                error
            );
        }
    },
    sendApplicationLogDelete: async applicationLog => {
        try {
            if (!global || !global.io) {
                return;
            }

            const componentId =
                applicationLog.componentId._id || applicationLog.componentId;

            postApi(`${realtimeBaseUrl}/send-application-log-delete`, {
                applicationLog,
                componentId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.sendApplicationLogDelete', error);
        }
    },
    sendLogCreated: async contentLog => {
        try {
            if (!global || !global.io) {
                return;
            }
            const applicationLogId =
                contentLog.applicationLogId._id || contentLog.applicationLogId;

            postApi(`${realtimeBaseUrl}/send-log-created`, {
                contentLog,
                applicationLogId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.sendLogCreated', error);
        }
    },
    applicationLogKeyReset: async applicationLog => {
        try {
            if (!global || !global.io) {
                return;
            }

            const componentId =
                applicationLog.componentId._id || applicationLog.componentId;

            postApi(`${realtimeBaseUrl}/application-log-key-reset`, {
                applicationLog,
                componentId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.applicationLogKeyReset', error);
        }
    },
    sendContainerSecurityCreated: async containerSecurity => {
        try {
            if (!global || !global.io) {
                return;
            }
            const componentId =
                containerSecurity.componentId._id ||
                containerSecurity.componentId;

            postApi(`${realtimeBaseUrl}/send-container-security-created`, {
                containerSecurity,
                componentId,
            });
        } catch (error) {
            ErrorService.log(
                'realTimeService.sendContainerSecurityCreated',
                error
            );
        }
    },
    sendApplicationSecurityCreated: async applicationSecurity => {
        try {
            if (!global || !global.io) {
                return;
            }
            const componentId =
                applicationSecurity.componentId._id ||
                applicationSecurity.componentId;

            postApi(`${realtimeBaseUrl}/send-application-security-created`, {
                applicationSecurity,
                componentId,
            });
        } catch (error) {
            ErrorService.log(
                'realTimeService.sendApplicationSecurityCreated',
                error
            );
        }
    },
    sendErrorTrackerCreated: async errorTracker => {
        try {
            if (!global || !global.io) {
                return;
            }
            const componentId =
                errorTracker.componentId._id || errorTracker.componentId;

            postApi(`${realtimeBaseUrl}/send-error-tracker-created`, {
                errorTracker,
                componentId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.sendErrorTrackerCreated', error);
        }
    },
    sendErrorTrackerDelete: async errorTracker => {
        try {
            if (!global || !global.io) {
                return;
            }

            const componentId =
                errorTracker.componentId._id || errorTracker.componentId;

            postApi(`${realtimeBaseUrl}/send-error-tracker-delete`, {
                errorTracker,
                componentId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.sendErrorTrackerDelete', error);
        }
    },
    errorTrackerKeyReset: async errorTracker => {
        try {
            if (!global || !global.io) {
                return;
            }

            const componentId =
                errorTracker.componentId._id || errorTracker.componentId;

            postApi(`${realtimeBaseUrl}/error-tracker-key-reset`, {
                errorTracker,
                componentId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.errorTrackerKeyReset', error);
        }
    },
    sendErrorEventCreated: async data => {
        try {
            if (!global || !global.io) {
                return;
            }
            const errorTrackerId =
                data.errorEvent.errorTrackerId._id ||
                data.errorEvent.errorTrackerId;

            postApi(`${realtimeBaseUrl}/send-error-event-created`, {
                data,
                errorTrackerId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.sendErrorEventCreated', error);
        }
    },
    sendIssueStatusChange: async (issue, type) => {
        try {
            if (!global || !global.io) {
                return;
            }
            const errorTrackerId =
                issue.errorTrackerId._id || issue.errorTrackerId;

            postApi(`${realtimeBaseUrl}/send-issue-status-change`, {
                issue,
                type,
                errorTrackerId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.sendIssueStatusChange', error);
        }
    },
    sendErrorTrackerIssueDelete: async issue => {
        try {
            if (!global || !global.io) {
                return;
            }

            const errorTrackerId =
                issue.errorTrackerId._id || issue.errorTrackerId;

            postApi(`${realtimeBaseUrl}/send-error-tracker-issue-delete`, {
                issue,
                errorTrackerId,
            });
        } catch (error) {
            ErrorService.log(
                'realTimeService.sendErrorTrackerIssueDelete',
                error
            );
        }
    },
    sendTimeMetrics: async (appId, data) => {
        try {
            if (!global || !global.io) {
                return;
            }

            postApi(`${realtimeBaseUrl}/send-time-metrics`, { appId, data });
        } catch (error) {
            ErrorService.log('realTimeService.sendTimeMetrics', error);
        }
    },
    sendThroughputMetrics: async (appId, data) => {
        try {
            if (!global || !global.io) {
                return;
            }

            postApi(`${realtimeBaseUrl}/send-throughput-metrics`, {
                appId,
                data,
            });
        } catch (error) {
            ErrorService.log('realTimeService.sendThroughputMetrics', error);
        }
    },
    sendErrorMetrics: async (appId, data) => {
        try {
            if (!global || !global.io) {
                return;
            }

            postApi(`${realtimeBaseUrl}/send-error-metrics`, { appId, data });
        } catch (error) {
            ErrorService.log('realTimeService.sendErrorMetrics', error);
        }
    },
    handleScanning: ({ security }) => {
        try {
            if (!global || !global.io) {
                return;
            }

            postApi(`${realtimeBaseUrl}/handle-scanning`, {
                security,
            });
        } catch (error) {
            ErrorService.log('realTimeService.handleScanning', error);
        }
    },
    handleLog: ({ securityId, securityLog }) => {
        try {
            if (!global || !global.io) {
                return;
            }

            postApi(`${realtimeBaseUrl}/handle-log`, {
                securityId,
                securityLog,
            });
        } catch (error) {
            ErrorService.log('realTimeService.handleLog', error);
        }
    },

    updateTweets: async (tweets, statusPageId, projectId) => {
        try {
            const project = await ProjectService.findOneBy({
                query: {
                    _id: projectId._id || projectId,
                },
                select: 'parentProject _id',
            });
            const _projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : projectId._id || projectId;

            postApi(`${realtimeBaseUrl}/status-page-update-tweets`, {
                tweets,
                statusPageId,
                _projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.statusPageEdit', error);
        }
    },
};

const ErrorService = require('../../../common-server/utils/error');
const ProjectService = require('./projectService');
const MonitorService = require('./monitorService');
const IncidentService = require('./incidentService');
const { postApi } = require('../utils/api');
const { REALTIME_URL } = require('../config/realtime');
const realtimeBaseUrl = `${REALTIME_URL}/realtime`;
