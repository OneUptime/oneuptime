/* eslint-disable linebreak-style */
/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const router = express.Router();

const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;

const dashboardVersion = require('../../../dashboard/package.json').version;
const helmVersion = require('../../../helm-chart/package.json').version;
const docsVersion = require('../../../api-docs/package.json').version;

router.get('/', function(req, res) {
    try {
        return sendItemResponse(req, res, {
            server: process.env.npm_package_version,
            client: '',
            dashboard: dashboardVersion,
            helm: helmVersion,
            docs: docsVersion,
        });
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
