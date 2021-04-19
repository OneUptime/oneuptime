const express = require('express');
const getUser = require('../middlewares/user').getUser;
const { isAuthorized } = require('../middlewares/authorization');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const GroupService = require('../services/groupService');
const getSubProjects = require('../middlewares/subProject').getSubProjects;
const EscalationService = require('../services/escalationService');

const router = express.Router();

router.post('/:projectId', getUser, isAuthorized, async (req, res) => {
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
        return sendErrorResponse(req, res, error);
    }
});

router.get(
    '/:projectId/groups',
    getUser,
    isAuthorized,
    getSubProjects,
    async (req, res) => {
        const subProjectIds = req.user.subProjects
            ? req.user.subProjects.map(project => {
                  return { id: project._id, name: project.name };
              })
            : null;
        try {
            const groups = await Promise.all(
                subProjectIds.map(async project => {
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
            return sendErrorResponse(req, res, error);
        }
    }
);

router.get('/:projectId', getUser, isAuthorized, async (req, res) => {
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
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/:groupId', getUser, isAuthorized, async (req, res) => {
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
        return sendErrorResponse(req, res, error);
    }
});

router.delete(
    '/:projectId/:groupId',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { groupId, projectId } = req.params;
            const userId = req.user.id;
            const deleteGroup = await GroupService.deleteBy(
                {
                    _id: groupId,
                },
                userId
            );

            await EscalationService.deleteEscalationMember(
                projectId,
                groupId,
                userId
            );

            return sendItemResponse(req, res, deleteGroup);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

module.exports = router;
