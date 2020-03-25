/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const router = express.Router();
const { isAuthorized } = require('../middlewares/authorization');
const getUser = require('../middlewares/user').getUser;

const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;

const AdminSettingsService = require('../services/adminSettings');

// type is 'smtp' or twilio'
router.get('/:type', getUser, isAuthorized, async function(req, res) {
    try {
        const settings = await AdminSettingsService.findOne({
            name: `${req.user.id}-${req.params.type}-settings`,
        });
        return sendItemResponse(req, res, settings);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/:type', getUser, isAuthorized, async function(req, res) {
    try {
        const query = {
            name: `${req.user.id}-${req.params.type}-settings`,
        };
        const settings = await AdminSettingsService.findOne(query);
        let result;
        if (settings) {
            result = await AdminSettingsService.updateOne(query, {
                value: req.body,
            });
        } else {
            result = await AdminSettingsService.create(
                req.params.type,
                req.body,
                req.user.id
            );
        }
        return sendItemResponse(req, res, result);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
