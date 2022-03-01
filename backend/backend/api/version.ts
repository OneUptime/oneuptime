import express from 'express';
const router = express.Router();

const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;

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
