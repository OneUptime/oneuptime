import express from 'express';
const router = express.Router();

import { sendErrorResponse, sendItemResponse } from 'common-server/utils/response';


router.get('/', function (req: Request, res: Response) {
    try {
        return sendItemResponse(req, res, {
            server: process.env.npm_package_version,
            client: '',
        });
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

export default router;
