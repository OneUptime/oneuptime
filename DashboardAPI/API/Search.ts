import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from 'CommonServer/utils/Express';
import UserService from '../services/userService';
import ComponentService from '../services/componentService';
const getUser: $TSFixMe = require('../middlewares/user').getUser;
import {
    sendListResponse,
    sendErrorResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';
import ObjectID from 'Common/Types/ObjectID';
import MonitorService from '../services/monitorService';
import statusPageService from '../services/statusPageService';
import ScheduleService from '../services/scheduleService';
import ProjectService from '../services/projectService';
import ScheduleEventService from '../services/scheduledEventService';
import IncidentService from '../services/incidentService';
import ErrorTrackerService from '../services/errorTrackerService';
import LogContainerService from '../services/applicationLogService';
import PerformanceTracker from '../services/performanceTrackerService';

import { getSubProjects } from '../middlewares/subProject';

const router: ExpressRouter = Express.getRouter();

router.post(
    '/:projectId',
    getUser,
    getSubProjects,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const val: $TSFixMe = req.body.search;
            const parentProjectId: $TSFixMe = req.params['projectId'];

            const subProjectIds: $TSFixMe = req.user.subProjects
                ? req.user.subProjects.map((project: $TSFixMe) => {
                      return project._id;
                  })
                : null;

            const searchResponse: $TSFixMe = [];

            const [
                components,
                monitors,
                statusPages,
                users,
                schedules,
                getSchedultEvents,
                incidents,
                errorTrackers,
                logContainers,
                applicationTracker,
            ] = await Promise.all([
                getComponents(subProjectIds, val, parentProjectId),
                getMonitors(subProjectIds, val, parentProjectId),
                getStatusPages(subProjectIds, val, parentProjectId),

                getUsers(subProjectIds, val, parentProjectId),
                getOnCallDuty(subProjectIds, val, parentProjectId),
                getSchedultEvent(subProjectIds, val, parentProjectId),
                getIncidents(subProjectIds, val, parentProjectId),
                getErrorTrackers(subProjectIds, val, parentProjectId),
                getLogContainers(subProjectIds, val, parentProjectId),
                getPerformanceTrackers(subProjectIds, val, parentProjectId),
            ]);

            if (components) {
                searchResponse.push(components);
            }
            if (monitors) {
                searchResponse.push(monitors);
            }
            if (statusPages) {
                searchResponse.push(statusPages);
            }
            if (users) {
                searchResponse.push(users);
            }
            if (schedules) {
                searchResponse.push(schedules);
            }
            if (getSchedultEvents) {
                searchResponse.push(getSchedultEvents);
            }
            if (incidents) {
                searchResponse.push(incidents);
            }
            if (errorTrackers) {
                searchResponse.push(errorTrackers);
            }
            if (logContainers) {
                searchResponse.push(logContainers);
            }
            if (applicationTracker) {
                searchResponse.push(applicationTracker);
            }

            return sendListResponse(req, res, searchResponse);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

const getComponents: Function = async (
    projectIds: $TSFixMe,
    val: $TSFixMe,
    parentProjectId: ObjectID
): void => {
    const populateComponent: $TSFixMe = [
        { path: 'projectId', select: 'name' },
        { path: 'componentCategoryId', select: 'name' },
    ];

    const selectComponent: $TSFixMe =
        '_id createdAt name createdById projectId slug componentCategoryId';
    const components: $TSFixMe = await ComponentService.findBy({
        query: {
            projectId: { $in: projectIds },
            deleted: false,
            $or: [{ name: { $regex: new RegExp(val), $options: 'i' } }],
        },
        select: selectComponent,
        populate: populateComponent,
    });
    if (components.length > 0) {
        const resultObj: $TSFixMe = {
            title: 'Components',
            values: components.map((component: $TSFixMe) => {
                return {
                    name: component.name,
                    componentSlug: component.slug,
                    url: 'component/' + component.slug + '/monitoring',
                    componentId: component._id,
                    projectId: component.projectId._id,

                    parentProject:
                        parentProjectId === String(component.projectId._id),

                    projectName: component.projectId.name,
                };
            }),
        };
        return resultObj;
    }

    return null;
};

const getMonitors: Function = async (
    projectIds: $TSFixMe,
    val: $TSFixMe,
    parentProjectId: ObjectID
): void => {
    const query: $TSFixMe = {
        projectId: { $in: projectIds },
        deleted: false,
        $or: [{ name: { $regex: new RegExp(val), $options: 'i' } }],
    };
    const populate: $TSFixMe = [
        {
            path: 'componentId',
            select: 'name slug _id',
        },
        { path: 'projectId', select: '_id name' },
    ];
    const select: string = '_id name componentId projectId type slug';
    const monitors: $TSFixMe = await MonitorService.findBy({
        query,
        populate,
        select,
    });
    if (monitors.length > 0) {
        const resultObj: $TSFixMe = {
            title: 'Monitors',
            values: monitors.map((monitor: $TSFixMe) => {
                return {
                    name: monitor.componentId.name + '/' + monitor.name,
                    componentSlug: monitor.componentId.slug,
                    type: monitor.type,
                    monitorId: monitor._id,
                    data: monitor.data ? monitor.data : null,
                    monitorSlug: monitor.slug,
                    url:
                        monitor.componentId.slug +
                        '/monitoring/' +
                        monitor.slug,
                    componentId: monitor.componentId._id,
                    projectId: monitor.projectId._id,

                    parentProject:
                        parentProjectId === String(monitor.projectId._id),

                    projectName: monitor.projectId.name,
                };
            }),
        };
        return resultObj;
    }

    return null;
};

const getStatusPages: Function = async (
    projectIds: $TSFixMe,
    val: $TSFixMe,
    parentProjectId: ObjectID
): void => {
    const populateStatusPage: $TSFixMe = [
        {
            path: 'projectId',
            select: 'name parentProjectId',
            populate: { path: 'parentProjectId', select: '_id' },
        },
        {
            path: 'domains.domainVerificationToken',
            select: 'domain verificationToken verified ',
        },
        {
            path: 'monitors.monitor',
            select: 'name',
        },
    ];

    const selectStatusPage: $TSFixMe =
        'domains projectId monitors links twitterHandle slug title name isPrivate isSubscriberEnabled isGroupedByMonitorCategory showScheduledEvents moveIncidentToTheTop hideProbeBar hideUptime multipleNotifications hideResolvedIncident description copyright faviconPath logoPath bannerPath colors layout headerHTML footerHTML customCSS customJS statusBubbleId embeddedCss createdAt enableRSSFeed emailNotification smsNotification webhookNotification selectIndividualMonitors enableIpWhitelist ipWhitelist incidentHistoryDays scheduleHistoryDays announcementLogsHistory theme';

    const statusPages: $TSFixMe = await statusPageService.findBy({
        query: {
            projectId: { $in: projectIds },
            deleted: false,
            $or: [{ name: { $regex: new RegExp(val), $options: 'i' } }],
        },
        select: selectStatusPage,
        populate: populateStatusPage,
    });

    if (statusPages.length > 0) {
        const resultObj: $TSFixMe = {
            title: 'Status Pages',

            values: statusPages.map((statusPage: $TSFixMe) => {
                return {
                    name: statusPage.name,
                    statusPageSlug: statusPage.slug,
                    statusPage: statusPage,
                    projectId: statusPage.projectId,

                    parentProject:
                        parentProjectId === String(statusPage.projectId._id),

                    projectName: statusPage.projectId.name,
                };
            }),
        };
        return resultObj;
    }

    return null;
};

const getUsers: Function = async (
    projectIds: $TSFixMe,
    val: $TSFixMe
): void => {
    //Get project users id so as to search for only users in a project and its subproject
    const projectUsers: $TSFixMe = [];

    const projects: $TSFixMe = await ProjectService.findBy({
        query: { _id: { $in: projectIds } },
        select: 'users',
    });
    projects.forEach((project: $TSFixMe) => {
        projectUsers.push(project.users);
    });
    const userIds: $TSFixMe = projectUsers.flat().map((user: $TSFixMe) => {
        return user.userId;
    });
    const users: $TSFixMe = await UserService.findBy({
        query: {
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
        },
        select: 'name _id',
    });
    if (users.length > 0) {
        const resultObj: $TSFixMe = {
            title: 'Team Members',
            values: users.map((user: $TSFixMe) => {
                return {
                    name: user.name,
                    userId: user._id,
                };
            }),
        };

        return resultObj;
    }

    return null;
};

const getOnCallDuty: Function = async (
    projectIds: $TSFixMe,
    val: $TSFixMe,
    parentProjectId: ObjectID
): void => {
    const populate: $TSFixMe = [
        { path: 'userIds', select: 'name' },
        { path: 'createdById', select: 'name' },
        { path: 'monitorIds', select: 'name' },
        {
            path: 'projectId',
            select: '_id name slug',
        },
        {
            path: 'escalationIds',
            select: 'teams',
            populate: {
                path: 'teams.teamMembers.userId',
                select: 'name email',
            },
        },
    ];

    const select: $TSFixMe =
        '_id name slug projectId createdById monitorsIds escalationIds createdAt isDefault userIds';
    const schedules: $TSFixMe = await ScheduleService.findBy({
        query: {
            projectId: { $in: projectIds },
            deleted: false,
            $or: [{ name: { $regex: new RegExp(val), $options: 'i' } }],
        },
        select,
        populate,
    });
    if (schedules.length > 0) {
        const resultObj: $TSFixMe = {
            title: 'On-Call Duty',
            values: schedules.map((schedule: $TSFixMe) => {
                return {
                    name: schedule.name,
                    scheduleSlug: schedule.slug,
                    projectId: schedule.projectId._id,

                    parentProject:
                        parentProjectId === String(schedule.projectId._id),

                    projectName: schedule.projectId.name,
                };
            }),
        };
        return resultObj;
    }

    return null;
};

const getSchedultEvent: Function = async (
    projectIds: $TSFixMe,
    val: $TSFixMe,
    parentProjectId: ObjectID
): void => {
    const populateScheduledEvent: $TSFixMe = [
        { path: 'resolvedBy', select: 'name' },
        { path: 'projectId', select: 'name slug' },
        { path: 'createdById', select: 'name' },
        {
            path: 'monitors.monitorId',
            select: 'name',
            populate: { path: 'componentId', select: 'name slug' },
        },
    ];
    const selectScheduledEvent: $TSFixMe =
        'cancelled showEventOnStatusPage callScheduleOnEvent monitorDuringEvent monitorDuringEvent recurring interval alertSubscriber resolved monitors name startDate endDate description createdById projectId slug createdAt ';

    const scheduleEvents: $TSFixMe = await ScheduleEventService.findBy({
        query: {
            projectId: { $in: projectIds },
            deleted: false,
            $or: [{ name: { $regex: new RegExp(val), $options: 'i' } }],
        },
        populate: populateScheduledEvent,
        select: selectScheduledEvent,
    });
    if (scheduleEvents.length > 0) {
        const resultObj: $TSFixMe = {
            title: 'Schedule Events',
            values: scheduleEvents.map((scheduleEvent: $TSFixMe) => {
                return {
                    name: scheduleEvent.name,
                    scheduleEventSlug: scheduleEvent.slug,
                    projectId: scheduleEvent.projectId._id,
                    scheduleEvents: scheduleEvent,

                    parentProject:
                        parentProjectId === String(scheduleEvent.projectId._id),

                    projectName: scheduleEvent.projectId.name,
                };
            }),
        };
        return resultObj;
    }

    return null;
};

const getIncidents: Function = async (
    projectIds: $TSFixMe,
    val: $TSFixMe,
    parentProjectId: ObjectID
): void => {
    const isNumber: $TSFixMe = Number(val);
    if (isNumber) {
        const populate: $TSFixMe = [
            {
                path: 'monitors.monitorId',
                select: 'name slug componentId projectId type',
                populate: [
                    { path: 'componentId', select: 'name slug' },
                    { path: 'projectId', select: 'name slug' },
                ],
            },
            { path: 'createdById', select: 'name' },
            { path: 'projectId', select: 'name slug' },
            { path: 'resolvedBy', select: 'name' },
            { path: 'acknowledgedBy', select: 'name' },
            { path: 'incidentPriority', select: 'name color' },
            {
                path: 'acknowledgedByIncomingHttpRequest',
                select: 'name',
            },
            { path: 'resolvedByIncomingHttpRequest', select: 'name' },
            { path: 'createdByIncomingHttpRequest', select: 'name' },
            { path: 'probes.probeId', select: 'name _id' },
        ];
        const select: $TSFixMe =
            'slug notifications acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber notifications';

        const incidents: $TSFixMe = await IncidentService.findBy({
            query: {
                projectId: { $in: projectIds },
                deleted: false,
                idNumber: Number(val),
            },
            select,
            populate,
        });
        if (incidents.length > 0) {
            const resultObj: $TSFixMe = {
                title: 'Incidents',
                values: incidents.map((incident: $TSFixMe) => {
                    return {
                        name: `Incident #${incident.idNumber}`,
                        idNumber: incident.idNumber,
                        incidentSlug: incident.slug,
                        parentProject:
                            parentProjectId === String(incident.projectId._id),
                        projectName: incident.projectId.name,
                        notifications: incident.notifications,
                        incident: incident,
                    };
                }),
            };
            return resultObj;
        }
    }

    return null;
};

const getErrorTrackers: Function = async (
    projectIds: $TSFixMe,
    val: $TSFixMe,
    parentProjectId: ObjectID
): void => {
    const components: $TSFixMe = await ComponentService.findBy({
        query: { projectId: { $in: projectIds }, deleted: false },
        select: '_id',
    });
    const componentIds: $TSFixMe = components.map((component: $TSFixMe) => {
        return component._id;
    });
    const select: $TSFixMe =
        'componentId name slug key showQuickStart resourceCategory createdById createdAt';
    const populate: $TSFixMe = [
        {
            path: 'componentId',
            select: 'name slug projectId',
            populate: [{ path: 'projectId', select: 'name' }],
        },
        { path: 'resourceCategory', select: 'name' },
    ];
    const errorTrackers: $TSFixMe = await ErrorTrackerService.findBy({
        query: {
            componentId: { $in: componentIds },
            deleted: false,
            $or: [{ name: { $regex: new RegExp(val), $options: 'i' } }],
        },
        select,
        populate,
    });
    if (errorTrackers.length > 0) {
        const resultObj: $TSFixMe = {
            title: 'Error Trackers',
            values: errorTrackers.map((errorTracker: $TSFixMe) => {
                return {
                    name: errorTracker.name,
                    errorTrackerSlug: errorTracker.slug,
                    projectId: errorTracker.componentId.projectId._id,
                    errorTracker: errorTracker,
                    componentSlug: errorTracker.componentId.slug,

                    parentProject:
                        parentProjectId ===
                        String(errorTracker.componentId.projectId._id),

                    projectName: errorTracker.componentId.projectId.name,
                };
            }),
        };
        return resultObj;
    }

    return null;
};

const getLogContainers: Function = async (
    projectIds: $TSFixMe,
    val: $TSFixMe,
    parentProjectId: ObjectID
): void => {
    const components: $TSFixMe = await ComponentService.findBy({
        query: { projectId: { $in: projectIds }, deleted: false },
        select: '_id',
    });
    const componentIds: $TSFixMe = components.map((component: $TSFixMe) => {
        return component._id;
    });
    const populateAppLogs: $TSFixMe = [
        {
            path: 'componentId',
            select: 'name slug projectId',
            populate: {
                path: 'projectId',
                select: 'name slug',
            },
        },
    ];

    const selectAppLogs: $TSFixMe =
        'componentId name slug resourceCategory showQuickStart createdById key';
    const logContainers: $TSFixMe = await LogContainerService.findBy({
        query: {
            componentId: { $in: componentIds },
            deleted: false,
            $or: [{ name: { $regex: new RegExp(val), $options: 'i' } }],
        },
        select: selectAppLogs,
        populate: populateAppLogs,
    });

    if (logContainers.length > 0) {
        const resultObj: $TSFixMe = {
            title: 'Log Containers',
            values: logContainers.map((logContainer: $TSFixMe) => {
                return {
                    name: logContainer.name,
                    logContainerSlug: logContainer.slug,
                    projectId: logContainer.componentId.projectId._id,
                    logContainer: logContainer,
                    componentSlug: logContainer.componentId.slug,

                    parentProject:
                        parentProjectId ===
                        String(logContainer.componentId.projectId._id),

                    projectName: logContainer.componentId.projectId.name,
                };
            }),
        };
        return resultObj;
    }

    return null;
};

const getPerformanceTrackers: Function = async (
    projectIds: $TSFixMe,
    val: $TSFixMe,
    parentProjectId: ObjectID
): void => {
    const components: $TSFixMe = await ComponentService.findBy({
        query: { projectId: { $in: projectIds }, deleted: false },
        select: 'id',
    });

    const componentIds: $TSFixMe = components.map((component: $TSFixMe) => {
        return component._id;
    });
    const selectPerfTracker: $TSFixMe =
        'componentId name slug key showQuickStart createdById';

    const populatePerfTracker: $TSFixMe = [
        { path: 'createdById', select: 'name email' },
        {
            path: 'componentId',
            select: 'name slug',
            populate: { path: 'projectId', select: 'name slug' },
        },
    ];
    const performanceTrackers: $TSFixMe = await PerformanceTracker.findBy({
        query: {
            componentId: { $in: componentIds },
            deleted: false,
            $or: [{ name: { $regex: new RegExp(val), $options: 'i' } }],
        },
        select: selectPerfTracker,
        populate: populatePerfTracker,
    });
    if (performanceTrackers.length > 0) {
        const resultObj: $TSFixMe = {
            title: 'Performance Tracker',
            values: performanceTrackers.map((performanceTracker: $TSFixMe) => {
                return {
                    name: performanceTracker.name,
                    performanceTrackerSlug: performanceTracker.slug,
                    projectId: performanceTracker.componentId.projectId._id,
                    performanceTracker: performanceTracker,
                    componentSlug: performanceTracker.componentId.slug,

                    parentProject:
                        parentProjectId ===
                        String(performanceTracker.componentId.projectId._id),

                    projectName: performanceTracker.componentId.projectId.name,
                };
            }),
        };
        return resultObj;
    }

    return null;
};
export default router;
