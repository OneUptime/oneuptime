import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
import BadDataException from 'Common/Types/Exception/BadDataException';
const router: $TSFixMe = express.getRouter();
const getUser: $TSFixMe = require('../middlewares/user').getUser;

import { isAuthorized } from '../middlewares/authorization';
const isUserAdmin: $TSFixMe = require('../middlewares/project').isUserAdmin;

import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import UserService from '../services/userService';
import ComponentService from '../services/componentService';
import NotificationService from '../services/notificationService';
import RealTimeService from '../services/realTimeService';
import ErrorTrackerService from '../services/errorTrackerService';
import ResourceCategoryService from '../services/resourceCategoryService';

import uuid from 'uuid';
const isErrorTrackerValid: $TSFixMe =
    require('../middlewares/errorTracker').isErrorTrackerValid;
import ErrorEventService from '../services/errorEventService';
import { sendListResponse } from 'CommonServer/Utils/response';
import IssueService from '../services/issueService';
import TeamService from '../services/teamService';
import IssueMemberService from '../services/issueMemberService';
import IssueTimelineService from '../services/issueTimelineService';
import ErrorService from 'CommonServer/Utils/error';
/*
 * Route
 * Description: Adding a new error tracker to a component.
 * Params:
 * Param 1: req.params-> {componentId}; req.body -> {[_id], name}
 * Returns: response status, error message
 */
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
                    message: 'Error Tracker Name is required.',
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
                { path: 'projectId', select: 'name' },
            ];
            const selectComponent: string = ' projectId ';
            const [errorTracker, component, user]: $TSFixMe = await Promise.all(
                [
                    ErrorTrackerService.create(data),
                    ComponentService.findOneBy({
                        query: { _id: componentId },
                        select: selectComponent,
                        populate: populateComponent,
                    }),
                    UserService.findOneBy({
                        query: { _id: req.user.id },
                        select: 'name _id',
                    }),
                ]
            );

            try {
                NotificationService.create(
                    component.projectId._id,

                    `A New Error Tracker was Created with name ${errorTracker.name} by ${user.name}`,
                    user._id,
                    'errortrackeraddremove'
                );
                // Run in the background
                RealTimeService.sendErrorTrackerCreated(errorTracker);
            } catch (error) {
                ErrorService.log(
                    'realtimeService.sendErrorTrackerCreated',
                    error
                );
            }
            return sendItemResponse(req, res, errorTracker);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Description: Get all Error Trackers by componentId.
router.get(
    '/:projectId/:componentId',
    getUser,
    isAuthorized,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const componentId: $TSFixMe = req.params.componentId;
            if (!componentId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: "Component ID can't be null",
                });
            }

            const { skip, limit }: $TSFixMe = req.query;
            const errorTrackers: $TSFixMe =
                await ErrorTrackerService.getErrorTrackersByComponentId(
                    componentId,
                    limit,
                    skip
                );
            return sendItemResponse(req, res, errorTrackers);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Description: Delete an Error Tracker by errorTrackerId and componentId.
