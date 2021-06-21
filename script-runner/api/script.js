const express = require('express');
const { sendErrorResponse, sendSuccessResponse } = require('../utils/response');
const router = express.Router();
const jsScript = require('../utils/scriptSandbox');
const bashScript = require('../utils/bash');

router.post('/js', async function(req, res) {
    try {
        const script = req.body.script;
        const response = await jsScript.run(script, true);
        return sendSuccessResponse(req, res, response);
    } catch (err) {
        return sendErrorResponse(req, res, err);
    }
});

router.post('/bash', async function(req, res) {
    try {
        const script = req.body.script;
        const response = await bashScript.run(script);
        return sendSuccessResponse(req, res, response);
    } catch (err) {
        return sendErrorResponse(req, res, err);
    }
});

module.exports = router;
