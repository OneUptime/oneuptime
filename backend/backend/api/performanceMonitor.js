/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');

const router = express.Router();

const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
// Route
// Description: Receiving Data from sdk.
// Returns: response status, error message
router.post('/:appId', async function(req, res) {
    try {
        const data = req.body;
        /* eslint-disable no-console */
        console.log(data);
        return sendItemResponse(req, res, data);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});
module.exports = router;
