import express, {
    Request,
    Response,
    NextFunction,
} from 'common-server/utils/express';

import { sendErrorResponse, sendSuccessResponse } from '../utils/response';
const router = express.getRouter();
import jsScript from '../utils/scriptSandbox';

import bashScript from '../utils/bash';

router.post('/js', async function(req: Request, res: Response) {
    try {
        const script = req.body.script;

        const response = await jsScript.run(script, true);
        return sendSuccessResponse(req, res, response);
    } catch (err) {
        return sendErrorResponse(req, res, err);
    }
});

router.post('/bash', async function(req: Request, res: Response) {
    try {
        const script = req.body.script;
        const response = await bashScript.run(script);
        return sendSuccessResponse(req, res, response);
    } catch (err) {
        return sendErrorResponse(req, res, err);
    }
});

export default router;
