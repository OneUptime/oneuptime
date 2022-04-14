import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
import UserService from '../services/userService';
import ComponentService from '../services/componentService';
import NotificationService from '../services/notificationService';
import RealTimeService from '../services/realTimeService';
import ApplicationLogService from '../services/applicationLogService';
import MonitorService from '../services/monitorService';
import ApplicationSecurityService from '../services/applicationSecurityService';
import ContainerSecurityService from '../services/containerSecurityService';
import LogService from '../services/logService';
import ApplicationSecurityLogService from '../services/applicationSecurityLogService';
import ContainerSecurityLogService from '../services/containerSecurityLogService';
import ErrorTrackerService from '../services/errorTrackerService';
import IssueService from '../services/issueService';
import PerformanceTrackerService from '../services/performanceTrackerService';
import PerformanceTrackerMetricService from '../services/performanceTrackerMetricService';
import ErrorService from 'CommonServer/Utils/error';

const router: $TSFixMe = express.getRouter();
const isUserAdmin: $TSFixMe = require('../middlewares/project').isUserAdmin;
const getUser: $TSFixMe = require('../middlewares/user').getUser;
const getSubProjects: $TSFixMe = require('../middlewares/subProject').getSubProjects;

import { isAuthorized } from '../middlewares/authorization';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import { sendListResponse } from 'CommonServer/Utils/response';
import moment from 'moment';

