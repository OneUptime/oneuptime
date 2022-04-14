import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/utils/Express';

import { sendErrorResponse, sendSuccessResponse } from '../Utils/response';
const router: $TSFixMe = express.getRouter();
import jsScript from '../Utils/scriptSandbox';

import bashScript from '../Utils/bash';

router.post('/js', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const script: $TSFixMe = req.body.script;

        const response: $TSFixMe = await jsScript.run(script, true);
        return sendSuccessResponse(req, res, response);
    } catch (err) {
        return sendErrorResponse(req, res, err);
    }
});

router.post('/bash', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const script: $TSFixMe = req.body.script;
        const response: $TSFixMe = await bashScript.run(script);
        return sendSuccessResponse(req, res, response);
    } catch (err) {
        return sendErrorResponse(req, res, err);
    }
});

export default router;
