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
    var userId = req.user ? req.user.id : null;

    try {
        return sendItemResponse(req, res, {
            _id: userId,
            data: {
                
            }
        });
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/', getUser, async function (req, res) {
    var userId = req.user ? req.user.id : null;

    try {
        return sendItemResponse(req, res, {
            _id: userId,
            data: {
                monitor: {
                    show: false
                }
            }
        });
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;