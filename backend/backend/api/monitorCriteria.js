/* eslint-disable linebreak-style */
/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const router = express.Router();

const getUser = require('../middlewares/user').getUser;

const MonitorCriteriaService = require('../services/monitorCriteriaService');

const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;

router.get('/', getUser, function(req, res) {
    try {
        const criteria = MonitorCriteriaService.getCriteria();
        return sendItemResponse(req, res, criteria);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