router.delete(
    '/:projectId/:componentId/:errorTrackerId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const { errorTrackerId, componentId }: $TSFixMe = req.params;
        try {
            const errorTracker: $TSFixMe = await ErrorTrackerService.deleteBy(
                {
                    _id: errorTrackerId,
                    componentId: componentId,
                },

                req.user.id
            );
            if (errorTracker) {
                return sendItemResponse(req, res, errorTracker);
            }
            return sendErrorResponse(req, res, {
                code: 404,
                message: 'Error Tracker not found',
            });
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Description: Reset Error Tracker Key by errorTrackerId.
router.post(
    '/:projectId/:componentId/:errorTrackerId/reset-key',
    getUser,
    isAuthorized,
    isUserAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const errorTrackerId: $TSFixMe = req.params.errorTrackerId;
        const select: $TSFixMe =
            'componentId name slug key showQuickStart resourceCategory createdById createdAt';
        const populate: $TSFixMe = [
            { path: 'componentId', select: 'name' },
            { path: 'resourceCategory', select: 'name' },
        ];

        const currentErrorTracker: $TSFixMe =
            await ErrorTrackerService.findOneBy({
                query: { _id: errorTrackerId },
                select,
                populate,
            });
        if (!currentErrorTracker) {
            return sendErrorResponse(req, res, {
                code: 404,
                message: 'Error Tracker not found',
            });
        }

        // Error tracker is valid
        const data: $TSFixMe = {
            key: uuid.v4(), // Set new error tracker key
        };

        try {
            const errorTracker: $TSFixMe =
                await ErrorTrackerService.updateOneBy(
                    { _id: currentErrorTracker._id },
                    data
                );
            return sendItemResponse(req, res, errorTracker);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Description: Update Error Tracker by errorTrackerId.
router.put(
    '/:projectId/:componentId/:errorTrackerId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const { errorTrackerId, componentId }: $TSFixMe = req.params;

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
                new BadDataException('New Error Tracker Name is required.')
            );
        }
        const select: $TSFixMe =
            'componentId name slug key showQuickStart resourceCategory createdById createdAt';

        const currentErrorTracker: $TSFixMe =
            await ErrorTrackerService.findOneBy({
                query: { _id: errorTrackerId },
                select,
                populate: [
                    { path: 'componentId', select: 'name' },
                    { path: 'resourceCategory', select: 'name' },
                ],
            });
        if (!currentErrorTracker) {
            return sendErrorResponse(req, res, {
                code: 404,
                message: 'Error Tracker not found',
            });
        }

        // Try to find in the application log if the name already exist for that component
        const existingQuery: $TSFixMe = {
            name: data.name,
            componentId: componentId,
        };
        if (data.resourceCategory != '') {
            existingQuery.resourc!==egory = data.resourceCategory;
        }
        const existingErrorTracking: $TSFixMe =
            await ErrorTrackerService.findBy({
                query: existingQuery,
                select,
                populate: [
                    {
                        path: 'componentId',
                        select: 'name slug projectId',
                        populate: [{ path: 'projectId', select: 'name' }],
                    },
                    { path: 'resourceCategory', select: 'name' },
                ],
            });

        if (
            existingErrorTracking &&
            existingErrorTracking.length > 0 &&
            data.resourceCategory != '' &&
            data.showQuickStart =!==ndefined
        ) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException(
                    'Error Tracker with that name already exists.'
                )
            );
        }

        // Error Tracker is valid
        const errorTrackerUpdate: $TSFixMe = {};
        if (data.name) {
            errorTrackerUpdate.name = data.name;
        }
        if (data.showQuickStart !== undefined) {
            errorTrackerUpdate.showQuickStart = data.showQuickStart;
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
                errorTrackerUpdate.resourceCategory = data.resourceCategory;
            } else {
                unsetData = { resourceCategory: '' };
            }
        }

        try {
            const errorTracker: $TSFixMe =
                await ErrorTrackerService.updateOneBy(
                    { _id: currentErrorTracker._id },
                    errorTrackerUpdate,

                    unsetData
                );
            return sendItemResponse(req, res, errorTracker);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Description: send an error event to the server.
router.post(
    '/:errorTrackerId/track',
    isErrorTrackerValid,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const data: $TSFixMe = req.body;
            const errorTrackerId: $TSFixMe = req.params.errorTrackerId;
            data.errorTrackerId = errorTrackerId;

            // Try to fetch the particular issue with the fingerprint of the error event and the error tracker id
            let issue: $TSFixMe =
                await IssueService.findOneByHashAndErrorTracker(
                    data.fingerprint,
                    errorTrackerId
                );

            // If it doesnt exist, create the issue and use its details
            if (!issue) {
                issue = await IssueService.create(data);
            } else {
                // Issue exist but checked if it is resolved so to uresolve it
                if (issue.resolved) {
                    const updateData: $TSFixMe = {
                        resolved: false,
                        resolvedAt: '',
                        resolvedById: null,
                    };
                    const query: $TSFixMe = {
                        _id: issue._id,
                        errorTrackerId,
                    };
                    await IssueService.updateOneBy(query, updateData);
                }
            }
            // Since it now exist, use the issue details
            data.issueId = issue._id;
            data.fingerprintHash = issue.fingerprintHash;

            // Create the error event
            const errorEvent: $TSFixMe = await ErrorEventService.create(data);

            // Get the issue in the format that the fronnted will want for the real time update
            const errorTrackerIssue: $TSFixMe =
                await ErrorEventService.findDistinct(
                    { _id: data.issueId, errorTrackerId: data.errorTrackerId },
                    1,
                    0
                );

            issue = errorTrackerIssue.totalErrorEvents[0];

            try {
                // Run in the background
                RealTimeService.sendErrorEventCreated({ errorEvent, issue });
            } catch (error) {
                ErrorService.log(
                    'realtimeService.sendErrorEventCreated',
                    error
                );
            }
            return sendItemResponse(req, res, errorEvent);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Description: Get all error event grouped by hash by errorTrackerId.
router.post(
    '/:projectId/:componentId/:errorTrackerId/issues',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { skip, limit, startDate, endDate, filters }: $TSFixMe =
                req.body;
            const errorTrackerId: $TSFixMe = req.params.errorTrackerId;
            const select: $TSFixMe =
                'componentId name slug key showQuickStart resourceCategory createdById createdAt';
            const populate: $TSFixMe = [
                { path: 'componentId', select: 'name' },
                { path: 'resourceCategory', select: 'name' },
            ];

            const currentErrorTracker: $TSFixMe =
                await ErrorTrackerService.findOneBy({
                    query: { _id: errorTrackerId },
                    select,
                    populate,
                });
            if (!currentErrorTracker) {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Error Tracker not found',
                });
            }

            const query: $TSFixMe = {};

            if (errorTrackerId) {
                query.errorTrackerId = errorTrackerId;
            }

            if (startDate && endDate) {
                query.createdAt = { $gte: startDate, $lte: endDate };
            }

            if (filters) {
                for (const [key, value] of Object.entries(filters)) {
                    query[key] = value;
                }
            }
            const errorTrackerIssues: $TSFixMe =
                await ErrorEventService.findDistinct(
                    query,
                    limit || 10,
                    skip || 0
                );

            return sendListResponse(req, res, {
                errorTrackerIssues: errorTrackerIssues.totalErrorEvents,
                dateRange: errorTrackerIssues.dateRange,
                count: errorTrackerIssues.count,
            });
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);
// Description: Get error event by _id and errorTrackerId.
router.post(
    '/:projectId/:componentId/:errorTrackerId/error-events/:errorEventId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const errorEventId: $TSFixMe = req.params.errorEventId;
            if (!errorEventId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Error Event ID is required',
                });
            }
            const errorTrackerId: $TSFixMe = req.params.errorTrackerId;
            const select: $TSFixMe =
                'errorTrackerId issueId content type timeline tags sdk fingerprint fingerprintHash device createdAt';
            const populate: $TSFixMe = [
                { path: 'errorTrackerId', select: 'name' },
                {
                    path: 'issueId',
                    select: '_id name description type ignored resolved',
                },
                { path: 'resolvedById', select: 'name' },
                { path: 'ignoredById', select: 'name' },
            ];

            const currentErrorEvent: $TSFixMe =
                await ErrorEventService.findOneBy({
                    query: { _id: errorEventId, errorTrackerId },
                    select,
                    populate,
                });
            if (!currentErrorEvent) {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Error Event not found',
                });
            }

            // Find that current error event with the previous and next values
            const errorEvent: $TSFixMe =
                await ErrorEventService.findOneWithPrevAndNext(
                    errorEventId,
                    errorTrackerId
                );

            return sendItemResponse(req, res, errorEvent);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);
