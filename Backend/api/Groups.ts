import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
const getUser: $TSFixMe = require('../middlewares/user').getUser;

import { isAuthorized } from '../middlewares/authorization';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import { sendListResponse } from 'CommonServer/Utils/response';
import GroupService from '../services/groupService';
const getSubProjects: $TSFixMe =
    require('../middlewares/subProject').getSubProjects;
import EscalationService from '../services/escalationService';

const router: $TSFixMe = express.getRouter();

router.post(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { name, teams }: $TSFixMe = req.body;
            const { projectId }: $TSFixMe = req.params;

            const userId: $TSFixMe = req.user.id;

            if (!name) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Group name must be present',
                });
            }

            const response: $TSFixMe = await GroupService.create({
                projectId,
                name,
                teams,
                createdById: userId,
            });
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/groups',
    getUser,
    isAuthorized,
    getSubProjects,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const subProjectIds: $TSFixMe = req.user.subProjects
            ? req.user.subProjects.map((project: $TSFixMe) => {
                  return { id: project._id, name: project.name };
              })
            : null;
        try {
            const groups: $TSFixMe = await Promise.all(
                subProjectIds.map(async (project: $TSFixMe) => {
                    const groups: $TSFixMe = await GroupService.findBy({
                        projectId: project.id,
                    });
                    return {
                        groups,
                        project,
                    };
                })
            );
            return sendListResponse(req, res, groups);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId }: $TSFixMe = req.params;
            const { skip, limit }: $TSFixMe = req.query;
            const groups: $TSFixMe = await GroupService.findBy(
                {
                    projectId: projectId,
                },
                limit,
                skip
            );
            return sendItemResponse(req, res, groups);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/:groupId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { groupId, projectId }: $TSFixMe = req.params;
            const { name, teams }: $TSFixMe = req.body;

            const data: $TSFixMe = {};
            if (name) {
                data.name = name;
            }
            if (teams) {
                data.teams = teams;
            }

            const groups: $TSFixMe = await GroupService.updateOneBy(
                { _id: groupId },
                data,
                projectId
            );
            return sendItemResponse(req, res, groups);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.delete(
    '/:projectId/:groupId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { groupId, projectId }: $TSFixMe = req.params;

            const userId: $TSFixMe = req.user.id;

            const [deleteGroup]: $TSFixMe = await Promise.all([
                GroupService.deleteBy(
                    {
                        _id: groupId,
                    },
                    userId
                ),
                EscalationService.deleteEscalationMember(
                    projectId,
                    groupId,
                    userId
                ),
            ]);

            return sendItemResponse(req, res, deleteGroup);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
