import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/utils/Express';
const router = express.getRouter();

import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/utils/response';
import Exception from 'Common/Types/Exception/Exception';

router.get('/', (req: ExpressRequest, res: ExpressResponse) => {
    try {
        return sendItemResponse(req, res, {
            server: process.env['npm_package_version'],
            client: '',
        });
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

export default router;
