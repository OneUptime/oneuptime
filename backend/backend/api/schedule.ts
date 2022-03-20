import express, { Request, Response } from 'common-server/utils/express';
import ScheduleService from '../services/scheduleService';
const router = express.getRouter();
const isUserAdmin = require('../middlewares/project').isUserAdmin;
const getUser = require('../middlewares/user').getUser;
const getSubProjects = require('../middlewares/subProject').getSubProjects;

import { isAuthorized } from '../middlewares/authorization';
import {
    sendErrorResponse,
    sendListResponse,
    sendItemResponse,
} from 'common-server/utils/response';

router.post(
    '/:projectId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async function (req, res) {
        try {
            const data = req.body;

            const userId = req.user ? req.user.id : null;
            data.createdById = userId;
            data.projectId = req.params.projectId;

            if (!data.name) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Name is required',
                });
            }
            const schedule = await ScheduleService.create(data);
            return sendItemResponse(req, res, schedule);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.get(
    '/:projectId',
    getUser,
    isAuthorized,
    async function (req: Request, res: Response) {
        try {
            const projectId = req.params.projectId;
            const populate = [
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
                {
                    path: 'escalationIds',
                    select: 'teams',
                    populate: {
                        path: 'teams.teamMembers.groupId',
                        select: 'name',
                    },
                },
            ];

            const select =
                '_id name slug projectId createdById monitorsIds escalationIds createdAt isDefault userIds';
            const [schedules, count] = await Promise.all([
                ScheduleService.findBy({
                    query: { projectId: projectId },
                    limit: req.query['limit'] || 10,
                    skip: req.query['skip'] || 0,
                    populate,
                    select,
                }),
                ScheduleService.countBy({ projectId }),
            ]);
            return sendListResponse(req, res, schedules, count);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.get(
    '/:projectId/schedules',
    getUser,
    isAuthorized,
    getSubProjects,
    async function (req: Request, res: Response) {
        try {
            const subProjectIds = req.user.subProjects
                ? req.user.subProjects.map((project: $TSFixMe) => project._id)
                : null;
            const schedules = await ScheduleService.getSubProjectSchedules(
                subProjectIds
            );
            return sendItemResponse(req, res, schedules); // frontend expects sendItemResponse
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.get(
    '/:projectId/schedule',
    getUser,
    isAuthorized,
    async function (req, res) {
        try {
            const projectId = req.params.projectId;
            const populate = [
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

            const select =
                '_id name slug projectId createdById monitorsIds escalationIds createdAt isDefault userIds';
            const [schedule, count] = await Promise.all([
                ScheduleService.findBy({
                    query: { projectId },
                    limit: req.query['limit'] || 10,
                    skip: req.query['skip'] || 0,
                    populate,
                    select,
                }),
                ScheduleService.countBy({ projectId }),
            ]);
            return sendListResponse(req, res, schedule, count); // frontend expects sendListResponse
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.put(
    '/:projectId/:scheduleId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async function (req: Request, res: Response) {
        try {
            const { projectId, scheduleId } = req.params;
            const data = req.body;
            const schedule = await ScheduleService.updateOneBy(
                { _id: scheduleId, projectId },
                data
            );
            return sendItemResponse(req, res, schedule);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.delete(
    '/:projectId/:scheduleId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async function (req: Request, res: Response) {
        try {
            const scheduleId = req.params.scheduleId;

            const userId = req.user ? req.user.id : null;

            if (!scheduleId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'ScheduleId must be present.',
                });
            }
            const schedule = await ScheduleService.deleteBy(
                { _id: scheduleId },
                userId
            );
            return sendItemResponse(req, res, schedule);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.get(
    '/:projectId/:userId/getescalations',
    getUser,
    isAuthorized,
    getSubProjects,
    async (req: Request, res: Response) => {
        try {
            const subProjectIds = req.user.subProjects
                ? req.user.subProjects.map((project: $TSFixMe) => project._id)
                : null;
            const userId = req.params.userId;
            const escalations = await ScheduleService.getUserEscalations(
                subProjectIds,
                userId
            );
            return sendListResponse(req, res, escalations);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.get(
    '/:projectId/:scheduleId/getescalation',
    getUser,
    isAuthorized,
    async (req: Request, res: Response) => {
        try {
            const scheduleId = req.params.scheduleId;
            const response = await ScheduleService.getEscalations(scheduleId);
            return sendListResponse(
                req,
                res,
                response.escalations,
                response.count
            );
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.post(
    '/:projectId/:scheduleId/addEscalation',
    getUser,
    isAuthorized,
    isUserAdmin,
    async (req: Request, res: Response) => {
        try {
            const userId = req.user ? req.user.id : null;
            const scheduleId = req.params.scheduleId;
            const escalations = [];
            let escalationPolicyCount = 0;
            for (const value of req.body) {
                escalationPolicyCount++;
                const storagevalue = {};
                const tempTeam = [];

                if (!value.email && !value.call && !value.sms && !value.push) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message:
                            'Please select how should OneUptime alert your team - SMS, Email, Call OR Push notification ' +
                            (req.body.length > 1
                                ? ' in Escalation Policy ' +
                                  escalationPolicyCount
                                : ''),
                    });
                }

                if (value.email && !value.emailReminders) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message:
                            'Number of Email Reminders is required ' +
                            (req.body.length > 1
                                ? ' in Escalation Policy ' +
                                  escalationPolicyCount
                                : ''),
                    });
                }

                if (value.call && !value.callReminders) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message:
                            'Number of Call Reminders is required ' +
                            (req.body.length > 1
                                ? ' in Escalation Policy ' +
                                  escalationPolicyCount
                                : ''),
                    });
                }

                if (value.sms && !value.smsReminders) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message:
                            'Number of SMS Reminders is required ' +
                            (req.body.length > 1
                                ? ' in Escalation Policy ' +
                                  escalationPolicyCount
                                : ''),
                    });
                }

                if (value.push && !value.pushReminders) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message:
                            'Number of Push notification Reminders is required ' +
                            (req.body.length > 1
                                ? ' in Escalation Policy ' +
                                  escalationPolicyCount
                                : ''),
                    });
                }

                if (value.rotateBy && !value.rotationInterval) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message:
                            'Please specify Rotation Interval ' +
                            (req.body.length > 1
                                ? ' in Escalation Policy ' +
                                  escalationPolicyCount
                                : ''),
                    });
                }

                if (
                    value.rotateBy &&
                    value.rotationInterval &&
                    !value.firstRotationOn
                ) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message:
                            'Please specify "First rotation happens on" ' +
                            (req.body.length > 1
                                ? ' in Escalation Policy ' +
                                  escalationPolicyCount
                                : ''),
                    });
                }

                if (
                    value.rotateBy &&
                    value.rotationInterval &&
                    value.firstRotationOn &&
                    !value.rotationTimezone
                ) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message:
                            'You must specify timezone for "First rotation happens on" ' +
                            (req.body.length > 1
                                ? ' in Escalation Policy ' +
                                  escalationPolicyCount
                                : ''),
                    });
                }

                if (value.rotateBy && value.teams.length <= 1) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message:
                            'You need more than one team for rotations ' +
                            (req.body.length > 1
                                ? ' in Escalation Policy ' +
                                  escalationPolicyCount
                                : ''),
                    });
                }

                if (
                    value.callReminders &&
                    typeof value.callReminders === 'string'
                ) {
                    value.callReminders = parseInt(value.callReminders);
                }

                if (
                    value.smsReminders &&
                    typeof value.smsReminders === 'string'
                ) {
                    value.smsReminders = parseInt(value.smsReminders);
                }

                if (
                    value.emailReminders &&
                    typeof value.emailReminders === 'string'
                ) {
                    value.emailReminders = parseInt(value.emailReminders);
                }

                if (
                    value.pushReminders &&
                    typeof value.pushReminders === 'string'
                ) {
                    value.pushReminders = parseInt(value.pushReminders);
                }

                if (
                    value.firstRotationOn &&
                    typeof value.firstRotationOn === 'string'
                ) {
                    value.firstRotationOn = new Date(value.firstRotationOn);
                }

                storagevalue.callReminders = value.callReminders;

                storagevalue.smsReminders = value.smsReminders;

                storagevalue.emailReminders = value.emailReminders;

                storagevalue.pushReminders = value.pushReminders;

                storagevalue.rotateBy = value.rotateBy;

                storagevalue.rotationInterval = value.rotationInterval;

                storagevalue.firstRotationOn = value.firstRotationOn;

                storagevalue.rotationTimezone = value.rotationTimezone;

                storagevalue.email = value.email;

                storagevalue.call = value.call;

                storagevalue.sms = value.sms;

                storagevalue.push = value.push;

                storagevalue.projectId = req.params.projectId;

                storagevalue.scheduleId = scheduleId;

                storagevalue.createdById = userId;

                if (value._id) storagevalue._id = value._id;

                for (const team of value.teams) {
                    const rotationData = {};
                    const teamMembers = [];
                    if (!team.teamMembers || team.teamMembers.length === 0) {
                        return sendErrorResponse(req, res, {
                            code: 400,
                            message:
                                'Team Members are required ' +
                                (req.body.length > 1
                                    ? ' in Escalation Policy ' +
                                      escalationPolicyCount
                                    : ''),
                        });
                    }

                    const teamMemberUserIds = team.teamMembers
                        .map((member: $TSFixMe) => member.userId)
                        .filter((team: $TSFixMe) => team !== undefined);

                    for (const teamMember of team.teamMembers) {
                        const data = {};
                        if (!teamMember.userId && !teamMember.groupId) {
                            return sendErrorResponse(req, res, {
                                code: 400,
                                message:
                                    'Please add team members or group to your on-call schedule ' +
                                    (req.body.length > 1
                                        ? ' in Escalation Policy ' +
                                          escalationPolicyCount
                                        : ''),
                            });
                        }

                        if (
                            teamMember.userId &&
                            teamMemberUserIds.filter(
                                (userId: $TSFixMe) =>
                                    userId == teamMember.userId
                            ).length > 1
                        ) {
                            return sendErrorResponse(req, res, {
                                code: 400,
                                message:
                                    'Please remove duplicate team members from your on-call schedule' +
                                    (req.body.length > 1
                                        ? ' in Escalation Policy ' +
                                          escalationPolicyCount
                                        : ''),
                            });
                        }
                        if (
                            teamMember.startTime &&
                            typeof teamMember.startTime === 'string'
                        ) {
                            teamMember.startTime = new Date(
                                teamMember.startTime
                            );
                        }

                        if (
                            teamMember.endTime &&
                            typeof teamMember.endTime === 'string'
                        ) {
                            teamMember.endTime = new Date(teamMember.endTime);
                        }
                        if (teamMember.userId) {
                            data.userId = teamMember.userId;

                            data.startTime = teamMember.startTime;

                            data.endTime = teamMember.endTime;

                            data.timezone = teamMember.timezone;
                            teamMembers.push(data);
                        }
                        if (teamMember.groupId) {
                            data.groupId = teamMember.groupId;

                            data.startTime = teamMember.startTime;

                            data.endTime = teamMember.endTime;

                            data.timezone = teamMember.timezone;
                            teamMembers.push(data);
                        }
                    }

                    rotationData.teamMembers = teamMembers;
                    tempTeam.push(rotationData);
                }

                storagevalue.teams = tempTeam;
                escalations.push(storagevalue);
            }
            const escalation = await ScheduleService.addEscalation(
                scheduleId,
                escalations,
                userId
            );
            return sendItemResponse(req, res, escalation);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

export default router;
