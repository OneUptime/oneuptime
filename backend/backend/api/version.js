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

router.get('/', function(req, res) {
    try {
        return sendItemResponse(req, res, {
            server: process.env.npm_package_version,
            client: '',
        });
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
