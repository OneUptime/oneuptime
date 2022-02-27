import express from 'express';
import ApplicationLogService from '../services/applicationLogService';
import UserService from '../services/userService';
import ComponentService from '../services/componentService';
import RealTimeService from '../services/realTimeService';
import LogService from '../services/logService';
import ErrorService from 'common-server/utils/error';
import NotificationService from '../services/notificationService';

const router = express.Router();
const getUser = require('../middlewares/user').getUser;
const isApplicationLogValid = require('../middlewares/applicationLog')
    .isApplicationLogValid;

// @ts-expect-error ts-migrate(2614) FIXME: Module '"../middlewares/authorization"' has no exp... Remove this comment to see the full error message
import { isAuthorized } from '../middlewares/authorization';
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const isUserAdmin = require('../middlewares/project').isUserAdmin;
import ResourceCategoryService from '../services/resourceCategoryService';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import uuid from 'uuid';

// Route
// Description: Adding a new application log to a component.
// Params:
// Param 1: req.params-> {componentId}; req.body -> {[_id], name}
// Returns: response status, error message
router.post(
    '/:projectId/:componentId/create',
    getUser,
    isAuthorized,
    isUserAdmin,
    async function(req, res) {
        try {
            const data = req.body;
            const componentId = req.params.componentId;
            if (!data) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: "values can't be null",
                });
            }
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
            data.createdById = req.user ? req.user.id : null;
            if (!data.name) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Application Log Name is required.',
                });
            }
            if (
                data.resourceCategory &&
                typeof data.resourceCategory !== 'string'
            ) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Resource Category ID is not of string type.',
                });
            }

            data.componentId = componentId;

            const populateComponent = [{ path: 'projectId', select: '_id' }];
            const selectComponent = 'projectId ';

            const [applicationLog, component, user] = await Promise.all([
                ApplicationLogService.create(data),
                ComponentService.findOneBy({
                    query: { _id: componentId },
                    select: selectComponent,
                    populate: populateComponent,
                }),
                UserService.findOneBy({
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
                    query: { _id: req.user.id },
                    select: 'name _id',
                }),
            ]);

            try {
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 4.
                NotificationService.create(
                    component.projectId._id,
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type 'Document<a... Remove this comment to see the full error message
                    `A New Application Log was Created with name ${applicationLog.name} by ${user.name}`,
                    user._id,
                    'applicationlogaddremove'
                );
                // run in the background
                RealTimeService.sendApplicationLogCreated(applicationLog);
            } catch (error) {
                ErrorService.log(
                    'realtimeService.sendApplicationLogCreated',
                    error
                );
            }
            return sendItemResponse(req, res, applicationLog);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Description: Get all Application Logs by componentId.
router.get('/:projectId/:componentId', getUser, isAuthorized, async function(
    req,
    res
) {
    try {
        const componentId = req.params.componentId;
        if (!componentId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: "Component ID can't be null",
            });
        }

        const { skip, limit } = req.query;
        const applicationLogs = await ApplicationLogService.getApplicationLogsByComponentId(
            componentId,
            limit,
            skip
        );
        return sendItemResponse(req, res, applicationLogs);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Description: Delete an Application Log by applicationLogId and componentId.
router.delete(
    '/:projectId/:componentId/:applicationLogId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async function(req, res) {
        const { applicationLogId, componentId } = req.params;
        try {
            const applicationLog = await ApplicationLogService.deleteBy(
                {
                    _id: applicationLogId,
                    componentId: componentId,
                },
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
                req.user.id
            );
            if (applicationLog) {
                return sendItemResponse(req, res, applicationLog);
            } else {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Application Log not found',
                });
            }
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.post('/:applicationLogId/log', isApplicationLogValid, async function(
    req,
    res
) {
    try {
        const data = req.body;
        const applicationLogId = req.params.applicationLogId;

        if (data.tags) {
            if (!(typeof data.tags === 'string' || Array.isArray(data.tags))) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message:
                        'Application Log Tags must be of type String or Array of Strings',
                });
            }
        }
        data.applicationLogId = applicationLogId;

        const log = await LogService.create(data);

        try {
            RealTimeService.sendLogCreated(log);
        } catch (error) {
            ErrorService.log('realtimeService.sendLogCreated', error);
        }
        return sendItemResponse(req, res, log);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});
// Description: Get all Logs by applicationLogId.
router.post(
    '/:projectId/:componentId/:applicationLogId/logs',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const { skip, limit, startDate, endDate, type, filter } = req.body;
            const applicationLogId = req.params.applicationLogId;

            const currentApplicationCount = await ApplicationLogService.countBy(
                {
                    _id: applicationLogId,
                }
            );
            if (currentApplicationCount === 0) {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Application Log not found',
                });
            }

            const query = {};

            // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationLogId' does not exist on type... Remove this comment to see the full error message
            if (applicationLogId) query.applicationLogId = applicationLogId;

            // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type '{}'.
            if (type) query.type = type;

            if (startDate && endDate)
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'createdAt' does not exist on type '{}'.
                query.createdAt = { $gte: startDate, $lte: endDate };

            if (filter) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'stringifiedContent' does not exist on ty... Remove this comment to see the full error message
                query.stringifiedContent = {
                    $regex: new RegExp(filter),
                    $options: 'i',
                };
            }

            const selectLog =
                'applicationLogId content stringifiedContent type tags createdById createdAt';

            const populateLog = [{ path: 'applicationLogId', select: 'name' }];

            const [logs, count, dateRange] = await Promise.all([
                LogService.findBy({
                    query,
                    limit: limit || 10,
                    skip: skip || 0,
                    populate: populateLog,
                    select: selectLog,
                }),
                LogService.countBy(query),
                LogService.getDateRange(query),
            ]);
            return sendListResponse(req, res, { logs, dateRange }, count);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);
