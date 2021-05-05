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
const { getSubProjects } = require('../middlewares/subProject');

const router = express.Router();

router.post('/:projectId', getUser, getSubProjects, async function(req, res) {
    try {
        const val = req.body.search;
        const subProjectIds = req.user.subProjects
            ? req.user.subProjects.map(project => project._id)
            : null;

        const searchResponse = [];
        const components = await getComponents(subProjectIds, val);
        if (components) {
            searchResponse.push(components);
        }
        const monitors = await getMonitors(subProjectIds, val);

        if (monitors) {
            searchResponse.push(monitors);
        }
        const statusPages = await getStatusPages(subProjectIds, val);
        if (statusPages) {
            searchResponse.push(statusPages);
        }
        const users = await getUsers(subProjectIds, val);
        if (users) {
            searchResponse.push(users);
        }
        const schedules = await getOnCallDuty(subProjectIds, val);
        if (schedules) {
            searchResponse.push(schedules);
        }
        const getSchedultEvents = await getSchedultEvent(subProjectIds, val);
        if (getSchedultEvents) {
            searchResponse.push(getSchedultEvents);
        }
        return sendListResponse(req, res, searchResponse);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

const getComponents = async (projectIds, val) => {
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
                url: component.slug + '/monitoring',
                componentId: component._id,
                projectId: component.projectId._id,
            })),
        };
        return resultObj;
    }

    return null;
};

const getMonitors = async (projectIds, val) => {
    const monitors = await MonitorService.findBy({
        projectId: { $in: projectIds },
        deleted: false,
        $or: [{ name: { $regex: new RegExp(val), $options: 'i' } }],
    });
    if (monitors.length > 0) {
        const resultObj = {
            title: 'Monitors',
            values: monitors.map(monitor => ({
                name: monitor.name,
                componentSlug: monitor.componentId.slug,
                type: monitor.type,
                monitorSlug: monitor.slug,
                url: monitor.componentId.slug + '/monitoring/' + monitor.slug,
                componentId: monitor.componentId._id,
                projectId: monitor.projectId._id,
            })),
        };
        return resultObj;
    }

    return null;
};

const getStatusPages = async (projectIds, val) => {
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

const getOnCallDuty = async (projectIds, val) => {
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
            })),
        };
        return resultObj;
    }

    return null;
};

const getSchedultEvent = async (projectIds, val) => {
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
            })),
        };
        return resultObj;
    }

    return null;
};
module.exports = router;
