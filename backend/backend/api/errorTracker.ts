import express, { Request, Response, NextFunction } from 'common-server/utils/express';

const router = express.getRouter();
const getUser = require('../middlewares/user').getUser;

import { isAuthorized } from '../middlewares/authorization';
const isUserAdmin = require('../middlewares/project').isUserAdmin;

import {
    sendErrorResponse,
    sendItemResponse,
} from 'common-server/utils/response';

import UserService from '../services/userService';
import ComponentService from '../services/componentService';
import NotificationService from '../services/notificationService';
import RealTimeService from '../services/realTimeService';
import ErrorTrackerService from '../services/errorTrackerService';
import ResourceCategoryService from '../services/resourceCategoryService';

import uuid from 'uuid';
const isErrorTrackerValid = require('../middlewares/errorTracker')
    .isErrorTrackerValid;
import ErrorEventService from '../services/errorEventService';
import { sendListResponse } from 'common-server/utils/response';
import IssueService from '../services/issueService';
import TeamService from '../services/teamService';
import IssueMemberService from '../services/issueMemberService';
import IssueTimelineService from '../services/issueTimelineService';
import ErrorService from 'common-server/utils/error';
// Route
// Description: Adding a new error tracker to a component.
// Params:
// Param 1: req.params-> {componentId}; req.body -> {[_id], name}
// Returns: response status, error message
router.post(
    '/:projectId/:componentId/create',
    getUser,
    isAuthorized,
    isUserAdmin,
    async function (req: Request, res: Response) {
        try {
            const data = req.body;
            const componentId = req.params.componentId;
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

            const populateComponent = [{ path: 'projectId', select: 'name' }];
            const selectComponent = ' projectId ';
            const [errorTracker, component, user] = await Promise.all([
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
            ]);

            try {
                NotificationService.create(
                    component.projectId._id,

                    `A New Error Tracker was Created with name ${errorTracker.name} by ${user.name}`,
                    user._id,
                    'errortrackeraddremove'
                );
                // run in the background
                RealTimeService.sendErrorTrackerCreated(errorTracker);
            } catch (error) {
                ErrorService.log(
                    'realtimeService.sendErrorTrackerCreated',
                    error
                );
            }
            return sendItemResponse(req, res, errorTracker);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Description: Get all Error Trackers by componentId.
router.get('/:projectId/:componentId', getUser, isAuthorized, async function (
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
        const errorTrackers = await ErrorTrackerService.getErrorTrackersByComponentId(
            componentId,
            limit,
            skip
        );
        return sendItemResponse(req, res, errorTrackers);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Description: Delete an Error Tracker by errorTrackerId and componentId.
router.delete(
    '/:projectId/:componentId/:errorTrackerId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async function (req: Request, res: Response) {
        const { errorTrackerId, componentId } = req.params;
        try {
            const errorTracker = await ErrorTrackerService.deleteBy(
                {
                    _id: errorTrackerId,
                    componentId: componentId,
                },

                req.user.id
            );
            if (errorTracker) {
                return sendItemResponse(req, res, errorTracker);
            } else {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Error Tracker not found',
                });
            }
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Description: Reset Error Tracker Key by errorTrackerId.
router.post(
    '/:projectId/:componentId/:errorTrackerId/reset-key',
    getUser,
    isAuthorized,
    isUserAdmin,
    async function (req: Request, res: Response) {
        const errorTrackerId = req.params.errorTrackerId;
        const select =
            'componentId name slug key showQuickStart resourceCategory createdById createdAt';
        const populate = [
            { path: 'componentId', select: 'name' },
            { path: 'resourceCategory', select: 'name' },
        ];

        const currentErrorTracker = await ErrorTrackerService.findOneBy({
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

        // error tracker is valid
        const data = {
            key: uuid.v4(), // set new error tracker key
        };

        try {
            const errorTracker = await ErrorTrackerService.updateOneBy(
                { _id: currentErrorTracker._id },
                data
            );
            return sendItemResponse(req, res, errorTracker);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Description: Update Error Tracker by errorTrackerId.
router.put(
    '/:projectId/:componentId/:errorTrackerId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async function (req: Request, res: Response) {
        const { errorTrackerId, componentId } = req.params;

        const data = req.body;
        if (!data) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: "values can't be null",
            });
        }

        data.createdById = req.user ? req.user.id : null;
        if (!data.name && data.showQuickStart === undefined) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'New Error Tracker Name is required.',
            });
        }
        const select =
            'componentId name slug key showQuickStart resourceCategory createdById createdAt';

        const currentErrorTracker = await ErrorTrackerService.findOneBy({
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

        // try to find in the application log if the name already exist for that component
        const existingQuery = {
            name: data.name,
            componentId: componentId,
        };
        if (data.resourceCategory != '') {
            existingQuery.resourceCategory = data.resourceCategory;
        }
        const existingErrorTracking = await ErrorTrackerService.findBy({
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
            data.showQuickStart === undefined
        ) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Error Tracker with that name already exists.',
            });
        }

        // Error Tracker is valid
        const errorTrackerUpdate = {};
        if (data.name) {
            errorTrackerUpdate.name = data.name;
        }
        if (data.showQuickStart !== undefined) {
            errorTrackerUpdate.showQuickStart = data.showQuickStart;
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
                errorTrackerUpdate.resourceCategory = data.resourceCategory;
            } else {
                unsetData = { resourceCategory: '' };
            }
        }

        try {
            const errorTracker = await ErrorTrackerService.updateOneBy(
                { _id: currentErrorTracker._id },
                errorTrackerUpdate,

                unsetData
            );
            return sendItemResponse(req, res, errorTracker);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Description: send an error event to the server.
router.post('/:errorTrackerId/track', isErrorTrackerValid, async function (
    req,
    res
) {
    try {
        const data = req.body;
        const errorTrackerId = req.params.errorTrackerId;
        data.errorTrackerId = errorTrackerId;

        // try to fetch the particular issue with the fingerprint of the error event and the error tracker id
        let issue = await IssueService.findOneByHashAndErrorTracker(
            data.fingerprint,
            errorTrackerId
        );

        // if it doesnt exist, create the issue and use its details
        if (!issue) {
            issue = await IssueService.create(data);
        } else {
            // issue exist but checked if it is resolved so to uresolve it
            if (issue.resolved) {
                const updateData = {
                    resolved: false,
                    resolvedAt: '',
                    resolvedById: null,
                };
                const query = {
                    _id: issue._id,
                    errorTrackerId,
                };
                await IssueService.updateOneBy(query, updateData);
            }
        }
        // since it now exist, use the issue details
        data.issueId = issue._id;
        data.fingerprintHash = issue.fingerprintHash;

        // create the error event
        const errorEvent = await ErrorEventService.create(data);

        // get the issue in the format that the fronnted will want for the real time update
        const errorTrackerIssue = await ErrorEventService.findDistinct(
            { _id: data.issueId, errorTrackerId: data.errorTrackerId },
            1,
            0
        );

        issue = errorTrackerIssue.totalErrorEvents[0];

        try {
            // run in the background
            RealTimeService.sendErrorEventCreated({ errorEvent, issue });
        } catch (error) {
            ErrorService.log('realtimeService.sendErrorEventCreated', error);
        }
        return sendItemResponse(req, res, errorEvent);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Description: Get all error event grouped by hash by errorTrackerId.
router.post(
    '/:projectId/:componentId/:errorTrackerId/issues',
    getUser,
    isAuthorized,
    async function (req: Request, res: Response) {
        try {
            const { skip, limit, startDate, endDate, filters } = req.body;
            const errorTrackerId = req.params.errorTrackerId;
            const select =
                'componentId name slug key showQuickStart resourceCategory createdById createdAt';
            const populate = [
                { path: 'componentId', select: 'name' },
                { path: 'resourceCategory', select: 'name' },
            ];

            const currentErrorTracker = await ErrorTrackerService.findOneBy({
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

            const query = {};

            if (errorTrackerId) query.errorTrackerId = errorTrackerId;

            if (startDate && endDate)
                query.createdAt = { $gte: startDate, $lte: endDate };

            if (filters) {
                for (const [key, value] of Object.entries(filters)) {
                    query[key] = value;
                }
            }
            const errorTrackerIssues = await ErrorEventService.findDistinct(
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
            return sendErrorResponse(req, res, error);
        }
    }
);
// Description: Get error event by _id and errorTrackerId.
router.post(
    '/:projectId/:componentId/:errorTrackerId/error-events/:errorEventId',
    getUser,
    isAuthorized,
    async function (req: Request, res: Response) {
        try {
            const errorEventId = req.params.errorEventId;
            if (!errorEventId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Error Event ID is required',
                });
            }
            const errorTrackerId = req.params.errorTrackerId;
            const select =
                'errorTrackerId issueId content type timeline tags sdk fingerprint fingerprintHash device createdAt';
            const populate = [
                { path: 'errorTrackerId', select: 'name' },
                {
                    path: 'issueId',
                    select: '_id name description type ignored resolved',
                },
                { path: 'resolvedById', select: 'name' },
                { path: 'ignoredById', select: 'name' },
            ];

            const currentErrorEvent = await ErrorEventService.findOneBy({
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

            // find that current error event with the previous and next values
            const errorEvent = await ErrorEventService.findOneWithPrevAndNext(
                errorEventId,
                errorTrackerId
            );

            return sendItemResponse(req, res, errorEvent);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);
// Description: Get issue by _id and errorTrackerId.
router.post(
    '/:projectId/:componentId/:errorTrackerId/issues/:issueId/details',
    getUser,
    isAuthorized,
    async function (req: Request, res: Response) {
        try {
            const issueId = req.params.issueId;
            if (!issueId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Error Event ID is required',
                });
            }
            const errorTrackerId = req.params.errorTrackerId;

            const populateIssue = [
                { path: 'errorTrackerId', select: 'name' },
                { path: 'resolvedById', select: 'name' },
                { path: 'ignoredById', select: 'name' },
            ];

            const selectIssue =
                'name description errorTrackerId type fingerprint fingerprintHash createdAt deleted deletedAt deletedById resolved resolvedAt resolvedById ignored ignoredAt ignoredById';

            const issue = await IssueService.findOneBy({
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
            return sendErrorResponse(req, res, error);
        }
    }
);
// Description: Ignore, Resolve and Unresolve issues by _id and errorTrackerId.
router.post(
    '/:projectId/:componentId/:errorTrackerId/issues/action',
    getUser,
    isAuthorized,
    async function (req: Request, res: Response) {
        try {
            const { issueId, action } = req.body;
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
            const allowedActions = [
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
            const componentId = req.params.componentId;
            if (!componentId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Component ID is required',
                });
            }
            const errorTrackerId = req.params.errorTrackerId;
            if (!errorTrackerId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Error Tracker ID is required',
                });
            }
            const select =
                'componentId name slug key showQuickStart resourceCategory createdById createdAt';
            const populate = [
                { path: 'componentId', select: 'name' },
                { path: 'resourceCategory', select: 'name' },
            ];

            const currentErrorTracker = await ErrorTrackerService.findOneBy({
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

            let updateData = {};

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

            const issues = [];
            for (let index = 0; index < issueId.length; index++) {
                const currentIssueId = issueId[index];
                const query = {
                    _id: currentIssueId,
                    errorTrackerId,
                };
                const currentIssue = await IssueService.countBy(query);

                if (currentIssue && currentIssue > 0) {
                    // add action to timeline for this particular issue
                    const timelineData = {
                        issueId: currentIssueId,

                        createdById: req.user ? req.user.id : null,
                        status: action,
                    };

                    let [issue] = await Promise.all([
                        IssueService.updateOneBy(query, updateData),
                        IssueTimelineService.create(timelineData),
                    ]);
                    issue = JSON.parse(JSON.stringify(issue));

                    // get the timeline attahced to this issue annd add it to the issue

                    const populateIssueTimeline = [
                        { path: 'issueId', select: 'name' },
                        { path: 'createdById', select: 'name' },
                    ];

                    const selectIssueTimeline =
                        'issueId createdById createdAt status deleted';

                    issue.timeline = await IssueTimelineService.findBy({
                        query: { issueId: currentIssueId },
                        select: selectIssueTimeline,
                        populate: populateIssueTimeline,
                    });
                    issues.push(issue);

                    try {
                        // update a timeline object
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
            return sendErrorResponse(req, res, error);
        }
    }
);
// Description: Get all error event by hash and errorTrackerId.
router.post(
    '/:projectId/:componentId/:errorTrackerId/error-events',
    getUser,
    isAuthorized,
    async function (req: Request, res: Response) {
        try {
            const {
                skip,
                limit,
                startDate,
                endDate,
                fingerprintHash,
            } = req.body;
            if (!fingerprintHash) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Fingerprint Hash is required',
                });
            }
            const errorTrackerId = req.params.errorTrackerId;
            const select =
                'componentId name slug key showQuickStart resourceCategory createdById createdAt';
            const populate = [
                { path: 'componentId', select: 'name' },
                { path: 'resourceCategory', select: 'name' },
            ];

            const currentErrorTracker = await ErrorTrackerService.findOneBy({
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

            const query = {};

            query.fingerprintHash = fingerprintHash;

            if (errorTrackerId) query.errorTrackerId = errorTrackerId;

            if (startDate && endDate)
                query.createdAt = { $gte: startDate, $lte: endDate };

            const errorEvents = await ErrorEventService.findBy({
                query,
                limit: limit || 10,
                skip: skip || 0,
                select,
                populate: [{ path: 'errorTrackerId', select: 'name' }],
            });

            return sendItemResponse(req, res, errorEvents);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);
// Description: Get Members assigned to an issue using IssueId and errorTrackerId.
router.post(
    '/:projectId/:componentId/:errorTrackerId/members/:issueId',
    getUser,
    isAuthorized,
    async function (req: Request, res: Response) {
        try {
            const componentId = req.params.componentId;
            if (!componentId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Component ID is required',
                });
            }
            const errorTrackerId = req.params.errorTrackerId;
            if (!errorTrackerId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Error Tracker ID is required',
                });
            }
            const issueId = req.params.issueId;
            if (!issueId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Issue ID is required',
                });
            }
            const select =
                'componentId name slug key showQuickStart resourceCategory createdById createdAt';
            const populate = [
                { path: 'componentId', select: 'name' },
                { path: 'resourceCategory', select: 'name' },
            ];

            const currentErrorTracker = await ErrorTrackerService.findOneBy({
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

            const currentIssue = await IssueService.countBy({
                _id: issueId,
                errorTrackerId,
            });
            if (!currentIssue || currentIssue === 0) {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Issue not found',
                });
            }

            const selectIssueMember =
                'issueId userId createdAt createdById removed removedAt removedById';

            const populateIssueMember = [
                { path: 'issueId', select: 'name' },

                { path: 'userId', select: 'name email' },
            ];

            const issueMembers = await IssueMemberService.findBy({
                query: { issueId, removed: false },
                select: selectIssueMember,
                populate: populateIssueMember,
            });
            return sendItemResponse(req, res, { issueId, issueMembers });
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);
// Description: Assign an issue to team member(s) using IssueId and errorTrackerId.
router.post(
    '/:projectId/:componentId/:errorTrackerId/assign/:issueId',
    getUser,
    isAuthorized,
    async function (req: Request, res: Response) {
        try {
            const { teamMemberId } = req.body;
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

            const projectId = req.params.projectId;
            const componentId = req.params.componentId;
            if (!componentId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Component ID is required',
                });
            }
            const errorTrackerId = req.params.errorTrackerId;
            if (!errorTrackerId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Error Tracker ID is required',
                });
            }
            const issueId = req.params.issueId;
            if (!issueId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Issue ID is required',
                });
            }
            const select =
                'componentId name slug key showQuickStart resourceCategory createdById createdAt';
            const populate = [
                { path: 'componentId', select: 'name' },
                { path: 'resourceCategory', select: 'name' },
            ];

            const currentErrorTracker = await ErrorTrackerService.findOneBy({
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

            const currentIssue = await IssueService.countBy({
                _id: issueId,
                errorTrackerId,
            });
            if (!currentIssue || currentIssue === 0) {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Issue not found',
                });
            }

            // get the list of team members
            await Promise.all(
                teamMemberId.map(async teamMemberUserId => {
                    // check if in organization
                    let member;
                    try {
                        member = await TeamService.getTeamMemberBy(
                            projectId,
                            teamMemberUserId
                        );
                    } catch (e) {
                        // Member doest exist
                    }

                    if (member) {
                        // set up the data
                        const data = {
                            issueId,
                            userId: teamMemberUserId,

                            createdById: req.user ? req.user.id : null,
                        };
                        // find if the issue member exist in the project
                        let issueMember = await IssueMemberService.findOneBy({
                            issueId,
                            userId: teamMemberUserId,
                        });
                        if (!issueMember) {
                            // if it doesnt, create it
                            issueMember = await IssueMemberService.create(data);
                        } else {
                            // set up the data
                            const data = {
                                removed: false,
                                removedAt: '',
                                removedById: '',
                            };
                            // find the issueMember by the 3 parameters, and update it
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
            const selectIssueMember =
                'issueId userId createdAt createdById removed removedAt removedById';

            const populateIssueMember = [
                { path: 'issueId', select: 'name' },

                { path: 'userId', select: 'name email' },
            ];

            const members = await IssueMemberService.findBy({
                query: { issueId, removed: false },
                select: selectIssueMember,
                populate: populateIssueMember,
            });
            return sendItemResponse(req, res, { issueId, members });
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);
// Description: Remove team member(s) from an issue using IssueId and errorTrackerId.
router.post(
    '/:projectId/:componentId/:errorTrackerId/unassign/:issueId',
    getUser,
    isAuthorized,
    async function (req: Request, res: Response) {
        try {
            const { teamMemberId } = req.body;
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

            const projectId = req.params.projectId;
            const componentId = req.params.componentId;
            if (!componentId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Component ID is required',
                });
            }
            const errorTrackerId = req.params.errorTrackerId;
            if (!errorTrackerId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Error Tracker ID is required',
                });
            }
            const issueId = req.params.issueId;
            if (!issueId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Issue ID is required',
                });
            }
            const select =
                'componentId name slug key showQuickStart resourceCategory createdById createdAt';
            const populate = [
                { path: 'componentId', select: 'name' },
                { path: 'resourceCategory', select: 'name' },
            ];

            const currentErrorTracker = await ErrorTrackerService.findOneBy({
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

            const currentIssue = await IssueService.countBy({
                _id: issueId,
                errorTrackerId,
            });
            if (!currentIssue || currentIssue === 0) {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Issue not found',
                });
            }

            // get the list of team members
            await Promise.all(
                teamMemberId.map(async teamMemberUserId => {
                    // check if in organization
                    let member;
                    try {
                        member = await TeamService.getTeamMemberBy(
                            projectId,
                            teamMemberUserId
                        );
                    } catch (e) {
                        // Member doest exist
                    }

                    if (member) {
                        // set up the data
                        const data = {
                            removed: true,
                            removedAt: new Date(),

                            removedById: req.user ? req.user.id : null,
                        };
                        // find the issueMember by the 3 parameters, and update it
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

            const selectIssueMember =
                'issueId userId createdAt createdById removed removedAt removedById';

            const populateIssueMember = [
                { path: 'issueId', select: 'name' },

                { path: 'userId', select: 'name email' },
            ];
            const members = await IssueMemberService.findBy({
                query: { issueId, removed: false },
                select: selectIssueMember,
                populate: populateIssueMember,
            });
            return sendItemResponse(req, res, { issueId, members });
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);
// Description: Delete an Issue  IssueId and errorTrackerId.
router.delete(
    '/:projectId/:componentId/:errorTrackerId/issue/:issueId',
    getUser,
    isAuthorized,
    async function (req: Request, res: Response) {
        try {
            const componentId = req.params.componentId;
            if (!componentId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Component ID is required',
                });
            }
            const errorTrackerId = req.params.errorTrackerId;
            if (!errorTrackerId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Error Tracker ID is required',
                });
            }
            const issueId = req.params.issueId;
            if (!issueId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Issue ID is required',
                });
            }
            const select =
                'componentId name slug key showQuickStart resourceCategory createdById createdAt';
            const populate = [
                { path: 'componentId', select: 'name' },
                { path: 'resourceCategory', select: 'name' },
            ];

            const currentErrorTracker = await ErrorTrackerService.findOneBy({
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

            const issue = await IssueService.deleteBy(
                {
                    _id: issueId,
                    errorTrackerId,
                },

                req.user.id,
                componentId
            );
            if (issue) {
                return sendItemResponse(req, res, issue);
            } else {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Issue not found',
                });
            }
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);
export default router;
