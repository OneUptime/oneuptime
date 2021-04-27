/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const UserService = require('../services/userService');
const ComponentService = require('../services/componentService');
const NotificationService = require('../services/notificationService');
const RealTimeService = require('../services/realTimeService');
const ApplicationLogService = require('../services/applicationLogService');
const MonitorService = require('../services/monitorService');
const ApplicationSecurityService = require('../services/applicationSecurityService');
const ContainerSecurityService = require('../services/containerSecurityService');
const LogService = require('../services/logService');
const ApplicationSecurityLogService = require('../services/applicationSecurityLogService');
const ContainerSecurityLogService = require('../services/containerSecurityLogService');
const ErrorTrackerService = require('../services/errorTrackerService');
const IssueService = require('../services/issueService');

const router = express.Router();
const isUserAdmin = require('../middlewares/project').isUserAdmin;
const getUser = require('../middlewares/user').getUser;
const getSubProjects = require('../middlewares/subProject').getSubProjects;

const { isAuthorized } = require('../middlewares/authorization');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const moment = require('moment');

// Route
// Description: Adding / Updating a new component to the project.
// Params:
// Param 1: req.params-> {projectId}; req.body -> {[_id], name, type, data, visibleOnStatusPage} <- Check ComponentMoal for description.
// Returns: response status, error message
router.post('/:projectId', getUser, isAuthorized, isUserAdmin, async function(
    req,
    res
) {
    try {
        const data = req.body;
        const projectId = req.params.projectId;
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

        const component = await ComponentService.create(data);
        const user = await UserService.findOneBy({ _id: req.user.id });

        await NotificationService.create(
            component.projectId._id,
            `A New Component was Created with name ${component.name} by ${user.name}`,
            user._id,
            'componentaddremove'
        );
        await RealTimeService.sendComponentCreated(component);
        return sendItemResponse(req, res, component);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put(
    '/:projectId/:componentId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async function(req, res) {
        try {
            const data = req.body;
            let unsetData;
            if (!data.componentCategoryId || data.componentCategoryId === '') {
                unsetData = { componentCategoryId: '' };
            }
            const component = await ComponentService.updateOneBy(
                { _id: req.params.componentId },
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
            return sendErrorResponse(req, res, error);
        }
    }
);

// Route
// Description: Get all Components by projectId.
router.get('/:projectId', getUser, isAuthorized, getSubProjects, async function(
    req,
    res
) {
    try {
        const subProjectIds = req.user.subProjects
            ? req.user.subProjects.map(project => project._id)
            : null;
        // Call the ComponentService.
        const components = await ComponentService.getComponentsBySubprojects(
            subProjectIds,
            req.query.limit || 0,
            req.query.skip || 0
        );
        return sendItemResponse(req, res, components);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/slug/:slug', getUser, isAuthorized, async function(req, res) {
    try {
        const { slug } = req.params;
        const component = await ComponentService.findOneBy({
            slug,
        });

        return sendItemResponse(req, res, component);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get(
    '/:projectId/component',
    getUser,
    isAuthorized,
    getSubProjects,
    async function(req, res) {
        try {
            const type = req.query.type;
            const subProjectIds = req.user.subProjects
                ? req.user.subProjects.map(project => project._id)
                : null;
            const query = type
                ? { projectId: { $in: subProjectIds }, type }
                : { projectId: { $in: subProjectIds } };

            const components = await ComponentService.findBy(
                query,
                req.query.limit || 10,
                req.query.skip || 0
            );
            const count = await ComponentService.countBy({
                projectId: { $in: subProjectIds },
            });
            return sendListResponse(req, res, components, count);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.get(
    '/:projectId/component/:componentId',
    getUser,
    isAuthorized,
    getSubProjects,
    async function(req, res) {
        try {
            const componentId = req.params.componentId;
            const type = req.query.type;
            const subProjectIds = req.user.subProjects
                ? req.user.subProjects.map(project => project._id)
                : null;
            const query = type
                ? { _id: componentId, projectId: { $in: subProjectIds }, type }
                : { _id: componentId, projectId: { $in: subProjectIds } };

            const component = await ComponentService.findOneBy(query);
            return sendItemResponse(req, res, component);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// fetch component summary in date range
router.post(
    '/:projectId/summary/:componentId',
    getUser,
    isAuthorized,
    getSubProjects,
    async function(req, res) {
        try {
            const { startDate, endDate } = req.body;
            const componentId = req.params.componentId;
            const subProjectIds = req.user.subProjects
                ? req.user.subProjects.map(project => project._id)
                : null;

            // Get that component
            const component = await ComponentService.findOneBy({
                _id: componentId,
                projectId: { $in: subProjectIds },
            });
            if (!component) {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Component not Found',
                });
            }

            // fetch monitors
            let monitors = await MonitorService.findBy({
                componentId: componentId,
            });

            if (monitors && monitors.length) {
                monitors = await Promise.all(
                    monitors.map(async monitor => {
                        const stat = {
                            _id: monitor._id,
                            name: monitor.name,
                            monitorUptime: 100,
                        };

                        const monitorStatus = await MonitorService.getMonitorStatuses(
                            monitor._id,
                            startDate,
                            endDate
                        );

                        if (monitorStatus && monitorStatus.length) {
                            const uptimePercents = await Promise.all(
                                monitorStatus.map(async probe => {
                                    const {
                                        uptimePercent,
                                    } = await MonitorService.calculateTime(
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

                            const monitorUptime =
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
            return sendErrorResponse(req, res, error);
        }
    }
);

// fetch latest stats related to a particular component
router.get(
    '/:projectId/resources/:componentId',
    getUser,
    isAuthorized,
    getSubProjects,
    async function(req, res) {
        try {
            const componentId = req.params.componentId;
            const type = req.query.type;
            const subProjectIds = req.user.subProjects
                ? req.user.subProjects.map(project => project._id)
                : null;

            const query = type
                ? { _id: componentId, projectId: { $in: subProjectIds }, type }
                : { _id: componentId, projectId: { $in: subProjectIds } };

            // Get that component
            const component = await ComponentService.findOneBy(query);
            if (!component) {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Component not Found',
                });
            }
            const totalResources = [];
            const limit = 1000;
            const skip = req.query.skip || 0;

            // fetch monitors
            const monitors = await MonitorService.findBy(
                { componentId: componentId },
                limit,
                skip
            );
            monitors.map(elem => {
                const newElement = {
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

            // fetch container security
            const containerSecurity = await ContainerSecurityService.findBy(
                { componentId: componentId },
                limit,
                skip
            );
            await Promise.all(
                containerSecurity.map(async elem => {
                    const securityLog = await ContainerSecurityLogService.findOneBy(
                        {
                            securityId: elem._id,
                            componentId,
                        }
                    );
                    const newElement = {
                        _id: elem._id,
                        name: elem.name,
                        type: 'container security',
                        createdAt: elem.createdAt,
                        icon: 'docker',
                        securityLog,
                        slug: elem.slug,
                        component,
                    };
                    // add it to the total resources
                    totalResources.push(newElement);
                    return newElement;
                })
            );

            // fetch application security
            const applicationSecurity = await ApplicationSecurityService.findBy(
                { componentId: componentId },
                limit,
                skip
            );
            await Promise.all(
                applicationSecurity.map(async elem => {
                    // get the security log
                    const securityLog = await ApplicationSecurityLogService.findOneBy(
                        {
                            securityId: elem._id,
                            componentId,
                        }
                    );
                    const newElement = {
                        _id: elem._id,
                        name: elem.name,
                        type: 'application security',
                        createdAt: elem.createdAt,
                        icon: 'security',
                        securityLog,
                        slug: elem.slug,
                        component,
                    };
                    // add it to the total resources
                    totalResources.push(newElement);
                    return newElement;
                })
            );

            // fetch application logs
            const applicationLogs = await ApplicationLogService.getApplicationLogsByComponentId(
                componentId,
                limit,
                skip
            );

            await Promise.all(
                applicationLogs.map(async elem => {
                    let logStatus = 'No logs yet';
                    // confirm if the application log has started collecting logs or not
                    const logs = await LogService.getLogsByApplicationLogId(
                        elem._id,
                        1,
                        0
                    );
                    if (logs.length > 0) logStatus = 'Collecting Logs';
                    const newElement = {
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
                })
            );

            // fetch error trackers
            const errorTrackers = await ErrorTrackerService.getErrorTrackersByComponentId(
                componentId,
                limit,
                skip
            );

            await Promise.all(
                errorTrackers.map(async errorTracker => {
                    let errorStatus = 'No Errors yet';
                    const issues = await IssueService.findBy(
                        { errorTrackerId: errorTracker._id },
                        1,
                        0
                    );
                    if (issues.length > 0) errorStatus = 'Listening for Errors';
                    const newElement = {
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
                })
            );
            // return response
            return sendItemResponse(req, res, {
                totalResources,
                skip,
                componentId,
            });
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);
// get all error trackers issues related to a project
router.get(
    '/:projectId/issues',
    getUser,
    isAuthorized,
    getSubProjects,
    async function(req, res) {
        try {
            const subProjectIds = req.user.subProjects
                ? req.user.subProjects.map(project => project._id)
                : null;

            // Call the ComponentService.
            const components = await ComponentService.getComponentsBySubprojects(
                subProjectIds,
                req.query.limit || 0,
                req.query.skip || 0
            );
            let allComponents = [];

            components.map(component => {
                allComponents = [...allComponents, ...component.components];
                return component;
            });

            let errorTrackers = [];
            await Promise.all(
                allComponents.map(async component => {
                    const componentErrorTrackers = await ErrorTrackerService.findBy(
                        {
                            componentId: component._id,
                        }
                    );
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
            return sendErrorResponse(req, res, error);
        }
    }
);
router.post('/search/:projectId', getUser, async function(req, res) {
    try {
        const filter = req.body.search;
        const { projectId } = req.params;
        const components = await ComponentService.findBy({
            projectId: projectId,
            deleted: { $ne: null },
            $or: [{ name: { $regex: new RegExp(filter), $options: 'i' } }],
        });

        return sendListResponse(req, res, components);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.delete(
    '/:projectId/:componentId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async function(req, res) {
        try {
            await ComponentService.deleteBy(
                {
                    componentId: req.params.componentId,
                    projectId: req.params.projectId,
                },
                req.user.id
            );
            const component = await ComponentService.deleteBy(
                {
                    _id: req.params.componentId,
                    projectId: req.params.projectId,
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
            return sendErrorResponse(req, res, error);
        }
    }
);

module.exports = router;
