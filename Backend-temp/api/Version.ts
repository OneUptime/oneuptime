import express, {
    ExpressRequest,
    ExpressResponse,
} from 'common-server/utils/Express';
const router = express.getRouter();

import {
    sendErrorResponse,
    sendItemResponse,
} from 'common-server/utils/response';
import Exception from 'common/Types/Exception/Exception';

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