// Description: Get issue by _id and errorTrackerId.
router.post(
    '/:projectId/:componentId/:errorTrackerId/issues/:issueId/details',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const issueId: $TSFixMe = req.params.issueId;
            if (!issueId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Error Event ID is required',
                });
            }
            const errorTrackerId: $TSFixMe = req.params.errorTrackerId;

            const populateIssue: $TSFixMe = [
                { path: 'errorTrackerId', select: 'name' },
                { path: 'resolvedById', select: 'name' },
                { path: 'ignoredById', select: 'name' },
            ];

            const selectIssue: $TSFixMe =
                'name description errorTrackerId type fingerprint fingerprintHash createdAt deleted deletedAt deletedById resolved resolvedAt resolvedById ignored ignoredAt ignoredById';

            const issue: $TSFixMe = await IssueService.findOneBy({
                query: { _id: issueId, errorTrackerId },
                select: selectIssue,
                populate: populateIssue,
            });
            if (!issue) {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Issue not found',
                });
            }

            return sendItemResponse(req, res, issue);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);
// Description: Ignore, Resolve and Unresolve issues by _id and errorTrackerId.
router.post(
    '/:projectId/:componentId/:errorTrackerId/issues/action',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { issueId, action }: $TSFixMe = req.body;
            if (!issueId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Issue ID is required',
                });
            }
            if (!Array.isArray(issueId)) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Issue ID has to be of type array',
                });
            }
            if (issueId.length < 1) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Atleast one Issue ID is required',
                });
            }
            if (!action) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Action is required',
                });
            }
            const allowedActions: $TSFixMe = [
                'ignore',
                'unresolve',
                'resolve',
                'unignore',
            ];
            if (!allowedActions.includes(action)) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Action is not allowed',
                });
            }
            const componentId: $TSFixMe = req.params.componentId;
            if (!componentId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Component ID is required',
                });
            }
            const errorTrackerId: $TSFixMe = req.params.errorTrackerId;
            if (!errorTrackerId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Error Tracker ID is required',
                });
            }
            const select: $TSFixMe =
                'componentId name slug key showQuickStart resourceCategory createdById createdAt';
            const populate: $TSFixMe = [
                { path: 'componentId', select: 'name' },
                { path: 'resourceCategory', select: 'name' },
            ];

            const currentErrorTracker: $TSFixMe =
                await ErrorTrackerService.findOneBy({
                    query: { _id: errorTrackerId, componentId },
                    select,
                    populate,
                });
            if (!currentErrorTracker) {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Error Tracker not found',
                });
            }

            let updateData: $TSFixMe = {};

            switch (action) {
                case 'ignore':
                    updateData = {
                        ignored: true,
                        ignoredAt: new Date(),

                        ignoredById: req.user.id,
                        resolved: false,
                        resolvedAt: '',
                        resolvedById: null,
                    };
                    break;
                case 'unresolve':
                    updateData = {
                        ignored: false,
                        ignoredAt: '',
                        ignoredById: null,
                        resolved: false,
                        resolvedAt: '',
                        resolvedById: null,
                    };
                    break;
                case 'unignore':
                    updateData = {
                        ignored: false,
                        ignoredAt: '',
                        ignoredById: null,
                        resolved: false,
                        resolvedAt: '',
                        resolvedById: null,
                    };
                    break;
                case 'resolve':
                    updateData = {
                        ignored: false,
                        ignoredAt: '',
                        ignoredById: null,
                        resolved: true,
                        resolvedAt: new Date(),

                        resolvedById: req.user.id,
                    };
                    break;

                default:
                    break;
            }

            const issues: $TSFixMe = [];
            for (let index: $TSFixMe = 0; index < issueId.length; index++) {
                const currentIssueId: $TSFixMe = issueId[index];
                const query: $TSFixMe = {
                    _id: currentIssueId,
                    errorTrackerId,
                };
                const currentIssue: $TSFixMe = await IssueService.countBy(
                    query
                );

                if (currentIssue && currentIssue > 0) {
                    // Add action to timeline for this particular issue
                    const timelineData: $TSFixMe = {
                        issueId: currentIssueId,

                        createdById: req.user ? req.user.id : null,
                        status: action,
                    };

                    let [issue]: $TSFixMe = await Promise.all([
                        IssueService.updateOneBy(query, updateData),
                        IssueTimelineService.create(timelineData),
                    ]);
                    issue = JSON.parse(JSON.stringify(issue));

                    // Get the timeline attahced to this issue annd add it to the issue

                    const populateIssueTimeline: $TSFixMe = [
                        { path: 'issueId', select: 'name' },
                        { path: 'createdById', select: 'name' },
                    ];

                    const selectIssueTimeline: $TSFixMe =
                        'issueId createdById createdAt status deleted';

                    issue.timeline = await IssueTimelineService.findBy({
                        query: { issueId: currentIssueId },
                        select: selectIssueTimeline,
                        populate: populateIssueTimeline,
                    });
                    issues.push(issue);

                    try {
                        // Update a timeline object
                        RealTimeService.sendIssueStatusChange(issue, action);
                    } catch (error) {
                        ErrorService.log(
                            'realtimeService.sendIssueStatusChange',
                            error
                        );
                    }
                }
            }

            return sendItemResponse(req, res, { issues });
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);
// Description: Get all error event by hash and errorTrackerId.
router.post(
    '/:projectId/:componentId/:errorTrackerId/error-events',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const {
                skip,
                limit,
                startDate,
                endDate,
                fingerprintHash,
            }: $TSFixMe = req.body;
            if (!fingerprintHash) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Fingerprint Hash is required',
                });
            }
            const errorTrackerId: $TSFixMe = req.params.errorTrackerId;
            const select: $TSFixMe =
                'componentId name slug key showQuickStart resourceCategory createdById createdAt';
            const populate: $TSFixMe = [
                { path: 'componentId', select: 'name' },
                { path: 'resourceCategory', select: 'name' },
            ];

            const currentErrorTracker: $TSFixMe =
                await ErrorTrackerService.findOneBy({
                    query: { _id: errorTrackerId },
                    select,
                    populate,
                });
            if (!currentErrorTracker) {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Error Tracker not found',
                });
            }

            const query: $TSFixMe = {};

            query.fingerprintHash = fingerprintHash;

            if (errorTrackerId) {
                query.errorTrackerId = errorTrackerId;
            }

            if (startDate && endDate) {
                query.createdAt = { $gte: startDate, $lte: endDate };
            }

            const errorEvents: $TSFixMe = await ErrorEventService.findBy({
                query,
                limit: limit || 10,
                skip: skip || 0,
                select,
                populate: [{ path: 'errorTrackerId', select: 'name' }],
            });

            return sendItemResponse(req, res, errorEvents);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);
