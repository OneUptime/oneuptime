export default {
    sendCreatedIncident: ({ projectId, incident }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io.to(projectId).emit(`incidentCreated-${projectId}`, incident);
    },

    sendIncidentTimeline: ({ projectId, data }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io.to(projectId).emit(`incidentTimeline-${projectId}`, data);
    },

    sendSlaCountDown: ({ projectId, incident, countDown }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io.to(projectId).emit(`slaCountDown-${projectId}`, {
            incident,
            countDown,
        });
    },

    deleteIncident: ({ projectId, incident }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io.to(projectId).emit(`deleteIncident-${projectId}`, incident);
    },

    addIncidentNote: ({ projectId, incidentNote }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io
            .to(projectId)
            .emit(`addIncidentNote-${projectId}`, incidentNote);
    },

    updateIncidentNote: ({ projectId, incidentNote }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io
            .to(projectId)
            .emit(`updateIncidentNote-${projectId}`, incidentNote);
    },

    updateIncidentTimeline: ({ incidentTimeline, projectId }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io
            .to(projectId)
            .emit(`updateIncidentTimeline-${projectId}`, incidentTimeline);
    },

    updateIncident: ({ incident, projectId }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io.to(projectId).emit(`updateIncident-${projectId}`, incident);
    },

    deleteIncidentNote: ({ incidentNote, projectId }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io
            .to(projectId)
            .emit(`deleteIncidentNote-${projectId}`, incidentNote);
    },

    addScheduledEvent: ({ event, projectId }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io.to(projectId).emit(`addScheduledEvent-${projectId}`, event);
    },

    deleteScheduledEvent: ({ event, projectId }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io
            .to(projectId)
            .emit(`deleteScheduledEvent-${projectId}`, event);
    },

    updateScheduledEvent: ({ event, projectId }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io
            .to(projectId)
            .emit(`updateScheduledEvent-${projectId}`, event);
    },

    resolveScheduledEvent: ({ event, projectId }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io
            .to(projectId)
            .emit(`resolveScheduledEvent-${projectId}`, event);
    },

    addScheduledEventInternalNote: ({ note, scheduledEventId }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io
            .to(scheduledEventId)
            .emit(`addScheduledEventInternalNote-${scheduledEventId}`, note);
    },

    addScheduledEventInvestigationNote: ({
        note,
        projectId,
        scheduledEventId,
    }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io
            .to(scheduledEventId)
            .emit(
                `addScheduledEventInvestigationNote-${scheduledEventId}`,
                note
            );

        global.io.to(projectId).emit(`addEventNote-${projectId}`, note); // realtime update on status page
    },

    deleteScheduledEventInternalNote: ({
        note,
        scheduledEventId,
    }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io
            .to(scheduledEventId)
            .emit(`deleteScheduledEventInternalNote-${scheduledEventId}`, note);
    },

    deleteScheduledEventInvestigationNote: ({
        note,
        projectId,
        scheduledEventId,
    }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io
            .to(scheduledEventId)
            .emit(
                `deleteScheduledEventInvestigationNote-${scheduledEventId}`,
                note
            );

        global.io.to(projectId).emit(`deleteEventNote-${projectId}`, note); // realtime update on status page
    },

    updateScheduledEventInternalNote: ({
        note,
        scheduledEventId,
    }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io
            .to(scheduledEventId)
            .emit(`updateScheduledEventInternalNote-${scheduledEventId}`, note);
    },

    updateScheduledEventInvestigationNote: ({
        note,
        projectId,
        scheduledEventId,
    }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io
            .to(scheduledEventId)
            .emit(
                `updateScheduledEventInvestigationNote-${scheduledEventId}`,
                note
            );

        global.io.to(projectId).emit(`updateEventNote-${projectId}`, note);
    },

    sendComponentCreated: ({ component, projectId }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io.to(projectId).emit(`createComponent-${projectId}`, component);
    },

    sendMonitorCreated: ({ monitor, projectId }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io.to(projectId).emit(`createMonitor-${projectId}`, monitor);
    },

    sendComponentDelete: ({ component, projectId }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io.to(projectId).emit(`deleteComponent-${projectId}`, component);
    },

    sendMonitorDelete: ({ monitor, projectId }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io.to(projectId).emit(`deleteMonitor-${projectId}`, monitor);
    },

    incidentResolved: ({ incident, projectId }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io.to(projectId).emit(`incidentResolved-${projectId}`, incident);
    },

    incidentAcknowledged: ({ incident, projectId }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io
            .to(projectId)
            .emit(`incidentAcknowledged-${projectId}`, incident);
    },

    statusPageEdit: ({ statusPage, projectId }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io
            .to(projectId)
            .emit(`updateStatusPage-${projectId}`, statusPage);
    },

    componentEdit: ({ component, projectId }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io.to(projectId).emit(`updateComponent-${projectId}`, component);
    },

    monitorEdit: ({ monitor, projectId }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io.to(projectId).emit(`updateMonitor-${projectId}`, monitor);
    },

    updateMonitorLog: ({ data, logData, projectId, monitorId }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io.to(projectId).emit(`updateMonitorLog-${projectId}`, {
            projectId,
            monitorId,
            data,
            logData,
        });
    },

    updateLighthouseLog: ({ data, projectId, monitorId }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io.to(projectId).emit(`updateLighthouseLog-${projectId}`, {
            projectId,
            monitorId,
            data,
        });
    },

    updateAllLighthouseLog: ({ projectId, data, monitorId }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io.to(projectId).emit(`updateAllLighthouseLog-${projectId}`, {
            projectId,
            monitorId,
            data,
        });
    },

    updateMonitorStatus: ({ data, projectId, monitorId }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io.to(projectId).emit(`updateMonitorStatus-${projectId}`, {
            projectId,
            monitorId,
            data,
        });
    },

    updateTweets: ({ tweets, statusPageId, _projectId }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io.to(_projectId).emit(`updateTweets-${_projectId}`, {
            tweets,
            statusPageId,
        });
    },

    updateProbe: ({ data }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io.emit(`updateProbe`, data);
    },

    sendNotification: ({ data, projectId }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io.to(projectId).emit(`NewNotification-${projectId}`, data);
    },

    updateTeamMemberRole: ({ projectId, data }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io.to(projectId).emit(`TeamMemberRoleUpdate-${projectId}`, data);
    },

    createTeamMember: ({ projectId, data }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io.to(projectId).emit(`TeamMemberCreate-${projectId}`, data);
    },

    deleteTeamMember: ({ projectId, data }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io.to(projectId).emit(`TeamMemberDelete-${projectId}`, data);
    },

    sendApplicationLogCreated: ({ applicationLog, componentId }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io
            .to(componentId)
            .emit(`createApplicationLog-${componentId}`, applicationLog);
    },
    sendApplicationLogDelete: ({ applicationLog, componentId }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io
            .to(componentId)
            .emit(`deleteApplicationLog-${componentId}`, applicationLog);
    },
    sendLogCreated: ({ contentLog, applicationLogId }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io
            .to(applicationLogId)
            .emit(`createLog-${applicationLogId}`, contentLog);
    },
    applicationLogKeyReset: ({ applicationLog, componentId }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io
            .to(componentId)
            .emit(`applicationLogKeyReset-${componentId}`, applicationLog);
    },
    sendContainerSecurityCreated: ({
        containerSecurity,
        componentId,
    }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io
            .to(componentId)
            .emit(`createContainerSecurity-${componentId}`, containerSecurity);
    },
    sendApplicationSecurityCreated: ({
        applicationSecurity,
        componentId,
    }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io
            .to(componentId)
            .emit(
                `createApplicationSecurity-${componentId}`,
                applicationSecurity
            );
    },
    sendErrorTrackerCreated: ({ errorTracker, componentId }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io
            .to(componentId)
            .emit(`createErrorTracker-${componentId}`, errorTracker);
    },
    sendErrorTrackerDelete: ({ errorTracker, componentId }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io
            .to(componentId)
            .emit(`deleteErrorTracker-${componentId}`, errorTracker);
    },
    errorTrackerKeyReset: ({ errorTracker, componentId }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io
            .to(componentId)
            .emit(`errorTrackerKeyReset-${componentId}`, errorTracker);
    },
    sendErrorEventCreated: ({ data, errorTrackerId }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io
            .to(errorTrackerId)
            .emit(`createErrorEvent-${errorTrackerId}`, data);
    },
    sendIssueStatusChange: ({ issue, type, errorTrackerId }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io
            .to(errorTrackerId)
            .emit(`${type}Issue-${errorTrackerId}`, issue);
    },
    sendErrorTrackerIssueDelete: ({ issue, errorTrackerId }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io
            .to(errorTrackerId)
            .emit(`deleteErrorTrackerIssue-${errorTrackerId}`, issue);
    },
    sendTimeMetrics: ({ appId, data }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io.to(appId).emit(`timeMetrics-${appId}`, data);
    },
    sendThroughputMetrics: ({ appId, data }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io.to(appId).emit(`throughputMetrics-${appId}`, data);
    },
    sendErrorMetrics: ({ appId, data }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io.to(appId).emit(`errorMetrics-${appId}`, data);
    },
    handleScanning: ({ security }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io.to(security._id).emit(`security_${security._id}`, security);
    },
    handleLog: ({ securityId, securityLog }: $TSFixMe) => {
        if (!global || !global.io) {
            return;
        }

        global.io.to(securityId).emit(`securityLog_${securityId}`, securityLog);
    },
};
