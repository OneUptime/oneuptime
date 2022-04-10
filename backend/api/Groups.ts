import express, {
    ExpressRequest,
    ExpressResponse,
} from 'common-server/utils/Express';
const getUser = require('../middlewares/user').getUser;

import { isAuthorized } from '../middlewares/authorization';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'common-server/utils/response';
import Exception from 'common/Types/Exception/Exception';

import { sendListResponse } from 'common-server/utils/response';
import GroupService from '../services/groupService';
const getSubProjects = require('../middlewares/subProject').getSubProjects;
import EscalationService from '../services/escalationService';

const router = express.getRouter();

router.post(
    '/:projectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { name, teams } = req.body;
            const { projectId } = req.params;

            const userId = req.user.id;

            if (!name) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Group name must be present',
                });
            }

            const response = await GroupService.create({
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
        const subProjectIds = req.user.subProjects
            ? req.user.subProjects.map((project: $TSFixMe) => {
                  return { id: project._id, name: project.name };
              })
            : null;
        try {
            const groups = await Promise.all(
                subProjectIds.map(async (project: $TSFixMe) => {
                    const groups = await GroupService.findBy({
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
            const { projectId } = req.params;
            const { skip, limit } = req.query;
            const groups = await GroupService.findBy(
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
            const { groupId, projectId } = req.params;
            const { name, teams } = req.body;

            const data = {};
            if (name) {
                data.name = name;
            }
            if (teams) {
                data.teams = teams;
            }

            const groups = await GroupService.updateOneBy(
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
            const { groupId, projectId } = req.params;

            const userId = req.user.id;

            const [deleteGroup] = await Promise.all([
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
