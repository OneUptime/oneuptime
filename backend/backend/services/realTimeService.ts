import ProjectService from './projectService';
import MonitorService from './monitorService';
import IncidentService from './incidentService';

import BackendAPI from '../utils/api';

import { REALTIME_URL } from '../config/realtime';
const realtimeBaseUrl = `${REALTIME_URL}/realtime`;

export default {
    sendCreatedIncident: async (incident: $TSFixMe) => {
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
    },

    sendIncidentTimeline: async (timeline: $TSFixMe) => {
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
    },

    sendSlaCountDown: async (incident: $TSFixMe, countDown: $TSFixMe) => {
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
    },

    deleteIncident: async (incident: $TSFixMe) => {
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
    },

    addIncidentNote: async (incidentNote: $TSFixMe) => {
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
    },

    updateIncidentNote: async (incidentNote: $TSFixMe) => {
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
    },

    updateIncidentTimeline: async (incidentTimeline: $TSFixMe) => {
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
    },

    updateIncident: async (incident: $TSFixMe) => {
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
    },

    deleteIncidentNote: async (incidentNote: $TSFixMe) => {
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
    },

    addScheduledEvent: async (event: $TSFixMe) => {
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
    },

    deleteScheduledEvent: async (event: $TSFixMe) => {
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
    },

    updateScheduledEvent: async (event: $TSFixMe) => {
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
    },

    resolveScheduledEvent: async (event: $TSFixMe) => {
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
    },

    addScheduledEventInternalNote: async (note: $TSFixMe) => {
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
    },

    addScheduledEventInvestigationNote: async (
        note: $TSFixMe,
        projectId: $TSFixMe
    ) => {
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
    },

    deleteScheduledEventInternalNote: async (note: $TSFixMe) => {
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
    },

    deleteScheduledEventInvestigationNote: async (
        note: $TSFixMe,
        projectId: $TSFixMe
    ) => {
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
    },

    updateScheduledEventInternalNote: async (note: $TSFixMe) => {
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
    },

    updateScheduledEventInvestigationNote: async (
        note: $TSFixMe,
        projectId: $TSFixMe
    ) => {
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
    },

    sendComponentCreated: async (component: $TSFixMe) => {
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
    },

    sendMonitorCreated: async (monitor: $TSFixMe) => {
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
    },

    deleteMonitor: async (monitor: $TSFixMe) => {
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
    },

    sendComponentDelete: async (component: $TSFixMe) => {
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
    },

    sendMonitorDelete: async (monitor: $TSFixMe) => {
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
    },

    incidentResolved: async (incident: $TSFixMe) => {
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
    },

    incidentAcknowledged: async (incident: $TSFixMe) => {
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
    },

    statusPageEdit: async (statusPage: $TSFixMe) => {
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
    },

    componentEdit: async (component: $TSFixMe) => {
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
    },

    monitorEdit: async (monitor: $TSFixMe) => {
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
    },

    updateMonitorLog: async (
        data: $TSFixMe,
        logData: $TSFixMe,
        projectId: $TSFixMe
    ) => {
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
    },

    updateLighthouseLog: async (data: $TSFixMe, projectId: $TSFixMe) => {
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
    },

    updateAllLighthouseLog: async (projectId: $TSFixMe, data: $TSFixMe) => {
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
    },

    updateMonitorStatus: async (data: $TSFixMe, projectId: $TSFixMe) => {
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
    },

    updateProbe: async (data: $TSFixMe, monitorId: $TSFixMe) => {
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
    },

    sendNotification: async (data: $TSFixMe) => {
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
    },

    updateTeamMemberRole: async (projectId: $TSFixMe, data: $TSFixMe) => {
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
    },

    createTeamMember: async (projectId: $TSFixMe, data: $TSFixMe) => {
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
    },

    deleteTeamMember: async (projectId: $TSFixMe, data: $TSFixMe) => {
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
    },

    sendApplicationLogCreated: async (applicationLog: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }
        const componentId =
            applicationLog.componentId._id || applicationLog.componentId;

        BackendAPI.post(`${realtimeBaseUrl}/send-application-log-created`, {
            applicationLog,
            componentId,
        });
    },
    sendApplicationLogDelete: async (applicationLog: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        const componentId =
            applicationLog.componentId._id || applicationLog.componentId;

        BackendAPI.post(`${realtimeBaseUrl}/send-application-log-delete`, {
            applicationLog,
            componentId,
        });
    },
    sendLogCreated: async (contentLog: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }
        const applicationLogId =
            contentLog.applicationLogId._id || contentLog.applicationLogId;

        BackendAPI.post(`${realtimeBaseUrl}/send-log-created`, {
            contentLog,
            applicationLogId,
        });
    },
    applicationLogKeyReset: async (applicationLog: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        const componentId =
            applicationLog.componentId._id || applicationLog.componentId;

        BackendAPI.post(`${realtimeBaseUrl}/application-log-key-reset`, {
            applicationLog,
            componentId,
        });
    },
    sendContainerSecurityCreated: async (containerSecurity: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }
        const componentId =
            containerSecurity.componentId._id || containerSecurity.componentId;

        BackendAPI.post(`${realtimeBaseUrl}/send-container-security-created`, {
            containerSecurity,
            componentId,
        });
    },
    sendApplicationSecurityCreated: async (applicationSecurity: $TSFixMe) => {
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
    },
    sendErrorTrackerCreated: async (errorTracker: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }
        const componentId =
            errorTracker.componentId._id || errorTracker.componentId;

        BackendAPI.post(`${realtimeBaseUrl}/send-error-tracker-created`, {
            errorTracker,
            componentId,
        });
    },
    sendErrorTrackerDelete: async (errorTracker: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        const componentId =
            errorTracker.componentId._id || errorTracker.componentId;

        BackendAPI.post(`${realtimeBaseUrl}/send-error-tracker-delete`, {
            errorTracker,
            componentId,
        });
    },
    errorTrackerKeyReset: async (errorTracker: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        const componentId =
            errorTracker.componentId._id || errorTracker.componentId;

        BackendAPI.post(`${realtimeBaseUrl}/error-tracker-key-reset`, {
            errorTracker,
            componentId,
        });
    },
    sendErrorEventCreated: async (data: $TSFixMe) => {
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
    },
    sendIssueStatusChange: async (issue: $TSFixMe, type: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }
        const errorTrackerId = issue.errorTrackerId._id || issue.errorTrackerId;

        BackendAPI.post(`${realtimeBaseUrl}/send-issue-status-change`, {
            issue,
            type,
            errorTrackerId,
        });
    },
    sendErrorTrackerIssueDelete: async (issue: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        const errorTrackerId = issue.errorTrackerId._id || issue.errorTrackerId;

        BackendAPI.post(`${realtimeBaseUrl}/send-error-tracker-issue-delete`, {
            issue,
            errorTrackerId,
        });
    },
    sendTimeMetrics: async (appId: $TSFixMe, data: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        BackendAPI.post(`${realtimeBaseUrl}/send-time-metrics`, {
            appId,
            data,
        });
    },
    sendThroughputMetrics: async (appId: $TSFixMe, data: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        BackendAPI.post(`${realtimeBaseUrl}/send-throughput-metrics`, {
            appId,
            data,
        });
    },
    sendErrorMetrics: async (appId: $TSFixMe, data: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        BackendAPI.post(`${realtimeBaseUrl}/send-error-metrics`, {
            appId,
            data,
        });
    },
    handleScanning: ({ security }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        BackendAPI.post(`${realtimeBaseUrl}/handle-scanning`, {
            security,
        });
    },
    handleLog: ({ securityId, securityLog }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        BackendAPI.post(`${realtimeBaseUrl}/handle-log`, {
            securityId,
            securityLog,
        });
    },

    updateTweets: async (
        tweets: $TSFixMe,
        statusPageId: $TSFixMe,
        projectId: $TSFixMe
    ) => {
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
    },
};
