import express from 'express';

import { sendErrorResponse, sendSuccessResponse } from '../utils/response';
const router = express.Router();
import jsScript from '../utils/scriptSandbox';

import bashScript from '../utils/bash';

router.post('/js', async function(req: $TSFixMe, res: $TSFixMe) {
    try {
        const script = req.body.script;

        const response = await jsScript.run(script, true);
        return sendSuccessResponse(req, res, response);
    } catch (err) {
        return sendErrorResponse(req, res, err);
    }
});

router.post('/bash', async function(req: $TSFixMe, res: $TSFixMe) {
    try {
        const script = req.body.script;
        const response = await bashScript.run(script);
        return sendSuccessResponse(req, res, response);
    } catch (err) {
        return sendErrorResponse(req, res, err);
    }
});

export default router;
