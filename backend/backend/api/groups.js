const express = require('express');
const getUser = require('../middlewares/user').getUser;
const { isAuthorized } = require('../middlewares/authorization');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const GroupService = require('../services/groupService');

const router = express.Router();

router.post('/:projectId/group', getUser, isAuthorized, async (req, res) => {
    try {
        const { name, teams } = req.body;
        const { projectId } = req.params;
        const userId = req.user.id;

        if (!name) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Please provide a password',
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

router.get('/:projectId/groups', getUser, isAuthorized, async (req, res) => {
    try {
        const { projectId } = req.params;
        const { skip, limit } = req.query;
        const groups = await GroupService.findBy(
            {
                projectId,
            },
            skip,
            limit
        );
        return sendItemResponse(req, res, groups);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put(
    '/:projectId/gitCredential/:groupId',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { groupId } = req.params;
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
                data
            );
            return sendItemResponse(req, res, groups);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.delete(
    '/:projectId/gitCredential/:groupId',
    getUser,
    isAuthorized,
    async (req, res) => {
        try {
            const { groupId } = req.params;
            const userId = req.user.id;
            const deleteGroup = await GroupService.deleteBy(
                {
                    _id: groupId,
                },
                userId
            );

            return sendItemResponse(req, res, deleteGroup);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

module.exports = router;
