/* eslint-disable linebreak-style */
/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const router = express.Router();

const UserService = require('../services/userService');

const getUser = require('../middlewares/user').getUser;
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;

router.get('/', getUser, async function (req, res) {
    const userId = req.user ? req.user.id : null;

    try {
        const user = await UserService.findOneBy({ _id: userId });
        const tutorialObj = {
            _id: user._id,
            data: { ...user.tutorial }
        };

        return sendItemResponse(req, res, tutorialObj);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/', getUser, async function (req, res) {
    const userId = req.user ? req.user.id : null;

    try {
        let user = await UserService.findOneBy({ _id: userId });
        user = await UserService.closeTutorialBy({ _id: userId }, req.body.type, user.tutorial);
        
        const tutorialObj = {
            _id: user._id,
            data: { ...user.tutorial }
        };

        return sendItemResponse(req, res, tutorialObj);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;