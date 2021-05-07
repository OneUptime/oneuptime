const express = require('express');
const UserService = require('../services/userService');
const ComponentService = require('../services/componentService');
const getUser = require('../middlewares/user').getUser;
const sendListResponse = require('../middlewares/response').sendListResponse;
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const MonitorService = require('../services/monitorService');
const statusPageService = require('../services/statusPageService');
const ScheduleService = require('../services/scheduleService');
const ProjectService = require('../services/projectService');
const ScheduleEventService = require('../services/scheduledEventService');
const IncidentService = require('../services/incidentService');
const ErrorTrackerService = require('../services/errorTrackerService');
const LogContainerService = require('../services/applicationLogService');
const PerformanceTracker = require('../services/performanceTrackerService');
const { getSubProjects } = require('../middlewares/subProject');

const router = express.Router();

router.post('/:projectId', getUser, getSubProjects, async function(req, res) {
    try {
        const val = req.body.search;
        const parentProjectId = req.params.projectId;
        const subProjectIds = req.user.subProjects
            ? req.user.subProjects.map(project => project._id)
            : null;

        const searchResponse = [];
        const components = await getComponents(
            subProjectIds,
            val,
            parentProjectId
        );
        if (components) {
            searchResponse.push(components);
        }
        const monitors = await getMonitors(subProjectIds, val, parentProjectId);

        if (monitors) {
            searchResponse.push(monitors);
        }
        const statusPages = await getStatusPages(
            subProjectIds,
            val,
            parentProjectId
        );
        if (statusPages) {
            searchResponse.push(statusPages);
        }
        const users = await getUsers(subProjectIds, val, parentProjectId);
        if (users) {
            searchResponse.push(users);
        }
        const schedules = await getOnCallDuty(
            subProjectIds,
            val,
            parentProjectId
        );
        if (schedules) {
            searchResponse.push(schedules);
        }
        const getSchedultEvents = await getSchedultEvent(
            subProjectIds,
            val,
            parentProjectId
        );
        if (getSchedultEvents) {
            searchResponse.push(getSchedultEvents);
        }
        const incidents = await getIncidents(
            subProjectIds,
            val,
            parentProjectId
        );
        if (incidents) {
            searchResponse.push(incidents);
        }
        const errorTrackers = await getErrorTrackers(
            subProjectIds,
            val,
            parentProjectId
        );
        if (errorTrackers) {
            searchResponse.push(errorTrackers);
        }
        const logContainers = await getLogContainers(
            subProjectIds,
            val,
            parentProjectId
        );
        if (logContainers) {
            searchResponse.push(logContainers);
        }
        const applicationTracker = await getPerformanceTrackers(
            subProjectIds,
            val,
            parentProjectId
        );
        if (applicationTracker) {
            searchResponse.push(applicationTracker);
        }
        return sendListResponse(req, res, searchResponse);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

const getComponents = async (projectIds, val, parentProjectId) => {
    const components = await ComponentService.findBy({
        projectId: { $in: projectIds },
        deleted: false,
        $or: [{ name: { $regex: new RegExp(val), $options: 'i' } }],
    });
    if (components.length > 0) {
        const resultObj = {
            title: 'Components',
            values: components.map(component => ({
                name: component.name,
                componentSlug: component.slug,
                url: 'component/' + component.slug + '/monitoring',
                componentId: component._id,
                projectId: component.projectId._id,
                parentProject:
                    parentProjectId === String(component.projectId._id),
                projectName: component.projectId.name,
            })),
        };
        return resultObj;
    }

    return null;
};

const getMonitors = async (projectIds, val, parentProjectId) => {
    const monitors = await MonitorService.findBy({
        projectId: { $in: projectIds },
        deleted: false,
        $or: [{ name: { $regex: new RegExp(val), $options: 'i' } }],
    });
    if (monitors.length > 0) {
        const resultObj = {
            title: 'Monitors',
            values: monitors.map(monitor => ({
                name: monitor.componentId.name + '/' + monitor.name,
                componentSlug: monitor.componentId.slug,
                type: monitor.type,
                monitorId: monitor._id,
                monitorSlug: monitor.slug,
                url: monitor.componentId.slug + '/monitoring/' + monitor.slug,
                componentId: monitor.componentId._id,
                projectId: monitor.projectId._id,
                parentProject:
                    parentProjectId === String(monitor.projectId._id),
                projectName: monitor.projectId.name,
            })),
        };
        return resultObj;
    }

    return null;
};

const getStatusPages = async (projectIds, val, parentProjectId) => {
    const statusPages = await statusPageService.findBy({
        projectId: { $in: projectIds },
        deleted: false,
        $or: [{ name: { $regex: new RegExp(val), $options: 'i' } }],
    });
    if (statusPages.length > 0) {
        const resultObj = {
            title: 'Status Pages',
            values: statusPages.map(statusPage => ({
                name: statusPage.name,
                statusPageSlug: statusPage.slug,
                statusPage: statusPage,
                projectId: statusPage.projectId,
                parentProject:
                    parentProjectId === String(statusPage.projectId._id),
                projectName: statusPage.projectId.name,
            })),
        };
        return resultObj;
    }

    return null;
};

const getUsers = async (projectIds, val) => {
    //get project users id so as to search for only users in a project and its subproject
    const projectUsers = [];
    const projects = await ProjectService.findBy({ _id: { $in: projectIds } });
    projects.forEach(project => {
        projectUsers.push(project.users);
    });
    const userIds = projectUsers.flat().map(user => user.userId);
    const users = await UserService.findBy({
        _id: { $in: userIds },
        deleted: false,
        $or: [
            {
                name: {
                    $regex: new RegExp(val),
                    $options: 'i',
                },
            },
        ],
    });
    if (users.length > 0) {
        const resultObj = {
            title: 'Team Members',
            values: users.map(user => ({
                name: user.name,
                userId: user._id,
            })),
        };

        return resultObj;
    }

    return null;
};

const getOnCallDuty = async (projectIds, val, parentProjectId) => {
    const schedules = await ScheduleService.findBy({
        projectId: { $in: projectIds },
        deleted: false,
        $or: [{ name: { $regex: new RegExp(val), $options: 'i' } }],
    });
    if (schedules.length > 0) {
        const resultObj = {
            title: 'On-Call Duty',
            values: schedules.map(schedule => ({
                name: schedule.name,
                scheduleSlug: schedule.slug,
                projectId: schedule.projectId._id,
                parentProject:
                    parentProjectId === String(schedule.projectId._id),
                projectName: schedule.projectId.name,
            })),
        };
        return resultObj;
    }

    return null;
};

const getSchedultEvent = async (projectIds, val, parentProjectId) => {
    const scheduleEvents = await ScheduleEventService.findBy({
        projectId: { $in: projectIds },
        deleted: false,
        $or: [{ name: { $regex: new RegExp(val), $options: 'i' } }],
    });
    if (scheduleEvents.length > 0) {
        const resultObj = {
            title: 'Schedule Events',
            values: scheduleEvents.map(scheduleEvent => ({
                name: scheduleEvent.name,
                scheduleEventSlug: scheduleEvent.slug,
                projectId: scheduleEvent.projectId._id,
                scheduleEvents: scheduleEvent,
                parentProject:
                    parentProjectId === String(scheduleEvent.projectId._id),
                projectName: scheduleEvent.projectId.name,
            })),
        };
        return resultObj;
    }

    return null;
};

const getIncidents = async (projectIds, val, parentProjectId) => {
    const isNumber = Number(val);
    if (isNumber) {
        const incidents = await IncidentService.findBy({
            projectId: { $in: projectIds },
            deleted: false,
            idNumber: Number(val),
        });
        if (incidents.length > 0) {
            const resultObj = {
                title: 'Incidents',
                values: incidents.map(incident => {
                    return {
                        name: `incident #${incident.idNumber}`,
                        idNumber: incident.idNumber,
                        parentProject:
                            parentProjectId === String(incident.projectId._id),
                        projectName: incident.projectId.name,
                        componentId: incident.monitorId.componentId.slug,
                        notificationId: incident.notificationId,
                        incident: incident,
                    };
                }),
            };
            return resultObj;
        }
    }

    return null;
};

const getErrorTrackers = async (projectIds, val, parentProjectId) => {
    const components = await ComponentService.findBy({
        projectId: { $in: projectIds },
        deleted: false,
    });
    const componentIds = components.map(component => component._id);
    const errorTrackers = await ErrorTrackerService.findBy({
        componentId: { $in: componentIds },
        deleted: false,
        $or: [{ name: { $regex: new RegExp(val), $options: 'i' } }],
    });
    if (errorTrackers.length > 0) {
        const resultObj = {
            title: 'Error Trackers',
            values: errorTrackers.map(errorTracker => ({
                name: errorTracker.name,
                errorTrackerSlug: errorTracker.slug,
                projectId: errorTracker.componentId.projectId._id,
                errorTracker: errorTracker,
                componentSlug: errorTracker.componentId.slug,
                parentProject:
                    parentProjectId ===
                    String(errorTracker.componentId.projectId._id),
                projectName: errorTracker.componentId.projectId.name,
            })),
        };
        return resultObj;
    }

    return null;
};

const getLogContainers = async (projectIds, val, parentProjectId) => {
    const components = await ComponentService.findBy({
        projectId: { $in: projectIds },
        deleted: false,
    });
    const componentIds = components.map(component => component._id);
    const logContainers = await LogContainerService.findBy({
        componentId: { $in: componentIds },
        deleted: false,
        $or: [{ name: { $regex: new RegExp(val), $options: 'i' } }],
    });
    if (logContainers.length > 0) {
        const resultObj = {
            title: 'Log Containers',
            values: logContainers.map(logContainer => ({
                name: logContainer.name,
                logContainerSlug: logContainer.slug,
                projectId: logContainer.componentId.projectId._id,
                logContainer: logContainer,
                componentSlug: logContainer.componentId.slug,
                parentProject:
                    parentProjectId ===
                    String(logContainer.componentId.projectId._id),
                projectName: logContainer.componentId.projectId.name,
            })),
        };
        return resultObj;
    }

    return null;
};

const getPerformanceTrackers = async (projectIds, val, parentProjectId) => {
    const components = await ComponentService.findBy({
        projectId: { $in: projectIds },
        deleted: false,
    });
    const componentIds = components.map(component => component._id);
    const performanceTrackers = await PerformanceTracker.findBy({
        componentId: { $in: componentIds },
        deleted: false,
        $or: [{ name: { $regex: new RegExp(val), $options: 'i' } }],
    });
    if (performanceTrackers.length > 0) {
        const resultObj = {
            title: 'Performance Tracker',
            values: performanceTrackers.map(performanceTracker => ({
                name: performanceTracker.name,
                performanceTrackerSlug: performanceTracker.slug,
                projectId: performanceTracker.componentId.projectId._id,
                performanceTracker: performanceTracker,
                componentSlug: performanceTracker.componentId.slug,
                parentProject:
                    parentProjectId ===
                    String(performanceTracker.componentId.projectId._id),
                projectName: performanceTracker.componentId.projectId.name,
            })),
        };
        return resultObj;
    }

    return null;
};
module.exports = router;
