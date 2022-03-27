export default {
    sendCreatedIncident: async (incident: $TSFixMe) => {
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

            BackendAPI.post(`${realtimeBaseUrl}/send-created-incident`, {
                projectId,
                incident,
            });
        } catch (error) {
            ErrorService.log('realTimeService.sendCreatedIncident', error);
        }
    },

    sendIncidentTimeline: async (timeline: $TSFixMe) => {
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

            BackendAPI.post(`${realtimeBaseUrl}/send-incident-timeline`, {
                projectId,
                data,
            });
        } catch (error) {
            ErrorService.log('realTimeService.sendIncidentTimeline', error);
        }
    },

    sendSlaCountDown: async (incident: $TSFixMe, countDown: $TSFixMe) => {
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

            await BackendAPI.BackendAPI.post(
                `${realtimeBaseUrl}/send-sla-countdown`,
                {
                    projectId,
                    incident,
                    countDown,
                }
            );
        } catch (error) {
            ErrorService.log('realTimeService.sendSlaCountDown', error);
        }
    },

    deleteIncident: async (incident: $TSFixMe) => {
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

            BackendAPI.post(`${realtimeBaseUrl}/delete-incident`, {
                projectId,
                incident,
            });
        } catch (error) {
            ErrorService.log('realTimeService.deleteIncident', error);
        }
    },

    addIncidentNote: async (incidentNote: $TSFixMe) => {
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

            BackendAPI.post(`${realtimeBaseUrl}/add-incident-note`, {
                projectId,
                incidentNote,
            });
        } catch (error) {
            ErrorService.log('realTimeService.addIncidentNote', error);
        }
    },

    updateIncidentNote: async (incidentNote: $TSFixMe) => {
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

            BackendAPI.post(`${realtimeBaseUrl}/update-incident-note`, {
                projectId,
                incidentNote,
            });
        } catch (error) {
            ErrorService.log('realTimeService.updateIncidentNote', error);
        }
    },

    updateIncidentTimeline: async (incidentTimeline: $TSFixMe) => {
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

            BackendAPI.post(`${realtimeBaseUrl}/update-incident-timeline`, {
                incidentTimeline,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.updateIncidentTimeline', error);
        }
    },

    updateIncident: async (incident: $TSFixMe) => {
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

            BackendAPI.post(`${realtimeBaseUrl}/update-incident`, {
                incident,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.updateIncident', error);
        }
    },

    deleteIncidentNote: async (incidentNote: $TSFixMe) => {
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

            BackendAPI.post(`${realtimeBaseUrl}/delete-incident-note`, {
                incidentNote,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.deleteIncidentNote', error);
        }
    },

    addScheduledEvent: async (event: $TSFixMe) => {
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

            BackendAPI.post(`${realtimeBaseUrl}/add-scheduled-event`, {
                event,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.addScheduledEvent', error);
        }
    },

    deleteScheduledEvent: async (event: $TSFixMe) => {
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

            BackendAPI.post(`${realtimeBaseUrl}/delete-scheduled-event`, {
                event,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.deleteScheduledEvent', error);
        }
    },

    updateScheduledEvent: async (event: $TSFixMe) => {
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

            BackendAPI.post(`${realtimeBaseUrl}/update-scheduled-event`, {
                event,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.updateScheduledEvent', error);
        }
    },

    resolveScheduledEvent: async (event: $TSFixMe) => {
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

            BackendAPI.post(`${realtimeBaseUrl}/resolve-scheduled-event`, {
                event,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.resolveScheduledEvent', error);
        }
    },

    addScheduledEventInternalNote: async (note: $TSFixMe) => {
        try {
            if (!global || !global.io) {
                return;
            }
            const scheduledEventId =
                typeof note.scheduledEventId === 'string'
                    ? note.scheduledEventId
                    : note.scheduledEventId._id;

            BackendAPI.post(
                `${realtimeBaseUrl}/add-scheduled-event-internal-note`,
                {
                    note,
                    scheduledEventId,
                }
            );
        } catch (error) {
            ErrorService.log(
                'realTimeService.addScheduledEventInternalNote',
                error
            );
        }
    },

    addScheduledEventInvestigationNote: async (
        note: $TSFixMe,
        projectId: $TSFixMe
    ) => {
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

            BackendAPI.post(
                `${realtimeBaseUrl}/add-scheduled-event-investigation-note`,
                {
                    note,
                    scheduledEventId,
                    projectId,
                }
            );
        } catch (error) {
            ErrorService.log(
                'realTimeService.addScheduledEventInvestigationNote',
                error
            );
        }
    },

    deleteScheduledEventInternalNote: async (note: $TSFixMe) => {
        try {
            if (!global || !global.io) {
                return;
            }
            const scheduledEventId =
                typeof note.scheduledEventId === 'string'
                    ? note.scheduledEventId
                    : note.scheduledEventId._id;

            BackendAPI.post(
                `${realtimeBaseUrl}/delete-scheduled-event-internal-note`,
                {
                    note,
                    scheduledEventId,
                }
            );
        } catch (error) {
            ErrorService.log(
                'realTimeService.deleteScheduledEventInternalNote',
                error
            );
        }
    },

    deleteScheduledEventInvestigationNote: async (
        note: $TSFixMe,
        projectId: $TSFixMe
    ) => {
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

            BackendAPI.post(
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

    updateScheduledEventInternalNote: async (note: $TSFixMe) => {
        try {
            if (!global || !global.io) {
                return;
            }
            const scheduledEventId =
                typeof note.scheduledEventId === 'string'
                    ? note.scheduledEventId
                    : note.scheduledEventId._id;

            BackendAPI.post(
                `${realtimeBaseUrl}/update-scheduled-event-internal-note`,
                {
                    note,
                    scheduledEventId,
                }
            );
        } catch (error) {
            ErrorService.log(
                'realTimeService.updateScheduledEventInternalNote',
                error
            );
        }
    },

    updateScheduledEventInvestigationNote: async (
        note: $TSFixMe,
        projectId: $TSFixMe
    ) => {
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

            BackendAPI.post(
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

    sendComponentCreated: async (component: $TSFixMe) => {
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

            BackendAPI.post(`${realtimeBaseUrl}/send-component-created`, {
                component,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.sendComponentCreated', error);
        }
    },

    sendMonitorCreated: async (monitor: $TSFixMe) => {
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

            BackendAPI.post(`${realtimeBaseUrl}/send-monitor-created`, {
                monitor,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.sendMonitorCreated', error);
        }
    },

    deleteMonitor: async (monitor: $TSFixMe) => {
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

            BackendAPI.post(`${realtimeBaseUrl}/send-monitor-delete`, {
                monitor,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.deleteMonitor', error);
        }
    },

    sendComponentDelete: async (component: $TSFixMe) => {
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

            BackendAPI.post(`${realtimeBaseUrl}/send-component-delete`, {
                component,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.sendComponentDelete', error);
        }
    },

    sendMonitorDelete: async (monitor: $TSFixMe) => {
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

            BackendAPI.post(`${realtimeBaseUrl}/send-monitor-delete`, {
                monitor,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.sendMonitorDelete', error);
        }
    },

    incidentResolved: async (incident: $TSFixMe) => {
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

            BackendAPI.post(`${realtimeBaseUrl}/incident-resolved`, {
                incident,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.incidentResolved', error);
        }
    },

    incidentAcknowledged: async (incident: $TSFixMe) => {
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

            BackendAPI.post(`${realtimeBaseUrl}/incident-acknowledged`, {
                incident,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.incidentAcknowledged', error);
        }
    },

    statusPageEdit: async (statusPage: $TSFixMe) => {
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

            BackendAPI.post(`${realtimeBaseUrl}/status-page-edit`, {
                statusPage,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.statusPageEdit', error);
        }
    },

    componentEdit: async (component: $TSFixMe) => {
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

            BackendAPI.post(`${realtimeBaseUrl}/component-edit`, {
                component,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.componentEdit', error);
        }
    },

    monitorEdit: async (monitor: $TSFixMe) => {
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

            BackendAPI.post(`${realtimeBaseUrl}/monitor-edit`, {
                monitor,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.monitorEdit', error);
        }
    },

    updateMonitorLog: async (
        data: $TSFixMe,
        logData: $TSFixMe,
        projectId: $TSFixMe
    ) => {
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

            BackendAPI.post(`${realtimeBaseUrl}/update-monitor-log`, {
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

    updateLighthouseLog: async (data: $TSFixMe, projectId: $TSFixMe) => {
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

            BackendAPI.post(`${realtimeBaseUrl}/update-lighthouse-log`, {
                projectId,
                monitorId: data.monitorId,
                data,
                parentProjectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.updateLighthouseLog', error);
        }
    },

    updateAllLighthouseLog: async (projectId: $TSFixMe, data: $TSFixMe) => {
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

            BackendAPI.post(`${realtimeBaseUrl}/update-all-lighthouse-log`, {
                projectId,
                monitorId: data.monitorId,
                data,
                parentProjectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.updateAllLighthouseLog', error);
        }
    },

    updateMonitorStatus: async (data: $TSFixMe, projectId: $TSFixMe) => {
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

            BackendAPI.post(`${realtimeBaseUrl}/update-monitor-status`, {
                projectId,
                monitorId: data.monitorId,
                data,
                parentProjectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.updateMonitorStatus', error);
        }
    },

    updateProbe: async (data: $TSFixMe, monitorId: $TSFixMe) => {
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

            BackendAPI.post(`${realtimeBaseUrl}/update-probe`, {
                data,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.updateProbe', error);
        }
    },

    sendNotification: async (data: $TSFixMe) => {
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

            BackendAPI.post(`${realtimeBaseUrl}/send-notification`, {
                data,
                projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.sendNotification', error);
        }
    },

    updateTeamMemberRole: async (projectId: $TSFixMe, data: $TSFixMe) => {
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

            BackendAPI.post(`${realtimeBaseUrl}/update-team-member-role`, {
                projectId,
                data,
            });
        } catch (error) {
            ErrorService.log('realTimeService.updateTeamMemberRole', error);
        }
    },

    createTeamMember: async (projectId: $TSFixMe, data: $TSFixMe) => {
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

            BackendAPI.post(`${realtimeBaseUrl}/create-team-member`, {
                projectId,
                data,
            });
        } catch (error) {
            ErrorService.log('realTimeService.createTeamMember', error);
        }
    },

    deleteTeamMember: async (projectId: $TSFixMe, data: $TSFixMe) => {
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

            BackendAPI.post(`${realtimeBaseUrl}/delete-team-member`, {
                projectId,
                data,
            });
        } catch (error) {
            ErrorService.log('realTimeService.deleteTeamMember', error);
        }
    },

    sendApplicationLogCreated: async (applicationLog: $TSFixMe) => {
        try {
            if (!global || !global.io) {
                return;
            }
            const componentId =
                applicationLog.componentId._id || applicationLog.componentId;

            BackendAPI.post(`${realtimeBaseUrl}/send-application-log-created`, {
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
    sendApplicationLogDelete: async (applicationLog: $TSFixMe) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const componentId =
                applicationLog.componentId._id || applicationLog.componentId;

            BackendAPI.post(`${realtimeBaseUrl}/send-application-log-delete`, {
                applicationLog,
                componentId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.sendApplicationLogDelete', error);
        }
    },
    sendLogCreated: async (contentLog: $TSFixMe) => {
        try {
            if (!global || !global.io) {
                return;
            }
            const applicationLogId =
                contentLog.applicationLogId._id || contentLog.applicationLogId;

            BackendAPI.post(`${realtimeBaseUrl}/send-log-created`, {
                contentLog,
                applicationLogId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.sendLogCreated', error);
        }
    },
    applicationLogKeyReset: async (applicationLog: $TSFixMe) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const componentId =
                applicationLog.componentId._id || applicationLog.componentId;

            BackendAPI.post(`${realtimeBaseUrl}/application-log-key-reset`, {
                applicationLog,
                componentId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.applicationLogKeyReset', error);
        }
    },
    sendContainerSecurityCreated: async (containerSecurity: $TSFixMe) => {
        try {
            if (!global || !global.io) {
                return;
            }
            const componentId =
                containerSecurity.componentId._id ||
                containerSecurity.componentId;

            BackendAPI.post(
                `${realtimeBaseUrl}/send-container-security-created`,
                {
                    containerSecurity,
                    componentId,
                }
            );
        } catch (error) {
            ErrorService.log(
                'realTimeService.sendContainerSecurityCreated',
                error
            );
        }
    },
    sendApplicationSecurityCreated: async (applicationSecurity: $TSFixMe) => {
        try {
            if (!global || !global.io) {
                return;
            }
            const componentId =
                applicationSecurity.componentId._id ||
                applicationSecurity.componentId;

            BackendAPI.post(
                `${realtimeBaseUrl}/send-application-security-created`,
                {
                    applicationSecurity,
                    componentId,
                }
            );
        } catch (error) {
            ErrorService.log(
                'realTimeService.sendApplicationSecurityCreated',
                error
            );
        }
    },
    sendErrorTrackerCreated: async (errorTracker: $TSFixMe) => {
        try {
            if (!global || !global.io) {
                return;
            }
            const componentId =
                errorTracker.componentId._id || errorTracker.componentId;

            BackendAPI.post(`${realtimeBaseUrl}/send-error-tracker-created`, {
                errorTracker,
                componentId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.sendErrorTrackerCreated', error);
        }
    },
    sendErrorTrackerDelete: async (errorTracker: $TSFixMe) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const componentId =
                errorTracker.componentId._id || errorTracker.componentId;

            BackendAPI.post(`${realtimeBaseUrl}/send-error-tracker-delete`, {
                errorTracker,
                componentId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.sendErrorTrackerDelete', error);
        }
    },
    errorTrackerKeyReset: async (errorTracker: $TSFixMe) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const componentId =
                errorTracker.componentId._id || errorTracker.componentId;

            BackendAPI.post(`${realtimeBaseUrl}/error-tracker-key-reset`, {
                errorTracker,
                componentId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.errorTrackerKeyReset', error);
        }
    },
    sendErrorEventCreated: async (data: $TSFixMe) => {
        try {
            if (!global || !global.io) {
                return;
            }
            const errorTrackerId =
                data.errorEvent.errorTrackerId._id ||
                data.errorEvent.errorTrackerId;

            BackendAPI.post(`${realtimeBaseUrl}/send-error-event-created`, {
                data,
                errorTrackerId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.sendErrorEventCreated', error);
        }
    },
    sendIssueStatusChange: async (issue: $TSFixMe, type: $TSFixMe) => {
        try {
            if (!global || !global.io) {
                return;
            }
            const errorTrackerId =
                issue.errorTrackerId._id || issue.errorTrackerId;

            BackendAPI.post(`${realtimeBaseUrl}/send-issue-status-change`, {
                issue,
                type,
                errorTrackerId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.sendIssueStatusChange', error);
        }
    },
    sendErrorTrackerIssueDelete: async (issue: $TSFixMe) => {
        try {
            if (!global || !global.io) {
                return;
            }

            const errorTrackerId =
                issue.errorTrackerId._id || issue.errorTrackerId;

            BackendAPI.post(
                `${realtimeBaseUrl}/send-error-tracker-issue-delete`,
                {
                    issue,
                    errorTrackerId,
                }
            );
        } catch (error) {
            ErrorService.log(
                'realTimeService.sendErrorTrackerIssueDelete',
                error
            );
        }
    },
    sendTimeMetrics: async (appId: $TSFixMe, data: $TSFixMe) => {
        try {
            if (!global || !global.io) {
                return;
            }

            BackendAPI.post(`${realtimeBaseUrl}/send-time-metrics`, {
                appId,
                data,
            });
        } catch (error) {
            ErrorService.log('realTimeService.sendTimeMetrics', error);
        }
    },
    sendThroughputMetrics: async (appId: $TSFixMe, data: $TSFixMe) => {
        try {
            if (!global || !global.io) {
                return;
            }

            BackendAPI.post(`${realtimeBaseUrl}/send-throughput-metrics`, {
                appId,
                data,
            });
        } catch (error) {
            ErrorService.log('realTimeService.sendThroughputMetrics', error);
        }
    },
    sendErrorMetrics: async (appId: $TSFixMe, data: $TSFixMe) => {
        try {
            if (!global || !global.io) {
                return;
            }

            BackendAPI.post(`${realtimeBaseUrl}/send-error-metrics`, {
                appId,
                data,
            });
        } catch (error) {
            ErrorService.log('realTimeService.sendErrorMetrics', error);
        }
    },
    handleScanning: ({ security }: $TSFixMe) => {
        try {
            if (!global || !global.io) {
                return;
            }

            BackendAPI.post(`${realtimeBaseUrl}/handle-scanning`, {
                security,
            });
        } catch (error) {
            ErrorService.log('realTimeService.handleScanning', error);
        }
    },
    handleLog: ({ securityId, securityLog }: $TSFixMe) => {
        try {
            if (!global || !global.io) {
                return;
            }

            BackendAPI.post(`${realtimeBaseUrl}/handle-log`, {
                securityId,
                securityLog,
            });
        } catch (error) {
            ErrorService.log('realTimeService.handleLog', error);
        }
    },

    updateTweets: async (
        tweets: $TSFixMe,
        statusPageId: $TSFixMe,
        projectId: $TSFixMe
    ) => {
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

            BackendAPI.post(`${realtimeBaseUrl}/status-page-update-tweets`, {
                tweets,
                statusPageId,
                _projectId,
            });
        } catch (error) {
            ErrorService.log('realTimeService.statusPageEdit', error);
        }
    },
};

import ErrorService from 'common-server/utils/error';
import ProjectService from './projectService';
import MonitorService from './monitorService';
import IncidentService from './incidentService';

import BackendAPI from '../utils/api';

import { REALTIME_URL } from '../config/realtime';
const realtimeBaseUrl = `${REALTIME_URL}/realtime`;