// Description: Get all Logs stat by applicationLogId.
router.post(
    '/:projectId/:componentId/:applicationLogId/stats',
    getUser,
    isAuthorized,
    async function(req, res) {
        try {
            const applicationLogId = req.params.applicationLogId;

            const currentApplicationCount = await ApplicationLogService.countBy(
                {
                    _id: applicationLogId,
                }
            );
            if (currentApplicationCount === 0) {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Application Log not found',
                });
            }

            const query = {};

            // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationLogId' does not exist on type... Remove this comment to see the full error message
            if (applicationLogId) query.applicationLogId = applicationLogId;

            const stat = {};

            const [
                allCount,
                errorCount,
                infoCount,
                warningCount,
            ] = await Promise.all([
                LogService.countBy({ ...query }),
                LogService.countBy({ ...query, type: 'error' }),
                LogService.countBy({ ...query, type: 'info' }),
                LogService.countBy({ ...query, type: 'warning' }),
            ]);
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'all' does not exist on type '{}'.
            stat.all = allCount;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'error' does not exist on type '{}'.
            stat.error = errorCount;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'info' does not exist on type '{}'.
            stat.info = infoCount;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'warning' does not exist on type '{}'.
            stat.warning = warningCount;

            return sendListResponse(req, res, stat);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Description: Reset Application Log Key by applicationLogId.
router.post(
    '/:projectId/:componentId/:applicationLogId/reset-key',
    getUser,
    isAuthorized,
    isUserAdmin,
    async function(req, res) {
        const applicationLogId = req.params.applicationLogId;

        const currentApplicationCount = await ApplicationLogService.countBy({
            _id: applicationLogId,
        });

        if (currentApplicationCount === 0) {
            return sendErrorResponse(req, res, {
                code: 404,
                message: 'Application Log not found',
            });
        }

        // application Log is valid
        const data = {
            key: uuid.v4(), // set new app log key
        };

        try {
            const applicationLog = await ApplicationLogService.updateOneBy(
                { _id: applicationLogId },
                data
            );
            return sendItemResponse(req, res, applicationLog);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Description: Update Application Log by applicationLogId.
router.put(
    '/:projectId/:componentId/:applicationLogId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async function(req, res) {
        const { applicationLogId, componentId } = req.params;

        const data = req.body;
        if (!data) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: "values can't be null",
            });
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
        data.createdById = req.user ? req.user.id : null;

        if (!data.name && data.showQuickStart === undefined) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'New Application Log Name is required.',
            });
        }

        const currentApplicationLog = await ApplicationLogService.findOneBy({
            query: { _id: applicationLogId },
            select: '_id', // Select should be a string and not array of strings
        });
        if (!currentApplicationLog) {
            return sendErrorResponse(req, res, {
                code: 404,
                message: 'Application Log not found',
            });
        }

        // try to find in the application log if the name already exist for that component
        const existingQuery = {
            name: data.name,
            componentId: componentId,
        };

        if (data.resourceCategory != '') {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resourceCategory' does not exist on type... Remove this comment to see the full error message
            existingQuery.resourceCategory = data.resourceCategory;
        }
        const existingApplicationCount = await ApplicationLogService.countBy(
            existingQuery
        );

        if (
            existingApplicationCount > 0 &&
            data.resourceCategory != '' &&
            data.showQuickStart === undefined
        ) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Application Log with that name already exists.',
            });
        }

        // application Log is valid
        const applicationLogUpdate = {};
        if (data.name) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type '{}'.
            applicationLogUpdate.name = data.name;
        }
        if (data.showQuickStart !== undefined) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'showQuickStart' does not exist on type '... Remove this comment to see the full error message
            applicationLogUpdate.showQuickStart = data.showQuickStart;
        }

        let unsetData;
        if (!data.resourceCategory || data.resourceCategory === '') {
            unsetData = { resourceCategory: '' };
        } else {
            const resourceCategoryCount = await ResourceCategoryService.countBy(
                {
                    _id: data.resourceCategory,
                }
            );
            if (resourceCategoryCount && resourceCategoryCount > 0) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'resourceCategory' does not exist on type... Remove this comment to see the full error message
                applicationLogUpdate.resourceCategory = data.resourceCategory;
            } else {
                unsetData = { resourceCategory: '' };
            }
        }

        try {
            const applicationLog = await ApplicationLogService.updateOneBy(
                { _id: currentApplicationLog._id },
                applicationLogUpdate,
                // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ resourceCategory: string; } | ... Remove this comment to see the full error message
                unsetData
            );
            return sendItemResponse(req, res, applicationLog);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.post(
    '/:projectId/:componentId/:applicationLogId/search',
    getUser,
    isAuthorized,
    async function(req, res) {
        const { applicationLogId } = req.params;
        const startTime = new Date();
        const { duration, filter, range } = req.body;
        const endTime = new Date(startTime.getTime() + duration * 60000);
        let response;
        if (filter) {
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 2.
            response = await LogService.search(
                { applicationLogId, deleted: false },
                filter
            );
        }
        if (duration) {
            response = await LogService.searchByDuration({
                applicationLogId,
                startTime,
                endTime,
            });
        }
        if (range) {
            const { log_from, log_to } = range;
            response = await LogService.searchByDuration({
                applicationLogId,
                startTime: new Date(log_to),
                endTime: new Date(log_from),
            });
        }
        return sendItemResponse(req, res, response);
    }
);

export default router;
