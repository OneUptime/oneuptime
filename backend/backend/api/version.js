/* eslint-disable linebreak-style */
/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const router = express.Router();

const getUser = require('../middlewares/user').getUser;
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;

router.get('/', getUser, function (req, res) {
    try {
        return sendItemResponse(req, res, {
            server: process.env.npm_package_version,
            client: ''
        });
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;