// Route
// Description: Adding / Updating a new component to the project.
// Params:
// Param 1: req.params-> {projectId}; req.body -> {[_id], name, type, data, visibleOnStatusPage} <- Check ComponentMoal for description.
// Returns: response status, error message
router.post(
    '/:projectId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async (req, res): void => {
        try {
            const data: $TSFixMe = req.body;
            const projectId: $TSFixMe = req.params.projectId;
            if (!data) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: "values can't be null",
                });
            }

            data.createdById = req.user ? req.user.id : null;

            if (!data.name) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Component Name is required.',
                });
            }

            if (typeof data.name !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Component Name is not of type string.',
                });
            }

            data.projectId = projectId;

            const component: $TSFixMe = await ComponentService.create(data);

            const user: $TSFixMe = await UserService.findOneBy({
                query: { _id: req.user.id },
                select: 'name _id',
            });

            if (component) {
                try {
                    NotificationService.create(
                        component.projectId._id || component.projectId,
                        `A New Component was Created with name ${component.name} by ${user.name}`,
                        user._id,
                        'componentaddremove'
                    );
                    // run in the background
                    RealTimeService.sendComponentCreated(component);
                } catch (error) {
                    ErrorService.log(
                        'realtimeService.sendComponentCreated',
                        component
                    );
                }
            }
            return sendItemResponse(req, res, component);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/:componentId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const data: $TSFixMe = req.body;
            const { componentId }: $TSFixMe = req.params;
            let unsetData;
            if (!data.componentCategoryId || data.componentCategoryId === '') {
                unsetData = { componentCategoryId: '' };
            }
            const component: $TSFixMe = await ComponentService.updateOneBy(
                { _id: componentId },
                data,
                unsetData
            );
            if (component) {
                return sendItemResponse(req, res, component);
            } else {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Component not found.',
                });
            }
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Route
// Description: Get all Components by projectId.
router.get(
    '/:projectId',
    getUser,
    isAuthorized,
    getSubProjects,
    async (req, res): void => {
        try {
            const { limit, skip }: $TSFixMe = req.query;

            // Call the ComponentService.
            const components: $TSFixMe =
                await ComponentService.getComponentsBySubprojects(
                    [req.params.projectId],
                    limit || 0,
                    skip || 0
                );
            return sendItemResponse(req, res, components);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Route
// Description: Get all Components by pagination.
router.get(
    '/:projectId/paginated',
    getUser,
    isAuthorized,
    async (req, res): void => {
        try {
            const { projectId }: $TSFixMe = req.params;
            const { limit, skip }: $TSFixMe = req.query;

            // Call the ComponentService.
            const response: $TSFixMe = await ComponentService.getComponentsByPaginate(
                projectId,
                limit,
                skip
            );
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/slug/:slug',
    getUser,
    isAuthorized,
    async (req, res): void => {
        try {
            const { slug }: $TSFixMe = req.params;
            const populateComponent: $TSFixMe = [
                { path: 'projectId', select: 'name' },
                { path: 'componentCategoryId', select: 'name' },
            ];

            const selectComponent: $TSFixMe =
                '_id createdAt name createdById projectId slug componentCategoryId';
            const component: $TSFixMe = await ComponentService.findOneBy({
                query: { slug },
                select: selectComponent,
                populate: populateComponent,
            });

            return sendItemResponse(req, res, component);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/component',
    getUser,
    isAuthorized,
    getSubProjects,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const type: $TSFixMe = req.query.type;

            const subProjectIds: $TSFixMe = req.user.subProjects
                ? req.user.subProjects.map((project: $TSFixMe) => project._id)
                : null;
            const query: $TSFixMe = type
                ? { projectId: { $in: subProjectIds }, type }
                : { projectId: { $in: subProjectIds } };

            const populateComponent: $TSFixMe = [
                { path: 'projectId', select: 'name' },
                { path: 'componentCategoryId', select: 'name' },
            ];

            const selectComponent: $TSFixMe =
                '_id createdAt name createdById projectId slug componentCategoryId';

            const [components, count]: $TSFixMe = await Promise.all([
                ComponentService.findBy({
                    query,
                    limit: req.query['limit'] || 10,
                    skip: req.query['skip'] || 0,
                    populate: populateComponent,
                    select: selectComponent,
                }),
                ComponentService.countBy({
                    projectId: { $in: subProjectIds },
                }),
            ]);
            return sendListResponse(req, res, components, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/component/:componentId',
    getUser,
    isAuthorized,
    getSubProjects,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const componentId: $TSFixMe = req.params.componentId;
            const type: $TSFixMe = req.query.type;

            const subProjectIds: $TSFixMe = req.user.subProjects
                ? req.user.subProjects.map((project: $TSFixMe) => project._id)
                : null;
            const query: $TSFixMe = type
                ? { _id: componentId, projectId: { $in: subProjectIds }, type }
                : { _id: componentId, projectId: { $in: subProjectIds } };

            const populateComponent: $TSFixMe = [
                { path: 'projectId', select: 'name' },
                { path: 'componentCategoryId', select: 'name' },
            ];

            const selectComponent: $TSFixMe =
                '_id createdAt name createdById projectId slug componentCategoryId';
            const component: $TSFixMe = await ComponentService.findOneBy({
                query,
                select: selectComponent,
                populate: populateComponent,
            });
            return sendItemResponse(req, res, component);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// fetch component summary in date range
router.post(
    '/:projectId/summary/:componentId',
    getUser,
    isAuthorized,
    getSubProjects,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { startDate, endDate }: $TSFixMe = req.body;
            const componentId: $TSFixMe = req.params.componentId;

            const subProjectIds: $TSFixMe = req.user.subProjects
                ? req.user.subProjects.map((project: $TSFixMe) => project._id)
                : null;

            // Check that component exists
            const componentCount: $TSFixMe = await ComponentService.countBy({
                _id: componentId,
                projectId: { $in: subProjectIds },
            });
            if (!componentCount || componentCount === 0) {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Component not Found',
                });
            }

            // fetch monitors
            const select: string = '_id name';
            let monitors = await MonitorService.findBy({
                query: { componentId: componentId },
                select,
            });

            if (monitors && monitors.length) {
                monitors = await Promise.all(
                    monitors.map(async (monitor: $TSFixMe) => {
                        const stat: $TSFixMe = {
                            _id: monitor._id,
                            name: monitor.name,
                            monitorUptime: 100,
                        };

                        const monitorStatus: $TSFixMe =
                            await MonitorService.getMonitorStatuses(
                                monitor._id,
                                startDate,
                                endDate
                            );

                        if (monitorStatus && monitorStatus.length) {
                            const uptimePercents: $TSFixMe = await Promise.all(
                                monitorStatus.map(async probe => {
                                    const { uptimePercent }: $TSFixMe =
                                        await MonitorService.calculateTime(
                                            probe.statuses,
                                            startDate,
                                            moment(endDate).diff(
                                                moment(startDate),
                                                'days'
                                            )
                                        );

                                    return uptimePercent;
                                })
                            );

                            const monitorUptime: $TSFixMe =
                                uptimePercents.reduce(
                                    (a, b) =>
                                        parseFloat(a || 100) +
                                        parseFloat(b || 100)
                                ) / uptimePercents.length;

                            return {
                                ...stat,
                                monitorUptime: parseFloat(
                                    monitorUptime.toFixed(3)
                                ),
                            };
                        }

                        return stat;
                    })
                );

                // return response
                return sendListResponse(req, res, monitors);
            } else {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Monitors not Found',
                });
            }
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// fetch latest stats related to a particular component
router.get(
    '/:projectId/resources/:componentId',
    getUser,
    isAuthorized,
    getSubProjects,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const componentId: $TSFixMe = req.params.componentId;
            const type: $TSFixMe = req.query.type;

            const subProjectIds: $TSFixMe = req.user.subProjects
                ? req.user.subProjects.map((project: $TSFixMe) => project._id)
                : null;

            const query: $TSFixMe = type
                ? { _id: componentId, projectId: { $in: subProjectIds }, type }
                : { _id: componentId, projectId: { $in: subProjectIds } };

            // Get that component
            const populateComponent: $TSFixMe = [
                { path: 'projectId', select: 'name' },
                { path: 'componentCategoryId', select: 'name' },
            ];

            const selectComponent: $TSFixMe =
                '_id createdAt name createdById projectId slug componentCategoryId';
            const component: $TSFixMe = await ComponentService.findOneBy({
                query,
                select: selectComponent,
                populate: populateComponent,
            });
            if (!component) {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Component not Found',
                });
            }
            const totalResources: $TSFixMe = [];
            const limit: $TSFixMe = 1000;
            const skip: $TSFixMe = req.query['skip'] || 0;

            const populateApplicationSecurity: $TSFixMe = [
                {
                    path: 'componentId',
                    select: '_id slug name slug',
                },

                { path: 'resourceCategory', select: 'name' },
                {
                    path: 'gitCredential',
                    select: 'gitUsername gitPassword iv projectId deleted',
                },
            ];

            const selectApplicationSecurity: $TSFixMe =
                '_id name slug gitRepositoryUrl gitCredential componentId resourceCategory lastScan scanned scanning deleted';

            const selectContainerLog: $TSFixMe =
                'securityId componentId data deleted deleteAt';

            const populateContainerLog: $TSFixMe = [
                { path: 'securityId', select: 'name slug' },
                { path: 'componentId', select: 'name slug' },
            ];
            const [
                monitors,
                containerSecurity,
                applicationSecurity,
                applicationLogObj,
                errorTrackerObj,
                performanceTrackers,
            ] = await Promise.all([
                MonitorService.findBy({
                    query: { componentId: componentId },
                    limit,
                    skip,
                    select: '_id name slug type createdAt',
                }),
                ContainerSecurityService.findBy({
                    query: { componentId: componentId },
                    limit,
                    skip,
                    select: '_id name createdAt slug',
                }),
                ApplicationSecurityService.findBy({
                    query: { componentId: componentId },
                    limit,
                    skip,
                    select: selectApplicationSecurity,
                    populate: populateApplicationSecurity,
                }),
                ApplicationLogService.getApplicationLogsByComponentId(
                    componentId,
                    limit,
                    skip
                ),
                ErrorTrackerService.getErrorTrackersByComponentId(
                    componentId,
                    limit,
                    skip
                ),
                PerformanceTrackerService.getPerformanceTrackerByComponentId(
                    componentId,
                    limit,
                    skip
                ),
            ]);

            monitors.map((elem: $TSFixMe) => {
                const newElement: $TSFixMe = {
                    _id: elem._id,
                    name: elem.name,
                    type: `${
                        elem.type === 'server-monitor'
                            ? 'server monitor'
                            : elem.type === 'url'
                            ? 'website monitor'
                            : elem.type === 'ip'
                            ? 'IP monitor'
                            : elem.type + ` monitor`
                    }`,
                    createdAt: elem.createdAt,
                    icon: 'monitor',
                    slug: elem.slug,
                    component,
                };
                // add it to the total resources
                totalResources.push(newElement);
                return newElement;
            });

            await Promise.all(
                containerSecurity.map(async (elem: $TSFixMe) => {
                    const securityLog: $TSFixMe =
                        await ContainerSecurityLogService.findOneBy({
                            query: {
                                securityId: elem._id,
                                componentId,
                            },
                            select: selectContainerLog,
                            populate: populateContainerLog,
                        });
                    const newElement: $TSFixMe = {
                        _id: elem._id,
                        name: elem.name,
                        type: 'container security',
                        createdAt: elem.createdAt,
                        icon: 'docker',
                        securityLog,
                        slug: elem.slug,
                    };
                    // add it to the total resources
                    totalResources.push(newElement);
                    return newElement;
                })
            );

            await Promise.all(
                applicationSecurity.map(async (elem: $TSFixMe) => {
                    // get the security log

                    const populateApplicationSecurityLog: $TSFixMe = [
                        {
                            path: 'componentId',
                            select: '_id slug name slug',
                        },
                        {
                            path: 'securityId',
                            select: '_id slug name slug gitRepositoryUrl gitCredential componentId resourceCategory deleted deletedAt lastScan scanned scanning',
                        },
                    ];

                    const selectApplicationSecurityLog: $TSFixMe =
                        '_id securityId componentId data';
                    const securityLog: $TSFixMe =
                        await ApplicationSecurityLogService.findOneBy({
                            query: {
                                securityId: elem._id,
                                componentId,
                            },
                            select: selectApplicationSecurityLog,
                            populate: populateApplicationSecurityLog,
                        });
                    const newElement: $TSFixMe = {
                        _id: elem._id,
                        name: elem.name,
                        type: 'application security',
                        createdAt: elem.createdAt,
                        icon: 'security',
                        securityLog,
                        slug: elem.slug,
                    };
                    // add it to the total resources
                    totalResources.push(newElement);
                    return newElement;
                })
            );

            await Promise.all(
                applicationLogObj.applicationLogs.map(
                    async (elem: $TSFixMe) => {
                        let logStatus = 'No logs yet';
                        // confirm if the application log has started collecting logs or not
                        const logs: $TSFixMe = await LogService.getLogsByApplicationLogId(
                            elem._id,
                            1,
                            0
                        );
                        if (logs.length > 0) {
                            logStatus = 'Collecting Logs';
                        }
                        const newElement: $TSFixMe = {
                            _id: elem._id,
                            name: elem.name,
                            type: 'log container',
                            createdAt: elem.createdAt,
                            icon: 'appLog',
                            status: logStatus,
                            slug: elem.slug,
                            component,
                        };
                        // add it to the total resources
                        totalResources.push(newElement);
                        return newElement;
                    }
                )
            );

            await Promise.all(
                errorTrackerObj.errorTrackers.map(
                    async (errorTracker: $TSFixMe) => {
                        let errorStatus = 'No Errors yet';

                        const populateIssue: $TSFixMe = [
                            { path: 'errorTrackerId', select: 'name' },
                            { path: 'resolvedById', select: 'name' },
                            { path: 'ignoredById', select: 'name' },
                        ];

                        const selectIssue: $TSFixMe =
                            'name description errorTrackerId type fingerprint fingerprintHash createdAt deleted deletedAt deletedById resolved resolvedAt resolvedById ignored ignoredAt ignoredById';

                        const issues: $TSFixMe = await IssueService.findBy({
                            query: { errorTrackerId: errorTracker._id },
                            limit: 1,
                            skip: 0,
                            select: selectIssue,
                            populate: populateIssue,
                        });
                        if (issues.length > 0) {
                            errorStatus = 'Listening for Errors';
                        }
                        const newElement: $TSFixMe = {
                            _id: errorTracker._id,
                            name: errorTracker.name,
                            type: 'error tracker',
                            createdAt: errorTracker.createdAt,
                            icon: 'errorTracking',
                            status: errorStatus,
                            slug: errorTracker.slug,
                        };
                        // add it to the total resources
                        totalResources.push(newElement);
                        return newElement;
                    }
                )
            );

            await Promise.all(
                performanceTrackers.map(
                    async (performanceTracker: $TSFixMe) => {
                        let trackerStatus = 'Not monitoring performance';
                        const metrics: $TSFixMe =
                            await PerformanceTrackerMetricService.findBy({
                                query: {
                                    performanceTrackerId:
                                        performanceTracker._id,
                                },
                                limit: 1,
                                skip: 0,
                                select: '_id',
                            });
                        if (metrics.length > 0) {
                            trackerStatus = 'Monitoring performance';
                        }
                        const newElement: $TSFixMe = {
                            _id: performanceTracker._id,
                            name: performanceTracker.name,
                            type: 'performance tracker',
                            createdAt: performanceTracker.createdAt,
                            icon: 'monitor',
                            status: trackerStatus,
                            slug: performanceTracker.slug,
                        };
                        // add it to the total resources
                        totalResources.push(newElement);
                        return newElement;
                    }
                )
            );

            // return response
            return sendItemResponse(req, res, {
                totalResources,
                skip,
                componentId,
            });
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);
// get all error trackers issues related to a project
router.get(
    '/:projectId/issues',
    getUser,
    isAuthorized,
    getSubProjects,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const subProjectIds: $TSFixMe = req.user.subProjects
                ? req.user.subProjects.map((project: $TSFixMe) => project._id)
                : null;

            // Call the ComponentService.
            const components: $TSFixMe =
                await ComponentService.getComponentsBySubprojects(
                    subProjectIds,
                    req.query['limit'] || 0,
                    req.query['skip'] || 0
                );
            let allComponents: $TSFixMe = [];

            components.map(component => {
                allComponents = [...allComponents, ...component.components];
                return component;
            });

            let errorTrackers: $TSFixMe = [];
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
            await Promise.all(
                allComponents.map(async component => {
                    const componentErrorTrackers: $TSFixMe =
                        await ErrorTrackerService.findBy({
                            query: {
                                componentId: component._id,
                            },
                            select,
                            populate,
                        });
                    errorTrackers = [
                        ...errorTrackers,
                        ...componentErrorTrackers,
                    ];
                    return component;
                })
            );

            // return response
            return sendItemResponse(req, res, {
                errorTrackers,
            });
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.delete(
    '/:projectId/:componentId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const { componentId, projectId }: $TSFixMe = req.params;
        try {
            await ComponentService.deleteBy(
                {
                    componentId: componentId,
                    projectId: projectId,
                },

                req.user.id
            );
            const component: $TSFixMe = await ComponentService.deleteBy(
                {
                    _id: componentId,
                    projectId: projectId,
                },

                req.user.id
            );
            if (component) {
                return sendItemResponse(req, res, component);
            } else {
                return sendErrorResponse(req, res, {
                    message: 'Component not found',
                });
            }
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
