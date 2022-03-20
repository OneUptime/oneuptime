import express, { Request, Response } from 'common-server/utils/express';
const router = express.getRouter();
import {
    sendErrorResponse,
    sendItemResponse,
} from 'common-server/utils/response';

import LicenseService from '../services/licenseService';

router.post('/', async (req: Request, res: Response) => {
    try {
        const data = req.body;

        if (!data.license) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'License must be present.',
            });
        }

        if (typeof data.license !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'License is not in string format.',
            });
        }

        if (!data.email) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Email must be present.',
            });
        }

        if (typeof data.email !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Email is not in string format.',
            });
        }

        const item = await LicenseService.confirm({
            license: data.license,
            email: data.email,
            limit: req.query['limit'] || 100,
        });

        return sendItemResponse(req, res, item);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

export default router;
