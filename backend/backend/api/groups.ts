import express from 'express'
const getUser = require('../middlewares/user').getUser;
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../middlewares/authorization"' has no exp... Remove this comment to see the full error message
import { isAuthorized } from '../middlewares/authorization'
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
import GroupService from '../services/groupService'
const getSubProjects = require('../middlewares/subProject').getSubProjects;
import EscalationService from '../services/escalationService'

const router = express.Router();

router.post('/:projectId', getUser, isAuthorized, async (req, res) => {
    try {
        const { name, teams } = req.body;
        const { projectId } = req.params;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
        const subProjectIds = req.user.subProjects
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
            ? req.user.subProjects.map((project: $TSFixMe) => {
                  return { id: project._id, name: project.name };
              })
            : null;
        try {
            const groups = await Promise.all(
                subProjectIds.map(async (project: $TSFixMe) => {
                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 1.
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type '{}'.
            data.name = name;
        }
        if (teams) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'teams' does not exist on type '{}'.
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'Request<{ ... Remove this comment to see the full error message
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
            return sendErrorResponse(req, res, error);
        }
    }
);

export default router;
