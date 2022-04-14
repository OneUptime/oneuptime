import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
import ApplicationLogService from '../services/applicationLogService';
import UserService from '../services/userService';
import ComponentService from '../services/componentService';
import RealTimeService from '../services/realTimeService';
import LogService from '../services/logService';
import ErrorService from 'CommonServer/Utils/error';
import NotificationService from '../services/notificationService';
import BadDataException from 'Common/Types/Exception/BadDataException';

const router: $TSFixMe = express.getRouter();
const getUser: $TSFixMe = require('../middlewares/user').getUser;
const isApplicationLogValid: $TSFixMe =
    require('../middlewares/applicationLog').isApplicationLogValid;

import { isAuthorized } from '../middlewares/authorization';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import { sendListResponse } from 'CommonServer/Utils/response';
const isUserAdmin: $TSFixMe = require('../middlewares/project').isUserAdmin;
import ResourceCategoryService from '../services/resourceCategoryService';

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
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const data: $TSFixMe = req.body;
            const componentId: $TSFixMe = req.params.componentId;
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

            const populateComponent: $TSFixMe = [
                { path: 'projectId', select: '_id' },
            ];
            const selectComponent: string = 'projectId ';

            const [applicationLog, component, user]: $TSFixMe =
                await Promise.all([
                    ApplicationLogService.create(data),
                    ComponentService.findOneBy({
                        query: { _id: componentId },
                        select: selectComponent,
                        populate: populateComponent,
                    }),
                    UserService.findOneBy({
                        query: { _id: req.user.id },
                        select: 'name _id',
                    }),
                ]);

            try {
                NotificationService.create(
                    component.projectId._id,

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
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Description: Get all Application Logs by componentId.
router.get(
    '/:projectId/:componentId',
    getUser,
    isAuthorized,
    async (req, res): void => {
        try {
            const componentId: $TSFixMe = req.params.componentId;
            if (!componentId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: "Component ID can't be null",
                });
            }

            const { skip, limit }: $TSFixMe = req.query;
            const applicationLogs: $TSFixMe =
                await ApplicationLogService.getApplicationLogsByComponentId(
                    componentId,
                    limit,
                    skip
                );
            return sendItemResponse(req, res, applicationLogs);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Description: Delete an Application Log by applicationLogId and componentId.
router.delete(
    '/:projectId/:componentId/:applicationLogId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const { applicationLogId, componentId }: $TSFixMe = req.params;
        try {
            const applicationLog: $TSFixMe =
                await ApplicationLogService.deleteBy(
                    {
                        _id: applicationLogId,
                        componentId: componentId,
                    },

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
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/:applicationLogId/log',
    isApplicationLogValid,
    async (req, res): void => {
        try {
            const data: $TSFixMe = req.body;
            const applicationLogId: $TSFixMe = req.params.applicationLogId;

            if (data.tags) {
                if (
                    !(typeof data.tags === 'string' || Array.isArray(data.tags))
                ) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message:
                            'Application Log Tags must be of type String or Array of Strings',
                    });
                }
            }
            data.applicationLogId = applicationLogId;

            const log: $TSFixMe = await LogService.create(data);

            RealTimeService.sendLogCreated(log);

            return sendItemResponse(req, res, log);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);
// Description: Get all Logs by applicationLogId.
router.post(
    '/:projectId/:componentId/:applicationLogId/logs',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { skip, limit, startDate, endDate, type, filter }: $TSFixMe =
                req.body;
            const applicationLogId: $TSFixMe = req.params.applicationLogId;

            const currentApplicationCount: $TSFixMe =
                await ApplicationLogService.countBy({
                    _id: applicationLogId,
                });
            if (currentApplicationCount === 0) {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Application Log not found',
                });
            }

            const query: $TSFixMe = {};

            if (applicationLogId) {
                query.applicationLogId = applicationLogId;
            }

            if (type) {
                query.type = type;
            }

            if (startDate && endDate) {
                query.createdAt = { $gte: startDate, $lte: endDate };
            }

            if (filter) {
                query.stringifiedContent = {
                    $regex: new RegExp(filter),
                    $options: 'i',
                };
            }

            const selectLog: $TSFixMe =
                'applicationLogId content stringifiedContent type tags createdById createdAt';

            const populateLog: $TSFixMe = [
                { path: 'applicationLogId', select: 'name' },
            ];

            const [logs, count, dateRange]: $TSFixMe = await Promise.all([
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
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);
// Description: Get all Logs stat by applicationLogId.
router.post(
    '/:projectId/:componentId/:applicationLogId/stats',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const applicationLogId: $TSFixMe = req.params.applicationLogId;

            const currentApplicationCount: $TSFixMe =
                await ApplicationLogService.countBy({
                    _id: applicationLogId,
                });
            if (currentApplicationCount === 0) {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Application Log not found',
                });
            }

            const query: $TSFixMe = {};

            if (applicationLogId) {
                query.applicationLogId = applicationLogId;
            }

            const stat: $TSFixMe = {};

            const [allCount, errorCount, infoCount, warningCount]: $TSFixMe =
                await Promise.all([
                    LogService.countBy({ ...query }),
                    LogService.countBy({ ...query, type: 'error' }),
                    LogService.countBy({ ...query, type: 'info' }),
                    LogService.countBy({ ...query, type: 'warning' }),
                ]);

            stat.all = allCount;

            stat.error = errorCount;

            stat.info = infoCount;

            stat.warning = warningCount;

            return sendListResponse(req, res, stat);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Description: Reset Application Log Key by applicationLogId.
router.post(
    '/:projectId/:componentId/:applicationLogId/reset-key',
    getUser,
    isAuthorized,
    isUserAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const applicationLogId: $TSFixMe = req.params.applicationLogId;

        const currentApplicationCount: $TSFixMe =
            await ApplicationLogService.countBy({
                _id: applicationLogId,
            });

        if (currentApplicationCount === 0) {
            return sendErrorResponse(req, res, {
                code: 404,
                message: 'Application Log not found',
            });
        }

        // application Log is valid
        const data: $TSFixMe = {
            key: uuid.v4(), // set new app log key
        };

        try {
            const applicationLog: $TSFixMe =
                await ApplicationLogService.updateOneBy(
                    { _id: applicationLogId },
                    data
                );
            return sendItemResponse(req, res, applicationLog);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Description: Update Application Log by applicationLogId.
router.put(
    '/:projectId/:componentId/:applicationLogId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const { applicationLogId, componentId }: $TSFixMe = req.params;

        const data: $TSFixMe = req.body;
        if (!data) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: "values can't be null",
            });
        }

        data.createdById = req.user ? req.user.id : null;

        if (!data.name && data.showQuickStart === undefined) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('New Application Log Name is required.')
            );
        }

        const currentApplicationLog: $TSFixMe =
            await ApplicationLogService.findOneBy({
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
        const existingQuery: $TSFixMe = {
            name: data.name,
            componentId: componentId,
        };

        if (data.resourceCategory != '') {
            existingQuery.resourceCategory = data.resourceCategory;
        }
        const existingApplicationCount: $TSFixMe =
            await ApplicationLogService.countBy(existingQuery);

        if (
            existingApplicationCount > 0 &&
            data.resourceCategory != '' &&
            data.showQuickStart === undefined
        ) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException(
                    'Application Log with that name already exists.'
                )
            );
        }

        // application Log is valid
        const applicationLogUpdate: $TSFixMe = {};
        if (data.name) {
            applicationLogUpdate.name = data.name;
        }
        if (data.showQuickStart !== undefined) {
            applicationLogUpdate.showQuickStart = data.showQuickStart;
        }

        let unsetData: $TSFixMe;
        if (!data.resourceCategory || data.resourceCategory === '') {
            unsetData = { resourceCategory: '' };
        } else {
            const resourceCategoryCount: $TSFixMe =
                await ResourceCategoryService.countBy({
                    _id: data.resourceCategory,
                });
            if (resourceCategoryCount && resourceCategoryCount > 0) {
                applicationLogUpdate.resourceCategory = data.resourceCategory;
            } else {
                unsetData = { resourceCategory: '' };
            }
        }

        try {
            const applicationLog: $TSFixMe =
                await ApplicationLogService.updateOneBy(
                    { _id: currentApplicationLog._id },
                    applicationLogUpdate,

                    unsetData
                );
            return sendItemResponse(req, res, applicationLog);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/:projectId/:componentId/:applicationLogId/search',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const { applicationLogId }: $TSFixMe = req.params;
        const startTime: $TSFixMe = new Date();
        const { duration, filter, range }: $TSFixMe = req.body;
        const endTime: $TSFixMe = new Date(
            startTime.getTime() + duration * 60000
        );
        let response: $TSFixMe;
        if (filter) {
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
            const { log_from, log_to }: $TSFixMe = range;
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
