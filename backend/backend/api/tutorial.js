

const express = require('express');
const router = express.Router();

const UserService = require('../services/userService');

const getUser = require('../middlewares/user').getUser;
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;

router.get('/', getUser, async function(req, res) {
    try {
        const userId = req.user ? req.user.id : null;
        const user = await UserService.findOneBy({
            query: { _id: userId },
            select: '_id tutorial',
        });
        const tutorialObj = {
            _id: user._id,
            data: { ...user.tutorial },
        };

        return sendItemResponse(req, res, tutorialObj);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/', getUser, async function(req, res) {
    try {
        const userId = req.user ? req.user.id : null;
        let user = await UserService.findOneBy({
            query: { _id: userId },
            select: 'tutorial _id',
        });
        // validate that project ID is passed
        const projectId = req.body.projectId;
        if (!projectId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: "Project ID can't be null",
            });
        }
        user = await UserService.closeTutorialBy(
            { _id: userId },
            req.body.type,
            user.tutorial,
            projectId // project ID is always needed
        );

        const tutorialObj = {
            _id: user._id,
            data: { ...user.tutorial },
        };

        return sendItemResponse(req, res, tutorialObj);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