// Description: Get Members assigned to an issue using IssueId and errorTrackerId.
router.post(
    '/:projectId/:componentId/:errorTrackerId/members/:issueId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const componentId: $TSFixMe = req.params.componentId;
            if (!componentId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Component ID is required',
                });
            }
            const errorTrackerId: $TSFixMe = req.params.errorTrackerId;
            if (!errorTrackerId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Error Tracker ID is required',
                });
            }
            const issueId: $TSFixMe = req.params.issueId;
            if (!issueId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Issue ID is required',
                });
            }
            const select: $TSFixMe =
                'componentId name slug key showQuickStart resourceCategory createdById createdAt';
            const populate: $TSFixMe = [
                { path: 'componentId', select: 'name' },
                { path: 'resourceCategory', select: 'name' },
            ];

            const currentErrorTracker: $TSFixMe =
                await ErrorTrackerService.findOneBy({
                    query: { _id: errorTrackerId, componentId },
                    select,
                    populate,
                });
            if (!currentErrorTracker) {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Error Tracker not found',
                });
            }

            const currentIssue: $TSFixMe = await IssueService.countBy({
                _id: issueId,
                errorTrackerId,
            });
            if (!currentIssue || currentIssue === 0) {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Issue not found',
                });
            }

            const selectIssueMember: $TSFixMe =
                'issueId userId createdAt createdById removed removedAt removedById';

            const populateIssueMember: $TSFixMe = [
                { path: 'issueId', select: 'name' },

                { path: 'userId', select: 'name email' },
            ];

            const issueMembers: $TSFixMe = await IssueMemberService.findBy({
                query: { issueId, removed: false },
                select: selectIssueMember,
                populate: populateIssueMember,
            });
            return sendItemResponse(req, res, { issueId, issueMembers });
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);
// Description: Assign an issue to team member(s) using IssueId and errorTrackerId.
router.post(
    '/:projectId/:componentId/:errorTrackerId/assign/:issueId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { teamMemberId }: $TSFixMe = req.body;
            if (!teamMemberId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Team Member ID is required',
                });
            }
            if (!Array.isArray(teamMemberId)) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Team Member ID has to be of type array',
                });
            }
            if (teamMemberId.length < 1) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Atleast one Team Member ID is required',
                });
            }

            const projectId: $TSFixMe = req.params.projectId;
            const componentId: $TSFixMe = req.params.componentId;
            if (!componentId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Component ID is required',
                });
            }
            const errorTrackerId: $TSFixMe = req.params.errorTrackerId;
            if (!errorTrackerId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Error Tracker ID is required',
                });
            }
            const issueId: $TSFixMe = req.params.issueId;
            if (!issueId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Issue ID is required',
                });
            }
            const select: $TSFixMe =
                'componentId name slug key showQuickStart resourceCategory createdById createdAt';
            const populate: $TSFixMe = [
                { path: 'componentId', select: 'name' },
                { path: 'resourceCategory', select: 'name' },
            ];

            const currentErrorTracker: $TSFixMe =
                await ErrorTrackerService.findOneBy({
                    query: { _id: errorTrackerId, componentId },
                    select,
                    populate,
                });
            if (!currentErrorTracker) {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Error Tracker not found',
                });
            }

            const currentIssue: $TSFixMe = await IssueService.countBy({
                _id: issueId,
                errorTrackerId,
            });
            if (!currentIssue || currentIssue === 0) {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Issue not found',
                });
            }

            // Get the list of team members
            await Promise.all(
                teamMemberId.map(async (teamMemberUserId: $TSFixMe) => {
                    // Check if in organization
                    let member: $TSFixMe;
                    try {
                        member = await TeamService.getTeamMemberBy(
                            projectId,
                            teamMemberUserId
                        );
                    } catch (e) {
                        // Member doest exist
                    }

                    if (member) {
                        // Set up the data
                        const data: $TSFixMe = {
                            issueId,
                            userId: teamMemberUserId,

                            createdById: req.user ? req.user.id : null,
                        };
                        // Find if the issue member exist in the project
                        let issueMember: $TSFixMe =
                            await IssueMemberService.findOneBy({
                                issueId,
                                userId: teamMemberUserId,
                            });
                        if (!issueMember) {
                            // If it doesnt, create it
                            issueMember = await IssueMemberService.create(data);
                        } else {
                            // Set up the data
                            const data: $TSFixMe = {
                                removed: false,
                                removedAt: '',
                                removedById: '',
                            };
                            // Find the issueMember by the 3 parameters, and update it
                            issueMember = await IssueMemberService.updateOneBy(
                                {
                                    issueId,
                                    userId: teamMemberUserId,
                                },
                                data
                            );
                        }
                    }
                })
            );
            const selectIssueMember: $TSFixMe =
                'issueId userId createdAt createdById removed removedAt removedById';

            const populateIssueMember: $TSFixMe = [
                { path: 'issueId', select: 'name' },

                { path: 'userId', select: 'name email' },
            ];

            const members: $TSFixMe = await IssueMemberService.findBy({
                query: { issueId, removed: false },
                select: selectIssueMember,
                populate: populateIssueMember,
            });
            return sendItemResponse(req, res, { issueId, members });
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);
// Description: Remove team member(s) from an issue using IssueId and errorTrackerId.
router.post(
    '/:projectId/:componentId/:errorTrackerId/unassign/:issueId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { teamMemberId }: $TSFixMe = req.body;
            if (!teamMemberId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Team Member ID is required',
                });
            }
            if (!Array.isArray(teamMemberId)) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Team Member ID has to be of type array',
                });
            }
            if (teamMemberId.length < 1) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Atleast one Team Member ID is required',
                });
            }

            const projectId: $TSFixMe = req.params.projectId;
            const componentId: $TSFixMe = req.params.componentId;
            if (!componentId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Component ID is required',
                });
            }
            const errorTrackerId: $TSFixMe = req.params.errorTrackerId;
            if (!errorTrackerId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Error Tracker ID is required',
                });
            }
            const issueId: $TSFixMe = req.params.issueId;
            if (!issueId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Issue ID is required',
                });
            }
            const select: $TSFixMe =
                'componentId name slug key showQuickStart resourceCategory createdById createdAt';
            const populate: $TSFixMe = [
                { path: 'componentId', select: 'name' },
                { path: 'resourceCategory', select: 'name' },
            ];

            const currentErrorTracker: $TSFixMe =
                await ErrorTrackerService.findOneBy({
                    query: { _id: errorTrackerId, componentId },
                    select,
                    populate,
                });
            if (!currentErrorTracker) {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Error Tracker not found',
                });
            }

            const currentIssue: $TSFixMe = await IssueService.countBy({
                _id: issueId,
                errorTrackerId,
            });
            if (!currentIssue || currentIssue === 0) {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Issue not found',
                });
            }

            // Get the list of team members
            await Promise.all(
                teamMemberId.map(async (teamMemberUserId: $TSFixMe) => {
                    // Check if in organization
                    let member: $TSFixMe;
                    try {
                        member = await TeamService.getTeamMemberBy(
                            projectId,
                            teamMemberUserId
                        );
                    } catch (e) {
                        // Member doest exist
                    }

                    if (member) {
                        // Set up the data
                        const data: $TSFixMe = {
                            removed: true,
                            removedAt: new Date(),

                            removedById: req.user ? req.user.id : null,
                        };
                        // Find the issueMember by the 3 parameters, and update it
                        await IssueMemberService.updateOneBy(
                            {
                                issueId,
                                userId: teamMemberUserId,
                                removed: false,
                            },
                            data
                        );
                    }
                })
            );

            const selectIssueMember: $TSFixMe =
                'issueId userId createdAt createdById removed removedAt removedById';

            const populateIssueMember: $TSFixMe = [
                { path: 'issueId', select: 'name' },

                { path: 'userId', select: 'name email' },
            ];
            const members: $TSFixMe = await IssueMemberService.findBy({
                query: { issueId, removed: false },
                select: selectIssueMember,
                populate: populateIssueMember,
            });
            return sendItemResponse(req, res, { issueId, members });
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);
// Description: Delete an Issue  IssueId and errorTrackerId.
router.delete(
    '/:projectId/:componentId/:errorTrackerId/issue/:issueId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const componentId: $TSFixMe = req.params.componentId;
            if (!componentId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Component ID is required',
                });
            }
            const errorTrackerId: $TSFixMe = req.params.errorTrackerId;
            if (!errorTrackerId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Error Tracker ID is required',
                });
            }
            const issueId: $TSFixMe = req.params.issueId;
            if (!issueId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Issue ID is required',
                });
            }
            const select: $TSFixMe =
                'componentId name slug key showQuickStart resourceCategory createdById createdAt';
            const populate: $TSFixMe = [
                { path: 'componentId', select: 'name' },
                { path: 'resourceCategory', select: 'name' },
            ];

            const currentErrorTracker: $TSFixMe =
                await ErrorTrackerService.findOneBy({
                    query: { _id: errorTrackerId, componentId },
                    select,
                    populate,
                });
            if (!currentErrorTracker) {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Error Tracker not found',
                });
            }

            const issue: $TSFixMe = await IssueService.deleteBy(
                {
                    _id: issueId,
                    errorTrackerId,
                },

                req.user.id,
                componentId
            );
            if (issue) {
                return sendItemResponse(req, res, issue);
            }
            return sendErrorResponse(req, res, {
                code: 404,
                message: 'Issue not found',
            });
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);
export default router;
