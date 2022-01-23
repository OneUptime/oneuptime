const express = require('express');
const router = express.Router();
const {
    sendErrorResponse,
    sendEmptyResponse,
} = require('../middlewares/response');
const { isAuthorizedService } = require('../middlewares/serviceAuthorization');
const RealtimeService = require('../services/realtimeService');

router.post('/send-created-incident', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { projectId, incident } = req.body;

        RealtimeService.sendCreatedIncident({ projectId, incident });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/send-incident-timeline', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { projectId, data } = req.body;

        RealtimeService.sendIncidentTimeline({ projectId, data });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/send-sla-countdown', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { projectId, incident, countDown } = req.body;

        RealtimeService.sendSlaCountDown({
            projectId,
            incident,
            countDown,
        });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/delete-incident', isAuthorizedService, async function(req, res) {
    try {
        const { projectId, incident } = req.body;

        RealtimeService.deleteIncident({ projectId, incident });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/add-incident-note', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { projectId, incidentNote } = req.body;

        RealtimeService.addIncidentNote({ projectId, incidentNote });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/update-incident-note', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { projectId, incidentNote } = req.body;

        RealtimeService.updateIncidentNote({ projectId, incidentNote });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/update-incident-timeline', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { incidentTimeline, projectId } = req.body;

        RealtimeService.updateIncidentTimeline({ incidentTimeline, projectId });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/update-incident', isAuthorizedService, async function(req, res) {
    try {
        const { incident, projectId } = req.body;

        RealtimeService.updateIncident({ incident, projectId });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/delete-incident-note', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { incidentNote, projectId } = req.body;

        RealtimeService.deleteIncidentNote({ incidentNote, projectId });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/add-scheduled-event', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { event, projectId } = req.body;

        RealtimeService.addScheduledEvent({ event, projectId });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/delete-scheduled-event', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { event, projectId } = req.body;

        RealtimeService.deleteScheduledEvent({ event, projectId });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/update-scheduled-event', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { event, projectId } = req.body;

        RealtimeService.updateScheduledEvent({ event, projectId });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/resolve-scheduled-event', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { event, projectId } = req.body;

        RealtimeService.resolveScheduledEvent({ event, projectId });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post(
    '/add-scheduled-event-internal-note',
    isAuthorizedService,
    async function(req, res) {
        try {
            const { note, scheduledEventId } = req.body;

            RealtimeService.addScheduledEventInternalNote({
                note,
                scheduledEventId,
            });
            return sendEmptyResponse(req, res);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.post(
    '/add-scheduled-event-investigation-note',
    isAuthorizedService,
    async function(req, res) {
        try {
            const { note, scheduledEventId, projectId } = req.body;

            RealtimeService.addScheduledEventInvestigationNote({
                note,
                scheduledEventId,
                projectId,
            });
            return sendEmptyResponse(req, res);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.post(
    '/delete-scheduled-event-internal-note',
    isAuthorizedService,
    async function(req, res) {
        try {
            const { note, scheduledEventId } = req.body;

            RealtimeService.deleteScheduledEventInternalNote({
                note,
                scheduledEventId,
            });
            return sendEmptyResponse(req, res);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.post(
    '/delete-scheduled-event-investigation-note',
    isAuthorizedService,
    async function(req, res) {
        try {
            const { note, scheduledEventId, projectId } = req.body;

            RealtimeService.deleteScheduledEventInvestigationNote({
                note,
                scheduledEventId,
                projectId,
            });
            return sendEmptyResponse(req, res);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.post(
    '/update-scheduled-event-investigation-note',
    isAuthorizedService,
    async function(req, res) {
        try {
            const { note, scheduledEventId, projectId } = req.body;

            RealtimeService.updateScheduledEventInvestigationNote({
                note,
                scheduledEventId,
                projectId,
            });
            return sendEmptyResponse(req, res);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.post(
    '/update-scheduled-event-internal-note',
    isAuthorizedService,
    async function(req, res) {
        try {
            const { note, scheduledEventId } = req.body;

            RealtimeService.updateScheduledEventInternalNote({
                note,
                scheduledEventId,
            });
            return sendEmptyResponse(req, res);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.post('/send-component-created', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { component, projectId } = req.body;

        RealtimeService.sendComponentCreated({ component, projectId });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/send-monitor-created', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { monitor, projectId } = req.body;

        RealtimeService.sendMonitorCreated({ monitor, projectId });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/send-monitor-delete', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { monitor, projectId } = req.body;

        RealtimeService.sendMonitorDelete({ monitor, projectId });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/send-component-delete', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { component, projectId } = req.body;

        RealtimeService.sendComponentDelete({ component, projectId });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/incident-resolved', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { incident, projectId } = req.body;

        RealtimeService.incidentResolved({ incident, projectId });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/incident-acknowledged', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { incident, projectId } = req.body;

        RealtimeService.incidentAcknowledged({ incident, projectId });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/status-page-edit', isAuthorizedService, async function(req, res) {
    try {
        const { statusPage, projectId } = req.body;

        RealtimeService.statusPageEdit({ projectId, statusPage });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/component-edit', isAuthorizedService, async function(req, res) {
    try {
        const { component, projectId } = req.body;

        RealtimeService.componentEdit({ component, projectId });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/monitor-edit', isAuthorizedService, async function(req, res) {
    try {
        const { monitor, projectId } = req.body;

        RealtimeService.monitorEdit({ monitor, projectId });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/update-monitor-log', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const {
            data,
            logData,
            projectId,
            parentProjectId,
            monitorId,
        } = req.body;

        RealtimeService.updateMonitorLog({
            data,
            logData,
            projectId,
            parentProjectId,
            monitorId,
        });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/update-lighthouse-log', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const body = req.body;
        const { data, projectId, monitorId, parentProjectId } = body;

        RealtimeService.updateLighthouseLog({
            data,
            projectId,
            monitorId,
            parentProjectId,
        });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/update-all-lighthouse-log', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { projectId, data, parentProjectId, monitorId } = req.body;

        RealtimeService.updateAllLighthouseLog({
            projectId,
            data,
            parentProjectId,
            monitorId,
        });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/update-monitor-status', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { data, projectId, monitorId, parentProjectId } = req.body;

        RealtimeService.updateMonitorStatus({
            projectId,
            data,
            parentProjectId,
            monitorId,
        });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/update-probe', isAuthorizedService, async function(req, res) {
    try {
        const { data } = req.body;

        RealtimeService.updateProbe({ data });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/send-notification', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { data, projectId } = req.body;

        RealtimeService.sendNotification({ data, projectId });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/update-team-member-role', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { projectId, data } = req.body;

        RealtimeService.updateTeamMemberRole({ projectId, data });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/create-team-member', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { projectId, data } = req.body;

        RealtimeService.createTeamMember({ projectId, data });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/delete-team-member', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { projectId, data } = req.body;

        RealtimeService.deleteTeamMember({ projectId, data });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post(
    '/send-application-log-created',
    isAuthorizedService,
    async function(req, res) {
        try {
            const { applicationLog, componentId } = req.body;

            RealtimeService.sendApplicationLogCreated({
                applicationLog,
                componentId,
            });
            return sendEmptyResponse(req, res);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.post('/send-application-log-delete', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { applicationLog, componentId } = req.body;

        RealtimeService.sendApplicationLogDelete({
            applicationLog,
            componentId,
        });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/send-log-created', isAuthorizedService, async function(req, res) {
    try {
        const { contentLog, applicationLogId } = req.body;

        RealtimeService.sendLogCreated({ contentLog, applicationLogId });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/application-log-key-reset', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { applicationLog, componentId } = req.body;

        RealtimeService.applicationLogKeyReset({ applicationLog, componentId });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post(
    '/send-container-security-created',
    isAuthorizedService,
    async function(req, res) {
        try {
            const { containerSecurity, componentId } = req.body;

            RealtimeService.sendContainerSecurityCreated({
                containerSecurity,
                componentId,
            });
            return sendEmptyResponse(req, res);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.post(
    '/send-application-security-created',
    isAuthorizedService,
    async function(req, res) {
        try {
            const { applicationSecurity, componentId } = req.body;

            RealtimeService.sendApplicationSecurityCreated({
                applicationSecurity,
                componentId,
            });
            return sendEmptyResponse(req, res);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.post('/send-error-tracker-created', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { errorTracker, componentId } = req.body;

        RealtimeService.sendErrorTrackerCreated({ errorTracker, componentId });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/send-error-tracker-delete', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { errorTracker, componentId } = req.body;

        RealtimeService.sendErrorTrackerDelete({ errorTracker, componentId });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/error-tracker-key-reset', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { errorTracker, componentId } = req.body;

        RealtimeService.errorTrackerKeyReset({ errorTracker, componentId });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/send-error-event-created', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { data, errorTrackerId } = req.body;

        RealtimeService.sendErrorEventCreated({ data, errorTrackerId });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/send-issue-status-change', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { issue, type, errorTrackerId } = req.body;

        RealtimeService.sendIssueStatusChange({ issue, type, errorTrackerId });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post(
    '/send-error-tracker-issue-delete',
    isAuthorizedService,
    async function(req, res) {
        try {
            const { issue, errorTrackerId } = req.body;

            RealtimeService.sendErrorTrackerIssueDelete({
                issue,
                errorTrackerId,
            });
            return sendEmptyResponse(req, res);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.post('/send-time-metrics', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { appId, data } = req.body;

        RealtimeService.sendTimeMetrics({ appId, data });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/send-throughput-metrics', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { appId, data } = req.body;

        RealtimeService.sendThroughputMetrics({ appId, data });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/send-error-metrics', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { appId, data } = req.body;

        RealtimeService.sendErrorMetrics({ appId, data });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/handle-scanning', isAuthorizedService, async function(req, res) {
    try {
        const { security } = req.body;

        RealtimeService.handleScanning({ security });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/handle-log', isAuthorizedService, async function(req, res) {
    try {
        const { securityId, securityLog } = req.body;

        RealtimeService.handleLog({ securityId, securityLog });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/status-page-update-tweets', isAuthorizedService, async function(
    req,
    res
) {
    try {
        const { tweets, statusPageId, _projectId } = req.body;

        RealtimeService.updateTweets({ tweets, statusPageId, _projectId });
        return sendEmptyResponse(req, res);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
