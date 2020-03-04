/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const router = express.Router();

const { IS_FYIPE_HOSTED } = require('../config/server');
const sendItemResponse = require('../middlewares/response').sendItemResponse;

//This API is used to get the backend response if it's a consumer service deployed on Fyipe Cloud or an Enterprise Service deployed on Enterprise customer's cloud.
router.get('/is-saas-service', function(req, res) {
    if (IS_FYIPE_HOSTED) {
        return sendItemResponse(req, res, { result: true });
    } else {
        return sendItemResponse(req, res, { result: false });
    }
});

module.exports = router;
