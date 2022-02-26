// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'express' or its corresponding ... Remove this comment to see the full error message
import express from 'express'
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../utils/response"' has no exported membe... Remove this comment to see the full error message
import { sendErrorResponse, sendSuccessResponse } from '../utils/response'
const router = express.Router();
import jsScript from '../utils/scriptSandbox'
// @ts-expect-error ts-migrate(1192) FIXME: Module '"/home/nawazdhandala/Projects/OneUptime/ap... Remove this comment to see the full error message
import bashScript from '../utils/bash'

router.post('/js', async function(req: $TSFixMe, res: $TSFixMe) {
    try {
        const script = req.body.script;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'run' does not exist on type 'Promise<unk... Remove this comment to see the full error message
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
