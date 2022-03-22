import express, {
    ExpressRequest,
    ExpressResponse,
} from 'common-server/utils/express';
const router = express.getRouter();

import {
    sendErrorResponse,
    sendItemResponse,
} from 'common-server/utils/response';

router.get('/', (req: ExpressRequest, res: ExpressResponse) => {
    try {
        return sendItemResponse(req, res, {
            server: process.env['npm_package_version'],
            client: '',
        });
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

export default router;
