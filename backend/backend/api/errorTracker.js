/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');

const router = express.Router();
const getUser = require('../middlewares/user').getUser;
const { isAuthorized } = require('../middlewares/authorization');
const isUserAdmin = require('../middlewares/project').isUserAdmin;

const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;

const UserService = require('../services/userService');
const ComponentService = require('../services/componentService');
const NotificationService = require('../services/notificationService');
const RealTimeService = require('../services/realTimeService');
const ErrorTrackerService = require('../services/errorTrackerService');
const ResourceCategoryService = require('../services/resourceCategoryService');
const uuid = require('uuid');
const isErrorTrackerValid = require('../middlewares/errorTracker')
    .isErrorTrackerValid;
const ErrorEventService = require('../services/errorEventService');
const sendListResponse = require('../middlewares/response').sendListResponse;
const IssueService = require('../services/issueService');
const TeamService = require('../services/teamService');
const IssueMemberService = require('../services/issueMemberService');
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

            const errorTracker = await ErrorTrackerService.create(data);
            const component = await ComponentService.findOneBy({
                _id: componentId,
            });

            const user = await UserService.findOneBy({ _id: req.user.id });

            await NotificationService.create(
                component.projectId._id,
                `A New Error Tracker was Created with name ${errorTracker.name} by ${user.name}`,
                user._id,
                'errortrackeraddremove'
            );
            await RealTimeService.sendErrorTrackerCreated(errorTracker);
            return sendItemResponse(req, res, errorTracker);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Description: Get all Error Trackers by componentId.
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
        const errorTrackers = await ErrorTrackerService.getErrorTrackersByComponentId(
            componentId,
            req.query.limit || 0,
            req.query.skip || 0
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
    async function(req, res) {
        try {
            const errorTracker = await ErrorTrackerService.deleteBy(
                {
                    _id: req.params.errorTrackerId,
                    componentId: req.params.componentId,
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
    async function(req, res) {
        const errorTrackerId = req.params.errorTrackerId;

        const currentErrorTracker = await ErrorTrackerService.findOneBy({
            _id: errorTrackerId,
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
    async function(req, res) {
        const errorTrackerId = req.params.errorTrackerId;

        const data = req.body;
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
                message: 'New Error Tracker Name is required.',
            });
        }

        const currentErrorTracker = await ErrorTrackerService.findOneBy({
            _id: errorTrackerId,
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
            componentId: req.params.componentId,
        };
        if (data.resourceCategory != '') {
            existingQuery.resourceCategory = data.resourceCategory;
        }
        const existingErrorTracking = await ErrorTrackerService.findBy(
            existingQuery
        );

        if (
            existingErrorTracking &&
            existingErrorTracking.length > 0 &&
            data.resourceCategory != ''
        ) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Error Tracker with that name already exists.',
            });
        }

        // Error Tracker is valid
        const errorTrackerUpdate = {
            name: data.name,
        };

        let unsetData;
        if (!data.resourceCategory || data.resourceCategory === '') {
            unsetData = { resourceCategory: '' };
        } else {
            const resourceCategoryModel = await ResourceCategoryService.findBy({
                _id: data.resourceCategory,
            });
            if (resourceCategoryModel) {
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
router.post('/:errorTrackerId/track', isErrorTrackerValid, async function(
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

        await RealTimeService.sendErrorEventCreated({ errorEvent, issue });
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
    async function(req, res) {
        try {
            const { skip, limit, startDate, endDate, filters } = req.body;
            const errorTrackerId = req.params.errorTrackerId;

            const currentErrorTracker = await ErrorTrackerService.findOneBy({
                _id: errorTrackerId,
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
    async function(req, res) {
        try {
            const errorEventId = req.params.errorEventId;
            if (!errorEventId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Error Event ID is required',
                });
            }
            const errorTrackerId = req.params.errorTrackerId;

            const currentErrorEvent = await ErrorEventService.findOneBy({
                _id: errorEventId,
                errorTrackerId,
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
    async function(req, res) {
        try {
            const issueId = req.params.issueId;
            if (!issueId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Error Event ID is required',
                });
            }
            const errorTrackerId = req.params.errorTrackerId;

            const issue = await IssueService.findOneBy({
                _id: issueId,
                errorTrackerId,
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
// Description: Ignore, Resolve and Unresolve an issue by _id and errorTrackerId.
router.post(
    '/:projectId/:componentId/:errorTrackerId/issues/action',
    getUser,
    isAuthorized,
    async function(req, res) {
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
            const allowedActions = ['ignore', 'unresolve', 'resolve'];
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

            const currentErrorTracker = await ErrorTrackerService.findOneBy({
                _id: errorTrackerId,
                componentId,
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
                const currentIssue = await IssueService.findOneBy(query);
                if (currentIssue) {
                    const issue = await IssueService.updateOneBy(
                        query,
                        updateData
                    );
                    issues.push(issue);

                    // update a timeline object
                    await RealTimeService.sendIssueStatusChange(issue, action);
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
    async function(req, res) {
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

            const currentErrorTracker = await ErrorTrackerService.findOneBy({
                _id: errorTrackerId,
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

            const errorEvents = await ErrorEventService.findBy(
                query,
                limit || 10,
                skip || 0
            );

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
    async function(req, res) {
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

            const currentErrorTracker = await ErrorTrackerService.findOneBy({
                _id: errorTrackerId,
                componentId,
            });
            if (!currentErrorTracker) {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Error Tracker not found',
                });
            }

            const currentIssue = await IssueService.findOneBy({
                _id: issueId,
                errorTrackerId,
            });
            if (!currentIssue) {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Issue not found',
                });
            }

            const issueMembers = await IssueMemberService.findBy({
                issueId,
                removed: false,
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
    async function(req, res) {
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

            const currentErrorTracker = await ErrorTrackerService.findOneBy({
                _id: errorTrackerId,
                componentId,
            });
            if (!currentErrorTracker) {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Error Tracker not found',
                });
            }

            const currentIssue = await IssueService.findOneBy({
                _id: issueId,
                errorTrackerId,
            });
            if (!currentIssue) {
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

            const members = await IssueMemberService.findBy({
                issueId,
                removed: false,
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
    async function(req, res) {
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

            const currentErrorTracker = await ErrorTrackerService.findOneBy({
                _id: errorTrackerId,
                componentId,
            });
            if (!currentErrorTracker) {
                return sendErrorResponse(req, res, {
                    code: 404,
                    message: 'Error Tracker not found',
                });
            }

            const currentIssue = await IssueService.findOneBy({
                _id: issueId,
                errorTrackerId,
            });
            if (!currentIssue) {
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

            const members = await IssueMemberService.findBy({
                issueId,
                removed: false,
            });
            return sendItemResponse(req, res, { issueId, members });
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);
module.exports = router;
